import { describe, expect, it, vi } from 'vitest';
import { OperationService, type OperationEffect } from './operations';
import { SessionStore } from './store';
import type { Prefs, Session } from '../shared/types';

const prefs: Prefs = {
  cuisines: { Italian: 'like' },
  budget: 2,
  maxDistanceKm: 5,
  dietary: [],
};

function deterministicTokens() {
  let next = 0;
  return (bytes: number) => `${bytes}-${++next}`.padEnd(12, 'x');
}

describe('transport-neutral operation commands', () => {
  it('produces identical outcomes for independent adapter effect sinks', () => {
    const stores = [0, 1].map(
      () =>
        new SessionStore({
          scheduler: null,
          tokenFactory: deterministicTokens(),
          clock: () => 1_000,
        }),
    );
    const created = stores.map((store) =>
      store.create({
        areaLabel: 'Qurum',
        center: { lat: 0, lng: 0 },
        radiusKm: 3,
        nickname: 'Host',
        color: 0,
        allowReruns: true,
      }),
    );
    const [firstCreated, secondCreated] = created;
    if (!firstCreated.ok || !secondCreated.ok) throw new Error('Expected sessions');
    const sessions = [firstCreated.value.session, secondCreated.value.session];
    const services = stores.map((store) => new OperationService(store, { clock: () => 1_000 }));
    const effects: string[][] = [[], []];
    const sinks = effects.map((list) => (effect: OperationEffect) => list.push(effect.kind));
    const outcomes = services.map((service, index) =>
      service.execute(
        {
          kind: 'join',
          input: {
            sessionId: sessions[index].id,
            nickname: 'Guest',
            color: 1,
            requestId: '00000000-0000-4000-8000-000000000001',
          },
        },
        sinks[index],
      ),
    );

    expect(outcomes.map((outcome) => ({ ok: outcome.ok, status: outcome.status }))).toEqual([
      { ok: true, status: 201 },
      { ok: true, status: 201 },
    ]);
    expect(effects).toEqual([
      ['attach', 'broadcast'],
      ['attach', 'broadcast'],
    ]);
    expect(stores.map((store) => store.get(sessions[0].id)?.participants.length)).toEqual([2, 2]);
  });

  it('replays a command without repeating its mutation', () => {
    const store = new SessionStore({ scheduler: null, tokenFactory: deterministicTokens() });
    const service = new OperationService(store);
    const input = {
      areaLabel: 'Qurum',
      center: { lat: 0, lng: 0 },
      radiusKm: 3,
      nickname: 'Host',
      color: 0,
      allowReruns: true,
      shareHostNickname: false,
      requestId: '00000000-0000-4000-8000-000000000002',
    };
    const first = service.execute({ kind: 'create', input });
    const replay = service.execute({ kind: 'create', input });
    expect(first.body).toEqual(replay.body);
    expect(replay.ok && replay.replayed).toBe(true);
    expect(store.resourceCounts().activeSessions).toBe(1);
  });

  it.each([
    ['reveal', 'collecting'],
    ['rerun', 'revealed'],
  ] as const)('broadcasts restored state when %s calculation rolls back', (kind, restoredPhase) => {
    const store = new SessionStore({ scheduler: null, tokenFactory: deterministicTokens() });
    const created = store.create({
      areaLabel: 'Qurum',
      center: { lat: 0, lng: 0 },
      radiusKm: 3,
      nickname: 'Host',
      color: 0,
      allowReruns: true,
    });
    if (!created.ok) throw new Error('Expected session');
    const { session, participantToken } = created.value;
    const joined = store.join(session, 'Guest', 1);
    if (!joined.ok) throw new Error('Expected guest');
    store.submit(session, participantToken, prefs);
    store.submit(session, joined.value.participantToken, prefs);
    if (kind === 'rerun') store.reveal(session, session.hostToken);

    const computingStore = store as unknown as { compute(session: Session): never };
    vi.spyOn(computingStore, 'compute').mockImplementation(() => {
      throw new Error('calculation failed');
    });
    const phases: string[] = [];
    const outcome = new OperationService(store).execute(
      {
        kind,
        sessionId: session.id,
        input: {
          hostToken: session.hostToken,
          requestId:
            kind === 'reveal' ? '20000000-0000-4000-8000-000000000001' : '20000000-0000-4000-8000-000000000002',
        },
      },
      (effect) => {
        if (effect.kind === 'broadcast') phases.push(session.phase);
      },
    );

    expect(outcome).toMatchObject({ ok: false, status: 503, body: { errorCode: 'unavailable' } });
    expect(phases).toEqual(['locking', restoredPhase]);
    expect(session.phase).toBe(restoredPhase);
    if (kind === 'rerun') {
      expect(session.rerunsUsed).toBe(0);
      expect(session.excludedIds).toEqual([]);
    }
  });

  it('purges session replay data on end while retaining the current end response', () => {
    const store = new SessionStore({ scheduler: null, tokenFactory: deterministicTokens() });
    const service = new OperationService(store);
    const createInput = {
      areaLabel: 'Qurum',
      center: { lat: 0, lng: 0 },
      radiusKm: 3,
      nickname: 'Host',
      color: 0,
      allowReruns: true,
      shareHostNickname: false,
      requestId: '30000000-0000-4000-8000-000000000001',
    };
    const created = service.execute({ kind: 'create', input: createInput });
    if (!created.ok) throw new Error('Expected create');
    const createBody = created.body as {
      sessionId: string;
      code: string;
      hostToken: string;
      participantToken: string;
    };
    const joinInput = {
      sessionId: createBody.sessionId,
      nickname: 'Guest',
      color: 1,
      requestId: '30000000-0000-4000-8000-000000000002',
    };
    const joined = service.execute({ kind: 'join', input: joinInput });
    if (!joined.ok) throw new Error('Expected join');
    const submitInput = {
      token: createBody.participantToken,
      prefs,
      requestId: '30000000-0000-4000-8000-000000000003',
    };
    const submitted = service.execute({ kind: 'submit', sessionId: createBody.sessionId, input: submitInput });
    if (!submitted.ok) throw new Error('Expected submit');
    const endInput = {
      hostToken: createBody.hostToken,
      requestId: '30000000-0000-4000-8000-000000000004',
    };

    const ended = service.execute({ kind: 'end', sessionId: createBody.sessionId, input: endInput });
    const replayedEnd = service.execute({ kind: 'end', sessionId: createBody.sessionId, input: endInput });
    expect(replayedEnd).toMatchObject({ ok: true, replayed: true, body: ended.body });
    expect(service.execute({ kind: 'join', input: joinInput })).toMatchObject({
      ok: false,
      body: { errorCode: 'ended' },
    });
    expect(service.execute({ kind: 'submit', sessionId: createBody.sessionId, input: submitInput })).toMatchObject({
      ok: false,
      body: { errorCode: 'ended' },
    });

    const recreated = service.execute({ kind: 'create', input: createInput });
    expect(recreated).toMatchObject({ ok: true, replayed: false });
    if (!recreated.ok) throw new Error('Expected recreated session');
    expect(recreated.body).not.toEqual(created.body);
    expect(recreated.body.participantToken).not.toBe(createBody.participantToken);
  });
});
