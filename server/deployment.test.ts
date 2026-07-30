import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { io as ioc, type Socket } from 'socket.io-client';
import type { AddressInfo } from 'node:net';
import { buildApp } from './index';
import { resolveDeploymentConfig } from './deployment';

describe('production deployment enforcement', () => {
  it('fails closed on missing or unsafe production settings', () => {
    expect(() => resolveDeploymentConfig({ NODE_ENV: 'production' })).toThrow('ALLOWED_ORIGINS');
    expect(() => resolveDeploymentConfig({
      NODE_ENV: 'production', ALLOWED_ORIGINS: 'http://tablevote.example', TRUST_PROXY_HOPS: '1',
    })).toThrow('HTTPS');
    expect(() => resolveDeploymentConfig({
      NODE_ENV: 'production', ALLOWED_ORIGINS: 'https://tablevote.example/path', TRUST_PROXY_HOPS: '1',
    })).toThrow('exact HTTPS origins');
    expect(() => resolveDeploymentConfig({
      NODE_ENV: 'production', ALLOWED_ORIGINS: 'https://tablevote.example', TRUST_PROXY_HOPS: '0',
    })).toThrow('positive');
  });

  it('requires forwarded HTTPS and an allowed browser origin', async () => {
    const deployment = resolveDeploymentConfig({
      NODE_ENV: 'production', ALLOWED_ORIGINS: 'https://tablevote.example', TRUST_PROXY_HOPS: '1',
    });
    const { app, http } = buildApp({ deployment });
    try {
      expect((await request(app).get('/api/sessions/XXXXX')).status).toBe(426);
      expect((await request(app).get('/api/sessions/XXXXX')
        .set('X-Forwarded-Proto', 'https').set('Origin', 'https://attacker.example')).status).toBe(403);
      const allowed = await request(app).get('/api/sessions/XXXXX')
        .set('X-Forwarded-Proto', 'https').set('Origin', 'https://tablevote.example');
      expect(allowed.status).toBe(404);
      expect(allowed.headers['content-security-policy']).toContain("default-src 'self'");
      expect(allowed.headers['content-security-policy']).toContain('upgrade-insecure-requests');
    } finally {
      http.emit('close');
    }
  });

  it('keeps loopback assets on HTTP outside production', async () => {
    const { app, http } = buildApp({ deployment: resolveDeploymentConfig({}) });
    try {
      const response = await request(app).get('/api/sessions/XXXXX');
      expect(response.headers['content-security-policy']).not.toContain('upgrade-insecure-requests');
    } finally {
      http.emit('close');
    }
  });

  it('enforces WSS forwarding, socket origins, and trusted proxy address extraction', async () => {
    const deployment = resolveDeploymentConfig({
      NODE_ENV: 'production', ALLOWED_ORIGINS: 'https://tablevote.example', TRUST_PROXY_HOPS: '1',
    });
    const { app, http } = buildApp({ deployment });
    await new Promise<void>((resolve) => http.listen(0, resolve));
    const { port } = http.address() as AddressInfo;
    const url = `http://127.0.0.1:${port}`;
    const sockets: Socket[] = [];
    const connect = (origin: string, proto: string) => {
      const socket = ioc(url, {
        transports: ['websocket'], reconnection: false,
        extraHeaders: { Origin: origin, 'X-Forwarded-Proto': proto },
      });
      sockets.push(socket);
      return new Promise<'connected' | 'rejected'>((resolve) => {
        socket.once('connect', () => resolve('connected'));
        socket.once('connect_error', () => resolve('rejected'));
      });
    };

    try {
      expect(await connect('https://tablevote.example', 'https')).toBe('connected');
      expect(await connect('https://attacker.example', 'https')).toBe('rejected');
      expect(await connect('https://tablevote.example', 'http')).toBe('rejected');

      const headers = {
        Origin: 'https://tablevote.example', 'X-Forwarded-Proto': 'https', 'X-Forwarded-For': '198.51.100.1',
      };
      let limited;
      for (let attempt = 0; attempt <= 40; attempt++) {
        limited = await request(app).post('/api/sessions').set(headers).send({ areaLabel: '' });
      }
      expect(limited!.status).toBe(429);
      const otherAddress = await request(app).post('/api/sessions')
        .set({ ...headers, 'X-Forwarded-For': '198.51.100.2' }).send({ areaLabel: '' });
      expect(otherAddress.status).toBe(400);
    } finally {
      sockets.forEach((socket) => socket.close());
      await new Promise<void>((resolve) => http.close(() => resolve()));
    }
  });
});
