# Operation And Transport Contract

This document describes the current internal application contract. It is not a versioned public API commitment.

## Contract Layers

1. `shared/contracts.ts` defines strict Zod input schemas and response schemas.
2. `server/rest.ts` and `server/sockets.ts` parse untrusted input and create `OperationCommand` values.
3. `server/operations.ts` applies shared replay, quota, authorization, transition, projection, and effect behavior.
4. `server/store.ts` returns typed `DomainResult` values from authoritative state transitions.
5. `shared/failures.ts` maps failure kinds to a stable client error code, message, and HTTP status.

Adapters generate a UUID request ID when a mutation omits one. Socket acknowledgements contain the same body shape as REST responses, but no HTTP status.

## Operation Matrix

| Purpose            | Socket event         | REST endpoint                                                     | Authorization                                | Success                                                                  |
| ------------------ | -------------------- | ----------------------------------------------------------------- | -------------------------------------------- | ------------------------------------------------------------------------ |
| Create session     | `create`             | `POST /api/sessions`                                              | Public, quota-limited                        | Session identifiers, host and participant capabilities, private snapshot |
| Read invite        | None                 | `GET /api/sessions/:idOrCode`                                     | Public                                       | Minimal invite projection, `Cache-Control: no-store`                     |
| Join session       | `join`               | `POST /api/sessions/join`                                         | Public code/session reference, quota-limited | Participant capability and private snapshot                              |
| Attach presence    | `attach`             | None                                                              | Participant capability                       | Private snapshot and socket room attachment                              |
| Read current state | None                 | `GET /api/sessions/:idOrCode/state`                               | `Bearer` participant capability              | Private snapshot                                                         |
| Submit ballot      | `submit`             | `POST /api/sessions/:idOrCode/submit`                             | Participant capability in body               | `ok` and caller projection                                               |
| Leave session      | `leave`              | `POST /api/sessions/:idOrCode/leave`                              | Participant capability in body               | `ok`; host must end instead                                              |
| Remove participant | `remove-participant` | `POST /api/sessions/:idOrCode/participants/:participantId/remove` | Host capability                              | `ok`; target is evicted                                                  |
| Reveal result      | `reveal`             | `POST /api/sessions/:idOrCode/reveal`                             | Host capability                              | `ok`; private snapshots broadcast                                        |
| Rerun ranking      | `rerun`              | `POST /api/sessions/:idOrCode/rerun`                              | Host capability                              | `ok`; private snapshots broadcast                                        |
| End session        | `end`                | `POST /api/sessions/:idOrCode/end`                                | Host capability                              | `ok`; active state deleted                                               |

Create and join return HTTP `201`; successful REST state changes return `200`. Attach is socket-only because it establishes presence. The REST state read retrieves an authoritative projection but does not attach a client to realtime rooms.

## Input And Output Rules

- Request objects are strict: unknown keys fail Zod parsing.
- Nicknames are NFKC-normalized, stripped of selected HTML-significant characters, trimmed, and rejected when they contain control or format characters.
- Capabilities and session references have bounded lengths; payloads are bounded at both Express and Socket.IO layers.
- Server projections are viewer-specific. A host capability alone does not grant a participant snapshot.
- The client validates invite, create, join, state, mutation, and error responses before using them.
- Validation failures intentionally return a generic `invalid` result instead of schema internals.

Schema definitions, not this prose, are authoritative for field-level shapes.

## Replay And Fallback

Create, join, submit, leave, remove, reveal, rerun, and end are replay-aware. Attach and REST reads are not replay entries.

For each mutation, the operation service:

1. Builds a key from operation kind and request ID.
2. Fingerprints the command without the request ID.
3. Returns a stored successful response for an identical live replay.
4. Returns a conflict when the same key is reused with different command data.
5. Retains successful entries for 15 minutes in a bounded process-local map.

The browser sends a mutation through Socket.IO first. Only an acknowledged socket timeout triggers REST fallback, and fallback reuses the same request ID. Other socket failures are returned directly. A process restart or replay-window expiry removes this protection.

## Failure Contract

Failures use this body shape on both transports:

```json
{
  "error": "Human-readable summary",
  "errorCode": "machine-readable-code"
}
```

Client-visible codes include `invalid`, `not-found`, `expired`, `ended`, `full`, `locked`, `access-required`, `capacity`, `rate-limited`, `unavailable`, `timeout`, and `unknown`. Several internal failure kinds intentionally collapse into one client code. For example, token failures map to `access-required`, and request-ID conflicts currently map to `unknown` with HTTP `409`.

HTTP status classes are:

| Status | Meaning                                                             |
| -----: | ------------------------------------------------------------------- |
|  `400` | Invalid request shape                                               |
|  `401` | Missing/invalid bearer capability on REST state read                |
|  `403` | Capability or origin/HTTPS access failure                           |
|  `404` | Unknown session or participant                                      |
|  `409` | State conflict, full session, locked action, or request-ID conflict |
|  `410` | Known ended or expired session                                      |
|  `413` | REST payload exceeds the configured limit                           |
|  `429` | Quota exceeded                                                      |
|  `503` | Capacity or operation availability failure                          |

## Realtime Effects

The operation service emits transport-neutral effects. `SessionPresence` translates them into participant-specific state broadcasts and these client events:

| Event             | Meaning                                    |
| ----------------- | ------------------------------------------ |
| `state`           | New viewer-specific authoritative snapshot |
| `revealed`        | Reveal completed                           |
| `rerun`           | Rerun completed                            |
| `removed`         | This participant was removed or left       |
| `session-ended`   | Host ended the active session              |
| `session-expired` | Store deletion detected expiry             |

Presence is process-local and derived from attached sockets. Reconnect performs `attach` before the client marks realtime state ready.

## Adding Or Changing An Operation

- Change the shared Zod contract first.
- Add or update the `OperationCommand`, typed outcome, and store transition.
- Keep authorization and business rules below both adapters.
- Map both REST and socket adapters when the operation belongs on both transports.
- Add participant-safe projections and effects rather than broadcasting internal state.
- Test schema rejection, capability misuse, replay conflict, both adapters, and terminal states.
- Update this document and the threat model when the trust boundary changes.

See [ARCHITECTURE.md](ARCHITECTURE.md) for module ownership and [ADR 0004](adr/0004-dual-transports.md) for the dual-transport decision.
