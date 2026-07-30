import { describe, expect, it } from 'vitest';
import { computeResult } from './scoring';
import type { Participant, Prefs, Restaurant, Session } from './types';
import { projectInvite, projectSession } from './projections';
import { normalizeDemoRestaurants } from './catalog';

const restaurant = (id: string, cuisine: Restaurant['cuisines'][number]): Restaurant =>
  normalizeDemoRestaurants([
    {
      id,
      name: id,
      cuisines: [cuisine],
      priceTier: 2,
      rating: 4.5,
      distanceKm: 1,
      lat: 23.5,
      lng: 58.3,
      address: 'Muscat',
      dietaryOptions: [],
      openNow: true,
    },
  ])[0];
const prefs = (cuisines: Prefs['cuisines']): Prefs => ({
  cuisines,
  budget: 2,
  maxDistanceKm: 3,
  dietary: [],
});

describe('participant projections', () => {
  it('keeps duplicate display names distinct and exposes only the viewer fit', () => {
    const participants: Participant[] = [
      { id: 'p1', token: 't1', nickname: 'Same', color: 0, prefs: prefs({ Italian: 'like' }), isHost: true },
      { id: 'p2', token: 't2', nickname: 'Same', color: 1, prefs: prefs({ Japanese: 'like' }), isHost: false },
    ];
    const restaurants = [restaurant('italian', 'Italian'), restaurant('japanese', 'Japanese')];
    const result = computeResult('session', participants, restaurants);
    expect(result.kind).toBe('match');
    const session: Session = {
      id: 'session',
      code: 'ABCDE',
      hostToken: 'host',
      participants,
      phase: 'revealed',
      result,
      excludedIds: [],
      rerunsUsed: 0,
      allowReruns: true,
      createdAt: 1,
      center: { lat: 23.5, lng: 58.3 },
      areaLabel: 'Qurum',
      radiusKm: 3,
    };

    const first = projectSession(session, participants[0]);
    const second = projectSession(session, participants[1]);
    expect(first.selfParticipantId).toBe('p1');
    expect(second.selfParticipantId).toBe('p2');
    expect(first.participants.map((participant) => participant.id)).toEqual(['p1', 'p2']);
    expect(first.ownPrefs).toEqual(participants[0].prefs);
    expect(second.ownPrefs).toEqual(participants[1].prefs);
    expect(first.ownPrefs).not.toEqual(second.ownPrefs);
    expect(first.result?.kind).toBe('match');
    expect(second.result?.kind).toBe('match');
    if (first.result?.kind !== 'match' || second.result?.kind !== 'match') throw new Error('Expected match');
    expect(first.result.winner.restaurant).toEqual({
      id: 'italian',
      name: 'italian',
      cuisines: ['Italian'],
      priceTier: 2,
      rating: 4.5,
      distanceKm: 1,
    });
    for (const field of ['lat', 'lng', 'address', 'dietaryEvidence', 'openNow']) {
      expect(first.result.winner.restaurant).not.toHaveProperty(field);
    }
    expect(first.result.ownWinnerFit).not.toBeNull();
    expect(second.result.ownWinnerFit).not.toBeNull();
    const serialized = JSON.stringify(first.result);
    expect(serialized).not.toMatch(/perPerson|scoringSheet|meanUtility|minUtility|explanation|nickname|participantId/);

    expect(projectInvite(session)).toEqual({
      code: 'ABCDE',
      areaLabel: 'Qurum',
      expiresAt: 1 + 24 * 60 * 60 * 1000,
      joinable: false,
    });
    session.shareHostNickname = true;
    expect(projectInvite(session)).toEqual({
      code: 'ABCDE',
      areaLabel: 'Qurum',
      expiresAt: 1 + 24 * 60 * 60 * 1000,
      joinable: false,
      hostNickname: 'Same',
    });
  });
});
