import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { io as ioc, type Socket } from 'socket.io-client';
import type { AddressInfo } from 'node:net';
import { buildApp } from './app';
import { resolveDeploymentConfig } from './deployment';

async function connect(url: string, address: string): Promise<{ socket: Socket; connected: boolean }> {
  const socket = ioc(url, {
    transports: ['websocket'],
    reconnection: false,
    extraHeaders: { 'X-Forwarded-For': address },
  });
  const connected = await new Promise<boolean>((resolve) => {
    socket.once('connect', () => resolve(true));
    socket.once('connect_error', () => resolve(false));
  });
  return { socket, connected };
}

async function closeSocket(socket: Socket): Promise<void> {
  if (!socket.connected) {
    socket.close();
    return;
  }
  await new Promise<void>((resolve) => {
    socket.once('disconnect', () => resolve());
    socket.close();
  });
  // Socket.IO disconnect precedes the manager's raw Engine.IO close.
  await new Promise((resolve) => setTimeout(resolve, 20));
}

describe('Socket.IO admission boundaries', () => {
  it('enforces global and per-address concurrency and releases both counters', async () => {
    const built = buildApp({
      deployment: resolveDeploymentConfig({ TRUST_PROXY_HOPS: '1' }),
      quotaLimits: {
        socketConnections: 2,
        socketConnectionsPerAddress: 1,
        socketHandshakesPerAddress: 20,
        unauthenticatedSocketTimeoutMs: 5_000,
      },
    });
    await new Promise<void>((resolve) => built.http.listen(0, resolve));
    const url = `http://127.0.0.1:${(built.http.address() as AddressInfo).port}`;
    const sockets: Socket[] = [];
    try {
      const first = await connect(url, '198.51.100.1');
      sockets.push(first.socket);
      expect(first.connected).toBe(true);
      const sameAddress = await connect(url, '198.51.100.1');
      sockets.push(sameAddress.socket);
      expect(sameAddress.connected).toBe(false);

      const second = await connect(url, '198.51.100.2');
      sockets.push(second.socket);
      expect(second.connected).toBe(true);
      const globallyBlocked = await connect(url, '198.51.100.3');
      sockets.push(globallyBlocked.socket);
      expect(globallyBlocked.connected).toBe(false);

      await closeSocket(first.socket);
      const recovered = await connect(url, '198.51.100.3');
      sockets.push(recovered.socket);
      expect(recovered.connected).toBe(true);
    } finally {
      await Promise.all(sockets.map(closeSocket));
      await new Promise<void>((resolve) => built.http.close(() => resolve()));
    }
  });

  it('rate limits handshakes per address and recovers after the window', async () => {
    let now = 1_000;
    const built = buildApp({
      clock: () => now,
      deployment: resolveDeploymentConfig({ TRUST_PROXY_HOPS: '1' }),
      quotaLimits: {
        windowMs: 100,
        socketConnections: 10,
        socketConnectionsPerAddress: 10,
        socketHandshakesPerAddress: 2,
        unauthenticatedSocketTimeoutMs: 5_000,
      },
    });
    await new Promise<void>((resolve) => built.http.listen(0, resolve));
    const url = `http://127.0.0.1:${(built.http.address() as AddressInfo).port}`;
    const sockets: Socket[] = [];
    try {
      for (let attempt = 0; attempt < 2; attempt++) {
        const result = await connect(url, '203.0.113.1');
        sockets.push(result.socket);
        expect(result.connected).toBe(true);
        await closeSocket(result.socket);
      }
      const limited = await connect(url, '203.0.113.1');
      sockets.push(limited.socket);
      expect(limited.connected).toBe(false);

      now += 101;
      const recovered = await connect(url, '203.0.113.1');
      sockets.push(recovered.socket);
      expect(recovered.connected).toBe(true);
    } finally {
      await Promise.all(sockets.map(closeSocket));
      await new Promise<void>((resolve) => built.http.close(() => resolve()));
    }
  });

  it('disconnects idle unauthenticated sockets but keeps attached sockets', async () => {
    const built = buildApp({ quotaLimits: { unauthenticatedSocketTimeoutMs: 500 } });
    await new Promise<void>((resolve) => built.http.listen(0, resolve));
    const url = `http://127.0.0.1:${(built.http.address() as AddressInfo).port}`;
    const idle = ioc(url, { transports: ['websocket'], reconnection: false });
    const attached = ioc(url, { transports: ['websocket'], reconnection: false });
    const idleDisconnected = new Promise<void>((resolve) => idle.once('disconnect', () => resolve()));
    try {
      await Promise.all(
        [idle, attached].map((socket) => new Promise<void>((resolve) => socket.once('connect', () => resolve()))),
      );
      const created = await request(built.app)
        .post('/api/sessions')
        .send({
          areaLabel: 'Qurum',
          center: { lat: 23.588, lng: 58.3829 },
          radiusKm: 3,
          nickname: 'Host',
          color: 0,
          allowReruns: false,
        });
      const attachedReply = await new Promise<Record<string, unknown>>((resolve) =>
        attached.emit(
          'attach',
          {
            sessionId: created.body.sessionId,
            token: created.body.participantToken,
          },
          resolve,
        ),
      );
      expect(attachedReply).toHaveProperty('state');
      await idleDisconnected;
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(attached.connected).toBe(true);
    } finally {
      idle.close();
      attached.close();
      await new Promise<void>((resolve) => built.http.close(() => resolve()));
    }
  });
});
