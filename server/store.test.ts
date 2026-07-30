import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Prefs } from '../shared/types';
import { SESSION_TTL_MS } from '../shared/policy';
import {
  createSession,
  createStoreState,
  endSession,
  getByIdOrCode,
  getStoreResourceCounts,
  getTerminalReason,
  joinSession,
  leaveSession,
  removeParticipant,
  rerun,
  reveal,
  SessionStore,
  STORE_LIMITS,
  submitPrefs,
  type StoreScheduler,
} from './store';

const create = () =>
  createSession({
    areaLabel: 'Qurum',
    center: { lat: 23.5, lng: 58.3 },
    radiusKm: 3,
    nickname: 'Host',
    color: 0,
    allowReruns: true,
  });
const prefs: Prefs = {
  cuisines: { Japanese: 'like' },
  budget: 2,
  maxDistanceKm: 3,
  dietary: [],
};

class FakeScheduler implements StoreScheduler {
  private nextId = 0;
  private readonly timers = new Map<number, { callback: () => void; due: number }>();

  constructor(
    private readonly now: () => number,
    private readonly setNow: (value: number) => void,
  ) {}

  setTimeout(callback: () => void, delayMs: number) {
    const handle = { id: ++this.nextId, unref: () => undefined };
    this.timers.set(handle.id, { callback, due: this.now() + delayMs });
    return handle;
  }

  clearTimeout(handle: { unref?: () => void }): void {
    const id = (handle as { id?: number }).id;
    if (id) this.timers.delete(id);
  }

  advance(milliseconds: number): void {
    const target = this.now() + milliseconds;
    while (true) {
      const next = [...this.timers.entries()]
        .filter(([, timer]) => timer.due <= target)
        .sort((left, right) => left[1].due - right[1].due)[0];
      if (!next) break;
      this.timers.delete(next[0]);
      this.setNow(next[1].due);
      next[1].callback();
    }
    this.setNow(target);
  }

  get size(): number {
    return this.timers.size;
  }
}

describe('session expiry', () => {
  afterEach(() => vi.restoreAllMocks());

  it('expires exactly at the 24-hour boundary', () => {
    const startedAt = 1_700_000_000_000;
    vi.spyOn(Date, 'now').mockReturnValue(startedAt);
    const { session } = create();
    expect(getByIdOrCode(session.code)?.id).toBe(session.id);
    vi.spyOn(Date, 'now').mockReturnValue(startedAt + SESSION_TTL_MS);
    expect(getByIdOrCode(session.code)).toBeUndefined();
    expect(getByIdOrCode(session.id)).toBeUndefined();
    expect(getTerminalReason(session.code)).toBe('expired');
    expect(getTerminalReason(session.id)).toBe('expired');
  });

  it('retains only an ended reason after explicit deletion', () => {
    const { session } = create();
    expect(endSession(session.id, session.hostToken)).toBe(true);
    expect(getByIdOrCode(session.id)).toBeUndefined();
    expect(getTerminalReason(session.code)).toBe('ended');
  });

  it('bounds terminal reasons without splitting a retained session ID and code', () => {
    let first: { id: string; code: string } | undefined;
    let last: { id: string; code: string } | undefined;
    for (let index = 0; index <= STORE_LIMITS.terminalSessions; index++) {
      const { session } = create();
      if (index === 0) first = session;
      last = session;
      expect(endSession(session.id, session.hostToken)).toBe(true);
    }

    expect(getStoreResourceCounts().terminalSessions).toBe(STORE_LIMITS.terminalSessions);
    expect(getTerminalReason(first!.id)).toBeUndefined();
    expect(getTerminalReason(first!.code)).toBeUndefined();
    expect(getTerminalReason(last!.id)).toBe('ended');
    expect(getTerminalReason(last!.code)).toBe('ended');
  });

  it('passively expires at the exact deadline and notifies exactly once', () => {
    let now = 10_000;
    const scheduler = new FakeScheduler(
      () => now,
      (value) => {
        now = value;
      },
    );
    const store = new SessionStore({ clock: () => now, scheduler });
    const created = store.create({
      areaLabel: 'Qurum',
      center: { lat: 23.5, lng: 58.3 },
      radiusKm: 3,
      nickname: 'Host',
      color: 0,
      allowReruns: true,
    });
    if (!created.ok) throw new Error('Expected session creation');
    const expired: string[] = [];
    store.onExpired((session) => expired.push(session.id));

    scheduler.advance(SESSION_TTL_MS - 1);
    expect(store.state.sessions.has(created.value.session.id)).toBe(true);
    expect(expired).toEqual([]);
    scheduler.advance(1);
    expect(store.state.sessions.has(created.value.session.id)).toBe(false);
    expect(store.state.codeIndex.has(created.value.session.code)).toBe(false);
    expect(expired).toEqual([created.value.session.id]);
    expect(store.terminalReason(created.value.session.id)).toBe('expired');

    scheduler.advance(SESSION_TTL_MS);
    expect(store.resourceCounts()).toEqual({ activeSessions: 0, terminalSessions: 0 });
    expect(expired).toEqual([created.value.session.id]);
    store.close();
    expect(scheduler.size).toBe(0);
  });

  it('sweeps expired sessions before applying active capacity', () => {
    const now = SESSION_TTL_MS + 100;
    const state = createStoreState();
    const store = new SessionStore({ state, scheduler: null, clock: () => now });
    const seedStore = new SessionStore({ scheduler: null, clock: () => 0 });
    const seed = seedStore.create({
      areaLabel: 'Qurum',
      center: { lat: 23.5, lng: 58.3 },
      radiusKm: 3,
      nickname: 'Host',
      color: 0,
      allowReruns: true,
    });
    if (!seed.ok) throw new Error('Expected seed session');
    for (let index = 0; index < STORE_LIMITS.activeSessions; index++) {
      const id = `expired-${index}`;
      const code = `E${index}`;
      state.sessions.set(id, { ...seed.value.session, id, code, createdAt: 0 });
      state.codeIndex.set(code, id);
    }

    expect(
      store.create({
        areaLabel: 'Muttrah',
        center: { lat: 23.6, lng: 58.4 },
        radiusKm: 3,
        nickname: 'Host',
        color: 0,
        allowReruns: false,
      }).ok,
    ).toBe(true);
    expect(store.resourceCounts()).toEqual({
      activeSessions: 1,
      terminalSessions: STORE_LIMITS.terminalSessions,
    });
    seedStore.close();
    store.close();
  });
});

describe('collecting lifecycle', () => {
  it('defaults public host nickname sharing off and requires a supplied nickname', () => {
    expect(create().session.shareHostNickname).toBe(false);
    expect(
      createSession({
        areaLabel: 'Qurum',
        center: { lat: 23.5, lng: 58.3 },
        radiusKm: 3,
        nickname: 'Shared Host',
        color: 0,
        allowReruns: true,
        shareHostNickname: true,
      }).session.shareHostNickname,
    ).toBe(true);
    expect(
      createSession({
        areaLabel: 'Qurum',
        center: { lat: 23.5, lng: 58.3 },
        radiusKm: 3,
        nickname: '',
        color: 0,
        allowReruns: true,
        shareHostNickname: true,
      }).session.shareHostNickname,
    ).toBe(false);
  });

  it('lets a guest leave but requires the host to end the session', () => {
    const { session, participantToken: hostParticipantToken } = create();
    const guest = joinSession(session, 'Guest', 1);
    if ('error' in guest) throw new Error(guest.error);

    expect(leaveSession(session, hostParticipantToken)).toEqual({
      ok: false,
      error: 'The host must end the session',
    });
    expect(leaveSession(session, guest.participantToken)).toEqual({
      ok: true,
      participantId: guest.participantId,
    });
    expect(session.participants.map((participant) => participant.id)).not.toContain(guest.participantId);
    expect(leaveSession(session, guest.participantToken)).toEqual({
      ok: false,
      error: 'Invalid participant token',
    });
  });

  it('allows only the host capability to remove a non-host participant once', () => {
    const { session } = create();
    const guest = joinSession(session, 'Guest', 1);
    if ('error' in guest) throw new Error(guest.error);
    const host = session.participants.find((participant) => participant.isHost)!;

    expect(removeParticipant(session, 'wrong-token', guest.participantId)).toEqual({
      ok: false,
      error: 'Forbidden',
    });
    expect(removeParticipant(session, session.hostToken, host.id)).toEqual({
      ok: false,
      error: 'The host cannot be removed',
    });
    expect(removeParticipant(session, session.hostToken, guest.participantId)).toEqual({ ok: true });
    expect(removeParticipant(session, session.hostToken, guest.participantId)).toEqual({
      ok: false,
      error: 'Participant not found',
    });
  });

  it('locks every collecting mutation before reveal and rerun calculation', () => {
    const { session, participantToken: hostParticipantToken } = create();
    const guest = joinSession(session, 'Guest', 1);
    if ('error' in guest) throw new Error(guest.error);
    expect(submitPrefs(session, hostParticipantToken, prefs)).toBe(true);
    expect(submitPrefs(session, guest.participantToken, prefs)).toBe(true);

    expect(
      reveal(session, session.hostToken, () => {
        expect(session.phase).toBe('locking');
        expect(joinSession(session, 'Late', 2)).toEqual({ error: 'Voting is closed' });
        expect(submitPrefs(session, hostParticipantToken, prefs)).toBe(false);
        expect(leaveSession(session, guest.participantToken)).toEqual({ ok: false, error: 'Voting is closed' });
        expect(removeParticipant(session, session.hostToken, guest.participantId)).toEqual({
          ok: false,
          error: 'Voting is closed',
        });
      }),
    ).toEqual({ ok: true, changed: true });
    expect(session.phase).toBe('revealed');
    const firstResult = session.result;
    expect(reveal(session, session.hostToken)).toEqual({ ok: true, changed: false });
    expect(session.result).toBe(firstResult);

    expect(
      rerun(session, session.hostToken, () => {
        expect(session.phase).toBe('locking');
        expect(submitPrefs(session, hostParticipantToken, prefs)).toBe(false);
      }),
    ).toEqual({ ok: true });
    expect(['revealed', 'blocked-no-match']).toContain(session.phase);
  });
});
