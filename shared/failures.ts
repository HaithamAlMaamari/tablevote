import type { SessionErrorCode } from './types';
import { SESSION_POLICY } from './policy';

export const DOMAIN_FAILURES = {
  invalid: { errorCode: 'invalid', message: 'Invalid input', httpStatus: 400 },
  'request-conflict': { errorCode: 'unknown', message: 'Request ID already used', httpStatus: 409 },
  'not-found': { errorCode: 'not-found', message: 'Session not found', httpStatus: 404 },
  'join-not-found': { errorCode: 'not-found', message: "Hmm, that code doesn't exist", httpStatus: 404 },
  'attach-not-found': { errorCode: 'not-found', message: 'Not found', httpStatus: 404 },
  expired: { errorCode: 'expired', message: 'Session expired', httpStatus: 410 },
  ended: { errorCode: 'ended', message: 'Session ended', httpStatus: 410 },
  full: {
    errorCode: 'full',
    message: `That table's full (${SESSION_POLICY.participantsPerSession} max)`,
    httpStatus: 409,
  },
  locked: { errorCode: 'locked', message: 'Voting is closed', httpStatus: 409 },
  'access-required': { errorCode: 'access-required', message: 'Forbidden', httpStatus: 403 },
  'invalid-participant': { errorCode: 'access-required', message: 'Invalid participant token', httpStatus: 403 },
  'invalid-token': { errorCode: 'access-required', message: 'Invalid token', httpStatus: 403 },
  'host-must-end': { errorCode: 'access-required', message: 'The host must end the session', httpStatus: 403 },
  'participant-not-found': { errorCode: 'not-found', message: 'Participant not found', httpStatus: 404 },
  'host-cannot-be-removed': { errorCode: 'locked', message: 'The host cannot be removed', httpStatus: 409 },
  'too-few-votes': { errorCode: 'locked', message: 'Need at least 2 submitted votes', httpStatus: 409 },
  'reruns-disabled': { errorCode: 'locked', message: 'Re-runs disabled', httpStatus: 409 },
  'reruns-exhausted': { errorCode: 'locked', message: 'No re-runs left', httpStatus: 409 },
  'no-match-to-rerun': { errorCode: 'locked', message: 'No matched result to re-run', httpStatus: 409 },
  capacity: { errorCode: 'capacity', message: 'Session capacity reached', httpStatus: 503 },
  'rate-limited': { errorCode: 'rate-limited', message: 'Too many requests', httpStatus: 429 },
  unavailable: { errorCode: 'unavailable', message: 'Server unavailable', httpStatus: 503 },
} as const satisfies Record<
  string,
  {
    errorCode: SessionErrorCode;
    message: string;
    httpStatus: number;
  }
>;

export type DomainFailureKind = keyof typeof DOMAIN_FAILURES;
export type DomainFailure<K extends DomainFailureKind = DomainFailureKind> = {
  kind: K;
  errorCode: (typeof DOMAIN_FAILURES)[K]['errorCode'];
  message: (typeof DOMAIN_FAILURES)[K]['message'];
  httpStatus: (typeof DOMAIN_FAILURES)[K]['httpStatus'];
};

export type DomainResult<T> = { ok: true; value: T } | { ok: false; failure: DomainFailure };

export function domainFailure<K extends DomainFailureKind>(kind: K): DomainFailure<K> {
  return { kind, ...DOMAIN_FAILURES[kind] } as DomainFailure<K>;
}

export function success<T>(value: T): DomainResult<T> {
  return { ok: true, value };
}

export function failure<T = never>(kind: DomainFailureKind): DomainResult<T> {
  return { ok: false, failure: domainFailure(kind) };
}
