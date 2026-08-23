import type {
  CanonicalObservation,
  ExchangeOutcome,
  ExchangeRequest,
} from './types.ts';

export function buildObservation(
  request: ExchangeRequest & { profileId?: string },
  protocolAdapterKind: string,
  started: number,
  firstByteMs: number | undefined,
  usage: CanonicalObservation['usage'],
  attributed: CanonicalObservation['attributedProviderTiming'],
  partial: {
    terminalReason: CanonicalObservation['terminalReason'];
    httpStatus: number | null;
  },
): CanonicalObservation {
  return {
    profileId: request.profileId ?? 'ad-hoc',
    protocolAdapterKind,
    endpointHostDisplay: hostOf(request.baseUrl),
    modelAlias: request.modelAlias,
    terminalReason: partial.terminalReason,
    httpStatus: partial.httpStatus,
    usage,
    clientTiming: {
      totalMs: Date.now() - started,
      ...(firstByteMs !== undefined ? { firstByteMs } : {}),
    },
    ...(attributed !== undefined
      ? { attributedProviderTiming: attributed }
      : {}),
  };
}

export function failedOutcome(
  request: ExchangeRequest & { profileId?: string },
  protocolAdapterKind: string,
  started: number,
  partial: {
    terminalReason: CanonicalObservation['terminalReason'];
    httpStatus: number | null;
    errorDetail?: string | undefined;
  },
): ExchangeOutcome {
  return {
    observation: buildObservation(
      request,
      protocolAdapterKind,
      started,
      undefined,
      { promptTokens: 0, completionTokens: 0, reasoningTokens: 0 },
      undefined,
      partial,
    ),
    text: '',
    finishReason: null,
    ...(partial.errorDetail !== undefined
      ? { errorDetail: partial.errorDetail }
      : {}),
  };
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return 'unparseable-endpoint';
  }
}

