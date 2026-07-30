// TableVote — shared types used by BOTH the server and the client.

export const CUISINES = [
  'Italian', 'Indian', 'Lebanese', 'Japanese', 'Turkish', 'American',
  'Seafood', 'Vegetarian', 'Fast Food', 'Cafe', 'Omani', 'Thai',
] as const;
export type Cuisine = (typeof CUISINES)[number];

export const CUISINE_EMOJI: Record<Cuisine, string> = {
  Italian: '🍝', Indian: '🍛', Lebanese: '🥙', Japanese: '🍣', Turkish: '🥘',
  American: '🍔', Seafood: '🍤', Vegetarian: '🥗', 'Fast Food': '🍟',
  Cafe: '☕', Omani: '🍢', Thai: '🍜',
};

export const DIETARY_TYPES = ['vegetarian', 'vegan', 'halal', 'kosher', 'gluten-free'] as const;
export type DietaryType = (typeof DIETARY_TYPES)[number];
export const SESSION_TTL_MS = 24 * 60 * 60 * 1000;
export const ALGORITHM_VERSION = 'tv-rank-1.0.0';

export type SessionErrorCode =
  | 'invalid'
  | 'not-found'
  | 'expired'
  | 'ended'
  | 'full'
  | 'locked'
  | 'offline'
  | 'timeout'
  | 'access-required'
  | 'removed'
  | 'rate-limited'
  | 'capacity'
  | 'unavailable'
  | 'unknown';

export interface SessionIssue {
  code: SessionErrorCode;
  message: string;
  retryable: boolean;
}

export type CuisineState = 'like' | 'neutral' | 'dislike';

export interface DietaryConstraint {
  type: DietaryType;
  strict: boolean;
}

export type DietaryEvidenceState = 'supported' | 'contradicted' | 'unknown' | 'stale';

export interface DietaryEvidence {
  state: DietaryEvidenceState;
  source: string;
  checkedAt: string;
}

export interface Prefs {
  /** cuisine -> tri-state; missing key = neutral */
  cuisines: Partial<Record<Cuisine, CuisineState>>;
  /** per-person budget bucket 1..4 (4 = "whatever it costs") */
  budget: 1 | 2 | 3 | 4;
  /** max distance in km; null = anywhere */
  maxDistanceKm: number | null;
  dietary: DietaryConstraint[];
}

export interface Restaurant {
  id: string;
  name: string;
  cuisines: Cuisine[];
  priceTier: 1 | 2 | 3 | 4;
  rating: number;
  distanceKm: number;
  lat: number;
  lng: number;
  address: string;
  dietaryEvidence: Record<DietaryType, DietaryEvidence>;
  openNow: boolean;
}

export interface Participant {
  id: string;
  token: string;
  nickname: string;
  color: number; // index into avatar color pairs
  prefs: Prefs | null;
  submittedAt: number | null;
  isHost: boolean;
}

export type Phase = 'collecting' | 'locking' | 'revealed' | 'blocked-no-match' | 'ended' | 'expired';

export interface Session {
  id: string;
  code: string;
  hostToken: string;
  participants: Participant[];
  phase: Phase;
  result: VoteResult | null;
  excludedIds: string[];
  rerunsUsed: number;
  allowReruns: boolean;
  createdAt: number;
  center: { lat: number; lng: number };
  areaLabel: string;
  radiusKm: number;
  /** Explicit permission to expose the host's temporary nickname in public invite metadata. */
  shareHostNickname?: boolean;
}

export type GroupFitBand = 'strong' | 'good' | 'compromise';

export interface ClientFinalist {
  restaurant: Restaurant;
  groupFit: GroupFitBand;
}

export interface ClientMatchedResult {
  kind: 'match';
  algorithmVersion: string;
  winner: ClientFinalist;
  top3: ClientFinalist[];
  ownWinnerFit: number | null;
  tiebreak: Tiebreak;
  round: number;
  previousWinners: string[];
}

export interface ClientNoVerifiedMatchResult {
  kind: 'no-verified-match';
  algorithmVersion: string;
  round: number;
  previousWinners: string[];
}

export type ClientVoteResult = ClientMatchedResult | ClientNoVerifiedMatchResult;

export interface InviteSnapshot {
  code: string;
  areaLabel: string;
  expiresAt: number;
  joinable: boolean;
  hostNickname?: string;
}

/** Participant-scoped snapshot with no ballots or cross-user scoring details. */
export interface SessionSnapshot {
  id: string;
  code: string;
  phase: Phase;
  areaLabel: string;
  expiresAt: number;
  allowReruns: boolean;
  rerunsUsed: number;
  selfParticipantId: string;
  ownPrefs: Prefs | null;
  participants: {
    id: string;
    nickname: string;
    color: number;
    submitted: boolean;
    isHost: boolean;
    online: boolean;
  }[];
  result: ClientVoteResult | null;
}

export interface PerPersonScore {
  participantId: string;
  nickname: string;
  color: number;
  satisfaction: number; // 0..1 utility of the finalist for this person
  flexible: boolean;
}

export interface Finalist {
  restaurant: Restaurant;
  score: number; // 0..1 aggregate
  perPerson: PerPersonScore[];
  meanUtility: number;
  minUtility: number;
}

export type Tiebreak = 'none' | 'least-misery' | 'copeland' | 'canonical-id';

export interface ScoringRow {
  restaurantId: string;
  name: string;
  cuisineScore: number;
  priceScore: number;
  distanceScore: number;
  ratingScore: number;
  meanUtility: number;
  minUtility: number;
  borda: number;
  total: number;
  eliminated: boolean;
}

export interface MatchedVoteResult {
  kind: 'match';
  algorithmVersion: string;
  winner: Finalist;
  top3: Finalist[];
  eliminatedCount: number;
  tiebreak: Tiebreak;
  explanation: string[];
  scoringSheet: ScoringRow[];
  round: number;
  previousWinners: string[];
}

export interface NoVerifiedMatchResult {
  kind: 'no-verified-match';
  algorithmVersion: string;
  eliminatedCount: number;
  round: number;
  previousWinners: string[];
}

export type VoteResult = MatchedVoteResult | NoVerifiedMatchResult;

export const AVATAR_COLORS: { bg: string; fg: string }[] = [
  { bg: '#F7E3D7', fg: '#A8431F' }, // terracotta
  { bg: '#E6EAD3', fg: '#6B7A3F' }, // olive
  { bg: '#F8EDD6', fg: '#8A6A1F' }, // butter
  { bg: '#F5DFD9', fg: '#B3412E' }, // tomato
];

export function groupFitBand(score: number): GroupFitBand {
  if (score >= 0.8) return 'strong';
  if (score >= 0.65) return 'good';
  return 'compromise';
}

export function inviteSnapshot(s: Session): InviteSnapshot {
  const hostNickname = s.shareHostNickname
    ? s.participants.find((participant) => participant.isHost)?.nickname
    : undefined;
  return {
    code: s.code,
    areaLabel: s.areaLabel,
    expiresAt: s.createdAt + SESSION_TTL_MS,
    joinable: s.phase === 'collecting',
    ...(hostNickname ? { hostNickname } : {}),
  };
}

export function snapshot(
  s: Session,
  viewer: Participant,
  onlineParticipantIds: ReadonlySet<string> = new Set(s.participants.map((participant) => participant.id)),
): SessionSnapshot {
  const result: ClientVoteResult | null = s.result?.kind === 'match'
    ? {
        kind: 'match',
        algorithmVersion: s.result.algorithmVersion,
        winner: {
          restaurant: s.result.winner.restaurant,
          groupFit: groupFitBand(s.result.winner.score),
        },
        top3: s.result.top3.map((finalist) => ({
          restaurant: finalist.restaurant,
          groupFit: groupFitBand(finalist.score),
        })),
        ownWinnerFit: s.result.winner.perPerson.find(
          (score) => score.participantId === viewer.id,
        )?.satisfaction ?? null,
        tiebreak: s.result.tiebreak,
        round: s.result.round,
        previousWinners: [...s.result.previousWinners],
      }
    : s.result
      ? {
          kind: 'no-verified-match',
          algorithmVersion: s.result.algorithmVersion,
          round: s.result.round,
          previousWinners: [...s.result.previousWinners],
        }
      : null;

  return {
    id: s.id,
    code: s.code,
    phase: s.phase,
    areaLabel: s.areaLabel,
    expiresAt: s.createdAt + SESSION_TTL_MS,
    allowReruns: s.allowReruns,
    rerunsUsed: s.rerunsUsed,
    selfParticipantId: viewer.id,
    ownPrefs: viewer.prefs ? {
      ...viewer.prefs,
      cuisines: { ...viewer.prefs.cuisines },
      dietary: viewer.prefs.dietary.map((item) => ({ ...item })),
    } : null,
    participants: s.participants.map((p) => ({
      id: p.id,
      nickname: p.nickname,
      color: p.color,
      submitted: p.prefs !== null,
      isHost: p.isHost,
      online: onlineParticipantIds.has(p.id),
    })),
    result,
  };
}
