import { motion } from 'framer-motion';
import { Check, Copy, EyeOff, Link2, Share2, Sparkles, UserMinus } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import QRCode from 'qrcode';
import { toast } from 'sonner';
import type { InviteSnapshot } from '@shared/types';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { AvatarDot, Btn, CodeTiles, CtaBar, FadeUp, LiveBadge, ModeBadge, ScreenShell, TopBar } from '@/components/tablevote';
import { EASE_POP } from '@/lib/motion';
import { useSession } from '@/lib/use-session';
import { SessionStateScreen } from '@/components/session-state';
import { inviteMessage } from '@/lib/invite';

export default function Share() {
  const { code = '' } = useParams();
  const nav = useNavigate();
  const { transport, state, identity, error, connected, refresh } = useSession(code);
  const [qr, setQr] = useState<string>('');
  const [copied, setCopied] = useState(false);
  const [revealing, setRevealing] = useState(false);
  const [invite, setInvite] = useState<InviteSnapshot | null>(null);
  const prevCount = useRef(0);
  const rosterHeadingRef = useRef<HTMLHeadingElement>(null);

  const joinUrl = `${location.origin}${location.pathname}#/join/${state?.code ?? code}`;
  const sessionCode = state?.code;
  const shareCopy = invite
    ? inviteMessage(invite)
    : `Help choose where the group should eat${state?.areaLabel ? ` for ${state.areaLabel}` : ''}.\nAdd your private preferences so TableVote can find one shared recommendation. No account needed.`;

  useEffect(() => {
    if (!transport || !sessionCode) return;
    let active = true;
    transport.invite(sessionCode).then((result) => {
      if (active && result.invite) setInvite(result.invite);
    });
    return () => { active = false; };
  }, [transport, sessionCode]);

  useEffect(() => {
    QRCode.toDataURL(joinUrl, { margin: 1, width: 400, color: { dark: '#2B2420', light: '#FFFDF8' } })
      .then(setQr).catch(() => {});
  }, [joinUrl]);

  // toast + animate on new joiners
  useEffect(() => {
    const n = state?.participants.length ?? 0;
    if (prevCount.current && n > prevCount.current) {
      const newest = state?.participants[n - 1];
      if (newest && !newest.isHost) toast.success(`${newest.nickname} joined 🎉`);
    }
    prevCount.current = n;
  }, [state?.participants]);

  // revealed → everyone moves on
  useEffect(() => {
    if (state?.phase === 'revealed') nav(`/s/${state.code}/reveal`);
    if (state?.phase === 'blocked-no-match') nav(`/s/${state.code}/result`);
  }, [state?.phase, state?.code, nav]);

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(`${shareCopy}\n${joinUrl}`);
      setCopied(true);
      toast.success('Invite copied — paste it in the group chat');
      setTimeout(() => setCopied(false), 1800);
    } catch {
      toast.error('Could not copy the invitation');
    }
  };

  const shareNative = async () => {
    if (navigator.share) {
      await navigator.share({ title: 'TableVote', text: shareCopy, url: joinUrl }).catch(() => {});
    } else copyLink();
  };

  const startReveal = async () => {
    if (!transport || !identity?.hostToken || !state) return;
    setRevealing(true);
    const res = await transport.reveal(state.id, identity.hostToken);
    if (!res.ok) {
      setRevealing(false);
      toast.error(res.error ?? 'Could not reveal yet');
      return;
    }
    // The authoritative state broadcast selects reveal or no-match routing.
  };

  const endSession = async () => {
    if (!transport || !identity?.hostToken || !state) return;
    const result = await transport.end(state.id, identity.hostToken);
    if (result.ok) nav('/');
    else toast.error('Could not end the session. Try again.');
  };
  const remove = async (participantId: string, nickname: string) => {
    if (!transport || !identity?.hostToken || !state) return;
    if (!window.confirm(`Remove ${nickname} from this table?`)) return;
    const result = await transport.removeParticipant(state.id, identity.hostToken, participantId);
    if (!result.ok) toast.error(result.error ?? 'Could not remove participant');
    else rosterHeadingRef.current?.focus();
  };

  const submitted = state?.participants.filter((p) => p.submitted).length ?? 0;
  const total = state?.participants.length ?? 0;
  const online = state?.participants.filter((participant) => participant.online).length ?? 0;
  const locking = state?.phase === 'locking';
  const guestsSubmitted = (state?.participants.filter((p) => p.submitted && !p.isHost).length ?? 0) + (identity ? 0 : 0);
  const meSubmitted = state && identity ? state.participants.find((p) => p.id === identity.participantId)?.submitted : false;
  const canReveal = state?.phase === 'collecting' && submitted >= 2 && (guestsSubmitted >= 1 || meSubmitted === true) && total >= 2;

  if (!state && error) return <SessionStateScreen error={error} code={code} onRetry={refresh} />;

  return (
    <ScreenShell>
      <TopBar
        label="Invite friends"
        right={<span className="flex items-center gap-2">{transport?.mode === 'local' && <ModeBadge />}{state && <LiveBadge count={total} connected={connected} />}</span>}
      />
      <div className="flex-1 px-5 pb-44 pt-6 sm:px-6">
        <FadeUp>
          <h1 className="font-display text-[30px] font-semibold leading-[1.15] tracking-[-0.015em] text-ink">Get everyone in</h1>
          <p className="mt-2 text-[15px] text-ink-soft">Send the link, flash the QR, or read out the code. That's it.</p>
        </FadeUp>

        <FadeUp delay={0.2} className="mt-6">
          <div className="flex flex-col items-center gap-5 rounded-[24px] border border-clay-line bg-paper p-6 shadow-card">
            <p className="text-center text-[14px] font-semibold leading-relaxed text-ink-soft">{shareCopy}</p>
            <motion.div
              initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
              transition={{ duration: 0.5, ease: EASE_POP }}
              className="relative p-3"
            >
              {/* terracotta corner brackets */}
              {['top-0 left-0 border-t-[3px] border-l-[3px] rounded-tl-[20px]',
                'top-0 right-0 border-t-[3px] border-r-[3px] rounded-tr-[20px]',
                'bottom-0 left-0 border-b-[3px] border-l-[3px] rounded-bl-[20px]',
                'bottom-0 right-0 border-b-[3px] border-r-[3px] rounded-br-[20px]'].map((pos) => (
                <motion.span
                  key={pos}
                  initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.6 }}
                  className={`absolute h-8 w-8 border-terracotta ${pos}`}
                />
              ))}
              {qr && <img src={qr} alt="Session QR code" className="h-[176px] w-[176px] rounded-lg" />}
            </motion.div>
            {state && <CodeTiles code={state.code} />}
            <Btn variant="secondary" className="h-12 w-full" onClick={copyLink}>
              {copied ? <><Check size={18} className="text-olive" /> Copied!</> : <><Link2 size={18} strokeWidth={1.75} /> Copy invite message</>}
            </Btn>
            <Btn variant="quiet" onClick={shareNative}><Share2 size={16} strokeWidth={1.75} /> Share via…</Btn>
          </div>
        </FadeUp>

        <div className="mt-8">
          <div className="flex items-baseline justify-between">
            <h2 ref={rosterHeadingRef} tabIndex={-1} className="text-[13px] font-semibold uppercase tracking-[0.01em] text-ink-soft">Who's in</h2>
            <span role="status" aria-atomic="true" className="text-[13px] font-semibold text-ink-faint">{online} online · {total} joined</span>
          </div>
          <div className="mt-3 flex flex-wrap gap-4">
            {state?.participants.map((p) => (
              <motion.div
                key={p.id}
                initial={{ scale: 0 }} animate={{ scale: 1 }}
                transition={{ duration: 0.4, ease: EASE_POP }}
                className="flex w-14 flex-col items-center gap-1"
              >
                <AvatarDot nickname={p.nickname} color={p.color} submitted={p.submitted} crown={p.isHost} />
                <span className={`max-w-full truncate text-[11px] font-semibold ${p.online ? 'text-ink-soft' : 'text-ink-faint'}`}>
                  {p.nickname}
                </span>
                <span className="sr-only">, {p.online ? 'online' : 'offline'}</span>
                {identity?.isHost && !p.isHost && (
                  <button
                    aria-label={`Remove ${p.nickname}`}
                    className="flex h-7 w-7 items-center justify-center rounded-full text-ink-faint hover:bg-tomato-tint hover:text-tomato"
                    onClick={() => remove(p.id, p.nickname)}
                  >
                    <UserMinus size={14} />
                  </button>
                )}
              </motion.div>
            ))}
          </div>
          {total <= 1 && (
            <p className="mt-4 text-center text-[13px] font-semibold text-ink-soft">Waiting for the crew… they'll pop up here.</p>
          )}
        </div>

        <div className="mt-8 flex items-start gap-2">
          <EyeOff size={16} strokeWidth={1.75} className="mt-0.5 shrink-0 text-ink-soft" />
          <p className="text-[13px] font-semibold leading-[1.4] text-ink-soft">
            Votes are blind — you won't see anyone's picks, and they won't see yours.
          </p>
        </div>
        {submitted > 0 && (
          <p role="status" aria-atomic="true" className="mt-2 flex items-center gap-1.5 text-[13px] font-semibold text-olive">
            <Check size={14} /> {submitted} of {total} ready
          </p>
        )}
        <Copy className="hidden" />
      </div>

      <CtaBar>
        <Btn variant="quiet" className="mx-auto mb-1 block min-h-8" onClick={() => nav(`/s/${state?.code ?? code}/preferences`)}>
          Vote too
        </Btn>
        <Btn className="w-full" disabled={!canReveal || revealing || locking} loading={revealing || locking} onClick={startReveal}>
          {locking ? 'Locking votes…' : revealing ? 'Gathering votes…' : <>Start the reveal <Sparkles size={18} /></>}
        </Btn>
        {!canReveal && (
          <p className="mt-1.5 text-center text-[13px] font-semibold text-ink-faint">
            Waiting for at least {Math.max(1, 2 - submitted)} more vote{2 - submitted === 1 ? '' : 's'}…
          </p>
        )}
        <AlertDialog>
          <AlertDialogTrigger className="mx-auto mt-1 block text-[12px] font-semibold text-ink-faint underline-offset-2 hover:underline">
            End session
          </AlertDialogTrigger>
          <AlertDialogContent className="max-w-[420px] rounded-[20px] bg-paper">
            <AlertDialogHeader>
              <AlertDialogTitle className="font-display text-ink">End this session?</AlertDialogTitle>
              <AlertDialogDescription className="text-ink-soft">Everyone will be kicked and votes deleted.</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel className="rounded-xl border-clay-line">Keep it</AlertDialogCancel>
              <AlertDialogAction onClick={endSession} className="rounded-xl bg-tomato text-paper hover:bg-tomato/90">End session</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </CtaBar>
    </ScreenShell>
  );
}
