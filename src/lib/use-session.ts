// Session hook: attaches to transport, keeps live snapshot, exposes identity.
import { useEffect, useState } from 'react';
import type { SessionErrorCode, SessionIssue, SessionSnapshot } from '@shared/types';
import { clearSessionStorage, getTransport, loadIdentity, loadIdentityState, type Identity, type Transport } from './transport';
import { toSessionIssue } from './session-errors';

export interface SessionState {
  transport: Transport | null;
  state: SessionSnapshot | null;
  identity: Identity | null;
  error: SessionIssue | null;
  connected: boolean;
  refresh: () => void;
}

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
          if (res.state) apply(res.state);
          else {
            const f = await t.fetch(idOrCode, me.token);
            if (f.state) apply(f.state);
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
        } else if (t.mode === 'local') {
          setError(toSessionIssue('Participant access required', 'access-required'));
        } else {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 8_000);
          try {
            const response = await fetch(`/api/sessions/${encodeURIComponent(idOrCode)}`, {
              signal: controller.signal,
            });
            if (response.ok) setError(toSessionIssue('Participant access required', 'access-required'));
            else {
              const body = await response.json().catch(() => ({})) as {
                error?: string; errorCode?: SessionErrorCode;
              };
              setError(toSessionIssue(body.error, body.errorCode));
            }
          } catch (lookupError) {
            const timeout = lookupError instanceof DOMException && lookupError.name === 'AbortError';
            setError(toSessionIssue(
              timeout ? 'Request timed out' : 'Server unavailable',
              timeout ? 'timeout' : 'unavailable',
            ));
          } finally {
            clearTimeout(timer);
          }
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

  return {
    transport, state, identity, error, connected,
    refresh: () => setRefreshKey((key) => key + 1),
  };
}
