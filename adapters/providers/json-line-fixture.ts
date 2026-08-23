import {
  buildObservation,
  failedOutcome,
} from '../../core/providers/canonical.ts';
import type {
  CanonicalObservation,
  ExchangeOutcome,
  ExchangeRequest,
} from '../../core/providers/types.ts';

// A deliberately different wire protocol: JSON Lines (no SSE), different
// field vocabulary, no vendor reasoning split, server stats in a final frame.
// Proves the canonical observation is protocol-independent.

interface FixtureFrame {
  kind: 'piece' | 'final';
  text?: string;
  finish?: string;
  counted?: { in: number; out: number };
  server_stats?: { first_token_s?: number; tok_per_s?: number };
}

export async function runJsonLineFixtureExchange(
  request: ExchangeRequest & { profileId?: string },
): Promise<ExchangeOutcome> {
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), request.timeoutMs);

  try {
    const response = await fetch(`${request.baseUrl}/chat`, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: request.modelAlias, say: request.prompt, cap: request.maxOutputTokens }),
    });

    if (!response.ok) {
      return fail(request, started, {
        terminalReason: 'http-error',
        httpStatus: response.status,
        errorDetail: (await response.text()).slice(0, 256),
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
        if (line === '') continue;
        let frame: FixtureFrame;
        try {
          frame = JSON.parse(line) as FixtureFrame;
        } catch {
          return fail(request, started, {
            terminalReason: 'protocol-error',
            httpStatus: response.status,
            errorDetail: `unparseable ndjson near: ${line.slice(0, 60)}`,
          });
        }
        if (frame.kind === 'piece') text += frame.text ?? '';
        if (frame.kind === 'final') {
          finishReason = frame.finish ?? null;
          usage = {
            promptTokens: frame.counted?.in ?? 0,
            completionTokens: frame.counted?.out ?? 0,
            reasoningTokens: 0,
          };
          if (frame.server_stats !== undefined) {
            attributed = {
              sourceTag: 'provider-reported',
              ...(frame.server_stats.first_token_s !== undefined
                ? { ttftSeconds: frame.server_stats.first_token_s }
                : {}),
              ...(frame.server_stats.tok_per_s !== undefined
                ? { tokensPerSecond: frame.server_stats.tok_per_s }
                : {}),
            };
          }
        }
      }
    }

    clearTimeout(timer);
    return {
      observation: buildObservation(request, 'json-line-fixture', started, firstByteMs, usage, attributed, {
        terminalReason: 'completed',
        httpStatus: response.status,
      }),
      text,
      finishReason,
    };
  } catch (cause) {
    clearTimeout(timer);
    const timedOut =
      cause instanceof Error &&
      (cause.name === 'AbortError' || cause.name === 'TimeoutError');
    return fail(request, started, {
      terminalReason: timedOut ? 'timeout' : 'cancelled',
      httpStatus: null,
      errorDetail: String(cause).slice(0, 256),
    });
  }
}

const fail = (
  request: ExchangeRequest & { profileId?: string },
  started: number,
  partial: Parameters<typeof failedOutcome>[3],
): ExchangeOutcome => failedOutcome(request, 'json-line-fixture', started, partial);






