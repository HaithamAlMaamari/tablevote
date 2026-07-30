import { describe, expect, it } from 'vitest';
import { computeResult, priceScore, utility } from './scoring';
import {
  ALGORITHM_VERSION,
  DIETARY_TYPES,
  type DietaryEvidence,
  type DietaryEvidenceState,
  type DietaryType,
  type MatchedVoteResult,
  type Participant,
  type Prefs,
  type Restaurant,
  type VoteResult,
} from './types';
import { normalizeDemoRestaurants, type DemoRestaurantInput } from './catalog';

type RestaurantOverrides = Partial<Restaurant> & { id: string; dietaryOptions?: DietaryType[] };

function R(over: RestaurantOverrides): Restaurant {
  const { dietaryOptions = [], dietaryEvidence, ...rest } = over;
  const restaurant = normalizeDemoRestaurants([
    {
      name: over.id,
      cuisines: ['Italian'],
      priceTier: 2,
      rating: 4.5,
      distanceKm: 1,
      lat: 23.5,
      lng: 58.3,
      address: 'x',
      dietaryOptions,
      openNow: true,
      ...rest,
    } as DemoRestaurantInput,
  ])[0];
  return dietaryEvidence ? { ...restaurant, dietaryEvidence } : restaurant;
}

function evidence(states: Partial<Record<DietaryType, DietaryEvidenceState>>): Restaurant['dietaryEvidence'] {
  return Object.fromEntries(
    DIETARY_TYPES.map((type) => [
      type,
      {
        state: states[type] ?? 'unknown',
        source: 'test-fixture',
        checkedAt: '2026-07-25T00:00:00.000Z',
      } satisfies DietaryEvidence,
    ]),
  ) as Restaurant['dietaryEvidence'];
}
function P(nick: string, prefs: Prefs): Participant {
  return { id: `id-${nick}`, token: nick, nickname: nick, color: 0, prefs, isHost: false };
}
function prefs(over: Partial<Prefs>): Prefs {
  return { cuisines: {}, budget: 4, maxDistanceKm: null, dietary: [], ...over };
}
function matched(result: VoteResult): MatchedVoteResult {
  expect(result.kind).toBe('match');
  if (result.kind !== 'match') throw new Error('Expected a matched result');
  return result;
}
function permutations<T>(values: T[]): T[][] {
  if (values.length <= 1) return [values];
  return values.flatMap((value, index) =>
    permutations(values.filter((_, i) => i !== index)).map((rest) => [value, ...rest]),
  );
}

describe('hard filter', () => {
  it.each(DIETARY_TYPES)('requires fresh supported evidence for %s', (type) => {
    const restaurants = [
      R({ id: `${type}-supported`, dietaryEvidence: evidence({ [type]: 'supported' }) }),
      R({ id: `${type}-contradicted`, dietaryEvidence: evidence({ [type]: 'contradicted' }) }),
      R({ id: `${type}-unknown`, dietaryEvidence: evidence({ [type]: 'unknown' }) }),
      R({ id: `${type}-stale`, dietaryEvidence: evidence({ [type]: 'stale' }) }),
    ];
    const participants = [P('Required', prefs({ dietary: [{ type, strict: true }] }))];
    const result = matched(computeResult(`evidence-${type}`, participants, restaurants));
    expect(result.winner.restaurant.id).toBe(`${type}-supported`);
    expect(result.eliminatedCount).toBe(3);

    const rerun = computeResult(`evidence-${type}`, participants, restaurants, [`${type}-supported`], 2, [
      `${type}-supported`,
    ]);
    expect(rerun).toMatchObject({
      kind: 'no-verified-match',
      algorithmVersion: ALGORITHM_VERSION,
      round: 2,
    });
  });

  it('strict halal eliminates non-halal restaurants', () => {
    const restaurants = [
      R({ id: 'halal-place', dietaryOptions: ['halal'] }),
      R({ id: 'pork-place', dietaryOptions: [] }),
    ];
    const ps = [P('Sara', prefs({ dietary: [{ type: 'halal', strict: true }] })), P('Jo', prefs({}))];
    const res = matched(computeResult('s1', ps, restaurants));
    expect(res.winner.restaurant.id).toBe('halal-place');
    expect(res.eliminatedCount).toBe(1);
    expect(res.explanation.join(' ')).toMatch(/strict halal/);
  });

  it('fails closed instead of relaxing strict requirements', () => {
    const restaurants = [R({ id: 'meat', dietaryOptions: ['halal'] })];
    const ps = [P('Vee', prefs({ dietary: [{ type: 'vegetarian', strict: true }] })), P('Jo', prefs({}))];
    const res = computeResult('s2', ps, restaurants);
    expect(res).toEqual({
      kind: 'no-verified-match',
      algorithmVersion: ALGORITHM_VERSION,
      eliminatedCount: 1,
      round: 1,
      previousWinners: [],
    });

    const ps2 = [P('Sal', prefs({ dietary: [{ type: 'halal', strict: true }] }))];
    const res2 = computeResult('s2b', ps2, [R({ id: 'non-halal', dietaryOptions: [] })]);
    expect(res2.kind).toBe('no-verified-match');
    expect(res2.eliminatedCount).toBe(1);
    expect('winner' in res2).toBe(false);
  });

  it('fails closed for mixed strict requirements and an exhausted rerun pool', () => {
    const restaurants = [R({ id: 'halal-only', dietaryOptions: ['halal'] })];
    const ps = [
      P('Sal', prefs({ dietary: [{ type: 'halal', strict: true }] })),
      P('Vee', prefs({ dietary: [{ type: 'vegan', strict: true }] })),
    ];
    expect(computeResult('mixed', ps, restaurants).kind).toBe('no-verified-match');
    expect(computeResult('excluded', ps, restaurants, ['halal-only'], 2, ['Halal only'])).toEqual({
      kind: 'no-verified-match',
      algorithmVersion: ALGORITHM_VERSION,
      eliminatedCount: 0,
      round: 2,
      previousWinners: ['Halal only'],
    });
  });
});

describe('min-utility protection', () => {
  it('vegetarian minority is protected: 5 meat-eaters + 1 strict vegetarian', () => {
    const vegFriendly = R({ id: 'veg-friendly', dietaryOptions: ['vegetarian'], cuisines: ['Vegetarian'] });
    const steakhouse = R({ id: 'steakhouse', dietaryOptions: [], cuisines: ['American'] });
    const meat = prefs({ cuisines: { American: 'like', Vegetarian: 'neutral' } });
    const ps = [
      ...Array.from({ length: 5 }, (_, i) => P(`meat${i}`, meat)),
      P(
        'Vee',
        prefs({
          dietary: [{ type: 'vegetarian', strict: true }],
          cuisines: { Vegetarian: 'like', American: 'dislike' },
        }),
      ),
    ];
    const res = matched(computeResult('s3', ps, [steakhouse, vegFriendly]));
    expect(res.winner.restaurant.id).toBe('veg-friendly');
    expect(res.eliminatedCount).toBe(1); // steakhouse vetoed by strict vegetarian
  });

  it('min term keeps a broadly-ok place above one person hates (no dietary)', () => {
    const everyone = prefs({ budget: 4, maxDistanceKm: null });
    const a = R({ id: 'loved-by-most', cuisines: ['Italian'] });
    const b = R({ id: 'fine-for-all', cuisines: ['Cafe'] });
    const ps = [
      P('one', prefs({ ...everyone, cuisines: { Italian: 'like', Cafe: 'neutral' } })),
      P('two', prefs({ ...everyone, cuisines: { Italian: 'like', Cafe: 'neutral' } })),
      P('three', prefs({ ...everyone, cuisines: { Italian: 'dislike', Cafe: 'neutral' } })),
    ];
    const res = matched(computeResult('s4', ps, [a, b]));
    // loved-by-most has higher mean but lower min; with 0.2 weight on min, b should be competitive
    const wa = res.scoringSheet.find((s) => s.restaurantId === 'loved-by-most')!;
    const wb = res.scoringSheet.find((s) => s.restaurantId === 'fine-for-all')!;
    expect(wa.minUtility).toBeLessThan(wb.minUtility);
    expect(wa.meanUtility).toBeGreaterThan(wb.meanUtility);
  });
});

describe('flexible participants', () => {
  it('excluded from the mean but dislikes still apply via min', () => {
    const a = R({ id: 'sushi', cuisines: ['Japanese'] });
    const b = R({ id: 'pizza', cuisines: ['Italian'] });
    const picky = prefs({ cuisines: { Japanese: 'like' } });
    // flexible: no likes, no strict — but dislikes Japanese
    const flex = prefs({ cuisines: { Japanese: 'dislike' } });
    const ps = [P('picky', picky), P('flex', flex)];
    const res = matched(computeResult('s5', ps, [a, b]));
    const sheet = res.scoringSheet;
    // mean counts only picky: sushi mean = 1-ish cuisine; pizza neutral 0.55
    const sushiRow = sheet.find((s) => s.restaurantId === 'sushi')!;
    const pizzaRow = sheet.find((s) => s.restaurantId === 'pizza')!;
    expect(sushiRow.meanUtility).toBeGreaterThan(pizzaRow.meanUtility);
    // but min includes flex's dislike of sushi
    expect(sushiRow.minUtility).toBeLessThan(pizzaRow.minUtility);
    const flexScore = res.winner.perPerson.find((p) => p.nickname === 'flex');
    expect(flexScore?.flexible).toBe(true);
  });
});

describe('tie ladder', () => {
  it('least-misery fires before coin flip', () => {
    const ps = [P('p1', prefs({ cuisines: { Italian: 'like' } })), P('p2', prefs({ budget: 1, maxDistanceKm: 10 }))];
    const ra = R({ id: 'A', cuisines: ['Italian'], priceTier: 3, rating: 4.55, distanceKm: 9 });
    const rb = R({ id: 'B', cuisines: ['Italian'], priceTier: 1, rating: 4.45, distanceKm: 9 });
    const res = matched(computeResult('tie-test', ps, [ra, rb]));
    if (Math.abs(res.scoringSheet[0].total - res.scoringSheet[1].total) < 0.01) {
      expect(['least-misery', 'copeland', 'canonical-id']).toContain(res.tiebreak);
      // least-misery must be checked first: winner has highest min among tied
      const top2mins = res.top3.slice(0, 2).map((f) => f.minUtility);
      if (Math.abs(top2mins[0] - top2mins[1]) >= 0.01) expect(res.tiebreak).toBe('least-misery');
    } else {
      expect(res.tiebreak).toBe('none');
    }
    // deterministic given session id
    const res2 = matched(computeResult('tie-test', ps, [ra, rb]));
    expect(res2.winner.restaurant.id).toBe(res.winner.restaurant.id);
    expect(res2.tiebreak).toBe(res.tiebreak);
  });

  it('uses immutable Copeland scores and is stable across candidate order', () => {
    const restaurants = [
      R({ id: 'A', cuisines: ['Italian'], rating: 4.13 }),
      R({ id: 'B', cuisines: ['Indian'], rating: 4.97 }),
      R({ id: 'C', cuisines: ['Japanese'], rating: 4.91 }),
    ];
    const ps = [
      P('one', prefs({ cuisines: { Italian: 'like', Indian: 'dislike', Japanese: 'dislike' } })),
      P('two', prefs({ cuisines: { Italian: 'dislike', Indian: 'neutral', Japanese: 'like' } })),
      P('three', prefs({ cuisines: { Italian: 'like', Indian: 'neutral', Japanese: 'neutral' } })),
    ];

    for (const order of permutations(restaurants)) {
      const result = matched(computeResult('copeland-order', ps, order));
      expect(result.tiebreak).toBe('copeland');
      expect(result.top3.map((candidate) => candidate.restaurant.id)).toEqual(['A', 'B', 'C']);
    }
  });
});

describe('regressions (verify pass)', () => {
  it('exact utility ties reach the tie ladder (no Borda index-order bias)', () => {
    // Two identical restaurants + identical members => utilities and totals
    // must be exactly equal, so the canonical-ID rung must decide.
    const base = R({ id: 'proto', cuisines: ['Italian'] });
    const a = { ...base, id: 'dupA', name: 'Dup A' };
    const b = { ...base, id: 'dupB', name: 'Dup B' };
    const ps = [P('one', prefs({})), P('two', prefs({}))];
    const res = matched(computeResult('tie-seed-1', ps, [a, b]));
    expect(res.tiebreak).toBe('canonical-id');
    expect(res.scoringSheet[0].total).toBe(res.scoringSheet[1].total);
    // deterministic per session id
    const again = matched(computeResult('tie-seed-1', ps, [b, a]));
    expect(again.top3.map((candidate) => candidate.restaurant.id)).toEqual(['dupA', 'dupB']);
    // Session identifiers cannot alter identical ranking inputs.
    const winners = new Set(
      Array.from(
        { length: 12 },
        (_, i) => matched(computeResult(`tie-seed-${i + 1}`, ps, [a, b])).winner.restaurant.id,
      ),
    );
    expect(winners).toEqual(new Set(['dupA']));
  });

  it('canonically orders every exact-tie candidate across all permutations', () => {
    const base = R({ id: 'base', cuisines: ['Italian'] });
    const restaurants = ['C', 'A', 'B'].map((id) => ({ ...base, id, name: id }));
    const ps = [P('one', prefs({})), P('two', prefs({}))];

    for (const order of permutations(restaurants)) {
      const result = matched(computeResult('ignored-session-id', ps, order));
      expect(result.tiebreak).toBe('canonical-id');
      expect(result.top3.map((candidate) => candidate.restaurant.id)).toEqual(['A', 'B', 'C']);
    }
  });

  it('explanation does not attribute the combined elimination count to each voter', () => {
    const restaurants = [
      R({ id: 'both', dietaryOptions: ['halal', 'vegan'] }),
      R({ id: 'halal-only', dietaryOptions: ['halal'] }),
      R({ id: 'vegan-only', dietaryOptions: ['vegan'] }),
      R({ id: 'neither', dietaryOptions: [] }),
    ];
    const ps = [
      P('Hana', prefs({ dietary: [{ type: 'halal', strict: true }] })),
      P('Ravi', prefs({ dietary: [{ type: 'vegan', strict: true }] })),
    ];
    const res = matched(computeResult('attr', ps, restaurants));
    expect(res.eliminatedCount).toBe(3);
    const bullets = res.explanation.filter((b) => b.includes('removed'));
    // single combined bullet, not one inflated claim per person
    expect(bullets).toHaveLength(1);
    expect(bullets[0]).toContain('Hana');
    expect(bullets[0]).toContain('Ravi');
    expect(bullets[0]).toContain('removed 3 options');
    expect(bullets[0]).toMatch(/requirements/);
  });

  it('returns no winner when nothing satisfies hard constraints', () => {
    const restaurants = [R({ id: 'non-halal', dietaryOptions: [] })];
    const ps = [P('Sal', prefs({ dietary: [{ type: 'halal', strict: true }] }))];
    const res = computeResult('fb', ps, restaurants);
    expect(res).toEqual({
      kind: 'no-verified-match',
      algorithmVersion: ALGORITHM_VERSION,
      eliminatedCount: 1,
      round: 1,
      previousWinners: [],
    });
    expect('winner' in res).toBe(false);
  });
});

describe('price utility', () => {
  it('budget zero when 2+ tiers over', () => {
    const p = prefs({ budget: 1 });
    expect(priceScore(p, R({ id: 'x', priceTier: 1 }))).toBe(1);
    expect(priceScore(p, R({ id: 'x', priceTier: 2 }))).toBe(0.35);
    expect(priceScore(p, R({ id: 'x', priceTier: 3 }))).toBe(0);
    expect(priceScore(p, R({ id: 'x', priceTier: 4 }))).toBe(0);
  });

  it('utility stays within [0,1]', () => {
    const u = utility(
      prefs({ cuisines: { Italian: 'like' } }),
      R({ id: 'x', rating: 5, priceTier: 1, distanceKm: 0.2 }),
    );
    expect(u).toBeLessThanOrEqual(1);
    expect(u).toBeGreaterThanOrEqual(0);
  });
});
