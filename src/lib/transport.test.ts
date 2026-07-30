import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Session } from '@shared/types';
import { clearSessionStorage, loadIdentity, saveIdentity, sweepExpiredSessionStorage, type Identity } from './transport';

class MemoryStorage implements Storage {
  private values = new Map<string, string>();
  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

describe('client session retention', () => {
  beforeEach(() => vi.stubGlobal('localStorage', new MemoryStorage()));
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('removes expired identities and linked session storage', () => {
    const identity: Identity = {
      participantId: 'p1', token: 'token', nickname: 'Host', color: 0,
      isHost: true, expiresAt: 100, hostToken: 'host',
    };
    saveIdentity('ABCDE', identity);
    localStorage.setItem('tablevote:prefs:ABCDE', '{}');
    localStorage.setItem('tablevote:idref:ABCDE', 'session-id');
    localStorage.setItem('tablevote:me:session-id', JSON.stringify(identity));
    const session: Session = {
      id: 'session-id', code: 'ABCDE', hostToken: 'host', participants: [], phase: 'collecting',
      result: null, excludedIds: [], rerunsUsed: 0, allowReruns: true, createdAt: 0,
      center: { lat: 23.5, lng: 58.3 }, areaLabel: 'Qurum', radiusKm: 3,
    };
    localStorage.setItem('tablevote:session:session-id', JSON.stringify(session));
    vi.spyOn(Date, 'now').mockReturnValue(100);

    expect(loadIdentity('ABCDE')).toBeNull();
    expect(localStorage.getItem('tablevote:me:ABCDE')).toBeNull();
    expect(localStorage.getItem('tablevote:me:session-id')).toBeNull();
    expect(localStorage.getItem('tablevote:prefs:ABCDE')).toBeNull();
    const terminals = JSON.parse(localStorage.getItem('tablevote:terminals') ?? '{}');
    expect(terminals.ABCDE.reason).toBe('expired');
    expect(terminals['session-id'].reason).toBe('expired');
  });

  it('clears explicit code and ID references together', () => {
    localStorage.setItem('tablevote:idref:ABCDE', 'session-id');
    localStorage.setItem('tablevote:me:ABCDE', '{}');
    localStorage.setItem('tablevote:me:session-id', '{}');
    clearSessionStorage('session-id');
    expect(localStorage.length).toBe(1);
    expect(localStorage.getItem('tablevote:codes')).toBe('{}');
  });

  it('sweeps expired and malformed records on application startup', () => {
    const valid: Identity = {
      participantId: 'valid', token: 'valid-token', nickname: 'Valid', color: 0,
      isHost: false, expiresAt: 200,
    };
    const expired = { ...valid, participantId: 'expired', expiresAt: 100 };
    localStorage.setItem('tablevote:me:VALID', JSON.stringify(valid));
    localStorage.setItem('tablevote:me:OLD', JSON.stringify(expired));
    localStorage.setItem('tablevote:prefs:OLD', JSON.stringify({ expiresAt: 100 }));
    localStorage.setItem('tablevote:me:BROKEN', '{');
    localStorage.setItem('tablevote:prefs:BROKEN', '{');
    vi.spyOn(Date, 'now').mockReturnValue(100);

    sweepExpiredSessionStorage();

    expect(localStorage.getItem('tablevote:me:VALID')).not.toBeNull();
    expect(localStorage.getItem('tablevote:me:OLD')).toBeNull();
    expect(localStorage.getItem('tablevote:prefs:OLD')).toBeNull();
    expect(localStorage.getItem('tablevote:me:BROKEN')).toBeNull();
    expect(localStorage.getItem('tablevote:prefs:BROKEN')).toBeNull();
  });
});
