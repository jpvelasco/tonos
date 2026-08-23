import {
  buildObservation,
  failedOutcome,
} from '../../core/providers/canonical.ts';
import { connectWithOneRetry, isTimeoutCause } from './transport.ts';
import type {
  CanonicalObservation,
  ExchangeOutcome,
  ExchangeRequest,
} from '../../core/providers/types.ts';

interface OpenAiChunk {
  choices?: Array<{
    delta?: { content?: string };
    finish_reason?: string | null;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    completion_tokens_details?: { reasoning_tokens?: number };
  };
  provider_timing?: {
    ttft_seconds?: number;
    tokens_per_second?: number;
  };
}

function ssePayload(request: ExchangeRequest): string {
  return JSON.stringify({
    model: request.modelAlias,
    messages: [{ role: 'user', content: request.prompt }],
    max_tokens: request.maxOutputTokens,
    stream: true,
    stream_options: { include_usage: true },
  });
}

export async function runOpenAiCompatibleExchange(
  request: ExchangeRequest & { profileId?: string },
): Promise<ExchangeOutcome> {
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), request.timeoutMs);
  const url = `${request.baseUrl}/chat/completions`;
  const init = (signal: AbortSignal) => ({
    method: 'POST' as const,
    signal,
    headers: { 'content-type': 'application/json' },
    body: ssePayload(request),
  });

  try {
    const connected = await connectWithOneRetry(url, init(controller.signal));
    if (connected.response === undefined) {
      clearTimeout(timer);
      const cause = connected.cause;
      return fail(request, started, {
        terminalReason: isTimeoutCause(cause) ? 'timeout' : 'cancelled',
        httpStatus: null,
        errorDetail: String(cause).slice(0, 256),
      });
    }
    const response = connected.response;

    if (!response.ok) {
      const bodyText = (await response.text()).slice(0, 256);
      clearTimeout(timer);
      return fail(request, started, {
        terminalReason: 'http-error',
        httpStatus: response.status,
        errorDetail: bodyText,
      });
    }

    let text = '';
    let finishReason: string | null = null;
    let firstByteMs: number | undefined;
    let usage = { promptTokens: 0, completionTokens: 0, reasoningTokens: 0 };
    let attributed: CanonicalObservation['attributedProviderTiming'];

    const reader = response.body!.pipeThrough(new TextDecoderStream()).getReader();
    let buffered = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      firstByteMs ??= Date.now() - started;
      buffered += value;
      let newlineIndex: number;
      while ((newlineIndex = buffered.indexOf('\n')) >= 0) {
        const line = buffered.slice(0, newlineIndex).trim();
        buffered = buffered.slice(newlineIndex + 1);
        if (!line.startsWith('data: ')) continue;
        const payload = line.slice('data: '.length);
        if (payload === '[DONE]') continue;
        let chunk: OpenAiChunk;
        try {
          chunk = JSON.parse(payload) as OpenAiChunk;
        } catch {
          clearTimeout(timer);
          return fail(request, started, {
            terminalReason: 'protocol-error',
            httpStatus: response.status,
            errorDetail: `unparseable SSE payload near: ${payload.slice(0, 60)}`,
          });
        }
        text += chunk.choices?.[0]?.delta?.content ?? '';
        if (chunk.choices?.[0]?.finish_reason) {
          finishReason = chunk.choices[0].finish_reason;
        }
        if (chunk.usage) {
          usage = {
            promptTokens: chunk.usage.prompt_tokens ?? 0,
            completionTokens: chunk.usage.completion_tokens ?? 0,
            reasoningTokens:
              chunk.usage.completion_tokens_details?.reasoning_tokens ?? 0,
          };
        }
        if (chunk.provider_timing) {
          attributed = {
            sourceTag: 'provider-reported',
            ...(chunk.provider_timing.ttft_seconds !== undefined
              ? { ttftSeconds: chunk.provider_timing.ttft_seconds }
              : {}),
            ...(chunk.provider_timing.tokens_per_second !== undefined
              ? { tokensPerSecond: chunk.provider_timing.tokens_per_second }
              : {}),
          };
        }
      }
    }

    clearTimeout(timer);
    return {
      observation: buildObservation(
        request,
        'openai-compatible',
        started,
        firstByteMs,
        usage,
        attributed,
        { terminalReason: 'completed', httpStatus: response.status },
      ),
      text,
      finishReason,
    };
  } catch (cause) {
    clearTimeout(timer);
    return fail(request, started, {
      terminalReason: isTimeoutCause(cause) ? 'timeout' : 'cancelled',
      httpStatus: null,
      errorDetail: String(cause).slice(0, 256),
    });
  }
}

function fail(
  request: ExchangeRequest & { profileId?: string },
  started: number,
  partial: {
    terminalReason: CanonicalObservation['terminalReason'];
    httpStatus: number | null;
    errorDetail?: string | undefined;
  },
): ExchangeOutcome {
  return failedOutcome(request, 'openai-compatible', started, partial);
}
