# Security Policy

TableVote is a portfolio prototype and has not received an independent security audit. The supported code is the latest commit on `main`; no hosted production service is provided.

## Reporting a vulnerability

Please use [GitHub private vulnerability reporting](https://github.com/HaithamAlMaamari/tablevote/security/advisories/new). Do not open a public issue with exploit details, invite codes, capabilities, ballots, dietary requirements, logs, or other session data.

You should receive an acknowledgement within seven days. Reports are evaluated for the current prototype scope, and accepted fixes are coordinated privately before disclosure.

## Scope notes

- Sessions are stored in one server process and are lost on restart.
- The bundled catalog is entirely fictional.
- Development-only local mode has no confidentiality boundary between tabs in the same browser profile.
- Public deployment requires an HTTPS-enforcing reverse proxy, exact origins, and a verified trusted-proxy topology.
