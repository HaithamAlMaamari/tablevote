# Local Proxy Validation

This loopback-only Docker harness exercises TableVote's production HTTPS/WSS boundary through Nginx. It generates a short-lived self-signed certificate for local validation. It is not a deployment recipe, does not provide durable state, and must not be exposed publicly.

## Prerequisites

- Node.js `22.22+` within Node 22, or Node.js `24+`
- npm
- Docker with Compose
- Free local ports `3001`, `8080`, and `8443`

## Start The Application

Install and build once:

```powershell
npm ci
npm run build
```

In the first terminal, start the built server with the proxy contract enabled:

```powershell
$env:NODE_ENV = 'production'
$env:ALLOWED_ORIGINS = 'https://localhost:8443'
$env:TRUST_PROXY_HOPS = '1'
$env:PORT = '3001'
npm start
```

`ALLOWED_ORIGINS` must contain exact origins, with no paths or trailing slash. `TRUST_PROXY_HOPS=1` is correct only for this one-proxy loopback topology.

In a second terminal, build and start Nginx:

```powershell
docker compose -f deployment/docker-compose.proxy.yml up --build
```

Open `https://localhost:8443` and explicitly accept the local self-signed certificate warning.

## Validate The Boundary

Run from a third terminal:

```powershell
curl.exe -k -I https://localhost:8443/
curl.exe -k -i -H "Origin: https://evil.example" https://localhost:8443/api/sessions/XXXXX
curl.exe -k -i -H "Origin: https://localhost:8443" https://localhost:8443/api/sessions/XXXXX
curl.exe -I http://localhost:8080/
docker compose -f deployment/docker-compose.proxy.yml logs proxy
```

Expected results:

| Check                                | Expected result                                        |
| ------------------------------------ | ------------------------------------------------------ |
| HTTPS application                    | `200` and a `Content-Security-Policy` header           |
| Unapproved origin                    | `403`                                                  |
| Approved origin with unknown session | `404` and `errorCode: not-found`                       |
| Plain HTTP                           | `308` redirect to HTTPS                                |
| Proxy logs                           | Address, method, status, byte count, and duration only |

The Nginx access format intentionally omits request paths, invite codes, headers, and bodies. Its error threshold is `crit` because lower levels can include request URIs.

## Troubleshooting

| Symptom                                                 | Check                                                                                                                               |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Server exits before listening                           | Confirm `NODE_ENV`, exact `ALLOWED_ORIGINS`, and a positive integer `TRUST_PROXY_HOPS` are set in the same terminal as `npm start`. |
| Direct `http://localhost:3001` returns `426`            | Expected in production mode: traffic must arrive through the trusted proxy with forwarded HTTPS.                                    |
| Browser reports an untrusted certificate                | Expected for the generated certificate; accept it only for this loopback harness.                                                   |
| Socket does not connect after accepting the certificate | Reload the page, confirm the proxy container is running, and inspect the path-free proxy logs.                                      |
| Origin check unexpectedly fails                         | Match scheme, host, and port exactly: `https://localhost:8443` is different from `https://127.0.0.1:8443`.                          |
| Port binding fails                                      | Stop the process using `3001`, `8080`, or `8443`, or change the entire topology consistently.                                       |

## Stop And Clean Up

Stop `npm start` with `Ctrl+C`, then run:

```powershell
docker compose -f deployment/docker-compose.proxy.yml down
Remove-Item Env:NODE_ENV, Env:ALLOWED_ORIGINS, Env:TRUST_PROXY_HOPS, Env:PORT -ErrorAction SilentlyContinue
```

For the application trust model and public-deployment delta, read [ARCHITECTURE.md](../docs/ARCHITECTURE.md#deployment-boundary) and the [threat model](../docs/security/THREAT_MODEL.md#deployment-requirements).
