import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Prefs } from '../shared/types';
import { SESSION_TTL_MS } from '../shared/policy';
import { createStoreState, SessionStore, STORE_LIMITS, type CreateOpts, type StoreScheduler } from './store';

let store: SessionStore;

beforeEach(() => {
  store = new SessionStore({ scheduler: null });
});

afterEach(() => {
  store.close();
  vi.restoreAllMocks();
});

const create = (overrides: Partial<CreateOpts> = {}) => {
  const result = store.create({
    areaLabel: 'Qurum',
    center: { lat: 23.5, lng: 58.3 },
    radiusKm: 3,
    nickname: 'Host',
    color: 0,
    allowReruns: true,
    ...overrides,
  });
  if (!result.ok) throw new Error(result.failure.message);
  return result.value;
};
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
  it('expires exactly at the 24-hour boundary', () => {
    const startedAt = 1_700_000_000_000;
    vi.spyOn(Date, 'now').mockReturnValue(startedAt);
    const { session } = create();
    expect(store.get(session.code)?.id).toBe(session.id);
    vi.spyOn(Date, 'now').mockReturnValue(startedAt + SESSION_TTL_MS);
    expect(store.get(session.code)).toBeUndefined();
    expect(store.get(session.id)).toBeUndefined();
    expect(store.terminalReason(session.code)).toBe('expired');
    expect(store.terminalReason(session.id)).toBe('expired');
  });

  it('retains only an ended reason after explicit deletion', () => {
    const { session } = create();
    expect(store.end(session.id, session.hostToken).ok).toBe(true);
    expect(store.get(session.id)).toBeUndefined();
    expect(store.terminalReason(session.code)).toBe('ended');
  });

  it('bounds terminal reasons without splitting a retained session ID and code', () => {
    let first: { id: string; code: string } | undefined;
    let last: { id: string; code: string } | undefined;
    for (let index = 0; index <= STORE_LIMITS.terminalSessions; index++) {
      const { session } = create();
      if (index === 0) first = session;
      last = session;
      expect(store.end(session.id, session.hostToken).ok).toBe(true);
    }

    expect(store.resourceCounts().terminalSessions).toBe(STORE_LIMITS.terminalSessions);
    expect(store.terminalReason(first!.id)).toBeUndefined();
    expect(store.terminalReason(first!.code)).toBeUndefined();
    expect(store.terminalReason(last!.id)).toBe('ended');
    expect(store.terminalReason(last!.code)).toBe('ended');
  });

  it('passively expires at the exact deadline and notifies exactly once', () => {
    let now = 10_000;
    const scheduler = new FakeScheduler(
      () => now,
      (value) => {
        now = value;
      },
    );
    const scheduledStore = new SessionStore({ clock: () => now, scheduler });
    const created = scheduledStore.create({
      areaLabel: 'Qurum',
      center: { lat: 23.5, lng: 58.3 },
      radiusKm: 3,
      nickname: 'Host',
      color: 0,
      allowReruns: true,
    });
    if (!created.ok) throw new Error('Expected session creation');
    const expired: string[] = [];
    scheduledStore.onExpired((session) => expired.push(session.id));

    scheduler.advance(SESSION_TTL_MS - 1);
    expect(scheduledStore.state.sessions.has(created.value.session.id)).toBe(true);
    expect(expired).toEqual([]);
    scheduler.advance(1);
    expect(scheduledStore.state.sessions.has(created.value.session.id)).toBe(false);
    expect(scheduledStore.state.codeIndex.has(created.value.session.code)).toBe(false);
    expect(expired).toEqual([created.value.session.id]);
    expect(scheduledStore.terminalReason(created.value.session.id)).toBe('expired');

    scheduler.advance(SESSION_TTL_MS);
    expect(scheduledStore.resourceCounts()).toEqual({ activeSessions: 0, terminalSessions: 0 });
    expect(expired).toEqual([created.value.session.id]);
    scheduledStore.close();
    expect(scheduler.size).toBe(0);
  });

  it('sweeps expired sessions before applying active capacity', () => {
    const now = SESSION_TTL_MS + 100;
    const state = createStoreState();
    const capacityStore = new SessionStore({ state, scheduler: null, clock: () => now });
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
      capacityStore.create({
        areaLabel: 'Muttrah',
        center: { lat: 23.6, lng: 58.4 },
        radiusKm: 3,
        nickname: 'Host',
        color: 0,
        allowReruns: false,
      }).ok,
    ).toBe(true);
    expect(capacityStore.resourceCounts()).toEqual({
      activeSessions: 1,
      terminalSessions: STORE_LIMITS.terminalSessions,
    });
    seedStore.close();
    capacityStore.close();
  });
});

describe('collecting lifecycle', () => {
  it('defaults public host nickname sharing off and requires a supplied nickname', () => {
    expect(create().session.shareHostNickname).toBe(false);
    expect(
      create({
        nickname: 'Shared Host',
        shareHostNickname: true,
      }).session.shareHostNickname,
    ).toBe(true);
    expect(
      create({
        nickname: '',
        shareHostNickname: true,
      }).session.shareHostNickname,
    ).toBe(false);
  });

  it('lets a guest leave but requires the host to end the session', () => {
    const { session, participantToken: hostParticipantToken } = create();
    const guest = store.join(session, 'Guest', 1);
    if (!guest.ok) throw new Error(guest.failure.message);

    expect(store.leave(session, hostParticipantToken)).toMatchObject({
      ok: false,
      failure: { kind: 'host-must-end' },
    });
    expect(store.leave(session, guest.value.participantToken)).toEqual({
      ok: true,
      value: { participantId: guest.value.participantId },
    });
    expect(session.participants.map((participant) => participant.id)).not.toContain(guest.value.participantId);
    expect(store.leave(session, guest.value.participantToken)).toMatchObject({
      ok: false,
      failure: { kind: 'invalid-participant' },
    });
  });

  it('allows only the host capability to remove a non-host participant once', () => {
    const { session } = create();
    const guest = store.join(session, 'Guest', 1);
    if (!guest.ok) throw new Error(guest.failure.message);
    const host = session.participants.find((participant) => participant.isHost)!;

    expect(store.remove(session, 'wrong-token', guest.value.participantId)).toMatchObject({
      ok: false,
      failure: { kind: 'access-required' },
    });
    expect(store.remove(session, session.hostToken, host.id)).toMatchObject({
      ok: false,
      failure: { kind: 'host-cannot-be-removed' },
    });
    expect(store.remove(session, session.hostToken, guest.value.participantId)).toEqual({
      ok: true,
      value: { participantId: guest.value.participantId },
    });
    expect(store.remove(session, session.hostToken, guest.value.participantId)).toMatchObject({
      ok: false,
      failure: { kind: 'participant-not-found' },
    });
  });

  it('locks every collecting mutation before reveal and rerun calculation', () => {
    const { session, participantToken: hostParticipantToken } = create();
    const guest = store.join(session, 'Guest', 1);
    if (!guest.ok) throw new Error(guest.failure.message);
    expect(store.submit(session, hostParticipantToken, prefs).ok).toBe(true);
    expect(store.submit(session, guest.value.participantToken, prefs).ok).toBe(true);

    expect(
      store.reveal(session, session.hostToken, () => {
        expect(session.phase).toBe('locking');
        expect(store.join(session, 'Late', 2)).toMatchObject({ ok: false, failure: { kind: 'locked' } });
        expect(store.submit(session, hostParticipantToken, prefs)).toMatchObject({
          ok: false,
          failure: { kind: 'locked' },
        });
        expect(store.leave(session, guest.value.participantToken)).toMatchObject({
          ok: false,
          failure: { kind: 'locked' },
        });
        expect(store.remove(session, session.hostToken, guest.value.participantId)).toMatchObject({
          ok: false,
          failure: { kind: 'locked' },
        });
      }),
    ).toEqual({ ok: true, value: { changed: true } });
    expect(session.phase).toBe('revealed');
    const firstResult = session.result;
    expect(store.reveal(session, session.hostToken)).toEqual({ ok: true, value: { changed: false } });
    expect(session.result).toBe(firstResult);

    expect(
      store.rerun(session, session.hostToken, () => {
        expect(session.phase).toBe('locking');
        expect(store.submit(session, hostParticipantToken, prefs)).toMatchObject({
          ok: false,
          failure: { kind: 'locked' },
        });
      }),
    ).toEqual({ ok: true, value: undefined });
    expect(['revealed', 'blocked-no-match']).toContain(session.phase);
  });
});
