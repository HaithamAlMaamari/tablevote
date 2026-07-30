# Demo Data

TableVote includes a deterministically generated restaurant catalog so the complete flow can run without provider credentials.

Every record in `shared/restaurants.json` is fictional. Names, districts, ratings, distances, prices, availability, coordinates, and dietary evidence do not describe real venues. Coordinates are deliberately `0,0`, and the interface does not offer directions for fixture records.

## Reproducibility

```bash
npm run generate:catalog
npm run check:catalog
```

Generation is deterministic. `check:catalog` verifies that the committed catalog matches the generator rather than silently rewriting it.

## Dietary Evidence

Positive fixture tags are normalized into simulated `supported` evidence. Other explicit states exercise fail-closed filtering. These fields exist to test ranking behavior; they are not allergy, ingredient, cross-contamination, restaurant, or religious-compliance claims.

Do not replace fictional fields with scraped or unlicensed venue data. A real provider integration would require licensing, provenance, freshness policy, correction handling, and a separate safety review.

The generated fixture catalog is included under the repository's [MIT License](LICENSE).
