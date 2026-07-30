import type { SessionErrorCode, SessionIssue } from '@shared/types';
import { SESSION_POLICY } from '@shared/policy';

const RETRYABLE = new Set<SessionErrorCode>([
  'offline',
  'timeout',
  'rate-limited',
  'capacity',
  'unavailable',
  'unknown',
]);

export const SESSION_ERROR_CONTENT: Record<SessionErrorCode, { title: string; detail: string }> = {
  invalid: {
    title: 'Check the session details',
    detail: 'Some session information was invalid. Review it and try again.',
  },
  'not-found': { title: "We couldn't find this table", detail: 'Check the code or ask the host for a fresh invite.' },
  expired: {
    title: 'This table expired',
    detail: 'This session reached its 24-hour limit. Its access and saved ballot have been removed.',
  },
  ended: {
    title: 'This table is closed',
    detail: 'The host ended this session. Ask for a fresh invite to start again.',
  },
  full: {
    title: 'This table is full',
    detail: `The session already has ${SESSION_POLICY.participantsPerSession} participants.`,
  },
  locked: { title: 'Voting is closed', detail: 'The host has already started the result process.' },
  offline: { title: 'TableVote is offline', detail: 'Check your connection and try again.' },
  timeout: { title: 'The request took too long', detail: 'The server did not respond in time. Try again.' },
  'access-required': {
    title: 'Session access required',
    detail: 'Open your personal invite in this browser or join the table again.',
  },
  removed: { title: 'You left this table', detail: 'Your session access and saved ballot have been removed.' },
  'rate-limited': { title: 'Too many attempts', detail: 'Wait a few minutes before trying again.' },
  capacity: {
    title: 'TableVote is at capacity',
    detail: 'The server cannot create another session right now. Try again later.',
  },
  unavailable: {
    title: 'TableVote is unavailable',
    detail: 'The server could not be reached. Check your connection and try again.',
  },
  unknown: { title: 'Something went wrong', detail: 'The request could not be completed. Try again.' },
};

export function toSessionIssue(message = 'Something went wrong', code: SessionErrorCode = 'unknown'): SessionIssue {
  return { code, message, retryable: RETRYABLE.has(code) };
}
