import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { io as ioc, type Socket } from 'socket.io-client';
import type { AddressInfo } from 'node:net';
import { buildApp } from './app';
import { SESSION_TTL_MS } from '../shared/policy';

const prefs = {
  cuisines: { Italian: 'like' as const },
  budget: 2 as const,
  maxDistanceKm: 5,
  dietary: [],
};

describe('terminal socket lifecycle matrix', () => {
  const { app, http, store } = buildApp();
  let socket: Socket;
  let url: string;

  beforeAll(async () => {
    await new Promise<void>((resolve) => http.listen(0, resolve));
    const { port } = http.address() as AddressInfo;
    url = `http://127.0.0.1:${port}`;
    socket = ioc(url, { transports: ['websocket'] });
    await new Promise<void>((resolve) => socket.on('connect', resolve));
  });

  afterAll(async () => {
    socket.close();
    await new Promise<void>((resolve) => http.close(() => resolve()));
  });

  const emit = <T>(event: string, data: unknown) =>
    new Promise<T>((resolve) => socket.emit(event, data, (response: T) => resolve(response)));

  async function createAndAttach() {
    const created = await request(app)
      .post('/api/sessions')
      .send({
        areaLabel: 'Qurum',
        center: { lat: 23.588, lng: 58.3829 },
        radiusKm: 10,
        nickname: 'Host',
        color: 0,
        allowReruns: true,
      });
    await emit('attach', { sessionId: created.body.sessionId, token: created.body.participantToken });
    return created.body as Record<string, string>;
  }

  async function expectTerminalMutations(session: Record<string, string>, error: string, errorCode: string) {
    const cases = [
      ['submit', { token: session.participantToken, prefs }],
      ['leave', { token: session.participantToken }],
      ['remove-participant', { hostToken: session.hostToken, participantId: 'participant-id' }],
      ['reveal', { hostToken: session.hostToken }],
      ['rerun', { hostToken: session.hostToken }],
      ['end', { hostToken: session.hostToken }],
    ] as const;
    for (const [event, data] of cases) expect(await emit(event, data)).toEqual({ error, errorCode });
  }

  it('preserves ended and expired reasons for every fresh socket mutation', async () => {
    const ended = await createAndAttach();
    expect(
      (
        await request(app).post(`/api/sessions/${ended.sessionId}/end`).send({
          hostToken: ended.hostToken,
        })
      ).status,
    ).toBe(200);
    await expectTerminalMutations(ended, 'Session ended', 'ended');

    const expired = await createAndAttach();
    store.get(expired.sessionId)!.createdAt = Date.now() - SESSION_TTL_MS;
    expect((await request(app).get(`/api/sessions/${expired.sessionId}`)).status).toBe(410);
    await expectTerminalMutations(expired, 'Session expired', 'expired');
  });

  it('reattaches replayed create and join mutations to private rooms', async () => {
    const createInput = {
      areaLabel: 'Qurum',
      center: { lat: 23.588, lng: 58.3829 },
      radiusKm: 10,
      nickname: 'Replay Host',
      color: 0,
      allowReruns: true,
      requestId: '10000000-0000-4000-8000-000000000001',
    };
    const created = await request(app).post('/api/sessions').send(createInput);
    expect(await emit('create', createInput)).toMatchObject({ sessionId: created.body.sessionId });
    const hostUpdate = new Promise<{ participants: unknown[] }>((resolve) => socket.once('state', resolve));
    await request(app).post('/api/sessions/join').send({
      code: created.body.code,
      nickname: 'First',
      color: 1,
    });
    expect((await hostUpdate).participants).toHaveLength(2);

    const joinInput = {
      code: created.body.code,
      nickname: 'Replay Guest',
      color: 2,
      requestId: '10000000-0000-4000-8000-000000000002',
    };
    const joined = await request(app).post('/api/sessions/join').send(joinInput);
    expect(await emit('join', joinInput)).toMatchObject({ participantId: joined.body.participantId });
    const guestUpdate = new Promise<{ participants: unknown[] }>((resolve) => socket.once('state', resolve));
    await request(app).post('/api/sessions/join').send({
      code: created.body.code,
      nickname: 'Last',
      color: 3,
    });
    expect((await guestUpdate).participants).toHaveLength(4);
  });

  it('keeps revealed sessions unchanged across rejected REST and socket mutations', async () => {
    const session = await createAndAttach();
    const guest = await request(app).post('/api/sessions/join').send({
      code: session.code,
      nickname: 'Guest',
      color: 1,
    });
    for (const token of [session.participantToken, guest.body.participantToken]) {
      expect((await request(app).post(`/api/sessions/${session.sessionId}/submit`).send({ token, prefs })).status).toBe(
        200,
      );
    }
    expect(
      (
        await request(app).post(`/api/sessions/${session.sessionId}/reveal`).send({
          hostToken: session.hostToken,
        })
      ).status,
    ).toBe(200);
    const before = JSON.stringify(store.get(session.sessionId));

    const restCases = [
      request(app).post('/api/sessions/join').send({ code: session.code, nickname: 'Late', color: 2 }),
      request(app).post(`/api/sessions/${session.sessionId}/submit`).send({ token: session.participantToken, prefs }),
      request(app).post(`/api/sessions/${session.sessionId}/leave`).send({ token: guest.body.participantToken }),
      request(app).post(`/api/sessions/${session.sessionId}/participants/${guest.body.participantId}/remove`).send({
        hostToken: session.hostToken,
      }),
    ];
    const responses = await Promise.all(restCases);
    expect(responses.map((response) => response.status)).toEqual([409, 409, 409, 409]);
    expect(responses.map((response) => response.body.errorCode)).toEqual(['locked', 'locked', 'locked', 'locked']);
    expect(
      (
        await request(app).post(`/api/sessions/${session.sessionId}/reveal`).send({
          hostToken: session.hostToken,
        })
      ).status,
    ).toBe(200);

    const socketCases = [
      ['join', { code: session.code, nickname: 'Socket Late', color: 3 }],
      ['submit', { token: session.participantToken, prefs }],
      ['leave', { token: guest.body.participantToken }],
      ['remove-participant', { hostToken: session.hostToken, participantId: guest.body.participantId }],
    ] as const;
    for (const [event, data] of socketCases) {
      expect(await emit(event, data)).toMatchObject({ errorCode: 'locked' });
    }
    expect(await emit('reveal', { hostToken: session.hostToken })).toEqual({ ok: true });
    expect(JSON.stringify(store.get(session.sessionId))).toBe(before);
    expect(
      (
        await request(app).post(`/api/sessions/${session.sessionId}/end`).send({
          hostToken: session.hostToken,
        })
      ).status,
    ).toBe(200);
  });

  it('broadcasts server-backed participant presence on attach and disconnect', async () => {
    const session = await createAndAttach();
    const guest = await request(app).post('/api/sessions/join').send({
      code: session.code,
      nickname: 'Presence Guest',
      color: 1,
    });
    const guestSocket = ioc(url, { transports: ['websocket'] });
    await new Promise<void>((resolve) => guestSocket.on('connect', resolve));
    try {
      const onlineState = new Promise<{ participants: { id: string; online: boolean }[] }>((resolve) => {
        socket.on('state', (state) => {
          if (
            state.participants.find((participant: { id: string }) => participant.id === guest.body.participantId)
              ?.online
          ) {
            resolve(state);
          }
        });
      });
      await new Promise((resolve) =>
        guestSocket.emit(
          'attach',
          {
            sessionId: session.sessionId,
            token: guest.body.participantToken,
          },
          resolve,
        ),
      );
      const online = await onlineState;
      expect(online.participants.find((participant) => participant.id === guest.body.participantId)?.online).toBe(true);

      const offlineState = new Promise<{ participants: { id: string; online: boolean }[] }>((resolve) => {
        socket.on('state', (state) => {
          if (
            state.participants.find((participant: { id: string }) => participant.id === guest.body.participantId)
              ?.online === false
          ) {
            resolve(state);
          }
        });
      });
      guestSocket.close();
      const offline = await offlineState;
      expect(offline.participants.find((participant) => participant.id === guest.body.participantId)?.online).toBe(
        false,
      );
      expect(offline.participants.find((participant) => participant.id === session.participantId)?.online).toBe(true);
    } finally {
      guestSocket.close();
    }
  });

  it('keeps blocked-no-match sessions unchanged across rejected socket mutations', async () => {
    const session = await createAndAttach();
    const guest = await request(app).post('/api/sessions/join').send({
      code: session.code,
      nickname: 'Strict Guest',
      color: 1,
    });
    const dietary = ['vegetarian', 'vegan', 'halal', 'kosher', 'gluten-free'].map((type) => ({ type, strict: true }));
    const strictPrefs = { ...prefs, dietary };
    for (const token of [session.participantToken, guest.body.participantToken]) {
      expect(
        (
          await request(app).post(`/api/sessions/${session.sessionId}/submit`).send({
            token,
            prefs: strictPrefs,
          })
        ).status,
      ).toBe(200);
    }
    expect(
      (
        await request(app).post(`/api/sessions/${session.sessionId}/reveal`).send({
          hostToken: session.hostToken,
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await request(app).post(`/api/sessions/${session.sessionId}/rerun`).send({
          hostToken: session.hostToken,
        })
      ).status,
    ).toBe(200);
    expect(store.get(session.sessionId)?.phase).toBe('blocked-no-match');
    const before = JSON.stringify(store.get(session.sessionId));

    const cases = [
      ['join', { code: session.code, nickname: 'Late', color: 2 }],
      ['submit', { token: session.participantToken, prefs: strictPrefs }],
      ['leave', { token: guest.body.participantToken }],
      ['remove-participant', { hostToken: session.hostToken, participantId: guest.body.participantId }],
      ['rerun', { hostToken: session.hostToken }],
    ] as const;
    for (const [event, data] of cases) {
      expect(await emit(event, data)).toMatchObject({ errorCode: 'locked' });
    }
    expect(await emit('reveal', { hostToken: session.hostToken })).toEqual({ ok: true });
    expect(JSON.stringify(store.get(session.sessionId))).toBe(before);
  });
});
