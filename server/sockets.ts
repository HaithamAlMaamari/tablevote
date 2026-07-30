import { randomUUID } from 'node:crypto';
import type { Server, Socket } from 'socket.io';
import {
  AttachRequestSchema,
  CreateSessionRequestSchema,
  HostMutationRequestSchema,
  JoinSessionRequestSchema,
  ParticipantMutationRequestSchema,
  RemoveParticipantRequestSchema,
  SubmitPrefsRequestSchema,
} from '../shared/contracts';
import { domainFailure } from '../shared/failures';
import type { OperationCommand, OperationService } from './operations';
import type { ServerQuotaLimits } from './policy';
import { SessionPresence, type SocketAttachment } from './presence';
import { FixedWindowQuota } from './quota';

type Reply = (payload: unknown) => void;

interface SocketTimer {
  unref?: () => void;
}

export interface SocketScheduler {
  setTimeout(callback: () => void, delayMs: number): SocketTimer;
  clearTimeout(handle: SocketTimer): void;
}

const nodeScheduler: SocketScheduler = {
  setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
  clearTimeout: (handle) => clearTimeout(handle as NodeJS.Timeout),
};

export class SocketAdmission {
  private readonly handshakes: FixedWindowQuota;
  private readonly connectionsByAddress = new Map<string, number>();
  private readonly releases = new Set<() => void>();
  private connections = 0;

  constructor(
    private readonly limits: ServerQuotaLimits,
    private readonly clock: () => number = () => Date.now(),
  ) {
    this.handshakes = new FixedWindowQuota(limits.windowMs, limits.trackedSocketAddresses);
  }

  allowHandshake(address: string): boolean {
    return this.handshakes.allow(address, this.limits.socketHandshakesPerAddress, this.clock());
  }

  admit(address: string): (() => void) | null {
    const addressConnections = this.connectionsByAddress.get(address) ?? 0;
    if (
      this.connections >= this.limits.socketConnections ||
      addressConnections >= this.limits.socketConnectionsPerAddress
    )
      return null;
    this.connections += 1;
    this.connectionsByAddress.set(address, addressConnections + 1);
    let active = true;
    const release = () => {
      if (!active) return;
      active = false;
      this.releases.delete(release);
      this.connections -= 1;
      const remaining = (this.connectionsByAddress.get(address) ?? 1) - 1;
      if (remaining === 0) this.connectionsByAddress.delete(address);
      else this.connectionsByAddress.set(address, remaining);
    };
    this.releases.add(release);
    return release;
  }

  close(): void {
    for (const release of [...this.releases]) release();
    this.connectionsByAddress.clear();
    this.handshakes.sweep(Number.POSITIVE_INFINITY);
  }
}

function withRequestId<T extends { requestId?: string }>(input: T): Omit<T, 'requestId'> & { requestId: string } {
  return { ...input, requestId: input.requestId ?? randomUUID() };
}

export function registerSocketHandlers(
  io: Server,
  operations: OperationService,
  presence: SessionPresence,
  quotaLimits: ServerQuotaLimits,
  addressQuota: FixedWindowQuota,
  admission: SocketAdmission,
  addressFor: (socket: Socket) => string,
  scheduler: SocketScheduler = nodeScheduler,
): () => void {
  const idleHandles = new Map<string, SocketTimer>();
  io.use((socket, next) => {
    const release = admission.admit(addressFor(socket));
    if (!release) return next(new Error('Socket connection limit reached'));
    socket.once('disconnect', release);
    next();
  });
  io.on('connection', (socket) =>
    registerConnection(
      socket,
      operations,
      presence,
      quotaLimits,
      addressQuota,
      addressFor(socket),
      idleHandles,
      scheduler,
    ),
  );
  return () => {
    for (const handle of idleHandles.values()) scheduler.clearTimeout(handle);
    idleHandles.clear();
    admission.close();
  };
}

function registerConnection(
  socket: Socket,
  operations: OperationService,
  presence: SessionPresence,
  quotaLimits: ServerQuotaLimits,
  addressQuota: FixedWindowQuota,
  address: string,
  idleHandles: Map<string, SocketTimer>,
  scheduler: SocketScheduler,
): void {
  let attachment: SocketAttachment | null = null;
  const idleHandle = scheduler.setTimeout(() => socket.disconnect(true), quotaLimits.unauthenticatedSocketTimeoutMs);
  idleHandles.set(socket.id, idleHandle);
  idleHandle.unref?.();
  const clearIdle = () => {
    const handle = idleHandles.get(socket.id);
    if (!handle) return;
    scheduler.clearTimeout(handle);
    idleHandles.delete(socket.id);
  };
  const socketQuota = new FixedWindowQuota(quotaLimits.windowMs, 2);
  const reply = (callback: unknown, payload: unknown) => {
    if (typeof callback === 'function') (callback as Reply)(payload);
  };
  const limited = (bucket: 'create-join' | 'operations', callback: unknown) => {
    const maximum = bucket === 'create-join' ? quotaLimits.socketCreateJoin : quotaLimits.socketOperations;
    if (socketQuota.allow(bucket, maximum) && addressQuota.allow(`${address}:${bucket}`, maximum)) return false;
    const failure = domainFailure('rate-limited');
    reply(callback, { error: failure.message, errorCode: failure.errorCode });
    return true;
  };
  const execute = (command: OperationCommand, callback: unknown) => {
    const outcome = operations.execute(command, (effect) => {
      attachment = presence.apply(effect, socket, attachment);
      if (attachment) clearIdle();
    });
    reply(callback, outcome.body);
  };
  const invalid = (callback: unknown) => {
    const failure = domainFailure('invalid');
    reply(callback, { error: failure.message, errorCode: failure.errorCode });
  };

  socket.on('create', (data: unknown, callback: unknown) => {
    if (limited('create-join', callback)) return;
    const parsed = CreateSessionRequestSchema.safeParse(data);
    if (!parsed.success) return invalid(callback);
    execute({ kind: 'create', input: withRequestId(parsed.data) }, callback);
  });

  socket.on('join', (data: unknown, callback: unknown) => {
    if (limited('create-join', callback)) return;
    const parsed = JoinSessionRequestSchema.safeParse(data);
    if (!parsed.success) return invalid(callback);
    execute({ kind: 'join', input: withRequestId(parsed.data) }, callback);
  });

  socket.on('attach', (data: unknown, callback: unknown) => {
    if (limited('operations', callback)) return;
    const parsed = AttachRequestSchema.safeParse(data);
    if (!parsed.success) return invalid(callback);
    execute({ kind: 'attach', ...parsed.data }, callback);
  });

  socket.on('submit', (data: unknown, callback: unknown) => {
    if (limited('operations', callback)) return;
    const parsed = SubmitPrefsRequestSchema.safeParse(data);
    const sessionId = attachment?.sessionId ?? (parsed.success ? parsed.data.sessionId : undefined);
    if (!parsed.success || !sessionId) return invalid(callback);
    execute({ kind: 'submit', sessionId, input: withRequestId(parsed.data) }, callback);
  });

  socket.on('leave', (data: unknown, callback: unknown) => {
    if (limited('operations', callback)) return;
    const parsed = ParticipantMutationRequestSchema.safeParse(data);
    const sessionId = attachment?.sessionId ?? (parsed.success ? parsed.data.sessionId : undefined);
    if (!parsed.success || !sessionId) return invalid(callback);
    execute({ kind: 'leave', sessionId, input: withRequestId(parsed.data) }, callback);
  });

  socket.on('remove-participant', (data: unknown, callback: unknown) => {
    if (limited('operations', callback)) return;
    const parsed = RemoveParticipantRequestSchema.safeParse(data);
    if (!parsed.success || !attachment || !parsed.data.participantId) return invalid(callback);
    execute(
      {
        kind: 'remove',
        sessionId: attachment.sessionId,
        participantId: parsed.data.participantId,
        input: withRequestId(parsed.data),
      },
      callback,
    );
  });

  for (const kind of ['reveal', 'rerun', 'end'] as const) {
    socket.on(kind, (data: unknown, callback: unknown) => {
      if (limited('operations', callback)) return;
      const parsed = HostMutationRequestSchema.safeParse(data);
      if (!parsed.success || !attachment) return invalid(callback);
      execute({ kind, sessionId: attachment.sessionId, input: withRequestId(parsed.data) }, callback);
    });
  }

  socket.on('disconnect', () => {
    clearIdle();
    presence.disconnect(socket, attachment);
  });
}
