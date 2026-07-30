import { randomUUID } from 'node:crypto';
import type { Express, Request, RequestHandler, Response } from 'express';
import {
  CreateSessionRequestSchema,
  HostMutationRequestSchema,
  JoinSessionRequestSchema,
  ParticipantMutationRequestSchema,
  RemoveParticipantRequestSchema,
  SubmitPrefsRequestSchema,
} from '../shared/contracts';
import type { InviteResponse, StateResponse } from '../shared/contracts';
import { domainFailure } from '../shared/failures';
import { projectInvite, projectSession } from '../shared/projections';
import type { OperationCommand, OperationEffect, OperationOutcome, OperationService } from './operations';
import type { SessionStore } from './store';

type EffectSink = (effect: OperationEffect) => void;

function send(res: Response, outcome: OperationOutcome): void {
  res.status(outcome.status).json(outcome.body);
}

function invalid(res: Response): void {
  const failure = domainFailure('invalid');
  res.status(failure.httpStatus).json({ error: failure.message, errorCode: failure.errorCode });
}

function withRequestId<T extends { requestId?: string }>(input: T): Omit<T, 'requestId'> & { requestId: string } {
  return { ...input, requestId: input.requestId ?? randomUUID() };
}

export function registerRestRoutes(
  app: Express,
  store: SessionStore,
  operations: OperationService,
  emit: EffectSink,
  strictRateLimit: RequestHandler,
  onlineParticipantIds: (sessionId: string) => ReadonlySet<string>,
): void {
  const execute = (res: Response, command: OperationCommand) => send(res, operations.execute(command, emit));

  app.post('/api/sessions', strictRateLimit, (req, res) => {
    const parsed = CreateSessionRequestSchema.safeParse(req.body);
    if (!parsed.success) return invalid(res);
    execute(res, { kind: 'create', input: withRequestId(parsed.data) });
  });

  app.get('/api/sessions/:idOrCode', (req, res) => {
    const session = store.get(req.params.idOrCode);
    if (!session) {
      const reason = store.terminalReason(req.params.idOrCode);
      const failure = domainFailure(reason ?? 'not-found');
      return res.status(failure.httpStatus).json({ error: failure.message, errorCode: failure.errorCode });
    }
    res.set('Cache-Control', 'no-store');
    const body = { invite: projectInvite(session) } satisfies InviteResponse;
    res.json(body);
  });

  app.get('/api/sessions/:idOrCode/state', (req, res) => {
    const session = store.get(req.params.idOrCode);
    if (!session) {
      const reason = store.terminalReason(req.params.idOrCode);
      const failure = domainFailure(reason ?? 'not-found');
      return res.status(failure.httpStatus).json({ error: failure.message, errorCode: failure.errorCode });
    }
    const authorization = req.headers.authorization;
    const token = authorization?.startsWith('Bearer ') ? authorization.slice(7) : '';
    const participant = token ? store.findParticipant(session, token) : undefined;
    if (!participant) {
      return res.status(401).json({
        error: 'Participant authorization required',
        errorCode: 'access-required',
      });
    }
    const body = {
      state: projectSession(session, participant, onlineParticipantIds(session.id)),
    } satisfies StateResponse;
    res.json(body);
  });

  app.post('/api/sessions/join', strictRateLimit, (req, res) => {
    const parsed = JoinSessionRequestSchema.safeParse(req.body);
    if (!parsed.success) return invalid(res);
    execute(res, { kind: 'join', input: withRequestId(parsed.data) });
  });

  const participantMutation =
    (kind: 'submit' | 'leave', schema: typeof SubmitPrefsRequestSchema | typeof ParticipantMutationRequestSchema) =>
    (req: Request, res: Response) => {
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) return invalid(res);
      execute(res, {
        kind,
        sessionId: req.params.idOrCode,
        input: withRequestId(parsed.data),
      } as OperationCommand);
    };
  app.post('/api/sessions/:idOrCode/submit', participantMutation('submit', SubmitPrefsRequestSchema));
  app.post('/api/sessions/:idOrCode/leave', participantMutation('leave', ParticipantMutationRequestSchema));

  app.post('/api/sessions/:idOrCode/participants/:participantId/remove', (req, res) => {
    const parsed = RemoveParticipantRequestSchema.safeParse(req.body);
    if (!parsed.success) return invalid(res);
    execute(res, {
      kind: 'remove',
      sessionId: req.params.idOrCode,
      participantId: req.params.participantId,
      input: withRequestId(parsed.data),
    });
  });

  for (const kind of ['reveal', 'rerun', 'end'] as const) {
    app.post(`/api/sessions/:idOrCode/${kind}`, (req, res) => {
      const parsed = HostMutationRequestSchema.safeParse(req.body);
      if (!parsed.success) return invalid(res);
      execute(res, {
        kind,
        sessionId: req.params.idOrCode,
        input: withRequestId(parsed.data),
      });
    });
  }
}
