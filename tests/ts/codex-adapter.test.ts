import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { CodexAdapter } from '../../adapters/harness/codex-adapter.ts';
import { runSharedContract } from '../../core/harness/contract.ts';
import { fixtureTrialDeclaration } from '../fixtures/records.ts';
import { createProcessPort } from '../../adapters/process/process-port.ts';
import { InMemoryConfigurationPort } from '../fixtures/in-memory-config-port.ts';
import { parseHarnessKinds } from '../../adapters/matrix/executor-registry.ts';

const TRANSCRIPTS = join(
  new URL('../fixtures/transcripts/codex/', import.meta.url).pathname.replace(
    /^\/([A-Za-z]:)/u,
    '$1',
  ),
);

function replayAdapter(transcript: string): CodexAdapter {
  return new CodexAdapter({ replayTranscriptPath: join(TRANSCRIPTS, transcript) });
}

test('parseLine maps known codex events onto canonical kinds and skips noise', () => {
  const adapter = new CodexAdapter();

  const toolDone = adapter.parseLine(
    '{"type":"item.completed","item":{"id":"i","type":"command_execution","exit_code":0}}',
  );
  assert.deepEqual(toolDone, { kind: 'tool', fields: { tool: 'command-execution', ok: true } });

  const failedTool = adapter.parseLine(
    '{"type":"item.completed","item":{"id":"i","type":"command_execution","exit_code":3}}',
  );
  assert.equal(failedTool?.fields['ok'], false);

  const fileChange = adapter.parseLine(
    '{"type":"item.completed","item":{"id":"i","type":"file_change","changes":[]}}',
  );
  assert.equal(fileChange?.kind, 'tool');

  assert.equal(adapter.parseLine('{"type":"item.started","item":{"id":"i"}}'), null);
  assert.equal(adapter.parseLine('{"type":"turn.started"}'), null);
  assert.equal(adapter.parseLine('not json at all'), null);

  const completed = adapter.parseLine('{"type":"turn.completed","usage":{}}');
  assert.equal(completed?.kind, 'turn_completed');

  const failure = adapter.parseLine('{"type":"turn.failed","error":{"message":"x"}}');
  assert.equal(failure?.kind, 'harness_error');

  const unknownType = adapter.parseLine('{"type":"mystery_event","x":1}');
  assert.deepEqual(unknownType, {
    kind: 'unknown_event',
    fields: { type: 'mystery_event' },
  });
});

test('unrecognized codex event types become declared unknowns instead of vanishing', () => {
  const adapter = new CodexAdapter();
  const events = [
    { kind: 'tool', fields: { tool: 'command-execution', ok: true } },
    { kind: 'unknown_event', fields: { type: 'mystery_event' } },
    { kind: 'unknown_item', fields: { type: 'web_search' } },
  ].map((e) => ({ kind: e.kind as string, fields: e.fields as Record<string, unknown> }));

  const behavior = adapter.collectEffectiveBehavior({}, events);
  assert.equal(behavior.modelReportedByHarness, undefined);
  assert.ok(
    behavior.unknowns.some((u) => u.includes('mystery_event')),
    'unknown event types must be recorded',
  );
  assert.ok(
    behavior.unknowns.some((u) => u.includes('web_search')),
    'unknown item types must be recorded',
  );
});

test('the shared harness contract passes for the codex adapter against a real transcript', async () => {
  const results = await runSharedContract([() => replayAdapter('tools.jsonl')]);
  assert.equal(results.length, 1);
  assert.deepEqual(results[0]!.violations, []);
  assert.equal(results[0]!.adapterKind, 'codex');
});

test('preflight refuses tool-less qualification before anything spawns', () => {
  const adapter = new CodexAdapter();
  assert.throws(() => adapter.preflight({ toolsEnabled: false }));
  assert.doesNotThrow(() =>
    adapter.preflight({ toolsEnabled: true, reasoningEffort: 'medium', requestedModelAlias: 'luna' }),
  );
});

const FAKE_CODEX = new URL(
  '../fixtures/harness/fake-codex.mjs',
  import.meta.url,
).pathname.replace(/^\/([A-Za-z]:)/u, '$1');

const PROMPT_PATH = new URL(
  '../../tasks/retry-suite/fixtures/prompt.md',
  import.meta.url,
).pathname.replace(/^\/([A-Za-z]:)/u, '$1');

async function liveLikeDeclaration(promptPath: string) {
  const declaration = fixtureTrialDeclaration();
  declaration.harness.adapterKind = 'codex';
  declaration.harness.harnessId = 'codex-cli';
  declaration.configuration.requestedModelAlias = 'luna';
  declaration.configuration.reasoningEffort = 'medium';
  declaration.provider.secretRefs = ['credman:fixture-key-ref'];
  return { declaration, promptPath };
}

test('live spawn uses ProcessPort, disposable CODEX_HOME, and the suite task prompt', async () => {
  const ambientHome = await mkdtemp(join(tmpdir(), 'tonos-ambient-codex-'));
  const sentinel = join(ambientHome, 'sentinel.txt');
  await writeFile(sentinel, 'original', 'utf8');
  const previousHome = process.env['HOME'];
  process.env['HOME'] = ambientHome;
  const config = new InMemoryConfigurationPort();
  const canary = `tonos-codex-canary-${process.pid}`;
  const adapter = new CodexAdapter({
    processPort: createProcessPort(),
    configurationPort: config,
    command: process.execPath,
    extraArgv: [FAKE_CODEX],
    resolveSecret: () => canary,
    promptPath: PROMPT_PATH,
  });

  try {
    const { declaration } = await liveLikeDeclaration(PROMPT_PATH);
    const record = await adapter.runCanonical(declaration, 'tools');
    assert.equal(record.terminalState, 'passed');
    assert.ok(record.toolEvents.some((event) => event.tool === 'command-execution'));

    assert.equal(config.renderedRoots.length, 0, 'owned config root must be removed after the run');
    assert.equal(await readFile(sentinel, 'utf8'), 'original');

    const observedPath = join(
      (adapter.lastConfigRoot ?? ''),
      'observed.json',
    );
    // lastConfigRoot is retained only for the test assertion after cleanup;
    // the directory itself must already be gone.
    await assert.rejects(readFile(observedPath));

    const observed = adapter.lastObserved;
    assert.ok(observed !== undefined);
    const prompt = await readFile(PROMPT_PATH, 'utf8');
    assert.equal(observed.promptTail, prompt.trim());
    assert.ok(observed.argv.includes('--json'));
    assert.ok(observed.argv.includes('workspace-write'));
    assert.equal(observed.secretKeyCount, 1);
    assert.ok(!JSON.stringify(record).includes(canary));
    assert.ok(!JSON.stringify(observed).includes(canary));
  } finally {
    if (previousHome === undefined) delete process.env['HOME'];
    else process.env['HOME'] = previousHome;
    await rm(ambientHome, { recursive: true, force: true });
  }
});

test('live smoke stays gated behind TONOS_LIVE_CODEX and never runs in default CI', () => {
  assert.notEqual(process.env['TONOS_LIVE_CODEX'], '1');
  assert.equal(
    CodexAdapter.liveSmokeEnabled(process.env),
    false,
    'default CI environment must not enable the live Codex smoke',
  );
  assert.equal(CodexAdapter.liveSmokeEnabled({ TONOS_LIVE_CODEX: '1' }), true);
});

test(
  'opt-in live Codex smoke uses the real binary only when TONOS_LIVE_CODEX=1',
  { skip: process.env['TONOS_LIVE_CODEX'] !== '1' },
  async () => {
    const adapter = new CodexAdapter({
      processPort: createProcessPort(),
      configurationPort: new InMemoryConfigurationPort(),
      promptPath: PROMPT_PATH,
    });
    const { declaration } = await liveLikeDeclaration(PROMPT_PATH);
    const record = await adapter.runCanonical(declaration, 'tools');
    assert.ok(
      record.terminalState === 'passed' || record.terminalState === 'invalid',
      'live smoke must produce an honest terminal state, never throw',
    );
  },
);

test('executor registry defaults to fixture and accepts --harness codex', () => {
  assert.deepEqual(parseHarnessKinds(undefined), ['fixture']);
  assert.deepEqual(parseHarnessKinds(['codex']), ['codex']);
  assert.deepEqual(parseHarnessKinds(['fixture', 'codex']), ['fixture', 'codex']);
  assert.throws(() => parseHarnessKinds(['unknown']), /unknown harness kind/u);
});
