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

function HeroBallot() {
  const rows = [
    { code: 'JPN', label: 'Japanese', mark: '+', color: 'bg-electric text-ticket' },
    { code: 'LBN', label: 'Lebanese', mark: '+', color: 'bg-electric text-ticket' },
    { code: 'THA', label: 'Thai', mark: '—', color: 'bg-ticket text-ink' },
  ];

  return (
    <motion.div
      initial={{ opacity: 0, rotate: 2, x: 16 }}
      animate={{ opacity: 1, rotate: -1, x: 0 }}
      transition={{ delay: 0.25, duration: 0.55, ease: EASE_POP }}
      className="ticket-panel mx-auto w-full max-w-[390px] bg-ticket"
    >
      <div className="flex items-start justify-between border-b-2 border-rule bg-ink px-5 py-4 text-ticket">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-ticket/70">TableVote ballot</p>
          <p className="mt-1 font-display text-[25px] font-bold tracking-[-0.04em]">Friday dinner</p>
        </div>
        <span className="border-2 border-acid px-2 py-1 font-mono text-[10px] uppercase tracking-widest text-acid">
          OPEN
        </span>
      </div>
      <div className="flex justify-between border-b-2 border-dashed border-rule px-5 py-3 font-mono text-[10px] uppercase tracking-widest text-ink-muted">
        <span>Guest 04</span>
        <span>Private</span>
        <span>01 / 05</span>
      </div>
      <div className="space-y-2 p-5">
        <p className="ticket-label mb-3">Mark tonight's direction</p>
        {rows.map((row) => (
          <div key={row.code} className="grid grid-cols-[48px_1fr_36px] items-center border-2 border-rule bg-canvas">
            <span className="border-r-2 border-rule py-3 text-center font-mono text-[10px] font-medium">
              {row.code}
            </span>
            <span className="px-3 text-[15px] font-bold">{row.label}</span>
            <span
              className={`flex h-full items-center justify-center border-l-2 border-rule font-mono text-lg ${row.color}`}
            >
              {row.mark}
            </span>
          </div>
        ))}
      </div>
      <div className="tear-rule mx-5 flex items-center justify-between py-4">
        <span className="font-mono text-[10px] uppercase tracking-widest text-ink-muted">
          Group reveal after 2+ votes
        </span>
        <span className="ballot-stamp text-signal-dark">Cast blind</span>
      </div>
    </motion.div>
  );
}

const STEPS = [
  {
    n: '01',
    signal: 'INVITE',
    title: 'Create & share',
    body: 'Create a table, then send one contextual link, QR, or 5-letter code to the group chat.',
  },
  {
    n: '02',
    signal: 'BALLOT',
    title: 'Everyone votes privately',
    body: 'Cuisines, budget, distance, and dietary needs. Raw ballots stay private, even from the host.',
  },
  {
    n: '03',
    signal: 'VERDICT',
    title: 'Reveal the winner',
    body: 'A deterministic fairness engine finds one shared recommendation and shows the ranking rules and private fit.',
  },
];

export default function Landing() {
  const nav = useNavigate();
  return (
    <div className="relative z-10 min-h-dvh overflow-x-clip bg-canvas">
      <header className="sticky top-0 z-20 flex h-16 items-center justify-between border-b-[3px] border-rule bg-ticket px-5 md:px-8">
        <Logo />
        <div className="flex items-center gap-4">
          <a
            href="https://github.com/HaithamAlMaamari/tablevote"
            className="hidden items-center gap-1.5 font-mono text-[11px] font-medium uppercase tracking-wider text-ink-muted sm:flex"
          >
            <Github size={16} strokeWidth={2} /> Source
          </a>
          <Btn variant="secondary" className="min-h-10 px-3 py-1 text-[13px]" onClick={() => nav('/join')}>
            Join with code
          </Btn>
        </div>
      </header>

      <main>
        <div data-capture="landing" className="mx-auto max-w-[1120px] px-5 pb-16 pt-6 md:px-8">
          <aside className="flex items-center justify-between gap-4 border-2 border-rule bg-acid px-4 py-2.5 font-mono text-[10px] font-medium uppercase tracking-[0.08em] text-ink sm:text-[11px]">
            <span>Prototype ticket / fictional venues only</span>
            <span className="hidden text-right sm:block">No live search · no dietary verification</span>
          </aside>

          <section className="grid items-center gap-10 pb-10 pt-12 md:grid-cols-[1.08fr_0.92fr] md:gap-14 md:py-16">
            <div>
              <p className="ticket-label mb-5 flex items-center gap-3">
                <span className="h-2 w-2 bg-signal" /> One table. One ballot. One call.
              </p>
              <h1 className="max-w-[620px] font-display text-[48px] font-extrabold leading-[0.92] tracking-[-0.055em] text-ink [outline-style:none] sm:text-[64px] lg:text-[78px]">
                <CharStagger text="Stop debating" delay={0.05} />
                <br />
                <span className="text-signal underline decoration-electric decoration-[6px] underline-offset-[9px]">
                  <CharStagger text="where to eat." delay={0.25} />
                </span>
              </h1>
              <motion.p
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.38, duration: 0.4, ease: EASE_STANDARD }}
                className="mt-7 max-w-[520px] text-[18px] font-medium leading-[1.5] text-ink-muted"
              >
                Create a shared dining ticket, collect private tastes, and let a transparent ranking call the table.
              </motion.p>
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.5, duration: 0.4, ease: EASE_STANDARD }}
                className="mt-7 flex flex-col items-start gap-4 sm:flex-row sm:items-center"
              >
                <Btn className="h-14 w-full px-7 text-[16px] sm:w-auto" onClick={() => nav('/create')}>
                  <Utensils size={19} strokeWidth={2} /> Create a table
                </Btn>
                <button
                  type="button"
                  onClick={() => {
                    const heading = document.getElementById('how-heading');
                    heading?.scrollIntoView({ behavior: 'smooth' });
                    heading?.focus({ preventScroll: true });
                  }}
                  className="min-h-11 font-mono text-[11px] font-medium uppercase tracking-wider text-ink-muted underline decoration-2 underline-offset-4 hover:text-electric"
                >
                  How does it work? ↓
                </button>
              </motion.div>
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.65 }}
                className="mt-7 flex flex-wrap gap-x-5 gap-y-2 font-mono text-[10px] font-medium uppercase tracking-wider text-ink-muted"
              >
                {['MIT licensed', 'Open source', 'No sign-up'].map((text) => (
                  <span key={text} className="flex items-center gap-1.5">
                    <Check size={13} strokeWidth={3} className="text-electric" /> {text}
                  </span>
                ))}
              </motion.div>
            </div>
            <HeroBallot />
          </section>
        </div>

        <section id="how" className="border-y-[3px] border-rule bg-ink px-5 py-16 text-ticket md:px-8">
          <div className="mx-auto max-w-[1080px]">
            <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
              <div>
                <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-acid">Service sequence</p>
                <h2
                  id="how-heading"
                  tabIndex={-1}
                  className="mt-2 font-display text-[36px] font-bold tracking-[-0.04em] text-ticket"
                >
                  How TableVote works
                </h2>
              </div>
              <p className="max-w-[360px] text-[15px] leading-relaxed text-ticket/70">
                The table sees readiness and the final ranking. Individual ballots remain sealed.
              </p>
            </div>
            <div className="mt-9 grid border-2 border-ticket md:grid-cols-3">
              {STEPS.map((step, i) => (
                <motion.article
                  key={step.n}
                  initial={{ opacity: 0, y: 24 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true, amount: 0.2 }}
                  transition={{ duration: 0.4, delay: i * 0.1 }}
                  className="relative min-h-[260px] border-b-2 border-ticket p-6 last:border-b-0 md:border-b-0 md:border-r-2 md:last:border-r-0"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-display text-[52px] font-extrabold leading-none text-ticket/50">
                      {step.n}
                    </span>
                    <span className="ballot-stamp text-acid">{step.signal}</span>
                  </div>
                  <h3 className="mt-8 font-display text-[25px] font-bold tracking-[-0.03em]">{step.title}</h3>
                  <p className="mt-3 text-[15px] leading-relaxed text-ticket/70">{step.body}</p>
                </motion.article>
              ))}
            </div>
          </div>
        </section>

        <section className="mx-auto grid max-w-[1080px] gap-8 px-5 py-16 md:grid-cols-[0.8fr_1.2fr] md:px-8">
          <div className="border-l-[8px] border-electric pl-5">
            <Scale size={30} strokeWidth={2} className="text-electric" />
            <h2 className="mt-4 font-display text-[32px] font-bold tracking-[-0.04em]">The receipt shows its work.</h2>
          </div>
          <div className="ticket-panel p-7">
            <p className="ticket-label">Fairness note / deterministic, not objective</p>
            <p className="mt-4 text-[17px] leading-relaxed text-ink-muted">
              Required dietary conditions are checked before deterministic ranking. Raw ballots stay private, and the
              group gets an explanation it can understand without exposing individual choices.
            </p>
            <a
              href="https://github.com/HaithamAlMaamari/tablevote/blob/main/shared/scoring.ts"
              className="mt-5 inline-flex items-center gap-2 font-mono text-[11px] font-medium uppercase tracking-wider text-electric underline decoration-2 underline-offset-4"
            >
              Read the algorithm <ArrowRight size={15} />
            </a>
          </div>
        </section>

        <section className="border-t-[3px] border-rule bg-signal px-5 py-14 text-center text-ticket">
          <h2 className="font-display text-[36px] font-bold tracking-[-0.04em]">Hungry? Issue the ballot.</h2>
          <Btn variant="secondary" className="mx-auto mt-6 h-14 px-8" onClick={() => nav('/create')}>
            Create a table
          </Btn>
        </section>
      </main>

      <footer className="border-t-[3px] border-rule bg-ticket px-5 py-6 text-center font-mono text-[10px] font-medium uppercase tracking-wider text-ink-faint">
        TableVote · MIT · Made for indecisive friend groups ·{' '}
        <a className="underline" href="https://github.com/HaithamAlMaamari/tablevote">
          GitHub
        </a>
      </footer>
    </div>
  );
}
