import { afterEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Server } from 'node:http';
import { buildApp } from './app';

const createInput = {
  areaLabel: 'Qurum',
  center: { lat: 23.588, lng: 58.3829 },
  radiusKm: 10,
  nickname: 'Host',
  color: 0,
  allowReruns: true,
};
const prefs = {
  cuisines: { Italian: 'like' as const },
  budget: 2 as const,
  maxDistanceKm: 5,
  dietary: [],
};

describe('server quota integration', () => {
  let http: Server | undefined;

  afterEach(() => {
    http?.emit('close');
    http = undefined;
  });

  it('limits distributed join attempts against one session', async () => {
    const sessionJoin = 3;
    const built = buildApp({ quotaLimits: { sessionJoin } });
    http = built.http;
    const created = await request(built.app).post('/api/sessions').send(createInput);

    let response;
    for (let attempt = 0; attempt <= sessionJoin; attempt++) {
      response = await request(built.app)
        .post('/api/sessions/join')
        .send({
          code: created.body.code,
          nickname: `Guest ${attempt}`,
          color: attempt % 4,
        });
    }
    expect(response!.status).toBe(429);
    expect(response!.body).toEqual({ error: 'Too many requests', errorCode: 'rate-limited' });
  });

  it('limits repeated mutations against one session', async () => {
    const sessionOperations = 3;
    const built = buildApp({ quotaLimits: { sessionOperations } });
    http = built.http;
    const created = await request(built.app).post('/api/sessions').send(createInput);

    let response;
    for (let attempt = 0; attempt <= sessionOperations; attempt++) {
      response = await request(built.app).post(`/api/sessions/${created.body.sessionId}/submit`).send({
        token: 'invalid-token',
        prefs,
      });
    }
    expect(response!.status).toBe(429);
    expect(response!.body).toEqual({ error: 'Too many requests', errorCode: 'rate-limited' });
  });

  it('shares the process-wide create/join ceiling across sessions', async () => {
    const built = buildApp({ quotaLimits: { globalCreateJoin: 2 } });
    http = built.http;
    const first = await request(built.app).post('/api/sessions').send(createInput);
    expect(first.status).toBe(201);
    const join = await request(built.app).post('/api/sessions/join').send({
      code: first.body.code,
      nickname: 'Guest',
      color: 1,
    });
    expect(join.status).toBe(201);

    const blocked = await request(built.app)
      .post('/api/sessions')
      .send({ ...createInput, areaLabel: 'Muttrah' });
    expect(blocked.status).toBe(429);
    expect(blocked.body).toEqual({ error: 'Too many requests', errorCode: 'rate-limited' });
  });
});
