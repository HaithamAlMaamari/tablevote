# ADR 0001: Use Process-Local In-Memory State

- Status: Accepted
- Scope: Prototype session, replay, presence, quota, and terminal state

## Context

The prototype needs atomic session transitions, deterministic tests, and a zero-service local setup. It does not operate a public service or promise recovery after restart.

## Decision

Keep authoritative state in one Node.js process. Make `SessionStore` injectable and allow tests to provide state, clock, scheduler, catalog, and token generation. Enforce bounded maps and a session deadline, but do not introduce a database abstraction that the runtime does not use.

## Consequences

- Local setup and transition testing remain simple.
- Restart loses sessions, capabilities, replay records, presence, and terminal reasons.
- Multiple application instances would diverge and are unsupported.
- Each session schedules passive expiry for its exact deadline; access-time checks remain a backstop.
- Durable deployment requires a new transactional design, not a transparent configuration switch.
