# Contributing to TableVote

Thanks for helping make group dinners less argumentative.

## Ground rules

- Be kind and constructive — see [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).
- Preserve the warm cream/terracotta/olive visual language, mobile-first shell, and accessible native controls.
- The fairness engine (`shared/scoring.ts`) is the heart of the product. Any change to
  scoring semantics must come with updated unit tests and an explanation in the PR of
  how outcomes change for minorities at the table.

## Setup

```bash
npm ci
npm run dev      # client :3000 + API :3001
```

## Before you open a PR

```bash
npm run lint
npm run check:docs
npm run check:repo
npm run check:catalog
npm test
npm run build
npm run test:browser
npm run audit:prod
npm run smoke:prod
```

All checks must be clean. Install the browser binaries once with `npx playwright install chromium firefox webkit`. Add tests for new scoring behavior, API surface, or critical browser flows.

## Architecture pointers

- `shared/` is imported by BOTH server and client — no Node- or DOM-only APIs in there.
- All network behavior goes through `src/lib/transport.ts` (socket mode + local demo mode).
  If you add a server op, mirror it in the local transport.
- Prototype server state is intentionally in memory (24h TTL, no database, no accounts).
  Treat durable persistence as a separate architectural change, not a small patch.
- Security: crypto-random tokens, zod-validate every input, rate-limit new endpoints that
  create resources.

## Commit style

Short imperative subject lines (`add copeland tiebreak test`). Reference issues where relevant.

## Reporting security issues

Do not open public issues for vulnerabilities or sensitive session data. Follow [SECURITY.md](SECURITY.md).
