import type { TerminalReason } from '../records/exchange.ts';
import type { ProviderProfile } from '../records/provider.ts';

export interface CanonicalObservation {
  profileId: string;
  protocolAdapterKind: string;
  endpointHostDisplay: string;
  modelAlias: string;
  terminalReason: TerminalReason;
  httpStatus: number | null;
  usage: {
    promptTokens: number;
    completionTokens: number;
    reasoningTokens: number;
  };
  clientTiming: {
    totalMs: number;
    firstByteMs?: number | undefined;
  };
  attributedProviderTiming?:
    | {
        sourceTag: 'provider-reported';
        ttftSeconds?: number | undefined;
        tokensPerSecond?: number | undefined;
      }
    | undefined;
}

export type { TerminalReason };

export interface ExchangeRequest {
  baseUrl: string;
  modelAlias: string;
  prompt: string;
  maxOutputTokens: number;
  timeoutMs: number;
  /** Declared store addresses only. Values stay process-local. */
  secretRefs?: readonly string[];
  /**
   * Resolves a declared reference at the last responsible moment.
   * Missing or empty results fail closed before any outbound request.
   */
  resolveSecret?: ((reference: string) => string | undefined) | undefined;
}

export interface ExchangeOutcome {
  observation: CanonicalObservation;
  text: string;
  finishReason: string | null;
  errorDetail?: string | undefined;
}


