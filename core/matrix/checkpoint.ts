import { z } from 'zod';
import { BoundedText, Hex64, RelativePath } from '../records/primitives.ts';

export const unitStates = [
  'pending',
  'running',
  'done',
  'schedule-failed',
] as const;
export type UnitState = (typeof unitStates)[number];

export const CheckpointUnit = z
  .strictObject({
    state: z.enum(unitStates),
    artifactPath: RelativePath.optional(),
    artifactDigest: Hex64.optional(),
    reasonClass: BoundedText(64).optional(),
    detail: BoundedText(256).optional(),
  })
  .superRefine((entry, ctx) => {
    if (entry.state === 'done' && entry.artifactDigest === undefined) {
      ctx.addIssue({
        code: 'custom',
        message: 'done claims must carry the digest of their backing artifact',
      });
    }
    if (
      entry.state === 'schedule-failed' &&
      entry.reasonClass === undefined
    ) {
      ctx.addIssue({
        code: 'custom',
        message: 'schedule-failed claims must carry a reason class',
      });
    }
  });

export type CheckpointUnit = z.output<typeof CheckpointUnit>;

export const MatrixCheckpoint = z.strictObject({
  checkpointVersion: z.literal(1),
  matrixDigest: Hex64,
  units: z.record(z.string(), CheckpointUnit),
});

export type CheckpointDoc = z.output<typeof MatrixCheckpoint>;

export function serializeCheckpoint(doc: CheckpointDoc): string {
  return JSON.stringify(doc);
}
