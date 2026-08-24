import { z } from 'zod';
import { Slug, BoundedText } from './primitives.ts';

export const TerminalReason = z.enum([
  'completed',
  'cancelled',
  'timeout',
  'http-error',
  'protocol-error',
  /** The provider began answering but its stream died before completion. */
  'disconnected',
]);
export type TerminalReason = z.output<typeof TerminalReason>;

export const ProviderExchangeObservation = z.strictObject({
  profileId: Slug,
  protocolAdapterKind: BoundedText(32),
  endpointHostDisplay: BoundedText(200),
  modelAlias: Slug,
  terminalReason: TerminalReason,
  httpStatus: z.number().int().min(100).max(599).nullable(),
  usage: z.strictObject({
    promptTokens: z.number().int().min(0),
    completionTokens: z.number().int().min(0),
    reasoningTokens: z.number().int().min(0),
  }),
  clientTiming: z.strictObject({
    totalMs: z.number().int().min(0),
    firstByteMs: z.number().int().min(0).optional(),
  }),
  attributedProviderTiming: z
    .strictObject({
      sourceTag: z.literal('provider-reported'),
      ttftSeconds: z.number().min(0).optional(),
      tokensPerSecond: z.number().min(0).optional(),
    })
    .optional(),
});
export type ProviderExchangeObservationRecord = z.output<
  typeof ProviderExchangeObservation
>;
