import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router';
import { Btn, ScreenShell, TopBar } from '@/components/tablevote';
import type { SessionIssue } from '@shared/types';
import { SESSION_ERROR_CONTENT } from '@/lib/session-errors';

export function SessionIssueAlert({ issue }: { issue: SessionIssue }) {
  const content = SESSION_ERROR_CONTENT[issue.code];
  return (
    <div role="alert" className="mt-5 rounded-xl border border-clay-line bg-paper p-4 text-left">
      <p className="font-semibold text-ink">{content.title}</p>
      <p className="mt-1 text-[14px] leading-relaxed text-ink-soft">{content.detail}</p>
    </div>
  );
}

export function SessionStateScreen({ error, code, onRetry }: {
  error: SessionIssue; code: string; onRetry?: () => void;
}) {
  const nav = useNavigate();
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => headingRef.current?.focus(), []);
  const content = SESSION_ERROR_CONTENT[error.code];
  const accessRequired = error.code === 'access-required';

  return (
    <ScreenShell>
      <TopBar label="Session unavailable" backTo="/" />
      <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
        <h1 ref={headingRef} tabIndex={-1} className="font-display text-[26px] font-semibold text-ink">{content.title}</h1>
        <p className="mt-2 max-w-sm text-[15px] leading-relaxed text-ink-soft">{content.detail}</p>
        <Btn className="mt-6 px-6" onClick={() => {
          if (error.retryable && onRetry) onRetry();
          else nav(accessRequired ? `/join/${code}` : '/');
        }}>
          {error.retryable && onRetry ? 'Try again' : accessRequired ? 'Join this table' : 'Back to home'}
        </Btn>
      </div>
    </ScreenShell>
  );
}
