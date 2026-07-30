// Session hook: attaches to transport, keeps live snapshot, exposes identity.
import { useEffect, useState } from 'react';
import type { SessionErrorCode, SessionIssue, SessionSnapshot } from '@shared/types';
import { getTransport, type Transport } from './transport';
import { clearSessionStorage, loadIdentity, loadIdentityState, type Identity } from './identity';
import { toSessionIssue } from './session-errors';

interface SessionCommonState {
  transport: Transport | null;
  identity: Identity | null;
  connected: boolean;
  refresh: () => void;
}

export type SessionState = SessionCommonState &
  (
    | { status: 'loading'; state: null; error: null }
    | { status: 'ready'; state: SessionSnapshot; error: null }
    | { status: 'error'; state: null; error: SessionIssue }
  );

export function useSession(idOrCode: string | undefined): SessionState {
  const [transport, setTransport] = useState<Transport | null>(null);
  const [state, setState] = useState<SessionSnapshot | null>(null);
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [error, setError] = useState<SessionIssue | null>(null);
  const [connected, setConnected] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    if (!idOrCode) return;
    let disposed = false;
    let offState: (() => void) | null = null;
    let offConnection: (() => void) | null = null;
    let offEnded: (() => void) | null = null;
    let offExpired: (() => void) | null = null;
    let offRemoved: (() => void) | null = null;

    (async () => {
      try {
        const t = await getTransport();
        if (disposed) return;
        setState(null);
        setError(null);
        setConnected(false);
        setTransport(t);
        offConnection = t.onConnection((isConnected) => {
          if (!disposed) setConnected(isConnected);
        });
        const terminal = (code: SessionErrorCode, message: string) => {
          if (disposed) return;
          clearSessionStorage(idOrCode);
          setState(null);
          setIdentity(null);
          setError(toSessionIssue(message, code));
        };
        offEnded = t.onEvent('session-ended', () => terminal('ended', 'This session has ended'));
        offExpired = t.onEvent('session-expired', () => terminal('expired', 'This session has expired'));
        offRemoved = t.onEvent('removed', () => terminal('removed', 'You were removed from this session'));
        const loaded = loadIdentityState(idOrCode);
        const me = loaded.identity;
        setIdentity(me);

        const apply = (s: SessionSnapshot) => {
          if (disposed) return;
          setState(s);
          setError(null);
          // Identity may have been stored under code but session id differs.
          const realMe = loadIdentity(s.id) ?? me;
          if (realMe) setIdentity(realMe);
          if (realMe) localStorage.setItem(`tablevote:idref:${idOrCode}`, s.id);
        };

        if (me) {
          const res = await t.attach(idOrCode, me.token);
          if (res.ok) apply(res.value.state);
          else {
            const f = await t.fetch(idOrCode, me.token);
            if (f.ok) apply(f.value.state);
            else {
              const issue = toSessionIssue(f.error, f.errorCode);
              if (['ended', 'expired', 'not-found', 'access-required', 'removed'].includes(issue.code)) {
                clearSessionStorage(idOrCode);
              }
              setError(issue);
            }
          }
        } else if (loaded.expired) {
          setError(toSessionIssue('This session has expired', 'expired'));
        } else {
          const result = await t.invite(idOrCode);
          setError(
            result.ok
              ? toSessionIssue('Participant access required', 'access-required')
              : toSessionIssue(result.error, result.errorCode),
          );
        }
        offState = t.onState(apply);
      } catch {
        if (!disposed) {
          setConnected(false);
          setError(toSessionIssue('Server unavailable', 'unavailable'));
        }
      }
    })();

    return () => {
      disposed = true;
      offState?.();
      offConnection?.();
      offEnded?.();
      offExpired?.();
      offRemoved?.();
    };
  }, [idOrCode, refreshKey]);

  const common = {
    transport,
    identity,
    connected,
    refresh: () => setRefreshKey((key) => key + 1),
  };
  if (state) return { ...common, status: 'ready', state, error: null };
  if (error) return { ...common, status: 'error', state: null, error };
  return { ...common, status: 'loading', state: null, error: null };
}
