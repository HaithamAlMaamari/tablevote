import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import { io as connectSocket, type Socket } from 'socket.io-client';
import {
  CreateSessionResponseSchema,
  JoinSessionResponseSchema,
  MutationSuccessSchema,
  StateResponseSchema,
} from '../shared/contracts';
import type { Prefs } from '../shared/types';
import { buildApp } from './app';
import { SessionStore } from './store';

const ballot: Prefs = {
  cuisines: { Japanese: 'like' },
  budget: 2,
  maxDistanceKm: 5,
  dietary: [],
};

describe('REST and Socket.IO command parity', () => {
  const store = new SessionStore({ scheduler: null });
  const server = buildApp({ store, clock: () => 1_000 });
  let socket: Socket;
  let nextRequestId = 0;

  const requestId = () => `00000000-0000-4000-8000-${String(++nextRequestId).padStart(12, '0')}`;
  const emit = <T>(event: string, input: unknown) =>
    new Promise<T>((resolve) => {
      socket.emit(event, input, (response: T) => resolve(response));
    });

  beforeAll(async () => {
    await new Promise<void>((resolve) => server.http.listen(0, resolve));
    const { port } = server.http.address() as AddressInfo;
    socket = connectSocket(`http://127.0.0.1:${port}`, { transports: ['websocket'] });
    await new Promise<void>((resolve) => socket.once('connect', () => resolve()));
  });

  afterAll(async () => {
    socket.close();
    await new Promise<void>((resolve, reject) =>
      server.http.close((error) => {
        if (error) reject(error);
        else resolve();
      }),
    );
    store.close();
  });

  it('returns the same public contract when every mutation is replayed through the other adapter', async () => {
    const createInput = {
      areaLabel: 'Parity District',
      center: { lat: 23.5, lng: 58.3 },
      radiusKm: 5,
      nickname: 'Host',
      color: 0,
      allowReruns: true,
      shareHostNickname: false,
      requestId: requestId(),
    };
    const created = await request(server.app).post('/api/sessions').send(createInput);
    expect(created.status).toBe(201);
    expect(CreateSessionResponseSchema.safeParse(created.body).success).toBe(true);
    expect(await emit('create', createInput)).toEqual(created.body);
    const { sessionId, hostToken, participantToken: hostParticipantToken } = created.body;

    const parityMutation = async (
      restCall: ReturnType<ReturnType<typeof request>['post']> | PromiseLike<{ status: number; body: unknown }>,
      expectedStatus: number,
      event: string,
      input: unknown,
    ) => {
      const restResponse = await restCall;
      expect(restResponse.status, `${event} REST status`).toBe(expectedStatus);
      const socketResponse = await emit(event, input);
      expect(socketResponse, `${event} response`).toEqual(restResponse.body);
      return restResponse.body as Record<string, unknown>;
    };

    const joinInput = {
      sessionId,
      nickname: 'Voting Guest',
      color: 1,
      requestId: requestId(),
    };
    const joined = await parityMutation(
      request(server.app).post('/api/sessions/join').send(joinInput),
      201,
      'join',
      joinInput,
    );
    expect(JoinSessionResponseSchema.safeParse(joined).success).toBe(true);

    for (const token of [hostParticipantToken, joined.participantToken as string]) {
      const submitInput = { sessionId, token, prefs: ballot, requestId: requestId() };
      const submitted = await parityMutation(
        request(server.app).post(`/api/sessions/${sessionId}/submit`).send(submitInput),
        200,
        'submit',
        submitInput,
      );
      expect(MutationSuccessSchema.safeParse(submitted).success).toBe(true);
      expect(StateResponseSchema.safeParse({ state: submitted.state }).success).toBe(true);
    }

    const removableInput = {
      sessionId,
      nickname: 'Removable Guest',
      color: 2,
      requestId: requestId(),
    };
    const removable = await parityMutation(
      request(server.app).post('/api/sessions/join').send(removableInput),
      201,
      'join',
      removableInput,
    );
    const removeInput = {
      hostToken,
      participantId: removable.participantId as string,
      requestId: requestId(),
    };
    await parityMutation(
      request(server.app)
        .post(`/api/sessions/${sessionId}/participants/${removeInput.participantId}/remove`)
        .send(removeInput),
      200,
      'remove-participant',
      removeInput,
    );

    const leavingInput = {
      sessionId,
      nickname: 'Leaving Guest',
      color: 3,
      requestId: requestId(),
    };
    const leaving = await parityMutation(
      request(server.app).post('/api/sessions/join').send(leavingInput),
      201,
      'join',
      leavingInput,
    );
    const leaveInput = {
      sessionId,
      token: leaving.participantToken as string,
      requestId: requestId(),
    };
    await parityMutation(
      request(server.app).post(`/api/sessions/${sessionId}/leave`).send(leaveInput),
      200,
      'leave',
      leaveInput,
    );

    for (const command of ['reveal', 'rerun'] as const) {
      const input = { hostToken, requestId: requestId() };
      const response = await parityMutation(
        request(server.app).post(`/api/sessions/${sessionId}/${command}`).send(input),
        200,
        command,
        input,
      );
      expect(MutationSuccessSchema.safeParse(response).success).toBe(true);
    }

    const endInput = { hostToken, requestId: requestId() };
    await parityMutation(
      request(server.app).post(`/api/sessions/${sessionId}/end`).send(endInput),
      200,
      'end',
      endInput,
    );

    const invalidInput = { areaLabel: '' };
    await parityMutation(request(server.app).post('/api/sessions').send(invalidInput), 400, 'create', invalidInput);
  });
});
