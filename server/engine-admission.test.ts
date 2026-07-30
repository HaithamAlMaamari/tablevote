import type { AddressInfo } from 'node:net';
import { describe, expect, it } from 'vitest';
import { buildApp } from './app';
import { resolveDeploymentConfig } from './deployment';

interface PollingTransport {
  sid: string;
  address: string;
}

async function listen(options: Parameters<typeof buildApp>[0]) {
  const built = buildApp(options);
  await new Promise<void>((resolve) => built.http.listen(0, resolve));
  const port = (built.http.address() as AddressInfo).port;
  return { ...built, url: `http://127.0.0.1:${port}` };
}

async function openPolling(
  url: string,
  address: string,
): Promise<{
  response: Response;
  transport?: PollingTransport;
}> {
  const response = await fetch(`${url}/socket.io/?EIO=4&transport=polling&t=${Math.random()}`, {
    headers: { 'X-Forwarded-For': address },
  });
  const body = await response.text();
  if (!response.ok || !body.startsWith('0')) return { response };
  return { response, transport: { sid: JSON.parse(body.slice(1)).sid as string, address } };
}

async function closePolling(url: string, transport: PollingTransport | undefined): Promise<void> {
  if (!transport) return;
  await fetch(`${url}/socket.io/?EIO=4&transport=polling&sid=${transport.sid}`, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=UTF-8', 'X-Forwarded-For': transport.address },
    body: '1',
  });
}

async function openWebSocket(url: string): Promise<WebSocket | null> {
  const socket = new WebSocket(`${url.replace('http:', 'ws:')}/socket.io/?EIO=4&transport=websocket`);
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: WebSocket | null) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    socket.addEventListener('open', () => finish(socket), { once: true });
    socket.addEventListener('error', () => finish(null), { once: true });
    socket.addEventListener('close', () => finish(null), { once: true });
  });
}

async function waitForClose(socket: WebSocket): Promise<void> {
  if (socket.readyState === WebSocket.CLOSED) return;
  await new Promise<void>((resolve) => socket.addEventListener('close', () => resolve(), { once: true }));
}

describe('raw Engine.IO admission boundaries', () => {
  it('enforces polling global/address ceilings and releases capacity on raw close', async () => {
    const built = await listen({
      deployment: resolveDeploymentConfig({ TRUST_PROXY_HOPS: '1' }),
      quotaLimits: {
        socketConnections: 2,
        socketConnectionsPerAddress: 1,
        socketHandshakesPerAddress: 20,
        unauthenticatedSocketTimeoutMs: 5_000,
      },
    });
    const transports: (PollingTransport | undefined)[] = [];
    try {
      const first = await openPolling(built.url, '198.51.100.1');
      transports.push(first.transport);
      expect(first.response.status).toBe(200);

      const sameAddress = await openPolling(built.url, '198.51.100.1');
      expect(sameAddress.response.status).toBe(403);

      const second = await openPolling(built.url, '198.51.100.2');
      transports.push(second.transport);
      expect(second.response.status).toBe(200);
      expect((await openPolling(built.url, '198.51.100.3')).response.status).toBe(403);

      await closePolling(built.url, first.transport);
      const recovered = await openPolling(built.url, '198.51.100.3');
      transports.push(recovered.transport);
      expect(recovered.response.status).toBe(200);
    } finally {
      await Promise.all(transports.map((transport) => closePolling(built.url, transport)));
      await new Promise<void>((resolve) => built.http.close(() => resolve()));
    }
  });

  it('times out raw polling sessions that never send a Socket.IO CONNECT packet', async () => {
    const built = await listen({
      quotaLimits: {
        socketConnections: 1,
        socketConnectionsPerAddress: 1,
        socketHandshakesPerAddress: 20,
        unauthenticatedSocketTimeoutMs: 100,
      },
    });
    try {
      expect((await openPolling(built.url, 'local')).response.status).toBe(200);
      expect((await openPolling(built.url, 'local')).response.status).toBe(403);
      await new Promise((resolve) => setTimeout(resolve, 150));
      expect((await openPolling(built.url, 'local')).response.status).toBe(200);
    } finally {
      await new Promise<void>((resolve) => built.http.close(() => resolve()));
    }
  });

  it('caps and times out raw WebSockets that never enter the Socket.IO namespace', async () => {
    const built = await listen({
      quotaLimits: {
        socketConnections: 1,
        socketConnectionsPerAddress: 1,
        socketHandshakesPerAddress: 20,
        unauthenticatedSocketTimeoutMs: 100,
      },
    });
    let recovered: WebSocket | null = null;
    try {
      const first = await openWebSocket(built.url);
      expect(first).not.toBeNull();
      expect(await openWebSocket(built.url)).toBeNull();
      await waitForClose(first!);

      recovered = await openWebSocket(built.url);
      expect(recovered).not.toBeNull();
    } finally {
      recovered?.close();
      await new Promise<void>((resolve) => built.http.close(() => resolve()));
    }
  });

  it('throttles malformed and unknown-sid traffic by trusted address and recovers', async () => {
    let now = 1_000;
    const built = await listen({
      clock: () => now,
      deployment: resolveDeploymentConfig({ TRUST_PROXY_HOPS: '1' }),
      quotaLimits: { windowMs: 100, socketHandshakesPerAddress: 2 },
    });
    const invalid = (path: string, address = '203.0.113.1') =>
      fetch(`${built.url}${path}`, { headers: { 'X-Forwarded-For': address } });
    try {
      expect((await invalid('/socket.io/?EIO=4&transport=bogus')).status).toBe(400);
      expect((await invalid('/socket.io/?EIO=4&transport=polling&sid=unknown')).status).toBe(400);
      const limited = await invalid('/socket.io/?EIO=4&transport=polling&sid=another');
      expect(limited.status).toBe(429);
      expect(limited.headers.get('retry-after')).toBe('1');
      expect((await invalid('/socket.io/?EIO=4&transport=polling&sid=another', '203.0.113.2')).status).toBe(400);

      now += 101;
      expect((await invalid('/socket.io/?EIO=4&transport=polling&sid=recovered')).status).toBe(400);
    } finally {
      await new Promise<void>((resolve) => built.http.close(() => resolve()));
    }
  });
});
