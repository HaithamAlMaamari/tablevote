import { motion, useReducedMotion } from 'framer-motion';
import { Crown } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import confetti from 'canvas-confetti';
import { CUISINE_EMOJI } from '@shared/types';
import { useSession } from '@/lib/use-session';
import { SessionStateScreen } from '@/components/session-state';

const CONFETTI_COLORS = ['#C4552D', '#E9B44C', '#6B7A3F', '#FFFDF8'];
const EASE_SUSPENSE = [0.65, 0, 0.35, 1] as const;
const EASE_POP = [0.34, 1.56, 0.64, 1] as const;

function fireConfetti() {
  confetti({
    particleCount: 55, spread: 70, startVelocity: 38, gravity: 0.9, scalar: 0.9,
    origin: { y: 0.7 }, colors: CONFETTI_COLORS, disableForReducedMotion: true,
  });
  setTimeout(() => confetti({
    particleCount: 35, spread: 70, startVelocity: 38, gravity: 0.9, scalar: 0.9,
    origin: { y: 0.7 }, colors: CONFETTI_COLORS, disableForReducedMotion: true,
  }), 200);
}

function RevealCard({ name, badge, faceDown, dim }: { name?: string; badge?: string; faceDown?: boolean; dim?: boolean }) {
  return (
    <div
      className="flex h-[220px] w-[150px] items-center justify-center rounded-[20px] border p-4 text-center shadow-card"
      style={{
        background: faceDown ? '#F3EADB' : '#FFFDF8',
        borderColor: faceDown ? '#E3D8C6' : 'rgba(233,180,76,0.5)',
        opacity: dim ? 0.4 : 1,
        transformStyle: 'preserve-3d',
      }}
    >
      {faceDown ? (
        <svg viewBox="0 0 48 48" className="h-12 w-12 opacity-30" aria-hidden>
          <ellipse cx="24" cy="26" rx="18" ry="6" fill="#C4552D" />
          <rect x="20" y="30" width="8" height="12" rx="3" fill="#C4552D" />
        </svg>
      ) : (
        <div>
          {badge && <span className="mx-auto mb-2 flex h-7 w-7 items-center justify-center rounded-full bg-butter font-display text-[14px] font-semibold text-ink">{badge}</span>}
          <p className="font-display text-[18px] font-semibold leading-tight text-ink">{name}</p>
        </div>
      )}
    </div>
  );
}

export default function Reveal() {
  const { code = '' } = useParams();
  const nav = useNavigate();
  const { state, error, refresh } = useSession(code);
  const reduced = useReducedMotion() ?? false;
  const [phase, setPhase] = useState(reduced ? 3 : 0); // 0 lights down,1 finalists,2 winner,3 celebrate
  const [canSkip, setCanSkip] = useState(reduced);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const winnerHeadingRef = useRef<HTMLHeadingElement>(null);

  const result = state?.result?.kind === 'match' ? state.result : null;
  const top3 = result?.top3 ?? [];

  useEffect(() => {
    if (state?.result?.kind === 'no-verified-match') {
      nav(`/s/${code}/result`, { replace: true });
    }
  }, [state?.result?.kind, code, nav]);

  useEffect(() => {
    if (!result || reduced) return;
    const t = (ms: number, fn: () => void) => timers.current.push(setTimeout(fn, ms));
    t(600, () => setPhase(1));
    t(1200, () => setCanSkip(true));
    t(1800, () => setPhase(2));
    t(3000, () => { setPhase(3); fireConfetti(); });
    return () => { timers.current.forEach(clearTimeout); timers.current = []; };
  }, [code, nav, reduced, result]);
  useEffect(() => {
    if (phase >= 2) winnerHeadingRef.current?.focus();
  }, [phase]);

  const skip = () => {
    if (!canSkip) return;
    timers.current.forEach(clearTimeout);
    timers.current = [];
    setPhase(3);
    fireConfetti();
  };

  if (!result) {
    if (error) return <SessionStateScreen error={error} code={code} onRetry={refresh} />;
    // reveal not computed yet or direct visit — bounce to lobby/result
    return (
      <main className="flex min-h-dvh items-center justify-center bg-ink/95 text-cream">
        <p role="status" className="text-[15px] font-semibold">Counting votes…</p>
      </main>
    );
  }

  const [third, second, winner] = [top3[2], top3[1], top3[0]];
  const votes = state?.participants.filter((p) => p.submitted).length ?? 0;
  const fitLabel = winner.groupFit === 'strong' ? 'Strong shared fit' : winner.groupFit === 'good' ? 'Good shared fit' : 'Thoughtful compromise';
  const decisionSummary = winner.groupFit === 'strong'
    ? 'A strong shared fit, shaped by everyone’s private ballots.'
    : winner.groupFit === 'good'
      ? 'A good shared fit, shaped by everyone’s private ballots.'
      : 'A thoughtful compromise, shaped by everyone’s private ballots.';
  const caption = result.tiebreak !== 'none'
    ? "It's a tie — broken by the fairness ladder!"
    : `${votes} votes counted. ${top3.length} finalists. 1 winner.`;

  return (
    <motion.main
      className="fixed inset-0 z-30 flex flex-col items-center justify-center overflow-hidden"
      style={{ background: 'rgba(43,36,32,0.92)' }}
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.3 }}
    >
      <p className="absolute top-[14%] px-6 text-center text-[13px] font-semibold tracking-[0.01em] text-cream/70">
        {caption}
      </p>

      <div className="relative flex origin-center scale-[0.52] items-end justify-center gap-4 min-[350px]:scale-[0.58] min-[380px]:scale-[0.64] min-[430px]:scale-[0.72] min-[480px]:scale-[0.78]" style={{ perspective: 900 }}>
        {/* 3rd place */}
        {third && (
          <motion.div
            data-testid="reveal-finalist"
            initial={{ opacity: 0, y: 24, rotate: -6 }}
            animate={phase >= 1
               ? { opacity: 1, y: 0, x: -18, rotateY: 0, rotate: -6 }
              : { opacity: 1, y: 24, rotate: -6, rotateY: 180 }}
            transition={{ duration: 0.5, ease: EASE_SUSPENSE, delay: phase >= 1 ? 0 : 0.24 }}
          >
            <RevealCard faceDown={phase < 1} name={third.restaurant.name} badge="3" dim={phase >= 2} />
          </motion.div>
        )}

        {/* winner */}
        <div data-testid="reveal-finalist" className="relative">
          {phase >= 2 && (
            <motion.div
              className="absolute -inset-16 rounded-full"
              style={{ background: 'radial-gradient(circle, rgba(233,180,76,0.35), transparent 70%)' }}
              initial={{ opacity: 0, scale: 0.5 }} animate={{ opacity: 1, scale: 1.2 }} transition={{ duration: 0.8 }}
            />
          )}
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={
              phase >= 2
                ? { opacity: 1, y: 0, rotateY: 0, scale: 1 }
                : phase >= 1
                  ? { opacity: 1, y: 0, rotateY: 180, scale: 1 }
                  : { opacity: 1, y: 24, rotateY: 180 }
            }
            transition={
              phase >= 2
                  ? { duration: 0.5, ease: EASE_POP }
                  : phase >= 1
                  ? { duration: 0.5, ease: EASE_SUSPENSE }
                  : { duration: 0.5, delay: 0.12 }
            }
          >
            {phase < 2 ? (
              <RevealCard faceDown />
            ) : (
              <div role="status" aria-live="polite" aria-atomic="true" className="flex min-h-[240px] w-[190px] flex-col items-center justify-center rounded-[20px] border border-butter/50 bg-paper p-6 text-center shadow-winner">
                <Crown size={26} className="text-butter" fill="#E9B44C" />
                <h1 ref={winnerHeadingRef} tabIndex={-1} className="mt-2 font-display text-[24px] font-semibold leading-[1.2] tracking-[-0.01em] text-ink">{winner.restaurant.name}</h1>
                <p className="mt-1 text-[15px] text-ink-soft">
                  {winner.restaurant.cuisines.map((c) => CUISINE_EMOJI[c]).join(' ')}
                </p>
                <span className="mt-3 rounded-full bg-butter-tint px-3 py-1.5 font-display text-[16px] font-semibold text-ink">
                  {fitLabel}
                </span>
              </div>
            )}
          </motion.div>
        </div>

        {/* 2nd place */}
        {second && (
          <motion.div
            data-testid="reveal-finalist"
            initial={{ opacity: 0, y: 24, rotate: 6 }}
            animate={phase >= 1
               ? { opacity: 1, y: 0, x: 18, rotateY: 0, rotate: 6 }
              : { opacity: 1, y: 24, rotate: 6, rotateY: 180 }}
            transition={{ duration: 0.5, ease: EASE_SUSPENSE, delay: phase >= 1 ? 0.6 : 0.36 }}
          >
            <RevealCard faceDown={phase < 1} name={second.restaurant.name} badge="2" dim={phase >= 2} />
          </motion.div>
        )}
      </div>

      {phase >= 3 && (
        <div className="mt-8 text-center">
          <p className="font-display text-[24px] font-semibold text-cream">
            {'And dinner is… decided.'.split('').map((ch, i) => (
              <motion.span key={i} className="inline-block" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.02 }}>
                {ch === ' ' ? ' ' : ch}
              </motion.span>
            ))}
          </p>
          <motion.p
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.6 }}
            className="mx-auto mt-3 max-w-[290px] text-[14px] font-medium leading-relaxed text-cream/75"
          >
            {decisionSummary} Simulated dietary fixture filters stayed enforced.
          </motion.p>
        </div>
      )}

      {canSkip && phase < 3 && (
        <motion.button
          initial={{ opacity: 0 }} animate={{ opacity: 1 }}
          onClick={(e) => { e.stopPropagation(); skip(); }}
          className="absolute bottom-[calc(24px+env(safe-area-inset-bottom))] flex h-11 items-center rounded-full px-5 text-[14px] font-bold text-cream/60"
        >
          Skip →
        </motion.button>
      )}
      {phase >= 3 && (
        <button onClick={() => nav(`/s/${code}/result`)} className="absolute bottom-8 rounded-xl bg-terracotta-deep px-6 py-3 text-[14px] font-bold text-paper">
          See full results
        </button>
      )}
    </motion.main>
  );
}
