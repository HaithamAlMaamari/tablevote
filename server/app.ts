import express, { type ErrorRequestHandler } from 'express';
import { createServer, type ServerResponse } from 'node:http';
import { Server as SocketServer } from 'socket.io';
import helmet from 'helmet';
import rateLimit, { MemoryStore } from 'express-rate-limit';
import path from 'node:path';
import fs from 'node:fs';
import type { IncomingMessage } from 'node:http';
import { INPUT_POLICY } from '../shared/policy';
import { domainFailure } from '../shared/failures';
import { FixedWindowQuota } from './quota';
import { resolveDeploymentConfig, type DeploymentConfig } from './deployment';
import { OperationService } from './operations';
import { SERVER_QUOTA_LIMITS, type ServerQuotaLimits } from './policy';
import { SessionPresence } from './presence';
import { registerRestRoutes } from './rest';
import { registerSocketHandlers, SocketAdmission } from './sockets';
import { SessionStore } from './store';

export interface BuildAppOptions {
  quotaLimits?: Partial<ServerQuotaLimits>;
  deployment?: DeploymentConfig;
  store?: SessionStore;
  clock?: () => number;
}

export { SERVER_QUOTA_LIMITS } from './policy';

export function resolveClientAddress(request: IncomingMessage, trustedProxyHops: number): string {
  const forwardedHeader = request.headers['x-forwarded-for'];
  const forwarded = (Array.isArray(forwardedHeader) ? forwardedHeader.join(',') : (forwardedHeader ?? ''))
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  if (trustedProxyHops > 0 && forwarded.length > 0) {
    return forwarded[Math.max(0, forwarded.length - trustedProxyHops)];
  }
  return request.socket.remoteAddress ?? 'unknown';
}

export function buildApp(options: BuildAppOptions = {}) {
  const quotaLimits = { ...SERVER_QUOTA_LIMITS, ...options.quotaLimits };
  const deployment = options.deployment ?? resolveDeploymentConfig();
  const clock = options.clock ?? (() => Date.now());
  const store = options.store ?? new SessionStore({ clock });
  const app = express();
  const http = createServer(app);
  const socketAdmission = new SocketAdmission(quotaLimits, clock);
  const io = new SocketServer(http, {
    maxHttpBufferSize: INPUT_POLICY.socketPayloadBytes,
    allowRequest: (req, callback) => {
      const origin = req.headers.origin;
      const forwardedProto = String(req.headers['x-forwarded-proto'] ?? '')
        .split(',')[0]
        .trim();
      if (deployment.requireHttps && forwardedProto !== 'https') return callback(null, false);
      if (origin) {
        if (deployment.production && !deployment.allowedOrigins.has(origin)) return callback(null, false);
        if (!deployment.production) {
          try {
            const sameOrigin = new URL(origin).host === req.headers.host;
            if (!sameOrigin && !deployment.allowedOrigins.has(origin)) return callback(null, false);
          } catch {
            return callback(null, false);
          }
        }
      }
      callback(null, socketAdmission.reserve(req, resolveClientAddress(req, deployment.trustProxyHops)));
    },
  });
  const engineClients = io.engine as unknown as { clients: Record<string, unknown> };
  io.engine.use((req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const query = new URL(req.url ?? '/', 'http://localhost').searchParams;
    const sid = query.get('sid');
    const malformed =
      query.get('EIO') !== '4' ||
      !['polling', 'websocket'].includes(query.get('transport') ?? '') ||
      (sid === null && req.method !== 'GET') ||
      (sid !== null && !Object.hasOwn(engineClients.clients, sid));
    if (!malformed || socketAdmission.allowInvalidRequest(resolveClientAddress(req, deployment.trustProxyHops))) {
      return next();
    }
    res.statusCode = 429;
    res.setHeader('Retry-After', String(Math.max(1, Math.ceil(quotaLimits.windowMs / 1_000))));
    res.end('Too many invalid transport requests');
  });
  io.engine.on('connection', (transport) => socketAdmission.bind(transport));
  io.engine.on('connection_error', ({ req }: { req: IncomingMessage }) => socketAdmission.reject(req));
  const presence = new SessionPresence(io, store, clock);

  if (deployment.trustProxyHops > 0) app.set('trust proxy', deployment.trustProxyHops);
  app.use((req, res, next) => {
    if (deployment.requireHttps && !req.secure) {
      return res.status(426).json({ error: 'HTTPS required', errorCode: 'access-required' });
    }
    const origin = req.headers.origin;
    if (deployment.production && origin && !deployment.allowedOrigins.has(origin)) {
      return res.status(403).json({ error: 'Origin not allowed', errorCode: 'access-required' });
    }
    next();
  });
  app.use(
    helmet({
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
    }),
  );
  app.use(express.json({ limit: INPUT_POLICY.payloadLimit }));
  const jsonErrorHandler: ErrorRequestHandler = (error, _req, res, next) => {
    if (error?.type === 'entity.too.large') {
      const failure = domainFailure('invalid');
      res.status(413).json({ error: 'Payload too large', errorCode: failure.errorCode });
      return;
    }
    next(error);
  };
  app.use(jsonErrorHandler);

  const globalApiQuota = new FixedWindowQuota(quotaLimits.windowMs, 1);
  app.use('/api', (_req, res, next) => {
    if (!globalApiQuota.allow('api', quotaLimits.apiRequests)) {
      const failure = domainFailure('rate-limited');
      return res.status(failure.httpStatus).json({ error: failure.message, errorCode: failure.errorCode });
    }
    next();
  });
  const rateLimitMessage = { error: 'Too many requests', errorCode: 'rate-limited' };
  const apiRateStore = new MemoryStore();
  app.use(
    '/api',
    rateLimit({
      windowMs: quotaLimits.windowMs,
      max: 100,
      standardHeaders: true,
      legacyHeaders: false,
      message: rateLimitMessage,
      store: apiRateStore,
    }),
  );
  const strictRateStore = new MemoryStore();
  const strict = rateLimit({
    windowMs: quotaLimits.windowMs,
    max: 40,
    standardHeaders: true,
    legacyHeaders: false,
    message: rateLimitMessage,
    store: strictRateStore,
  });

  const globalEventQuota = new FixedWindowQuota(quotaLimits.windowMs, 2);
  const sessionJoinQuota = new FixedWindowQuota(quotaLimits.windowMs, quotaLimits.trackedSocketAddresses);
  const sessionOperationQuota = new FixedWindowQuota(quotaLimits.windowMs, quotaLimits.trackedSocketAddresses);
  const socketAddressQuota = new FixedWindowQuota(quotaLimits.windowMs, quotaLimits.trackedSocketAddresses * 2);
  const operations = new OperationService(store, {
    clock,
    onlineParticipantIds: (sessionId) => presence.onlineParticipantIds(sessionId),
    allowGlobal: (bucket) =>
      globalEventQuota.allow(
        bucket,
        bucket === 'create-join' ? quotaLimits.globalCreateJoin : quotaLimits.globalOperations,
      ),
    allowSession: (sessionId, bucket) =>
      bucket === 'join'
        ? sessionJoinQuota.allow(sessionId, quotaLimits.sessionJoin)
        : sessionOperationQuota.allow(sessionId, quotaLimits.sessionOperations),
  });

  registerRestRoutes(
    app,
    store,
    operations,
    (effect) => presence.apply(effect),
    strict,
    (sessionId) => presence.onlineParticipantIds(sessionId),
  );
  const closeSocketHandlers = registerSocketHandlers(
    io,
    operations,
    presence,
    quotaLimits,
    socketAddressQuota,
    socketAdmission,
    (socket) => resolveClientAddress(socket.conn.request, deployment.trustProxyHops),
  );

  const stopExpirationNotifications = store.onExpired((session) => {
    operations.purgeSessionReplays(session.id);
    presence.expire(session);
  });
  const quotaSweep = setInterval(() => {
    const now = clock();
    globalApiQuota.sweep(now);
    globalEventQuota.sweep(now);
    sessionJoinQuota.sweep(now);
    sessionOperationQuota.sweep(now);
    socketAddressQuota.sweep(now);
    operations.sweepReplays(now);
  }, quotaLimits.windowMs);
  quotaSweep.unref();
  let closed = false;
  http.on('close', () => {
    if (closed) return;
    closed = true;
    clearInterval(quotaSweep);
    stopExpirationNotifications();
    closeSocketHandlers();
    apiRateStore.shutdown();
    strictRateStore.shutdown();
    store.close();
  });

  const dist = path.resolve(process.cwd(), 'dist');
  if (fs.existsSync(dist)) {
    app.use(express.static(dist));
    app.get(/^\/(?!api|socket.io).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));
  }

  return { app, http, io, store, operations };
}
