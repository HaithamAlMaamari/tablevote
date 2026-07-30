import { describe, expect, it } from 'vitest';
import fixture from './fixtures/tv-rank-1.0.0.golden.json';
import { computeResult, roundScore, W_CUISINE, W_DISTANCE, W_PRICE, W_RATING } from './scoring';
import { ALGORITHM_VERSION, type Participant, type Prefs, type Tiebreak } from './types';
import { normalizeDemoRestaurants, type DemoRestaurantInput } from './catalog';

const basePrefs: Prefs = { cuisines: {}, budget: 4, maxDistanceKm: null, dietary: [] };
const baseRestaurant: Omit<DemoRestaurantInput, 'id' | 'name'> = {
  cuisines: ['Italian'],
  priceTier: 2,
  rating: 4.5,
  distanceKm: 1,
  lat: 23.5,
  lng: 58.3,
  address: 'Muscat',
  dietaryOptions: [],
  openNow: true,
};

describe(`golden ranking fixtures ${ALGORITHM_VERSION}`, () => {
  it('matches every versioned expected result and reconciles audit components', () => {
    expect(fixture.algorithmVersion).toBe(ALGORITHM_VERSION);

    for (const scenario of fixture.cases) {
      const participants = scenario.participants.map((input, index): Participant => ({
        id: input.id,
        token: `token-${input.id}`,
        nickname: input.id,
        color: index % 4,
        prefs: { ...basePrefs, ...input.prefs } as Prefs,
        isHost: index === 0,
      }));
      const restaurants = normalizeDemoRestaurants(
        scenario.restaurants.map(
          (input) =>
            ({
              ...baseRestaurant,
              ...input,
              name: input.id,
            }) as DemoRestaurantInput,
        ),
      );
      const rerun = scenario as typeof scenario & {
        excludedIds?: string[];
        round?: number;
        previousWinners?: string[];
      };
      const result = computeResult(
        scenario.id,
        participants,
        restaurants,
        rerun.excludedIds ?? [],
        rerun.round ?? 1,
        rerun.previousWinners ?? [],
      );

      expect(result.algorithmVersion, scenario.id).toBe(ALGORITHM_VERSION);
      expect(result.kind, scenario.id).toBe(scenario.expected.kind);
      expect(result.eliminatedCount, scenario.id).toBe(scenario.expected.eliminatedCount);
      if (result.kind !== 'match' || scenario.expected.kind !== 'match') continue;

      expect(
        result.scoringSheet.filter((row) => !row.eliminated).map((row) => row.restaurantId),
        scenario.id,
      ).toEqual(scenario.expected.order);
      expect(result.tiebreak, scenario.id).toBe(scenario.expected.tiebreak as Tiebreak);
      expect(Object.fromEntries(result.scoringSheet.map((row) => [row.restaurantId, row.total])), scenario.id).toEqual(
        scenario.expected.totals,
      );

      for (const row of result.scoringSheet.filter((candidate) => !candidate.eliminated)) {
        const reconciledMean = roundScore(
          W_CUISINE * row.cuisineScore +
            W_PRICE * row.priceScore +
            W_DISTANCE * row.distanceScore +
            W_RATING * row.ratingScore,
        );
        expect(row.meanUtility, `${scenario.id}:${row.restaurantId}:mean`).toBeCloseTo(reconciledMean, 5);
        expect(row.total, `${scenario.id}:${row.restaurantId}:total`).toBe(
          roundScore(0.7 * row.meanUtility + 0.2 * row.minUtility + 0.1 * row.borda),
        );
      }
    }
  });
});
