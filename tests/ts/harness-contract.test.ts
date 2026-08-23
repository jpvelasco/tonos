import { test } from 'node:test';
import assert from 'node:assert/strict';

import type {
  EventLine,
  HarnessAdapter,
} from '../../core/harness/types.ts';
import { runSharedContract } from '../../core/harness/contract.ts';
import { FormatAAdapter } from '../../adapters/harnesses/format-a.ts';
import { FormatBAdapter } from '../../adapters/harnesses/format-b.ts';
import { fixtureTrialDeclaration } from '../fixtures/records.ts';

const FIXTURE_HARNESS_URL = new URL(
  '../fixtures/harness/fixture-harness.mjs',
  import.meta.url,
).pathname.replace(/^\/([A-Za-z]:)/u, '$1');

test('two fake harnesses with different native formats produce equivalent canonical trial records', async () => {
  const a = new FormatAAdapter(FIXTURE_HARNESS_URL);
  const b = new FormatBAdapter(FIXTURE_HARNESS_URL);

  const recordA = await a.runCanonical(fixtureTrialDeclaration(), 'tools');
  const recordB = await b.runCanonical(fixtureTrialDeclaration(), 'tools');

  assert.deepEqual(recordA.toolEvents, recordB.toolEvents);
  assert.equal(recordA.effectiveBehavior.modelReportedByHarness, 'test-model');
  assert.equal(recordB.effectiveBehavior.modelReportedByHarness, 'test-model');
  assert.deepEqual(recordA.declaredUnknowns, []);
  assert.deepEqual(recordB.declaredUnknowns, []);
});

test('the shared contract suite passes for every registered adapter', async () => {
  const adapters: Array<() => HarnessAdapter> = [
    () => new FormatAAdapter(FIXTURE_HARNESS_URL),
    () => new FormatBAdapter(FIXTURE_HARNESS_URL),
  ];
  const results = await runSharedContract(adapters);
  assert.equal(results.length, 2);
  for (const result of results) {
    assert.deepEqual(result.violations, [], `${result.adapterKind} violated the contract`);
  }
});

test('unsupported configuration fails before any process spawns', async () => {
  const a = new FormatAAdapter(FIXTURE_HARNESS_URL);
  let spawned = false;
  a.onBeforeSpawn = () => {
    spawned = true;
  };
  assert.throws(
    () => a.preflight({ reasoningEffort: 'high', toolsEnabled: false }),
    /unsupported configuration: reasoning-effort high requires tools/u,
  );
  assert.equal(spawned, false);
});

test('effective behavior is recorded when the harness reports it', () => {
  const lines: EventLine[] = [
    { kind: 'config_effective', fields: { model: 'test-model', ctx: 4096 } },
  ];
  const behavior = new FormatAAdapter(FIXTURE_HARNESS_URL).collectEffectiveBehavior(
    { requestedModelAlias: 'test-model' },
    lines,
  );
  assert.equal(behavior.modelReportedByHarness, 'test-model');
});

test('unreportable effective behavior becomes a declared unknown, never a fallback', () => {
  const lines: EventLine[] = [];
  const behavior = new FormatBAdapter(FIXTURE_HARNESS_URL).collectEffectiveBehavior(
    { requestedModelAlias: 'test-model' },
    lines,
  );
  assert.equal(behavior.modelReportedByHarness, undefined);
  assert.ok(behavior.unknowns.some((u) => u.includes('model identity not reported')));
});
