import { createHash } from 'node:crypto';
import type {
  CreateSessionRequest,
  CreateSessionResponse,
  HostMutationRequest,
  JoinSessionRequest,
  JoinSessionResponse,
  ParticipantMutationRequest,
  RemoveParticipantRequest,
  SubmitResponse,
  SubmitPrefsRequest,
} from '../shared/contracts';
import { domainFailure, type DomainFailure } from '../shared/failures';
import { TRANSPORT_POLICY } from '../shared/policy';
import { projectSession } from '../shared/projections';
import type { Participant, Session, SessionSnapshot } from '../shared/types';
import type { SessionStore } from './store';

type WithRequestId<T> = Omit<T, 'requestId'> & { requestId: string };

export type OperationCommand =
  | { kind: 'create'; input: WithRequestId<CreateSessionRequest> }
  | { kind: 'join'; input: WithRequestId<JoinSessionRequest> }
  | { kind: 'attach'; sessionId: string; token: string }
  | { kind: 'submit'; sessionId: string; input: WithRequestId<SubmitPrefsRequest> }
  | { kind: 'leave'; sessionId: string; input: WithRequestId<ParticipantMutationRequest> }
  | { kind: 'remove'; sessionId: string; participantId: string; input: WithRequestId<RemoveParticipantRequest> }
  | { kind: 'reveal'; sessionId: string; input: WithRequestId<HostMutationRequest> }
  | { kind: 'rerun'; sessionId: string; input: WithRequestId<HostMutationRequest> }
  | { kind: 'end'; sessionId: string; input: WithRequestId<HostMutationRequest> };

export type OperationEffect =
  | { kind: 'attach'; session: Session; participant: Participant }
  | { kind: 'broadcast'; sessionId: string }
  | { kind: 'evict'; session: Session; participantId: string }
  | { kind: 'revealed'; sessionId: string }
  | { kind: 'rerun'; sessionId: string }
  | { kind: 'ended'; sessionId: string };

export interface OperationSuccess {
  ok: true;
  status: number;
  body: Record<string, unknown>;
  replayed: boolean;
  sessionId: string;
}

export interface OperationFailure {
  ok: false;
  status: number;
  body: { error: string; errorCode: DomainFailure['errorCode'] };
  failure: DomainFailure;
}

export type OperationOutcome = OperationSuccess | OperationFailure;

export interface OperationServiceOptions {
  clock?: () => number;
  onlineParticipantIds?: (sessionId: string) => ReadonlySet<string>;
  allowGlobal?: (bucket: 'create-join' | 'operations') => boolean;
  allowSession?: (sessionId: string, bucket: 'join' | 'operations') => boolean;
}

interface ReplayEntry {
  fingerprint: string;
  status: number;
  body: Record<string, unknown>;
  expiresAt: number;
  sessionId: string;
}

export class OperationService {
  private readonly clock: () => number;
  private readonly onlineParticipantIds: (sessionId: string) => ReadonlySet<string>;
  private readonly allowGlobal: (bucket: 'create-join' | 'operations') => boolean;
  private readonly allowSession: (sessionId: string, bucket: 'join' | 'operations') => boolean;
  private readonly replays = new Map<string, ReplayEntry>();

  constructor(
    private readonly store: SessionStore,
    options: OperationServiceOptions = {},
  ) {
    this.clock = options.clock ?? Date.now;
    this.onlineParticipantIds = options.onlineParticipantIds ?? (() => new Set());
    this.allowGlobal = options.allowGlobal ?? (() => true);
    this.allowSession = options.allowSession ?? (() => true);
  }

  execute(command: OperationCommand, emit: (effect: OperationEffect) => void = () => {}): OperationOutcome {
    if (command.kind === 'attach') return this.attach(command, emit);

    let replay = this.replay(command);
    if (replay.entry && command.kind !== 'end' && !this.store.get(replay.entry.sessionId)) {
      this.purgeSessionReplays(replay.entry.sessionId);
      replay = { key: replay.key, fingerprint: replay.fingerprint };
    }
    if (replay.conflict) return this.fail('request-conflict');
    if (replay.entry) {
      this.restoreAttachment(command, replay.entry.body, emit);
      return {
        ok: true,
        status: replay.entry.status,
        body: replay.entry.body,
        replayed: true,
        sessionId: replay.entry.sessionId,
      };
    }

    const bucket = command.kind === 'create' || command.kind === 'join' ? 'create-join' : 'operations';
    if (!this.allowGlobal(bucket)) return this.fail('rate-limited');

    const outcome = this.run(command, emit);
    if (outcome.ok) this.remember(replay.key, replay.fingerprint, outcome);
    return outcome;
  }

  sweepReplays(now = this.clock()): void {
    for (const [key, entry] of this.replays) {
      if (entry.expiresAt <= now) this.replays.delete(key);
    }
  }

  purgeSessionReplays(sessionId: string): void {
    for (const [key, entry] of this.replays) {
      if (entry.sessionId === sessionId) this.replays.delete(key);
    }
  }

  private run(
    command: Exclude<OperationCommand, { kind: 'attach' }>,
    emit: (effect: OperationEffect) => void,
  ): OperationOutcome {
    if (command.kind === 'create') {
      const created = this.store.create(command.input);
      if (!created.ok) return this.fromFailure(created.failure);
      const { session, participantToken, participantId } = created.value;
      const participant = this.store.findParticipant(session, participantToken)!;
      emit({ kind: 'attach', session, participant });
      const body = {
        sessionId: session.id,
        code: session.code,
        hostToken: session.hostToken,
        participantToken,
        participantId,
        state: this.project(session, participant),
      } satisfies CreateSessionResponse;
      return this.succeed(201, body, session.id);
    }

    const reference = command.kind === 'join' ? (command.input.sessionId ?? command.input.code!) : command.sessionId;
    const session = this.store.get(reference);
    if (!session) return this.missing(reference, command.kind === 'join' ? 'join-not-found' : 'not-found');

    const sessionBucket = command.kind === 'join' ? 'join' : 'operations';
    if (!this.allowSession(session.id, sessionBucket)) return this.fail('rate-limited');

    if (command.kind === 'join') {
      const joined = this.store.join(session, command.input.nickname, command.input.color);
      if (!joined.ok) return this.fromFailure(joined.failure);
      emit({ kind: 'attach', session, participant: joined.value.participant });
      emit({ kind: 'broadcast', sessionId: session.id });
      const body = {
        participantToken: joined.value.participantToken,
        participantId: joined.value.participantId,
        state: this.project(session, joined.value.participant),
      } satisfies JoinSessionResponse;
      return this.succeed(201, body, session.id);
    }

    if (command.kind === 'submit') {
      const submitted = this.store.submit(session, command.input.token, command.input.prefs);
      if (!submitted.ok) {
        const normalized =
          submitted.failure.kind === 'invalid-participant' ? domainFailure('invalid-token') : submitted.failure;
        return this.fromFailure(normalized);
      }
      emit({ kind: 'broadcast', sessionId: session.id });
      const body = {
        ok: true,
        state: this.project(session, submitted.value.participant),
      } satisfies SubmitResponse;
      return this.succeed(200, body, session.id);
    }

    if (command.kind === 'leave') {
      const left = this.store.leave(session, command.input.token);
      if (!left.ok) return this.fromFailure(left.failure);
      emit({ kind: 'evict', session, participantId: left.value.participantId });
      emit({ kind: 'broadcast', sessionId: session.id });
      return this.succeed(200, { ok: true }, session.id);
    }

    if (command.kind === 'remove') {
      const removed = this.store.remove(session, command.input.hostToken, command.participantId);
      if (!removed.ok) return this.fromFailure(removed.failure);
      emit({ kind: 'evict', session, participantId: removed.value.participantId });
      emit({ kind: 'broadcast', sessionId: session.id });
      return this.succeed(200, { ok: true }, session.id);
    }

    if (command.kind === 'reveal') {
      let revealed;
      try {
        revealed = this.store.reveal(session, command.input.hostToken, () => {
          emit({ kind: 'broadcast', sessionId: session.id });
        });
      } catch {
        emit({ kind: 'broadcast', sessionId: session.id });
        return this.fail('unavailable');
      }
      if (!revealed.ok) return this.fromFailure(revealed.failure);
      if (revealed.value.changed) {
        emit({ kind: 'broadcast', sessionId: session.id });
        emit({ kind: 'revealed', sessionId: session.id });
      }
      return this.succeed(200, { ok: true }, session.id);
    }

    if (command.kind === 'rerun') {
      let rerun;
      try {
        rerun = this.store.rerun(session, command.input.hostToken, () => {
          emit({ kind: 'broadcast', sessionId: session.id });
        });
      } catch {
        emit({ kind: 'broadcast', sessionId: session.id });
        return this.fail('unavailable');
      }
      if (!rerun.ok) return this.fromFailure(rerun.failure);
      emit({ kind: 'broadcast', sessionId: session.id });
      emit({ kind: 'rerun', sessionId: session.id });
      return this.succeed(200, { ok: true }, session.id);
    }

    const ended = this.store.end(session.id, command.input.hostToken);
    if (!ended.ok) return this.fromFailure(ended.failure);
    this.purgeSessionReplays(session.id);
    emit({ kind: 'ended', sessionId: session.id });
    return this.succeed(200, { ok: true }, session.id);
  }

  private attach(
    command: Extract<OperationCommand, { kind: 'attach' }>,
    emit: (effect: OperationEffect) => void,
  ): OperationOutcome {
    if (!this.allowGlobal('operations')) return this.fail('rate-limited');
    const session = this.store.get(command.sessionId);
    if (!session) return this.missing(command.sessionId, 'attach-not-found');
    if (!this.allowSession(session.id, 'operations')) return this.fail('rate-limited');
    const participant = this.store.findParticipant(session, command.token);
    if (!participant) return this.fail('attach-not-found');
    emit({ kind: 'attach', session, participant });
    emit({ kind: 'broadcast', sessionId: session.id });
    return this.succeed(200, { state: this.project(session, participant) }, session.id);
  }

  private project(session: Session, participant: Participant): SessionSnapshot {
    return projectSession(session, participant, this.onlineParticipantIds(session.id));
  }

  private missing(reference: string, fallback: 'not-found' | 'join-not-found' | 'attach-not-found'): OperationFailure {
    const reason = this.store.terminalReason(reference);
    return this.fail(reason ?? fallback);
  }

  private replay(command: Exclude<OperationCommand, { kind: 'attach' }>): {
    key: string;
    fingerprint: string;
    entry?: ReplayEntry;
    conflict?: true;
  } {
    const key = `${command.kind}:${command.input.requestId}`;
    const input = { ...command.input } as Record<string, unknown>;
    delete input.requestId;
    const fingerprint = createHash('sha256')
      .update(JSON.stringify({ ...command, input }))
      .digest('base64url');
    const entry = this.replays.get(key);
    if (!entry || entry.expiresAt <= this.clock()) {
      if (entry) this.replays.delete(key);
      return { key, fingerprint };
    }
    return entry.fingerprint === fingerprint
      ? { key, fingerprint, entry }
      : { key, fingerprint, entry, conflict: true };
  }

  private remember(key: string, fingerprint: string, outcome: OperationSuccess): void {
    if (this.replays.size >= TRANSPORT_POLICY.maxMutationReplays) {
      const oldest = this.replays.keys().next().value;
      if (oldest) this.replays.delete(oldest);
    }
    this.replays.set(key, {
      fingerprint,
      status: outcome.status,
      body: outcome.body,
      expiresAt: this.clock() + TRANSPORT_POLICY.mutationReplayTtlMs,
      sessionId: outcome.sessionId,
    });
  }

  private restoreAttachment(
    command: Exclude<OperationCommand, { kind: 'attach' }>,
    body: Record<string, unknown>,
    emit: (effect: OperationEffect) => void,
  ): void {
    if (command.kind !== 'create' && command.kind !== 'join') return;
    const reference =
      command.kind === 'create' ? String(body.sessionId ?? '') : (command.input.sessionId ?? command.input.code ?? '');
    const session = this.store.get(reference);
    const participant = session ? this.store.findParticipant(session, String(body.participantToken ?? '')) : undefined;
    if (session && participant) emit({ kind: 'attach', session, participant });
  }

  private succeed(status: number, body: Record<string, unknown>, sessionId: string): OperationSuccess {
    return { ok: true, status, body, replayed: false, sessionId };
  }

  private fail(kind: Parameters<typeof domainFailure>[0]): OperationFailure {
    return this.fromFailure(domainFailure(kind));
  }

  private fromFailure(failure: DomainFailure): OperationFailure {
    return {
      ok: false,
      status: failure.httpStatus,
      body: { error: failure.message, errorCode: failure.errorCode },
      failure,
    };
  }
}
