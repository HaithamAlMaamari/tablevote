# ADR 0004: Keep REST And Socket.IO Transports

- Status: Accepted
- Scope: Client/server session operations and realtime updates

## Context

The product benefits from live presence and state updates, but socket acknowledgements can time out or disconnect. Duplicating business rules in REST and Socket.IO would create inconsistent authorization and retry behavior.

## Decision

Keep Socket.IO for acknowledged operations and realtime effects, with REST endpoints for mutation fallback and authoritative reads. Route mutation semantics through one transport-neutral `OperationService`. Reuse mutation request IDs across timeout fallback and retain bounded successful replay records.

## Consequences

- Realtime interaction and REST fallback share transitions, failures, and authorization.
- Adapters remain responsible for parsing, transport quotas, attachment context, and response mechanics.
- The system still carries two protocol surfaces and requires cross-transport tests.
- Replay guarantees are limited to one process and the configured retention window.
- Socket attach has no REST equivalent because it establishes presence; REST state reads do not establish presence.
