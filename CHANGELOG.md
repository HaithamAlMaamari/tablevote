# Changelog

Notable repository changes are recorded here using [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) categories. No release is implied until a real tag and release are published.

## [Unreleased]

## [1.0.1] - 2026-07-30

### Changed

- Socket admission now reserves capacity at the Engine.IO handshake boundary, including raw unauthenticated transports.
- Result and submit responses use stricter runtime contracts with supported algorithm-version and finalist invariants.
- Terminal deletion purges session replay records while retaining only the safe idempotent end response.
- Runtime support is constrained to the tested Node.js 22 and 24 LTS lines.
- Routine runtime, build, browser, and pinned GitHub Action dependencies were refreshed after full verification.

### Fixed

- Failed ranking calculations rebroadcast the restored pre-lock state instead of leaving clients visually locked.
- Each browser engine now runs against fresh bounded server state, and rerun focus survives delayed WebKit dialog restoration.
- The loopback production harness now supplies every required startup variable, including `HOST`.
- Stale local-mode, scaffold, logo, audit-threshold, and documentation references were removed or corrected.

## [1.0.0] - 2026-07-30

### Added

- Shared runtime Zod contracts for requests, responses, snapshots, and validation at network boundaries.
- Typed transport-neutral domain failures and operation outcomes.
- A transport-neutral operation service with bounded cross-transport mutation replay.
- Injectable session-store dependencies for deterministic state and lifecycle testing.
- Documentation index, operation contract, architecture decisions, and structured question/support intake.
- Exact scheduled session expiry, bounded socket admission, and real-process production smoke coverage.
- Seeded ranking invariants, REST/Socket parity tests, and enforced core coverage thresholds.
- A reproducible evaluator walkthrough, social preview, and table-ticket visual system.
- Tag-verified release automation with a source archive, CycloneDX SBOM, and SHA-256 checksums.

### Changed

- REST and Socket.IO handlers are thin adapters over shared operation semantics.
- The client validates server responses and reuses request IDs when socket timeouts fall back to REST.
- Active sessions now use exact scheduled expiry with access-time checks as a backstop and bounded terminal references.
- Supported runtimes are Node.js `22.22+` on Node 22 and Node.js 24.
- Verification guidance uses `npm run verify` and `npm run verify:full` without brittle test counts.
- Supported dependency policy now covers both production and build/test inventories without exceptions.

### Removed

- Browser-local session simulation and its separate transport behavior.

[Unreleased]: https://github.com/HaithamAlMaamari/tablevote/compare/v1.0.1...HEAD
[1.0.1]: https://github.com/HaithamAlMaamari/tablevote/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/HaithamAlMaamari/tablevote/compare/v0.1.0...v1.0.0
