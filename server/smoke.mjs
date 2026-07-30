process.env.VITEST = 'true';

const { buildApp } = await import('../dist-server/index.js');
const productionOrigin = 'https://tablevote.example';
const { http, io } = buildApp({
  deployment: {
    production: true,
    allowedOrigins: new Set([productionOrigin]),
    trustProxyHops: 1,
    requireHttps: true,
  },
});

await new Promise((resolve) => http.listen(0, '127.0.0.1', resolve));
const address = http.address();
if (!address || typeof address === 'string') throw new Error('Smoke server did not bind');

try {
  const origin = `http://127.0.0.1:${address.port}`;
  const headers = { Origin: productionOrigin, 'X-Forwarded-Proto': 'https' };
  const insecure = await fetch(`${origin}/api/sessions/XXXXX`);
  if (insecure.status !== 426) throw new Error(`HTTPS enforcement smoke check received ${insecure.status}`);

  const page = await fetch(origin, { headers });
  if (!page.ok || !page.headers.get('content-type')?.includes('text/html')) {
    throw new Error(`Static smoke check failed with ${page.status}`);
  }

  const missing = await fetch(`${origin}/api/sessions/XXXXX`, { headers });
  if (missing.status !== 404) {
    throw new Error(`API smoke check expected 404, received ${missing.status}`);
  }

  console.log('Production static and API smoke checks passed.');
} finally {
  await new Promise((resolve) => io.close(resolve));
}
