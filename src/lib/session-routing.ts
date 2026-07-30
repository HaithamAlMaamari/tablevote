import { useEffect, useEffectEvent } from 'react';
import { useNavigate } from 'react-router';
import type { Phase, SessionSnapshot } from '@shared/types';

export type PhaseRouteContext = 'passive' | 'preferences' | 'joining';

export function sessionPhaseRoute(phase: Phase, code: string, context: PhaseRouteContext): string | null {
  if (context === 'joining') {
    return phase === 'collecting' ? `/s/${code}/preferences` : `/s/${code}/result`;
  }
  if (phase === 'revealed') return `/s/${code}/reveal`;
  if (phase === 'blocked-no-match') return `/s/${code}/result`;
  if (context === 'preferences' && phase === 'locking') return `/s/${code}/lobby`;
  return null;
}

export function useSessionPhaseNavigation(
  state: SessionSnapshot | null,
  context: Exclude<PhaseRouteContext, 'joining'>,
  onRevealed?: () => void,
): void {
  const navigate = useNavigate();
  const notifyRevealed = useEffectEvent(() => onRevealed?.());
  const phase = state?.phase;
  const code = state?.code;
  useEffect(() => {
    if (!phase || !code) return;
    const route = sessionPhaseRoute(phase, code, context);
    if (!route) return;
    if (phase === 'revealed') notifyRevealed();
    navigate(route);
  }, [code, context, navigate, phase]);
}
