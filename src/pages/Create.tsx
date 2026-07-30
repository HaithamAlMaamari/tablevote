import { motion } from 'framer-motion';
import { ArrowRight, ChevronDown, MapPin } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { Btn, BucketChip, CtaBar, ScreenShell, TopBar } from '@/components/tablevote';
import { EASE_POP, EASE_STANDARD } from '@/lib/motion';
import { Switch } from '@/components/ui/switch';
import { getTransport } from '@/lib/transport';
import { linkSessionReferences, saveIdentity } from '@/lib/identity';
import { toast } from 'sonner';
import type { SessionIssue } from '@shared/types';
import { SessionIssueAlert } from '@/components/session-state';
import { toSessionIssue } from '@/lib/session-errors';

const CENTER = { lat: 0, lng: 0 }; // fictional catalog origin

const RADIUS_BUCKETS = [
  { id: 'walk', mark: 'WALK', label: '10 min walk', km: 1 },
  { id: 'ride', mark: 'RIDE', label: '15 min ride', km: 3 },
  { id: 'drive', mark: 'DRIVE', label: '20 min drive', km: 10 },
  { id: 'any', mark: 'ANY', label: 'Anywhere', km: 25 },
];

export default function Create() {
  const nav = useNavigate();
  const [location, setLocation] = useState('');
  const [radius, setRadius] = useState('walk');
  const [nickname, setNickname] = useState('');
  const [allowReruns, setAllowReruns] = useState(true);
  const [shareHostNickname, setShareHostNickname] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [issue, setIssue] = useState<SessionIssue | null>(null);

  const create = async () => {
    if (!location.trim() || creating) return;
    setCreating(true);
    setIssue(null);
    const t0 = Date.now();
    try {
      const t = await getTransport();
      const res = await t.create({
        areaLabel: location.trim(),
        center: CENTER,
        radiusKm: RADIUS_BUCKETS.find((b) => b.id === radius)?.km ?? 1,
        nickname: nickname.trim(),
        color: 0,
        allowReruns,
        shareHostNickname: shareHostNickname && !!nickname.trim(),
      });
      if (!res.ok) {
        const failure = toSessionIssue(res.error, res.errorCode);
        setIssue(failure);
        setCreating(false);
        toast.error(failure.message);
        return;
      }
      const value = res.value;
      const identity = {
        participantId: value.participantId,
        token: value.participantToken,
        nickname: nickname.trim() || 'Host',
        color: 0,
        isHost: true,
        hostToken: value.hostToken,
        expiresAt: value.state.expiresAt,
      };
      saveIdentity(value.sessionId, identity);
      saveIdentity(value.code, identity);
      linkSessionReferences(value.code, value.sessionId);
      const wait = Math.max(0, 400 - (Date.now() - t0));
      setTimeout(() => nav(`/s/${value.code}/host`), wait);
    } catch {
      setCreating(false);
      setIssue(toSessionIssue('Server unavailable', 'unavailable'));
      toast.error('Could not create the session — try again.');
    }
  };

  return (
    <ScreenShell>
      <TopBar label="New session" backTo="/" />
      <div className="flex-1 px-5 pb-40 pt-6 sm:px-6">
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, ease: EASE_STANDARD }}
        >
          <h1 className="font-display text-[30px] font-semibold leading-[1.15] tracking-[-0.015em] text-ink">
            Where are we eating?
          </h1>
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.1 }}
            className="mt-2 text-[15px] text-ink-muted"
          >
            Label this table's area for the invitation. This portfolio demo always uses a fictional bundled catalog.
          </motion.p>
        </motion.div>
        {issue && <SessionIssueAlert issue={issue} />}

        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2, duration: 0.35, ease: EASE_STANDARD }}
          className="mt-8"
        >
          <label htmlFor="loc" className="ticket-label">
            Session area label
          </label>
          <div className="relative mt-2">
            <MapPin size={20} strokeWidth={1.75} className="absolute left-4 top-1/2 -translate-y-1/2 text-ink-faint" />
            <input
              id="loc"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && location.trim() && create()}
              placeholder="e.g. Friday dinner"
              className="h-[52px] w-full border-2 border-rule bg-ticket pl-11 pr-4 text-[15px] text-ink shadow-[3px_3px_0_#2457FF] outline-none transition-all duration-150 placeholder:text-ink-faint focus:ring-2 focus:ring-electric focus:ring-offset-2"
            />
          </div>
        </motion.div>

        <div className="mt-8">
          <span className="ticket-label">How far will everyone go?</span>
          <div className="mt-3 flex flex-wrap gap-2">
            {RADIUS_BUCKETS.map((b, i) => (
              <motion.div
                key={b.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.3 + i * 0.04, ease: EASE_POP }}
              >
                <BucketChip selected={radius === b.id} onClick={() => setRadius(b.id)}>
                  <span aria-hidden className="font-mono text-[10px]">
                    {b.mark}
                  </span>
                  {b.label}
                </BucketChip>
              </motion.div>
            ))}
          </div>
          <p className="mt-3 text-[13px] font-semibold text-ink-faint">
            This radius demonstrates the planned input but does not filter fictional fixtures.
          </p>
        </div>

        <div className="mt-8">
          <button
            type="button"
            aria-expanded={moreOpen}
            aria-controls="create-more-options"
            onClick={() => setMoreOpen((v) => !v)}
            className="flex min-h-[44px] items-center gap-2 font-mono text-[11px] font-medium uppercase tracking-wider text-ink-muted hover:text-electric"
          >
            More options
            <motion.span animate={{ rotate: moreOpen ? 180 : 0 }} transition={{ duration: 0.25 }}>
              <ChevronDown size={18} />
            </motion.span>
          </button>
          {moreOpen && (
            <motion.div
              id="create-more-options"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.2, ease: EASE_STANDARD }}
            >
              <div className="space-y-5 pt-1">
                <div>
                  <label htmlFor="nick" className="ticket-label">
                    Your nickname (host)
                  </label>
                  <input
                    id="nick"
                    value={nickname}
                    maxLength={14}
                    onChange={(e) => {
                      setNickname(e.target.value);
                      if (!e.target.value.trim()) setShareHostNickname(false);
                    }}
                    placeholder="e.g. Sam"
                    className="mt-2 h-[52px] w-full border-2 border-rule bg-ticket px-4 text-[15px] text-ink outline-none placeholder:text-ink-faint focus:ring-2 focus:ring-electric focus:ring-offset-2"
                  />
                </div>
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <label htmlFor="share-host-nickname" className="text-[14px] font-bold text-ink">
                      Include my nickname in the invitation
                    </label>
                    <div id="share-host-nickname-detail" className="text-[13px] font-semibold text-ink-faint">
                      Anyone with the invite code can see it. Off by default.
                    </div>
                  </div>
                  <Switch
                    id="share-host-nickname"
                    aria-describedby="share-host-nickname-detail"
                    checked={shareHostNickname && !!nickname.trim()}
                    disabled={!nickname.trim()}
                    onCheckedChange={setShareHostNickname}
                    className="data-[state=checked]:bg-electric data-[state=unchecked]:bg-canvas-deep"
                  />
                </div>
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <div className="text-[14px] font-bold text-ink">Allow re-runs</div>
                    <div className="text-[13px] font-semibold text-ink-faint">
                      Let the group re-roll excluding the winner if plans change.
                    </div>
                  </div>
                  <Switch
                    aria-label="Allow re-runs"
                    checked={allowReruns}
                    onCheckedChange={setAllowReruns}
                    className="data-[state=checked]:bg-electric data-[state=unchecked]:bg-canvas-deep"
                  />
                </div>
              </div>
            </motion.div>
          )}
        </div>
      </div>

      <CtaBar>
        <Btn className="w-full" disabled={!location.trim()} loading={creating} onClick={create}>
          {creating ? (
            'Setting the table…'
          ) : (
            <>
              Create session <ArrowRight size={18} />
            </>
          )}
        </Btn>
      </CtaBar>
    </ScreenShell>
  );
}
