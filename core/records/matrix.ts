import { z } from 'zod';
import { Iso8601, Slug, Version, BoundedText } from './primitives.ts';
import {
  TrialDeclarationPayload,
  TrialId,
} from './trial.ts';

export const MatrixAxis = z.enum([
  'harness',
  'configuration',
  'provider',
  'served-model',
  'task-suite',
]);
export type MatrixAxis = z.output<typeof MatrixAxis>;

export const TrialMatrix = z.strictObject({
  matrixId: Slug,
  policyRevision: Version,
  axes: z
    .array(
      z.strictObject({
        axis: MatrixAxis,
        variants: z.number().int().min(1).max(64),
      }),
    )
    .max(16),
  declarations: z.array(TrialDeclarationPayload).max(1_024),
  createdAt: Iso8601,
});
export type TrialMatrix = z.output<typeof TrialMatrix>;

export const QualificationDecision = z.strictObject({
  matrixId: Slug,
  policyRevision: Version,
  gates: z
    .array(
      z.strictObject({ gateId: Slug, passed: z.boolean() }),
    )
    .max(64),
  comparableTrialCount: z.number().int().min(0),
  exclusions: z
    .array(
      z.strictObject({
        declarationId: TrialId,
        reasonClass: BoundedText(64),
      }),
    )
    .max(4_096),
  winnerDeclarationId: TrialId.nullable(),
  tradeoffsAndLimitations: BoundedText(2_048),
  decidedAt: Iso8601,
});
export type QualificationDecision = z.output<typeof QualificationDecision>;

