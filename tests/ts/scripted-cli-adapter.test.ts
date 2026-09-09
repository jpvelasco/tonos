import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  AIDER_PROFILE,
  CLINE_PROFILE,
  ScriptedCliAdapter,
} from '../../adapters/harness/scripted-cli-adapter.ts';
import { runSharedContract } from '../../core/harness/contract.ts';
import { fixtureTrialDeclaration } from '../fixtures/records.ts';
import { createProcessPort } from '../../adapters/process/process-port.ts';
import { InMemoryConfigurationPort } from '../fixtures/in-memory-config-port.ts';
import { parseHarnessKinds } from '../../adapters/matrix/executor-registry.ts';

const FAKE = new URL(
  '../fixtures/harness/fake-scripted-cli.mjs',
  import.meta.url,
).pathname.replace(/^\/([A-Za-z]:)/u, '$1');
const PROMPT_PATH = new URL(
  '../../tasks/retry-suite/fixtures/prompt.md',
  import.meta.url,
).pathname.replace(/^\/([A-Za-z]:)/u, '$1');

function transcript(kind: 'aider' | 'cline'): string {
  return new URL(
    `../fixtures/transcripts/${kind}/tools.jsonl`,
    import.meta.url,
  ).pathname.replace(/^\/([A-Za-z]:)/u, '$1');
}

for (const [label, profile] of [
  ['aider', AIDER_PROFILE],
  ['cline', CLINE_PROFILE],
] as const) {
  test(`${label} shared contract passes against a sanitized transcript`, async () => {
    const results = await runSharedContract([
      () =>
        new ScriptedCliAdapter(profile, {
          replayTranscriptPath: transcript(label),
        }),
    ]);
    assert.equal(results[0]!.adapterKind, label);
    assert.deepEqual(results[0]!.violations, []);
  });

  test(`${label} preflight refuses tool-less qualification`, () => {
    assert.throws(() => new ScriptedCliAdapter(profile).preflight({ toolsEnabled: false }));
  });

  test(`${label} live spawn uses ProcessPort, disposable home, and suite prompt`, async () => {
    const ambientHome = await mkdtemp(join(tmpdir(), `tonos-ambient-${label}-`));
    const sentinel = join(ambientHome, 'sentinel.txt');
    await writeFile(sentinel, 'original', 'utf8');
    const previousHome = process.env['HOME'];
    process.env['HOME'] = ambientHome;
    const config = new InMemoryConfigurationPort();
    const canary = `tonos-${label}-canary-${process.pid}`;
    const adapter = new ScriptedCliAdapter(profile, {
      processPort: createProcessPort(),
      configurationPort: config,
      command: process.execPath,
      extraArgv: [FAKE],
      resolveSecret: () => canary,
      promptPath: PROMPT_PATH,
    });
    try {
      const declaration = fixtureTrialDeclaration();
      declaration.harness.adapterKind = label;
      declaration.provider.secretRefs = ['credman:fixture-key-ref'];
      const record = await adapter.runCanonical(declaration, 'tools');
      assert.equal(record.terminalState, 'passed');
      assert.equal(await readFile(sentinel, 'utf8'), 'original');
      assert.equal(config.renderedRoots.length, 0);
      assert.ok(!JSON.stringify(record).includes(canary));
      assert.ok(!adapter.liveSmokeEnabled(process.env));
    } finally {
      if (previousHome === undefined) delete process.env['HOME'];
      else process.env['HOME'] = previousHome;
      await rm(ambientHome, { recursive: true, force: true });
    }
  });
}

test('registry accepts aider and cline after contract gates', () => {
  assert.deepEqual(parseHarnessKinds(['aider', 'cline']), ['aider', 'cline']);
});
