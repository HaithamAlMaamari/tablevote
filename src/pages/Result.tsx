import { motion } from 'framer-motion';
import { Check, Crown, RefreshCw, Scale, Star } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { toast } from 'sonner';
import confetti from 'canvas-confetti';
import { CUISINE_EMOJI } from '@shared/types';
import {
  W_CUISINE, W_DISTANCE, W_GROUP_BORDA, W_GROUP_MEAN, W_GROUP_MIN, W_PRICE, W_RATING,
} from '@shared/scoring';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { AvatarDot, Btn, CtaBar, FadeUp, LiveBadge, ModeBadge, SatisfactionBar, ScreenShell, TopBar } from '@/components/tablevote';
import { EASE_POP, EASE_STANDARD } from '@/lib/motion';
import { useSession } from '@/lib/use-session';
import { SessionStateScreen } from '@/components/session-state';

const PRICE = (tier: number) => ['Unknown price', 'Low-cost', 'Moderate', 'Higher-priced', 'Premium'][tier] ?? 'Unknown price';
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
    const dialogFrame = requestAnimationFrame(() => {
      // Run after alert-dialog focus restoration when a re-run replaces the result.
      focusFrame = requestAnimationFrame(() => winnerHeadingRef.current?.focus());
    });
    return () => {
      cancelAnimationFrame(dialogFrame);
      cancelAnimationFrame(focusFrame);
    };
  }, [resultKey]);

  // mini-reveal on rerun broadcast
  useEffect(() => {
    if (!transport) return;
    const off = transport.onEvent('rerun', () => {
      setMiniReveal(true);
      confetti({ particleCount: 40, spread: 60, origin: { y: 0.6 }, colors: ['#C4552D', '#E9B44C', '#6B7A3F'], disableForReducedMotion: true });
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
          <p className="mt-2 text-[15px] text-ink-soft">The host hasn't started the reveal.</p>
          <Btn className="mt-6 px-6" onClick={() => nav(`/s/${code}/lobby`)}>To the lobby</Btn>
        </div>
      </ScreenShell>
    );
  }

  if (result.kind === 'no-verified-match') {
    return (
      <ScreenShell>
        <TopBar label="The verdict" />
        <div className="flex flex-1 flex-col items-center justify-center px-6 pb-32 text-center">
          <span className="flex h-16 w-16 items-center justify-center rounded-full bg-butter-tint text-[#725719]">
            <Scale size={30} strokeWidth={1.75} />
          </span>
          <h1 className="mt-5 font-display text-[30px] font-semibold tracking-[-0.015em] text-ink">No demo match</h1>
          <p className="mt-3 max-w-sm text-[15px] leading-relaxed text-ink-soft">
            No fictional fixture has simulated support for every Required item. No requirement was relaxed.
          </p>
          <p className="mt-4 text-[13px] font-semibold text-ink-faint">
            Ask each person to review their own demo requirements privately, then start another round.
          </p>
        </div>
        <CtaBar>
          <Btn className="w-full" onClick={() => nav('/create')}>Start another demo</Btn>
        </CtaBar>
      </ScreenShell>
    );
  }

  const { winner, top3 } = result;
  const r = winner.restaurant;
  const isHost = !!identity?.isHost;
  const rerunsLeft = state.allowReruns ? 2 - state.rerunsUsed : 0;
  const fitLabel = winner.groupFit === 'strong' ? 'Strong shared fit' : winner.groupFit === 'good' ? 'Good shared fit' : 'Thoughtful compromise';
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
        right={<span className="flex items-center gap-2">{transport?.mode === 'local' && <ModeBadge />}<LiveBadge count={state.participants.length} connected={connected} /></span>}
      />
      <div className="min-w-0 flex-1 px-5 pb-52 pt-6 sm:px-6 lg:px-10 lg:pt-10">
        <p className="mb-4 rounded-xl border border-butter/60 bg-butter-tint px-4 py-3 text-center text-[13px] font-semibold text-ink-soft">
          Demo result from fictional fixtures. Ratings, distance, availability, and dietary tags are simulated.
        </p>
        {winner.groupFit === 'compromise' && (
          <div className="mb-4 rounded-xl bg-butter-tint px-4 py-3 text-[13px] font-semibold text-[#725719]">
            Tight call! Nobody loved everything — consider the runners-up.
          </div>
        )}

        <div className="min-w-0 lg:grid lg:grid-cols-[minmax(0,1.15fr)_minmax(300px,0.85fr)] lg:items-start lg:gap-8">
          {/* Winner card */}
          <motion.div
          role="status"
          aria-live="polite"
          aria-atomic="true"
          initial={{ scale: 0.92, opacity: 0 }} animate={{ scale: miniReveal ? [1, 0.9, 1] : 1, opacity: 1 }}
          transition={{ duration: 0.45, ease: EASE_POP }}
          className="min-w-0 rounded-[24px] border border-butter/50 p-6 text-center shadow-winner lg:p-9"
          style={{ background: 'radial-gradient(circle at 50% 0%, #F8EDD6 0%, #FFFDF8 70%)' }}
        >
          <Crown size={24} className="mx-auto text-butter" fill="#E9B44C" />
          <p className="mt-1 text-[13px] font-semibold uppercase tracking-[0.01em] text-ink-soft">Tonight's pick</p>
          {result.round > 1 && (
            <p className="mt-1 text-[13px] font-semibold text-ink-faint">
              Round {result.round} · Previously: {result.previousWinners.join(', ')}
            </p>
          )}
          <h1 ref={winnerHeadingRef} tabIndex={-1} className="mt-3 break-words font-display text-[40px] font-semibold leading-[1.05] tracking-[-0.02em] text-ink lg:text-[52px]">{r.name}</h1>
          <p className="mt-2 text-[15px] text-ink-soft">
            {r.cuisines.map((c) => `${CUISINE_EMOJI[c]} ${c}`).join(' · ')} · {PRICE(r.priceTier)} · demo distance {r.distanceKm.toFixed(1)} km
          </p>
          <span className="mt-4 inline-flex h-10 items-center rounded-full bg-butter-tint px-5 font-display text-[20px] font-semibold text-ink">
            {fitLabel}
          </span>
          <p className="mt-1 text-[12px] font-semibold text-ink-faint">Group-fit index, not a percentage</p>
          <p className="mt-3 flex items-center justify-center gap-1.5 text-[13px] font-semibold text-ink-soft">
            <Star size={14} className="text-butter" fill="#E9B44C" /> demo rating {r.rating.toFixed(1)}
          </p>
          {result.tiebreak !== 'none' && (
            <p className="mt-2 text-[13px] font-semibold text-ink-faint">{TIEBREAK_LABEL[result.tiebreak]}</p>
          )}
          </motion.div>

          <div className="min-w-0 mt-8 lg:mt-0">
        {/* Participant-private fit */}
        <h2 className="font-display text-[24px] font-semibold tracking-[-0.01em] text-ink">Your private fit</h2>
        <p className="mt-1 text-[13px] font-semibold text-ink-faint">Only you can see this score. Other ballots stay private.</p>
        <div className="mt-4 flex min-w-0 items-center gap-3 rounded-[20px] border border-clay-line bg-paper p-4 shadow-card">
          <AvatarDot nickname={identity?.nickname ?? '?'} color={identity?.color ?? 0} size={36} />
          {result.ownWinnerFit === null ? (
            <p className="text-[14px] font-semibold text-ink-soft">You did not submit a ballot in this round.</p>
          ) : (
            <>
              <SatisfactionBar value={result.ownWinnerFit} color="terracotta" />
              <span className="w-14 text-right text-[14px] font-bold text-ink">{Math.round(result.ownWinnerFit * 100)}/100</span>
            </>
          )}
        </div>

        {/* Why this won */}
        <FadeUp className="mt-8">
          <div className="rounded-[20px] bg-cream-deep p-5">
            <div className="flex items-center gap-2">
              <Scale size={20} strokeWidth={1.75} className="text-olive" />
              <h2 className="break-words font-display text-[24px] font-semibold tracking-[-0.01em] text-ink">Why {r.name} won</h2>
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
                  initial={{ opacity: 0, x: -8 }} whileInView={{ opacity: 1, x: 0 }}
                  viewport={{ once: true }} transition={{ delay: i * 0.06 }}
                  className="flex items-start gap-2 text-[15px] text-ink-soft"
                >
                  <Check size={15} className="mt-1 shrink-0 text-olive" /> {e}
                </motion.li>
              ))}
            </ul>
            <p className="mt-4 text-[12px] font-semibold leading-relaxed text-ink-faint">Fixture results must not be used for real dining or dietary decisions.</p>
          </div>
        </FadeUp>
          </div>
        </div>

        {/* Top 3 */}
        <p className="mt-10 text-[13px] font-semibold uppercase tracking-[0.01em] text-ink-soft">Runners-up</p>
        <div className="mt-3 grid grid-cols-2 gap-3">
          {top3.slice(1).map((f, i) => (
            <motion.div
              key={f.restaurant.id}
              initial={{ opacity: 0, y: 16 }} whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }} transition={{ duration: 0.3, delay: i * 0.1, ease: EASE_STANDARD }}
              className="min-w-0 rounded-[20px] border border-clay-line bg-paper p-4 shadow-card"
            >
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-cream-deep font-display text-[16px] font-semibold text-ink">{i + 2}</span>
              <p className="mt-2 break-words text-[15px] font-bold leading-tight text-ink">{f.restaurant.name}</p>
              <p className="mt-0.5 text-[13px] font-semibold text-ink-soft">
                {CUISINE_EMOJI[f.restaurant.cuisines[0]]} {f.restaurant.cuisines[0]} · {f.groupFit === 'strong' ? 'Strong fit' : f.groupFit === 'good' ? 'Good fit' : 'Compromise'}
              </p>
              <p className="mt-2 text-[12px] font-bold text-terracotta-deep">Fictional fixture</p>
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
              <AlertDialogContent className="max-w-[420px] rounded-[20px] bg-paper">
                <AlertDialogHeader>
                  <AlertDialogTitle className="font-display text-ink">Re-run without {r.name}?</AlertDialogTitle>
                  <AlertDialogDescription className="text-ink-soft">
                    Same votes, winner excluded. Next pick becomes the new result.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel className="rounded-xl border-clay-line">Keep it</AlertDialogCancel>
                  <AlertDialogAction onClick={doRerun} className="rounded-xl bg-terracotta text-paper hover:bg-terracotta-deep">
                    {rerunning ? 'Recalculating…' : 'Re-run'}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
            <p className="mt-1.5 text-center text-[13px] font-semibold text-ink-faint">{rerunsLeft} re-run{rerunsLeft === 1 ? '' : 's'} left</p>
          </>
        ) : (
          <Btn className="w-full" onClick={() => nav('/')}>Start a new session</Btn>
        )}
      </CtaBar>
    </ScreenShell>
  );
}
