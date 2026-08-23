import { z } from 'zod';
import { contentId } from '../canonical.ts';
import { Hex16, Hex64, Iso8601, RelativePath, Slug, BoundedText } from './primitives.ts';
import {
  HarnessConfiguration,
  HarnessIdentity,
} from './harness.ts';
import {
  ProviderProfile,
  ServedModelObservation,
} from './provider.ts';
import { TaskSuite } from './task.ts';

export const terminalStates = [
  'passed',
  'failed',
  'timed-out',
  'cancelled',
  'unsupported',
  'invalid',
] as const;
export const TerminalState = z.enum(terminalStates);
export type TerminalState = z.output<typeof TerminalState>;

export const TrialId = z
  .string()
  .regex(/^trn_trial_[0-9a-f]{64}$/u, 'content-derived trial id');
export type TrialId = z.output<typeof TrialId>;

export const Repetition = z.strictObject({
  index: z.number().int().min(0).max(9_999),
  total: z.number().int().min(1).max(10_000),
});

export const EnvironmentClass = z.enum([
  'local-machine',
  'lan-host',
  'remote-service',
]);

const DeclarationLimits = z.strictObject({
  wallMs: z.number().int().min(1_000).max(3_600_000),
  cancelGraceMs: z.number().int().min(50).max(60_000),
});

export const TrialDeclarationPayload = z.strictObject({
  harness: HarnessIdentity,
  configuration: HarnessConfiguration,
  provider: ProviderProfile,
  servedModel: ServedModelObservation,
  taskSuite: TaskSuite,
  repetition: Repetition,
  environmentClass: EnvironmentClass,
  limits: DeclarationLimits,
  randomizationSeed: Hex16.optional(),
  declaredAt: Iso8601.optional(),
  correlationValue: BoundedText(128).optional(),
});
export type TrialDeclarationPayload = z.output<typeof TrialDeclarationPayload>;

export function trialIdOf(declaration: TrialDeclarationPayload): string {
  const { observedAt: _ignored, ...servedModelIdentity } =
    declaration.servedModel;
  return contentId('trn_trial_', {
    harness: declaration.harness,
    configuration: declaration.configuration,
    provider: declaration.provider,
    servedModel: servedModelIdentity,
    taskSuite: declaration.taskSuite,
    repetition: declaration.repetition,
    environmentClass: declaration.environmentClass,
    limits: declaration.limits,
    randomizationSeed: declaration.randomizationSeed,
  });
}

export const TrialDeclaration = TrialDeclarationPayload.transform(
  (payload) => ({
    ...payload,
    trialId: trialIdOf(payload),
  }),
).refine(
  (withId) => withId.trialId === trialIdOf(withId),
  { message: 'trialId does not match the declaration content' },
);
export type TrialDeclaration = z.output<typeof TrialDeclaration>;

export const ErrorClass = z.enum([
  'harness-crash',
  'timeout',
  'parse',
  'provider-error',
  'verification-failed',
  'unknown',
]);
export type ErrorClass = z.output<typeof ErrorClass>;

export const TrialResult = z.strictObject({
  declarationId: TrialId,
  observedHarnessVersion: BoundedText(64),
  observedProviderProfileId: Slug,
  observedServedModelId: BoundedText(128),
  terminalState: TerminalState,
  startedAt: Iso8601,
  finishedAt: Iso8601,
  phaseDurationsMs: z.record(Slug, z.number().int().min(0)),
  clientTiming: z.strictObject({
    totalWallMs: z.number().int().min(0),
    ttftMs: z.number().int().min(0).optional(),
  }),
  attributedProviderTiming: z
    .strictObject({
      sourceTag: z.literal('provider-reported'),
      ttftSeconds: z.number().min(0).optional(),
      tokensPerSecond: z.number().min(0).optional(),
    })
    .optional(),
  toolEvents: z
    .array(
      z.strictObject({
        seq: z.number().int().min(0),
        toolName: Slug,
        ok: z.boolean(),
      }),
    )
    .max(4_096),
  workspaceAfterDigest: Hex64.nullable(),
  diffSummary: z
    .strictObject({
      filesChanged: z.number().int().min(0),
      insertions: z.number().int().min(0),
      deletions: z.number().int().min(0),
    })
    .optional(),
  evaluatorOutcomes: z
    .array(
      z.strictObject({
        evaluatorId: Slug,
        passed: z.boolean(),
        subjective: z.boolean(),
      }),
    )
    .max(256),
  verificationExit: z.number().int().nullable(),
  errors: z
    .array(
      z.strictObject({
        errorClass: ErrorClass,
        message: BoundedText(256),
      }),
    )
    .max(64),
  missingEvidence: z.array(BoundedText(128)).max(32),
  redactionReport: z.strictObject({
    removedCategories: z.array(BoundedText(64)).max(32),
  }),
  artifactDigests: z.record(RelativePath, Hex64),
});
export type TrialResult = z.output<typeof TrialResult>;

