# Architecture

TableVote is a TypeScript modular monolith: one React client, one Express and Socket.IO server, and one shared domain package.

## Boundaries

- `shared/` owns contracts, private/public projections, catalog normalization, and deterministic ranking. It uses neither browser-only nor Node-only APIs.
- `server/` owns authoritative session state, capabilities, quotas, mutation replay records, presence, and terminal cleanup.
- `src/lib/transport.ts` is the client's network boundary. It prefers acknowledged Socket.IO operations and falls back to REST after disconnection or timeout using the same request ID.
- `src/lib/use-session.ts` attaches capabilities, reconciles authoritative state, and handles terminal events.
- `src/pages/` renders product states without receiving another participant's ballot or detailed score.

## Session Model

The host and every participant receive independent opaque capability tokens. A short invite code is public discovery metadata, not authorization. Private state requires a participant capability; host-only mutations additionally require the host capability.

Session state is intentionally in memory. Active records expire exactly 24 hours after creation. Ended and expired sessions leave bounded, data-free terminal references so stale clients receive a truthful reason without retaining ballots.

## Mutation Reliability

Every mutation carries a UUID request ID. The server stores a bounded 15-minute fingerprint and response record. A duplicate request with the same operation and payload receives the original response; conflicting reuse is rejected.

Socket and REST handlers share those records. If a socket acknowledgement is lost, the client can retry over REST without repeating create, join, submit, leave, remove, reveal, rerun, or end side effects.

## Privacy Projections

Public invite responses contain only contextual invitation fields. Participant snapshots include group-safe state, the viewer's own identity and ballot, aggregate result bands, and the viewer's own winner fit. Internal scoring sheets and other ballots remain server-side.

Development-only local mode is different: it is a same-browser simulation backed by `localStorage` and `BroadcastChannel`. It has no confidentiality boundary between tabs and is not used by hosted production builds.

## Ranking

`shared/scoring.ts` is a pure, versioned decision function. It applies Required fixture evidence first, computes per-participant utilities, protects minority dissatisfaction through the minimum-utility term, and uses a complete deterministic tie ladder. Golden fixtures lock expected ordering and six-decimal totals.

## Deployment Boundary

The built server can serve static assets, REST, and sockets on one port. A public deployment would require an HTTPS-enforcing reverse proxy, exact allowed origins, a verified trusted-proxy count, redacted logs, durable state, and operational ownership. This repository does not maintain such a deployment.

## Deliberate Trade-offs

- In-memory state keeps the portfolio sample easy to run but makes restart recovery impossible.
- A generated catalog makes tests reproducible but cannot validate real restaurant quality.
- A single process simplifies atomic transitions but is not a multi-instance architecture.
- Accountless capabilities reduce onboarding friction but provide no account recovery.
