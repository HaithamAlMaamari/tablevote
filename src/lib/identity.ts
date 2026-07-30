export interface Identity {
  participantId: string;
  token: string;
  nickname: string;
  color: number;
  isHost: boolean;
  expiresAt: number;
  hostToken?: string;
}

export function saveIdentity(sessionId: string, identity: Identity): void {
  localStorage.setItem(`tablevote:me:${sessionId}`, JSON.stringify(identity));
}

export function linkSessionReferences(code: string, sessionId: string): void {
  localStorage.setItem(`tablevote:idref:${code}`, sessionId);
}

export function clearSessionStorage(...references: string[]): void {
  const targets = new Set(references.filter(Boolean));
  for (let index = 0; index < localStorage.length; index++) {
    const key = localStorage.key(index);
    if (!key?.startsWith('tablevote:idref:')) continue;
    const reference = key.slice('tablevote:idref:'.length);
    const resolved = localStorage.getItem(key);
    if (targets.has(reference) || (resolved && targets.has(resolved))) {
      targets.add(reference);
      if (resolved) targets.add(resolved);
    }
  }
  for (const target of targets) {
    localStorage.removeItem(`tablevote:me:${target}`);
    localStorage.removeItem(`tablevote:prefs:${target}`);
    localStorage.removeItem(`tablevote:idref:${target}`);
  }
}

export function loadIdentity(sessionId: string): Identity | null {
  return loadIdentityState(sessionId).identity;
}

export function loadIdentityState(sessionId: string): { identity: Identity | null; expired: boolean } {
  try {
    const raw = localStorage.getItem(`tablevote:me:${sessionId}`);
    if (!raw) {
      const marker = `tablevote:expired:${sessionId}`;
      const expired = typeof sessionStorage !== 'undefined' && sessionStorage.getItem(marker) === 'true';
      if (expired) sessionStorage.removeItem(marker);
      return { identity: null, expired };
    }
    const identity = JSON.parse(raw) as Identity;
    if (!identity.expiresAt || identity.expiresAt <= Date.now()) {
      clearSessionStorage(sessionId);
      return { identity: null, expired: true };
    }
    return { identity, expired: false };
  } catch {
    return { identity: null, expired: false };
  }
}

export function sweepExpiredSessionStorage(): void {
  const staleReferences: string[] = [];
  const staleDrafts: string[] = [];
  for (let index = 0; index < localStorage.length; index++) {
    const key = localStorage.key(index);
    if (!key) continue;
    if (key.startsWith('tablevote:me:')) {
      const reference = key.slice('tablevote:me:'.length);
      try {
        const identity = JSON.parse(localStorage.getItem(key) ?? '') as Identity;
        if (!identity.expiresAt || identity.expiresAt <= Date.now()) staleReferences.push(reference);
      } catch {
        staleReferences.push(reference);
      }
    }
    if (key.startsWith('tablevote:prefs:')) {
      try {
        const draft = JSON.parse(localStorage.getItem(key) ?? '') as { expiresAt?: number };
        if (!draft.expiresAt || draft.expiresAt <= Date.now()) staleDrafts.push(key);
      } catch {
        staleDrafts.push(key);
      }
    }
  }
  staleReferences.forEach((reference) => {
    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.setItem(`tablevote:expired:${reference}`, 'true');
      const linked = localStorage.getItem(`tablevote:idref:${reference}`);
      if (linked) sessionStorage.setItem(`tablevote:expired:${linked}`, 'true');
    }
    clearSessionStorage(reference);
  });
  staleDrafts.forEach((key) => localStorage.removeItem(key));
}
