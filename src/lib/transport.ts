// Transport abstraction: Socket.IO in normal operation, with an explicit
// development-only local demo for same-browser tab testing.
import { io, type Socket } from 'socket.io-client';
import type { InviteSnapshot, Participant, Prefs, Session, SessionErrorCode, SessionSnapshot } from '@shared/types';
import { inviteSnapshot, SESSION_TTL_MS, snapshot } from '@shared/types';
import { computeResult } from '@shared/scoring';
import restaurantsJson from '@shared/restaurants.json';
import type { Restaurant } from '@shared/types';
import { normalizeDemoRestaurants, type DemoRestaurantInput } from '@shared/catalog';

export const RESTAURANTS: Restaurant[] = normalizeDemoRestaurants(restaurantsJson as DemoRestaurantInput[]);

export interface CreateInput {
  areaLabel: string;
  center: { lat: number; lng: number };
  radiusKm: number;
  nickname: string;
  color: number;
  allowReruns: boolean;
  shareHostNickname: boolean;
}
export interface CreateResult {
  sessionId: string; code: string; hostToken: string;
  participantToken: string; participantId: string; state: SessionSnapshot;
}
export interface OperationError { error?: string; errorCode?: SessionErrorCode }
export interface JoinResult extends OperationError { participantToken: string; participantId: string; state: SessionSnapshot }
export type SessionEvent = 'revealed' | 'rerun' | 'session-ended' | 'session-expired' | 'removed';

export interface Transport {
  mode: 'live' | 'local';
  create(input: CreateInput): Promise<CreateResult & OperationError>;
  invite(idOrCode: string): Promise<{ invite?: InviteSnapshot } & OperationError>;
  join(input: { sessionId?: string; code?: string; nickname: string; color: number }): Promise<JoinResult>;
  attach(sessionId: string, token: string): Promise<{ state?: SessionSnapshot } & OperationError>;
  fetch(sessionId: string, token: string): Promise<{ state?: SessionSnapshot } & OperationError>;
  submit(sessionId: string, token: string, prefs: Prefs): Promise<{ ok: boolean; error?: string }>;
  leave(sessionId: string, token: string): Promise<{ ok: boolean; error?: string }>;
  removeParticipant(sessionId: string, hostToken: string, participantId: string): Promise<{ ok: boolean; error?: string }>;
  reveal(sessionId: string, hostToken: string): Promise<{ ok: boolean; error?: string }>;
  rerun(sessionId: string, hostToken: string): Promise<{ ok: boolean; error?: string }>;
  end(sessionId: string, hostToken: string): Promise<{ ok: boolean }>;
  onState(cb: (s: SessionSnapshot) => void): () => void;
  onEvent(name: SessionEvent, cb: () => void): () => void;
  onConnection(cb: (connected: boolean) => void): () => void;
}

// ---------------------------------------------------------------- Socket.IO
class SocketTransport implements Transport {
  mode = 'live' as const;
  private sock: Socket;
  private attachment: { sessionId: string; token: string } | null = null;
  private stateCbs = new Set<(s: SessionSnapshot) => void>();
  private connectionCbs = new Set<(connected: boolean) => void>();
  private eventCbs: Record<SessionEvent, Set<() => void>> = {
    revealed: new Set(), rerun: new Set(), 'session-ended': new Set(), 'session-expired': new Set(), removed: new Set(),
  };
  private ready = false;

  constructor(sock: Socket) {
    this.sock = sock;
    this.sock.on('connect', () => {
      if (this.attachment) {
        this.call<{ state?: SessionSnapshot } & OperationError>('attach', this.attachment)
          .then((res) => {
            if (res.state) {
              this.stateCbs.forEach((cb) => cb(res.state as SessionSnapshot));
              this.setReady(true);
            } else {
              this.setReady(false);
              const event: SessionEvent | null = res.errorCode === 'expired' ? 'session-expired'
                : res.errorCode === 'ended' ? 'session-ended'
                  : res.errorCode === 'not-found' || res.errorCode === 'access-required' ? 'removed' : null;
              if (event) this.eventCbs[event].forEach((cb) => cb());
            }
          });
      } else this.setReady(false);
    });
    this.sock.on('disconnect', () => {
      this.setReady(false);
    });
  }

  private setReady(ready: boolean) {
    if (this.ready === ready) return;
    this.ready = ready;
    this.connectionCbs.forEach((cb) => cb(ready));
  }

  private call<T>(event: string, payload: unknown): Promise<T> {
    return new Promise((resolve) => {
      this.sock.timeout(5000).emit(event, payload, (err: unknown, res: T) => {
        resolve(err ? ({ error: 'Request timed out', errorCode: 'timeout' } as T) : res);
      });
    });
  }

  private async request<T extends OperationError>(endpoint: string, init: RequestInit): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8_000);
    try {
      const response = await fetch(endpoint, { ...init, signal: controller.signal });
      const data = await response.json().catch(() => null) as T | null;
      if (data) return data;
      return {
        error: `Request failed (${response.status})`,
        errorCode: response.status >= 500 ? 'unavailable' : 'unknown',
      } as T;
    } catch (error) {
      return {
        error: error instanceof DOMException && error.name === 'AbortError'
          ? 'Request timed out' : 'Server unavailable',
        errorCode: error instanceof DOMException && error.name === 'AbortError'
          ? 'timeout' : 'unavailable',
      } as T;
    } finally {
      clearTimeout(timer);
    }
  }

  private async mutate<T extends OperationError>(event: string, payload: object, endpoint: string): Promise<T> {
    const body = { ...payload, requestId: crypto.randomUUID() };
    if (this.sock.connected) {
      const socketResult = await this.call<T>(event, body);
      if (socketResult.errorCode !== 'timeout') return socketResult;
    }
    return this.request<T>(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  async create(input: CreateInput) {
    const result = await this.mutate<CreateResult & OperationError>('create', input, '/api/sessions');
    if (result.sessionId && result.participantToken) {
      this.attachment = { sessionId: result.sessionId, token: result.participantToken };
      if (this.sock.connected) {
        const attached = await this.call<{ state?: SessionSnapshot } & OperationError>('attach', this.attachment);
        if (attached.state) result.state = attached.state;
        this.setReady(!!attached.state);
      } else this.setReady(false);
    }
    return result;
  }
  async join(input: { sessionId?: string; code?: string; nickname: string; color: number }) {
    const result = await this.mutate<JoinResult>('join', input, '/api/sessions/join');
    if (result.state && result.participantToken) {
      this.attachment = { sessionId: result.state.id, token: result.participantToken };
      if (this.sock.connected) {
        const attached = await this.call<{ state?: SessionSnapshot } & OperationError>('attach', this.attachment);
        if (attached.state) result.state = attached.state;
        this.setReady(!!attached.state);
      } else this.setReady(false);
    }
    return result;
  }
  invite(idOrCode: string) {
    return this.request<{ invite?: InviteSnapshot } & OperationError>(
      `/api/sessions/${encodeURIComponent(idOrCode)}`,
      {},
    );
  }
  async attach(sessionId: string, token: string) {
    const changed = this.attachment?.sessionId !== sessionId || this.attachment.token !== token;
    this.attachment = { sessionId, token };
    if (changed) this.setReady(false);
    const result = await this.call<{ state?: SessionSnapshot; error?: string }>('attach', { sessionId, token });
    this.setReady(!!result.state);
    return result;
  }
  async fetch(sessionId: string, token: string) {
    const data = await this.request<{ state?: SessionSnapshot } & OperationError>(
      `/api/sessions/${encodeURIComponent(sessionId)}/state`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    return data;
  }
  async submit(sessionId: string, token: string, prefs: Prefs) {
    const result = await this.mutate<{ ok: boolean; state?: SessionSnapshot; error?: string }>(
      'submit', { sessionId, token, prefs }, `/api/sessions/${encodeURIComponent(sessionId)}/submit`,
    );
    if (result.state) this.stateCbs.forEach((cb) => cb(result.state!));
    return result;
  }
  async leave(sessionId: string, token: string) {
    const result = await this.mutate<{ ok: boolean; error?: string }>(
      'leave', { sessionId, token }, `/api/sessions/${encodeURIComponent(sessionId)}/leave`,
    );
    if (result.ok) {
      clearSessionStorage(sessionId);
      this.eventCbs.removed.forEach((cb) => cb());
    }
    return result;
  }
  removeParticipant(sessionId: string, hostToken: string, participantId: string) {
    return this.mutate<{ ok: boolean; error?: string }>(
      'remove-participant', { hostToken, participantId },
      `/api/sessions/${encodeURIComponent(sessionId)}/participants/${encodeURIComponent(participantId)}/remove`,
    );
  }
  reveal(sessionId: string, hostToken: string) {
    return this.mutate<{ ok: boolean; error?: string }>(
      'reveal', { hostToken }, `/api/sessions/${encodeURIComponent(sessionId)}/reveal`,
    );
  }
  rerun(sessionId: string, hostToken: string) {
    return this.mutate<{ ok: boolean; error?: string }>(
      'rerun', { hostToken }, `/api/sessions/${encodeURIComponent(sessionId)}/rerun`,
    );
  }
  async end(sessionId: string, hostToken: string) {
    const result = await this.mutate<{ ok: boolean; error?: string }>(
      'end', { hostToken }, `/api/sessions/${encodeURIComponent(sessionId)}/end`,
    );
    if (result.ok) clearSessionStorage(sessionId);
    return { ok: result.ok };
  }
  onState(cb: (s: SessionSnapshot) => void) {
    this.stateCbs.add(cb);
    this.sock.on('state', cb);
    return () => {
      this.stateCbs.delete(cb);
      this.sock.off('state', cb);
    };
  }
  onEvent(name: SessionEvent, cb: () => void) {
    this.eventCbs[name].add(cb);
    this.sock.on(name, cb);
    return () => {
      this.eventCbs[name].delete(cb);
      this.sock.off(name, cb);
    };
  }
  onConnection(cb: (connected: boolean) => void) {
    this.connectionCbs.add(cb);
    cb(this.ready);
    return () => this.connectionCbs.delete(cb);
  }
}

// ---------------------------------------------------------------- Local mode
const LS_SESSIONS = 'tablevote:session:';
const LS_CODES = 'tablevote:codes';
const LS_TERMINALS = 'tablevote:terminals';
const MAX_RERUNS = 2;

type LocalTerminalReason = 'ended' | 'expired';
type LocalTerminalReference = { reason: LocalTerminalReason; removeAt: number };

function localTerminalError(reference: string): OperationError | null {
  try {
    const terminals = JSON.parse(localStorage.getItem(LS_TERMINALS) ?? '{}') as Record<string, LocalTerminalReference>;
    const terminal = terminals[reference.toUpperCase()] ?? terminals[reference];
    if (!terminal) return null;
    if (terminal.removeAt <= Date.now()) {
      for (const [key, value] of Object.entries(terminals)) {
        if (value.removeAt <= Date.now()) delete terminals[key];
      }
      localStorage.setItem(LS_TERMINALS, JSON.stringify(terminals));
      return null;
    }
    return {
      error: terminal.reason === 'expired' ? 'Session expired' : 'Session ended',
      errorCode: terminal.reason,
    };
  } catch {
    return null;
  }
}

function rememberLocalTerminal(session: Session, reason: LocalTerminalReason): void {
  try {
    const terminals = JSON.parse(localStorage.getItem(LS_TERMINALS) ?? '{}') as Record<string, LocalTerminalReference>;
    const terminal = { reason, removeAt: Date.now() + SESSION_TTL_MS };
    terminals[session.id] = terminal;
    terminals[session.code] = terminal;
    localStorage.setItem(LS_TERMINALS, JSON.stringify(terminals));
  } catch { /* local demo storage is best-effort */ }
}

function rememberExpiredLocalReference(reference: string): void {
  const linked = localStorage.getItem(`tablevote:idref:${reference}`);
  for (const candidate of [reference, linked].filter((value): value is string => !!value)) {
    try {
      const raw = localStorage.getItem(LS_SESSIONS + candidate);
      if (raw) rememberLocalTerminal(JSON.parse(raw) as Session, 'expired');
    } catch { /* ignore malformed development storage */ }
  }
}

function rid(bytes = 16): string {
  const a = new Uint8Array(bytes);
  crypto.getRandomValues(a);
  return btoa(String.fromCharCode(...a)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}
function makeCode(existing: Record<string, string>): string {
  const alpha = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  while (true) {
    const code = Array.from(crypto.getRandomValues(new Uint8Array(5))).map((b) => alpha[b % alpha.length]).join('');
    if (!existing[code]) return code;
  }
}

class LocalTransport implements Transport {
  mode = 'local' as const;
  private bc = new BroadcastChannel('tablevote');
  private stateCbs = new Set<(s: SessionSnapshot) => void>();
  private eventCbs: Record<SessionEvent, Set<() => void>> = {
    revealed: new Set(), rerun: new Set(), 'session-ended': new Set(), 'session-expired': new Set(), removed: new Set(),
  };
  private currentId: string | null = null;
  private currentToken: string | null = null;

  constructor() {
    this.bc.onmessage = (ev: MessageEvent) => {
      const msg = ev.data as { kind: string; sessionId?: string; participantId?: string };
      if (msg.sessionId !== this.currentId) return;
      if (msg.kind === 'state-changed') {
        const session = this.load(msg.sessionId ?? '');
        if (session) this.emitCurrent(session);
      }
      if (msg.kind === 'event-revealed') this.eventCbs.revealed.forEach((cb) => cb());
      if (msg.kind === 'event-rerun') this.eventCbs.rerun.forEach((cb) => cb());
      if (msg.kind === 'event-session-ended') this.eventCbs['session-ended'].forEach((cb) => cb());
      if (msg.kind === 'event-session-expired') this.eventCbs['session-expired'].forEach((cb) => cb());
      if (msg.kind === 'event-removed') {
        const session = this.load(msg.sessionId ?? '');
        const viewer = session ? this.viewer(session) : null;
        if (!viewer || viewer.id === msg.participantId) this.eventCbs.removed.forEach((cb) => cb());
      }
    };
  }

  private load(idOrCode: string): Session | null {
    let id = idOrCode;
    try {
      const codes = JSON.parse(localStorage.getItem(LS_CODES) ?? '{}') as Record<string, string>;
      if (codes[idOrCode.toUpperCase()]) id = codes[idOrCode.toUpperCase()];
      const raw = localStorage.getItem(LS_SESSIONS + id);
      if (!raw) return null;
      const s = JSON.parse(raw) as Session;
      if (Date.now() - s.createdAt >= SESSION_TTL_MS) {
        rememberLocalTerminal(s, 'expired');
        clearSessionStorage(s.id, s.code);
        delete codes[s.code];
        localStorage.setItem(LS_CODES, JSON.stringify(codes));
        this.bc.postMessage({ kind: 'event-session-expired', sessionId: s.id });
        if (this.currentId === s.id) this.eventCbs['session-expired'].forEach((cb) => cb());
        return null;
      }
      return s;
    } catch { return null; }
  }
  private save(s: Session, broadcast = true) {
    localStorage.setItem(LS_SESSIONS + s.id, JSON.stringify(s));
    const codes = JSON.parse(localStorage.getItem(LS_CODES) ?? '{}') as Record<string, string>;
    codes[s.code] = s.id;
    localStorage.setItem(LS_CODES, JSON.stringify(codes));
    if (broadcast) {
      this.bc.postMessage({ kind: 'state-changed', sessionId: s.id });
      if (this.currentId === s.id) this.emitCurrent(s);
    }
  }
  private viewer(s: Session): Participant | null {
    return this.currentToken ? s.participants.find((p) => p.token === this.currentToken) ?? null : null;
  }
  private emitCurrent(s: Session) {
    const viewer = this.viewer(s);
    if (!viewer) return;
    const state = snapshot(s, viewer);
    this.stateCbs.forEach((cb) => cb(state));
  }

  async create(input: CreateInput): Promise<CreateResult> {
    const codes = JSON.parse(localStorage.getItem(LS_CODES) ?? '{}') as Record<string, string>;
    const participantToken = rid();
    const participantId = rid(12);
    const host: Participant = {
      id: participantId, token: participantToken, nickname: input.nickname || 'Host', color: input.color,
      prefs: null, submittedAt: null, isHost: true,
    };
    const session: Session = {
      id: rid(), code: makeCode(codes), hostToken: rid(),
      participants: [host],
      phase: 'collecting', result: null, excludedIds: [], rerunsUsed: 0,
      allowReruns: input.allowReruns, createdAt: Date.now(),
      center: input.center, areaLabel: input.areaLabel, radiusKm: input.radiusKm,
      shareHostNickname: input.shareHostNickname && !!input.nickname,
    };
    this.currentId = session.id;
    this.currentToken = participantToken;
    this.save(session, false);
    return {
      sessionId: session.id, code: session.code, hostToken: session.hostToken,
      participantToken, participantId, state: snapshot(session, host),
    };
  }

  async join(input: { sessionId?: string; code?: string; nickname: string; color: number }): Promise<JoinResult> {
    const s = this.load(input.sessionId ?? input.code ?? '');
    if (!s) return {
      participantToken: '', participantId: '', state: null as unknown as SessionSnapshot,
      ...(localTerminalError(input.sessionId ?? input.code ?? '') ?? { error: "Hmm, that code doesn't exist", errorCode: 'not-found' as const }),
    };
    if (s.phase !== 'collecting') return { participantToken: '', participantId: '', state: null as unknown as SessionSnapshot, error: 'Voting is closed' };
    if (s.participants.length >= 12) return { participantToken: '', participantId: '', state: null as unknown as SessionSnapshot, error: "That table's full (12 max)" };
    const participantToken = rid();
    const participantId = rid(12);
    const participant: Participant = {
      id: participantId, token: participantToken, nickname: input.nickname, color: input.color,
      prefs: null, submittedAt: null, isHost: false,
    };
    s.participants.push(participant);
    this.currentId = s.id;
    this.currentToken = participantToken;
    this.save(s);
    return { participantToken, participantId, state: snapshot(s, participant) };
  }

  async invite(idOrCode: string) {
    const session = this.load(idOrCode);
    return session
      ? { invite: inviteSnapshot(session) }
      : (localTerminalError(idOrCode) ?? { error: 'Session not found', errorCode: 'not-found' as const });
  }

  async attach(sessionId: string, token: string) {
    const s = this.load(sessionId);
    const participant = s?.participants.find((p) => p.token === token);
    if (!s || !participant) return { error: 'not found' };
    this.currentId = s.id;
    this.currentToken = token;
    return { state: snapshot(s, participant) };
  }

  async fetch(sessionId: string, token: string) {
    const s = this.load(sessionId);
    const participant = s?.participants.find((p) => p.token === token);
    if (!s || !participant) return { error: 'not found' };
    this.currentId = s.id;
    this.currentToken = token;
    return { state: snapshot(s, participant) };
  }

  async submit(sessionId: string, token: string, prefs: Prefs) {
    const s = this.load(sessionId);
    const p = s?.participants.find((x) => x.token === token);
    if (!s || !p || s.phase !== 'collecting') return { ok: false, error: 'Invalid token or voting closed' };
    p.prefs = prefs;
    p.submittedAt = Date.now();
    this.save(s);
    return { ok: true };
  }

  async leave(sessionId: string, token: string) {
    const s = this.load(sessionId);
    const index = s?.participants.findIndex((participant) => participant.token === token) ?? -1;
    if (!s || index < 0) return { ok: false, error: 'Invalid participant token' };
    if (s.phase !== 'collecting') return { ok: false, error: 'Voting is closed' };
    if (s.participants[index].isHost) return { ok: false, error: 'The host must end the session' };
    const [participant] = s.participants.splice(index, 1);
    this.save(s);
    this.bc.postMessage({ kind: 'event-removed', sessionId: s.id, participantId: participant.id });
    this.eventCbs.removed.forEach((cb) => cb());
    return { ok: true };
  }

  async removeParticipant(sessionId: string, hostToken: string, participantId: string) {
    const s = this.load(sessionId);
    if (!s || s.hostToken !== hostToken) return { ok: false, error: 'Forbidden' };
    if (s.phase !== 'collecting') return { ok: false, error: 'Voting is closed' };
    const index = s.participants.findIndex((participant) => participant.id === participantId);
    if (index < 0) return { ok: false, error: 'Participant not found' };
    if (s.participants[index].isHost) return { ok: false, error: 'The host cannot be removed' };
    s.participants.splice(index, 1);
    this.save(s);
    this.bc.postMessage({ kind: 'event-removed', sessionId: s.id, participantId });
    return { ok: true };
  }

  async reveal(sessionId: string, hostToken: string) {
    const s = this.load(sessionId);
    if (!s || s.hostToken !== hostToken) return { ok: false, error: 'Forbidden' };
    const submitted = s.participants.filter((p) => p.prefs).length;
    if ((s.phase === 'revealed' || s.phase === 'blocked-no-match') && s.result) return { ok: true };
    if (s.phase !== 'collecting') return { ok: false, error: 'Voting is closed' };
    if (submitted < 2) return { ok: false, error: 'Need at least 2 submitted votes' };
    s.phase = 'locking';
    this.save(s);
    try {
      s.result = computeResult(s.id, s.participants, RESTAURANTS, s.excludedIds, s.rerunsUsed + 1,
        s.excludedIds.map((id) => RESTAURANTS.find((r) => r.id === id)?.name ?? id));
      s.phase = s.result.kind === 'match' ? 'revealed' : 'blocked-no-match';
    } catch (error) {
      s.phase = 'collecting';
      this.save(s);
      throw error;
    }
    this.save(s);
    this.bc.postMessage({ kind: 'event-revealed', sessionId: s.id });
    this.eventCbs.revealed.forEach((cb) => cb());
    return { ok: true };
  }

  async rerun(sessionId: string, hostToken: string) {
    const s = this.load(sessionId);
    if (!s || s.hostToken !== hostToken) return { ok: false, error: 'Forbidden' };
    if (s.phase !== 'revealed') return { ok: false, error: 'Voting is closed' };
    if (!s.allowReruns) return { ok: false, error: 'Re-runs disabled' };
    if (s.rerunsUsed >= MAX_RERUNS) return { ok: false, error: 'No re-runs left' };
    if (!s.result || s.result.kind !== 'match') return { ok: false, error: 'No matched result to re-run' };
    s.phase = 'locking';
    this.save(s);
    const winnerId = s.result.winner.restaurant.id;
    s.excludedIds.push(winnerId);
    s.rerunsUsed += 1;
    try {
      s.result = computeResult(s.id, s.participants, RESTAURANTS, s.excludedIds, s.rerunsUsed + 1,
        s.excludedIds.map((id) => RESTAURANTS.find((r) => r.id === id)?.name ?? id));
      s.phase = s.result.kind === 'match' ? 'revealed' : 'blocked-no-match';
    } catch (error) {
      s.excludedIds.pop();
      s.rerunsUsed -= 1;
      s.phase = 'revealed';
      this.save(s);
      throw error;
    }
    this.save(s);
    this.bc.postMessage({ kind: 'event-rerun', sessionId: s.id });
    this.eventCbs.rerun.forEach((cb) => cb());
    return { ok: true };
  }

  async end(sessionId: string, hostToken: string) {
    const s = this.load(sessionId);
    if (!s || s.hostToken !== hostToken) return { ok: false };
    rememberLocalTerminal(s, 'ended');
    localStorage.removeItem(LS_SESSIONS + s.id);
    const codes = JSON.parse(localStorage.getItem(LS_CODES) ?? '{}') as Record<string, string>;
    delete codes[s.code];
    localStorage.setItem(LS_CODES, JSON.stringify(codes));
    clearSessionStorage(s.id, s.code);
    this.bc.postMessage({ kind: 'event-session-ended', sessionId: s.id });
    this.eventCbs['session-ended'].forEach((cb) => cb());
    return { ok: true };
  }

  onState(cb: (s: SessionSnapshot) => void) {
    this.stateCbs.add(cb);
    return () => this.stateCbs.delete(cb);
  }
  onEvent(name: SessionEvent, cb: () => void) {
    this.eventCbs[name].add(cb);
    return () => this.eventCbs[name].delete(cb);
  }
  onConnection(cb: (connected: boolean) => void) {
    cb(true);
    return () => {};
  }
}

// ---------------------------------------------------------------- detection
let cached: Promise<Transport> | null = null;

export function getTransport(): Promise<Transport> {
  if (import.meta.env.DEV && import.meta.env.VITE_TABLEVOTE_LOCAL_MODE === 'true') {
    return Promise.resolve(new LocalTransport());
  }
  if (!cached) {
    cached = new Promise((resolve, reject) => {
      const sock = io({ timeout: 1500, reconnection: true });
      const timer = setTimeout(() => {
        sock.close();
        reject(new Error('Server unavailable'));
      }, 1800);
      const connected = () => {
        clearTimeout(timer);
        sock.off('connect_error', failed);
        resolve(new SocketTransport(sock));
      };
      const failed = () => {
        clearTimeout(timer);
        sock.off('connect', connected);
        sock.close();
        reject(new Error('Server unavailable'));
      };
      sock.once('connect', connected);
      sock.once('connect_error', failed);
    });
    cached.catch(() => { cached = null; });
  }
  return cached;
}

// Client identity per session (localStorage).
export interface Identity {
  participantId: string;
  token: string;
  nickname: string;
  color: number;
  isHost: boolean;
  expiresAt: number;
  hostToken?: string;
}
export function saveIdentity(sessionId: string, id: Identity) {
  localStorage.setItem(`tablevote:me:${sessionId}`, JSON.stringify(id));
}
export function linkSessionReferences(code: string, sessionId: string) {
  localStorage.setItem(`tablevote:idref:${code}`, sessionId);
}
export function clearSessionStorage(...references: string[]) {
  const targets = new Set(references.filter(Boolean));
  for (let index = 0; index < localStorage.length; index++) {
    const key = localStorage.key(index);
    if (!key?.startsWith('tablevote:idref:')) continue;
    const reference = key.slice('tablevote:idref:'.length);
    const resolved = localStorage.getItem(key);
    if (targets.has(reference) || (resolved && targets.has(resolved))) {
      targets.add(reference);
      if (resolved) targets.add(resolved);
    }
  }
  for (const target of targets) {
    localStorage.removeItem(`tablevote:me:${target}`);
    localStorage.removeItem(`tablevote:prefs:${target}`);
    localStorage.removeItem(`tablevote:idref:${target}`);
    localStorage.removeItem(LS_SESSIONS + target);
  }
  try {
    const codes = JSON.parse(localStorage.getItem(LS_CODES) ?? '{}') as Record<string, string>;
    for (const [code, id] of Object.entries(codes)) {
      if (targets.has(code) || targets.has(id)) delete codes[code];
    }
    localStorage.setItem(LS_CODES, JSON.stringify(codes));
  } catch { /* ignore malformed development storage */ }
}
export function loadIdentity(sessionId: string): Identity | null {
  return loadIdentityState(sessionId).identity;
}
export function loadIdentityState(sessionId: string): { identity: Identity | null; expired: boolean } {
  try {
    const raw = localStorage.getItem(`tablevote:me:${sessionId}`);
    if (!raw) {
      const marker = `tablevote:expired:${sessionId}`;
      const expired = typeof sessionStorage !== 'undefined' && sessionStorage.getItem(marker) === 'true';
      if (expired) sessionStorage.removeItem(marker);
      return { identity: null, expired };
    }
    const identity = JSON.parse(raw) as Identity;
    if (!identity.expiresAt || identity.expiresAt <= Date.now()) {
      rememberExpiredLocalReference(sessionId);
      clearSessionStorage(sessionId);
      return { identity: null, expired: true };
    }
    return { identity, expired: false };
  } catch { return { identity: null, expired: false }; }
}
export function sweepExpiredSessionStorage() {
  const staleReferences: string[] = [];
  const staleDrafts: string[] = [];
  for (let index = 0; index < localStorage.length; index++) {
    const key = localStorage.key(index);
    if (!key) continue;
    if (key.startsWith('tablevote:me:')) {
      const reference = key.slice('tablevote:me:'.length);
      try {
        const identity = JSON.parse(localStorage.getItem(key) ?? '') as Identity;
        if (!identity.expiresAt || identity.expiresAt <= Date.now()) staleReferences.push(reference);
      } catch { staleReferences.push(reference); }
    }
    if (key.startsWith('tablevote:prefs:')) {
      try {
        const draft = JSON.parse(localStorage.getItem(key) ?? '') as { expiresAt?: number };
        if (!draft.expiresAt || draft.expiresAt <= Date.now()) staleDrafts.push(key);
      } catch { staleDrafts.push(key); }
    }
  }
  staleReferences.forEach((reference) => {
    if (typeof sessionStorage !== 'undefined') sessionStorage.setItem(`tablevote:expired:${reference}`, 'true');
    const linked = localStorage.getItem(`tablevote:idref:${reference}`);
    if (linked && typeof sessionStorage !== 'undefined') sessionStorage.setItem(`tablevote:expired:${linked}`, 'true');
    rememberExpiredLocalReference(reference);
    clearSessionStorage(reference);
  });
  staleDrafts.forEach((key) => localStorage.removeItem(key));
}
