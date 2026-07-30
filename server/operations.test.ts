import { describe, expect, it } from 'vitest';
import { OperationService, type OperationEffect } from './operations';
import { SessionStore } from './store';

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
});
