import { describe, expect, it } from 'vitest';
import { DEMO_CATALOG_CHECKED_AT, DEMO_CATALOG_SOURCE, normalizeDemoRestaurants } from './catalog';

describe('demo catalog dietary evidence adapter', () => {
  it('maps positive tags to supported and every missing tag to explicit unknown evidence', () => {
    const [restaurant] = normalizeDemoRestaurants([
      {
        id: 'demo',
        name: 'Demo',
        cuisines: ['Omani'],
        priceTier: 2,
        rating: 4.2,
        distanceKm: 1,
        lat: 23.5,
        lng: 58.3,
        address: 'Muscat',
        openNow: true,
        dietaryOptions: ['halal'],
      },
    ]);

    expect(restaurant.dietaryEvidence.halal).toEqual({
      state: 'supported',
      source: DEMO_CATALOG_SOURCE,
      checkedAt: DEMO_CATALOG_CHECKED_AT,
    });
    expect(restaurant.dietaryEvidence.vegan).toEqual({
      state: 'unknown',
      source: DEMO_CATALOG_SOURCE,
      checkedAt: DEMO_CATALOG_CHECKED_AT,
    });
    expect(Object.keys(restaurant.dietaryEvidence)).toHaveLength(5);
  });
});
