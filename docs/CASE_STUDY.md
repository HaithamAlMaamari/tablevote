# Technical Case Study

## Question

Group restaurant decisions combine incompatible preferences, private dietary information, and social pressure. TableVote tests a narrow product question: can an accountless group submit private ballots and receive one reproducible recommendation without silently relaxing a required constraint?

The project uses fictional records and is evaluated as an engineering prototype. It does not validate the ranking weights with users, verify real restaurant facts, or claim a production security posture.

## Product Rules

- Return no verified match when every fixture fails a required dietary constraint.
- Keep each raw ballot private from other participants, including the host.
- Produce the same ranking and tie outcome for the same normalized inputs.
- Represent unknown or contradicted evidence explicitly rather than infer support.
- Preserve keyboard, narrow-screen, reduced-motion, and forced-color usability.

## Engineering Approach

### One runtime contract

Requests and responses are Zod schemas in `shared/contracts.ts`. Server adapters parse untrusted inputs with those schemas, while the client parses responses before state enters the UI. Inferred TypeScript types reduce drift but do not replace runtime validation.

### One operation path

Earlier transport-specific behavior was consolidated into `OperationService`. REST and Socket.IO now translate into the same commands, typed outcomes, and side-effect descriptions. The service depends on an injectable `SessionStore`, not on either network framework, so authorization and transitions can be tested without opening a port.

### Scoped projections

The store holds full ballots and scoring details. Projection functions construct either minimal public invite data or a participant-specific snapshot. Privacy therefore depends on server response construction, not on hiding fields in React.

### Deterministic ranking

Required simulated evidence filters first. Remaining candidates receive per-ballot utility, then a weighted aggregate of mean utility, minimum utility, and normalized Borda points. Fixed precision and a complete tie ladder make results reproducible. These choices are explicit policy, not a mathematically neutral definition of fairness.

### Cross-transport retries

The client prefers acknowledged socket mutations. After a socket timeout it retries through REST with the same UUID. The operation service retains bounded successful replay records so that fallback does not intentionally duplicate side effects within the replay window.

## Verification

The default verification pipeline checks formatting, lint, documentation links, repository hygiene, deterministic catalog generation, tooling tests, application tests, dependency policy, and both client/server builds. The full pipeline adds built browser flows and a production smoke test.

Tests focus on ranking fixtures, schema boundaries, operation outcomes, capability misuse, projections, lifecycle behavior, quotas, transport fallback, and browser accessibility/product flows. Counts are intentionally omitted because the suite changes with the implementation.

## Trade-offs

| Choice                                | Benefit                             | Cost                                                       |
| ------------------------------------- | ----------------------------------- | ---------------------------------------------------------- |
| Process-local state                   | Simple atomic transitions and setup | No restart recovery, horizontal scaling, or durable replay |
| Bearer capabilities                   | Accountless flow                    | Theft grants access; no identity recovery                  |
| Fictional generated catalog           | Reproducible and API-key free       | No real venue or dietary validity                          |
| Two transports, one operation service | Realtime UX with fallback           | More adapter and lifecycle surface than REST alone         |
| Fixed ranking policy                  | Reproducible outcomes               | Weights still require product validation                   |

## Production Delta

A production implementation would need licensed provider adapters with field-level provenance, transactional durable state, hashed stored capabilities, multi-instance presence and replay coordination, deployment-owned TLS and proxy configuration, redacted observability, backup/restore exercises, incident response, and independent security review. Ranking weights and explanations should be evaluated with real consenting groups before being treated as product policy.

See the [architecture guide](ARCHITECTURE.md), [operation contract](OPERATIONS.md), [ADRs](README.md#architecture-decisions), and [threat model](security/THREAT_MODEL.md).
