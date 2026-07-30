# Local Proxy Validation

This loopback-only Docker harness validates the TableVote HTTPS/WSS reverse-proxy contract on a developer machine. It generates a one-day self-signed certificate and must not be exposed as a public deployment.

```powershell
npm ci
npm run build
$env:NODE_ENV = 'production'
$env:ALLOWED_ORIGINS = 'https://localhost:8443'
$env:TRUST_PROXY_HOPS = '1'
$env:PORT = '3001'
npm start
docker compose -f deployment/docker-compose.proxy.yml up --build
```

Run the checks from a second terminal:

```powershell
curl.exe -k -I https://localhost:8443/
curl.exe -k -i -H "Origin: https://evil.example" https://localhost:8443/api/sessions/XXXXX
curl.exe -k -i -H "Origin: https://localhost:8443" https://localhost:8443/api/sessions/XXXXX
curl.exe -I http://localhost:8080/
docker compose -f deployment/docker-compose.proxy.yml logs proxy
```

Expected results:

- HTTPS returns `200` with a `Content-Security-Policy` header.
- The evil origin returns `403`.
- The allowed origin returns `404` with `errorCode: not-found`.
- HTTP returns `308` to HTTPS.
- Proxy access logs contain only address, method, status, byte count, and duration; they do not contain request paths, invite codes, headers, or request bodies. The Nginx error threshold is `crit` because lower levels can embed request URIs.

Stop the harness with:

```powershell
docker compose -f deployment/docker-compose.proxy.yml down
```
