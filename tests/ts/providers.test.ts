import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { once } from 'node:events';

import { encode, decode, type RecordKind } from '../../core/codec.ts';
import { runOpenAiCompatibleExchange } from '../../adapters/providers/openai-compatible.ts';
import { runAnthropicCompatibleExchange } from '../../adapters/providers/anthropic-compatible.ts';
import { runJsonLineFixtureExchange } from '../../adapters/providers/json-line-fixture.ts';
import { armExchangeTimeout, connectWithOneRetry } from '../../adapters/providers/transport.ts';
import type { ExchangeOutcome } from '../../core/providers/types.ts';

const CANARY = 'tonos-provider-canary';

async function listen(server: Server): Promise<string> {
  // Windows dynamic port ranges can deal ports the fetch spec forbids
  // ("bad port" refusals that no transport retry can overcome, because the
  // rejection is tied to the origin itself). Probe every freshly bound
  // origin with a real fetch and rebind until it is actually fetchable.
  for (let attempt = 0; ; attempt++) {
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const addr = server.address();
    if (addr === null || typeof addr !== 'object') {
      throw new Error('no address');
    }
    const url = `http://127.0.0.1:${addr.port}`;
    if (attempt >= 8) return url;
    // A forbidden port refuses instantly; a slow or deliberately silent
    // fixture must not stall suite execution on this probe.
    const refusal = await fetch(`${url}/`, { method: 'HEAD', signal: AbortSignal.timeout(500) }).then(
      () => undefined,
      (cause: unknown) => cause,
    );
    let message = '';
    if (refusal instanceof Error) {
      const nested = refusal.cause as { message?: string } | undefined;
      message = nested?.message ?? refusal.message;
    }
    if (message !== 'bad port') return url;
    server.close();
  }
}

interface FixtureServer {
  server: Server;
  hits: string[];
  /** When armed, the next incoming connection is destroyed pre-response. */
  armReset(): void;
}

function sseServer(): FixtureServer {
  const hits: string[] = [];
  let resetArmed = false;
  const server = createServer((req, res) => {
    hits.push(`${req.method} ${req.url}`);
    if (resetArmed) {
      resetArmed = false;
      res.socket?.destroy();
      return;
    }
    if (req.url === '/v1/chat/completions') {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write(
        `data: ${JSON.stringify({ choices: [{ delta: { content: 'Hel' } }] })}\n\n`,
      );
      res.write(
        `data: ${JSON.stringify({ choices: [{ delta: { content: 'lo' }, finish_reason: 'stop' }] })}\n\n`,
      );
      res.write(
        `data: ${JSON.stringify({
          choices: [],
          usage: { prompt_tokens: 12, completion_tokens: 5, completion_tokens_details: { reasoning_tokens: 2 } },
          provider_timing: { ttft_seconds: 0.05, tokens_per_second: 30 },
        })}\n\n`,
      );
      res.write('data: [DONE]\n\n');
      res.end();
      return;
    }
    res.writeHead(404);
    res.end();
  });
  return { server, hits, armReset: () => { resetArmed = true; } };
}

function anthropicServer(): FixtureServer {
  const hits: string[] = [];
  let resetArmed = false;
  const server = createServer((req, res) => {
    hits.push(`${req.method} ${req.url}`);
    if (resetArmed) {
      resetArmed = false;
      res.socket?.destroy();
      return;
    }
    if (req.url === '/v1/messages') {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write(
        `event: content_block_delta\ndata: ${JSON.stringify({ type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hel' } })}\n\n`,
      );
      res.write(
        `event: content_block_delta\ndata: ${JSON.stringify({ type: 'content_block_delta', delta: { type: 'text_delta', text: 'lo' } })}\n\n`,
      );
      res.write(
        `event: message_delta\ndata: ${JSON.stringify({ type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { input_tokens: 12, output_tokens: 5 } })}\n\n`,
      );
      res.write('event: message_stop\ndata: {"type":"message_stop"}\n\n');
      res.end();
      return;
    }
    res.writeHead(404);
    res.end();
  });
  return { server, hits, armReset: () => { resetArmed = true; } };
}

function jsonLineServer(): FixtureServer {
  const hits: string[] = [];
  let resetArmed = false;
  const server = createServer((req, res) => {
    hits.push(`${req.method} ${req.url}`);
    if (resetArmed) {
      resetArmed = false;
      res.socket?.destroy();
      return;
    }
    if (req.url === '/chat') {
      res.writeHead(200, { 'content-type': 'application/x-ndjson' });
      res.write(JSON.stringify({ kind: 'piece', text: 'Hel' }) + '\n');
      res.write(JSON.stringify({ kind: 'piece', text: 'lo' }) + '\n');
      res.write(
        JSON.stringify({
          kind: 'final',
          finish: 'stop',
          counted: { in: 12, out: 5 },
          server_stats: { first_token_s: 0.05, tok_per_s: 30 },
        }) + '\n',
      );
      res.end();
      return;
    }
      res.writeHead(404);
      res.end();
    });
  return { server, hits, armReset: () => { resetArmed = true; } };
}

test('openai-compatible and anthropic-compatible fixtures map the same logical exchange to equivalent canonical observations', async () => {
  const sse = sseServer();
  const anthropic = anthropicServer();
  const sseUrl = await listen(sse.server);
  const anthropicUrl = await listen(anthropic.server);
  const [viaSse, viaAnthropic] = await Promise.all([
    runOpenAiCompatibleExchange({
      baseUrl: `${sseUrl}/v1`,
      modelAlias: 'test-model',
      prompt: `say hi ${CANARY}`,
      maxOutputTokens: 32,
      timeoutMs: 5_000,
    }),
    runAnthropicCompatibleExchange({
      baseUrl: `${anthropicUrl}/v1`,
      modelAlias: 'test-model',
      prompt: `say hi ${CANARY}`,
      maxOutputTokens: 32,
      timeoutMs: 5_000,
    }),
  ]);
  for (const server of [sse.server, anthropic.server]) server.close();
  assert.equal(viaSse.text, 'Hello');
  assert.equal(viaAnthropic.text, 'Hello');
  assert.equal(viaAnthropic.finishReason, 'end_turn');
  assert.equal(viaSse.observation.usage.promptTokens, viaAnthropic.observation.usage.promptTokens);
  assert.equal(
    viaSse.observation.usage.completionTokens,
    viaAnthropic.observation.usage.completionTokens,
  );
  assert.equal(viaAnthropic.observation.protocolAdapterKind, 'anthropic-compatible');
  assert.ok(!('ttftSeconds' in viaAnthropic.observation.clientTiming));
});

test('openai-compatible and json-line fixtures map the same logical exchange to equivalent canonical observations', async () => {
  const sse = sseServer();
  const jsonl = jsonLineServer();
  const sseUrl = await listen(sse.server);
  const jsonlUrl = await listen(jsonl.server);

  const [viaSse, viaJsonl] = await Promise.all([
    runOpenAiCompatibleExchange({
      baseUrl: `${sseUrl}/v1`,
      modelAlias: 'test-model',
      prompt: `say hi ${CANARY}`,
      maxOutputTokens: 32,
      timeoutMs: 5_000,
    }),
    runJsonLineFixtureExchange({
      baseUrl: jsonlUrl,
      modelAlias: 'test-model',
      prompt: `say hi ${CANARY}`,
      maxOutputTokens: 32,
      timeoutMs: 5_000,
    }),
  ]);

  for (const server of [sse.server, jsonl.server]) server.close();

  // Both protocols observed the same logical conversation result.
  assert.equal(viaSse.text, 'Hello');
  assert.equal(viaJsonl.text, 'Hello');
  assert.equal(viaSse.finishReason, 'stop');
  assert.equal(viaJsonl.finishReason, 'stop');

  const canonicalSse = viaSse.observation;
  const canonicalJsonl = viaJsonl.observation;

  // Attributed usage agrees despite different wire field names.
  assert.equal(canonicalSse.usage.promptTokens, canonicalJsonl.usage.promptTokens);
  assert.equal(canonicalSse.usage.completionTokens, canonicalJsonl.usage.completionTokens);

  // Client timing lives in its own namespace on both.
  assert.equal(typeof canonicalSse.clientTiming.totalMs, 'number');
  assert.equal(typeof canonicalJsonl.clientTiming.totalMs, 'number');

  // Provider-reported timing is attributed, never merged into client timing.
  assert.equal(canonicalSse.attributedProviderTiming?.sourceTag, 'provider-reported');
  assert.equal(canonicalJsonl.attributedProviderTiming?.sourceTag, 'provider-reported');
  assert.ok(!('ttftSeconds' in canonicalSse.clientTiming));
});

test('observations are versioned canonical documents that survive the codec', async () => {
  const sse = sseServer();
  const url = await listen(sse.server);
  const outcome = await runOpenAiCompatibleExchange({
    baseUrl: `${url}/v1`,
    modelAlias: 'test-model',
    prompt: 'hi',
    maxOutputTokens: 8,
    timeoutMs: 5_000,
  });
  await new Promise<void>((resolve) => sse.server.close(() => resolve()));

  const encoded = encode('providerExchangeObservation', outcome.observation);
  const decoded = decode<{ terminalReason: string }>('providerExchangeObservation', encoded);
  assert.equal(decoded.terminalReason, 'completed');
});

test('armExchangeTimeout releases the timer exactly once', () => {
  const cancelled: unknown[] = [];
  const handle = { id: 1 };
  const release = armExchangeTimeout(
    () => {
      throw new Error('armed timeout must not fire after release');
    },
    30_000,
    () => handle,
    (timer) => {
      cancelled.push(timer);
    },
  );
  release();
  release();
  assert.deepEqual(cancelled, [handle]);
});

test('json-line http-error and protocol-error paths still produce honest outcomes', async () => {
  const http = createServer((_req, res) => {
    res.writeHead(503, { 'content-type': 'text/plain' });
    res.end('overloaded');
  });
  const httpUrl = await listen(http);
  const httpOutcome = await runJsonLineFixtureExchange({
    baseUrl: httpUrl,
    modelAlias: 'test-model',
    prompt: 'hi',
    maxOutputTokens: 8,
    timeoutMs: 5_000,
  });
  await new Promise<void>((resolve) => http.close(() => resolve()));
  assert.equal(httpOutcome.observation.terminalReason, 'http-error');
  assert.equal(httpOutcome.observation.httpStatus, 503);

  const proto = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/x-ndjson' });
    res.end('not-json\n');
  });
  const protoUrl = await listen(proto);
  const protoOutcome = await runJsonLineFixtureExchange({
    baseUrl: protoUrl,
    modelAlias: 'test-model',
    prompt: 'hi',
    maxOutputTokens: 8,
    timeoutMs: 5_000,
  });
  await new Promise<void>((resolve) => proto.close(() => resolve()));
  assert.equal(protoOutcome.observation.terminalReason, 'protocol-error');
  assert.equal(protoOutcome.observation.httpStatus, 200);
});

test('http errors become http-error outcomes with bounded status evidence', async () => {
  const server = createServer((_req, res) => {
    res.writeHead(503, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: { message: 'overloaded'.repeat(400) } }));
  });
  const url = await listen(server);
  const outcome = await runOpenAiCompatibleExchange({
    baseUrl: `${url}/v1`,
    modelAlias: 'test-model',
    prompt: 'hi',
    maxOutputTokens: 8,
    timeoutMs: 5_000,
  });
  await new Promise<void>((resolve) => server.close(() => resolve()));
  assert.equal(outcome.observation.terminalReason, 'http-error');
  assert.equal(outcome.observation.httpStatus, 503);
  assert.ok(outcome.errorDetail !== undefined && outcome.errorDetail.length <= 256);
});

test('unresponsive endpoints become honest timeouts, not exceptions', async () => {
  const server = createServer(() => {
    // never respond
  });
  const url = await listen(server);
  const outcome = await runOpenAiCompatibleExchange({
    baseUrl: `${url}/v1`,
    modelAlias: 'test-model',
    prompt: 'hi',
    maxOutputTokens: 8,
    timeoutMs: 150,
  });
  await new Promise<void>((resolve) => server.close(() => resolve()));
  assert.equal(outcome.observation.terminalReason, 'timeout');
});

test('the same adapter serves loopback IPs and hostnames identically', async () => {
  const sseA = sseServer();
  const sseB = sseServer();
  const urlA = await listen(sseA.server);
  // second server binds 0.0.0.0 too; address via localhost hostname
  const boundB = await listen(sseB.server);
  const portB = new URL(boundB).port;
  const urlB = `http://localhost:${portB}`;

  const [a, b] = await Promise.all([
    runOpenAiCompatibleExchange({
      baseUrl: `${urlA}/v1`,
      modelAlias: 'm',
      prompt: 'p',
      maxOutputTokens: 4,
      timeoutMs: 5_000,
    }),
    runOpenAiCompatibleExchange({
      baseUrl: `${urlB}/v1`,
      modelAlias: 'm',
      prompt: 'p',
      maxOutputTokens: 4,
      timeoutMs: 5_000,
    }),
  ]);
  await new Promise<void>((resolve) => sseA.server.close(() => resolve()));
  await new Promise<void>((resolve) => sseB.server.close(() => resolve()));

  // Endpoint topology changes nothing about record semantics.
  assert.equal(a.observation.terminalReason, 'completed');
  assert.equal(b.observation.terminalReason, 'completed');
  assert.deepEqual(a.observation.usage, b.observation.usage);
});

test('connect retry uses a fresh signal after the first attempt is aborted', async () => {
  let posts = 0;
  const server = createServer((req, res) => {
    if (req.method !== 'POST') {
      res.writeHead(200);
      res.end();
      return;
    }
    posts += 1;
    if (posts === 1) return; // hang until the first attempt's deadline fires
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('ok');
  });
  const url = await listen(server);
  const signals: AbortSignal[] = [];
  const connected = await connectWithOneRetry(url, () => {
    const signal = AbortSignal.timeout(80);
    signals.push(signal);
    return { method: 'POST', signal };
  });
  await new Promise<void>((resolve) => server.close(() => resolve()));

  assert.equal(signals.length, 2, 'the retry must build a second request init');
  assert.notEqual(signals[0], signals[1]);
  assert.equal(signals[0]?.aborted, true);
  assert.equal(signals[1]?.aborted, false);
  assert.ok(connected.response instanceof Response);
  assert.equal(posts, 2);
});

test('a transient pre-response connection reset is retried transparently by both protocol adapters', async () => {
  // Deterministic repro of the intermittent equivalence failure: the first
  // connection each server accepts is destroyed before any response bytes.
  // Without a transport retry this surfaces as text '' with terminalReason
  // 'cancelled'; both adapters must recover through one transparent retry.
  for (let iteration = 0; iteration < 5; iteration++) {
    const sse = sseServer();
    const jsonl = jsonLineServer();
    sse.armReset();
    jsonl.armReset();
    const sseUrl = await listen(sse.server);
    const jsonlUrl = await listen(jsonl.server);

    const [viaSse, viaJsonl] = await Promise.all([
      runOpenAiCompatibleExchange({
        baseUrl: `${sseUrl}/v1`,
        modelAlias: 'test-model',
        prompt: `say hi ${CANARY}`,
        maxOutputTokens: 32,
        timeoutMs: 5_000,
      }),
      runJsonLineFixtureExchange({
        baseUrl: jsonlUrl,
        modelAlias: 'test-model',
        prompt: `say hi ${CANARY}`,
        maxOutputTokens: 32,
        timeoutMs: 5_000,
      }),
    ]);

    for (const server of [sse.server, jsonl.server]) {
      server.close();
      server.closeAllConnections();
    }

    assert.equal(viaSse.observation.terminalReason, 'completed');
    assert.equal(viaSse.text, 'Hello');
    assert.equal(viaSse.finishReason, 'stop');
    assert.equal(viaJsonl.observation.terminalReason, 'completed');
    assert.equal(viaJsonl.text, 'Hello');
    assert.equal(viaJsonl.finishReason, 'stop');
  }
});

test('a provider stream that dies after headers reports disconnected, not cancelled', async () => {
  const halfStream = createServer((req, res) => {
    res.writeHead(200, {
      'content-type':
        req.url === '/chat' ? 'application/x-ndjson' : 'text/event-stream',
    });
    if (req.url === '/chat') {
      res.write(`${JSON.stringify({ kind: 'piece', text: 'Hel' })}\n`);
    } else {
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: 'Hel' } }] })}\n\n`);
    }
    // let the head of stream reach the client before killing the socket,
    // so the death lands mid-body rather than racing the response headers
    setTimeout(() => res.socket?.destroy(), 50).unref();
  });

  const url = await listen(halfStream);
  const [viaSse, viaJsonl] = await Promise.all([
    runOpenAiCompatibleExchange({
      baseUrl: `${url}/v1`,
      modelAlias: 'm',
      prompt: 'p',
      maxOutputTokens: 8,
      timeoutMs: 5_000,
    }),
    runJsonLineFixtureExchange({
      baseUrl: url,
      modelAlias: 'm',
      prompt: 'p',
      maxOutputTokens: 8,
      timeoutMs: 5_000,
    }),
  ]);
  await new Promise<void>((resolve) => halfStream.close(() => resolve()));

  for (const [label, outcome] of [['sse', viaSse], ['jsonl', viaJsonl]] as const) {
    assert.equal(
      outcome.observation.terminalReason,
      'disconnected',
      `${label}: the provider died mid-stream, which is observed instability, not our choice`,
    );
    assert.equal(outcome.finishReason, null);
    assert.equal(outcome.observation.httpStatus, 200, 'the status was known before the stream died');
    assert.ok(
      (outcome.errorDetail ?? '').length > 0,
      `${label}: the transport cause must stay visible`,
    );
  }
});

test('a fetch-forbidden origin is honest cancelled evidence, and listen() never deals such ports', async () => {
  // Find a port Node's fetch refuses ("bad port") that we can still bind.
  // Windows dynamic ranges starting below 65536 include spec-blocked ports;
  // Linux ranges usually avoid them, in which case this pins nothing here.
  let forbiddenPort: number | null = null;
  for (const candidate of [123, 135, 137, 138, 139, 512, 513, 514, 5060, 6000]) {
    const probe = createServer((_req, res) => res.end());
    const bound = await new Promise<boolean>((resolve) => {
      probe.once('error', () => resolve(false));
      probe.listen(candidate, '127.0.0.1', () => resolve(true));
    });
    if (!bound) continue;
    const refusal = await fetch(`http://127.0.0.1:${candidate}/`).then(
      () => undefined,
      (cause: unknown) => cause,
    );
    if (refusal instanceof Error) {
      const nested = refusal.cause as { message?: string } | undefined;
      if (nested?.message === 'bad port' || refusal.message.includes('bad port')) {
        forbiddenPort = candidate;
        await new Promise<void>((resolve) => probe.close(() => resolve()));
        break;
      }
    }
    await new Promise<void>((resolve) => probe.close(() => resolve()));
  }

  if (forbiddenPort !== null) {
    const sse = sseServer();
    const url = await listenOn(sse.server, forbiddenPort);
    const outcome = await runOpenAiCompatibleExchange({
      baseUrl: `${url}/v1`,
      modelAlias: 'm',
      prompt: 'p',
      maxOutputTokens: 4,
      timeoutMs: 5_000,
    });
    await new Promise<void>((resolve) => sse.server.close(() => resolve()));
    assert.equal(outcome.observation.terminalReason, 'cancelled');
    assert.ok(
      (outcome.errorDetail ?? '').includes('bad port'),
      'the refusal cause must stay visible in bounded error evidence',
    );
  }

  // The fix: listen() probes with a real fetch, so every returned origin is
  // actually fetchable regardless of the machine's dynamic port range.
  for (let i = 0; i < 25; i++) {
    const server = createServer((_req, res) => res.end());
    const url = await listen(server);
    const accepted = await fetch(`${url}/`).then(
      () => true,
      (cause: unknown) =>
        cause instanceof Error &&
        ((cause.cause as { message?: string } | undefined)?.message ??
          cause.message) === 'bad port',
    );
    await new Promise<void>((resolve) => server.close(() => resolve()));
    assert.equal(accepted, true, `listen() returned a fetch-forbidden origin: ${url}`);
  }
});

async function listenOn(server: Server, port: number): Promise<string> {
  server.listen(port, '127.0.0.1');
  await once(server, 'listening');
  return `http://127.0.0.1:${port}`;
}

interface CapturedExchange {
  method: string;
  url: string | undefined;
  authorization: string | undefined;
  headerNames: string[];
}

function capturingSseServer(): FixtureServer & { captured: CapturedExchange[] } {
  const captured: CapturedExchange[] = [];
  const inner = sseServer();
  const original = inner.server.listeners('request')[0] as
    | ((req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => void)
    | undefined;
  if (original === undefined) {
    throw new Error('sse fixture lost its request listener');
  }
  inner.server.removeListener('request', original);
  inner.server.on('request', (req, res) => {
    captured.push({
      method: req.method ?? '',
      url: req.url,
      authorization: headerValue(req.headers.authorization),
      headerNames: Object.keys(req.headers),
    });
    original(req, res);
  });
  return { ...inner, captured };
}

function outboundPosts(captured: readonly CapturedExchange[]): CapturedExchange[] {
  return captured.filter((hit) => hit.method === 'POST');
}

function headerValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

function credentialCanary(): string {
  return `tonos-cred-canary-${process.pid}-${Date.now()}`;
}

function assertCanaryAbsent(canary: string, surfaces: readonly unknown[]): void {
  for (const surface of surfaces) {
    const rendered = typeof surface === 'string' ? surface : JSON.stringify(surface);
    assert.ok(
      rendered === undefined || !rendered.includes(canary),
      'resolved credential material must not appear in persisted or exported surfaces',
    );
  }
}

test('openai-compatible attaches resolved credentials on the outbound request', async () => {
  const canary = credentialCanary();
  const fixture = capturingSseServer();
  const url = await listen(fixture.server);
  const outcome = await runOpenAiCompatibleExchange({
    baseUrl: `${url}/v1`,
    modelAlias: 'test-model',
    prompt: 'hi',
    maxOutputTokens: 8,
    timeoutMs: 5_000,
    secretRefs: ['credman:fixture-key-ref'],
    resolveSecret: () => canary,
  });
  await new Promise<void>((resolve) => fixture.server.close(() => resolve()));

  assert.equal(outcome.observation.terminalReason, 'completed');
  const posts = outboundPosts(fixture.captured);
  assert.equal(posts.length, 1);
  assert.equal(posts[0]?.authorization, `Bearer ${canary}`);
  assertCanaryAbsent(canary, [
    outcome.observation,
    outcome.errorDetail,
    encode('providerExchangeObservation', outcome.observation),
  ]);
});

test('openai-compatible adds no authentication material when secret refs are absent', async () => {
  const fixture = capturingSseServer();
  const url = await listen(fixture.server);
  const outcome = await runOpenAiCompatibleExchange({
    baseUrl: `${url}/v1`,
    modelAlias: 'test-model',
    prompt: 'hi',
    maxOutputTokens: 8,
    timeoutMs: 5_000,
  });
  await new Promise<void>((resolve) => fixture.server.close(() => resolve()));

  assert.equal(outcome.observation.terminalReason, 'completed');
  const posts = outboundPosts(fixture.captured);
  assert.equal(posts.length, 1);
  assert.equal(posts[0]?.authorization, undefined);
  assert.ok(
    !(posts[0]?.headerNames ?? []).some((name) =>
      /authorization|api-key|x-api-key|token/iu.test(name),
    ),
    'absent secret refs must not invent an authentication header',
  );
});

test('unresolved secret refs fail closed before any outbound request', async () => {
  const fixture = capturingSseServer();
  const url = await listen(fixture.server);
  const outcome = await runOpenAiCompatibleExchange({
    baseUrl: `${url}/v1`,
    modelAlias: 'test-model',
    prompt: 'hi',
    maxOutputTokens: 8,
    timeoutMs: 5_000,
    secretRefs: ['credman:missing-ref'],
    resolveSecret: () => undefined,
  });
  await new Promise<void>((resolve) => fixture.server.close(() => resolve()));

  assert.equal(outcome.observation.terminalReason, 'configuration-error');
  assert.equal(outcome.observation.httpStatus, null);
  assert.equal(outboundPosts(fixture.captured).length, 0);
  assert.match(outcome.errorDetail ?? '', /secret reference 'credman:missing-ref' is unresolved/u);
});

test('resolved credential canaries never appear in observations, exports, or errorDetail', async () => {
  const canary = credentialCanary();
  const echo = createServer((req, res) => {
    res.writeHead(401, { 'content-type': 'application/json' });
    res.end(
      JSON.stringify({
        error: { message: `rejected ${headerValue(req.headers.authorization)}` },
      }),
    );
  });
  const url = await listen(echo);
  const failed = await runOpenAiCompatibleExchange({
    baseUrl: `${url}/v1`,
    modelAlias: 'test-model',
    prompt: 'hi',
    maxOutputTokens: 8,
    timeoutMs: 5_000,
    secretRefs: ['credman:fixture-key-ref'],
    resolveSecret: () => canary,
  });
  const missing = await runOpenAiCompatibleExchange({
    baseUrl: `${url}/v1`,
    modelAlias: 'test-model',
    prompt: 'hi',
    maxOutputTokens: 8,
    timeoutMs: 5_000,
    secretRefs: ['credman:missing-ref'],
    resolveSecret: () => {
      throw new Error(`unresolved while holding ${canary}`);
    },
  });
  await new Promise<void>((resolve) => echo.close(() => resolve()));

  assert.equal(failed.observation.terminalReason, 'http-error');
  assert.equal(missing.observation.terminalReason, 'configuration-error');
  assertCanaryAbsent(canary, [
    failed,
    missing,
    failed.errorDetail,
    missing.errorDetail,
    encode('providerExchangeObservation', failed.observation),
    encode('providerExchangeObservation', missing.observation),
  ]);
});

