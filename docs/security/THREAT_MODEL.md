# TableVote Prototype Threat Model

- Status: Maintainer self-assessment; not an independent audit
- Last reviewed: 2026-07-30
- Scope: Accountless sessions, generated fictional catalog, single Node.js process

## Security Objectives

1. Treat the invite code as public discovery metadata, never as private-state authorization.
2. Scope participant and host capabilities to the selected session and intended operation class.
3. Prevent participants, including the host, from retrieving another participant's raw ballot or exact fit through application projections.
4. Never turn unknown, stale, or contradicted required dietary evidence into an eligible fixture.
5. Deny operations once expiry is detected or the host ends a session, and remove raw active state at that transition.
6. Bound process-local sessions, participants, payloads, replay entries, quota keys, and terminal references.

These are repository design objectives, not claims about an operated public service.

## Assets

| Asset                                  | Sensitivity     | Current handling                                                                                        |
| -------------------------------------- | --------------- | ------------------------------------------------------------------------------------------------------- |
| Participant capability                 | High            | Bearer value in browser `localStorage` and active server memory; required for participant state/actions |
| Host capability                        | High            | Separate bearer value in browser `localStorage` and active server memory; required for host mutations   |
| Raw ballot and dietary requirements    | High            | Active server memory plus the owner's browser draft/snapshot; omitted from other projections            |
| Internal scoring rows and exact fits   | High            | Active server memory; only the viewer's own winner fit is projected                                     |
| Roster, submission, and presence state | Moderate        | Participant projection only                                                                             |
| Invite code and area label             | Low to moderate | Public invite projection and terminal reference; code is not authorization                              |
| Optional host nickname                 | Moderate        | Public only when the host explicitly enables sharing and provides a nickname                            |
| Replay response                        | Variable        | Bounded process-local retention; create/join responses can contain capabilities                         |

## Actors

| Actor               | Capability and likely goal                                                            |
| ------------------- | ------------------------------------------------------------------------------------- |
| Participant         | Holds one participant capability and can inspect or alter its client traffic          |
| Host                | Holds participant and host capabilities and may attempt to exceed host scope          |
| Invite holder       | Knows a public five-character code and may consume available participant slots        |
| Cross-site attacker | Sends browser-originated HTTP or socket requests from an unapproved origin            |
| Network attacker    | Observes or changes plaintext traffic when a deployment omits a correct TLS boundary  |
| Resource attacker   | Distributes malformed or repeated traffic to consume bounded process resources        |
| Operator            | Can inspect process memory, diagnostics, proxy configuration, and infrastructure logs |
| Dependency attacker | Attempts compromise through packages or repository history                            |

## Trust Boundaries

```text
Browser localStorage
  | participant and host bearer capabilities
  v
HTTPS/WSS reverse proxy (required for public deployment)
  | exact origins and verified trusted-proxy topology
  v
Express + Socket.IO adapters
  | parsed shared contracts
  v
Operation service + in-memory store
  | raw ballots, capabilities, replay responses, scoring details
  v
Participant-specific projections + fictional read-only catalog
```

The browser origin and device are trusted with active capabilities. An XSS flaw, malicious same-origin script, browser extension, device compromise, process-memory disclosure, or unsafe diagnostic dump can cross that boundary. Accountless bearer capabilities provide no recovery proof.

## Authorization Matrix

| Operation                |        Invite code |           Participant capability |                  Host capability | Returned data                                 |
| ------------------------ | -----------------: | -------------------------------: | -------------------------------: | --------------------------------------------- |
| Read invite              |    Locates session |                       Not needed |                       Not needed | Minimal public invite projection              |
| Join collecting session  |    Locates session |                Issued on success |                               No | New participant capability and own projection |
| Attach socket/read state | Does not authorize |        Required for same session | Host token alone is insufficient | Viewer-specific snapshot                      |
| Submit/edit ballot       | Does not authorize |    Required for same participant | Host token alone is insufficient | Own updated projection                        |
| Leave                    | Does not authorize | Required for leaving participant |            Host must end instead | No private state                              |
| Remove participant       | Does not authorize |                   Not sufficient |        Required for same session | No private state; target evicted              |
| Reveal/rerun             | Does not authorize |                   Not sufficient |        Required for same session | Participant-specific broadcasts               |
| End                      | Does not authorize |                   Not sufficient |        Required for same session | Active state removed; terminal event          |

Capabilities are looked up inside the selected session. Public invite responses expose code, area label, expiry, joinability, and only a consented host nickname. Participant projections include the viewer's own ballot and own winner fit, never another raw ballot or exact fit.

## Expiry And Deletion Semantics

The active deadline is 24 hours after creation. Each session receives an exact scheduled deletion, and every store lookup also compares the clock with that deadline before returning.

Consequences:

- A request at or after the deadline cannot retrieve or mutate the active session.
- Process suspension or event-loop starvation can delay JavaScript timers; the access-time check still prevents an overdue session from being returned.
- A passive attached client may not receive `session-expired` at the exact deadline; notification occurs when deletion is detected.
- Deletion removes the active session object containing ballots and capabilities.
- A bounded terminal reference containing code, reason, and removal time remains for up to another 24 hours from deletion so stale clients can receive `expired` or `ended`.
- Process restart clears active sessions, replay entries, presence, and terminal references immediately because none are durable.

## Threats And Controls

| Threat                      | Current controls                                                                                                            | Residual risk                                                                                                               |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Invite enumeration          | Random ambiguity-reduced code, minimal no-store invite projection, join/create quotas, host nickname sharing off by default | The short code is intentionally shareable and not an authentication boundary; distributed guessing remains possible         |
| Capability theft in transit | Production mode requires configured trusted proxy hops, forwarded HTTPS/WSS, and exact HTTPS origins                        | Repository does not operate the edge; misconfigured infrastructure or non-TLS development traffic remains exposed           |
| Cross-origin browser use    | Production checks configured exact origins for HTTP requests carrying Origin and Socket.IO handshakes                       | Originless non-browser clients are admitted to the transport and rely on capability authorization                           |
| Cross-session access        | Session-scoped capability lookup, viewer-specific rooms/projections, negative authorization tests                           | A stolen live bearer capability grants its intended scope                                                                   |
| Host reads guest ballot     | Host and participant capabilities are separate; projections expose only viewer-owned ballot/fit                             | Host can still observe social metadata and an operator can inspect memory                                                   |
| Dietary fallback            | Only `supported` simulated evidence satisfies a required item; empty pool returns no verified match                         | Fixtures provide no real allergy, religious-compliance, or cross-contamination assurance                                    |
| Duplicate mutation          | UUID request IDs, payload fingerprint, conflict response, bounded successful replay cache shared by adapters                | Cache is process-local, expires after 15 minutes, and is not durable or multi-instance safe                                 |
| Oversized traffic           | Express and Socket.IO payload limits plus global, address, socket, and session quotas                                       | Distributed traffic can exhaust bounded global capacity and deny service                                                    |
| Memory exhaustion           | Caps on sessions, participants, terminal references, replay entries, and quota keys                                         | Limits are per process and need operational sizing and distributed controls                                                 |
| Participant-slot denial     | Participant cap and join quotas                                                                                             | An invite holder can still fill available slots                                                                             |
| Stale client                | Reattach reconciles state; terminal reasons and events map to explicit UI states                                            | Passive notification follows detection, not the exact deadline                                                              |
| Browser retention           | Identities carry expiry and client loading/sweeping removes detected stale records                                          | Active values remain readable to same-origin code and local device users                                                    |
| HTTP response caching       | Successful public invite responses set `Cache-Control: no-store`                                                            | The authenticated REST state route does not currently set an explicit no-store policy; deployment caches must not retain it |
| Deceptive nickname          | NFKC normalization and rejection of control/format characters                                                               | Visually confusable Unicode remains possible                                                                                |
| Sensitive logging           | Application code does not intentionally log operation payloads; proxy harness uses path-free access logs                    | Future middleware, platform logs, traces, and crash dumps need explicit redaction review                                    |
| Supply-chain compromise     | Lockfile, dependency policy, repository hygiene checks, tests, and CI                                                       | Future packages and repository history still require review and scanning                                                    |

## Deployment Requirements

1. Terminate HTTPS and WSS at a controlled reverse proxy.
2. Set `ALLOWED_ORIGINS` to exact public HTTPS origins.
3. Set `TRUST_PROXY_HOPS` only after verifying the actual proxy path.
4. Reject or separately authenticate originless clients if the deployment does not need them.
5. Never log capabilities, authorization headers, socket payloads, ballots, invite URLs, or browser storage.
6. Restrict process memory, diagnostic dumps, and infrastructure logs.
7. Replace process-local state before horizontal scaling or recovery promises.
8. Run `npm run verify:full` and perform a deployment-specific security review before exposure.

See [SECURITY.md](../../SECURITY.md) for private vulnerability reporting and [deployment/README.md](../../deployment/README.md) for the loopback proxy harness.
