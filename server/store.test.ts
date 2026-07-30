import { afterEach, describe, expect, it, vi } from 'vitest';
import { SESSION_TTL_MS, type Prefs } from '../shared/types';
import {
  createSession, endSession, getByIdOrCode, getStoreResourceCounts, getTerminalReason, joinSession, leaveSession,
  removeParticipant, rerun, reveal, STORE_LIMITS, submitPrefs,
} from './store';

const create = () => createSession({
  areaLabel: 'Qurum', center: { lat: 23.5, lng: 58.3 }, radiusKm: 3,
  nickname: 'Host', color: 0, allowReruns: true,
});
const prefs: Prefs = {
  cuisines: { Japanese: 'like' }, budget: 2, maxDistanceKm: 3, dietary: [],
};

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
});

describe('collecting lifecycle', () => {
  it('defaults public host nickname sharing off and requires a supplied nickname', () => {
    expect(create().session.shareHostNickname).toBe(false);
    expect(createSession({
      areaLabel: 'Qurum', center: { lat: 23.5, lng: 58.3 }, radiusKm: 3,
      nickname: 'Shared Host', color: 0, allowReruns: true, shareHostNickname: true,
    }).session.shareHostNickname).toBe(true);
    expect(createSession({
      areaLabel: 'Qurum', center: { lat: 23.5, lng: 58.3 }, radiusKm: 3,
      nickname: '', color: 0, allowReruns: true, shareHostNickname: true,
    }).session.shareHostNickname).toBe(false);
  });

  it('lets a guest leave but requires the host to end the session', () => {
    const { session, participantToken: hostParticipantToken } = create();
    const guest = joinSession(session, 'Guest', 1);
    if ('error' in guest) throw new Error(guest.error);

    expect(leaveSession(session, hostParticipantToken)).toEqual({
      ok: false, error: 'The host must end the session',
    });
    expect(leaveSession(session, guest.participantToken)).toEqual({
      ok: true, participantId: guest.participantId,
    });
    expect(session.participants.map((participant) => participant.id)).not.toContain(guest.participantId);
    expect(leaveSession(session, guest.participantToken)).toEqual({
      ok: false, error: 'Invalid participant token',
    });
  });

  it('allows only the host capability to remove a non-host participant once', () => {
    const { session } = create();
    const guest = joinSession(session, 'Guest', 1);
    if ('error' in guest) throw new Error(guest.error);
    const host = session.participants.find((participant) => participant.isHost)!;

    expect(removeParticipant(session, 'wrong-token', guest.participantId)).toEqual({
      ok: false, error: 'Forbidden',
    });
    expect(removeParticipant(session, session.hostToken, host.id)).toEqual({
      ok: false, error: 'The host cannot be removed',
    });
    expect(removeParticipant(session, session.hostToken, guest.participantId)).toEqual({ ok: true });
    expect(removeParticipant(session, session.hostToken, guest.participantId)).toEqual({
      ok: false, error: 'Participant not found',
    });
  });

  it('locks every collecting mutation before reveal and rerun calculation', () => {
    const { session, participantToken: hostParticipantToken } = create();
    const guest = joinSession(session, 'Guest', 1);
    if ('error' in guest) throw new Error(guest.error);
    expect(submitPrefs(session, hostParticipantToken, prefs)).toBe(true);
    expect(submitPrefs(session, guest.participantToken, prefs)).toBe(true);

    expect(reveal(session, session.hostToken, () => {
      expect(session.phase).toBe('locking');
      expect(joinSession(session, 'Late', 2)).toEqual({ error: 'Voting is closed' });
      expect(submitPrefs(session, hostParticipantToken, prefs)).toBe(false);
      expect(leaveSession(session, guest.participantToken)).toEqual({ ok: false, error: 'Voting is closed' });
      expect(removeParticipant(session, session.hostToken, guest.participantId)).toEqual({ ok: false, error: 'Voting is closed' });
    })).toEqual({ ok: true, changed: true });
    expect(session.phase).toBe('revealed');
    const firstResult = session.result;
    expect(reveal(session, session.hostToken)).toEqual({ ok: true, changed: false });
    expect(session.result).toBe(firstResult);

    expect(rerun(session, session.hostToken, () => {
      expect(session.phase).toBe('locking');
      expect(submitPrefs(session, hostParticipantToken, prefs)).toBe(false);
    })).toEqual({ ok: true });
    expect(['revealed', 'blocked-no-match']).toContain(session.phase);
  });
});
