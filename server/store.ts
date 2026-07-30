import { randomBytes } from 'node:crypto';
import type { Participant, Prefs, Restaurant, Session, VoteResult } from '../shared/types';
import { computeResult } from '../shared/scoring';
import restaurants from '../shared/restaurants.json';
import { normalizeDemoRestaurants, type DemoRestaurantInput } from '../shared/catalog';
import { SESSION_POLICY } from '../shared/policy';
import { failure, success, type DomainResult } from '../shared/failures';

const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export const STORE_LIMITS = Object.freeze({
  participantsPerSession: SESSION_POLICY.participantsPerSession,
  rerunsPerSession: SESSION_POLICY.rerunsPerSession,
  activeSessions: SESSION_POLICY.activeSessions,
  terminalSessions: SESSION_POLICY.terminalSessions,
});

export const RESTAURANTS: Restaurant[] = normalizeDemoRestaurants(restaurants as DemoRestaurantInput[]);

export type TerminalReason = 'ended' | 'expired';
type TerminalReference = { code: string; reason: TerminalReason; removeAt: number };

export interface StoreState {
  sessions: Map<string, Session>;
  codeIndex: Map<string, string>;
  terminalSessions: Map<string, TerminalReference>;
  terminalCodeIndex: Map<string, string>;
}

export interface StoreScheduler {
  setTimeout(callback: () => void, delayMs: number): { unref?: () => void };
  clearTimeout(handle: { unref?: () => void }): void;
}

export interface SessionStoreOptions {
  state?: StoreState;
  clock?: () => number;
  scheduler?: StoreScheduler | null;
  catalog?: readonly Restaurant[];
  tokenFactory?: (bytes: number) => string;
}

export interface CreateOpts {
  areaLabel: string;
  center: { lat: number; lng: number };
  radiusKm: number;
  nickname: string;
  color: number;
  allowReruns: boolean;
  shareHostNickname?: boolean;
}

export interface CreatedSession {
  session: Session;
  participantToken: string;
  participantId: string;
}

export function createStoreState(): StoreState {
  return {
    sessions: new Map(),
    codeIndex: new Map(),
    terminalSessions: new Map(),
    terminalCodeIndex: new Map(),
  };
}

export function token(bytes = 16): string {
  return randomBytes(bytes).toString('base64url');
}

const nodeScheduler: StoreScheduler = {
  setTimeout(callback, delayMs) {
    return setTimeout(callback, delayMs);
  },
  clearTimeout(handle) {
    clearTimeout(handle as NodeJS.Timeout);
  },
};

export class SessionStore {
  readonly state: StoreState;
  readonly catalog: readonly Restaurant[];
  private readonly clock: () => number;
  private readonly tokenFactory: (bytes: number) => string;
  private readonly scheduler: StoreScheduler | null;
  private readonly expirationHandles = new Map<string, { unref?: () => void }>();
  private readonly terminalHandles = new Map<string, { unref?: () => void }>();
  private readonly expirationListeners = new Set<(session: Session) => void>();

  constructor(options: SessionStoreOptions = {}) {
    this.state = options.state ?? createStoreState();
    this.clock = options.clock ?? (() => Date.now());
    this.scheduler = options.scheduler === undefined ? nodeScheduler : options.scheduler;
    this.catalog = options.catalog ?? RESTAURANTS;
    this.tokenFactory = options.tokenFactory ?? token;
    this.sweep();
    for (const session of this.state.sessions.values()) this.scheduleExpiration(session);
    for (const [id, terminal] of this.state.terminalSessions) {
      this.scheduleTerminalRemoval(id, terminal);
    }
  }

  close(): void {
    for (const handle of this.expirationHandles.values()) this.scheduler?.clearTimeout(handle);
    for (const handle of this.terminalHandles.values()) this.scheduler?.clearTimeout(handle);
    this.expirationHandles.clear();
    this.terminalHandles.clear();
    this.expirationListeners.clear();
  }

  private makeCode(): string {
    while (true) {
      const bytes = randomBytes(5);
      const code = Array.from(bytes)
        .map((byte) => CODE_ALPHABET[byte % CODE_ALPHABET.length])
        .join('');
      if (!this.state.codeIndex.has(code) && !this.state.terminalCodeIndex.has(code)) return code;
    }
  }

  create(options: CreateOpts): DomainResult<CreatedSession> {
    if (this.state.sessions.size >= STORE_LIMITS.activeSessions) this.sweep();
    if (this.state.sessions.size >= STORE_LIMITS.activeSessions) return failure('capacity');
    const id = this.tokenFactory(16);
    const code = this.makeCode();
    const participantToken = this.tokenFactory(16);
    const host: Participant = {
      id: this.tokenFactory(12),
      token: participantToken,
      nickname: options.nickname || 'Host',
      color: options.color,
      prefs: null,
      isHost: true,
    };
    const session: Session = {
      id,
      code,
      hostToken: this.tokenFactory(16),
      participants: [host],
      phase: 'collecting',
      result: null,
      excludedIds: [],
      rerunsUsed: 0,
      allowReruns: options.allowReruns,
      createdAt: this.clock(),
      center: options.center,
      areaLabel: options.areaLabel,
      radiusKm: options.radiusKm,
      shareHostNickname: options.shareHostNickname === true && !!options.nickname,
    };
    this.state.sessions.set(id, session);
    this.state.codeIndex.set(code, id);
    this.scheduleExpiration(session);
    return success({ session, participantToken, participantId: host.id });
  }

  get(idOrCode: string): Session | undefined {
    const byCode = this.state.codeIndex.get(idOrCode.toUpperCase());
    const session = byCode ? this.state.sessions.get(byCode) : this.state.sessions.get(idOrCode);
    if (session && this.clock() - session.createdAt >= SESSION_POLICY.ttlMs) {
      this.delete(session, 'expired');
      return undefined;
    }
    return session;
  }

  terminalReason(idOrCode: string): TerminalReason | undefined {
    const id = this.state.terminalCodeIndex.get(idOrCode.toUpperCase()) ?? idOrCode;
    const reference = this.state.terminalSessions.get(id);
    if (!reference) return undefined;
    if (reference.removeAt <= this.clock()) {
      this.removeTerminal(id, reference);
      return undefined;
    }
    return reference.reason;
  }

  onExpired(listener: (session: Session) => void): () => void {
    this.expirationListeners.add(listener);
    return () => this.expirationListeners.delete(listener);
  }

  findParticipant(session: Session, participantToken: string): Participant | undefined {
    return session.participants.find((participant) => participant.token === participantToken);
  }

  join(
    session: Session,
    nickname: string,
    color: number,
  ): DomainResult<{
    participantToken: string;
    participantId: string;
    participant: Participant;
  }> {
    if (session.phase !== 'collecting') return failure('locked');
    if (session.participants.length >= STORE_LIMITS.participantsPerSession) return failure('full');
    const participantToken = this.tokenFactory(16);
    const participant: Participant = {
      id: this.tokenFactory(12),
      token: participantToken,
      nickname,
      color,
      prefs: null,
      isHost: false,
    };
    session.participants.push(participant);
    return success({ participantToken, participantId: participant.id, participant });
  }

  submit(session: Session, participantToken: string, prefs: Prefs): DomainResult<{ participant: Participant }> {
    const participant = this.findParticipant(session, participantToken);
    if (!participant) return failure('invalid-participant');
    if (session.phase !== 'collecting') return failure('locked');
    participant.prefs = prefs;
    return success({ participant });
  }

  leave(session: Session, participantToken: string): DomainResult<{ participantId: string }> {
    if (session.phase !== 'collecting') return failure('locked');
    const index = session.participants.findIndex((participant) => participant.token === participantToken);
    if (index < 0) return failure('invalid-participant');
    if (session.participants[index].isHost) return failure('host-must-end');
    const [participant] = session.participants.splice(index, 1);
    return success({ participantId: participant.id });
  }

  remove(session: Session, hostToken: string, participantId: string): DomainResult<{ participantId: string }> {
    if (session.hostToken !== hostToken) return failure('access-required');
    if (session.phase !== 'collecting') return failure('locked');
    const index = session.participants.findIndex((participant) => participant.id === participantId);
    if (index < 0) return failure('participant-not-found');
    if (session.participants[index].isHost) return failure('host-cannot-be-removed');
    session.participants.splice(index, 1);
    return success({ participantId });
  }

  reveal(session: Session, hostToken: string, onLocked?: () => void): DomainResult<{ changed: boolean }> {
    if (session.hostToken !== hostToken) return failure('access-required');
    if ((session.phase === 'revealed' || session.phase === 'blocked-no-match') && session.result) {
      return success({ changed: false });
    }
    if (session.phase !== 'collecting') return failure('locked');
    if (session.participants.filter((participant) => participant.prefs).length < 2) {
      return failure('too-few-votes');
    }
    session.phase = 'locking';
    onLocked?.();
    try {
      this.applyResult(session, this.compute(session));
    } catch (error) {
      session.phase = 'collecting';
      throw error;
    }
    return success({ changed: true });
  }

  rerun(session: Session, hostToken: string, onLocked?: () => void): DomainResult<void> {
    if (session.hostToken !== hostToken) return failure('access-required');
    if (session.phase !== 'revealed') return failure('locked');
    if (!session.allowReruns) return failure('reruns-disabled');
    if (session.rerunsUsed >= STORE_LIMITS.rerunsPerSession) return failure('reruns-exhausted');
    if (!session.result || session.result.kind !== 'match') return failure('no-match-to-rerun');
    session.phase = 'locking';
    onLocked?.();
    session.excludedIds.push(session.result.winner.restaurant.id);
    session.rerunsUsed += 1;
    try {
      this.applyResult(session, this.compute(session));
    } catch (error) {
      session.excludedIds.pop();
      session.rerunsUsed -= 1;
      session.phase = 'revealed';
      throw error;
    }
    return success(undefined);
  }

  end(idOrCode: string, hostToken: string): DomainResult<{ session: Session }> {
    const session = this.get(idOrCode);
    if (!session || session.hostToken !== hostToken) return failure('access-required');
    this.delete(session, 'ended');
    return success({ session });
  }

  resourceCounts(): { activeSessions: number; terminalSessions: number } {
    return {
      activeSessions: this.state.sessions.size,
      terminalSessions: this.state.terminalSessions.size,
    };
  }

  sweep(): void {
    const now = this.clock();
    for (const session of this.state.sessions.values()) {
      if (now - session.createdAt >= SESSION_POLICY.ttlMs) this.delete(session, 'expired');
    }
    for (const [id, terminal] of this.state.terminalSessions) {
      if (terminal.removeAt <= now) {
        this.removeTerminal(id, terminal);
      }
    }
  }

  private compute(session: Session): VoteResult {
    return computeResult(
      session.id,
      session.participants,
      [...this.catalog],
      session.excludedIds,
      session.rerunsUsed + 1,
      session.excludedIds.map((id) => this.catalog.find((restaurant) => restaurant.id === id)?.name ?? id),
    );
  }

  private applyResult(session: Session, result: VoteResult): void {
    session.result = result;
    session.phase = result.kind === 'match' ? 'revealed' : 'blocked-no-match';
  }

  private delete(session: Session, reason: TerminalReason): void {
    if (this.state.sessions.get(session.id) !== session) return;
    this.state.sessions.delete(session.id);
    this.state.codeIndex.delete(session.code);
    const expirationHandle = this.expirationHandles.get(session.id);
    if (expirationHandle) this.scheduler?.clearTimeout(expirationHandle);
    this.expirationHandles.delete(session.id);
    while (this.state.terminalSessions.size >= STORE_LIMITS.terminalSessions) {
      const oldestId = this.state.terminalSessions.keys().next().value;
      if (!oldestId) break;
      const oldest = this.state.terminalSessions.get(oldestId);
      if (oldest) this.removeTerminal(oldestId, oldest);
    }
    const terminal = {
      code: session.code,
      reason,
      removeAt: this.clock() + SESSION_POLICY.ttlMs,
    };
    this.state.terminalSessions.set(session.id, terminal);
    this.state.terminalCodeIndex.set(session.code, session.id);
    this.scheduleTerminalRemoval(session.id, terminal);
    if (reason === 'expired') this.expirationListeners.forEach((listener) => listener(session));
  }

  private scheduleExpiration(session: Session): void {
    if (!this.scheduler || this.expirationHandles.has(session.id)) return;
    const expiresAt = session.createdAt + SESSION_POLICY.ttlMs;
    const handle = this.scheduler.setTimeout(
      () => {
        this.expirationHandles.delete(session.id);
        const current = this.state.sessions.get(session.id);
        if (current !== session) return;
        if (this.clock() < expiresAt) return this.scheduleExpiration(session);
        this.delete(session, 'expired');
      },
      Math.max(0, expiresAt - this.clock()),
    );
    this.expirationHandles.set(session.id, handle);
    handle.unref?.();
  }

  private scheduleTerminalRemoval(id: string, terminal: TerminalReference): void {
    if (!this.scheduler || this.terminalHandles.has(id)) return;
    const handle = this.scheduler.setTimeout(
      () => {
        this.terminalHandles.delete(id);
        if (this.state.terminalSessions.get(id) !== terminal) return;
        if (this.clock() < terminal.removeAt) return this.scheduleTerminalRemoval(id, terminal);
        this.removeTerminal(id, terminal);
      },
      Math.max(0, terminal.removeAt - this.clock()),
    );
    this.terminalHandles.set(id, handle);
    handle.unref?.();
  }

  private removeTerminal(id: string, terminal: TerminalReference): void {
    if (this.state.terminalSessions.get(id) !== terminal) return;
    this.state.terminalSessions.delete(id);
    this.state.terminalCodeIndex.delete(terminal.code);
    const handle = this.terminalHandles.get(id);
    if (handle) this.scheduler?.clearTimeout(handle);
    this.terminalHandles.delete(id);
  }
}
