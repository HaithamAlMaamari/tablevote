import { motion, useReducedMotion } from 'framer-motion';
import { Crown } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import confetti from 'canvas-confetti';
import { useSession } from '@/lib/use-session';
import { SessionStateScreen } from '@/components/session-state';
import { cuisineCode } from '@/lib/cuisine-marks';
import { EASE_POP } from '@/lib/motion';

const CONFETTI_COLORS = ['#EF3340', '#2457FF', '#C7F43D', '#FCFDF8'];
const EASE_SUSPENSE = [0.65, 0, 0.35, 1] as const;

function fireConfetti() {
  confetti({
    particleCount: 55,
    spread: 70,
    startVelocity: 38,
    gravity: 0.9,
    scalar: 0.9,
    origin: { y: 0.7 },
    colors: CONFETTI_COLORS,
    disableForReducedMotion: true,
  });
  setTimeout(
    () =>
      confetti({
        particleCount: 35,
        spread: 70,
        startVelocity: 38,
        gravity: 0.9,
        scalar: 0.9,
        origin: { y: 0.7 },
        colors: CONFETTI_COLORS,
        disableForReducedMotion: true,
      }),
    200,
  );
}

function RevealCard({
  name,
  badge,
  faceDown,
  dim,
}: {
  name?: string;
  badge?: string;
  faceDown?: boolean;
  dim?: boolean;
}) {
  return (
    <div
      className="flex h-[220px] w-[150px] items-center justify-center border-[3px] p-4 text-center shadow-ticket"
      style={{
        background: faceDown ? '#DDE5FF' : '#FCFDF8',
        borderColor: '#241329',
        opacity: dim ? 0.4 : 1,
        transformStyle: 'preserve-3d',
      }}
    >
      {faceDown ? (
        <svg viewBox="0 0 48 48" className="h-12 w-12 opacity-30" aria-hidden>
          <path d="M4 8h40v32H4z" fill="#FCFDF8" stroke="#241329" strokeWidth="4" />
          <path d="m14 25 7 7 14-16" fill="none" stroke="#2457FF" strokeWidth="4" />
        </svg>
      ) : (
        <div>
          {badge && (
            <span className="mx-auto mb-2 flex h-7 w-7 items-center justify-center border-2 border-rule bg-acid font-mono text-[12px] font-medium text-ink">
              {badge}
            </span>
          )}
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
    t(3000, () => {
      setPhase(3);
      fireConfetti();
    });
    return () => {
      timers.current.forEach(clearTimeout);
      timers.current = [];
    };
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
      <main className="flex min-h-dvh items-center justify-center bg-ink text-ticket">
        <p role="status" className="text-[15px] font-semibold">
          Counting votes…
        </p>
      </main>
    );
  }

  const top3 = result.top3;
  const winner = top3[0];
  const second = top3[1];
  const third = top3[2];
  const votes = state?.participants.filter((p) => p.submitted).length ?? 0;
  const fitLabel =
    winner.groupFit === 'strong'
      ? 'Strong shared fit'
      : winner.groupFit === 'good'
        ? 'Good shared fit'
        : 'Thoughtful compromise';
  const decisionSummary =
    winner.groupFit === 'strong'
      ? 'A strong shared fit, shaped by everyone’s private ballots.'
      : winner.groupFit === 'good'
        ? 'A good shared fit, shaped by everyone’s private ballots.'
        : 'A thoughtful compromise, shaped by everyone’s private ballots.';
  const caption =
    result.tiebreak !== 'none'
      ? 'A near tie used the documented tie-break sequence.'
      : `${votes} votes counted. ${top3.length} finalists. 1 winner.`;

  return (
    <motion.main
      className="fixed inset-0 z-30 flex flex-col items-center justify-center overflow-hidden"
      style={{ background: '#241329' }}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.3 }}
    >
      <p className="absolute top-[14%] px-6 text-center font-mono text-[11px] font-medium uppercase tracking-[0.12em] text-ticket/70">
        {caption}
      </p>

      <div
        className="relative flex origin-center scale-[0.52] items-end justify-center gap-4 min-[350px]:scale-[0.58] min-[380px]:scale-[0.64] min-[430px]:scale-[0.72] min-[480px]:scale-[0.78]"
        style={{ perspective: 900 }}
      >
        {third && (
          <motion.div
            data-testid="reveal-finalist"
            initial={{ opacity: 0, y: 24, rotate: -6 }}
            animate={
              phase >= 1
                ? { opacity: 1, y: 0, x: -18, rotateY: 0, rotate: -6 }
                : { opacity: 1, y: 24, rotate: -6, rotateY: 180 }
            }
            transition={{ duration: 0.5, ease: EASE_SUSPENSE, delay: phase >= 1 ? 0 : 0.24 }}
          >
            <RevealCard faceDown={phase < 1} name={third.restaurant.name} badge="3" dim={phase >= 2} />
          </motion.div>
        )}

        <div data-testid="reveal-finalist" className="relative">
          {phase >= 2 && (
            <motion.div
              className="absolute -inset-16 rounded-full"
              style={{ background: 'radial-gradient(circle, rgba(199,244,61,0.35), transparent 70%)' }}
              initial={{ opacity: 0, scale: 0.5 }}
              animate={{ opacity: 1, scale: 1.2 }}
              transition={{ duration: 0.8 }}
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
              <div
                role="status"
                aria-live="polite"
                aria-atomic="true"
                className="flex min-h-[240px] w-[190px] flex-col items-center justify-center border-[3px] border-rule bg-ticket p-6 text-center shadow-winner"
              >
                <Crown size={26} className="text-electric" fill="#2457FF" />
                <h1
                  ref={winnerHeadingRef}
                  tabIndex={-1}
                  className="mt-2 font-display text-[24px] font-semibold leading-[1.2] tracking-[-0.01em] text-ink"
                >
                  {winner.restaurant.name}
                </h1>
                <p className="mt-2 font-mono text-[10px] font-medium uppercase tracking-wider text-ink-muted">
                  {winner.restaurant.cuisines.map(cuisineCode).join(' · ')}
                </p>
                <span className="mt-3 border-2 border-rule bg-acid px-3 py-1.5 font-display text-[16px] font-semibold text-ink">
                  {fitLabel}
                </span>
              </div>
            )}
          </motion.div>
        </div>

        {second && (
          <motion.div
            data-testid="reveal-finalist"
            initial={{ opacity: 0, y: 24, rotate: 6 }}
            animate={
              phase >= 1
                ? { opacity: 1, y: 0, x: 18, rotateY: 0, rotate: 6 }
                : { opacity: 1, y: 24, rotate: 6, rotateY: 180 }
            }
            transition={{ duration: 0.5, ease: EASE_SUSPENSE, delay: phase >= 1 ? 0.6 : 0.36 }}
          >
            <RevealCard faceDown={phase < 1} name={second.restaurant.name} badge="2" dim={phase >= 2} />
          </motion.div>
        )}
      </div>

      {phase >= 3 && (
        <div className="mt-8 text-center">
          <p className="font-display text-[24px] font-semibold text-ticket">
            {'And dinner is… decided.'.split('').map((ch, i) => (
              <motion.span
                key={i}
                className="inline-block"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.02 }}
              >
                {ch === ' ' ? '\u00A0' : ch}
              </motion.span>
            ))}
          </p>
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.6 }}
            className="mx-auto mt-3 max-w-[290px] text-[14px] font-medium leading-relaxed text-ticket/75"
          >
            {decisionSummary} Required simulated dietary tags remained enforced.
          </motion.p>
        </div>
      )}

      {canSkip && phase < 3 && (
        <motion.button
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          onClick={(e) => {
            e.stopPropagation();
            skip();
          }}
          className="absolute bottom-[calc(24px+env(safe-area-inset-bottom))] flex h-11 items-center px-5 text-[14px] font-bold text-ticket/60"
        >
          Skip →
        </motion.button>
      )}
      {phase >= 3 && (
        <button
          onClick={() => nav(`/s/${code}/result`)}
          className="absolute bottom-8 border-2 border-ticket bg-signal px-6 py-3 text-[14px] font-bold text-ticket shadow-[4px_4px_0_#2457FF] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-acid focus-visible:ring-offset-2 focus-visible:ring-offset-ink"
        >
          See full results
        </button>
      )}
    </motion.main>
  );
}
