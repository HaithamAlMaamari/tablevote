# Contributing To TableVote

TableVote is a portfolio prototype with intentionally narrow product and deployment boundaries. Contributions should make those boundaries clearer rather than imply production guarantees.

## Before Starting

- Follow the [Code of Conduct](CODE_OF_CONDUCT.md).
- Use the structured [question/support form](https://github.com/HaithamAlMaamari/tablevote/issues/new?template=question.yml) for scoped usage or contributor questions.
- Use [SECURITY.md](SECURITY.md), not a public issue, for vulnerabilities or sensitive security details.
- Never publish live invite codes, capabilities, authorization headers, ballots, dietary requirements, nicknames, exact locations, or unredacted logs.

## Setup

Requires Node.js `22.22+` within Node 22, or Node.js `24+`.

```bash
npm ci
npm run dev
```

The client runs at `http://localhost:3000` and proxies the API/socket server at `http://localhost:3001`.

## Architecture Rules

- Keep browser-only and Node-only APIs out of `shared/`.
- Define network inputs and outputs as shared runtime Zod schemas, not TypeScript-only interfaces.
- Keep domain failures typed and transport-neutral.
- Put authorization and state transitions in `OperationService`/`SessionStore`, not independently in REST and socket handlers.
- Map operations through both thin adapters when both transports support them.
- Construct viewer-specific projections on the server; never rely on the UI to hide private fields.
- Treat the in-memory store as a deliberate prototype decision. Persistence is a new architecture, not a small adapter.
- Preserve deterministic ranking semantics. Explain any weight, precision, filtering, or tie change and update golden scenarios.
- Do not reintroduce browser-local session simulation; the supported development flow uses the server.

Read the [documentation index](docs/README.md), [architecture guide](docs/ARCHITECTURE.md), and [operation contract](docs/OPERATIONS.md) before changing a cross-cutting behavior.

## Verification

Run the standard repository gate:

```bash
npm run verify
```

For transport, lifecycle, deployment, accessibility, or critical UI changes, also run:

```bash
npx playwright install chromium firefox webkit
npm run verify:full
```

Add focused tests for changed contracts, operation outcomes, capability boundaries, projections, ranking behavior, and user-visible failure states. Test counts are not a quality target and should not be copied into documentation.

## Documentation Changes

- Update `docs/OPERATIONS.md` when an operation, route, socket event, response, failure, or retry rule changes.
- Update `docs/security/THREAT_MODEL.md` when data exposure, authorization, retention, or deployment trust changes.
- Add or supersede an ADR when changing an accepted architectural decision.
- Keep `CHANGELOG.md` under `Unreleased` until a real release is published.
- Run `npm run check:docs` and avoid links to planned files that do not exist.

## Pull Requests

Keep the change as small as the problem permits. In the pull request, explain the observed problem, chosen behavior, privacy/ranking implications, and verification performed. Include visual evidence only when the UI changed, and redact all session data.

Use short imperative commit subjects, for example `document socket fallback contract`. Reference an issue when one exists.

## Releases

Protected `main` must be green before release. A maintainer updates `package.json` and `CHANGELOG.md`, merges the change through a pull request, then pushes the matching `v<version>` tag at the protected `main` commit. The release workflow verifies both references, reruns the source gate, and publishes the source archive, CycloneDX SBOM, and checksums.
