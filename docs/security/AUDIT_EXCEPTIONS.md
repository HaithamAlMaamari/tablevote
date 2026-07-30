# Production Dependency Audit Exceptions

## React Router RSC CSRF Advisory

Advisory: [GHSA-qwww-vcr4-c8h2](https://github.com/advisories/GHSA-qwww-vcr4-c8h2)
Dependency: `react-router@7.18.1`
Status: Temporarily accepted for the current SPA architecture

The advisory affects React Router RSC mode and server action processing. TableVote uses `HashRouter` as a client-only Vite SPA and does not enable React Server Components, framework data routes, actions, or server actions. The affected execution path is not present in the application.

Controls:

- `scripts/check-audit.mjs` permits only this exact advisory URL.
- Any other high or critical production advisory fails CI.
- The exception must be removed when a non-vulnerable compatible React Router release is available.
- Enabling RSC, server actions, or a React Router framework runtime invalidates this exception immediately.

Review cadence: every dependency update and before each public release.
