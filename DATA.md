# Demo Data

TableVote ships with 40 generated restaurant fixtures so the complete group flow can run without API keys.

The records in `shared/restaurants.json` are fictional. Names, districts, ratings, distances, prices, availability, coordinates, and dietary tags do not describe real venues. The coordinates are deliberately set to `0,0`, and the interface does not offer map directions for fixture records.

Generate the catalog deterministically with:

```bash
npm run generate:catalog
```

Positive dietary tags become simulated `supported` evidence only inside the demo ranking fixture. They are useful for testing fail-closed filtering but are not restaurant, allergy, religious-compliance, or cross-contamination claims.

The MIT license covers this generated fixture catalog as part of the repository.
