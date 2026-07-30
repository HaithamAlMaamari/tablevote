import { z } from 'zod';
import { ALGORITHM_VERSION, CUISINES, DIETARY_TYPES, SESSION_ERROR_CODES } from './types';
import { INPUT_POLICY } from './policy';

const normalizedNickname = z
  .string()
  .max(100)
  .transform((value) => value.normalize('NFKC'))
  .refine((value) => !/[\p{Cc}\p{Cf}]/u.test(value), { message: 'Control characters are not allowed' })
  .transform((value) => value.replace(/[<>"'&]/g, '').trim());

export const NicknameSchema = normalizedNickname.pipe(z.string().min(1).max(INPUT_POLICY.nicknameMaxLength));
export const OptionalNicknameSchema = normalizedNickname.pipe(z.string().max(INPUT_POLICY.nicknameMaxLength));
export const ColorSchema = z.number().int().min(0).max(3);
export const CuisineSchema = z.enum(CUISINES);
export const DietaryTypeSchema = z.enum(DIETARY_TYPES);
export const PrefsSchema = z
  .object({
    cuisines: z.partialRecord(CuisineSchema, z.enum(['like', 'neutral', 'dislike'])),
    budget: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
    maxDistanceKm: z
      .number()
      .min(INPUT_POLICY.preferenceDistanceMinKm)
      .max(INPUT_POLICY.preferenceDistanceMaxKm)
      .nullable(),
    dietary: z.array(z.object({ type: DietaryTypeSchema, strict: z.literal(true) })).max(DIETARY_TYPES.length),
  })
  .strict();

export const RequestIdSchema = z.string().uuid().optional();
const SessionReferenceSchema = z.string().max(INPUT_POLICY.sessionReferenceMaxLength);
const ParticipantTokenSchema = z.string().min(INPUT_POLICY.tokenMinLength).max(INPUT_POLICY.tokenMaxLength);

export const CreateSessionRequestSchema = z
  .object({
    areaLabel: z.string().trim().min(1).max(INPUT_POLICY.areaLabelMaxLength),
    center: z.object({
      lat: z.number().min(-90).max(90),
      lng: z.number().min(-180).max(180),
    }),
    radiusKm: z.number().min(INPUT_POLICY.radiusMinKm).max(INPUT_POLICY.radiusMaxKm),
    nickname: OptionalNicknameSchema.optional().default(''),
    color: ColorSchema.optional().default(0),
    allowReruns: z.boolean().optional().default(true),
    shareHostNickname: z.boolean().optional().default(false),
    requestId: RequestIdSchema,
  })
  .strict();

export const JoinSessionRequestSchema = z
  .object({
    sessionId: SessionReferenceSchema.optional(),
    code: z.string().trim().length(5).optional(),
    nickname: NicknameSchema,
    color: ColorSchema.optional().default(0),
    requestId: RequestIdSchema,
  })
  .strict()
  .refine((value) => value.sessionId || value.code, { message: 'sessionId or code required' });

export const SubmitPrefsRequestSchema = z
  .object({
    sessionId: SessionReferenceSchema.optional(),
    token: ParticipantTokenSchema,
    prefs: PrefsSchema,
    requestId: RequestIdSchema,
  })
  .strict();
export const ParticipantMutationRequestSchema = z
  .object({
    sessionId: SessionReferenceSchema.optional(),
    token: ParticipantTokenSchema,
    requestId: RequestIdSchema,
  })
  .strict();
export const HostMutationRequestSchema = z
  .object({
    hostToken: ParticipantTokenSchema,
    requestId: RequestIdSchema,
  })
  .strict();
export const RemoveParticipantRequestSchema = HostMutationRequestSchema.extend({
  participantId: SessionReferenceSchema.optional(),
}).strict();
export const AttachRequestSchema = z
  .object({
    sessionId: SessionReferenceSchema,
    token: ParticipantTokenSchema,
  })
  .strict();

export const ErrorResponseSchema = z.object({
  error: z.string(),
  errorCode: z.enum(SESSION_ERROR_CODES),
});
export const MutationSuccessSchema = z.object({ ok: z.literal(true) }).passthrough();

export const PhaseSchema = z.enum(['collecting', 'locking', 'revealed', 'blocked-no-match', 'ended', 'expired']);
export const ClientRestaurantSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    cuisines: z.array(CuisineSchema),
    priceTier: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
    rating: z.number(),
    distanceKm: z.number(),
  })
  .strict();
const ClientFinalistSchema = z
  .object({
    restaurant: ClientRestaurantSchema,
    groupFit: z.enum(['strong', 'good', 'compromise']),
  })
  .strict();
export const ClientResultSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('match'),
      algorithmVersion: z.literal(ALGORITHM_VERSION),
      winner: ClientFinalistSchema,
      top3: z
        .tuple([ClientFinalistSchema], ClientFinalistSchema)
        .refine((finalists) => finalists.length <= 3, { message: 'At most three finalists are supported' }),
      ownWinnerFit: z.number().min(0).max(1).nullable(),
      tiebreak: z.enum(['none', 'least-misery', 'copeland', 'canonical-id']),
      round: z.number().int().positive(),
      previousWinners: z.array(z.string()),
    })
    .strict()
    .refine((result) => JSON.stringify(result.winner) === JSON.stringify(result.top3[0]), {
      message: 'winner must match top3[0]',
      path: ['winner'],
    }),
  z
    .object({
      kind: z.literal('no-verified-match'),
      algorithmVersion: z.literal(ALGORITHM_VERSION),
      round: z.number().int().positive(),
      previousWinners: z.array(z.string()),
    })
    .strict(),
]);
export const SessionSnapshotSchema = z
  .object({
    id: z.string(),
    code: z.string(),
    phase: PhaseSchema,
    areaLabel: z.string(),
    expiresAt: z.number(),
    allowReruns: z.boolean(),
    rerunsUsed: z.number().int().nonnegative(),
    selfParticipantId: z.string(),
    ownPrefs: PrefsSchema.nullable(),
    participants: z.array(
      z
        .object({
          id: z.string(),
          nickname: z.string(),
          color: ColorSchema,
          submitted: z.boolean(),
          isHost: z.boolean(),
          online: z.boolean(),
        })
        .strict(),
    ),
    result: ClientResultSchema.nullable(),
  })
  .strict();
export const InviteSnapshotSchema = z
  .object({
    code: z.string(),
    areaLabel: z.string(),
    expiresAt: z.number(),
    joinable: z.boolean(),
    hostNickname: z.string().optional(),
  })
  .strict();
export const CreateSessionResponseSchema = z.object({
  sessionId: z.string(),
  code: z.string(),
  hostToken: z.string(),
  participantToken: z.string(),
  participantId: z.string(),
  state: SessionSnapshotSchema,
});
export const JoinSessionResponseSchema = z.object({
  participantToken: z.string(),
  participantId: z.string(),
  state: SessionSnapshotSchema,
});
export const StateResponseSchema = z.object({ state: SessionSnapshotSchema });
export const SubmitResponseSchema = z
  .object({
    ok: z.literal(true),
    state: SessionSnapshotSchema,
  })
  .strict();
export const InviteResponseSchema = z.object({ invite: InviteSnapshotSchema });

export type CreateSessionRequest = z.infer<typeof CreateSessionRequestSchema>;
export type JoinSessionRequest = z.infer<typeof JoinSessionRequestSchema>;
export type SubmitPrefsRequest = z.infer<typeof SubmitPrefsRequestSchema>;
export type ParticipantMutationRequest = z.infer<typeof ParticipantMutationRequestSchema>;
export type HostMutationRequest = z.infer<typeof HostMutationRequestSchema>;
export type RemoveParticipantRequest = z.infer<typeof RemoveParticipantRequestSchema>;
export type AttachRequest = z.infer<typeof AttachRequestSchema>;
export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;
export type CreateSessionResponse = z.infer<typeof CreateSessionResponseSchema>;
export type JoinSessionResponse = z.infer<typeof JoinSessionResponseSchema>;
export type StateResponse = z.infer<typeof StateResponseSchema>;
export type SubmitResponse = z.infer<typeof SubmitResponseSchema>;
export type InviteResponse = z.infer<typeof InviteResponseSchema>;
