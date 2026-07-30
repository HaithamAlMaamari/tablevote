import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';

const productionOrigin = 'https://tablevote.example';
const host = '127.0.0.1';
const probe = createServer();
await new Promise((resolve, reject) => {
  probe.once('error', reject);
  probe.listen(0, host, resolve);
});
const probeAddress = probe.address();
if (!probeAddress || typeof probeAddress === 'string') throw new Error('Could not reserve a smoke port');
const port = probeAddress.port;
await new Promise((resolve, reject) => probe.close((error) => (error ? reject(error) : resolve())));

const entry = fileURLToPath(new URL('../dist-server/index.js', import.meta.url));
const child = spawn(process.execPath, [entry], {
  env: {
    ...process.env,
    NODE_ENV: 'production',
    HOST: host,
    PORT: String(port),
    ALLOWED_ORIGINS: productionOrigin,
    TRUST_PROXY_HOPS: '1',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
child.stdout.setEncoding('utf8');
child.stderr.setEncoding('utf8');
let stderr = '';
child.stderr.on('data', (chunk) => {
  stderr += chunk;
});

await new Promise((resolve, reject) => {
  const timeout = setTimeout(() => reject(new Error(`Production server startup timed out\n${stderr}`)), 10_000);
  const onExit = (code) => {
    clearTimeout(timeout);
    reject(new Error(`Production server exited with code ${code}\n${stderr}`));
  };
  child.once('exit', onExit);
  child.stdout.on('data', (chunk) => {
    if (!chunk.includes('TableVote server on')) return;
    clearTimeout(timeout);
    child.off('exit', onExit);
    resolve();
  });
});

try {
  const backend = `http://${host}:${port}`;
  const headers = { Origin: productionOrigin, 'X-Forwarded-Proto': 'https' };
  const insecure = await fetch(`${backend}/api/sessions/XXXXX`);
  if (insecure.status !== 426) throw new Error(`HTTPS enforcement smoke check received ${insecure.status}`);

  const blockedOrigin = await fetch(`${backend}/api/sessions/XXXXX`, {
    headers: { Origin: 'https://attacker.example', 'X-Forwarded-Proto': 'https' },
  });
  if (blockedOrigin.status !== 403) throw new Error(`Origin smoke check received ${blockedOrigin.status}`);

  const page = await fetch(backend, { headers });
  if (!page.ok || !page.headers.get('content-type')?.includes('text/html')) {
    throw new Error(`Static smoke check failed with ${page.status}`);
  }

  const missing = await fetch(`${backend}/api/sessions/XXXXX`, { headers });
  if (missing.status !== 404) throw new Error(`API smoke check expected 404, received ${missing.status}`);

  const socketHandshake = await fetch(`${backend}/socket.io/?EIO=4&transport=polling`, { headers });
  if (!socketHandshake.ok || !(await socketHandshake.text()).startsWith('0')) {
    throw new Error(`Socket origin/HTTPS smoke check failed with ${socketHandshake.status}`);
  }

  console.log('Production process HTTPS, origin, static, socket, and API smoke checks passed.');
} finally {
  child.kill('SIGTERM');
  await new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) return resolve();
    child.once('exit', resolve);
  });
}
