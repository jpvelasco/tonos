import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ClaudeAdapter } from '../../adapters/harness/claude-adapter.ts';
import { runSharedContract } from '../../core/harness/contract.ts';
import { fixtureTrialDeclaration } from '../fixtures/records.ts';
import { createProcessPort } from '../../adapters/process/process-port.ts';
import { InMemoryConfigurationPort } from '../fixtures/in-memory-config-port.ts';
import { parseHarnessKinds } from '../../adapters/matrix/executor-registry.ts';

const TRANSCRIPTS = join(
  new URL('../fixtures/transcripts/claude/', import.meta.url).pathname.replace(
    /^\/([A-Za-z]:)/u,
    '$1',
  ),
);
const FAKE_CLAUDE = new URL(
  '../fixtures/harness/fake-claude.mjs',
  import.meta.url,
).pathname.replace(/^\/([A-Za-z]:)/u, '$1');
const PROMPT_PATH = new URL(
  '../../tasks/retry-suite/fixtures/prompt.md',
  import.meta.url,
).pathname.replace(/^\/([A-Za-z]:)/u, '$1');

test('parseLine maps Claude stream-json tool uses onto canonical kinds', () => {
  const adapter = new ClaudeAdapter();
  const tool = adapter.parseLine(
    '{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Bash"}]}}',
  );
  assert.deepEqual(tool, {
    kind: 'tool',
    fields: { tool: 'command-execution', ok: true },
  });
  const edit = adapter.parseLine(
    '{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Edit"}]}}',
  );
  assert.equal(edit?.fields['tool'], 'file-change');
  assert.equal(adapter.parseLine('{"type":"result","subtype":"success"}')?.kind, 'turn_completed');
  assert.deepEqual(adapter.parseLine('{"type":"mystery"}'), {
    kind: 'unknown_event',
    fields: { type: 'mystery' },
  });
  assert.equal(adapter.parseLine('not json'), null);
});

test('the shared harness contract passes for the Claude adapter against a sanitized transcript', async () => {
  const results = await runSharedContract([
    () => new ClaudeAdapter({ replayTranscriptPath: join(TRANSCRIPTS, 'tools.jsonl') }),
  ]);
  assert.equal(results[0]!.adapterKind, 'openclaude');
  assert.deepEqual(results[0]!.violations, []);
});

test('preflight refuses tool-less qualification before anything spawns', () => {
  const adapter = new ClaudeAdapter();
  assert.throws(() => adapter.preflight({ toolsEnabled: false }));
});

test('live spawn uses ProcessPort, disposable config root, and the suite task prompt', async () => {
  const ambientHome = await mkdtemp(join(tmpdir(), 'tonos-ambient-claude-'));
  const sentinel = join(ambientHome, 'sentinel.txt');
  await writeFile(sentinel, 'original', 'utf8');
  const previousHome = process.env['HOME'];
  process.env['HOME'] = ambientHome;
  const config = new InMemoryConfigurationPort();
  const canary = `tonos-claude-canary-${process.pid}`;
  const adapter = new ClaudeAdapter({
    processPort: createProcessPort(),
    configurationPort: config,
    command: process.execPath,
    extraArgv: [FAKE_CLAUDE],
    resolveSecret: () => canary,
    promptPath: PROMPT_PATH,
  });
  try {
    const declaration = fixtureTrialDeclaration();
    declaration.harness.adapterKind = 'openclaude';
    declaration.provider.secretRefs = ['credman:fixture-key-ref'];
    const record = await adapter.runCanonical(declaration, 'tools');
    assert.equal(record.terminalState, 'passed');
    assert.equal(await readFile(sentinel, 'utf8'), 'original');
    assert.equal(config.renderedRoots.length, 0);
    assert.ok(adapter.lastObserved?.argv.includes('--output-format'));
    assert.equal(adapter.lastObserved?.promptTail, (await readFile(PROMPT_PATH, 'utf8')).trim());
    assert.ok(!JSON.stringify(record).includes(canary));
  } finally {
    if (previousHome === undefined) delete process.env['HOME'];
    else process.env['HOME'] = previousHome;
    await rm(ambientHome, { recursive: true, force: true });
  }
});

test('live Claude smoke stays gated and never runs in default CI', () => {
  assert.notEqual(process.env['TONOS_LIVE_CLAUDE'], '1');
  assert.equal(ClaudeAdapter.liveSmokeEnabled(process.env), false);
  assert.deepEqual(parseHarnessKinds(['openclaude']), ['openclaude']);
});
