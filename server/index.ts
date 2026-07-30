// TableVote server — Express REST + Socket.IO, one port (3001 dev / PORT prod).
import express, { type ErrorRequestHandler } from 'express';
import { createServer } from 'node:http';
import { Server as SocketServer } from 'socket.io';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import path from 'node:path';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { inviteSnapshot } from '../shared/types';
import type { Participant, Session, SessionErrorCode } from '../shared/types';
import {
  createSession, endSession, findParticipant, getByIdOrCode, getTerminalReason, joinSession,
  leaveSession, onSessionExpired, removeParticipant, reveal, rerun, snapshot, STORE_LIMITS, submitPrefs,
} from './store';
import { FixedWindowQuota } from './quota';
import { resolveDeploymentConfig, type DeploymentConfig } from './deployment';

interface ServerQuotaLimits {
  windowMs: number;
  apiRequests: number;
  globalCreateJoin: number;
  globalOperations: number;
  sessionJoin: number;
  sessionOperations: number;
  socketCreateJoin: number;
  socketOperations: number;
  trackedSocketAddresses: number;
}

export const SERVER_QUOTA_LIMITS: Readonly<ServerQuotaLimits> = Object.freeze({
  windowMs: 15 * 60 * 1000,
  apiRequests: 50_000,
  globalCreateJoin: 5_000,
  globalOperations: 50_000,
  sessionJoin: 100,
  sessionOperations: 1_000,
  socketCreateJoin: 20,
  socketOperations: 100,
  trackedSocketAddresses: 20_000,
});

function errorCodeFor(message: string): SessionErrorCode {
  const error = message.toLowerCase();
  if (error.includes('expired')) return 'expired';
  if (error.includes('ended')) return 'ended';
  if (error.includes('full')) return 'full';
  if (error.includes('voting is closed') || error.includes('re-run') || error.includes('submitted votes')) return 'locked';
  if (error.includes('too many')) return 'rate-limited';
  if (error.includes('capacity')) return 'capacity';
  if (error.includes('participant authorization') || error.includes('invalid token')
    || error.includes('invalid participant token') || error === 'forbidden') return 'access-required';
  if (error.includes('not found') || error.includes("code doesn't exist")) return 'not-found';
  if (error.includes('invalid') || error.includes('payload')) return 'invalid';
  return 'unknown';
}

function typedErrorPayload(payload: unknown): unknown {
  if (!payload || typeof payload !== 'object') return payload;
  const body = payload as Record<string, unknown>;
  if (typeof body.error !== 'string' || typeof body.errorCode === 'string') return payload;
  return { ...body, errorCode: errorCodeFor(body.error) };
}

const NicknameInput = z.string().max(100)
  .transform((value) => value.normalize('NFKC'))
  .refine((value) => !/[\p{Cc}\p{Cf}]/u.test(value), { message: 'Control characters are not allowed' })
  .transform((value) => value.replace(/[<>"'&]/g, '').trim());
const Nickname = NicknameInput.pipe(z.string().min(1).max(24));
const NicknameOptional = NicknameInput.pipe(z.string().max(24));
const Color = z.number().int().min(0).max(3);
const DietaryType = z.enum(['vegetarian', 'vegan', 'halal', 'kosher', 'gluten-free']);
const CuisineEnum = z.enum([
  'Italian', 'Indian', 'Lebanese', 'Japanese', 'Turkish', 'American',
  'Seafood', 'Vegetarian', 'Fast Food', 'Cafe', 'Omani', 'Thai',
]);
const PrefsSchema = z.object({
  cuisines: z.partialRecord(CuisineEnum, z.enum(['like', 'neutral', 'dislike'])),
  budget: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
  maxDistanceKm: z.number().min(0.1).max(50).nullable(),
  dietary: z.array(z.object({ type: DietaryType, strict: z.literal(true) })).max(6),
}).strict();
const RequestId = z.string().uuid().optional().default(() => randomUUID());
const CreateSchema = z.object({
  areaLabel: z.string().trim().min(1).max(80),
  center: z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) }),
  radiusKm: z.number().min(0.3).max(50),
  nickname: NicknameOptional.optional().default(''),
  color: Color.optional().default(0),
  allowReruns: z.boolean().optional().default(true),
  shareHostNickname: z.boolean().optional().default(false),
  requestId: RequestId,
});
const JoinSchema = z.object({
  sessionId: z.string().max(64).optional(),
  code: z.string().trim().min(5).max(5).optional(),
  nickname: Nickname,
  color: Color.optional().default(0),
  requestId: RequestId,
}).refine((v) => v.sessionId || v.code, { message: 'sessionId or code required' });
const SubmitSchema = z.object({ token: z.string().min(8).max(64), prefs: PrefsSchema, requestId: RequestId });
const ParticipantTokenSchema = z.object({ token: z.string().min(8).max(64), requestId: RequestId });
const HostSchema = z.object({ hostToken: z.string().min(8).max(64), requestId: RequestId });

export function buildApp(options: {
  quotaLimits?: Partial<ServerQuotaLimits>;
  deployment?: DeploymentConfig;
} = {}) {
  const quotaLimits = { ...SERVER_QUOTA_LIMITS, ...options.quotaLimits };
  const deployment = options.deployment ?? resolveDeploymentConfig();
  const app = express();
  const http = createServer(app);
  app.use((_req, res, next) => {
    const json = res.json.bind(res);
    res.json = ((body: unknown) => json(typedErrorPayload(body))) as typeof res.json;
    next();
  });
  const io = new SocketServer(http, {
    maxHttpBufferSize: 64 * 1024,
    allowRequest: (req, callback) => {
      const origin = req.headers.origin;
      const forwardedProto = String(req.headers['x-forwarded-proto'] ?? '').split(',')[0].trim();
      if (deployment.requireHttps && forwardedProto !== 'https') return callback(null, false);
      if (!origin) return callback(null, true);
      if (deployment.production) return callback(null, deployment.allowedOrigins.has(origin));
      try {
        const sameOrigin = new URL(origin).host === req.headers.host;
        callback(null, sameOrigin || deployment.allowedOrigins.has(origin));
      } catch {
        callback(null, false);
      }
    },
  });
  const presence = new Map<string, Map<string, Set<string>>>();
  const onlineParticipantIds = (sessionId: string) => new Set(
    [...(presence.get(sessionId)?.entries() ?? [])]
      .filter(([, sockets]) => sockets.size > 0)
      .map(([participantId]) => participantId),
  );
  const privateSnapshot = (session: Session, participant: Participant) =>
    snapshot(session, participant, onlineParticipantIds(session.id));
  const markPresence = (sessionId: string, participantId: string, socketId: string, online: boolean) => {
    let participants = presence.get(sessionId);
    if (online && !participants) {
      participants = new Map();
      presence.set(sessionId, participants);
    }
    if (!participants) return;
    let sockets = participants.get(participantId);
    if (online && !sockets) {
      sockets = new Set();
      participants.set(participantId, sockets);
    }
    if (online) sockets!.add(socketId);
    else sockets?.delete(socketId);
    if (sockets?.size === 0) participants.delete(participantId);
    if (participants.size === 0) presence.delete(sessionId);
  };
  const stopExpirationNotifications = onSessionExpired((session) => {
    presence.delete(session.id);
    io.to(session.id).emit('session-expired');
    io.in(session.id).socketsLeave(session.id);
  });
  http.on('close', stopExpirationNotifications);

  if (deployment.trustProxyHops > 0) app.set('trust proxy', deployment.trustProxyHops);
  app.use((req, res, next) => {
    if (deployment.requireHttps && !req.secure) return res.status(426).json({ error: 'HTTPS required' });
    const origin = req.headers.origin;
    if (deployment.production && origin && !deployment.allowedOrigins.has(origin)) {
      return res.status(403).json({ error: 'Origin not allowed' });
    }
    next();
  });
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        fontSrc: ["'self'"],
        imgSrc: ["'self'", 'data:'],
        connectSrc: ["'self'", 'ws:', 'wss:'],
        workerSrc: ["'self'", 'blob:'],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        frameAncestors: ["'none'"],
        upgradeInsecureRequests: deployment.requireHttps ? [] : null,
      },
    },
  }));
  app.use(express.json({ limit: '64kb' }));
  const jsonErrorHandler: ErrorRequestHandler = (error, _req, res, next) => {
    if (error?.type === 'entity.too.large') {
      res.status(413).json({ error: 'Payload too large' });
      return;
    }
    next(error);
  };
  app.use(jsonErrorHandler);
  const globalApiQuota = new FixedWindowQuota(quotaLimits.windowMs, 1);
  app.use('/api', (_req, res, next) => {
    if (!globalApiQuota.allow('api', quotaLimits.apiRequests)) {
      return res.status(429).json({ error: 'Too many requests' });
    }
    next();
  });
  const rateLimitMessage = { error: 'Too many requests', errorCode: 'rate-limited' };
  app.use('/api', rateLimit({
    windowMs: 15 * 60 * 1000, max: 100, standardHeaders: true, legacyHeaders: false,
    message: rateLimitMessage,
  }));
  const strict = rateLimit({
    windowMs: 15 * 60 * 1000, max: 40, standardHeaders: true, legacyHeaders: false,
    message: rateLimitMessage,
  });
  const mutationReplayTtlMs = 15 * 60 * 1000;
  const maxMutationReplays = 20_000;
  const globalEventQuota = new FixedWindowQuota(quotaLimits.windowMs, 2);
  const sessionJoinQuota = new FixedWindowQuota(quotaLimits.windowMs, STORE_LIMITS.activeSessions);
  const sessionOperationQuota = new FixedWindowQuota(quotaLimits.windowMs, STORE_LIMITS.activeSessions);
  const socketAddressQuota = new FixedWindowQuota(
    quotaLimits.windowMs, quotaLimits.trackedSocketAddresses * 2,
  );
  const mutationReplays = new Map<string, {
    fingerprint: string; status: number; body: Record<string, unknown>; expiresAt: number;
  }>();
  type MutationData = { requestId: string } & Record<string, unknown>;
  const mutationFingerprint = (data: MutationData, context: string) => {
    const input: Record<string, unknown> = { ...data };
    delete input.requestId;
    return JSON.stringify({ context, input });
  };
  const getMutationReplay = (operation: string, data: MutationData, context = '') => {
    const key = `${operation}:${data.requestId}`;
    const fingerprint = mutationFingerprint(data, context);
    const cached = mutationReplays.get(key);
    if (!cached || cached.expiresAt <= Date.now()) {
      if (cached) mutationReplays.delete(key);
      return { key, fingerprint };
    }
    if (cached.fingerprint !== fingerprint) return { key, fingerprint, conflict: true as const };
    return { key, fingerprint, replay: cached };
  };
  const rememberMutation = (
    key: string,
    fingerprint: string,
    status: number,
    body: Record<string, unknown>,
  ) => {
    if (mutationReplays.size >= maxMutationReplays) {
      const oldest = mutationReplays.keys().next().value;
      if (oldest) mutationReplays.delete(oldest);
    }
    mutationReplays.set(key, { fingerprint, status, body, expiresAt: Date.now() + mutationReplayTtlMs });
  };
  const allowGlobalEvent = (bucket: 'create-join' | 'operations') => globalEventQuota.allow(
    bucket,
    bucket === 'create-join' ? quotaLimits.globalCreateJoin : quotaLimits.globalOperations,
  );
  const allowSessionEvent = (sessionId: string, bucket: 'join' | 'operations') => (
    bucket === 'join'
      ? sessionJoinQuota.allow(sessionId, quotaLimits.sessionJoin)
      : sessionOperationQuota.allow(sessionId, quotaLimits.sessionOperations)
  );
  const quotaSweep = setInterval(() => {
    const now = Date.now();
    globalApiQuota.sweep(now);
    globalEventQuota.sweep(now);
    sessionJoinQuota.sweep(now);
    sessionOperationQuota.sweep(now);
    socketAddressQuota.sweep(now);
    for (const [key, value] of mutationReplays) {
      if (value.expiresAt <= now) mutationReplays.delete(key);
    }
  }, quotaLimits.windowMs);
  quotaSweep.unref();
  http.on('close', () => clearInterval(quotaSweep));

  const participantRoom = (sessionId: string, participantId: string) =>
    `${sessionId}:participant:${participantId}`;
  const broadcast = (sessionId: string) => {
    const s = getByIdOrCode(sessionId);
    if (s) {
      for (const participant of s.participants) {
        io.to(participantRoom(s.id, participant.id)).emit('state', privateSnapshot(s, participant));
      }
    }
  };
  const evictParticipant = (session: Session, participantId: string) => {
    const room = participantRoom(session.id, participantId);
    presence.get(session.id)?.delete(participantId);
    io.to(room).emit('removed');
    io.in(room).socketsLeave(session.id);
    io.in(room).socketsLeave(room);
  };
  const terminalResponse = (idOrCode: string) => {
    const reason = getTerminalReason(idOrCode);
    return reason
      ? { status: 410, error: reason === 'expired' ? 'Session expired' : 'Session ended' }
      : { status: 404, error: 'Session not found' };
  };
  const socketMissingSessionError = (idOrCode: string) => {
    const reason = getTerminalReason(idOrCode);
    return reason === 'expired' ? 'Session expired' : reason === 'ended' ? 'Session ended' : 'Invalid input';
  };

  // ---------------- REST ----------------
  app.post('/api/sessions', strict, (req, res) => {
    const parsed = CreateSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid input' });
    const replay = getMutationReplay('create', parsed.data as MutationData);
    if (replay.conflict) return res.status(409).json({ error: 'Request ID already used' });
    if (replay.replay) return res.status(replay.replay.status).json(replay.replay.body);
    if (!allowGlobalEvent('create-join')) return res.status(429).json({ error: 'Too many requests' });
    let created;
    try {
      created = createSession(parsed.data);
    } catch {
      return res.status(503).json({ error: 'Session capacity reached' });
    }
    const { session, participantToken, participantId } = created;
    const host = findParticipant(session, participantToken)!;
    const body = {
      sessionId: session.id, code: session.code,
      hostToken: session.hostToken, participantToken, participantId,
      state: privateSnapshot(session, host),
    };
    rememberMutation(replay.key, replay.fingerprint, 201, body);
    res.status(201).json(body);
  });

  app.get('/api/sessions/:idOrCode', (req, res) => {
    const s = getByIdOrCode(req.params.idOrCode);
    if (!s) {
      const terminal = terminalResponse(req.params.idOrCode);
      return res.status(terminal.status).json({ error: terminal.error });
    }
    res.set('Cache-Control', 'no-store');
    res.json({ invite: inviteSnapshot(s) });
  });

  app.get('/api/sessions/:idOrCode/state', (req, res) => {
    const s = getByIdOrCode(req.params.idOrCode);
    if (!s) {
      const terminal = terminalResponse(req.params.idOrCode);
      return res.status(terminal.status).json({ error: terminal.error });
    }
    const authorization = req.headers.authorization;
    const token = authorization?.startsWith('Bearer ') ? authorization.slice(7) : '';
    const participant = token ? findParticipant(s, token) : undefined;
    if (!participant) return res.status(401).json({ error: 'Participant authorization required' });
    res.json({ state: privateSnapshot(s, participant) });
  });

  app.post('/api/sessions/join', strict, (req, res) => {
    const parsed = JoinSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid input' });
    const reference = parsed.data.sessionId ?? parsed.data.code!;
    const replay = getMutationReplay('join', parsed.data as MutationData, reference);
    if (replay.conflict) return res.status(409).json({ error: 'Request ID already used' });
    if (replay.replay) return res.status(replay.replay.status).json(replay.replay.body);
    if (!allowGlobalEvent('create-join')) return res.status(429).json({ error: 'Too many requests' });
    const s = getByIdOrCode(reference);
    if (!s) {
      const terminal = terminalResponse(parsed.data.sessionId ?? parsed.data.code!);
      return res.status(terminal.status).json({ error: terminal.status === 410 ? terminal.error : "Hmm, that code doesn't exist" });
    }
    if (!allowSessionEvent(s.id, 'join')) return res.status(429).json({ error: 'Too many requests' });
    const joined = joinSession(s, parsed.data.nickname, parsed.data.color);
    if ('error' in joined) return res.status(409).json({ error: joined.error });
    broadcast(s.id);
    const participant = findParticipant(s, joined.participantToken)!;
    const body = {
      participantToken: joined.participantToken,
      participantId: joined.participantId,
      state: privateSnapshot(s, participant),
    };
    rememberMutation(replay.key, replay.fingerprint, 201, body);
    res.status(201).json(body);
  });

  app.post('/api/sessions/:idOrCode/submit', (req, res) => {
    const parsed = SubmitSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid input' });
    const replay = getMutationReplay('submit', parsed.data as MutationData, req.params.idOrCode);
    if (replay.conflict) return res.status(409).json({ error: 'Request ID already used' });
    if (replay.replay) return res.status(replay.replay.status).json(replay.replay.body);
    if (!allowGlobalEvent('operations')) return res.status(429).json({ error: 'Too many requests' });
    const s = getByIdOrCode(req.params.idOrCode);
    if (!s) {
      const terminal = terminalResponse(req.params.idOrCode);
      return res.status(terminal.status).json({ error: terminal.error });
    }
    if (!allowSessionEvent(s.id, 'operations')) return res.status(429).json({ error: 'Too many requests' });
    if (!submitPrefs(s, parsed.data.token, parsed.data.prefs)) {
      const authorized = !!findParticipant(s, parsed.data.token);
      return res.status(authorized ? 409 : 403).json({
        error: authorized ? 'Voting is closed' : 'Invalid token',
        errorCode: authorized ? 'locked' : 'access-required',
      });
    }
    const participant = findParticipant(s, parsed.data.token)!;
    broadcast(s.id);
    const body = { ok: true, state: privateSnapshot(s, participant) };
    rememberMutation(replay.key, replay.fingerprint, 200, body);
    res.json(body);
  });

  app.post('/api/sessions/:idOrCode/leave', (req, res) => {
    const parsed = ParticipantTokenSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid input' });
    const replay = getMutationReplay('leave', parsed.data as MutationData, req.params.idOrCode);
    if (replay.conflict) return res.status(409).json({ error: 'Request ID already used' });
    if (replay.replay) return res.status(replay.replay.status).json(replay.replay.body);
    if (!allowGlobalEvent('operations')) return res.status(429).json({ error: 'Too many requests' });
    const s = getByIdOrCode(req.params.idOrCode);
    if (!s) {
      const terminal = terminalResponse(req.params.idOrCode);
      return res.status(terminal.status).json({ error: terminal.error });
    }
    if (!allowSessionEvent(s.id, 'operations')) return res.status(429).json({ error: 'Too many requests' });
    const participant = findParticipant(s, parsed.data.token);
    const result = leaveSession(s, parsed.data.token);
    if (!result.ok) return res.status(result.error === 'Voting is closed' ? 409 : 403).json({ error: result.error });
    if (participant) evictParticipant(s, participant.id);
    broadcast(s.id);
    const body = { ok: true };
    rememberMutation(replay.key, replay.fingerprint, 200, body);
    res.json(body);
  });

  app.post('/api/sessions/:idOrCode/participants/:participantId/remove', (req, res) => {
    const parsed = HostSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid input' });
    const replay = getMutationReplay(
      'remove', parsed.data as MutationData, `${req.params.idOrCode}:${req.params.participantId}`,
    );
    if (replay.conflict) return res.status(409).json({ error: 'Request ID already used' });
    if (replay.replay) return res.status(replay.replay.status).json(replay.replay.body);
    if (!allowGlobalEvent('operations')) return res.status(429).json({ error: 'Too many requests' });
    const s = getByIdOrCode(req.params.idOrCode);
    if (!s) {
      const terminal = terminalResponse(req.params.idOrCode);
      return res.status(terminal.status).json({ error: terminal.error });
    }
    if (!allowSessionEvent(s.id, 'operations')) return res.status(429).json({ error: 'Too many requests' });
    const result = removeParticipant(s, parsed.data.hostToken, req.params.participantId);
    if (!result.ok) {
      const status = result.error === 'Forbidden' ? 403 : result.error === 'Participant not found' ? 404 : 409;
      return res.status(status).json({ error: result.error });
    }
    evictParticipant(s, req.params.participantId);
    broadcast(s.id);
    const body = { ok: true };
    rememberMutation(replay.key, replay.fingerprint, 200, body);
    res.json(body);
  });

  app.post('/api/sessions/:idOrCode/reveal', (req, res) => {
    const parsed = HostSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid input' });
    const replay = getMutationReplay('reveal', parsed.data as MutationData, req.params.idOrCode);
    if (replay.conflict) return res.status(409).json({ error: 'Request ID already used' });
    if (replay.replay) return res.status(replay.replay.status).json(replay.replay.body);
    if (!allowGlobalEvent('operations')) return res.status(429).json({ error: 'Too many requests' });
    const s = getByIdOrCode(req.params.idOrCode);
    if (!s) {
      const terminal = terminalResponse(req.params.idOrCode);
      return res.status(terminal.status).json({ error: terminal.error });
    }
    if (!allowSessionEvent(s.id, 'operations')) return res.status(429).json({ error: 'Too many requests' });
    const r = reveal(s, parsed.data.hostToken, () => broadcast(s.id));
    if (!r.ok) return res.status(r.error === 'Forbidden' ? 403 : 409).json({ error: r.error });
    if (r.changed) {
      broadcast(s.id);
      io.to(s.id).emit('revealed', { at: Date.now() });
    }
    const body = { ok: true };
    rememberMutation(replay.key, replay.fingerprint, 200, body);
    res.json(body);
  });

  app.post('/api/sessions/:idOrCode/rerun', (req, res) => {
    const parsed = HostSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid input' });
    const replay = getMutationReplay('rerun', parsed.data as MutationData, req.params.idOrCode);
    if (replay.conflict) return res.status(409).json({ error: 'Request ID already used' });
    if (replay.replay) return res.status(replay.replay.status).json(replay.replay.body);
    if (!allowGlobalEvent('operations')) return res.status(429).json({ error: 'Too many requests' });
    const s = getByIdOrCode(req.params.idOrCode);
    if (!s) {
      const terminal = terminalResponse(req.params.idOrCode);
      return res.status(terminal.status).json({ error: terminal.error });
    }
    if (!allowSessionEvent(s.id, 'operations')) return res.status(429).json({ error: 'Too many requests' });
    const r = rerun(s, parsed.data.hostToken, () => broadcast(s.id));
    if (!r.ok) return res.status(r.error === 'Forbidden' ? 403 : 409).json({ error: r.error });
    broadcast(s.id);
    io.to(s.id).emit('rerun', { at: Date.now() });
    const body = { ok: true };
    rememberMutation(replay.key, replay.fingerprint, 200, body);
    res.json(body);
  });

  app.post('/api/sessions/:idOrCode/end', (req, res) => {
    const parsed = HostSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid input' });
    const replay = getMutationReplay('end', parsed.data as MutationData, req.params.idOrCode);
    if (replay.conflict) return res.status(409).json({ error: 'Request ID already used' });
    if (replay.replay) return res.status(replay.replay.status).json(replay.replay.body);
    if (!allowGlobalEvent('operations')) return res.status(429).json({ error: 'Too many requests' });
    const s = getByIdOrCode(req.params.idOrCode);
    if (!s) {
      const terminal = terminalResponse(req.params.idOrCode);
      return res.status(terminal.status).json({ error: terminal.error });
    }
    if (!allowSessionEvent(s.id, 'operations')) return res.status(429).json({ error: 'Too many requests' });
    if (!endSession(req.params.idOrCode, parsed.data.hostToken))
      return res.status(403).json({ error: 'Forbidden' });
    presence.delete(s.id);
    io.to(s.id).emit('session-ended');
    io.in(s.id).socketsLeave(s.id);
    const body = { ok: true };
    rememberMutation(replay.key, replay.fingerprint, 200, body);
    res.json(body);
  });

  // ---------------- Socket.IO ----------------
  io.on('connection', (sock) => {
    let current: string | null = null;
    let currentParticipantId: string | null = null;
    const socketQuota = new FixedWindowQuota(quotaLimits.windowMs, 2);
    const reply = (cb: unknown, payload: unknown) => {
      if (typeof cb === 'function') (cb as (p: unknown) => void)(typedErrorPayload(payload));
    };
    const limited = (bucket: 'create-join' | 'operations', cb: unknown) => {
      const maximum = bucket === 'create-join'
        ? quotaLimits.socketCreateJoin
        : quotaLimits.socketOperations;
      if (socketQuota.allow(bucket, maximum)
        && socketAddressQuota.allow(`${sock.handshake.address}:${bucket}`, maximum)) return false;
      reply(cb, { error: 'Too many requests' });
      return true;
    };
    const attachRooms = (session: Session, participant: Participant) => {
      const previousSessionId = current;
      const previousParticipantId = currentParticipantId;
      if (previousSessionId && previousParticipantId) {
        markPresence(previousSessionId, previousParticipantId, sock.id, false);
      }
      if (current) sock.leave(current);
      if (current && currentParticipantId) sock.leave(participantRoom(current, currentParticipantId));
      current = session.id;
      currentParticipantId = participant.id;
      sock.join(session.id);
      sock.join(participantRoom(session.id, participant.id));
      markPresence(session.id, participant.id, sock.id, true);
      if (previousSessionId && previousSessionId !== session.id) broadcast(previousSessionId);
    };

    sock.on('create', (data: unknown, cb: unknown) => {
      if (limited('create-join', cb)) return;
      const parsed = CreateSchema.safeParse(data);
      if (!parsed.success) return reply(cb, { error: 'Invalid input' });
      const replay = getMutationReplay('create', parsed.data as MutationData);
      if (replay.conflict) return reply(cb, { error: 'Request ID already used' });
      if (replay.replay) {
        const body = replay.replay.body as { sessionId?: string; participantToken?: string };
        const session = body.sessionId ? getByIdOrCode(body.sessionId) : undefined;
        const participant = session && body.participantToken
          ? findParticipant(session, body.participantToken) : undefined;
        if (session && participant) attachRooms(session, participant);
        return reply(cb, replay.replay.body);
      }
      if (!allowGlobalEvent('create-join')) return reply(cb, { error: 'Too many requests' });
      let created;
      try {
        created = createSession(parsed.data);
      } catch {
        return reply(cb, { error: 'Session capacity reached' });
      }
      const { session, participantToken, participantId } = created;
      const host = findParticipant(session, participantToken)!;
      attachRooms(session, host);
      const body = {
        sessionId: session.id, code: session.code,
        hostToken: session.hostToken, participantToken, participantId,
        state: privateSnapshot(session, host),
      };
      rememberMutation(replay.key, replay.fingerprint, 201, body);
      reply(cb, body);
    });

    sock.on('join', (data: unknown, cb: unknown) => {
      if (limited('create-join', cb)) return;
      const parsed = JoinSchema.safeParse(data);
      if (!parsed.success) return reply(cb, { error: 'Invalid input' });
      const reference = parsed.data.sessionId ?? parsed.data.code!;
      const replay = getMutationReplay('join', parsed.data as MutationData, reference);
      if (replay.conflict) return reply(cb, { error: 'Request ID already used' });
      if (replay.replay) {
        const body = replay.replay.body as { participantToken?: string };
        const session = getByIdOrCode(reference);
        const participant = session && body.participantToken
          ? findParticipant(session, body.participantToken) : undefined;
        if (session && participant) attachRooms(session, participant);
        return reply(cb, replay.replay.body);
      }
      if (!allowGlobalEvent('create-join')) return reply(cb, { error: 'Too many requests' });
      const s = getByIdOrCode(reference);
      if (!s) {
        const reason = getTerminalReason(parsed.data.sessionId ?? parsed.data.code!);
        return reply(cb, { error: reason === 'expired' ? 'Session expired' : reason === 'ended' ? 'Session ended' : "Hmm, that code doesn't exist" });
      }
      if (!allowSessionEvent(s.id, 'join')) return reply(cb, { error: 'Too many requests' });
      const joined = joinSession(s, parsed.data.nickname, parsed.data.color);
      if ('error' in joined) return reply(cb, { error: joined.error });
      const participant = findParticipant(s, joined.participantToken)!;
      attachRooms(s, participant);
      const body = {
        participantToken: joined.participantToken,
        participantId: joined.participantId,
        state: privateSnapshot(s, participant),
      };
      rememberMutation(replay.key, replay.fingerprint, 201, body);
      reply(cb, body);
      broadcast(s.id);
    });

    // Re-attach an existing participant after reconnect (state sync).
    sock.on('attach', (data: unknown, cb: unknown) => {
      if (limited('operations', cb)) return;
      const p = z.object({ sessionId: z.string().max(64), token: z.string().min(8).max(64) }).safeParse(data);
      if (!p.success) return reply(cb, { error: 'Invalid input' });
      if (!allowGlobalEvent('operations')) return reply(cb, { error: 'Too many requests' });
      const s = getByIdOrCode(p.data.sessionId);
      const participant = s ? findParticipant(s, p.data.token) : undefined;
      if (!s || !participant) {
        const reason = getTerminalReason(p.data.sessionId);
        return reply(cb, { error: reason === 'expired' ? 'Session expired' : reason === 'ended' ? 'Session ended' : 'Not found' });
      }
      if (!allowSessionEvent(s.id, 'operations')) return reply(cb, { error: 'Too many requests' });
      attachRooms(s, participant);
      reply(cb, { state: privateSnapshot(s, participant) });
      broadcast(s.id);
    });

    sock.on('submit', (data: unknown, cb: unknown) => {
      if (limited('operations', cb)) return;
      const sessionId = current ?? (typeof data === 'object' && data !== null ? String((data as Record<string, unknown>).sessionId ?? '') : '');
      const parsed = SubmitSchema.safeParse(data);
      if (!parsed.success) return reply(cb, { error: 'Invalid input' });
      const replay = getMutationReplay('submit', parsed.data as MutationData, sessionId);
      if (replay.conflict) return reply(cb, { error: 'Request ID already used' });
      if (replay.replay) return reply(cb, replay.replay.body);
      if (!allowGlobalEvent('operations')) return reply(cb, { error: 'Too many requests' });
      const s = getByIdOrCode(sessionId);
      if (!s) return reply(cb, { error: socketMissingSessionError(sessionId) });
      if (!allowSessionEvent(s.id, 'operations')) return reply(cb, { error: 'Too many requests' });
      if (!submitPrefs(s, parsed.data.token, parsed.data.prefs)) {
        const authorized = !!findParticipant(s, parsed.data.token);
        return reply(cb, {
          error: authorized ? 'Voting is closed' : 'Invalid token',
          errorCode: authorized ? 'locked' : 'access-required',
        });
      }
      const participant = findParticipant(s, parsed.data.token)!;
      const body = { ok: true, state: privateSnapshot(s, participant) };
      rememberMutation(replay.key, replay.fingerprint, 200, body);
      reply(cb, body);
      broadcast(s.id);
    });

    sock.on('leave', (data: unknown, cb: unknown) => {
      if (limited('operations', cb)) return;
      const parsed = ParticipantTokenSchema.safeParse(data);
      if (!current || !parsed.success) return reply(cb, { error: 'Invalid input' });
      const replay = getMutationReplay('leave', parsed.data as MutationData, current);
      if (replay.conflict) return reply(cb, { error: 'Request ID already used' });
      if (replay.replay) return reply(cb, replay.replay.body);
      if (!allowGlobalEvent('operations')) return reply(cb, { error: 'Too many requests' });
      const s = getByIdOrCode(current);
      if (!s) return reply(cb, { error: socketMissingSessionError(current) });
      if (!allowSessionEvent(s.id, 'operations')) return reply(cb, { error: 'Too many requests' });
      const participant = findParticipant(s, parsed.data.token);
      const result = leaveSession(s, parsed.data.token);
      if (!result.ok) return reply(cb, { error: result.error });
      const body = { ok: true };
      rememberMutation(replay.key, replay.fingerprint, 200, body);
      reply(cb, body);
      if (participant) evictParticipant(s, participant.id);
      broadcast(s.id);
    });

    sock.on('remove-participant', (data: unknown, cb: unknown) => {
      if (limited('operations', cb)) return;
      const parsed = z.object({
        hostToken: z.string().min(8).max(64), participantId: z.string().min(8).max(64), requestId: RequestId,
      }).safeParse(data);
      if (!current || !parsed.success) return reply(cb, { error: 'Invalid input' });
      const replay = getMutationReplay('remove', parsed.data as MutationData, `${current}:${parsed.data.participantId}`);
      if (replay.conflict) return reply(cb, { error: 'Request ID already used' });
      if (replay.replay) return reply(cb, replay.replay.body);
      if (!allowGlobalEvent('operations')) return reply(cb, { error: 'Too many requests' });
      const s = getByIdOrCode(current);
      if (!s) return reply(cb, { error: socketMissingSessionError(current) });
      if (!allowSessionEvent(s.id, 'operations')) return reply(cb, { error: 'Too many requests' });
      const result = removeParticipant(s, parsed.data.hostToken, parsed.data.participantId);
      if (!result.ok) return reply(cb, { error: result.error });
      const body = { ok: true };
      rememberMutation(replay.key, replay.fingerprint, 200, body);
      reply(cb, body);
      evictParticipant(s, parsed.data.participantId);
      broadcast(s.id);
    });

    sock.on('reveal', (data: unknown, cb: unknown) => {
      if (limited('operations', cb)) return;
      const parsed = HostSchema.safeParse(data);
      if (!current || !parsed.success) return reply(cb, { error: 'Invalid input' });
      const replay = getMutationReplay('reveal', parsed.data as MutationData, current);
      if (replay.conflict) return reply(cb, { error: 'Request ID already used' });
      if (replay.replay) return reply(cb, replay.replay.body);
      if (!allowGlobalEvent('operations')) return reply(cb, { error: 'Too many requests' });
      const s = getByIdOrCode(current);
      if (!s) return reply(cb, { error: socketMissingSessionError(current) });
      if (!allowSessionEvent(s.id, 'operations')) return reply(cb, { error: 'Too many requests' });
      const r = reveal(s, parsed.data.hostToken, () => broadcast(s.id));
      if (!r.ok) return reply(cb, { error: r.error });
      const body = { ok: true };
      rememberMutation(replay.key, replay.fingerprint, 200, body);
      reply(cb, body);
      if (r.changed) {
        broadcast(s.id);
        io.to(s.id).emit('revealed', { at: Date.now() });
      }
    });

    sock.on('rerun', (data: unknown, cb: unknown) => {
      if (limited('operations', cb)) return;
      const parsed = HostSchema.safeParse(data);
      if (!current || !parsed.success) return reply(cb, { error: 'Invalid input' });
      const replay = getMutationReplay('rerun', parsed.data as MutationData, current);
      if (replay.conflict) return reply(cb, { error: 'Request ID already used' });
      if (replay.replay) return reply(cb, replay.replay.body);
      if (!allowGlobalEvent('operations')) return reply(cb, { error: 'Too many requests' });
      const s = getByIdOrCode(current);
      if (!s) return reply(cb, { error: socketMissingSessionError(current) });
      if (!allowSessionEvent(s.id, 'operations')) return reply(cb, { error: 'Too many requests' });
      const r = rerun(s, parsed.data.hostToken, () => broadcast(s.id));
      if (!r.ok) return reply(cb, { error: r.error });
      const body = { ok: true };
      rememberMutation(replay.key, replay.fingerprint, 200, body);
      reply(cb, body);
      broadcast(s.id);
      io.to(s.id).emit('rerun', { at: Date.now() });
    });

    sock.on('end', (data: unknown, cb: unknown) => {
      if (limited('operations', cb)) return;
      const parsed = HostSchema.safeParse(data);
      if (!current || !parsed.success) return reply(cb, { error: 'Invalid input' });
      const replay = getMutationReplay('end', parsed.data as MutationData, current);
      if (replay.conflict) return reply(cb, { error: 'Request ID already used' });
      if (replay.replay) return reply(cb, replay.replay.body);
      if (!allowGlobalEvent('operations')) return reply(cb, { error: 'Too many requests' });
      const s = getByIdOrCode(current);
      if (!s) return reply(cb, { error: socketMissingSessionError(current) });
      if (!allowSessionEvent(s.id, 'operations')) return reply(cb, { error: 'Too many requests' });
      if (!endSession(s.id, parsed.data.hostToken)) return reply(cb, { error: 'Forbidden' });
      presence.delete(s.id);
      const body = { ok: true };
      rememberMutation(replay.key, replay.fingerprint, 200, body);
      reply(cb, body);
      io.to(s.id).emit('session-ended');
      io.in(s.id).socketsLeave(s.id);
    });

    sock.on('disconnect', () => {
      if (!current || !currentParticipantId) return;
      const sessionId = current;
      markPresence(sessionId, currentParticipantId, sock.id, false);
      broadcast(sessionId);
    });
  });

  // ---------------- Static (production single-port) ----------------
  const dist = path.resolve(process.cwd(), 'dist');
  if (fs.existsSync(dist)) {
    app.use(express.static(dist));
    app.get(/^\/(?!api|socket.io).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));
  }

  return { app, http, io };
}

if (process.env.VITEST !== 'true') {
  const port = Number(process.env.PORT ?? 3001);
  const { http } = buildApp();
  http.listen(port, () => console.log(`TableVote server on :${port}`));
}
