import { describe, expect, it } from 'vitest';
import {
  ClientRestaurantSchema,
  CreateSessionRequestSchema,
  ErrorResponseSchema,
  JoinSessionRequestSchema,
  PrefsSchema,
  SessionSnapshotSchema,
} from './contracts';

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
});
