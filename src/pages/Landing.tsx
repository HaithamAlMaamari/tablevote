import { motion } from 'framer-motion';
import { ArrowRight, Check, Github, Scale, Utensils } from 'lucide-react';
import { useNavigate } from 'react-router';
import { Btn, Logo } from '@/components/tablevote';
import { EASE_POP, EASE_STANDARD } from '@/lib/motion';

function CharStagger({ text, className, delay = 0 }: { text: string; className?: string; delay?: number }) {
  return (
    <span className={className}>
      <span className="sr-only">{text}</span>
      <span aria-hidden>
        {text.split('').map((ch, i) => (
          <motion.span
            key={i}
            className="inline-block"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: delay + i * 0.012, duration: 0.5, ease: EASE_STANDARD }}
          >
            {ch === ' ' ? ' ' : ch}
          </motion.span>
        ))}
      </span>
    </span>
  );
}

function HeroArt() {
  return (
    <svg
      viewBox="0 0 400 300" className="mx-auto w-full max-w-[340px]"
      aria-hidden
    >
      <ellipse cx="200" cy="180" rx="70" ry="18" fill="#C4552D" />
      <rect x="192" y="192" width="16" height="46" rx="6" fill="#A8431F" />
      <ellipse cx="200" cy="240" rx="40" ry="8" fill="#A8431F" />
      <ellipse cx="200" cy="172" rx="30" ry="9" fill="#FFFDF8" />
      <path d="M186 160 q4 -12 0 -20 M200 158 q4 -12 0 -20 M214 160 q4 -12 0 -20" stroke="#6B7A3F" strokeWidth="4" fill="none" strokeLinecap="round" />
      {/* phones around the table */}
      {[
        { x: 40, y: 60, r: -14, c: '#6B7A3F' },
        { x: 316, y: 60, r: 14, c: '#E9B44C' },
        { x: 30, y: 190, r: 10, c: '#E9B44C' },
        { x: 326, y: 190, r: -10, c: '#6B7A3F' },
      ].map((p, i) => (
        <g key={i} transform={`translate(${p.x} ${p.y}) rotate(${p.r})`}>
          <rect width="44" height="78" rx="10" fill={p.c} />
          <rect x="5" y="8" width="34" height="56" rx="6" fill="#FFFDF8" />
          <rect x="12" y="16" width="20" height="6" rx="3" fill={p.c} opacity="0.7" />
          <rect x="12" y="28" width="14" height="6" rx="3" fill={p.c} opacity="0.4" />
          <circle cx="22" cy="70" r="3" fill="#FFFDF8" />
        </g>
      ))}
      {/* confetti dots */}
      {[
        [110, 40], [290, 36], [200, 30], [80, 130], [330, 130], [150, 70], [255, 74],
      ].map(([x, y], i) => (
        <circle
          key={i} cx={x} cy={y} r={i % 2 ? 4 : 5.5}
          fill={['#C4552D', '#E9B44C', '#6B7A3F'][i % 3]}
        />
      ))}
    </svg>
  );
}

const STEPS = [
  {
    n: 1, title: 'Create & share',
    body: 'Create a table, then send one contextual link, QR, or 5-letter code to the group chat.',
    art: (
      <svg viewBox="0 0 120 120" className="mx-auto h-24 w-24" aria-hidden>
        <rect x="36" y="16" width="48" height="88" rx="12" fill="#C4552D" />
        <rect x="42" y="26" width="36" height="62" rx="6" fill="#FFFDF8" />
        <rect x="50" y="34" width="20" height="20" rx="4" fill="none" stroke="#C4552D" strokeWidth="3" />
        <path d="M50 34 l20 20 M70 34 l-20 20" stroke="#C4552D" strokeWidth="3" />
        <rect x="50" y="62" width="20" height="6" rx="3" fill="#C4552D" opacity="0.5" />
        <circle cx="88" cy="30" r="14" fill="#F8EDD6" stroke="#E9B44C" strokeWidth="3" />
        <path d="M83 30 h10 M88 25 v10" stroke="#8A6A1F" strokeWidth="3" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    n: 2, title: 'Everyone votes privately',
    body: "Cuisines, budget, distance, and dietary needs. Raw ballots stay private, even from the host.",
    art: (
      <svg viewBox="0 0 120 120" className="mx-auto h-24 w-24" aria-hidden>
        {[
          { x: 6, c: '#6B7A3F', mark: '♥' },
          { x: 42, c: '#E9B44C', mark: '–' },
          { x: 78, c: '#C4552D', mark: '✕' },
        ].map((p, i) => (
          <g key={i} transform={`translate(${p.x} 20)`}>
            <rect width="36" height="80" rx="9" fill={p.c} />
            <rect x="4" y="7" width="28" height="58" rx="5" fill="#FFFDF8" />
            <rect x="8" y="14" width="20" height="10" rx="5" fill={p.c} opacity="0.35" />
            <rect x="8" y="30" width="20" height="10" rx="5" fill={p.c} opacity="0.35" />
            <text x="18" y="58" textAnchor="middle" fontSize="14" fill={p.c} fontWeight="bold">{p.mark}</text>
          </g>
        ))}
      </svg>
    ),
  },
  {
    n: 3, title: 'Reveal the winner',
    body: 'A deterministic fairness engine finds one shared recommendation and shows the ranking rules and private fit.',
    art: (
      <svg viewBox="0 0 120 120" className="mx-auto h-24 w-24" aria-hidden>
        <ellipse cx="60" cy="92" rx="40" ry="8" fill="#6B7A3F" opacity="0.25" />
        <path d="M24 84 a36 36 0 0 1 72 0 z" fill="#E9B44C" />
        <circle cx="60" cy="44" r="6" fill="#E9B44C" />
        <rect x="18" y="84" width="84" height="8" rx="4" fill="#C4552D" />
        {[[30, 20], [90, 16], [60, 8], [42, 12], [80, 26]].map(([x, y], i) => (
          <circle key={i} cx={x} cy={y} r="4" fill={['#C4552D', '#6B7A3F', '#E9B44C'][i % 3]} />
        ))}
      </svg>
    ),
  },
];

export default function Landing() {
  const nav = useNavigate();
  return (
    <div className="relative z-10 min-h-dvh bg-cream">
      {/* Top bar */}
      <header className="sticky top-0 z-20 flex h-16 items-center justify-between border-b border-clay-line bg-paper px-5 md:px-8">
        <Logo />
        <div className="flex items-center gap-4">
          <a href="https://github.com/HaithamAlMaamari/tablevote" className="hidden items-center gap-1.5 text-[13px] font-semibold text-ink-soft sm:flex">
            <Github size={16} strokeWidth={1.75} /> GitHub
          </a>
          <Btn variant="secondary" className="min-h-11 px-3 py-2 text-[13px]" onClick={() => nav('/join')}>
            Join with code
          </Btn>
        </div>
      </header>

      <main className="mx-auto max-w-[960px]">
        <aside className="mx-5 mt-5 rounded-xl border border-butter/60 bg-butter-tint px-4 py-3 text-center text-[13px] font-semibold leading-relaxed text-ink-soft md:mx-6">
          Portfolio demo using fictional sample venues. It is not live restaurant search, opening-hours, map, or dietary verification.
        </aside>
        {/* Hero */}
        <section className="grid items-center gap-8 px-5 pb-10 pt-12 md:grid-cols-[55%_45%] md:px-6">
          <div className="order-2 md:order-1">
            <h1 className="text-center font-display text-[40px] font-semibold leading-[1.05] tracking-[-0.02em] text-ink [outline-style:none] md:text-left md:text-[52px]">
              <CharStagger text="Stop debating" delay={0.1} />
              <br />
              <CharStagger text="where to eat." delay={0.35} />
            </h1>
            <motion.p
              initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.4, duration: 0.4, ease: EASE_STANDARD }}
              className="mx-auto mt-4 max-w-[420px] text-center text-[17px] leading-[1.55] text-ink-soft md:mx-0 md:text-left"
            >
              Create a table, share one link, and let everyone vote privately. TableVote ranks a fictional demo catalog for the group.
            </motion.p>
            <motion.div
              initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.6, duration: 0.4, ease: EASE_STANDARD }}
              className="mt-6 flex flex-col items-center gap-3 md:items-start"
            >
              <Btn className="h-14 w-full px-6 text-[15px] md:w-auto" onClick={() => nav('/create')}>
                <Utensils size={20} strokeWidth={1.75} /> Create a table
              </Btn>
              <button
                type="button"
                onClick={() => {
                  const heading = document.getElementById('how-heading');
                  heading?.scrollIntoView({ behavior: 'smooth' });
                  heading?.focus({ preventScroll: true });
                }}
                className="text-[14px] font-bold text-ink-soft underline-offset-2 hover:underline"
              >
                How does it work? ↓
              </button>
            </motion.div>
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.8 }}
              className="mt-5 flex items-center justify-center gap-3 text-[13px] font-semibold tracking-[0.01em] text-ink-faint md:justify-start"
            >
              {['MIT licensed', 'Open source', 'No sign-up'].map((t) => (
                <span key={t} className="flex items-center gap-1"><Check size={13} className="text-olive" /> {t}</span>
              ))}
            </motion.div>
          </div>
          <div className="order-1 md:order-2"><HeroArt /></div>
        </section>

        {/* How it works */}
        <section id="how" className="rounded-t-[32px] bg-cream-deep px-5 py-14 md:px-6">
          <h2 id="how-heading" tabIndex={-1} className="text-center font-display text-[30px] font-semibold leading-[1.15] tracking-[-0.015em] text-ink">
            How TableVote works
          </h2>
          <div className="mt-8 grid gap-4 md:grid-cols-3">
            {STEPS.map((s, i) => (
              <motion.div
                key={s.n}
                initial={{ opacity: 0, y: 40 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, amount: 0.2 }}
                transition={{ duration: 0.5, ease: EASE_STANDARD, delay: i * 0.12 }}
                whileHover={{ y: -4 }}
                className="rounded-[20px] border border-clay-line bg-paper p-5 shadow-card"
              >
                {s.art}
                <div className="mt-3 flex items-center gap-2">
                  <span className="flex h-7 w-7 items-center justify-center rounded-full bg-butter font-display text-[14px] font-semibold text-ink">{s.n}</span>
                  <h3 className="font-display text-[24px] font-semibold leading-[1.2] tracking-[-0.01em] text-ink">{s.title}</h3>
                </div>
                <p className="mt-2 text-[15px] leading-[1.5] text-ink-soft">{s.body}</p>
              </motion.div>
            ))}
          </div>
        </section>

        {/* Fairness strip */}
        <section className="bg-cream-deep px-5 pb-14 md:px-6">
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.2 }}
            transition={{ duration: 0.4, ease: EASE_STANDARD }}
            className="flex flex-col gap-4 rounded-[24px] border border-clay-line bg-paper p-7 shadow-card sm:flex-row sm:items-start"
          >
            <motion.span
              initial={{ rotate: -4 }} whileInView={{ rotate: [ -4, 4, 0 ] }}
              viewport={{ once: true }} transition={{ duration: 0.9 }}
              className="text-olive"
            >
              <Scale size={32} strokeWidth={1.75} />
            </motion.span>
            <div>
              <h3 className="font-display text-[24px] font-semibold tracking-[-0.01em] text-ink">Calm confidence, by design</h3>
              <p className="mt-2 text-[15px] leading-[1.5] text-ink-soft">
                 Required dietary conditions are checked before deterministic ranking. Raw ballots stay private, and the group gets an explanation it can understand without exposing individual choices.
              </p>
              <a href="https://github.com/HaithamAlMaamari/tablevote/blob/main/shared/scoring.ts" className="mt-3 inline-flex items-center gap-1 text-[14px] font-bold text-terracotta-deep">
                Read the algorithm <ArrowRight size={16} />
              </a>
            </div>
          </motion.div>
        </section>

        {/* Footer CTA */}
        <section className="px-5 py-14 text-center">
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            whileInView={{ opacity: 1, scale: 1 }}
            viewport={{ once: true, amount: 0.3 }}
            transition={{ duration: 0.45, ease: EASE_POP }}
          >
            <h2 className="font-display text-[30px] font-semibold tracking-[-0.015em] text-ink">Hungry? Settle it.</h2>
            <Btn className="mx-auto mt-5 h-14 px-8 text-[15px]" onClick={() => nav('/create')}>
              <Utensils size={20} strokeWidth={1.75} /> Create a table
            </Btn>
          </motion.div>
        </section>
      </main>

      <footer className="border-t border-clay-line px-5 py-6 text-center text-[13px] font-semibold tracking-[0.01em] text-ink-faint">
        TableVote is open source · MIT · Made for indecisive friend groups ·{' '}
        <a className="underline" href="https://github.com/HaithamAlMaamari/tablevote">GitHub</a>
      </footer>
    </div>
  );
}
