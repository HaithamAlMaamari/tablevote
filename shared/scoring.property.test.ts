import { describe, expect, it } from 'vitest';
import { computeResult, passesHardFilter } from './scoring';
import {
  CUISINES,
  DIETARY_TYPES,
  type CuisineState,
  type DietaryEvidenceState,
  type Participant,
  type Prefs,
  type Restaurant,
} from './types';

function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

function integer(random: () => number, maximum: number): number {
  return Math.floor(random() * maximum);
}

function shuffle<T>(values: readonly T[], random: () => number): T[] {
  const shuffled = [...values];
  for (let index = shuffled.length - 1; index > 0; index--) {
    const other = integer(random, index + 1);
    [shuffled[index], shuffled[other]] = [shuffled[other], shuffled[index]];
  }
  return shuffled;
}

function generatedPrefs(random: () => number): Prefs {
  const cuisineStates: CuisineState[] = ['like', 'neutral', 'dislike'];
  const cuisines: Prefs['cuisines'] = {};
  for (const cuisine of CUISINES) {
    if (random() < 0.35) cuisines[cuisine] = cuisineStates[integer(random, cuisineStates.length)];
  }
  return {
    cuisines,
    budget: (integer(random, 4) + 1) as Prefs['budget'],
    maxDistanceKm: random() < 0.25 ? null : Math.round(random() * 200) / 10,
    dietary: DIETARY_TYPES.filter(() => random() < 0.16).map((type) => ({ type, strict: true })),
  };
}

function generatedRestaurant(random: () => number, seed: number, index: number): Restaurant {
  const evidenceStates: DietaryEvidenceState[] = ['supported', 'contradicted', 'unknown', 'stale'];
  const cuisineCount = integer(random, 3) + 1;
  const cuisines = shuffle(CUISINES, random).slice(0, cuisineCount);
  return {
    id: `restaurant-${seed.toString().padStart(3, '0')}-${index}`,
    name: `Generated restaurant ${seed}-${index}`,
    cuisines,
    priceTier: (integer(random, 4) + 1) as Restaurant['priceTier'],
    rating: Math.round(random() * 60) / 10,
    distanceKm: Math.round(random() * 300) / 10,
    lat: -90 + random() * 180,
    lng: -180 + random() * 360,
    address: `${index} Test Street`,
    dietaryEvidence: Object.fromEntries(
      DIETARY_TYPES.map((type) => [
        type,
        {
          state: evidenceStates[integer(random, evidenceStates.length)],
          source: 'seeded-test',
          checkedAt: '2026-07-30T00:00:00.000Z',
        },
      ]),
    ) as Restaurant['dietaryEvidence'],
    openNow: random() < 0.5,
  };
}

function scenario(seed: number) {
  const random = seededRandom(seed);
  const participants = Array.from({ length: integer(random, 6) + 1 }, (_, index): Participant => ({
    id: `participant-${seed}-${index}`,
    token: `token-${seed}-${index}`,
    nickname: `Voter ${index}`,
    color: index % 4,
    prefs: generatedPrefs(random),
    isHost: index === 0,
  }));
  const restaurants = Array.from({ length: integer(random, 7) + 1 }, (_, index) =>
    generatedRestaurant(random, seed, index),
  );
  const excludedIds = restaurants.filter(() => random() < 0.25).map((restaurant) => restaurant.id);
  return { participants, restaurants, excludedIds };
}

function expectUnitInterval(value: number, label: string): void {
  expect(Number.isFinite(value), label).toBe(true);
  expect(value, label).toBeGreaterThanOrEqual(0);
  expect(value, label).toBeLessThanOrEqual(1);
}

describe('seeded scoring invariants', () => {
  it('is repeatable, input-order independent, bounded, constraint-safe, and exclusion-safe', () => {
    for (let seed = 1; seed <= 100; seed++) {
      const { participants, restaurants, excludedIds } = scenario(seed);
      const previousWinners = ['Previous'];
      const result = computeResult(`property-${seed}`, participants, restaurants, excludedIds, 2, previousWinners);

      expect(
        computeResult(`property-${seed}`, participants, restaurants, excludedIds, 2, previousWinners),
        `seed ${seed}: repeatability`,
      ).toEqual(result);
      expect(
        computeResult(
          `different-session-${seed}`,
          participants,
          shuffle(restaurants, seededRandom(seed ^ 0x9e37_79b9)),
          excludedIds,
          2,
          ['Previous'],
        ),
        `seed ${seed}: candidate ordering`,
      ).toEqual(result);

      const available = restaurants.filter((restaurant) => !excludedIds.includes(restaurant.id));
      const prefs = participants.map((participant) => participant.prefs as Prefs);
      const eligible = available.filter((restaurant) => passesHardFilter(restaurant, prefs));
      expect(result.eliminatedCount, `seed ${seed}: eliminated count`).toBe(available.length - eligible.length);

      if (eligible.length === 0) {
        expect(result.kind, `seed ${seed}: empty eligible pool`).toBe('no-verified-match');
        continue;
      }

      expect(result.kind, `seed ${seed}: non-empty eligible pool`).toBe('match');
      if (result.kind !== 'match') throw new Error(`Seed ${seed} unexpectedly had no match`);
      expect(result.winner).toEqual(result.top3[0]);
      expect(result.top3).toHaveLength(Math.min(3, eligible.length));

      for (const finalist of result.top3) {
        expect(excludedIds, `seed ${seed}: finalist exclusion`).not.toContain(finalist.restaurant.id);
        expect(passesHardFilter(finalist.restaurant, prefs), `seed ${seed}: finalist constraints`).toBe(true);
        expectUnitInterval(finalist.score, `seed ${seed}: finalist score`);
        expectUnitInterval(finalist.meanUtility, `seed ${seed}: finalist mean`);
        expectUnitInterval(finalist.minUtility, `seed ${seed}: finalist minimum`);
        for (const person of finalist.perPerson) {
          expectUnitInterval(person.satisfaction, `seed ${seed}: participant satisfaction`);
        }
      }

      for (const row of result.scoringSheet) {
        for (const [component, value] of Object.entries({
          cuisine: row.cuisineScore,
          price: row.priceScore,
          distance: row.distanceScore,
          rating: row.ratingScore,
          mean: row.meanUtility,
          minimum: row.minUtility,
          borda: row.borda,
          total: row.total,
        }))
          expectUnitInterval(value, `seed ${seed}: ${row.restaurantId} ${component}`);

        if (!row.eliminated) {
          const restaurant = restaurants.find((candidate) => candidate.id === row.restaurantId)!;
          expect(excludedIds, `seed ${seed}: scoring exclusion`).not.toContain(row.restaurantId);
          expect(passesHardFilter(restaurant, prefs), `seed ${seed}: scoring constraints`).toBe(true);
        }
      }

      for (const excludedId of excludedIds) {
        expect(
          result.scoringSheet.find((row) => row.restaurantId === excludedId)?.eliminated,
          `seed ${seed}: ${excludedId} marked excluded`,
        ).toBe(true);
      }
    }
  });

  it('canonically orders generated exact ties regardless of candidate order', () => {
    for (let seed = 101; seed <= 140; seed++) {
      const random = seededRandom(seed);
      const candidateCount = integer(random, 5) + 2;
      const prototype = generatedRestaurant(random, seed, 0);
      const restaurants = Array.from({ length: candidateCount }, (_, index) => ({
        ...prototype,
        id: `tie-${seed}-${String.fromCharCode(65 + index)}`,
        name: `Tie ${index}`,
      }));
      const participants: Participant[] = [
        {
          id: `tie-voter-${seed}`,
          token: `tie-token-${seed}`,
          nickname: 'Tie voter',
          color: 0,
          prefs: { ...generatedPrefs(random), dietary: [] },
          isHost: true,
        },
      ];
      const expected = restaurants.map((restaurant) => restaurant.id).sort((a, b) => a.localeCompare(b));
      const result = computeResult(`tie-${seed}`, participants, shuffle(restaurants, random));

      expect(result.kind).toBe('match');
      if (result.kind !== 'match') throw new Error(`Seed ${seed} unexpectedly had no match`);
      expect(result.tiebreak).toBe('canonical-id');
      expect(result.top3.map((finalist) => finalist.restaurant.id)).toEqual(expected.slice(0, 3));
      expect(result.scoringSheet.map((row) => row.restaurantId)).toEqual(expected);
    }
  });
});
