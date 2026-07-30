# Security Policy

TableVote is a portfolio prototype and has not received an independent security audit. The supported scope is the latest code on `main`; no public production service or older release line is maintained.

## Report A Vulnerability

Use [GitHub private vulnerability reporting](https://github.com/HaithamAlMaamari/tablevote/security/advisories/new). Do not open a public issue containing exploit details, capabilities, invite codes or URLs, authorization headers, ballots, dietary requirements, nicknames, exact locations, logs, or browser-storage values.

Include the affected revision, prerequisites, minimal reproduction, impact, and any suggested mitigation. Redact unrelated data. The maintainer will triage reports within available project capacity; this prototype does not promise a response or remediation SLA.

## Scope

Useful reports include:

- Cross-session or cross-participant capability authorization failures.
- Projection leaks of another participant's ballot, exact fit, or capability.
- Request replay that duplicates a mutation inside the documented replay window.
- Origin, forwarded-protocol, payload-limit, or quota bypasses in the checked-in server.
- Repository secrets or dependency issues with a demonstrated path in the current application.

The fictional quality of venue data, lack of durable persistence, process restart data loss, and absence of a hosted service are documented prototype limitations rather than vulnerabilities by themselves.

## Confirmed Boundaries

- Active state is held in one process and is lost on restart.
- Each active session is scheduled for deletion at its exact 24-hour deadline; store access also enforces the deadline as a backstop.
- Successful mutation replay records are process-local and retained for 15 minutes within a bounded map.
- Participant and host bearer capabilities are stored in browser `localStorage` while active.
- Production mode requires exact HTTPS origins and a positive trusted-proxy hop count, but deployment and TLS termination remain operator responsibilities.
- Originless non-browser clients are not rejected at the origin boundary and still rely on capability checks.

See the [threat model](docs/security/THREAT_MODEL.md) for controls and residual risks.

## Conduct Is Separate

Do not use private vulnerability reporting for harassment or other conduct concerns. Follow the reporting limitations and maintainer contact route in [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).
