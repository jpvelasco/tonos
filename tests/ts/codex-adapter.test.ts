import { test } from 'node:test';
import assert from 'node:assert/strict';

import { join } from 'node:path';

import { CodexAdapter } from '../../adapters/harness/codex-adapter.ts';
import { runSharedContract } from '../../core/harness/contract.ts';

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
