import { z } from 'zod';
import {
  Command,
  Hex64,
  RelativePath,
  Slug,
  Version,
} from './primitives.ts';

export const RetentionClass = z.enum([
  'ephemeral',
  'retained_local',
  'exportable_sanitized',
  'public_fixture',
]);
export type RetentionClass = z.output<typeof RetentionClass>;

export const WorkspacePolicy = z.strictObject({
  allowedCommands: z.array(Command).max(32),
  networkAccess: z.boolean(),
  maxFilesTouched: z.number().int().min(1).max(10_000),
});
export type WorkspacePolicy = z.output<typeof WorkspacePolicy>;

export const TaskSuite = z.strictObject({
  suiteId: Slug,
  revision: Version,
  fixtureDigests: z.record(RelativePath, Hex64),
  evaluatorIds: z.array(Slug).max(32),
  requiredCapabilities: z.array(Slug).max(32),
  retention: RetentionClass,
  workspacePolicy: WorkspacePolicy,
  limits: z.strictObject({
    perTrialWallMs: z.number().int().min(1_000).max(3_600_000),
    maxConcurrentTrials: z.number().int().min(1).max(64),
  }),
});
export type TaskSuite = z.output<typeof TaskSuite>;

