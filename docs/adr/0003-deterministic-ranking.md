# ADR 0003: Use Deterministic Consensus Ranking

- Status: Accepted
- Scope: Ranking fictional catalog candidates

## Context

The same submitted ballots should produce an inspectable, reproducible result. Required dietary constraints must not be weakened merely to return a winner.

## Decision

Filter candidates by required simulated evidence before scoring. Rank the remainder with fixed-precision participant utility and a weighted group total combining mean utility, minimum utility, and normalized Borda points. Resolve near ties by least misery, Copeland comparison, then canonical candidate ID. Version the algorithm and return an explicit no-verified-match result for an empty eligible set.

## Consequences

- Identical normalized inputs and catalog data produce stable ordering.
- Minority dissatisfaction affects the result but is not guaranteed to dominate it.
- Weights, the near-tie threshold, and tie order are product policy and need user validation.
- Fictional evidence demonstrates fail-closed behavior but cannot establish real dietary safety.
- Any semantic change requires updated deterministic fixtures and an explanation of outcome changes.
