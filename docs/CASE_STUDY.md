# Technical Case Study

## Problem

Group restaurant decisions mix incompatible preferences, privacy concerns, and social pressure. A visible poll can encourage strategic voting and can expose sensitive dietary requirements.

TableVote explores a narrower question: can an accountless group submit private ballots and receive one deterministic, inspectable recommendation without silently relaxing a hard requirement?

## Product Principles

- Tell the truth when no candidate satisfies the group.
- Keep individual ballots private, including from the host.
- Make every tie deterministic and reproducible.
- Prefer explicit unknown states over inferred restaurant facts.
- Keep the main flow usable with keyboard, reduced motion, and narrow screens.

## Key Decisions

### Fail closed before ranking

Required dietary states are eligibility constraints, not soft score bonuses. A candidate with unknown, stale, or contradicted evidence is removed. If every candidate is removed, the system returns no match.

The public repository uses only simulated evidence attached to fictional records. The model demonstrates the behavior but makes no real restaurant claim.

### Balance average fit and minority protection

The group score combines mean utility with the least-satisfied participant and normalized rank points. This allows a broadly acceptable candidate to outrank one that most people love but one person strongly dislikes.

### Keep retries idempotent

Realtime acknowledgements can be lost. Assigning every mutation a request ID lets the same operation safely cross from Socket.IO to REST without duplicating side effects.

### Project only what each viewer needs

The server computes detailed internal rows but sends each participant only group-safe bands and that participant's own ballot and fit. Privacy is enforced by response construction rather than UI convention.

## Verification Strategy

- Golden ranking scenarios prove deterministic totals and ordering.
- API and Socket.IO matrices test every capability against wrong sessions and wrong operation classes.
- Quota saturation tests prove counters and retained references stay bounded.
- Browser tests use separate contexts to exercise actual privacy boundaries.
- Chromium, Firefox, and WebKit run responsive, keyboard, motion, forced-color, text-spacing, and axe checks.
- Repository and documentation guards prevent common publication mistakes.

## What I Would Change for Production

- Replace fixtures with licensed provider adapters and field-level provenance.
- Store sessions and replay records transactionally in PostgreSQL.
- Hash persisted capabilities and add backup/restore exercises.
- Add staging, redacted observability, incident ownership, and an HTTPS-enforcing edge.
- Validate the flow with real groups before changing ranking weights or expanding scope.

## What This Project Demonstrates

The project is intentionally more than a UI mock: it demonstrates shared-domain TypeScript, deterministic algorithms, realtime lifecycle design, capability-based authorization, privacy projections, failure modeling, accessibility automation, deployment hardening, and evidence-driven technical trade-offs.
