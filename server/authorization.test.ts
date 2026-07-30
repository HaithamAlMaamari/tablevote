import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { io as ioc, type Socket } from 'socket.io-client';
import type { AddressInfo } from 'node:net';
import { buildApp } from './index';

const prefs = {
  cuisines: { Italian: 'like' as const }, budget: 2 as const, maxDistanceKm: 5, dietary: [],
};

describe('operation-complete authorization matrix', () => {
  const built = buildApp();
  const { app, http } = built;
  let socket: Socket;
  let sessionA: Record<string, string>;
  let sessionB: Record<string, string>;
  let guestA: Record<string, string>;

  beforeAll(async () => {
    await new Promise<void>((resolve) => http.listen(0, resolve));
    const { port } = http.address() as AddressInfo;
    socket = ioc(`http://127.0.0.1:${port}`, { transports: ['websocket'] });
    await new Promise<void>((resolve) => socket.on('connect', resolve));

    const create = async (nickname: string) => (await request(app).post('/api/sessions').send({
      areaLabel: 'Qurum', center: { lat: 23.588, lng: 58.3829 }, radiusKm: 10,
      nickname, color: 0, allowReruns: true,
    })).body as Record<string, string>;
    sessionA = await create('Host A');
    sessionB = await create('Host B');
    guestA = (await request(app).post('/api/sessions/join').send({
      code: sessionA.code, nickname: 'Guest A', color: 1,
    })).body as Record<string, string>;
  });

  afterAll(async () => {
    socket.close();
    await new Promise<void>((resolve) => http.close(() => resolve()));
  });

  it('rejects every REST operation with cross-session or wrong-class capabilities', async () => {
    const state = await request(app)
      .get(`/api/sessions/${sessionA.sessionId}/state`)
      .set('Authorization', `Bearer ${sessionB.participantToken}`);
    expect(state.status).toBe(401);

    const participantOperations = [
      request(app).post(`/api/sessions/${sessionA.sessionId}/submit`).send({
        token: sessionB.participantToken, prefs,
      }),
      request(app).post(`/api/sessions/${sessionA.sessionId}/leave`).send({
        token: sessionB.participantToken,
      }),
      request(app).post(`/api/sessions/${sessionA.sessionId}/submit`).send({
        token: sessionA.hostToken, prefs,
      }),
      request(app).post(`/api/sessions/${sessionA.sessionId}/leave`).send({
        token: sessionA.hostToken,
      }),
    ];
    expect((await Promise.all(participantOperations)).map((response) => response.status)).toEqual([403, 403, 403, 403]);

    const hostPaths = [
      `/api/sessions/${sessionA.sessionId}/participants/${guestA.participantId}/remove`,
      `/api/sessions/${sessionA.sessionId}/reveal`,
      `/api/sessions/${sessionA.sessionId}/rerun`,
      `/api/sessions/${sessionA.sessionId}/end`,
    ];
    for (const path of hostPaths) {
      expect((await request(app).post(path).send({ hostToken: sessionB.hostToken })).status).toBe(403);
      expect((await request(app).post(path).send({ hostToken: sessionA.participantToken })).status).toBe(403);
    }

    const unchanged = await request(app)
      .get(`/api/sessions/${sessionA.sessionId}/state`)
      .set('Authorization', `Bearer ${sessionA.participantToken}`);
    expect(unchanged.status).toBe(200);
    expect(unchanged.body.state.phase).toBe('collecting');
    expect(unchanged.body.state.participants).toHaveLength(2);
    expect(unchanged.body.state.participants.map((participant: { id: string }) => participant.id)).toContain(guestA.participantId);
  });

  it('rejects every Socket.IO operation with cross-session or wrong-class capabilities', async () => {
    const emit = <T,>(event: string, data: unknown) =>
      new Promise<T>((resolve) => socket.emit(event, data, (response: T) => resolve(response)));
    expect(await emit('attach', {
      sessionId: sessionA.sessionId, token: sessionA.participantToken,
    })).toHaveProperty('state');
    expect(await emit('attach', {
      sessionId: sessionA.sessionId, token: sessionB.participantToken,
    })).toEqual({ error: 'Not found', errorCode: 'not-found' });

    const participantCases = [
      ['submit', { token: sessionB.participantToken, prefs }, 'Invalid token'],
      ['leave', { token: sessionB.participantToken }, 'Invalid participant token'],
      ['submit', { token: sessionA.hostToken, prefs }, 'Invalid token'],
      ['leave', { token: sessionA.hostToken }, 'Invalid participant token'],
    ] as const;
    for (const [event, data, error] of participantCases) {
      expect(await emit(event, data)).toEqual({ error, errorCode: 'access-required' });
    }

    const hostCases = [
      ['remove-participant', { participantId: guestA.participantId }],
      ['reveal', {}],
      ['rerun', {}],
      ['end', {}],
    ] as const;
    for (const [event, data] of hostCases) {
      expect(await emit(event, { ...data, hostToken: sessionB.hostToken })).toEqual({ error: 'Forbidden', errorCode: 'access-required' });
      expect(await emit(event, { ...data, hostToken: sessionA.participantToken })).toEqual({ error: 'Forbidden', errorCode: 'access-required' });
    }

    const unchanged = await request(app)
      .get(`/api/sessions/${sessionA.sessionId}/state`)
      .set('Authorization', `Bearer ${sessionA.participantToken}`);
    expect(unchanged.body.state.phase).toBe('collecting');
    expect(unchanged.body.state.participants).toHaveLength(2);
  });
});
