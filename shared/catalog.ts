import { DIETARY_TYPES, type DietaryEvidence, type DietaryType, type Restaurant } from './types';

export const DEMO_CATALOG_SOURCE = 'synthetic-fixture:not-real:v1';
export const DEMO_CATALOG_CHECKED_AT = '2026-07-30T00:00:00.000Z';

export type DemoRestaurantInput = Omit<Restaurant, 'dietaryEvidence'> & {
  dietaryOptions: DietaryType[];
};

export function normalizeDemoRestaurants(inputs: DemoRestaurantInput[]): Restaurant[] {
  return inputs.map(({ dietaryOptions, ...restaurant }) => ({
    ...restaurant,
    dietaryEvidence: Object.fromEntries(
      DIETARY_TYPES.map((type) => [
        type,
        {
          state: dietaryOptions.includes(type) ? 'supported' : 'unknown',
          source: DEMO_CATALOG_SOURCE,
          checkedAt: DEMO_CATALOG_CHECKED_AT,
        } satisfies DietaryEvidence,
      ]),
    ) as Record<DietaryType, DietaryEvidence>,
  }));
}
