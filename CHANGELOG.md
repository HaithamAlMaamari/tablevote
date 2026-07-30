# Changelog

Notable repository changes are recorded here using [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) categories. No release is implied until a real tag and release are published.

## [Unreleased]

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
- Supported runtimes are Node.js `22.22+` on Node 22 and Node.js `24+`.
- Verification guidance uses `npm run verify` and `npm run verify:full` without brittle test counts.
- Supported dependency policy now covers both production and build/test inventories without exceptions.

### Removed

- Browser-local session simulation and its separate transport behavior.

[Unreleased]: https://github.com/HaithamAlMaamari/tablevote/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/HaithamAlMaamari/tablevote/compare/v0.1.0...v1.0.0
