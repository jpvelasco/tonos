import {
  buildObservation,
  failedOutcome,
} from '../../core/providers/canonical.ts';
import {
  failClosedIfUnresolved,
  redactSecrets,
} from './credentials.ts';
import {
  armExchangeTimeout,
  attemptSignal,
  connectWithOneRetry,
  describeTransportCause,
  isTimeoutCause,
} from './transport.ts';
import type {
  CanonicalObservation,
  ExchangeOutcome,
  ExchangeRequest,
} from '../../core/providers/types.ts';

interface AnthropicEvent {
  type?: string;
  delta?: { type?: string; text?: string; stop_reason?: string };
  usage?: { input_tokens?: number; output_tokens?: number };
}

function messagesPayload(request: ExchangeRequest): string {
  return JSON.stringify({
    model: request.modelAlias,
    max_tokens: request.maxOutputTokens,
    stream: true,
    messages: [{ role: 'user', content: request.prompt }],
  });
}

export async function runAnthropicCompatibleExchange(
  request: ExchangeRequest & { profileId?: string },
): Promise<ExchangeOutcome> {
  const started = Date.now();
  const prepared = failClosedIfUnresolved(request, 'anthropic-compatible', started);
  if (!prepared.ok) return prepared.outcome;
  const secrets = prepared.secrets;

  const controller = new AbortController();
  const releaseTimeout = armExchangeTimeout(() => controller.abort(), request.timeoutMs);
  const url = `${request.baseUrl}/messages`;
  const token = secrets[0];
  const init = () => ({
    method: 'POST' as const,
    signal: attemptSignal(controller.signal, request.timeoutMs),
    headers: {
      'content-type': 'application/json',
      'anthropic-version': '2023-06-01',
      ...(token === undefined ? {} : { 'x-api-key': token }),
    },
    body: messagesPayload(request),
  });

  let responseStatus: number | null = null;
  try {
    const connected = await connectWithOneRetry(url, init);
    if (connected.response === undefined) {
      const cause = connected.cause;
      return fail(request, started, secrets, {
        terminalReason: isTimeoutCause(cause) ? 'timeout' : 'cancelled',
        httpStatus: null,
        errorDetail: describeTransportCause(cause),
      });
    }
    const response = connected.response;
    if (!response.ok) {
      return fail(request, started, secrets, {
        terminalReason: 'http-error',
        httpStatus: response.status,
        errorDetail: (await response.text()).slice(0, 256),
      });
    }
    responseStatus = response.status;

    let text = '';
    let finishReason: string | null = null;
    let firstByteMs: number | undefined;
    let usage = { promptTokens: 0, completionTokens: 0, reasoningTokens: 0 };

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
        let event: AnthropicEvent;
        try {
          event = JSON.parse(payload) as AnthropicEvent;
        } catch {
          return fail(request, started, secrets, {
            terminalReason: 'protocol-error',
            httpStatus: response.status,
            errorDetail: `unparseable Anthropic payload near: ${payload.slice(0, 60)}`,
          });
        }
        if (event.delta?.type === 'text_delta') text += event.delta.text ?? '';
        if (event.delta?.stop_reason) finishReason = event.delta.stop_reason;
        if (event.usage) {
          usage = {
            promptTokens: event.usage.input_tokens ?? 0,
            completionTokens: event.usage.output_tokens ?? 0,
            reasoningTokens: 0,
          };
        }
      }
    }

    if (finishReason === null) {
      return fail(request, started, secrets, {
        terminalReason: 'disconnected',
        httpStatus: response.status,
        errorDetail: 'stream ended before stop_reason arrived',
      });
    }

    return {
      observation: buildObservation(
        request,
        'anthropic-compatible',
        started,
        firstByteMs,
        usage,
        undefined,
        { terminalReason: 'completed', httpStatus: response.status },
      ),
      text,
      finishReason,
    };
  } catch (cause) {
    if (responseStatus !== null && !isTimeoutCause(cause)) {
      return fail(request, started, secrets, {
        terminalReason: 'disconnected',
        httpStatus: responseStatus,
        errorDetail: describeTransportCause(cause),
      });
    }
    return fail(request, started, secrets, {
      terminalReason: isTimeoutCause(cause) ? 'timeout' : 'cancelled',
      httpStatus: responseStatus,
      errorDetail: describeTransportCause(cause),
    });
  } finally {
    releaseTimeout();
  }
}

function fail(
  request: ExchangeRequest & { profileId?: string },
  started: number,
  secrets: readonly string[],
  partial: {
    terminalReason: CanonicalObservation['terminalReason'];
    httpStatus: number | null;
    errorDetail?: string | undefined;
  },
): ExchangeOutcome {
  return failedOutcome(request, 'anthropic-compatible', started, {
    terminalReason: partial.terminalReason,
    httpStatus: partial.httpStatus,
    ...(partial.errorDetail !== undefined
      ? { errorDetail: redactSecrets(partial.errorDetail, secrets) }
      : {}),
  });
}
