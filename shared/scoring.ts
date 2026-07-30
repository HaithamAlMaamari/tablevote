// TableVote — the fairness engine. Used by BOTH server and client (local mode).
//
// 1. Hard filter: strict dietary constraints eliminate restaurants that do not
//    carry the corresponding catalog tag. Strict requirements are never relaxed;
//    an empty candidate set returns no verified match.
// 2. Per-member utility u_m(r) in [0,1]:
//      cuisine 0.35 (like=1, neutral=0.55, dislike=0.05; best of restaurant's cuisines)
//      price   0.25 (tier<=budget=1; one over=0.35; else 0; budget 4 = anything)
//      dist    0.20 (<=max=1; <=1.5x max=0.5; else 0.1; no limit=1)
//      rating  0.20 ((rating-3.5)/1.5 clamped 0..1)
//    "Flexible" participants (no likes, no strict dietary) are excluded from the
//    mean, but their dislikes still count via the min term and strict constraints
//    still hard-filter.
// 3. Aggregate: 0.70*mean + 0.20*min + 0.10*normalized Borda points.
// 4. Tie ladder (delta < 0.01): least-misery -> Copeland -> canonical ID.

import type { Cuisine, DietaryType, Finalist, Participant, Prefs, Restaurant, Tiebreak, VoteResult } from './types';
import { ALGORITHM_VERSION, CUISINE_EMOJI } from './types';

export const W_CUISINE = 0.35;
export const W_PRICE = 0.25;
export const W_DISTANCE = 0.2;
export const W_RATING = 0.2;
export const W_GROUP_MEAN = 0.7;
export const W_GROUP_MIN = 0.2;
export const W_GROUP_BORDA = 0.1;
export const TIE_EPSILON = 0.01;
export const SCORE_PRECISION = 1_000_000;

export function roundScore(value: number): number {
  return Math.round((value + Number.EPSILON) * SCORE_PRECISION) / SCORE_PRECISION;
}

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

export function isFlexible(prefs: Prefs): boolean {
  const hasLike = Object.values(prefs.cuisines).some((v) => v === 'like');
  const hasStrict = prefs.dietary.some((d) => d.strict);
  return !hasLike && !hasStrict;
}

/** Effective hard constraints for a participant. Strict requirements are never relaxed. */
function hardConstraints(prefs: Prefs): DietaryType[] {
  return prefs.dietary.filter((d) => d.strict).map((d) => d.type);
}

export function supportsRequiredDietaryEvidence(r: Restaurant, type: DietaryType): boolean {
  return r.dietaryEvidence[type]?.state === 'supported';
}

export function passesHardFilter(r: Restaurant, prefsList: Prefs[]): boolean {
  for (const p of prefsList) {
    for (const d of hardConstraints(p)) {
      if (!supportsRequiredDietaryEvidence(r, d)) return false;
    }
  }
  return true;
}

export function cuisineScore(prefs: Prefs, r: Restaurant): number {
  let best = -1;
  for (const c of r.cuisines) {
    const v = prefs.cuisines[c as Cuisine] ?? 'neutral';
    const s = v === 'like' ? 1 : v === 'dislike' ? 0.05 : 0.55;
    best = Math.max(best, s);
  }
  return best < 0 ? 0.55 : best;
}

export function priceScore(prefs: Prefs, r: Restaurant): number {
  if (prefs.budget === 4) return 1;
  if (r.priceTier <= prefs.budget) return 1;
  if (r.priceTier === prefs.budget + 1) return 0.35;
  return 0;
}

export function distanceScore(prefs: Prefs, r: Restaurant): number {
  if (prefs.maxDistanceKm === null) return 1;
  if (r.distanceKm <= prefs.maxDistanceKm) return 1;
  if (r.distanceKm <= prefs.maxDistanceKm * 1.5) return 0.5;
  return 0.1;
}

export function ratingScore(r: Restaurant): number {
  return roundScore(clamp01((r.rating - 3.5) / 1.5));
}

export function utility(prefs: Prefs, r: Restaurant): number {
  return roundScore(
    W_CUISINE * cuisineScore(prefs, r) +
      W_PRICE * priceScore(prefs, r) +
      W_DISTANCE * distanceScore(prefs, r) +
      W_RATING * ratingScore(r),
  );
}

/** Copeland pairwise wins of a over b: members strictly preferring a vs b. */
function copelandWin(utilsA: number[], utilsB: number[]): number {
  let a = 0,
    b = 0;
  for (let i = 0; i < utilsA.length; i++) {
    if (utilsA[i] > utilsB[i]) a++;
    else if (utilsB[i] > utilsA[i]) b++;
  }
  return a > b ? 1 : a < b ? -1 : 0;
}

export function computeResult(
  _sessionId: string,
  participants: Participant[],
  restaurants: Restaurant[],
  excludedIds: string[] = [],
  round = 1,
  previousWinners: string[] = [],
): VoteResult {
  const voted = participants.filter((p) => p.prefs !== null);
  const prefsList = voted.map((p) => p.prefs as Prefs);
  const pool = restaurants.filter((r) => !excludedIds.includes(r.id));

  // --- 1. Hard filter. No candidate is safer than an incompatible candidate. ---
  const candidates = pool.filter((r) => passesHardFilter(r, prefsList));
  if (candidates.length === 0) {
    return {
      kind: 'no-verified-match',
      algorithmVersion: ALGORITHM_VERSION,
      eliminatedCount: pool.length,
      round,
      previousWinners,
    };
  }
  const eliminatedCount = pool.length - candidates.length;

  // --- 2. Per-member utilities ---
  const flexFlags = voted.map((p) => isFlexible(p.prefs as Prefs));
  const utilsByCandidate = candidates.map((r) => voted.map((p) => utility(p.prefs as Prefs, r)));
  const countedIdx = voted.map((_, i) => i).filter((i) => !flexFlags[i]);

  const meanOf = (u: number[]) =>
    roundScore(
      countedIdx.length === 0
        ? u.reduce((a, b) => a + b, 0) / Math.max(1, u.length)
        : countedIdx.reduce((a, i) => a + u[i], 0) / countedIdx.length,
    );
  const minOf = (u: number[]) => (u.length === 0 ? 1 : Math.min(...u));

  // --- 3. Borda points (per member, over candidates), normalized ---
  const n = candidates.length;
  const bordaRaw = candidates.map(() => 0);
  for (let m = 0; m < voted.length; m++) {
    const order = candidates.map((_, ci) => ci).sort((a, b) => utilsByCandidate[b][m] - utilsByCandidate[a][m]);
    // Fractional Borda: candidates with EQUAL utility for this member share the
    // average of their rank points (no arbitrary index-order bias, so genuine
    // ties actually reach the tie ladder instead of being silently broken).
    let rank = 0;
    while (rank < n) {
      let end = rank;
      while (end + 1 < n && utilsByCandidate[order[end + 1]][m] === utilsByCandidate[order[rank]][m]) end++;
      const avgPoints = (n - 1 - rank + (n - 1 - end)) / 2;
      for (let k = rank; k <= end; k++) bordaRaw[order[k]] += avgPoints;
      rank = end + 1;
    }
  }
  const bordaMax = Math.max(1, ...bordaRaw);
  const bordaNorm = bordaRaw.map((b) => roundScore(b / bordaMax));

  const rows = candidates.map((r, ci) => {
    const u = utilsByCandidate[ci];
    const mean = meanOf(u);
    const min = minOf(u);
    const total = roundScore(W_GROUP_MEAN * mean + W_GROUP_MIN * min + W_GROUP_BORDA * bordaNorm[ci]);
    return { r, ci, u, mean, min, borda: bordaNorm[ci], total };
  });
  rows.sort((a, b) => b.total - a.total || a.r.id.localeCompare(b.r.id));

  // --- 4. Tie ladder ---
  let tiebreak: Tiebreak = 'none';
  if (rows.length > 1 && rows[0].total - rows[1].total < TIE_EPSILON) {
    const tied = rows.filter((x) => rows[0].total - x.total < TIE_EPSILON);
    // (a) least misery: highest min utility
    tied.sort((a, b) => b.min - a.min || a.r.id.localeCompare(b.r.id));
    if (tied[0].min - tied[1].min >= TIE_EPSILON) {
      tiebreak = 'least-misery';
    } else {
      // (b) Copeland pairwise wins among tied
      const copeland = tied
        .map((row) => ({
          row,
          score: tied.reduce((wins, other) => (other === row ? wins : wins + copelandWin(row.u, other.u)), 0),
        }))
        .sort((a, b) => b.score - a.score || a.row.r.id.localeCompare(b.row.r.id));
      if (copeland[0].score > copeland[1].score) {
        tiebreak = 'copeland';
        tied.splice(0, tied.length, ...copeland.map((entry) => entry.row));
      } else {
        // (c) canonical ID is the final stable fallback.
        tiebreak = 'canonical-id';
        tied.splice(0, tied.length, ...copeland.map((entry) => entry.row));
      }
    }
    // keep the rest ordered by total
    const tiedIds = new Set(tied.map((t) => t.r.id));
    const rest = rows.filter((x) => !tiedIds.has(x.r.id));
    rows.length = 0;
    rows.push(...tied, ...rest);
  }

  const toFinalist = (row: (typeof rows)[number]): Finalist => ({
    restaurant: row.r,
    score: roundScore(clamp01(row.total)),
    meanUtility: row.mean,
    minUtility: row.min,
    perPerson: voted.map((p, i) => ({
      participantId: p.id,
      nickname: p.nickname,
      color: p.color,
      satisfaction: roundScore(clamp01(row.u[i])),
      flexible: flexFlags[i],
    })),
  });

  const finalists = rows.map(toFinalist);
  const winner = finalists[0];
  const top3 = finalists.slice(0, 3);

  // --- 5. Explanation bullets ---
  const explanation = buildExplanation(winner, voted, flexFlags, eliminatedCount, tiebreak, finalists[1]);

  const scoringSheet = restaurants
    .map((r) => {
      const row = rows.find((x) => x.r.id === r.id);
      if (!row) {
        return {
          restaurantId: r.id,
          name: r.name,
          cuisineScore: 0,
          priceScore: 0,
          distanceScore: 0,
          ratingScore: ratingScore(r),
          meanUtility: 0,
          minUtility: 0,
          borda: 0,
          total: 0,
          eliminated: true,
        };
      }
      const auditIndexes = countedIdx.length > 0 ? countedIdx : voted.map((_, index) => index);
      const average = (component: (prefs: Prefs, restaurant: Restaurant) => number) =>
        roundScore(
          auditIndexes.reduce((sum, index) => sum + component(voted[index].prefs as Prefs, row.r), 0) /
            Math.max(1, auditIndexes.length),
        );
      return {
        restaurantId: r.id,
        name: r.name,
        cuisineScore: average(cuisineScore),
        priceScore: average(priceScore),
        distanceScore: average(distanceScore),
        ratingScore: ratingScore(row.r),
        meanUtility: row.mean,
        minUtility: row.min,
        borda: row.borda,
        total: row.total,
        eliminated: false,
      };
    })
    .sort((a, b) => b.total - a.total || a.restaurantId.localeCompare(b.restaurantId));

  return {
    kind: 'match',
    algorithmVersion: ALGORITHM_VERSION,
    winner,
    top3,
    eliminatedCount,
    tiebreak,
    explanation,
    scoringSheet,
    round,
    previousWinners,
  };
}

function buildExplanation(
  winner: Finalist,
  voted: Participant[],
  flexFlags: boolean[],
  eliminatedCount: number,
  tiebreak: Tiebreak,
  runnerUp: Finalist | undefined,
): string[] {
  const out: string[] = [];
  const r = winner.restaurant;
  const counted = voted.filter((_, i) => !flexFlags[i]);

  // Cuisine sentiment
  const primaryCuisine = r.cuisines[0];
  const likes = counted.filter((p) => (p.prefs as Prefs).cuisines[primaryCuisine] === 'like').length;
  const dislikes = voted.filter((p) => (p.prefs as Prefs).cuisines[primaryCuisine] === 'dislike').length;
  if (likes > 0 && dislikes === 0) {
    out.push(`Loved by ${likes} of ${counted.length || voted.length} — nobody disliked the ${primaryCuisine} menu`);
  } else if (dislikes === 0) {
    out.push(`Everyone likes or is neutral about ${primaryCuisine}`);
  } else {
    out.push(`Best cuisine overlap for the table (${CUISINE_EMOJI[primaryCuisine]} ${primaryCuisine})`);
  }

  // Budget
  const maxBudget = Math.max(...counted.map((p) => (p.prefs as Prefs).budget));
  const fitsAll = counted.every((p) => priceScore(p.prefs as Prefs, r) === 1);
  if (fitsAll && counted.length > 0) {
    const tightest = Math.min(...counted.map((p) => (p.prefs as Prefs).budget));
    const who = counted.find((p) => (p.prefs as Prefs).budget === tightest);
    const label = '$'.repeat(Math.min(tightest, 4));
    out.push(
      tightest >= 4
        ? 'Budget was no object for anyone — price never hurt it'
        : `Fits ${who?.nickname ?? 'everyone'}'s ${label} budget (max tier ${'$'.repeat(Math.min(maxBudget, 4))})`,
    );
  }

  // Distance
  const within = counted.every((p) => distanceScore(p.prefs as Prefs, r) === 1);
  if (within && counted.some((p) => (p.prefs as Prefs).maxDistanceKm !== null)) {
    out.push(`Only ${r.distanceKm.toFixed(1)} km — within everyone's range`);
  } else {
    out.push(`${r.distanceKm.toFixed(1)} km from your area center`);
  }

  // Strict dietary — ONE combined bullet: eliminatedCount is produced by the
  // union of everyone's enforced strict constraints, so attributing the full
  // count to each person individually would overstate each one's effect.
  if (eliminatedCount > 0) {
    const descs = voted
      .map((p) => {
        const enforced = (p.prefs as Prefs).dietary.filter((d) => d.strict).map((d) => d.type);
        return enforced.length > 0 ? `${p.nickname}'s strict ${enforced.join(' + ')}` : null;
      })
      .filter((x): x is string => x !== null);
    if (descs.length > 0) {
      const noun = descs.length === 1 ? 'requirement' : 'requirements';
      out.push(`${descs.join(' and ')} ${noun} removed ${eliminatedCount} option${eliminatedCount === 1 ? '' : 's'}`);
    }
  }
  // Rating
  if (r.rating >= 4.4) out.push(`Highly rated: ${r.rating.toFixed(1)}★`);

  // Tie note
  if (tiebreak !== 'none' && runnerUp) {
    const how =
      tiebreak === 'least-misery'
        ? 'least-misery (higher worst-case satisfaction)'
        : tiebreak === 'copeland'
          ? 'pairwise head-to-head wins'
          : 'canonical restaurant ID';
    out.push(`Tied with ${runnerUp.restaurant.name} on score — tie broken by ${how}`);
  }
  return out.slice(0, 6);
}

export type { Prefs, Restaurant, Participant, VoteResult, Tiebreak };
