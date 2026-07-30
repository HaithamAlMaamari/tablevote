// TableVote shared UI kit.
import { motion } from 'framer-motion';
import { ArrowLeft, Check, Crown, Loader2 } from 'lucide-react';
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { AVATAR_COLORS } from '@shared/types';
import { btnVariants, type BtnVariant } from '@/components/ui/button-styles';
import { cn } from '@/lib/utils';
import { EASE_POP, EASE_STANDARD } from '@/lib/motion';
import { cuisineCode } from '@/lib/cuisine-marks';
import tableVoteMark from '@/assets/tablevote-mark.svg';

export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn('flex items-center gap-2.5', className)}>
      <img src={tableVoteMark} alt="" width="30" height="25" aria-hidden="true" />
      <span className="hidden font-display text-[22px] font-extrabold tracking-[-0.04em] text-ink min-[360px]:inline">
        TableVote
      </span>
    </span>
  );
}

export function TopBar({ label, right, backTo }: { label: string; right?: ReactNode; backTo?: string }) {
  const nav = useNavigate();
  return (
    <header className="sticky top-0 z-20 flex h-14 items-center justify-between border-b-[3px] border-rule bg-ticket px-5">
      <div className="w-11">
        {backTo !== undefined && (
          <button
            aria-label="Back"
            className="flex h-10 w-10 items-center justify-center border-2 border-rule bg-ticket text-ink transition-transform hover:-translate-x-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-electric focus-visible:ring-offset-2"
            onClick={() => (backTo ? nav(backTo) : nav(-1))}
          >
            <ArrowLeft size={20} strokeWidth={1.75} />
          </button>
        )}
      </div>
      <span className="font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-ink-muted">{label}</span>
      <div className="flex w-auto min-w-11 items-center justify-end">{right}</div>
    </header>
  );
}

export function LiveBadge({ count, connected }: { count: number; connected: boolean }) {
  if (!connected) {
    return (
      <span
        role="status"
        aria-atomic="true"
        className="flex items-center gap-1.5 font-mono text-[11px] font-medium uppercase tracking-wide text-ink-faint"
      >
        <span className="h-2 w-2 bg-signal" />
        Reconnecting…
      </span>
    );
  }
  return (
    <span
      role="status"
      aria-atomic="true"
      className="flex items-center gap-1.5 font-mono text-[11px] font-medium uppercase tracking-wide text-ink-muted"
    >
      <span className="relative flex h-2 w-2">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-acid opacity-70" />
        <span className="relative inline-flex h-2 w-2 rounded-full border border-ink bg-acid" />
      </span>
      {count} online
    </span>
  );
}

export function Btn({
  variant = 'primary',
  className,
  loading,
  children,
  ...props
}: {
  variant?: BtnVariant;
  loading?: boolean;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      className={cn(btnVariants({ variant }), className)}
      disabled={props.disabled || loading}
      aria-busy={loading || undefined}
    >
      {loading && <Loader2 size={18} className="animate-spin" />}
      {children}
    </button>
  );
}

export function CtaBar({ children, wide = false }: { children: ReactNode; wide?: boolean }) {
  return (
    <motion.div
      initial={{ y: '100%' }}
      animate={{ y: 0 }}
      transition={{ duration: 0.3, ease: EASE_STANDARD }}
      className={cn(
        'fixed inset-x-0 bottom-0 z-20 mx-auto w-full border-t-[3px] border-rule bg-ticket px-5 pt-3 shadow-dock',
        wide ? 'max-w-[960px] md:px-10' : 'max-w-[480px]',
      )}
      style={{ paddingBottom: 'calc(12px + env(safe-area-inset-bottom))' }}
    >
      {children}
    </motion.div>
  );
}

export function AvatarDot({
  nickname,
  color,
  submitted,
  size = 36,
  crown,
}: {
  nickname: string;
  color: number;
  submitted?: boolean;
  size?: number;
  crown?: boolean;
}) {
  const c = AVATAR_COLORS[color % AVATAR_COLORS.length];
  return (
    <span className="relative inline-flex" style={{ width: size, height: size }}>
      <span
        className={cn(
          'flex items-center justify-center border-2 border-ink font-mono text-[13px] font-medium',
          submitted && 'ring-2 ring-electric ring-offset-2',
        )}
        style={{ width: size, height: size, backgroundColor: c.bg, color: c.fg }}
      >
        {(nickname[0] ?? '?').toUpperCase()}
      </span>
      {submitted && (
        <span className="absolute -bottom-1 -right-1 flex h-4 w-4 items-center justify-center border border-ink bg-acid text-ink">
          <Check size={10} strokeWidth={3} />
        </span>
      )}
      {crown && (
        <span
          className="absolute -right-1.5 -top-2 flex h-4 w-4 items-center justify-center bg-signal text-ticket"
          aria-label="host"
        >
          <Crown size={11} fill="currentColor" />
        </span>
      )}
    </span>
  );
}

export function TriChip({
  label,
  state,
  onCycle,
}: {
  label: string;
  state: 'like' | 'neutral' | 'dislike';
  onCycle: () => void;
}) {
  const styles = {
    neutral: 'bg-ticket border-rule text-ink',
    like: 'bg-electric-tint border-electric text-electric-dark shadow-[3px_3px_0_#2457FF]',
    dislike: 'bg-signal-tint border-signal text-signal-dark shadow-[3px_3px_0_#EF3340]',
  }[state];
  return (
    <motion.button
      type="button"
      whileTap={{ scale: 0.94 }}
      transition={{ duration: 0.18, ease: EASE_POP }}
      onClick={() => {
        onCycle();
        if (navigator.vibrate) navigator.vibrate(10);
      }}
      className={cn(
        'flex min-h-[48px] items-center gap-2 border-2 px-3 py-2.5 text-[14px] font-bold tracking-[0.01em] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-electric focus-visible:ring-offset-2',
        styles,
      )}
      aria-label={`${label}: ${state}. Activate to change preference.`}
      data-state={state}
    >
      <motion.span
        key={state}
        initial={{ scale: 0.6, opacity: 0.4 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 0.16 }}
        className="flex h-7 min-w-9 items-center justify-center border border-current bg-ticket px-1 font-mono text-[10px] font-medium tracking-wide"
      >
        {cuisineCode(label)}
      </motion.span>
      <span className={cn(state === 'dislike' && 'line-through')}>{label}</span>
      {state === 'like' && (
        <span aria-hidden className="font-mono text-electric">
          +
        </span>
      )}
      {state === 'dislike' && (
        <span aria-hidden className="font-mono">
          X
        </span>
      )}
    </motion.button>
  );
}

export function BucketChip({
  selected,
  onClick,
  children,
  full,
}: {
  selected: boolean;
  onClick: () => void;
  children: ReactNode;
  full?: boolean;
}) {
  return (
    <motion.button
      type="button"
      whileTap={{ scale: 0.96 }}
      animate={selected ? { scale: [1, 1.04, 1] } : {}}
      transition={{ duration: 0.18, ease: EASE_POP }}
      onClick={onClick}
      className={cn(
        'flex min-h-[48px] items-center gap-2 border-2 px-4 py-3 text-[14px] font-bold tracking-[0.01em] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-electric focus-visible:ring-offset-2',
        full && 'w-full justify-between',
        selected
          ? 'border-electric bg-electric text-ticket shadow-[3px_3px_0_#241329]'
          : 'border-rule bg-ticket text-ink hover:bg-electric-tint',
      )}
      aria-pressed={selected}
    >
      {children}
    </motion.button>
  );
}

export function CodeTiles({ code, size = 44 }: { code: string; size?: number }) {
  return (
    <div role="group" className="flex justify-center gap-2" aria-label={`Session code ${code.split('').join(' ')}`}>
      {code.split('').map((ch, i) => (
        <motion.span
          key={i}
          initial={{ scale: 0, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ delay: i * 0.06, duration: 0.3, ease: EASE_POP }}
          className="flex items-center justify-center border-2 border-rule bg-acid font-mono text-[24px] font-medium uppercase text-ink shadow-[3px_3px_0_#241329]"
          style={{ width: size, height: size * 1.18 }}
        >
          {ch}
        </motion.span>
      ))}
    </div>
  );
}

export function SatisfactionBar({
  value,
  color,
  delay = 0,
}: {
  value: number;
  color: 'signal' | 'electric' | 'acid';
  delay?: number;
}) {
  const bg = { signal: 'bg-signal', electric: 'bg-electric', acid: 'bg-acid' }[color];
  return (
    <div className="h-3 min-w-0 flex-1 overflow-hidden border border-rule bg-canvas-deep">
      <motion.div
        className={cn('h-full border-r border-rule', bg)}
        initial={{ width: 0 }}
        whileInView={{ width: `${Math.round(value * 100)}%` }}
        viewport={{ once: true }}
        transition={{ duration: 0.8, ease: EASE_STANDARD, delay }}
      />
    </div>
  );
}

export function FadeUp({
  children,
  delay = 0,
  className,
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: EASE_STANDARD, delay }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

export function ScreenShell({ children, wide = false }: { children: ReactNode; wide?: boolean }) {
  return (
    <main
      className={cn(
        'relative z-10 mx-auto flex min-h-dvh w-full flex-col bg-canvas md:border-x-[3px] md:border-rule',
        wide ? 'max-w-[960px]' : 'max-w-[480px]',
      )}
    >
      {children}
    </main>
  );
}
