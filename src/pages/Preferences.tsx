import { AnimatePresence, motion } from 'framer-motion';
import { Check, ChevronRight, EyeOff } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { toast } from 'sonner';
import {
  CUISINES, CUISINE_EMOJI, DIETARY_TYPES, type Cuisine, type CuisineState,
  type DietaryType, type Prefs,
} from '@shared/types';
import { AvatarDot, Btn, BucketChip, CtaBar, ScreenShell, TopBar, TriChip } from '@/components/tablevote';
import { EASE_STANDARD } from '@/lib/motion';
import { useSession } from '@/lib/use-session';
import { SessionStateScreen } from '@/components/session-state';

const STEPS = ['cuisines', 'budget', 'distance', 'dietary', 'review'] as const;

const BUDGETS = [
  { v: 1, label: 'Low-cost', hint: 'price tier 1' },
  { v: 2, label: 'Moderate', hint: 'price tier 2' },
  { v: 3, label: 'Higher-priced', hint: 'price tier 3' },
  { v: 4, label: 'Any price', hint: '' },
] as const;

const DISTANCES = [
  { v: 1, label: '🚶 A short walk', hint: '≤ 1 km' },
  { v: 3, label: '🚲 A quick ride', hint: '≤ 3 km' },
  { v: 6, label: "🚗 I'll travel", hint: '≤ 6 km' },
  { v: 0, label: '🌍 Anywhere in the area', hint: '' },
] as const;

const DIET_LABEL: Record<DietaryType, string> = {
  vegetarian: 'Vegetarian', vegan: 'Vegan', halal: 'Halal', kosher: 'Kosher', 'gluten-free': 'Gluten-free',
};

function freshPrefs(): Prefs {
  return { cuisines: {}, budget: 1, maxDistanceKm: 1, dietary: [] };
}

export default function Preferences() {
  const { code = '' } = useParams();
  const nav = useNavigate();
  const { transport, state, identity, error, refresh } = useSession(code);
  const storageKey = `tablevote:prefs:${code}`;
  const [initial] = useState(() => {
    try {
      const raw = localStorage.getItem(storageKey);
        if (raw) {
          const saved = JSON.parse(raw) as { prefs: Prefs; step: number; expiresAt?: number };
          if (!saved.expiresAt || saved.expiresAt <= Date.now()) {
            localStorage.removeItem(storageKey);
            return { prefs: freshPrefs(), step: 0, restored: false };
          }
          return {
            prefs: {
              ...freshPrefs(),
              ...saved.prefs,
              dietary: saved.prefs.dietary.map((item) => ({ ...item, strict: true })),
            },
            step: Math.min(saved.step ?? 0, STEPS.length - 1),
            restored: true,
          };
      }
    } catch { /* ignore */ }
    return { prefs: freshPrefs(), step: 0, restored: false };
  });
  const [step, setStep] = useState(initial.step);
  const [dir, setDir] = useState(1);
  const [prefs, setPrefs] = useState<Prefs>(initial.prefs);
  const [submitting, setSubmitting] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [restored] = useState(initial.restored);
  const [authoritativeLoaded, setAuthoritativeLoaded] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const submitted = useMemo(
    () => !!(state && identity && state.participants.find((p) => p.id === identity.participantId)?.submitted),
    [state, identity],
  );

  // autosave restore notice
  useEffect(() => {
    if (restored) toast.success('Welcome back — pick up where you left off');
  }, [restored]);
  useEffect(() => {
    if (completed) return;
    if (restored || step > 0 || Object.keys(prefs.cuisines).length > 0) {
      localStorage.setItem(storageKey, JSON.stringify({
        prefs, step, expiresAt: state?.expiresAt ?? Date.now() + 24 * 60 * 60 * 1000,
      }));
    }
  }, [prefs, step, storageKey, restored, state?.expiresAt, completed]);

  // host closed voting mid-wizard
  useEffect(() => {
    if (state?.phase === 'locking') nav(`/s/${state.code}/lobby`);
    if (state?.phase === 'revealed') nav(`/s/${state.code}/reveal`);
    if (state?.phase === 'blocked-no-match') nav(`/s/${state.code}/result`);
  }, [state?.phase, state?.code, nav]);
  useEffect(() => {
    if (!authoritativeLoaded && !restored && state?.ownPrefs) {
      const timer = setTimeout(() => {
        setPrefs(state.ownPrefs!);
        setAuthoritativeLoaded(true);
      }, 0);
      return () => clearTimeout(timer);
    }
  }, [authoritativeLoaded, restored, state?.ownPrefs]);
  const go = (next: number) => {
    setDir(next > step ? 1 : -1);
    setStep(next);
  };

  const cycleCuisine = (c: Cuisine) => {
    setPrefs((p) => {
      const cur: CuisineState = p.cuisines[c] ?? 'neutral';
      const next: CuisineState = cur === 'neutral' ? 'like' : cur === 'like' ? 'dislike' : 'neutral';
      return { ...p, cuisines: { ...p.cuisines, [c]: next } };
    });
  };

  const toggleDiet = (d: DietaryType) => {
    setPrefs((p) => {
      const has = p.dietary.some((x) => x.type === d);
      return { ...p, dietary: has ? p.dietary.filter((x) => x.type !== d) : [...p.dietary, { type: d, strict: true }] };
    });
  };

  const submit = async () => {
    if (!transport || !state || !identity) return;
    setSubmitting(true);
    const res = await transport.submit(state.id, identity.token, prefs);
    if (!res.ok) {
      setSubmitting(false);
      toast.error(res.error ?? 'Could not submit');
      return;
    }
    setCompleted(true);
    localStorage.removeItem(storageKey);
    toast.success('Vote locked 🔒');
    setTimeout(() => nav(`/s/${state.code}/lobby`), 350);
  };

  const skipFlexible = () => {
    // accept defaults for this screen and jump to review
    go(STEPS.length - 1);
  };

  const loved = CUISINES.filter((c) => prefs.cuisines[c] === 'like');
  const noped = CUISINES.filter((c) => prefs.cuisines[c] === 'dislike');
  const neutralCount = CUISINES.length - loved.length - noped.length;
  const escapeLabel = ['', "Skip — I'm flexible", "Skip — I'm flexible", 'Skip — no restrictions', ''][step];

  if (!state && error) return <SessionStateScreen error={error} code={code} onRetry={refresh} />;

  return (
    <ScreenShell>
      <TopBar
        label="Your tastes"
        backTo=""
        right={identity ? <AvatarDot nickname={identity.nickname} color={identity.color} size={32} /> : undefined}
      />
      <div className="flex items-center gap-3 px-5 pt-3">
        <div
          role="progressbar"
          aria-label="Ballot progress"
          aria-valuemin={1}
          aria-valuemax={STEPS.length}
          aria-valuenow={step + 1}
          className="h-[3px] flex-1 overflow-hidden rounded-full bg-cream-deep"
        >
          <motion.div
            className="h-full rounded-full bg-terracotta"
            animate={{ width: `${((step + 1) / STEPS.length) * 100}%` }}
            transition={{ duration: 0.3, ease: EASE_STANDARD }}
          />
        </div>
        <span className="text-[13px] font-semibold text-ink-soft">{step + 1} / {STEPS.length}</span>
      </div>

      <div className="flex-1 overflow-hidden px-5 pb-44 pt-6 sm:px-6">
        <AnimatePresence mode="wait" custom={dir}>
          <motion.div
            key={step}
            initial={{ opacity: 0, x: 24 * dir }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -24 * dir }}
            transition={{ duration: 0.28, ease: EASE_STANDARD }}
            onAnimationComplete={() => headingRef.current?.focus()}
          >
            {step === 0 && (
              <div>
                <h1 ref={headingRef} tabIndex={-1} className="font-display text-[30px] font-semibold leading-[1.15] tracking-[-0.015em] text-ink">What sounds good?</h1>
                <p className="mt-2 text-[15px] text-ink-soft">Tap once for ❤️, twice for 👎, three times to reset. Leave it alone if you're easy.</p>
                <div className="mt-5 flex flex-wrap gap-2.5">
                  {CUISINES.map((c, i) => (
                    <motion.div key={c} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.03 }}>
                      <TriChip emoji={CUISINE_EMOJI[c]} label={c} state={prefs.cuisines[c] ?? 'neutral'} onCycle={() => cycleCuisine(c)} />
                    </motion.div>
                  ))}
                </div>
                <p className="mt-4 text-[13px] font-semibold text-ink-faint">
                  {loved.length} loved · {noped.length} nope · {neutralCount} neutral
                </p>
              </div>
            )}

            {step === 1 && (
              <div>
                <h1 ref={headingRef} tabIndex={-1} className="font-display text-[30px] font-semibold leading-[1.15] tracking-[-0.015em] text-ink">How much per person?</h1>
                <div className="mt-5 space-y-2.5">
                  {BUDGETS.map((b, i) => (
                    <motion.div key={b.v} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.06 }}>
                      <BucketChip full selected={prefs.budget === b.v} onClick={() => setPrefs((p) => ({ ...p, budget: b.v as Prefs['budget'] }))}>
                        <span>{b.label}</span><span className="text-ink-soft">{b.hint}</span>
                      </BucketChip>
                    </motion.div>
                  ))}
                </div>
                <p className="mt-4 text-[13px] font-semibold text-ink-faint">The algorithm favors places within everyone's budget overlap.</p>
              </div>
            )}

            {step === 2 && (
              <div>
                <h1 ref={headingRef} tabIndex={-1} className="font-display text-[30px] font-semibold leading-[1.15] tracking-[-0.015em] text-ink">How far will you go?</h1>
                <div className="mt-5 space-y-2.5">
                  {DISTANCES.map((d, i) => (
                    <motion.div key={d.v} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.06 }}>
                      <BucketChip
                        full
                        selected={d.v === 0 ? prefs.maxDistanceKm === null : prefs.maxDistanceKm === d.v}
                        onClick={() => setPrefs((p) => ({ ...p, maxDistanceKm: d.v === 0 ? null : d.v }))}
                      >
                        <span>{d.label}</span><span className="text-ink-soft">{d.hint}</span>
                      </BucketChip>
                    </motion.div>
                  ))}
                </div>
                <p className="mt-4 text-[13px] font-semibold text-ink-faint">Farther demo restaurants score lower. This preference is not a hard distance cutoff.</p>
              </div>
            )}

            {step === 3 && (
              <div>
                <h1 ref={headingRef} tabIndex={-1} className="font-display text-[30px] font-semibold leading-[1.15] tracking-[-0.015em] text-ink">Anything you can't eat?</h1>
                <p className="mt-2 text-[15px] text-ink-soft">Select only requirements that every eligible restaurant must support. Unselected items do not affect ranking.</p>
                <div className="mt-5 grid grid-cols-2 gap-2.5">
                  <BucketChip
                    selected={prefs.dietary.length === 0}
                    onClick={() => setPrefs((p) => ({ ...p, dietary: [] }))}
                  >
                    None
                  </BucketChip>
                  {DIETARY_TYPES.map((d) => (
                    <BucketChip key={d} selected={prefs.dietary.some((x) => x.type === d)} onClick={() => toggleDiet(d)}>
                      <span>{DIET_LABEL[d]}</span>
                      {prefs.dietary.some((x) => x.type === d) && <span>Required</span>}
                    </BucketChip>
                  ))}
                </div>
                <p className="mt-4 text-[13px] font-semibold leading-relaxed text-ink-faint">
                  Demo catalog tags are not allergy or cross-contamination guarantees. Confirm requirements directly before ordering.
                </p>
              </div>
            )}

            {step === 4 && (
              <div>
                <h1 ref={headingRef} tabIndex={-1} className="font-display text-[30px] font-semibold leading-[1.15] tracking-[-0.015em] text-ink">Look right?</h1>
                <div className="mt-5 divide-y divide-clay-line rounded-[20px] border border-clay-line bg-paper shadow-card">
                  {[
                    { label: 'Loves', value: loved.length ? loved.map((c) => CUISINE_EMOJI[c]).join(' ') : '—', to: 0 },
                    { label: 'Nopes', value: noped.length ? noped.map((c) => CUISINE_EMOJI[c]).join(' ') : '—', to: 0 },
                    { label: 'Budget', value: BUDGETS.find((b) => b.v === prefs.budget)?.label ?? '', to: 1 },
                    { label: 'Distance', value: prefs.maxDistanceKm === null ? '🌍 Anywhere' : DISTANCES.find((d) => d.v === prefs.maxDistanceKm)?.label ?? '', to: 2 },
                    { label: 'Required diet', value: prefs.dietary.length ? prefs.dietary.map((d) => DIET_LABEL[d.type]).join(', ') : 'None', to: 3 },
                  ].map((row) => (
                    <button key={row.label} onClick={() => go(row.to)} className="flex w-full items-center justify-between gap-3 px-5 py-3.5 text-left transition-colors hover:bg-cream-deep">
                      <span className="text-[13px] font-semibold uppercase tracking-[0.01em] text-ink-soft">{row.label}</span>
                      <span className="flex items-center gap-1 text-[14px] font-bold text-ink">{row.value} <ChevronRight size={14} className="text-ink-faint" /></span>
                    </button>
                  ))}
                </div>
                <div className="mt-4 flex items-start gap-2 px-1">
                  <EyeOff size={16} strokeWidth={1.75} className="mt-0.5 shrink-0 text-ink-soft" />
                  <p className="text-[13px] font-semibold leading-[1.4] text-ink-soft">
                    Raw ballots stay private before and after the result. You see only your own fit score.
                  </p>
                </div>
              </div>
            )}
          </motion.div>
        </AnimatePresence>
      </div>

      <CtaBar>
        {escapeLabel && (
          <Btn variant="quiet" className="mx-auto mb-1 block min-h-8" onClick={skipFlexible}>{escapeLabel}</Btn>
        )}
        {step < STEPS.length - 1 ? (
          <Btn className="w-full" onClick={() => go(step + 1)}>Next</Btn>
        ) : (
          <Btn className="h-14 w-full" loading={submitting} onClick={submit}>
            <Check size={18} /> {submitted ? 'Update my vote' : 'Lock in my vote'}
          </Btn>
        )}
      </CtaBar>
    </ScreenShell>
  );
}
