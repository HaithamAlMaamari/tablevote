import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MutationSuccessSchema, SubmitResponseSchema } from '@shared/contracts';
import { clearSessionStorage, loadIdentity, saveIdentity, sweepExpiredSessionStorage, type Identity } from './identity';
import { decodeOperationResult } from './transport';

class MemoryStorage implements Storage {
  private values = new Map<string, string>();
  get length() {
    return this.values.size;
  }
  clear() {
    this.values.clear();
  }
  getItem(key: string) {
    return this.values.get(key) ?? null;
  }
  key(index: number) {
    return [...this.values.keys()][index] ?? null;
  }
  removeItem(key: string) {
    this.values.delete(key);
  }
  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}

describe('client transport decoding', () => {
  it('wraps a valid network response as a success value', () => {
    expect(decodeOperationResult({ ok: true }, MutationSuccessSchema)).toEqual({
      ok: true,
      value: { ok: true },
    });
  });

  it.each([
    ['Request timed out', 'timeout'],
    ['Server unavailable', 'unavailable'],
    ['Voting is closed', 'locked'],
  ] as const)('preserves the typed failure %s', (error, errorCode) => {
    expect(decodeOperationResult({ error, errorCode }, MutationSuccessSchema)).toEqual({
      ok: false,
      error,
      errorCode,
    });
  });

  it('turns malformed network data into a typed unknown failure', () => {
    expect(decodeOperationResult({ ok: false }, MutationSuccessSchema)).toEqual({
      ok: false,
      error: 'Invalid server response',
      errorCode: 'unknown',
    });
  });

  it.each([{ ok: true }, { ok: true, state: {} }, { ok: true, state: null }])(
    'rejects a malformed submit response %#',
    (response) => {
      expect(decodeOperationResult(response, SubmitResponseSchema)).toEqual({
        ok: false,
        error: 'Invalid server response',
        errorCode: 'unknown',
      });
    },
  );
});

describe('client session retention', () => {
  beforeEach(() => vi.stubGlobal('localStorage', new MemoryStorage()));
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('removes expired identities and linked session storage', () => {
    const identity: Identity = {
      participantId: 'p1',
      token: 'token',
      nickname: 'Host',
      color: 0,
      isHost: true,
      expiresAt: 100,
      hostToken: 'host',
    };
    saveIdentity('ABCDE', identity);
    localStorage.setItem('tablevote:prefs:ABCDE', '{}');
    localStorage.setItem('tablevote:idref:ABCDE', 'session-id');
    localStorage.setItem('tablevote:me:session-id', JSON.stringify(identity));
    vi.spyOn(Date, 'now').mockReturnValue(100);

    expect(loadIdentity('ABCDE')).toBeNull();
    expect(localStorage.getItem('tablevote:me:ABCDE')).toBeNull();
    expect(localStorage.getItem('tablevote:me:session-id')).toBeNull();
    expect(localStorage.getItem('tablevote:prefs:ABCDE')).toBeNull();
  });

  it('clears explicit code and ID references together', () => {
    localStorage.setItem('tablevote:idref:ABCDE', 'session-id');
    localStorage.setItem('tablevote:me:ABCDE', '{}');
    localStorage.setItem('tablevote:me:session-id', '{}');
    clearSessionStorage('session-id');
    expect(localStorage.length).toBe(0);
  });

  it('sweeps expired and malformed records on application startup', () => {
    const valid: Identity = {
      participantId: 'valid',
      token: 'valid-token',
      nickname: 'Valid',
      color: 0,
      isHost: false,
      expiresAt: 200,
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
