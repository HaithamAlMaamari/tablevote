# TableVote Prototype Threat Model

Status: Maintainer self-assessment; not an independent audit
Last reviewed: 2026-07-30
Scope: Accountless sessions using a generated fictional catalog

## Security Objectives

1. A public invite code reveals only join metadata and a temporary host nickname when the host explicitly permits it.
2. Participant and host capabilities remain confidential and authorize only their intended scope.
3. No participant, including the host, can retrieve another participant's raw ballot or exact fit.
4. Required dietary items are never relaxed and unknown compatibility never becomes a fallback winner.
5. Raw session state becomes unavailable after explicit end or the 24-hour deadline.
6. Resource use remains bounded under malformed, repeated, and oversized traffic.

## Assets

| Asset | Sensitivity | Required protection |
|---|---|---|
| Participant capability | High | Never public or cross-session; TLS in transit; deleted at terminal state |
| Host capability | High | Same as participant capability; required for host mutations |
| Raw ballot | High | Visible only to its owner and authoritative server process |
| Roster and submission status | Moderate | Participant-scoped; absent from public invite projection |
| Result and private own-fit | Moderate | Participant-scoped; no cross-user exact values |
| Required dietary items | High | Private ballot data; only aggregate-safe result wording |
| Invite code, area label, and consented host nickname | Low to moderate | Shareable but rate-limited and non-authorizing for private state; nickname defaults private |
| Internal scoring rows | High | Server-only; never serialized to participant snapshots |

## Actors

| Actor | Capabilities and goals |
|---|---|
| Participant | Holds one participant capability; may inspect or modify client traffic |
| Host | Holds participant and host capabilities; may attempt to retrieve guest ballots |
| Invite holder | Knows only a five-character public code; may fill participant slots |
| Network attacker | May observe or alter plaintext traffic if deployment omits TLS |
| Cross-site attacker | May initiate socket/HTTP requests from another origin |
| Resource attacker | May distribute requests across addresses to consume sessions, slots, or limiter memory |
| Operator | Can inspect process memory and infrastructure logs; must not add prohibited logging |
| Dependency attacker | Attempts supply-chain or secret compromise through packages and repository content |

## Trust Boundaries

```text
Browser localStorage
  | participant/host capabilities
  v
TLS reverse proxy (mandatory for public deployment)
  | trusted proxy hop count and fixed origin allowlist
  v
Express + Socket.IO process
  | raw in-memory sessions and scoring details
  v
Bundled read-only demo restaurant catalog
```

The invite-code boundary is public. The participant-capability boundary is private. Host status does not cross the raw-ballot boundary. Local storage is not protected from scripts running in the same origin or a compromised device.

## Authorization Matrix

| Operation | Public code | Participant capability | Host capability | Projection/result |
|---|---:|---:|---:|---|
| Read invite metadata | Yes | Not needed | Not needed | Code, area, expiry, joinable, and optional consented host nickname only |
| Join collecting session | Yes | Issued on success | No | Own capability and participant snapshot |
| Read private state | No | Required for same session | Host participant capability only | Roster, own ballot, own fit, aggregate-safe result |
| Submit or edit ballot | No | Required for same participant | Host token alone is insufficient | No other ballot returned |
| Leave | No | Required for leaving participant | Host token alone is insufficient | Capability invalidated |
| Remove participant | No | No | Required for same session | Target receives data-free removal event |
| Reveal or rerun | No | No | Required for same session | Participant-private snapshots |
| End session | No | No | Required for same session | Raw state deleted; data-free terminal event |
| Reattach | No | Required for same participant/session | Host participant capability works as participant | Authoritative private snapshot |

## Threats And Controls

| Threat | Current controls | Residual risk |
|---|---|---|
| Invite enumeration | Ambiguity-free random code, create/join rate limits, minimal no-store public projection, host nickname sharing default-off | Five-character space is not an authentication boundary; a consented nickname is enumerable for the session lifetime |
| Capability theft in transit | Production mode requires a trusted proxy and rejects requests not forwarded as HTTPS/WSS | This repository does not maintain or certify a public deployment |
| Cross-origin socket use | Production requires exact HTTPS origins for HTTP and Socket.IO traffic | Non-browser clients without an Origin header remain capability-authorized |
| Cross-session authorization | Capability lookup occurs inside the selected session; private rooms, snapshots, and operation-complete negative tests | Active bearer capabilities remain vulnerable to same-origin script or device compromise |
| Host reads guest ballot | Snapshot projects only viewer's own ballot and fit | Raw tokens remain in server memory |
| Dietary fallback | Every type has explicit simulated evidence; only supported is eligible; no-match has no winner | Fixtures are fictional and cannot support real dietary or allergy decisions |
| Duplicate mutations | Client UUIDs, bounded cross-transport replay records, payload-conflict rejection, and locking | Replay records are process-local and do not survive restart or multi-instance deployment |
| Oversized or distributed traffic | REST and Socket.IO capped at 64 kB; per-IP, per-socket, per-session, and process ceilings | A distributed attacker can consume a bounded global quota and temporarily deny service |
| Memory exhaustion | 10,000 active and terminal-session ceilings, participant cap, bounded limiter/replay maps, TTL cleanup | Limits are process-local and require redesign before multi-instance deployment |
| Participant-slot denial | Twelve-participant cap and per-address limits | One invite holder can consume all guest slots within the current limit |
| Stale offline client | Reattach before live, terminal-error mapping, linked storage cleanup | Must remain covered by offline terminal browser tests |
| Local storage retention | Exact expiry, startup sweep, linked reference cleanup | Same-origin script/device compromise can read active capabilities |
| Deceptive identity | NFKC normalization; control/format characters rejected | Confusable visible Unicode characters are not detected |
| Sensitive logs/analytics | Application emits no ballot analytics and payload tests scan projections | Infrastructure access logs and future analytics need explicit allowlists |
| Supply-chain secret exposure | Lockfile, production audit policy, full-history checkout, CI secret scan, and committed successful CI history | Future dependencies and repository history still require continuous scanning and review |

## Deployment Requirements

1. Terminate HTTPS and WSS at a trusted reverse proxy.
2. Set `ALLOWED_ORIGINS` to the exact public HTTPS origin set.
3. Set `TRUST_PROXY_HOPS` only after verifying the proxy topology.
4. Do not log authorization headers, socket payloads, ballot bodies, or local-storage values.
5. Restrict process-memory and diagnostic-dump access to operators with a documented need.
6. Run dependency policy, secret scan, unit/integration tests, browser tests, build, and production smoke before deployment.

## Prototype Boundary

The controls above describe the repository implementation. Public hosting would additionally require durable state, an HTTPS-enforcing edge, verified proxy extraction, redacted infrastructure logs, operational ownership, and an independent review appropriate to the deployment.
