// Smoke test: create → join ×3 → submit ×3 → reveal → result shape
// (REST via supertest + live state via socket.io-client).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { io as ioc, type Socket } from 'socket.io-client';
import type { AddressInfo } from 'node:net';
import { buildApp } from './app';
import { ALGORITHM_VERSION, type Prefs, type SessionSnapshot } from '../shared/types';
import { SESSION_TTL_MS } from '../shared/policy';
import type { SessionStore } from './store';

const prefs = (over: Partial<Prefs>): Prefs => ({
  cuisines: { Italian: 'like' },
  budget: 2,
  maxDistanceKm: 5,
  dietary: [],
  ...over,
});

describe('server API + socket smoke', () => {
  let http: ReturnType<typeof buildApp>['http'];
  let app: ReturnType<typeof buildApp>['app'];
  let store: SessionStore;
  let url: string;
  let sock: Socket;

  beforeAll(async () => {
    ({ http, app, store } = buildApp());
    await new Promise<void>((r) => http.listen(0, r));
    const { port } = http.address() as AddressInfo;
    url = `http://127.0.0.1:${port}`;
    sock = ioc(url, { transports: ['websocket'] });
    await new Promise<void>((r) => sock.on('connect', () => r()));
  });

  afterAll(async () => {
    sock.close();
    await new Promise((r) => http.close(r));
  });

  it('full flow produces a valid result', async () => {
    // create (REST)
    const create = await request(app)
      .post('/api/sessions')
      .send({
        areaLabel: 'Qurum',
        center: { lat: 23.588, lng: 58.3829 },
        radiusKm: 10,
        nickname: 'Sam',
        color: 0,
        allowReruns: true,
      });
    expect(create.status).toBe(201);
    const { code, hostToken, participantToken: hostPT, participantId: hostId, sessionId } = create.body;
    expect(code).toMatch(/^[A-Z2-9]{5}$/);
    expect(create.body.state.selfParticipantId).toBe(hostId);

    const publicState = await request(app).get(`/api/sessions/${code}`);
    expect(publicState.status).toBe(200);
    expect(publicState.body.invite).toEqual(expect.objectContaining({ code, areaLabel: 'Qurum', joinable: true }));
    expect(publicState.body).not.toHaveProperty('state');
    expect(publicState.body.invite).not.toHaveProperty('participants');
    expect(publicState.body.invite).not.toHaveProperty('id');
    expect(publicState.body.invite).not.toHaveProperty('hostNickname');
    expect(publicState.headers['cache-control']).toBe('no-store');

    const unauthorizedState = await request(app).get(`/api/sessions/${code}/state`);
    expect(unauthorizedState.status).toBe(401);
    const authorizedState = await request(app)
      .get(`/api/sessions/${code}/state`)
      .set('Authorization', `Bearer ${hostPT}`);
    expect(authorizedState.status).toBe(200);
    expect(authorizedState.body.state.selfParticipantId).toBe(hostId);

    // host watches state over socket
    const states: SessionSnapshot[] = [];
    const emit = <T>(ev: string, data: unknown) => new Promise<T>((res) => sock.emit(ev, data, (r: T) => res(r)));
    const attach = await emit<{ state: SessionSnapshot }>('attach', { sessionId, token: hostPT });
    expect(attach.state.code).toBe(code);
    sock.on('state', (s: SessionSnapshot) => states.push(s));

    // join ×3 (REST)
    const guests: { token: string }[] = [];
    for (const [i, nick] of ['Maya', 'Jo', 'Pri'].entries()) {
      const j = await request(app)
        .post('/api/sessions/join')
        .send({ code, nickname: nick, color: (i + 1) % 4 });
      expect(j.status).toBe(201);
      guests.push({ token: j.body.participantToken });
    }

    // host submit (socket), guests submit (REST)
    const hs = await emit<{ ok: boolean }>('submit', {
      sessionId,
      token: hostPT,
      prefs: prefs({ cuisines: { Japanese: 'like' } }),
    });
    expect(hs.ok).toBe(true);
    for (const g of guests) {
      const s = await request(app)
        .post(`/api/sessions/${code}/submit`)
        .send({
          token: g.token,
          prefs: prefs({ cuisines: { Lebanese: 'like' } }),
        });
      expect(s.status).toBe(200);
    }

    // reveal with wrong token → 403
    const bad = await request(app).post(`/api/sessions/${code}/reveal`).send({ hostToken: 'wrong-token-xx' });
    expect(bad.status).toBe(403);

    // reveal (REST, host token)
    const rev = await request(app).post(`/api/sessions/${code}/reveal`).send({ hostToken });
    expect(rev.status).toBe(200);
    expect(rev.body).toEqual({ ok: true });
    const fetched = await request(app).get(`/api/sessions/${code}/state`).set('Authorization', `Bearer ${hostPT}`);
    const state = fetched.body.state as SessionSnapshot;
    expect(state.phase).toBe('revealed');
    const result = state.result!;
    expect(result).toBeTruthy();
    expect(result.kind).toBe('match');
    expect(result.algorithmVersion).toBe(ALGORITHM_VERSION);
    if (result.kind !== 'match') throw new Error('Expected a matched result');
    expect(result.winner.restaurant.name).toBeTruthy();
    expect(result.top3.length).toBeGreaterThanOrEqual(1);
    expect(['strong', 'good', 'compromise']).toContain(result.winner.groupFit);
    expect(result.ownWinnerFit).toBeGreaterThan(0);
    expect(result.ownWinnerFit).toBeLessThanOrEqual(1);
    expect(result).not.toHaveProperty('explanation');
    expect(result).not.toHaveProperty('scoringSheet');
    expect(result.winner).not.toHaveProperty('perPerson');
    expect(JSON.stringify(result)).not.toMatch(
      /perPerson|scoringSheet|meanUtility|minUtility|cuisineScore|priceScore|distanceScore|explanation/,
    );

    // state broadcasts were received
    await new Promise((r) => setTimeout(r, 100));
    expect(states.length).toBeGreaterThan(0);
    expect(states.some((socketState) => socketState.phase === 'locking')).toBe(true);
    expect(states.at(-1)?.phase).toBe('revealed');
    expect(states.at(-1)?.selfParticipantId).toBe(hostId);

    // re-run excludes previous winner
    const firstWinner = result.winner.restaurant.id;
    const rr = await request(app).post(`/api/sessions/${code}/rerun`).send({ hostToken });
    expect(rr.status).toBe(200);
    expect(rr.body).toEqual({ ok: true });
    const rerunState = await request(app).get(`/api/sessions/${code}/state`).set('Authorization', `Bearer ${hostPT}`);
    expect(rerunState.body.state.result.winner.restaurant.id).not.toBe(firstWinner);
    expect(rerunState.body.state.result.round).toBe(2);
    await new Promise((r) => setTimeout(r, 50));
    expect(states.filter((socketState) => socketState.phase === 'locking').length).toBeGreaterThanOrEqual(2);
  });

  it('publishes only an explicitly consented host nickname in invite metadata', async () => {
    const hidden = await request(app)
      .post('/api/sessions')
      .send({
        areaLabel: 'Qurum',
        center: { lat: 23.588, lng: 58.3829 },
        radiusKm: 10,
        nickname: 'Private Host',
        color: 0,
        allowReruns: true,
        shareHostNickname: false,
      });
    const hiddenInvite = await request(app).get(`/api/sessions/${hidden.body.code}`);
    expect(hiddenInvite.body.invite).not.toHaveProperty('hostNickname');

    const shared = await request(app)
      .post('/api/sessions')
      .send({
        areaLabel: 'Qurum',
        center: { lat: 23.588, lng: 58.3829 },
        radiusKm: 10,
        nickname: 'Public Host',
        color: 0,
        allowReruns: true,
        shareHostNickname: true,
      });
    const sharedInvite = await request(app).get(`/api/sessions/${shared.body.code}`);
    expect(sharedInvite.body.invite).toEqual(
      expect.objectContaining({
        areaLabel: 'Qurum',
        hostNickname: 'Public Host',
        joinable: true,
      }),
    );
    expect(JSON.stringify(sharedInvite.body)).not.toMatch(/participant|token|prefs/i);

    const unnamed = await request(app)
      .post('/api/sessions')
      .send({
        areaLabel: 'Qurum',
        center: { lat: 23.588, lng: 58.3829 },
        radiusKm: 10,
        nickname: '',
        color: 0,
        allowReruns: true,
        shareHostNickname: true,
      });
    const unnamedInvite = await request(app).get(`/api/sessions/${unnamed.body.code}`);
    expect(unnamedInvite.body.invite).not.toHaveProperty('hostNickname');
  });

  it('keeps duplicate Arabic identities distinct and rejects empty sanitized names', async () => {
    const create = await request(app)
      .post('/api/sessions')
      .send({
        areaLabel: 'Qurum',
        center: { lat: 23.588, lng: 58.3829 },
        radiusKm: 10,
        nickname: 'Host',
        color: 0,
        allowReruns: true,
      });
    const { code } = create.body;

    const empty = await request(app).post('/api/sessions/join').send({ code, nickname: '<>&', color: 1 });
    expect(empty.status).toBe(400);

    const deceptive = await request(app)
      .post('/api/sessions/join')
      .send({ code, nickname: '\u202eمريم\u202c', color: 1 });
    const invisible = await request(app).post('/api/sessions/join').send({ code, nickname: 'مر\u200bيم', color: 1 });
    expect(deceptive.status).toBe(400);
    expect(invisible.status).toBe(400);

    const first = await request(app).post('/api/sessions/join').send({ code, nickname: 'مريم', color: 1 });
    const second = await request(app).post('/api/sessions/join').send({ code, nickname: 'مريم', color: 2 });
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(first.body.participantId).not.toBe(second.body.participantId);
    expect(first.body.state.selfParticipantId).toBe(first.body.participantId);
    expect(second.body.state.selfParticipantId).toBe(second.body.participantId);
    expect(
      first.body.state.participants.find((participant: { id: string }) => participant.id === first.body.participantId)
        .nickname,
    ).toBe('مريم');

    const otherSession = await request(app)
      .post('/api/sessions')
      .send({
        areaLabel: 'Muttrah',
        center: { lat: 23.6, lng: 58.4 },
        radiusKm: 3,
        nickname: 'Other',
        color: 0,
        allowReruns: false,
      });
    const crossSession = await request(app)
      .get(`/api/sessions/${code}/state`)
      .set('Authorization', `Bearer ${otherSession.body.participantToken}`);
    expect(crossSession.status).toBe(401);
  });

  it('rejects oversized REST and socket payloads without affecting the server', async () => {
    const oversizedInput = {
      areaLabel: 'x'.repeat(70 * 1024),
      center: { lat: 23.588, lng: 58.3829 },
      radiusKm: 10,
      nickname: 'Large',
      color: 0,
      allowReruns: true,
    };
    const rest = await request(app).post('/api/sessions').send(oversizedInput);
    expect(rest.status).toBe(413);
    expect(rest.body).toEqual({ error: 'Payload too large', errorCode: 'invalid' });

    const oversizedSocket = ioc(url, { transports: ['websocket'], reconnection: false });
    await new Promise<void>((resolve) => oversizedSocket.on('connect', () => resolve()));
    const disconnected = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Oversized socket stayed connected')), 5_000);
      oversizedSocket.once('disconnect', () => {
        clearTimeout(timeout);
        resolve();
      });
    });
    oversizedSocket.emit('create', oversizedInput);
    await disconnected;
    oversizedSocket.close();

    expect((await request(app).get('/api/sessions/XXXXX')).status).toBe(404);
  });

  it('distinguishes expired and ended sessions after deleting raw state', async () => {
    const expirySocket = ioc(url, { transports: ['websocket'] });
    await new Promise<void>((resolve) => expirySocket.on('connect', () => resolve()));
    try {
      const create = await request(app)
        .post('/api/sessions')
        .send({
          areaLabel: 'Qurum',
          center: { lat: 23.588, lng: 58.3829 },
          radiusKm: 10,
          nickname: 'Host',
          color: 0,
          allowReruns: true,
        });
      const { code, sessionId, participantToken } = create.body;
      await new Promise((resolve) => expirySocket.emit('attach', { sessionId, token: participantToken }, resolve));
      const expiredEvent = new Promise<void>((resolve) => expirySocket.once('session-expired', () => resolve()));
      const stored = store.get(sessionId)!;
      stored.createdAt = Date.now() - SESSION_TTL_MS;

      const expired = await request(app)
        .get(`/api/sessions/${code}/state`)
        .set('Authorization', `Bearer ${participantToken}`);
      expect(expired.status).toBe(410);
      expect(expired.body).toEqual({ error: 'Session expired', errorCode: 'expired' });
      await expiredEvent;
      expect((await request(app).get(`/api/sessions/${sessionId}`)).body).toEqual({
        error: 'Session expired',
        errorCode: 'expired',
      });
      const expiredJoin = await request(app).post('/api/sessions/join').send({ code, nickname: 'Late', color: 1 });
      expect(expiredJoin.status).toBe(410);
      expect(expiredJoin.body).toEqual({ error: 'Session expired', errorCode: 'expired' });

      const endedCreate = await request(app)
        .post('/api/sessions')
        .send({
          areaLabel: 'Qurum',
          center: { lat: 23.588, lng: 58.3829 },
          radiusKm: 10,
          nickname: 'Host',
          color: 0,
          allowReruns: false,
        });
      const ended = await request(app).post(`/api/sessions/${endedCreate.body.code}/end`).send({
        hostToken: endedCreate.body.hostToken,
      });
      expect(ended.status).toBe(200);
      const endedState = await request(app)
        .get(`/api/sessions/${endedCreate.body.sessionId}/state`)
        .set('Authorization', `Bearer ${endedCreate.body.participantToken}`);
      expect(endedState.status).toBe(410);
      expect(endedState.body).toEqual({ error: 'Session ended', errorCode: 'ended' });
    } finally {
      expirySocket.close();
    }
  });

  it('enforces leave, removal, eviction, and end-session lifecycle', async () => {
    const hostSocket = ioc(url, { transports: ['websocket'] });
    const firstGuestSocket = ioc(url, { transports: ['websocket'] });
    const secondGuestSocket = ioc(url, { transports: ['websocket'] });
    await Promise.all(
      [hostSocket, firstGuestSocket, secondGuestSocket].map(
        (socket) => new Promise<void>((resolve) => socket.on('connect', () => resolve())),
      ),
    );
    const emit = <T>(socket: Socket, event: string, data: unknown) =>
      new Promise<T>((resolve) => socket.emit(event, data, (result: T) => resolve(result)));

    try {
      const create = await request(app)
        .post('/api/sessions')
        .send({
          areaLabel: 'Qurum',
          center: { lat: 23.588, lng: 58.3829 },
          radiusKm: 10,
          nickname: 'Host',
          color: 0,
          allowReruns: true,
        });
      const { sessionId, code, hostToken, participantToken: hostParticipantToken, participantId: hostId } = create.body;
      const firstGuest = await request(app).post('/api/sessions/join').send({ code, nickname: 'First', color: 1 });
      const secondGuest = await request(app).post('/api/sessions/join').send({ code, nickname: 'Second', color: 2 });

      await Promise.all([
        emit(hostSocket, 'attach', { sessionId, token: hostParticipantToken }),
        emit(firstGuestSocket, 'attach', { sessionId, token: firstGuest.body.participantToken }),
        emit(secondGuestSocket, 'attach', { sessionId, token: secondGuest.body.participantToken }),
      ]);

      let hostWasRemoved = false;
      let secondGuestWasRemoved = false;
      hostSocket.on('removed', () => {
        hostWasRemoved = true;
      });
      secondGuestSocket.on('removed', () => {
        secondGuestWasRemoved = true;
      });
      const firstGuestRemoved = new Promise<void>((resolve) => firstGuestSocket.once('removed', () => resolve()));
      const hostSeesFirstRemoval = new Promise<SessionSnapshot>((resolve) =>
        hostSocket.on('state', (state: SessionSnapshot) => {
          if (!state.participants.some((participant) => participant.id === firstGuest.body.participantId))
            resolve(state);
        }),
      );

      const removed = await emit<{ ok?: boolean; error?: string }>(hostSocket, 'remove-participant', {
        hostToken,
        participantId: firstGuest.body.participantId,
      });
      expect(removed).toEqual({ ok: true });
      await firstGuestRemoved;
      const stateAfterRemoval = await hostSeesFirstRemoval;
      expect(stateAfterRemoval.participants).toHaveLength(2);
      expect(hostWasRemoved).toBe(false);
      expect(secondGuestWasRemoved).toBe(false);

      const evictedState = await request(app)
        .get(`/api/sessions/${code}/state`)
        .set('Authorization', `Bearer ${firstGuest.body.participantToken}`);
      expect(evictedState.status).toBe(401);

      const secondGuestRemoved = new Promise<void>((resolve) => secondGuestSocket.once('removed', () => resolve()));
      const leave = await request(app).post(`/api/sessions/${code}/leave`).send({
        token: secondGuest.body.participantToken,
      });
      expect(leave.status).toBe(200);
      await secondGuestRemoved;
      const hostCannotLeave = await request(app).post(`/api/sessions/${code}/leave`).send({
        token: hostParticipantToken,
      });
      expect(hostCannotLeave.status).toBe(403);

      const raceGuest = await request(app).post('/api/sessions/join').send({ code, nickname: 'Race', color: 3 });
      const raceStatuses = await Promise.all(
        [1, 2].map(() =>
          request(app)
            .post(`/api/sessions/${code}/participants/${raceGuest.body.participantId}/remove`)
            .send({ hostToken })
            .then((response) => response.status),
        ),
      );
      expect(raceStatuses.sort()).toEqual([200, 404]);

      const finalGuest = await request(app).post('/api/sessions/join').send({ code, nickname: 'Final', color: 1 });
      await emit(secondGuestSocket, 'attach', { sessionId, token: finalGuest.body.participantToken });
      const hostEnded = new Promise<void>((resolve) => hostSocket.once('session-ended', () => resolve()));
      const guestEnded = new Promise<void>((resolve) => secondGuestSocket.once('session-ended', () => resolve()));

      const forbiddenEnd = await request(app).post(`/api/sessions/${code}/end`).send({ hostToken: 'wrong-token' });
      expect(forbiddenEnd.status).toBe(403);
      const end = await request(app).post(`/api/sessions/${code}/end`).send({ hostToken });
      expect(end.status).toBe(200);
      await Promise.all([hostEnded, guestEnded]);
      expect((await request(app).get(`/api/sessions/${code}`)).status).toBe(410);
      expect((await request(app).get(`/api/sessions/${sessionId}`)).status).toBe(410);
      expect(hostId).toBeTruthy();
    } finally {
      hostSocket.close();
      firstGuestSocket.close();
      secondGuestSocket.close();
    }
  });

  it('replays every mutation once across REST and sockets and rejects request-ID conflicts', async () => {
    const createRequestId = '00000000-0000-4000-8000-000000000001';
    const createInput = {
      areaLabel: 'Qurum',
      center: { lat: 23.588, lng: 58.3829 },
      radiusKm: 10,
      nickname: 'Replay Host',
      color: 0,
      allowReruns: true,
      requestId: createRequestId,
    };
    const firstCreate = await request(app).post('/api/sessions').send(createInput);
    const replayedCreate = await request(app).post('/api/sessions').send(createInput);
    expect(replayedCreate.status).toBe(201);
    expect(replayedCreate.body).toEqual(firstCreate.body);
    const createConflict = await request(app)
      .post('/api/sessions')
      .send({ ...createInput, areaLabel: 'Muttrah' });
    expect(createConflict.status).toBe(409);
    expect(createConflict.body).toEqual({ error: 'Request ID already used', errorCode: 'unknown' });

    const { code, sessionId, participantToken: hostParticipantToken, hostToken } = firstCreate.body;
    const joinInput = {
      code,
      nickname: 'Replay Guest',
      color: 1,
      requestId: '00000000-0000-4000-8000-000000000002',
    };
    const firstJoin = await request(app).post('/api/sessions/join').send(joinInput);
    const replayedJoin = await request(app).post('/api/sessions/join').send(joinInput);
    expect(replayedJoin.body).toEqual(firstJoin.body);
    expect(replayedJoin.body.state.participants).toHaveLength(2);

    const hostPrefs = prefs({ cuisines: { Japanese: 'like' } });
    const submitInput = {
      token: hostParticipantToken,
      prefs: hostPrefs,
      requestId: '00000000-0000-4000-8000-000000000003',
    };
    const firstSubmit = await request(app).post(`/api/sessions/${sessionId}/submit`).send(submitInput);
    const replayedSubmit = await request(app).post(`/api/sessions/${sessionId}/submit`).send(submitInput);
    expect(replayedSubmit.body).toEqual(firstSubmit.body);
    const submitConflict = await request(app)
      .post(`/api/sessions/${sessionId}/submit`)
      .send({
        ...submitInput,
        prefs: prefs({ cuisines: { Italian: 'dislike' } }),
      });
    expect(submitConflict.status).toBe(409);

    await request(app)
      .post(`/api/sessions/${sessionId}/submit`)
      .send({
        token: firstJoin.body.participantToken,
        prefs: prefs({ cuisines: { Lebanese: 'like' } }),
        requestId: '00000000-0000-4000-8000-000000000004',
      });
    const revealInput = { hostToken, requestId: '00000000-0000-4000-8000-000000000005' };
    const reveals = await Promise.all(
      [1, 2].map(() => request(app).post(`/api/sessions/${sessionId}/reveal`).send(revealInput)),
    );
    expect(reveals.map((response) => response.status)).toEqual([200, 200]);
    let state = await request(app)
      .get(`/api/sessions/${sessionId}/state`)
      .set('Authorization', `Bearer ${hostParticipantToken}`);
    expect(state.body.state.result.round).toBe(1);

    const emit = <T>(event: string, data: unknown) =>
      new Promise<T>((resolve) => sock.emit(event, data, (result: T) => resolve(result)));
    await emit('attach', { sessionId, token: hostParticipantToken });
    const rerunInput = { hostToken, requestId: '00000000-0000-4000-8000-000000000006' };
    expect(await emit('rerun', rerunInput)).toEqual({ ok: true });
    const replayedRerun = await request(app).post(`/api/sessions/${sessionId}/rerun`).send(rerunInput);
    expect(replayedRerun.status).toBe(200);
    state = await request(app)
      .get(`/api/sessions/${sessionId}/state`)
      .set('Authorization', `Bearer ${hostParticipantToken}`);
    expect(state.body.state.result.round).toBe(2);
    expect(state.body.state.rerunsUsed).toBe(1);

    const lifecycleCreate = await request(app)
      .post('/api/sessions')
      .send({
        ...createInput,
        nickname: 'Lifecycle Host',
        requestId: '00000000-0000-4000-8000-000000000007',
      });
    const lifecycleGuest = await request(app).post('/api/sessions/join').send({
      code: lifecycleCreate.body.code,
      nickname: 'Leaving',
      color: 1,
      requestId: '00000000-0000-4000-8000-000000000008',
    });
    const leaveInput = {
      token: lifecycleGuest.body.participantToken,
      requestId: '00000000-0000-4000-8000-000000000009',
    };
    expect(
      (await request(app).post(`/api/sessions/${lifecycleCreate.body.sessionId}/leave`).send(leaveInput)).status,
    ).toBe(200);
    expect(
      (await request(app).post(`/api/sessions/${lifecycleCreate.body.sessionId}/leave`).send(leaveInput)).status,
    ).toBe(200);

    const removable = await request(app).post('/api/sessions/join').send({
      code: lifecycleCreate.body.code,
      nickname: 'Removable',
      color: 2,
      requestId: '00000000-0000-4000-8000-000000000010',
    });
    const removeInput = {
      hostToken: lifecycleCreate.body.hostToken,
      requestId: '00000000-0000-4000-8000-000000000011',
    };
    const removeUrl = `/api/sessions/${lifecycleCreate.body.sessionId}/participants/${removable.body.participantId}/remove`;
    expect((await request(app).post(removeUrl).send(removeInput)).status).toBe(200);
    expect((await request(app).post(removeUrl).send(removeInput)).status).toBe(200);

    const endInput = {
      hostToken: lifecycleCreate.body.hostToken,
      requestId: '00000000-0000-4000-8000-000000000012',
    };
    expect((await request(app).post(`/api/sessions/${lifecycleCreate.body.sessionId}/end`).send(endInput)).status).toBe(
      200,
    );
    expect((await request(app).post(`/api/sessions/${lifecycleCreate.body.sessionId}/end`).send(endInput)).status).toBe(
      200,
    );
  });

  it('rate limits repeated socket join attempts', async () => {
    const emit = <T>(event: string, data: unknown) =>
      new Promise<T>((resolve) => sock.emit(event, data, (result: T) => resolve(result)));
    let response: { error?: string } = {};
    for (let attempt = 0; attempt < 21; attempt++) {
      response = await emit('join', { code: 'XXXXX', nickname: 'Rate', color: 0 });
    }
    expect(response.error).toBe('Too many requests');
  });

  it('returns a safe no-match after the only compatible restaurant is excluded', async () => {
    const create = await request(app)
      .post('/api/sessions')
      .send({
        areaLabel: 'Qurum',
        center: { lat: 23.588, lng: 58.3829 },
        radiusKm: 10,
        nickname: 'Host',
        color: 0,
        allowReruns: true,
      });
    const { code, hostToken, participantToken: hostTokenForVote } = create.body;
    const join = await request(app).post('/api/sessions/join').send({ code, nickname: 'Guest', color: 1 });
    const dietaryTypes: Prefs['dietary'][number]['type'][] = ['vegetarian', 'vegan', 'halal', 'kosher', 'gluten-free'];
    const strictAll = prefs({ dietary: dietaryTypes.map((type) => ({ type, strict: true })) });

    for (const token of [hostTokenForVote, join.body.participantToken]) {
      const submit = await request(app).post(`/api/sessions/${code}/submit`).send({ token, prefs: strictAll });
      expect(submit.status).toBe(200);
    }

    const reveal = await request(app).post(`/api/sessions/${code}/reveal`).send({ hostToken });
    expect(reveal.status).toBe(200);
    expect(reveal.body).toEqual({ ok: true });
    const firstState = await request(app)
      .get(`/api/sessions/${code}/state`)
      .set('Authorization', `Bearer ${hostTokenForVote}`);
    expect(firstState.body.state.result).toMatchObject({ kind: 'match', algorithmVersion: ALGORITHM_VERSION });
    expect(firstState.body.state.result.winner.restaurant.id).toBe('demo-01');

    const rerun = await request(app).post(`/api/sessions/${code}/rerun`).send({ hostToken });
    expect(rerun.status).toBe(200);
    expect(rerun.body).toEqual({ ok: true });
    const noMatchState = await request(app)
      .get(`/api/sessions/${code}/state`)
      .set('Authorization', `Bearer ${hostTokenForVote}`);
    expect(noMatchState.body.state.phase).toBe('blocked-no-match');
    expect(noMatchState.body.state.result).toMatchObject({
      kind: 'no-verified-match',
      algorithmVersion: ALGORITHM_VERSION,
      round: 2,
    });
    expect(noMatchState.body.state.result).not.toHaveProperty('winner');

    const rerunAgain = await request(app).post(`/api/sessions/${code}/rerun`).send({ hostToken });
    expect(rerunAgain.status).toBe(409);
    const lateJoin = await request(app).post('/api/sessions/join').send({ code, nickname: 'Late', color: 2 });
    expect(lateJoin.status).toBe(409);
    expect(lateJoin.body.errorCode).toBe('locked');
    const lateSubmit = await request(app).post(`/api/sessions/${code}/submit`).send({
      token: hostTokenForVote,
      prefs: strictAll,
    });
    expect(lateSubmit.status).toBe(409);
    expect(lateSubmit.body.errorCode).toBe('locked');
  });

  it('validates input and rejects unknown codes', async () => {
    const bad = await request(app).post('/api/sessions').send({ areaLabel: '' });
    expect(bad.status).toBe(400);
    const nope = await request(app).post('/api/sessions/join').send({ code: 'ZZZZZ', nickname: 'X', color: 0 });
    expect(nope.status).toBe(404);
    expect(nope.body.errorCode).toBe('not-found');

    const create = await request(app)
      .post('/api/sessions')
      .send({
        areaLabel: 'Qurum',
        center: { lat: 23.588, lng: 58.3829 },
        radiusKm: 10,
        nickname: 'Host',
        color: 0,
        allowReruns: true,
      });
    const unsupportedDietaryMode = await request(app)
      .post(`/api/sessions/${create.body.code}/submit`)
      .send({
        token: create.body.participantToken,
        prefs: { ...prefs({}), dietary: [{ type: 'halal', strict: false }] },
      });
    expect(unsupportedDietaryMode.status).toBe(400);
    expect(unsupportedDietaryMode.body.errorCode).toBe('invalid');
  });
});
