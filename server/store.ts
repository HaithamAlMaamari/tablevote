// In-memory session store with 24h TTL sweeper.
import { randomBytes } from 'node:crypto';
import type { Participant, Prefs, Session, VoteResult } from '../shared/types';
import { SESSION_TTL_MS, snapshot } from '../shared/types';
import { computeResult } from '../shared/scoring';
import restaurants from '../shared/restaurants.json';
import type { Restaurant } from '../shared/types';
import { normalizeDemoRestaurants, type DemoRestaurantInput } from '../shared/catalog';

const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no 0/O/1/I/L
export const STORE_LIMITS = Object.freeze({
  participantsPerSession: 12,
  rerunsPerSession: 2,
  activeSessions: 10_000,
  terminalSessions: 10_000,
});

const sessions = new Map<string, Session>();
const codeIndex = new Map<string, string>();
export type TerminalReason = 'ended' | 'expired';
type TerminalReference = { code: string; reason: TerminalReason; removeAt: number };
const terminalSessions = new Map<string, TerminalReference>();
const terminalCodeIndex = new Map<string, string>();
const expirationListeners = new Set<(session: Session) => void>();

export const RESTAURANTS: Restaurant[] = normalizeDemoRestaurants(restaurants as DemoRestaurantInput[]);

export function token(bytes = 16): string {
  return randomBytes(bytes).toString('base64url');
}

function makeCode(): string {
  while (true) {
    const code = Array.from(randomBytes(5)).map((b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
    if (!codeIndex.has(code) && !terminalCodeIndex.has(code)) return code;
  }
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

export function createSession(o: CreateOpts): { session: Session; participantToken: string; participantId: string } {
  if (sessions.size >= STORE_LIMITS.activeSessions) throw new Error('Session capacity reached');
  const id = token(16);
  const code = makeCode();
  const participantToken = token(16);
  const host: Participant = {
    id: token(12),
    token: participantToken,
    nickname: o.nickname || 'Host',
    color: o.color,
    prefs: null,
    submittedAt: null,
    isHost: true,
  };
  const session: Session = {
    id, code, hostToken: token(16), participants: [host],
    phase: 'collecting', result: null, excludedIds: [], rerunsUsed: 0,
    allowReruns: o.allowReruns, createdAt: Date.now(),
    center: o.center, areaLabel: o.areaLabel, radiusKm: o.radiusKm,
    shareHostNickname: o.shareHostNickname === true && !!o.nickname,
  };
  sessions.set(id, session);
  codeIndex.set(code, id);
  return { session, participantToken, participantId: host.id };
}

export function getByIdOrCode(idOrCode: string): Session | undefined {
  const byCode = codeIndex.get(idOrCode.toUpperCase());
  const session = byCode ? sessions.get(byCode) : sessions.get(idOrCode);
  if (session && Date.now() - session.createdAt >= SESSION_TTL_MS) {
    deleteSession(session, 'expired');
    return undefined;
  }
  return session;
}

export function getTerminalReason(idOrCode: string): TerminalReason | undefined {
  const id = terminalCodeIndex.get(idOrCode.toUpperCase()) ?? idOrCode;
  const reference = terminalSessions.get(id);
  if (!reference) return undefined;
  if (reference.removeAt <= Date.now()) {
    terminalSessions.delete(id);
    terminalCodeIndex.delete(reference.code);
    return undefined;
  }
  return reference.reason;
}

export function onSessionExpired(listener: (session: Session) => void): () => void {
  expirationListeners.add(listener);
  return () => expirationListeners.delete(listener);
}

export function joinSession(s: Session, nickname: string, color: number): { participantToken: string; participantId: string } | { error: string } {
  if (s.phase !== 'collecting') return { error: 'Voting is closed' };
  if (s.participants.length >= STORE_LIMITS.participantsPerSession) return { error: "That table's full (12 max)" };
  const participantToken = token(16);
  const participantId = token(12);
  s.participants.push({
    id: participantId, token: participantToken, nickname, color, prefs: null, submittedAt: null, isHost: false,
  });
  return { participantToken, participantId };
}

export function findParticipant(s: Session, participantToken: string): Participant | undefined {
  return s.participants.find((p) => p.token === participantToken);
}

export function submitPrefs(s: Session, participantToken: string, prefs: Prefs): boolean {
  const p = findParticipant(s, participantToken);
  if (!p || s.phase !== 'collecting') return false;
  p.prefs = prefs;
  p.submittedAt = Date.now();
  return true;
}

export function leaveSession(s: Session, participantToken: string): { ok: boolean; participantId?: string; error?: string } {
  if (s.phase !== 'collecting') return { ok: false, error: 'Voting is closed' };
  const index = s.participants.findIndex((participant) => participant.token === participantToken);
  if (index < 0) return { ok: false, error: 'Invalid participant token' };
  if (s.participants[index].isHost) return { ok: false, error: 'The host must end the session' };
  const [participant] = s.participants.splice(index, 1);
  return { ok: true, participantId: participant.id };
}

export function removeParticipant(
  s: Session,
  hostToken: string,
  participantId: string,
): { ok: boolean; error?: string } {
  if (s.hostToken !== hostToken) return { ok: false, error: 'Forbidden' };
  if (s.phase !== 'collecting') return { ok: false, error: 'Voting is closed' };
  const index = s.participants.findIndex((participant) => participant.id === participantId);
  if (index < 0) return { ok: false, error: 'Participant not found' };
  if (s.participants[index].isHost) return { ok: false, error: 'The host cannot be removed' };
  s.participants.splice(index, 1);
  return { ok: true };
}

export function reveal(
  s: Session,
  hostToken: string,
  onLocked?: () => void,
): { ok: boolean; changed?: boolean; error?: string } {
  if (s.hostToken !== hostToken) return { ok: false, error: 'Forbidden' };
  if ((s.phase === 'revealed' || s.phase === 'blocked-no-match') && s.result) return { ok: true, changed: false };
  if (s.phase !== 'collecting') return { ok: false, error: 'Voting is closed' };
  const submitted = s.participants.filter((p) => p.prefs).length;
  if (submitted < 2) return { ok: false, error: 'Need at least 2 submitted votes' };
  s.phase = 'locking';
  onLocked?.();
  try {
    applyResult(s, computeResult(s.id, s.participants, RESTAURANTS, s.excludedIds, s.rerunsUsed + 1,
      s.excludedIds.map((id) => RESTAURANTS.find((r) => r.id === id)?.name ?? id)));
  } catch (error) {
    s.phase = 'collecting';
    throw error;
  }
  return { ok: true, changed: true };
}

function applyResult(s: Session, result: VoteResult): void {
  s.result = result;
  s.phase = result.kind === 'match' ? 'revealed' : 'blocked-no-match';
}

export function rerun(
  s: Session,
  hostToken: string,
  onLocked?: () => void,
): { ok: boolean; error?: string } {
  if (s.hostToken !== hostToken) return { ok: false, error: 'Forbidden' };
  if (s.phase !== 'revealed') return { ok: false, error: 'Voting is closed' };
  if (!s.allowReruns) return { ok: false, error: 'Re-runs disabled' };
  if (s.rerunsUsed >= STORE_LIMITS.rerunsPerSession) return { ok: false, error: 'No re-runs left' };
  if (!s.result || s.result.kind !== 'match') return { ok: false, error: 'No matched result to re-run' };
  s.phase = 'locking';
  onLocked?.();
  const winnerId = s.result.winner.restaurant.id;
  s.excludedIds.push(winnerId);
  s.rerunsUsed += 1;
  try {
    applyResult(s, computeResult(s.id, s.participants, RESTAURANTS, s.excludedIds, s.rerunsUsed + 1,
      s.excludedIds.map((id) => RESTAURANTS.find((r) => r.id === id)?.name ?? id)));
  } catch (error) {
    s.excludedIds.pop();
    s.rerunsUsed -= 1;
    s.phase = 'revealed';
    throw error;
  }
  return { ok: true };
}

export function endSession(idOrCode: string, hostToken: string): boolean {
  const s = getByIdOrCode(idOrCode);
  if (!s || s.hostToken !== hostToken) return false;
  deleteSession(s, 'ended');
  return true;
}

function deleteSession(s: Session, reason: TerminalReason): void {
  sessions.delete(s.id);
  codeIndex.delete(s.code);
  while (terminalSessions.size >= STORE_LIMITS.terminalSessions) {
    const oldestId = terminalSessions.keys().next().value;
    if (!oldestId) break;
    const oldest = terminalSessions.get(oldestId);
    terminalSessions.delete(oldestId);
    if (oldest) terminalCodeIndex.delete(oldest.code);
  }
  const terminal = { code: s.code, reason, removeAt: Date.now() + SESSION_TTL_MS };
  terminalSessions.set(s.id, terminal);
  terminalCodeIndex.set(s.code, s.id);
  if (reason === 'expired') expirationListeners.forEach((listener) => listener(s));
}

export function getStoreResourceCounts(): { activeSessions: number; terminalSessions: number } {
  return { activeSessions: sessions.size, terminalSessions: terminalSessions.size };
}

export { snapshot };

// TTL sweeper
setInterval(() => {
  const now = Date.now();
  for (const s of sessions.values()) {
    if (now - s.createdAt >= SESSION_TTL_MS) deleteSession(s, 'expired');
  }
  for (const [id, terminal] of terminalSessions) {
    if (terminal.removeAt <= now) {
      terminalSessions.delete(id);
      terminalCodeIndex.delete(terminal.code);
    }
  }
}, 60 * 60 * 1000).unref();
