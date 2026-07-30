## Problem And Scope

Describe the observed problem, the smallest solution, and what remains intentionally unchanged.

## Contract Impact

Explain changes to runtime schemas, typed failures, operations/adapters, capability scope, projections, state retention, deterministic ranking, or deployment trust. Write `None` when none apply.

## Verification

List the commands and focused scenarios run.

- [ ] `npm run verify` passes.
- [ ] `npm run verify:full` passes, or I explained why it is not applicable/feasible.
- [ ] Changed behavior has focused tests at the appropriate contract boundary.
- [ ] Ranking changes update deterministic fixtures and explain outcome changes.
- [ ] Privacy projections and capability boundaries remain participant-scoped.
- [ ] UI changes include redacted visual evidence and keyboard/accessibility review.
- [ ] Documentation and `CHANGELOG.md` reflect user-visible or architectural changes.
- [ ] No secrets, private session data, real venue claims, or generated build output were added.

## Documentation

Link changed operation, architecture, threat-model, ADR, or user guidance sections. If no documentation changed, explain why behavior and contracts are unchanged.
