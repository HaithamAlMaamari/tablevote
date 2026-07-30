import { AnimatePresence, motion } from 'framer-motion';
import { Check, EyeOff, Hourglass, Link2, LockKeyhole, LogOut, Sparkles, UserMinus } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { toast } from 'sonner';
import { AvatarDot, Btn, CtaBar, FadeUp, LiveBadge, ScreenShell, TopBar } from '@/components/tablevote';
import { EASE_POP } from '@/lib/motion';
import { useSession } from '@/lib/use-session';
import { SessionStateScreen } from '@/components/session-state';
import { useSessionPhaseNavigation } from '@/lib/session-routing';

const WAIT_LINE = 'Near ties use least-misery, head-to-head wins, then a deterministic seed.';

export default function Lobby() {
  const { code = '' } = useParams();
  const nav = useNavigate();
  const { transport, state, identity, error, connected, refresh } = useSession(code);
  const [revealing, setRevealing] = useState(false);
  const rosterHeadingRef = useRef<HTMLHeadingElement>(null);

  const meSubmitted = useMemo(
    () => !!(state && identity && state.participants.find((p) => p.id === identity.participantId)?.submitted),
    [state, identity],
  );
  const isHost = !!identity?.isHost;
  const submitted = state?.participants.filter((p) => p.submitted).length ?? 0;
  const total = state?.participants.length ?? 0;
  const online = state?.participants.filter((participant) => participant.online).length ?? 0;
  const locking = state?.phase === 'locking';
  const canReveal = isHost && state?.phase === 'collecting' && submitted >= 2;

  useSessionPhaseNavigation(state, 'passive', () => toast.success("It's time to reveal."));

  const startReveal = async () => {
    if (!transport || !identity?.hostToken || !state) return;
    setRevealing(true);
    const res = await transport.reveal(state.id, identity.hostToken);
    if (!res.ok) {
      setRevealing(false);
      toast.error(res.error ?? 'Could not reveal yet');
    }
  };
  const leave = async () => {
    if (!transport || !state || !identity) return;
    const result = await transport.leave(state.id, identity.token);
    if (!result.ok) toast.error(result.error ?? 'Could not leave session');
  };
  const remove = async (participantId: string, nickname: string) => {
    if (!transport || !state || !identity?.hostToken) return;
    if (!window.confirm(`Remove ${nickname} from this table?`)) return;
    const result = await transport.removeParticipant(state.id, identity.hostToken, participantId);
    if (!result.ok) toast.error(result.error ?? 'Could not remove participant');
    else rosterHeadingRef.current?.focus();
  };

  if (!state && error) return <SessionStateScreen error={error} code={code} onRetry={refresh} />;

  return (
    <ScreenShell>
      <TopBar
        label="The lobby"
        right={
          <span className="flex items-center gap-2">{state && <LiveBadge count={online} connected={connected} />}</span>
        }
      />
      <div className="flex-1 px-5 pb-44 pt-6 sm:px-6">
        {meSubmitted ? (
          <FadeUp className="text-center">
            <motion.svg viewBox="0 0 64 64" className="mx-auto h-16 w-16" aria-hidden>
              <rect x="3" y="3" width="58" height="58" fill="#DDE5FF" stroke="#241329" strokeWidth="3" />
              <motion.path
                d="M20 33 l8 8 16 -17"
                fill="none"
                stroke="#2457FF"
                strokeWidth="5"
                strokeLinecap="square"
                strokeLinejoin="miter"
                initial={{ pathLength: 0 }}
                animate={{ pathLength: 1 }}
                transition={{ duration: 0.5 }}
              />
            </motion.svg>
            <h1 className="mt-3 flex items-center justify-center gap-2 font-display text-[30px] font-semibold tracking-[-0.015em] text-ink">
              Vote's in <LockKeyhole aria-hidden size={23} />
            </h1>
            <p className="mt-2 text-[15px] text-ink-muted">
              Now we wait for the rest of the table. The host reveals when everyone's ready.
            </p>
          </FadeUp>
        ) : (
          <FadeUp>
            <h1 className="font-display text-[30px] font-semibold tracking-[-0.015em] text-ink">
              The table's filling up
            </h1>
            <p className="mt-2 text-[15px] text-ink-muted">Add your tastes so your ballot counts.</p>
            <Btn className="mt-4 px-6" onClick={() => nav(`/s/${code}/preferences`)}>
              Vote now
            </Btn>
          </FadeUp>
        )}

        <FadeUp delay={0.15} className="mt-8">
          <div className="ticket-panel p-5">
            <div className="flex items-baseline justify-between">
              <h2 ref={rosterHeadingRef} tabIndex={-1} className="ticket-label">
                At the table
              </h2>
              <span role="status" aria-atomic="true" className="text-[13px] font-semibold text-ink-faint">
                {submitted} of {total} voted
              </span>
            </div>
            <div className="mt-2 divide-y-2 divide-rule">
              <AnimatePresence>
                {state?.participants.map((p) => (
                  <motion.div
                    key={p.id}
                    initial={{ opacity: 0, y: -12 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.35, ease: EASE_POP }}
                    className="flex h-[52px] items-center gap-3"
                  >
                    <AvatarDot nickname={p.nickname} color={p.color} size={32} crown={p.isHost} />
                    <span className="flex-1 text-[15px] text-ink">
                      {p.nickname}
                      {identity?.participantId === p.id && <span className="text-ink-faint"> (you)</span>}
                    </span>
                    {!p.online ? (
                      <span className="flex items-center gap-1 border border-rule bg-canvas-deep px-2 py-1 font-mono text-[10px] font-medium uppercase text-ink-faint">
                        Offline
                      </span>
                    ) : p.submitted ? (
                      <span className="flex items-center gap-1 border border-rule bg-acid px-2 py-1 font-mono text-[10px] font-medium uppercase text-ink">
                        <Check size={13} /> Ready
                      </span>
                    ) : (
                      <span className="flex items-center gap-1 border border-rule bg-canvas-deep px-2 py-1 font-mono text-[10px] font-medium uppercase text-ink-faint">
                        <Hourglass size={13} /> Thinking…
                      </span>
                    )}
                    {isHost && !p.isHost && (
                      <button
                        aria-label={`Remove ${p.nickname}`}
                        className="flex h-9 w-9 items-center justify-center border border-transparent text-ink-faint hover:border-danger hover:bg-danger-tint hover:text-danger"
                        onClick={() => remove(p.id, p.nickname)}
                      >
                        <UserMinus size={16} />
                      </button>
                    )}
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          </div>
        </FadeUp>

        <div className="mt-8 px-6 text-center">
          <EyeOff size={20} strokeWidth={1.75} className="mx-auto text-ink-faint" />
          <p className="mt-2 text-[13px] font-semibold leading-[1.4] text-ink-muted">
            Raw ballots stay private. The host sees only who has submitted.
          </p>
        </div>

        {isHost && (
          <Btn variant="secondary" className="mt-6 w-full" onClick={() => nav(`/s/${code}/host`)}>
            <Link2 size={16} /> Invite more people
          </Btn>
        )}

        <div className="mt-8 h-5 text-center">
          <p className="text-[13px] font-semibold text-ink-faint">{WAIT_LINE}</p>
        </div>
      </div>

      <CtaBar>
        {meSubmitted && (
          <Btn variant="quiet" className="mx-auto mb-1 block min-h-8" onClick={() => nav(`/s/${code}/preferences`)}>
            Edit my vote
          </Btn>
        )}
        {locking ? (
          <Btn className="w-full" disabled loading>
            Locking votes…
          </Btn>
        ) : isHost ? (
          <Btn className="w-full" disabled={!canReveal || revealing} loading={revealing} onClick={startReveal}>
            {revealing ? (
              'Gathering votes…'
            ) : (
              <>
                Start the reveal <Sparkles size={18} />
              </>
            )}
          </Btn>
        ) : meSubmitted ? (
          <Btn className="w-full" disabled>
            <span className="animated-ellipsis">Waiting for the host to reveal</span>
          </Btn>
        ) : (
          <Btn className="w-full" onClick={() => nav(`/s/${code}/preferences`)}>
            Vote now
          </Btn>
        )}
        {isHost && !canReveal && (
          <p className="mt-1.5 text-center text-[13px] font-semibold text-ink-faint">
            Waiting for at least one friend to vote…
          </p>
        )}
        {!isHost && (
          <Btn variant="quiet" className="mx-auto mt-1" onClick={leave}>
            <LogOut size={15} /> Leave this table
          </Btn>
        )}
      </CtaBar>
    </ScreenShell>
  );
}
