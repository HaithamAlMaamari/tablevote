# Changelog

All notable changes to TableVote are documented here. Format based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); this project follows
[Semantic Versioning](https://semver.org/).

## [0.1.0] - 2026-07-30

### Added
- Accountless host/guest sessions with private ballots, live roster updates, reveal, and reruns.
- Versioned deterministic fairness ranking with aggregate audit components and golden fixtures.
- Fail-closed dietary evidence states with source and checked-time provenance.
- Explicit `no-verified-match`, locking, ended, expired, removed, access-required, and offline states.
- Cross-transport UUID mutation idempotency and Socket.IO-to-REST fallback.
- Participant-private projections, opaque capability identities, and operation-complete authorization tests.
- Bounded per-IP, per-socket, per-session, and process-wide quotas.
- Fail-closed production HTTPS/WSS, fixed-origin, and trusted-proxy configuration.
- Exact terminal deletion, reconnect reconciliation, accessibility automation, and responsive browser flows.
- Bundled production server, dependency policy, secret scanning, and production smoke gates.
- Threat model, architecture case study, and deterministic demo catalog generator.

### Changed
- Required dietary items are never relaxed; unsupported, contradicted, unknown, and stale evidence is ineligible.
- Reconnects reattach the participant capability and reconcile authoritative state before returning to live.
- Browser-local mode is explicit and development-only; production never silently falls back.
- Group results expose aggregate fit bands and only the viewer's own ballot and fit.
- Arabic and English nicknames use NFKC normalization and reject control and format characters.
- Production starts from compiled JavaScript and requires explicit secure proxy configuration.

### Fixed
- Stable canonical tie ordering and aggregate scoring reconciliation.
- Safe no-match and terminal lifecycle guards across REST, Socket.IO, and browser routes.
- Duplicate-name identity, reconnect, expiry, responsive reveal, and reduced-motion regressions.

[0.1.0]: https://github.com/HaithamAlMaamari/tablevote/releases/tag/v0.1.0
