import { z } from 'zod';
import { Hex64, Slug, Version, BoundedText } from './primitives.ts';

export const AdapterKind = z.enum([
  'codex',
  'grok-cli',
  'zero',
  'openclaude',
  'fixture',
]);
export type AdapterKind = z.output<typeof AdapterKind>;

export const HarnessIdentity = z.strictObject({
  harnessId: Slug,
  adapterKind: AdapterKind,
  version: Version,
  adapterContractVersion: z.number().int().min(1).max(127),
  capabilities: z.array(Slug).max(32),
});
export type HarnessIdentity = z.output<typeof HarnessIdentity>;

export const RetryPolicy = z.strictObject({
  maxAttempts: z.number().int().min(1).max(10),
  backoffMs: z.number().int().min(0).max(60_000),
});

export const HarnessConfiguration = z.strictObject({
  requestedModelAlias: Slug,
  reasoningEffort: z.enum(['auto', 'none', 'low', 'medium', 'high']).optional(),
  toolsEnabled: z.boolean(),
  contextLengthTokens: z.number().int().min(1024).max(10_000_000).optional(),
  maxOutputTokens: z.number().int().min(16).max(1_000_000).optional(),
  timeoutMs: z.number().int().min(1_000).max(3_600_000),
  retryPolicy: RetryPolicy,
  promptTemplateDigest: Hex64.optional(),
  effectiveBehavior: z
    .strictObject({
      modelReportedByHarness: BoundedText(128).optional(),
      notes: z.array(BoundedText(256)).max(16),
    })
    .optional(),
  declaredUnknowns: z.array(BoundedText(128)).max(16),
});
export type HarnessConfiguration = z.output<typeof HarnessConfiguration>;
