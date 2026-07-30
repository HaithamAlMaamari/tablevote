import { motion } from 'framer-motion';
import { Check, Crown, RefreshCw, Scale, Star } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { toast } from 'sonner';
import confetti from 'canvas-confetti';
import { SESSION_POLICY } from '@shared/policy';
import { W_CUISINE, W_DISTANCE, W_GROUP_BORDA, W_GROUP_MEAN, W_GROUP_MIN, W_PRICE, W_RATING } from '@shared/scoring';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import {
  AvatarDot,
  Btn,
  CtaBar,
  FadeUp,
  LiveBadge,
  SatisfactionBar,
  ScreenShell,
  TopBar,
} from '@/components/tablevote';
import { cuisineCode } from '@/lib/cuisine-marks';
import { EASE_POP, EASE_STANDARD } from '@/lib/motion';
import { useSession } from '@/lib/use-session';
import { SessionStateScreen } from '@/components/session-state';

const PRICE = (tier: number) =>
  ['Unknown price', 'Low-cost', 'Moderate', 'Higher-priced', 'Premium'][tier] ?? 'Unknown price';
const TIEBREAK_LABEL: Record<string, string> = {
  'least-misery': 'Tie broken by least-misery',
  copeland: 'Tie broken by head-to-head wins',
  'canonical-id': 'Tie broken by canonical restaurant ID',
};

export default function Result() {
  const { code = '' } = useParams();
  const nav = useNavigate();
  const { transport, state, identity, error, connected, refresh } = useSession(code);
  const [rerunning, setRerunning] = useState(false);
  const [miniReveal, setMiniReveal] = useState(false);
  const winnerHeadingRef = useRef<HTMLHeadingElement>(null);

  const result = state?.result ?? null;
  const resultKey = result?.kind === 'match' ? `${result.round}:${result.winner.restaurant.id}` : result?.kind;
  useEffect(() => {
    if (!resultKey) return;
    let focusFrame = 0;
    let focusTimer = 0;
    const focusWinner = () => winnerHeadingRef.current?.focus({ preventScroll: true });
    const dialogFrame = requestAnimationFrame(() => {
      // Run after alert-dialog focus restoration when a re-run replaces the result.
      focusFrame = requestAnimationFrame(() => {
        focusWinner();
        // WebKit can restore the dialog trigger after two animation frames.
        focusTimer = window.setTimeout(focusWinner, 200);
      });
    });
    return () => {
      cancelAnimationFrame(dialogFrame);
      cancelAnimationFrame(focusFrame);
      window.clearTimeout(focusTimer);
    };
  }, [resultKey]);

  useEffect(() => {
    if (!transport) return;
    const off = transport.onEvent('rerun', () => {
      setMiniReveal(true);
      confetti({
        particleCount: 40,
        spread: 60,
        origin: { y: 0.6 },
        colors: ['#EF3340', '#2457FF', '#C7F43D'],
        disableForReducedMotion: true,
      });
      setTimeout(() => setMiniReveal(false), 1500);
    });
    return off;
  }, [transport]);

  if (!state) {
    if (error) return <SessionStateScreen error={error} code={code} onRetry={refresh} />;
    return (
      <ScreenShell>
        <div className="flex flex-1 flex-col items-center justify-center p-6 text-center">
          <h1 className="font-display text-[24px] font-semibold text-ink">Loading result…</h1>
        </div>
      </ScreenShell>
    );
  }
  if (!result) {
    return (
      <ScreenShell>
        <TopBar label="The verdict" />
        <div className="flex flex-1 flex-col items-center justify-center px-5 text-center">
          <h1 className="font-display text-[24px] font-semibold text-ink">No verdict yet</h1>
          <p className="mt-2 text-[15px] text-ink-muted">The host hasn't started the reveal.</p>
          <Btn className="mt-6 px-6" onClick={() => nav(`/s/${code}/lobby`)}>
            To the lobby
          </Btn>
        </div>
      </ScreenShell>
    );
  }

  if (result.kind === 'no-verified-match') {
    return (
      <ScreenShell>
        <TopBar label="The verdict" />
        <div className="flex flex-1 flex-col items-center justify-center px-6 pb-32 text-center">
          <span className="flex h-16 w-16 items-center justify-center border-2 border-rule bg-acid text-ink shadow-[4px_4px_0_#241329]">
            <Scale size={30} strokeWidth={1.75} />
          </span>
          <h1 className="mt-5 font-display text-[30px] font-semibold tracking-[-0.015em] text-ink">No demo match</h1>
          <p className="mt-3 max-w-sm text-[15px] leading-relaxed text-ink-muted">
            No fictional fixture has simulated support for every required item. No requirement was relaxed.
          </p>
          <p className="mt-4 text-[13px] font-semibold text-ink-faint">
            Ask each person to review their own demo requirements privately, then start another round.
          </p>
        </div>
        <CtaBar>
          <Btn className="w-full" onClick={() => nav('/create')}>
            Start another demo
          </Btn>
        </CtaBar>
      </ScreenShell>
    );
  }

  const { winner, top3 } = result;
  const r = winner.restaurant;
  const isHost = !!identity?.isHost;
  const rerunsLeft = state.allowReruns ? SESSION_POLICY.rerunsPerSession - state.rerunsUsed : 0;
  const fitLabel =
    winner.groupFit === 'strong'
      ? 'Strong shared fit'
      : winner.groupFit === 'good'
        ? 'Good shared fit'
        : 'Thoughtful compromise';
  const doRerun = async () => {
    if (!transport || !identity?.hostToken) return;
    setRerunning(true);
    const res = await transport.rerun(state.id, identity.hostToken);
    setRerunning(false);
    if (!res.ok) toast.error(res.error ?? 'Re-run failed');
    else {
      setMiniReveal(true);
      setTimeout(() => setMiniReveal(false), 1500);
    }
  };

  return (
    <ScreenShell wide>
      <TopBar
        label="The verdict"
        right={
          <span className="flex items-center gap-2">
            <LiveBadge count={state.participants.length} connected={connected} />
          </span>
        }
      />
      <div className="min-w-0 flex-1 px-5 pb-52 pt-6 sm:px-6 lg:px-10 lg:pt-10">
        <p className="mb-5 border-2 border-rule bg-acid px-4 py-3 text-center font-mono text-[10px] font-medium uppercase tracking-wider text-ink">
          Demo result from fictional fixtures. Ratings, distance, availability, and dietary tags are simulated.
        </p>
        {winner.groupFit === 'compromise' && (
          <div className="mb-4 border-l-[6px] border-signal bg-signal-tint px-4 py-3 text-[13px] font-semibold text-ink">
            Tight call! Nobody loved everything — consider the runners-up.
          </div>
        )}

        <div className="min-w-0 lg:grid lg:grid-cols-[minmax(0,1.15fr)_minmax(300px,0.85fr)] lg:items-start lg:gap-8">
          <motion.div
            role="status"
            aria-live="polite"
            aria-atomic="true"
            initial={{ scale: 0.92, opacity: 0 }}
            animate={{ scale: miniReveal ? [1, 0.9, 1] : 1, opacity: 1 }}
            transition={{ duration: 0.45, ease: EASE_POP }}
            className="ticket-panel min-w-0 overflow-hidden p-6 text-center shadow-winner lg:p-9"
          >
            <span className="ballot-stamp absolute right-5 top-5 rotate-3 text-signal-dark">Selected</span>
            <Crown size={26} className="mx-auto text-electric" fill="#2457FF" />
            <p className="ticket-label mt-2">Tonight's pick</p>
            {result.round > 1 && (
              <p className="mt-1 text-[13px] font-semibold text-ink-faint">
                Round {result.round} · Previously: {result.previousWinners.join(', ')}
              </p>
            )}
            <h1
              ref={winnerHeadingRef}
              tabIndex={-1}
              className="mt-3 break-words font-display text-[40px] font-semibold leading-[1.05] tracking-[-0.02em] text-ink lg:text-[52px]"
            >
              {r.name}
            </h1>
            <p className="mt-3 text-[15px] text-ink-muted">
              {r.cuisines.map((c) => `${cuisineCode(c)} ${c}`).join(' · ')} · {PRICE(r.priceTier)} · demo distance{' '}
              {r.distanceKm.toFixed(1)} km
            </p>
            <span className="mt-4 inline-flex h-10 items-center border-2 border-rule bg-acid px-5 font-display text-[19px] font-bold text-ink shadow-[3px_3px_0_#241329]">
              {fitLabel}
            </span>
            <p className="mt-1 text-[12px] font-semibold text-ink-faint">Group-fit index, not a percentage</p>
            <p className="mt-3 flex items-center justify-center gap-1.5 text-[13px] font-semibold text-ink-muted">
              <Star size={14} className="text-electric" fill="#2457FF" /> demo rating {r.rating.toFixed(1)}
            </p>
            {result.tiebreak !== 'none' && (
              <p className="mt-2 text-[13px] font-semibold text-ink-faint">{TIEBREAK_LABEL[result.tiebreak]}</p>
            )}
          </motion.div>

          <div className="min-w-0 mt-8 lg:mt-0">
            <h2 className="font-display text-[24px] font-semibold tracking-[-0.01em] text-ink">Your private fit</h2>
            <p className="mt-1 text-[13px] font-semibold text-ink-faint">
              Only you can see this score. Other ballots stay private.
            </p>
            <div className="mt-4 flex min-w-0 items-center gap-3 border-2 border-rule bg-ticket p-4 shadow-[4px_4px_0_#2457FF]">
              <AvatarDot nickname={identity?.nickname ?? '?'} color={identity?.color ?? 0} size={36} />
              {result.ownWinnerFit === null ? (
                <p className="text-[14px] font-semibold text-ink-muted">You did not submit a ballot in this round.</p>
              ) : (
                <>
                  <SatisfactionBar value={result.ownWinnerFit} color="signal" />
                  <span className="w-14 text-right text-[14px] font-bold text-ink">
                    {Math.round(result.ownWinnerFit * 100)}/100
                  </span>
                </>
              )}
            </div>

            <FadeUp className="mt-8">
              <div className="border-l-[6px] border-electric bg-electric-tint p-5">
                <div className="flex items-center gap-2">
                  <Scale size={20} strokeWidth={2} className="text-electric" />
                  <h2 className="break-words font-display text-[24px] font-semibold tracking-[-0.01em] text-ink">
                    Why {r.name} won
                  </h2>
                </div>
                <ul className="mt-3 space-y-2">
                  {[
                    'Simulated dietary fixture evidence filters candidates before any scores are calculated.',
                    `Each private fit combines cuisine ${W_CUISINE * 100}, price ${W_PRICE * 100}, distance ${W_DISTANCE * 100}, and rating ${W_RATING * 100} points.`,
                    `The group-fit index combines average fit ${W_GROUP_MEAN * 100}, least-satisfied fit ${W_GROUP_MIN * 100}, and normalized rank points ${W_GROUP_BORDA * 100}.`,
                    'Flexible ballots stay out of the average, while their dislikes still affect least-satisfied fit.',
                    result.tiebreak === 'none'
                      ? 'No tie-break was needed.'
                      : `A near tie used ${TIEBREAK_LABEL[result.tiebreak].toLowerCase()}`,
                  ].map((e, i) => (
                    <motion.li
                      key={i}
                      initial={{ opacity: 0, x: -8 }}
                      whileInView={{ opacity: 1, x: 0 }}
                      viewport={{ once: true }}
                      transition={{ delay: i * 0.06 }}
                      className="flex items-start gap-2 text-[15px] text-ink-muted"
                    >
                      <Check size={15} className="mt-1 shrink-0 text-electric" strokeWidth={3} /> {e}
                    </motion.li>
                  ))}
                </ul>
                <p className="mt-4 text-[12px] font-semibold leading-relaxed text-ink-muted">
                  Fixture results must not be used for real dining or dietary decisions.
                </p>
              </div>
            </FadeUp>
          </div>
        </div>

        <p className="ticket-label mt-10">Runners-up</p>
        <div className="mt-3 grid grid-cols-2 gap-3">
          {top3.slice(1).map((f, i) => (
            <motion.div
              key={f.restaurant.id}
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.3, delay: i * 0.1, ease: EASE_STANDARD }}
              className="min-w-0 border-2 border-rule bg-ticket p-4 shadow-[4px_4px_0_#241329]"
            >
              <span className="flex h-8 w-8 items-center justify-center border-2 border-rule bg-electric-tint font-mono text-[13px] font-medium text-ink">
                {i + 2}
              </span>
              <p className="mt-2 break-words text-[15px] font-bold leading-tight text-ink">{f.restaurant.name}</p>
              <p className="mt-0.5 text-[13px] font-semibold text-ink-muted">
                {cuisineCode(f.restaurant.cuisines[0])} {f.restaurant.cuisines[0]} ·{' '}
                {f.groupFit === 'strong' ? 'Strong fit' : f.groupFit === 'good' ? 'Good fit' : 'Compromise'}
              </p>
              <p className="mt-2 font-mono text-[10px] font-medium uppercase tracking-wider text-signal-dark">
                Fictional fixture
              </p>
            </motion.div>
          ))}
        </div>
      </div>

      <CtaBar wide>
        {isHost && rerunsLeft > 0 ? (
          <>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Btn className="w-full" loading={rerunning}>
                  <RefreshCw size={18} /> Can't make it? Re-run
                </Btn>
              </AlertDialogTrigger>
              <AlertDialogContent className="max-w-[420px] rounded-[2px] border-[3px] border-rule bg-ticket shadow-ticket">
                <AlertDialogHeader>
                  <AlertDialogTitle className="font-display text-ink">Re-run without {r.name}?</AlertDialogTitle>
                  <AlertDialogDescription className="text-ink-muted">
                    Same votes, winner excluded. Next pick becomes the new result.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel className="rounded-[2px] border-2 border-rule">Keep it</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={doRerun}
                    className="rounded-[2px] border-2 border-rule bg-signal text-ticket hover:bg-signal-dark"
                  >
                    {rerunning ? 'Recalculating…' : 'Re-run'}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
            <p className="mt-1.5 text-center text-[13px] font-semibold text-ink-faint">
              {rerunsLeft} re-run{rerunsLeft === 1 ? '' : 's'} left
            </p>
          </>
        ) : (
          <Btn className="w-full" onClick={() => nav('/')}>
            Start a new session
          </Btn>
        )}
      </CtaBar>
    </ScreenShell>
  );
}
