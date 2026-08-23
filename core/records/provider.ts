import { z } from 'zod';
import { Iso8601, SecretRef, Slug, BoundedText } from './primitives.ts';

export const ProtocolAdapterKind = z.enum([
  'openai-compatible',
  'anthropic-compatible',
  'fixture',
]);
export type ProtocolAdapterKind = z.output<typeof ProtocolAdapterKind>;

export const EndpointDisplay = z
  .string()
  .max(200)
  .refine(
    (value) => {
      try {
        const url = new URL(value);
        const host = url.hostname.toLowerCase();
        const isLoopback = host === 'localhost' || host === '::1' || host === '[::1]' || host === '127.0.0.1';
        return (
          (url.protocol === 'https:' || url.protocol === 'http:') &&
          url.username === '' &&
          url.password === '' &&
          (isLoopback ||
            !/^\d{1,3}(\.\d{1,3}){3}$/u.test(host))
        );
      } catch {
        return false;
      }
    },
    {
      message:
        'endpoint display must be an http(s) URL without embedded credentials; non-loopback raw IPs are rejected as unstable endpoint identities — use a hostname',
    },
  );

export const TransportPolicy = z.strictObject({
  connectTimeoutMs: z.number().int().min(100).max(120_000),
  requestTimeoutMs: z.number().int().min(1_000).max(3_600_000),
});

export const ProviderProfile = z.strictObject({
  profileId: Slug,
  protocolAdapterKind: ProtocolAdapterKind,
  endpointDisplay: EndpointDisplay,
  servedModelAlias: Slug,
  capabilityObservations: z.array(BoundedText(64)).max(32),
  secretRefs: z.array(SecretRef).max(16),
  transportPolicy: TransportPolicy,
});
export type ProviderProfile = z.output<typeof ProviderProfile>;

export const ServedModelObservation = z.strictObject({
  providerProfileId: Slug,
  providerReportedId: BoundedText(128),
  contextWindowTokens: z.number().int().min(512).max(100_000_000).optional(),
  capabilitiesObserved: z.array(Slug).max(32),
  observedAt: Iso8601,
  source: z.enum(['provider-api', 'operator-declared']),
});
export type ServedModelObservation = z.output<typeof ServedModelObservation>;
