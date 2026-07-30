import { lazy, Suspense, useEffect } from 'react';
import { Route, Routes, useLocation } from 'react-router';
import Landing from './pages/Landing';

const Create = lazy(() => import('./pages/Create'));
const Join = lazy(() => import('./pages/Join'));
const Share = lazy(() => import('./pages/Share'));
const Preferences = lazy(() => import('./pages/Preferences'));
const Lobby = lazy(() => import('./pages/Lobby'));
const Reveal = lazy(() => import('./pages/Reveal'));
const Result = lazy(() => import('./pages/Result'));

function RouteEffects() {
  const { pathname } = useLocation();

  useEffect(() => {
    const title = pathname === '/' ? 'TableVote'
      : pathname === '/create' ? 'Create a session | TableVote'
        : pathname.startsWith('/join') ? 'Join a session | TableVote'
          : pathname.endsWith('/host') ? 'Host session | TableVote'
            : pathname.endsWith('/preferences') ? 'Your tastes | TableVote'
              : pathname.endsWith('/lobby') ? 'Session lobby | TableVote'
                : pathname.endsWith('/reveal') ? 'Winner reveal | TableVote'
                  : pathname.endsWith('/result') ? 'Session result | TableVote'
                    : 'TableVote';
    document.title = title;

    // The code-entry route intentionally focuses its first input.
    if (pathname === '/join') return;
    const frame = requestAnimationFrame(() => {
      const heading = document.querySelector<HTMLElement>('main h1');
      if (heading) {
        heading.tabIndex = -1;
        heading.focus();
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [pathname]);

  return null;
}

export default function App() {
  useEffect(() => {
    void import('./lib/transport').then(({ sweepExpiredSessionStorage }) => sweepExpiredSessionStorage());
  }, []);
  return (
    <Suspense fallback={<div role="status" className="flex min-h-dvh items-center justify-center bg-cream text-[14px] font-semibold text-ink-soft">Loading TableVote…</div>}>
      <RouteEffects />
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/create" element={<Create />} />
        <Route path="/join/:code?" element={<Join />} />
        <Route path="/s/:code/host" element={<Share />} />
        <Route path="/s/:code/preferences" element={<Preferences />} />
        <Route path="/s/:code/lobby" element={<Lobby />} />
        <Route path="/s/:code/reveal" element={<Reveal />} />
        <Route path="/s/:code/result" element={<Result />} />
        <Route path="*" element={<Landing />} />
      </Routes>
    </Suspense>
  );
}
