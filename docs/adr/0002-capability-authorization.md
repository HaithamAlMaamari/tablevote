# ADR 0002: Use Capability-Based Authorization

- Status: Accepted
- Scope: Accountless session access

## Context

An invite code must be easy to share, while ballots and host actions must not be authorized by that public code. Adding accounts would change the prototype's product scope.

## Decision

Issue an opaque participant bearer capability to each member and a separate host capability to the creator. Treat the invite code as discovery metadata only. Authorize capabilities inside the selected session and construct viewer-specific projections on the server.

## Consequences

- Participants can join without accounts, and the host cannot read guest ballots through host privileges.
- Possession is authority: stolen capabilities can be replayed until session termination or expiry.
- Browser `localStorage`, same-origin scripts, devices, transport security, and logs become trust boundaries.
- There is no account recovery, revocation list, or durable identity history.
- Public invite responses must remain minimal and non-authorizing.
