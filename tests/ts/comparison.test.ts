import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  comparabilityOf,
  aggregateTrial,
  evaluatePolicy,
  matrixPreview,
} from '../../core/comparison/engine.ts';
import type { RecordedTrial } from '../../core/comparison/engine.ts';

function trial(overrides?: Partial<RecordedTrial>): RecordedTrial {
  return {
    declarationId: 'trn_trial_' + 'a'.repeat(64),
    harnessId: 'fixture-harness',
    harnessVersion: '1.0.0',
    adapterContractVersion: 1,
    effectiveConfigDigest: 'cfg-a',
    providerProtocol: 'openai-compatible',
    servedModelId: 'test-model@2026-08-01',
    suiteId: 'go-retry',
    suiteRevision: '1.0.0',
    terminalState: 'passed',
    verificationPassed: true,
    totalWallMs: 5_000,
    ...overrides,
  };
}

test('trials are directly comparable only when every identity axis agrees', () => {
  const base = trial();
  assert.equal(comparabilityOf(base, trial()).comparable, true);

  const versionDrift = comparabilityOf(base, trial({ harnessVersion: '2.0.0' }));
  assert.equal(versionDrift.comparable, false);
  assert.match(versionDrift.reason ?? '', /harness version/u);

  const configDrift = comparabilityOf(base, trial({ effectiveConfigDigest: 'cfg-b' }));
  assert.equal(configDrift.comparable, false);
  assert.match(configDrift.reason ?? '', /effective configuration/u);

  const suiteDrift = comparabilityOf(base, trial({ suiteRevision: '2.0.0' }));
  assert.equal(suiteDrift.comparable, false);
  assert.match(suiteDrift.reason ?? '', /task suite revision/u);

  const modelDrift = comparabilityOf(base, trial({ servedModelId: 'other@x' }));
  assert.equal(modelDrift.comparable, false);
  assert.match(modelDrift.reason ?? '', /served model/u);
});

test('repeated trials report sample counts, medians, dispersion, and failure counts', () => {
  const summary = aggregateTrial('trn_x', [
    trial({ totalWallMs: 4_000 }),
    trial({ totalWallMs: 6_000 }),
    trial({ totalWallMs: 5_000 }),
    trial({ totalWallMs: 5_000, terminalState: 'failed' as const, verificationPassed: false }),
  ]);
  assert.equal(summary.samples, 4);
  assert.equal(summary.failures, 1);
  assert.equal(summary.wallMsMedian, 5_000);
  // honest dispersion: min-max spread is reported, not hidden behind a mean
  assert.equal(summary.wallMsMin, 4_000);
  assert.equal(summary.wallMsMax, 6_000);
  assert.equal(summary.passRate, 0.75);
});

const POLICY = {
  minPassRate: 1,
  requireVerification: true,
};

test('a fast trial that fails its task can never win', () => {
  const fastButFailing = aggregateTrial('trn_fast_fail', [
    trial({
      declarationId: 'trn_trial_' + 'f'.repeat(64),
      totalWallMs: 100,
      terminalState: 'failed',
      verificationPassed: false,
    }),
  ]);
  const slowButCorrect = aggregateTrial('trn_slow_ok', [
    trial({ totalWallMs: 60_000 }),
  ]);

  const decision = evaluatePolicy(POLICY, [fastButFailing, slowButCorrect]);
  assert.equal(decision.winnerDeclarationId, slowButCorrect.declarationId);
  assert.ok(
    decision.exclusions.some((e) => e.declarationId === 'trn_fast_fail'),
    'fast-but-failing must be excluded from winning',
  );
});

test('qualification may honestly return no winner', () => {
  const allFail = aggregateTrial('trn_all_fail', [
    trial({ terminalState: 'failed', verificationPassed: false }),
  ]);
  const decision = evaluatePolicy(POLICY, [allFail]);
  assert.equal(decision.winnerDeclarationId, null);
  assert.equal(decision.outcome, 'no-winner');
});

test('multi-axis matrices refuse single-variable attribution', () => {
  const preview = matrixPreview([
    { axis: 'harness', variants: 3 },
    { axis: 'provider', variants: 2 },
  ]);
  assert.equal(preview.singleVariableAttributionAllowed, false);
  assert.match(preview.attributionNote, /multi-axis/u);
  assert.match(preview.attributionNote, /not be attributed to one variable/u);

  const single = matrixPreview([{ axis: 'harness', variants: 2 }]);
  assert.equal(single.singleVariableAttributionAllowed, true);
});

