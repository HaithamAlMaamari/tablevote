import { SESSION_POLICY } from './policy';
import type {
  ClientRestaurant,
  ClientVoteResult,
  GroupFitBand,
  InviteSnapshot,
  Participant,
  Restaurant,
  Session,
  SessionSnapshot,
} from './types';

export function groupFitBand(score: number): GroupFitBand {
  if (score >= 0.8) return 'strong';
  if (score >= 0.65) return 'good';
  return 'compromise';
}

function projectRestaurant(restaurant: Restaurant): ClientRestaurant {
  return {
    id: restaurant.id,
    name: restaurant.name,
    cuisines: [...restaurant.cuisines],
    priceTier: restaurant.priceTier,
    rating: restaurant.rating,
    distanceKm: restaurant.distanceKm,
  };
}

export function projectInvite(session: Session): InviteSnapshot {
  const hostNickname = session.shareHostNickname
    ? session.participants.find((participant) => participant.isHost)?.nickname
    : undefined;
  return {
    code: session.code,
    areaLabel: session.areaLabel,
    expiresAt: session.createdAt + SESSION_POLICY.ttlMs,
    joinable: session.phase === 'collecting',
    ...(hostNickname ? { hostNickname } : {}),
  };
}

function projectResult(session: Session, viewer: Participant): ClientVoteResult | null {
  if (!session.result) return null;
  if (session.result.kind === 'no-verified-match') {
    return {
      kind: 'no-verified-match',
      algorithmVersion: session.result.algorithmVersion,
      round: session.result.round,
      previousWinners: [...session.result.previousWinners],
    };
  }
  return {
    kind: 'match',
    algorithmVersion: session.result.algorithmVersion,
    winner: {
      restaurant: projectRestaurant(session.result.winner.restaurant),
      groupFit: groupFitBand(session.result.winner.score),
    },
    top3: session.result.top3.map((finalist) => ({
      restaurant: projectRestaurant(finalist.restaurant),
      groupFit: groupFitBand(finalist.score),
    })),
    ownWinnerFit:
      session.result.winner.perPerson.find((score) => score.participantId === viewer.id)?.satisfaction ?? null,
    tiebreak: session.result.tiebreak,
    round: session.result.round,
    previousWinners: [...session.result.previousWinners],
  };
}

export function projectSession(
  session: Session,
  viewer: Participant,
  onlineParticipantIds: ReadonlySet<string> = new Set(session.participants.map((participant) => participant.id)),
): SessionSnapshot {
  return {
    id: session.id,
    code: session.code,
    phase: session.phase,
    areaLabel: session.areaLabel,
    expiresAt: session.createdAt + SESSION_POLICY.ttlMs,
    allowReruns: session.allowReruns,
    rerunsUsed: session.rerunsUsed,
    selfParticipantId: viewer.id,
    ownPrefs: viewer.prefs
      ? {
          ...viewer.prefs,
          cuisines: { ...viewer.prefs.cuisines },
          dietary: viewer.prefs.dietary.map((item) => ({ ...item })),
        }
      : null,
    participants: session.participants.map((participant) => ({
      id: participant.id,
      nickname: participant.nickname,
      color: participant.color,
      submitted: participant.prefs !== null,
      isHost: participant.isHost,
      online: onlineParticipantIds.has(participant.id),
    })),
    result: projectResult(session, viewer),
  };
}
