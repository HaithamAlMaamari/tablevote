import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const cuisines = [
  'Italian',
  'Indian',
  'Lebanese',
  'Japanese',
  'Turkish',
  'American',
  'Seafood',
  'Vegetarian',
  'Fast Food',
  'Cafe',
  'Omani',
  'Thai',
];
const dietaryPatterns = [
  ['vegetarian', 'halal'],
  ['halal'],
  ['vegetarian', 'vegan'],
  ['vegetarian', 'kosher'],
  ['halal', 'gluten-free'],
  [],
];
const allDietaryTypes = ['vegetarian', 'vegan', 'halal', 'kosher', 'gluten-free'];

const catalog = Array.from({ length: 40 }, (_, index) => {
  const number = index + 1;
  const primary = cuisines[index % cuisines.length];
  const secondary = index % 3 === 0 ? cuisines[(index * 5 + 3) % cuisines.length] : null;
  return {
    id: `demo-${String(number).padStart(2, '0')}`,
    name: `Demo ${primary} Table ${String(number).padStart(2, '0')}`,
    cuisines: [...new Set([primary, secondary].filter(Boolean))],
    priceTier: (index % 4) + 1,
    rating: Number((3.6 + ((index * 7) % 14) / 10).toFixed(1)),
    distanceKm: Number((0.5 + ((index * 13) % 95) / 10).toFixed(1)),
    lat: 0,
    lng: 0,
    address: `Fictional District ${String.fromCharCode(65 + (index % 5))}`,
    dietaryOptions: index === 0 ? allDietaryTypes : dietaryPatterns[index % dietaryPatterns.length],
    openNow: index % 4 !== 0,
  };
});

const output = fileURLToPath(new URL('../shared/restaurants.json', import.meta.url));
const serialized = `${JSON.stringify(catalog, null, 2)}\n`;
if (process.argv.includes('--check')) {
  const current = await readFile(output, 'utf8');
  if (current !== serialized)
    throw new Error('shared/restaurants.json is not generated from scripts/generate-demo-catalog.mjs');
  console.log('Fictional catalog is reproducible.');
} else {
  await writeFile(output, serialized);
}
