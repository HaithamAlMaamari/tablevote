// TableVote shared UI kit.
import { motion } from 'framer-motion';
import { ArrowLeft, Loader2 } from 'lucide-react';
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { AVATAR_COLORS } from '@shared/types';
import { cn } from '@/lib/utils';
import { EASE_POP, EASE_STANDARD } from '@/lib/motion';

export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn('flex items-center gap-2', className)}>
      <svg width="26" height="26" viewBox="0 0 48 48" aria-hidden>
        <ellipse cx="24" cy="26" rx="18" ry="6" fill="#C4552D" />
        <rect x="20" y="30" width="8" height="12" rx="3" fill="#A8431F" />
        <circle cx="14" cy="22" r="4.5" fill="#FFFDF8" />
        <circle cx="24" cy="21" r="4.5" fill="#FFFDF8" />
        <circle cx="34" cy="22" r="4.5" fill="#FFFDF8" />
      </svg>
      <span className="font-display font-bold text-[22px] tracking-[-0.01em] text-ink">TableVote</span>
    </span>
  );
}

export function TopBar({ label, right, backTo }: { label: string; right?: ReactNode; backTo?: string }) {
  const nav = useNavigate();
  return (
    <header className="sticky top-0 z-20 flex h-14 items-center justify-between border-b border-clay-line bg-paper px-5">
      <div className="w-11">
        {backTo !== undefined && (
          <button
            aria-label="Back"
            className="flex h-11 w-11 items-center justify-center rounded-full border border-clay-line bg-paper text-ink"
            onClick={() => (backTo ? nav(backTo) : nav(-1))}
          >
            <ArrowLeft size={20} strokeWidth={1.75} />
          </button>
        )}
      </div>
      <span className="text-[13px] font-semibold tracking-[0.01em] text-ink-soft">{label}</span>
      <div className="flex w-auto min-w-11 items-center justify-end">{right}</div>
    </header>
  );
}

export function LiveBadge({ count, connected }: { count: number; connected: boolean }) {
  if (!connected) {
    return (
      <span role="status" aria-atomic="true" className="flex items-center gap-1.5 text-[13px] font-semibold text-ink-faint">
        <span className="h-2 w-2 rounded-full bg-butter" />
        Reconnecting…
      </span>
    );
  }
  return (
    <span role="status" aria-atomic="true" className="flex items-center gap-1.5 text-[13px] font-semibold text-ink-soft">
      <span className="relative flex h-2 w-2">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-olive opacity-60" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-olive" />
      </span>
      {count} online
    </span>
  );
}

export function ModeBadge() {
  return (
    <span className="rounded-full bg-butter-tint px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-[0.12em] text-[#725719]">
      local demo mode
    </span>
  );
}

type BtnVariant = 'primary' | 'secondary' | 'quiet' | 'danger';
export function Btn({
  variant = 'primary', className, loading, children, ...props
}: {
  variant?: BtnVariant; loading?: boolean;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const styles: Record<BtnVariant, string> = {
    primary: 'bg-terracotta-deep text-paper hover:bg-terracotta disabled:bg-cream-deep disabled:text-ink-faint',
    secondary: 'bg-paper border border-clay-line text-ink hover:bg-cream-deep disabled:text-ink-faint',
    quiet: 'bg-transparent text-ink-soft underline-offset-2 hover:underline disabled:text-ink-faint',
    danger: 'bg-tomato text-paper hover:opacity-90 disabled:opacity-50',
  };
  return (
    <button
      {...props}
      className={cn(
        'active:scale-[0.97] transition-transform',
        'flex min-h-[44px] items-center justify-center gap-2 rounded-xl px-4 text-[14px] font-bold tracking-[0.01em] transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-terracotta focus-visible:ring-offset-2',
        variant === 'primary' && 'h-[52px]',
        styles[variant],
        className,
      )}
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
        'fixed inset-x-0 bottom-0 z-20 mx-auto w-full border-t border-clay-line bg-paper px-5 pt-3 shadow-pop',
        wide ? 'max-w-[960px] md:px-10' : 'max-w-[480px]',
      )}
      style={{ paddingBottom: 'calc(12px + env(safe-area-inset-bottom))' }}
    >
      {children}
    </motion.div>
  );
}

export function AvatarDot({
  nickname, color, submitted, size = 36, crown,
}: { nickname: string; color: number; submitted?: boolean; size?: number; crown?: boolean }) {
  const c = AVATAR_COLORS[color % AVATAR_COLORS.length];
  return (
    <span className="relative inline-flex" style={{ width: size, height: size }}>
      <span
        className={cn('flex items-center justify-center rounded-full text-[14px] font-extrabold', submitted && 'ring-2 ring-olive')}
        style={{ width: size, height: size, backgroundColor: c.bg, color: c.fg }}
      >
        {(nickname[0] ?? '?').toUpperCase()}
      </span>
      {submitted && (
        <span className="absolute -bottom-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-olive text-[9px] text-paper">✓</span>
      )}
      {crown && (
        <span className="absolute -top-1.5 -right-1 text-[12px]" aria-label="host">👑</span>
      )}
    </span>
  );
}

export function TriChip({
  emoji, label, state, onCycle,
}: { emoji: string; label: string; state: 'like' | 'neutral' | 'dislike'; onCycle: () => void }) {
  const styles = {
    neutral: 'bg-cream-deep border-clay-line text-ink',
    like: 'bg-terracotta-tint border-terracotta text-terracotta-deep border-[1.5px]',
    dislike: 'bg-tomato-tint border-tomato text-tomato border-[1.5px]',
  }[state];
  return (
    <motion.button
      type="button"
      whileTap={{ scale: 0.94 }}
      transition={{ duration: 0.18, ease: EASE_POP }}
      onClick={() => { onCycle(); if (navigator.vibrate) navigator.vibrate(10); }}
      className={cn(
        'flex min-h-[48px] items-center gap-2 rounded-full border px-4 py-3 text-[14px] font-bold tracking-[0.01em] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-terracotta focus-visible:ring-offset-2',
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
        className={cn(state === 'dislike' && 'opacity-50 grayscale')}
      >
        {emoji}
      </motion.span>
      <span className={cn(state === 'dislike' && 'line-through')}>{label}</span>
      {state === 'like' && <span className="text-terracotta">♥</span>}
      {state === 'dislike' && <span>👎</span>}
    </motion.button>
  );
}

export function BucketChip({
  selected, onClick, children, full,
}: { selected: boolean; onClick: () => void; children: ReactNode; full?: boolean }) {
  return (
    <motion.button
      type="button"
      whileTap={{ scale: 0.96 }}
      animate={selected ? { scale: [1, 1.04, 1] } : {}}
      transition={{ duration: 0.18, ease: EASE_POP }}
      onClick={onClick}
      className={cn(
        'flex min-h-[48px] items-center gap-2 rounded-full border px-4 py-3 text-[14px] font-bold tracking-[0.01em] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-terracotta focus-visible:ring-offset-2',
        full && 'w-full justify-between rounded-xl',
        selected
          ? 'border-terracotta bg-terracotta-tint text-terracotta-deep border-[1.5px]'
          : 'border-clay-line bg-cream-deep text-ink',
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
          className="flex items-center justify-center rounded-lg border border-butter/40 bg-butter-tint font-sans text-[26px] font-extrabold uppercase text-ink"
          style={{ width: size, height: size * 1.18 }}
        >
          {ch}
        </motion.span>
      ))}
    </div>
  );
}

export function SatisfactionBar({
  value, color, delay = 0,
}: { value: number; color: 'terracotta' | 'olive' | 'butter'; delay?: number }) {
  const bg = { terracotta: 'bg-terracotta', olive: 'bg-olive/70', butter: 'bg-butter' }[color];
  return (
    <div className="h-2.5 min-w-0 flex-1 overflow-hidden rounded-full bg-cream-deep">
      <motion.div
        className={cn('h-full rounded-full', bg)}
        initial={{ width: 0 }}
        whileInView={{ width: `${Math.round(value * 100)}%` }}
        viewport={{ once: true }}
        transition={{ duration: 0.8, ease: EASE_STANDARD, delay }}
      />
    </div>
  );
}

export function FadeUp({ children, delay = 0, className }: { children: ReactNode; delay?: number; className?: string }) {
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
    <main className={cn(
      'relative z-10 mx-auto flex min-h-dvh w-full flex-col bg-cream md:shadow-card',
      wide ? 'max-w-[960px]' : 'max-w-[480px]',
    )}>
      {children}
    </main>
  );
}
