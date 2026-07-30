import { motion } from 'framer-motion';
import { ArrowRight, Check, Lock, UtensilsCrossed } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { toast } from 'sonner';
import { AVATAR_COLORS, type InviteSnapshot, type SessionIssue } from '@shared/types';
import { AvatarDot, Btn, CtaBar, ScreenShell, TopBar } from '@/components/tablevote';
import { SessionIssueAlert } from '@/components/session-state';
import { EASE_POP } from '@/lib/motion';
import { toSessionIssue } from '@/lib/session-errors';
import { getTransport } from '@/lib/transport';
import { linkSessionReferences, saveIdentity } from '@/lib/identity';
import { inviteContext, inviteHeading } from '@/lib/invite';
import { sessionPhaseRoute } from '@/lib/session-routing';

export default function Join() {
  const { code: codeParam } = useParams();
  return <JoinForm key={codeParam ?? 'manual-code'} codeParam={codeParam} />;
}

function JoinForm({ codeParam }: { codeParam?: string }) {
  const nav = useNavigate();
  const routeCode = (codeParam ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 5);
  const [tiles, setTiles] = useState<string[]>(() => {
    const c = routeCode;
    return [c[0] ?? '', c[1] ?? '', c[2] ?? '', c[3] ?? '', c[4] ?? ''];
  });
  const needCode = routeCode.length !== 5;
  const [tileState, setTileState] = useState<'idle' | 'ok' | 'bad'>('idle');
  const [nickname, setNickname] = useState('');
  const [color, setColor] = useState(0);
  const [joining, setJoining] = useState(false);
  const [issue, setIssue] = useState<SessionIssue | null>(null);
  const [invite, setInvite] = useState<InviteSnapshot | null>(null);
  const inputsRef = useRef<(HTMLInputElement | null)[]>([]);

  const code = tiles.join('');

  useEffect(() => {
    if (needCode) inputsRef.current[0]?.focus();
  }, [needCode]);

  useEffect(() => {
    if (needCode) return;
    let active = true;
    getTransport()
      .then((transport) => transport.invite(routeCode))
      .then((result) => {
        if (!active) return;
        if (result.ok) setInvite(result.value.invite);
        else setIssue(toSessionIssue(result.error, result.errorCode));
      })
      .catch(() => {
        if (active) setIssue(toSessionIssue('Server unavailable', 'unavailable'));
      });
    return () => {
      active = false;
    };
  }, [needCode, routeCode]);

  const setTile = (i: number, v: string) => {
    const val = v.toUpperCase().replace(/[^A-Z0-9]/g, '');
    setTiles((t) => {
      const next = [...t];
      if (val.length > 1) {
        for (let k = 0; k < 5; k++) next[k] = val[k] ?? next[k];
      } else {
        next[i] = val;
      }
      return next;
    });
    setTileState('idle');
    if (val && i < 4) inputsRef.current[i + 1]?.focus();
  };

  const join = async () => {
    if (!nickname.trim() || code.length < 5 || joining) return;
    setJoining(true);
    setIssue(null);
    const t0 = Date.now();
    try {
      const t = await getTransport();
      const res = await t.join({ code, nickname: nickname.trim().slice(0, 14), color });
      if (!res.ok) {
        setJoining(false);
        const failure = toSessionIssue(res.error, res.errorCode);
        setIssue(failure);
        if (needCode && (failure.code === 'not-found' || failure.code === 'invalid')) {
          setTileState('bad');
        }
        toast.error(failure.message);
        return;
      }
      const value = res.value;
      const identity = {
        participantId: value.participantId,
        token: value.participantToken,
        nickname: nickname.trim(),
        color,
        isHost: false,
        expiresAt: value.state.expiresAt,
      };
      saveIdentity(value.state.id, identity);
      saveIdentity(value.state.code, identity);
      linkSessionReferences(value.state.code, value.state.id);
      const joinedState = value.state;
      if (!needCode) setTileState('ok');
      const wait = Math.max(0, 400 - (Date.now() - t0));
      setTimeout(() => {
        nav(sessionPhaseRoute(joinedState.phase, joinedState.code, 'joining')!);
      }, wait);
    } catch {
      setJoining(false);
      setIssue(toSessionIssue('Server unavailable', 'unavailable'));
      toast.error('Could not join the session — check your connection and try again.');
    }
  };

  return (
    <ScreenShell>
      <TopBar label="Join session" backTo="/" />
      <div className="flex flex-1 flex-col justify-center px-5 pb-40 sm:px-6" style={{ minHeight: '60dvh' }}>
        <motion.div
          initial={{ scale: 0.92, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 0.4, ease: EASE_POP }}
          className="ticket-panel p-5 text-center"
        >
          <span className="mx-auto flex h-14 w-14 rotate-2 items-center justify-center border-2 border-rule bg-signal text-ticket shadow-[3px_3px_0_#2457FF]">
            <UtensilsCrossed size={28} strokeWidth={1.75} />
          </span>
          <h1 className="mt-3 font-display text-[24px] font-semibold tracking-[-0.01em] text-ink">
            {invite ? inviteHeading(invite) : "You're invited to choose where to eat."}
          </h1>
          <p className="mt-2 text-[15px] leading-relaxed text-ink-muted">
            {invite
              ? invite.joinable
                ? inviteContext
                : 'Voting has already closed for this table.'
              : 'Add your private preferences so the group can find one shared recommendation. No account needed.'}
          </p>
          {invite?.joinable && (
            <p className="mt-2 text-[12px] font-semibold text-ink-faint">
              This invitation expires{' '}
              {new Date(invite.expiresAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}.
            </p>
          )}
        </motion.div>
        {issue && <SessionIssueAlert issue={issue} />}

        {needCode && (
          <fieldset className="mt-8">
            <legend className="ticket-label block w-full text-center">Session code</legend>
            <motion.div
              animate={tileState === 'bad' ? { x: [0, -6, 6, -6, 6, 0] } : {}}
              transition={{ duration: 0.3 }}
              className="mt-3 flex justify-center gap-2"
            >
              {tiles.map((ch, i) => (
                <input
                  key={i}
                  ref={(el) => {
                    inputsRef.current[i] = el;
                  }}
                  value={ch}
                  maxLength={5}
                  inputMode="text"
                  onChange={(e) => setTile(i, e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Backspace' && !ch && i > 0) inputsRef.current[i - 1]?.focus();
                  }}
                  className={`h-[52px] w-11 border-2 bg-acid text-center font-mono text-[22px] font-medium uppercase text-ink caret-signal outline-none transition-colors duration-200 ${
                    tileState === 'ok' ? 'border-electric' : tileState === 'bad' ? 'border-danger' : 'border-rule'
                  } focus:ring-2 focus:ring-electric focus:ring-offset-2`}
                  aria-label={`Code character ${i + 1}`}
                  aria-invalid={tileState === 'bad'}
                  aria-describedby={tileState === 'bad' ? 'code-error' : undefined}
                />
              ))}
            </motion.div>
            {tileState === 'bad' && (
              <p id="code-error" role="alert" className="mt-2 text-center text-[13px] font-semibold text-danger">
                Hmm, that code doesn't exist.
              </p>
            )}
          </fieldset>
        )}

        <div className="mt-8">
          <label htmlFor="nick" className="ticket-label">
            What should we call you?
          </label>
          <div className="mt-3 flex items-center gap-3">
            <AvatarDot nickname={nickname || '?'} color={color} size={44} />
            <input
              id="nick"
              value={nickname}
              maxLength={14}
              onChange={(e) => setNickname(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && join()}
              placeholder="e.g. Maya"
              className="h-[52px] min-w-0 flex-1 border-2 border-rule bg-ticket px-4 text-[15px] text-ink outline-none placeholder:text-ink-faint focus:ring-2 focus:ring-electric focus:ring-offset-2"
            />
          </div>
          <div className="mt-3 flex items-center gap-2">
            {AVATAR_COLORS.map((c, i) => (
              <motion.button
                key={i}
                whileTap={{ scale: 0.9 }}
                animate={color === i ? { scale: [1, 1.15, 1] } : {}}
                transition={{ duration: 0.18 }}
                onClick={() => setColor(i)}
                aria-label={`Color ${i + 1}`}
                aria-pressed={color === i}
                type="button"
                className={`h-11 w-11 border-2 ${color === i ? 'border-ink shadow-[3px_3px_0_#2457FF]' : 'border-transparent'}`}
                style={{ backgroundColor: c.bg }}
              >
                {color === i ? (
                  <Check aria-hidden size={20} className="mx-auto" style={{ color: c.fg }} />
                ) : (
                  <span className="mx-auto block h-4 w-4 rounded-full" style={{ backgroundColor: c.fg }} />
                )}
              </motion.button>
            ))}
          </div>
          <p className="mt-2 text-[13px] font-semibold text-ink-faint">Pick your color — that's you on the table.</p>
        </div>
      </div>

      <CtaBar>
        <p className="mb-2 flex items-center justify-center gap-1 text-center text-[13px] font-semibold text-ink-faint">
          <Lock size={12} /> No account. Your raw ballot is hidden from the host and other participants.
        </p>
        <Btn
          className="w-full"
          disabled={!nickname.trim() || code.length < 5 || invite?.joinable === false}
          loading={joining}
          onClick={join}
        >
          {invite?.joinable === false ? (
            'Voting is closed'
          ) : joining ? (
            'Pulling up a chair…'
          ) : (
            <>
              Join the table <ArrowRight size={18} />
            </>
          )}
        </Btn>
      </CtaBar>
    </ScreenShell>
  );
}
