import { io, type Socket } from 'socket.io-client';
import {
  CreateSessionResponseSchema,
  ErrorResponseSchema,
  InviteResponseSchema,
  JoinSessionResponseSchema,
  MutationSuccessSchema,
  StateResponseSchema,
  SubmitResponseSchema,
  SessionSnapshotSchema,
} from '@shared/contracts';
import type {
  CreateSessionRequest,
  CreateSessionResponse,
  InviteResponse,
  JoinSessionRequest,
  JoinSessionResponse,
  SubmitResponse,
} from '@shared/contracts';
import { TRANSPORT_POLICY } from '@shared/policy';
import type { Prefs, SessionErrorCode, SessionSnapshot } from '@shared/types';
import { clearSessionStorage } from './identity';

export type OperationResult<T> = { ok: true; value: T } | { ok: false; error: string; errorCode: SessionErrorCode };
export type CreateInput = Omit<CreateSessionRequest, 'requestId'>;
export type JoinInput = Omit<JoinSessionRequest, 'requestId'>;
export type SessionEvent = 'revealed' | 'rerun' | 'session-ended' | 'session-expired' | 'removed';

export interface Transport {
  create(input: CreateInput): Promise<OperationResult<CreateSessionResponse>>;
  invite(idOrCode: string): Promise<OperationResult<InviteResponse>>;
  join(input: JoinInput): Promise<OperationResult<JoinSessionResponse>>;
  attach(sessionId: string, token: string): Promise<OperationResult<{ state: SessionSnapshot }>>;
  fetch(sessionId: string, token: string): Promise<OperationResult<{ state: SessionSnapshot }>>;
  submit(sessionId: string, token: string, prefs: Prefs): Promise<OperationResult<SubmitResponse>>;
  leave(sessionId: string, token: string): Promise<OperationResult<{ ok: true }>>;
  removeParticipant(
    sessionId: string,
    hostToken: string,
    participantId: string,
  ): Promise<OperationResult<{ ok: true }>>;
  reveal(sessionId: string, hostToken: string): Promise<OperationResult<{ ok: true }>>;
  rerun(sessionId: string, hostToken: string): Promise<OperationResult<{ ok: true }>>;
  end(sessionId: string, hostToken: string): Promise<OperationResult<{ ok: true }>>;
  onState(callback: (state: SessionSnapshot) => void): () => void;
  onEvent(name: SessionEvent, callback: () => void): () => void;
  onConnection(callback: (connected: boolean) => void): () => void;
}

interface RuntimeSchema<T> {
  safeParse(input: unknown): { success: true; data: T } | { success: false };
}

export function decodeOperationResult<T>(value: unknown, schema: RuntimeSchema<T>): OperationResult<T> {
  const success = schema.safeParse(value);
  if (success.success) return { ok: true, value: success.data };
  const error = ErrorResponseSchema.safeParse(value);
  return error.success
    ? { ok: false, ...error.data }
    : { ok: false, error: 'Invalid server response', errorCode: 'unknown' };
}

class SocketTransport implements Transport {
  private readonly socket: Socket;
  private attachment: { sessionId: string; token: string } | null = null;
  private readonly stateCallbacks = new Set<(state: SessionSnapshot) => void>();
  private readonly connectionCallbacks = new Set<(connected: boolean) => void>();
  private readonly eventCallbacks: Record<SessionEvent, Set<() => void>> = {
    revealed: new Set(),
    rerun: new Set(),
    'session-ended': new Set(),
    'session-expired': new Set(),
    removed: new Set(),
  };
  private ready = false;

  constructor(socket: Socket) {
    this.socket = socket;
    socket.on('connect', () => {
      if (!this.attachment) return this.setReady(false);
      this.call('attach', this.attachment).then((value) => {
        const result = this.decodeState(value);
        if (result.ok) {
          this.stateCallbacks.forEach((callback) => callback(result.value.state));
          this.setReady(true);
          return;
        }
        this.setReady(false);
        const event: SessionEvent | null =
          result.errorCode === 'expired'
            ? 'session-expired'
            : result.errorCode === 'ended'
              ? 'session-ended'
              : result.errorCode === 'not-found' || result.errorCode === 'access-required'
                ? 'removed'
                : null;
        if (event) this.eventCallbacks[event].forEach((callback) => callback());
      });
    });
    socket.on('disconnect', () => this.setReady(false));
  }

  async create(input: CreateInput): Promise<OperationResult<CreateSessionResponse>> {
    const value = await this.mutate('create', input, '/api/sessions');
    const result = this.decode(value, CreateSessionResponseSchema);
    if (!result.ok) return result;
    this.attachment = {
      sessionId: result.value.sessionId,
      token: result.value.participantToken,
    };
    const state = await this.refreshAttachment();
    return state ? { ok: true, value: { ...result.value, state } } : result;
  }

  async join(input: JoinInput): Promise<OperationResult<JoinSessionResponse>> {
    const value = await this.mutate('join', input, '/api/sessions/join');
    const result = this.decode(value, JoinSessionResponseSchema);
    if (!result.ok) return result;
    this.attachment = {
      sessionId: result.value.state.id,
      token: result.value.participantToken,
    };
    const state = await this.refreshAttachment();
    return state ? { ok: true, value: { ...result.value, state } } : result;
  }

  async invite(idOrCode: string): Promise<OperationResult<InviteResponse>> {
    const value = await this.request(`/api/sessions/${encodeURIComponent(idOrCode)}`, {});
    return this.decode(value, InviteResponseSchema);
  }

  async attach(sessionId: string, token: string): Promise<OperationResult<{ state: SessionSnapshot }>> {
    const changed = this.attachment?.sessionId !== sessionId || this.attachment.token !== token;
    this.attachment = { sessionId, token };
    if (changed) this.setReady(false);
    const result = this.decodeState(await this.call('attach', this.attachment));
    this.setReady(result.ok);
    return result;
  }

  async fetch(sessionId: string, token: string): Promise<OperationResult<{ state: SessionSnapshot }>> {
    const value = await this.request(`/api/sessions/${encodeURIComponent(sessionId)}/state`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    return this.decodeState(value);
  }

  async submit(sessionId: string, token: string, prefs: Prefs) {
    const value = await this.mutate(
      'submit',
      { sessionId, token, prefs },
      `/api/sessions/${encodeURIComponent(sessionId)}/submit`,
    );
    const result = this.decode(value, SubmitResponseSchema);
    if (!result.ok) return result;
    this.stateCallbacks.forEach((callback) => callback(result.value.state));
    return result;
  }

  async leave(sessionId: string, token: string) {
    const result = this.decodeMutation(
      await this.mutate('leave', { sessionId, token }, `/api/sessions/${encodeURIComponent(sessionId)}/leave`),
    );
    if (result.ok) {
      clearSessionStorage(sessionId);
      this.eventCallbacks.removed.forEach((callback) => callback());
    }
    return result;
  }

  async removeParticipant(sessionId: string, hostToken: string, participantId: string) {
    return this.decodeMutation(
      await this.mutate(
        'remove-participant',
        { hostToken, participantId },
        `/api/sessions/${encodeURIComponent(sessionId)}/participants/${encodeURIComponent(participantId)}/remove`,
      ),
    );
  }

  async reveal(sessionId: string, hostToken: string) {
    return this.decodeMutation(
      await this.mutate('reveal', { hostToken }, `/api/sessions/${encodeURIComponent(sessionId)}/reveal`),
    );
  }

  async rerun(sessionId: string, hostToken: string) {
    return this.decodeMutation(
      await this.mutate('rerun', { hostToken }, `/api/sessions/${encodeURIComponent(sessionId)}/rerun`),
    );
  }

  async end(sessionId: string, hostToken: string) {
    const result = this.decodeMutation(
      await this.mutate('end', { hostToken }, `/api/sessions/${encodeURIComponent(sessionId)}/end`),
    );
    if (result.ok) clearSessionStorage(sessionId);
    return result;
  }

  onState(callback: (state: SessionSnapshot) => void): () => void {
    const listener = (value: unknown) => {
      const parsed = SessionSnapshotSchema.safeParse(value);
      if (parsed.success) callback(parsed.data);
    };
    this.stateCallbacks.add(callback);
    this.socket.on('state', listener);
    return () => {
      this.stateCallbacks.delete(callback);
      this.socket.off('state', listener);
    };
  }

  onEvent(name: SessionEvent, callback: () => void): () => void {
    this.eventCallbacks[name].add(callback);
    this.socket.on(name, callback);
    return () => {
      this.eventCallbacks[name].delete(callback);
      this.socket.off(name, callback);
    };
  }

  onConnection(callback: (connected: boolean) => void): () => void {
    this.connectionCallbacks.add(callback);
    callback(this.ready);
    return () => this.connectionCallbacks.delete(callback);
  }

  private async refreshAttachment(): Promise<SessionSnapshot | null> {
    if (!this.socket.connected || !this.attachment) {
      this.setReady(false);
      return null;
    }
    const attached = this.decodeState(await this.call('attach', this.attachment));
    this.setReady(attached.ok);
    return attached.ok ? attached.value.state : null;
  }

  private setReady(ready: boolean): void {
    if (this.ready === ready) return;
    this.ready = ready;
    this.connectionCallbacks.forEach((callback) => callback(ready));
  }

  private call(event: string, payload: unknown): Promise<unknown> {
    return new Promise((resolve) => {
      this.socket
        .timeout(TRANSPORT_POLICY.socketTimeoutMs)
        .emit(event, payload, (error: unknown, response: unknown) =>
          resolve(error ? { error: 'Request timed out', errorCode: 'timeout' } : response),
        );
    });
  }

  private async request(endpoint: string, init: RequestInit): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TRANSPORT_POLICY.requestTimeoutMs);
    try {
      const response = await fetch(endpoint, { ...init, signal: controller.signal });
      return await response.json().catch(() => ({
        error: `Request failed (${response.status})`,
        errorCode: response.status >= 500 ? 'unavailable' : 'unknown',
      }));
    } catch (error) {
      const timeout = error instanceof DOMException && error.name === 'AbortError';
      return {
        error: timeout ? 'Request timed out' : 'Server unavailable',
        errorCode: timeout ? 'timeout' : 'unavailable',
      };
    } finally {
      clearTimeout(timer);
    }
  }

  private async mutate(event: string, payload: object, endpoint: string): Promise<unknown> {
    const body = { ...payload, requestId: crypto.randomUUID() };
    if (this.socket.connected) {
      const socketResult = await this.call(event, body);
      const error = ErrorResponseSchema.safeParse(socketResult);
      if (!error.success || error.data.errorCode !== 'timeout') return socketResult;
    }
    return this.request(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  private decode<T>(value: unknown, schema: RuntimeSchema<T>): OperationResult<T> {
    return decodeOperationResult(value, schema);
  }

  private decodeState(value: unknown): OperationResult<{ state: SessionSnapshot }> {
    return this.decode(value, StateResponseSchema);
  }

  private decodeMutation(value: unknown): OperationResult<{ ok: true }> {
    return this.decode(value, MutationSuccessSchema);
  }
}

let cached: Promise<Transport> | null = null;

export function getTransport(): Promise<Transport> {
  if (!cached) {
    cached = new Promise((resolve, reject) => {
      const socket = io({ timeout: 1500, reconnection: true });
      const timer = setTimeout(() => {
        socket.close();
        reject(new Error('Server unavailable'));
      }, TRANSPORT_POLICY.initialConnectionTimeoutMs);
      const connected = () => {
        clearTimeout(timer);
        socket.off('connect_error', failed);
        resolve(new SocketTransport(socket));
      };
      const failed = () => {
        clearTimeout(timer);
        socket.off('connect', connected);
        socket.close();
        reject(new Error('Server unavailable'));
      };
      socket.once('connect', connected);
      socket.once('connect_error', failed);
    });
    cached.catch(() => {
      cached = null;
    });
  }
  return cached;
}
