import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { once } from 'node:events';

import { encode, decode, type RecordKind } from '../../core/codec.ts';
import { runOpenAiCompatibleExchange } from '../../adapters/providers/openai-compatible.ts';
import { runJsonLineFixtureExchange } from '../../adapters/providers/json-line-fixture.ts';
import type { ExchangeOutcome } from '../../core/providers/types.ts';

const CANARY = 'tonos-provider-canary';

async function listen(server: Server): Promise<string> {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const addr = server.address();
  if (addr === null || typeof addr === 'object') {
    return `http://127.0.0.1:${(addr as { port: number }).port}`;
  }
  throw new Error('no address');
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
  sseB.server.listen(0, '127.0.0.1');
  await once(sseB.server, 'listening');
  const portB = (sseB.server.address() as { port: number }).port;
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

    for (const server of [sse.server, jsonl.server]) server.close();

    assert.equal(viaSse.observation.terminalReason, 'completed');
    assert.equal(viaSse.text, 'Hello');
    assert.equal(viaSse.finishReason, 'stop');
    assert.equal(viaJsonl.observation.terminalReason, 'completed');
    assert.equal(viaJsonl.text, 'Hello');
    assert.equal(viaJsonl.finishReason, 'stop');
  }
});

