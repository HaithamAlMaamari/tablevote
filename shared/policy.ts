export const SESSION_POLICY = Object.freeze({
  ttlMs: 24 * 60 * 60 * 1000,
  participantsPerSession: 12,
  rerunsPerSession: 2,
  activeSessions: 10_000,
  terminalSessions: 10_000,
  sweepIntervalMs: 60 * 60 * 1000,
});

export const INPUT_POLICY = Object.freeze({
  areaLabelMaxLength: 80,
  nicknameMaxLength: 24,
  sessionReferenceMaxLength: 64,
  tokenMinLength: 8,
  tokenMaxLength: 64,
  radiusMinKm: 0.3,
  radiusMaxKm: 50,
  preferenceDistanceMinKm: 0.1,
  preferenceDistanceMaxKm: 50,
  payloadLimit: '64kb',
  socketPayloadBytes: 64 * 1024,
});

export const TRANSPORT_POLICY = Object.freeze({
  socketTimeoutMs: 5_000,
  requestTimeoutMs: 8_000,
  initialConnectionTimeoutMs: 1_800,
  mutationReplayTtlMs: 15 * 60 * 1000,
  maxMutationReplays: 20_000,
});

export const SESSION_TTL_MS = SESSION_POLICY.ttlMs;
