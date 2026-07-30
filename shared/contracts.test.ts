import { describe, expect, it } from 'vitest';
import {
  ClientResultSchema,
  ClientRestaurantSchema,
  CreateSessionRequestSchema,
  ErrorResponseSchema,
  JoinSessionRequestSchema,
  PrefsSchema,
  SessionSnapshotSchema,
  SubmitResponseSchema,
} from './contracts';
import { ALGORITHM_VERSION } from './types';

const finalist = {
  restaurant: {
    id: 'demo-1',
    name: 'Demo One',
    cuisines: ['Italian'],
    priceTier: 2,
    rating: 4.5,
    distanceKm: 1,
  },
  groupFit: 'good',
} as const;

const snapshot = {
  id: 'session-1',
  code: 'ABCDE',
  phase: 'collecting',
  areaLabel: 'Qurum',
  expiresAt: 1_000,
  allowReruns: true,
  rerunsUsed: 0,
  selfParticipantId: 'participant-1',
  ownPrefs: null,
  participants: [],
  result: null,
} as const;

describe('transport contracts', () => {
  it('normalizes safe request fields and applies protocol defaults', () => {
    const result = CreateSessionRequestSchema.parse({
      areaLabel: '  Friday dinner  ',
      center: { lat: 0, lng: 0 },
      radiusKm: 3,
      nickname: '  <Sam>  ',
    });
    expect(result).toMatchObject({
      areaLabel: 'Friday dinner',
      nickname: 'Sam',
      color: 0,
      allowReruns: true,
      shareHostNickname: false,
    });
  });

  it('rejects unsupported ballot modes and ambiguous joins', () => {
    expect(
      PrefsSchema.safeParse({
        cuisines: {},
        budget: 2,
        maxDistanceKm: 3,
        dietary: [{ type: 'halal', strict: false }],
      }).success,
    ).toBe(false);
    expect(JoinSessionRequestSchema.safeParse({ nickname: 'Sam', color: 0 }).success).toBe(false);
  });

  it('validates complete responses and typed failures at runtime', () => {
    expect(ErrorResponseSchema.parse({ error: 'Voting is closed', errorCode: 'locked' })).toEqual({
      error: 'Voting is closed',
      errorCode: 'locked',
    });
    expect(SessionSnapshotSchema.safeParse({ id: 'only-an-id', participants: [] }).success).toBe(false);
  });

  it('requires an exact submit success with authoritative state', () => {
    expect(SubmitResponseSchema.safeParse({ ok: true, state: snapshot }).success).toBe(true);
    expect(SubmitResponseSchema.safeParse({ ok: true }).success).toBe(false);
    expect(SubmitResponseSchema.safeParse({ ok: true, state: snapshot, ignored: true }).success).toBe(false);
  });

  it('accepts only the allowlisted client restaurant fields', () => {
    const restaurant = {
      id: 'demo-1',
      name: 'Demo One',
      cuisines: ['Italian'],
      priceTier: 2,
      rating: 4.5,
      distanceKm: 1,
    };
    expect(ClientRestaurantSchema.parse(restaurant)).toEqual(restaurant);
    expect(ClientRestaurantSchema.safeParse({ ...restaurant, address: 'Private address' }).success).toBe(false);
  });

  it('accepts matched results with one to three consistent finalists', () => {
    for (const count of [1, 2, 3]) {
      const top3 = Array.from({ length: count }, (_, index) =>
        index === 0
          ? finalist
          : {
              ...finalist,
              restaurant: { ...finalist.restaurant, id: `demo-${index + 1}`, name: `Demo ${index + 1}` },
            },
      );
      expect(
        ClientResultSchema.safeParse({
          kind: 'match',
          algorithmVersion: ALGORITHM_VERSION,
          winner: finalist,
          top3,
          ownWinnerFit: 0.75,
          tiebreak: 'none',
          round: 1,
          previousWinners: [],
        }).success,
      ).toBe(true);
    }
  });

  it.each([
    ['unsupported algorithm', { algorithmVersion: 'future-rank-2.0.0' }],
    ['no finalists', { top3: [] }],
    ['too many finalists', { top3: [finalist, finalist, finalist, finalist] }],
    [
      'winner mismatch',
      {
        winner: { ...finalist, restaurant: { ...finalist.restaurant, id: 'other' } },
      },
    ],
  ])('rejects malformed matched results with %s', (_label, override) => {
    expect(
      ClientResultSchema.safeParse({
        kind: 'match',
        algorithmVersion: ALGORITHM_VERSION,
        winner: finalist,
        top3: [finalist],
        ownWinnerFit: 0.75,
        tiebreak: 'none',
        round: 1,
        previousWinners: [],
        ...override,
      }).success,
    ).toBe(false);
  });

  it('rejects unsupported no-match result versions', () => {
    expect(
      ClientResultSchema.safeParse({
        kind: 'no-verified-match',
        algorithmVersion: 'future-rank-2.0.0',
        round: 1,
        previousWinners: [],
      }).success,
    ).toBe(false);
  });
});
