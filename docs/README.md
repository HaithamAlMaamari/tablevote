# Documentation

This index separates product evaluation, implementation contracts, decisions, operations, and security so claims can be checked against the relevant boundary.

## Evaluator Path

1. [Project overview and quickstart](../README.md)
2. [Technical case study](CASE_STUDY.md)
3. [Architecture](ARCHITECTURE.md)
4. [Operation and transport contract](OPERATIONS.md)
5. [Threat model](security/THREAT_MODEL.md)
6. [Data provenance](../DATA.md)
7. [Local proxy validation](../deployment/README.md)

## Reference

| Document                                      | Use it for                                                                   |
| --------------------------------------------- | ---------------------------------------------------------------------------- |
| [README](../README.md)                        | Boundary, setup, verification, engineering tour, and common failures         |
| [Architecture](ARCHITECTURE.md)               | Modules, request flow, state lifecycle, projections, and deployment boundary |
| [Operations](OPERATIONS.md)                   | REST/socket mapping, authorization, idempotency, failures, and events        |
| [Case study](CASE_STUDY.md)                   | Problem framing, engineering approach, trade-offs, and production delta      |
| [Threat model](security/THREAT_MODEL.md)      | Assets, trust boundaries, controls, residual risks, and expiry semantics     |
| [Roadmap](ROADMAP.md)                         | Possible next work and explicit non-goals                                    |
| [Demo data](../DATA.md)                       | Fictional catalog provenance and prohibited interpretations                  |
| [Deployment harness](../deployment/README.md) | Loopback HTTPS/WSS proxy validation and troubleshooting                      |
| [Contributing](../CONTRIBUTING.md)            | Development workflow and change expectations                                 |
| [Security policy](../SECURITY.md)             | Private vulnerability reporting and supported scope                          |
| [Changelog](../CHANGELOG.md)                  | Released and unreleased repository changes                                   |

## Architecture Decisions

- [ADR 0001: Use process-local in-memory state](adr/0001-in-memory-state.md)
- [ADR 0002: Use capability-based authorization](adr/0002-capability-authorization.md)
- [ADR 0003: Use deterministic consensus ranking](adr/0003-deterministic-ranking.md)
- [ADR 0004: Keep REST and Socket.IO transports](adr/0004-dual-transports.md)

## Troubleshooting Route

Start with the [README troubleshooting table](../README.md#troubleshooting). Transport and operation failures are explained in [OPERATIONS.md](OPERATIONS.md#failure-contract); proxy startup and certificate problems are covered in the [deployment guide](../deployment/README.md#troubleshooting).

If the docs do not answer a usage or contributor question, open the structured [question/support form](https://github.com/HaithamAlMaamari/tablevote/issues/new?template=question.yml). Use [SECURITY.md](../SECURITY.md) for vulnerabilities and [CODE_OF_CONDUCT.md](../CODE_OF_CONDUCT.md) for conduct concerns; those routes are intentionally separate.
