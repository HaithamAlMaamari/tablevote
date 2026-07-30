export interface ServerQuotaLimits {
  windowMs: number;
  apiRequests: number;
  globalCreateJoin: number;
  globalOperations: number;
  sessionJoin: number;
  sessionOperations: number;
  socketCreateJoin: number;
  socketOperations: number;
  trackedSocketAddresses: number;
  socketConnections: number;
  socketConnectionsPerAddress: number;
  socketHandshakesPerAddress: number;
  unauthenticatedSocketTimeoutMs: number;
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
  socketConnections: 10_000,
  socketConnectionsPerAddress: 20,
  socketHandshakesPerAddress: 60,
  unauthenticatedSocketTimeoutMs: 30_000,
});
