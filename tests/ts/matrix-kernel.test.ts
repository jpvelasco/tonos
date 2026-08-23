import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  matrixDigestOf,
  unitsOf,
  unitKeyOf,
  parseUnitKey,
  resultPathFor,
} from '../../core/matrix/units.ts';
import {
  MatrixCheckpoint,
  serializeCheckpoint,
  type CheckpointDoc,
} from '../../core/matrix/checkpoint.ts';
import {
  planNext,
  adoptOrDemote,
  type ScheduleEntry,
} from '../../core/matrix/scheduler.ts';
import {
  projectRecordedTrial,
  analyzeResults,
} from '../../core/matrix/project.ts';
import { encode, decode } from '../../core/codec.ts';
import type { QualificationDecision } from '../../core/records/matrix.ts';
import type { TrialResult } from '../../core/records/trial.ts';
import { trialIdOf } from '../../core/records/trial.ts';
import { fixtureTrialDeclaration } from '../fixtures/records.ts';

// --- fixtures -------------------------------------------------------------

function declarationWith(overrides?: {
  harnessVersion?: string;
  suiteRevision?: string;
  repetitionTotal?: number;
}) {
  const mutated = fixtureTrialDeclaration();
  if (overrides?.harnessVersion !== undefined) {
    mutated.harness.version = overrides.harnessVersion;
  }
  if (overrides?.suiteRevision !== undefined) {
    mutated.taskSuite.revision = overrides.suiteRevision;
  }
  if (overrides?.repetitionTotal !== undefined) {
    mutated.repetition = { index: 0, total: overrides.repetitionTotal };
  }
  const { trialId: _stale, ...payload } = mutated;
  return { ...payload, trialId: trialIdOf(payload) };
}

function syntheticMatrix(declarations: ReturnType<typeof declarationWith>[]) {
  return {
    matrixId: 'fixture-matrix',
    policyRevision: '0.1.0',
    axes: [{ axis: 'harness' as const, variants: declarations.length }],
    declarations: declarations.map(({ trialId: _stripped, ...payload }) => payload),
    createdAt: '1970-01-01T00:00:00.000Z',
  };
}

function passedResult(declarationId: string, totalWallMs: number): TrialResult {
  return {
    declarationId,
    observedHarnessVersion: '1.4.2',
    observedProviderProfileId: 'local-fixture-endpoint',
    observedServedModelId: 'test-model@2026-08-01',
    terminalState: 'passed',
    startedAt: '1970-01-01T00:00:00.000Z',
    finishedAt: '1970-01-01T00:01:00.000Z',
    phaseDurationsMs: { invoke: totalWallMs },
    clientTiming: { totalWallMs },
    toolEvents: [],
    workspaceAfterDigest: null,
    evaluatorOutcomes: [
      { evaluatorId: 'executable-tests', passed: true, subjective: false },
    ],
    verificationExit: 0,
    errors: [],
    missingEvidence: [],
    redactionReport: { removedCategories: [] },
    artifactDigests: {},
  };
}

// --- units ----------------------------------------------------------------

test('units are derived in deterministic declaration-major, repetition-minor order', () => {
  const a = declarationWith({ repetitionTotal: 2 });
  const b = declarationWith({ repetitionTotal: 1 });
  b.harness.version = '9.9.9';
  const matrix = syntheticMatrix([b, a]);

  const units = unitsOf(matrix);

  assert.equal(units.length, 3);
  const distinctIds = new Set(units.map((u) => u.declarationId));
  assert.equal(distinctIds.size, 2, 'both declarations contribute units');
  for (let i = 1; i < units.length; i++) {
    if (units[i]!.declarationId === units[i - 1]!.declarationId) {
      assert.equal(
        units[i]!.repetitionIndex,
        units[i - 1]!.repetitionIndex + 1,
        'repetitions of one declaration must be contiguous and ascending',
      );
    }
  }
  assert.deepEqual(
    [...units].sort((x, y) => (unitKeyOf(x) < unitKeyOf(y) ? -1 : 1)).map(unitKeyOf),
    units.map(unitKeyOf),
    'derived order must already be key-sorted for deterministic prefixes',
  );
});

test('matrix digest ignores creation time but binds every identity input', () => {
  const base = syntheticMatrix([declarationWith()]);
  const later = { ...base, createdAt: '2000-01-01T00:00:00.000Z' };
  assert.equal(matrixDigestOf(base), matrixDigestOf(later));

  const edited = syntheticMatrix([declarationWith({ harnessVersion: '2.0.0' })]);
  assert.notEqual(matrixDigestOf(base), matrixDigestOf(edited));

  const repolicy = { ...base, policyRevision: '0.2.0' };
  assert.notEqual(matrixDigestOf(base), matrixDigestOf(repolicy));
});

test('unit keys round-trip and artifact paths stay repo-relative', () => {
  const unit = unitsOf(syntheticMatrix([declarationWith()]))[0]!;
  const key = unitKeyOf(unit);
  assert.deepEqual(parseUnitKey(key), unit);

  const path = resultPathFor(unit);
  assert.match(path, /^results\/trn_trial_[0-9a-f]{64}\/rep-\d+\.json$/u);
});

// --- checkpoint schema ----------------------------------------------------

test('checkpoint documents round-trip and reject incomplete claims', () => {
  const k0 = `trn_trial_${'0'.repeat(64)}~rep0`;
  const k1 = `trn_trial_${'0'.repeat(64)}~rep1`;
  const k2 = `trn_trial_${'0'.repeat(64)}~rep2`;
  const doc: CheckpointDoc = {
    checkpointVersion: 1,
    matrixDigest: 'a'.repeat(64),
    units: {
      [k0]: { state: 'pending' },
      [k1]: {
        state: 'done',
        artifactPath: 'results/x/rep-1.json',
        artifactDigest: 'b'.repeat(64),
      },
      [k2]: {
        state: 'schedule-failed',
        reasonClass: 'workspace-create',
      },
    },
  };

  const parsed = MatrixCheckpoint.parse(JSON.parse(serializeCheckpoint(doc)));
  assert.equal(parsed.units[k1]?.state, 'done');

  assert.throws(() =>
    MatrixCheckpoint.parse({
      checkpointVersion: 1,
      matrixDigest: 'a'.repeat(64),
      units: {
        [k0]: { state: 'done', artifactPath: 'p.json' },
      },
    }),
    'done without an artifact digest must be rejected',
  );

  assert.throws(() =>
    MatrixCheckpoint.parse({
      checkpointVersion: 1,
      matrixDigest: 'a'.repeat(64),
      units: {
        [k0]: { state: 'schedule-failed' },
      },
    }),
    'schedule-failed without a reason class must be rejected',
  );
});

// --- scheduler ------------------------------------------------------------

test('planNext dispatches pending units in declared order under the concurrency cap', () => {
  const entries = new Map<string, ScheduleEntry>([
    ['u1', { state: 'done', artifactDigest: 'a'.repeat(64) }],
    ['u2', { state: 'running' }],
    ['u3', { state: 'pending' }],
    ['u4', { state: 'pending' }],
    ['u5', { state: 'schedule-failed', reasonClass: 'workspace-create' }],
  ]);
  const order = ['u1', 'u2', 'u3', 'u4', 'u5'];

  assert.deepEqual(planNext(entries, 3, order), ['u3', 'u4']);
  assert.deepEqual(planNext(entries, 2, order), ['u3']);
  assert.deepEqual(planNext(entries, 1, order), []);
  assert.deepEqual(planNext(entries, 0, order), []);

  const allSettled = new Map<string, ScheduleEntry>([
    ['u3', { state: 'pending' }],
    ['u4', { state: 'pending' }],
  ]);
  assert.deepEqual(planNext(allSettled, 2, order.slice(2)), ['u3', 'u4']);
});

test('reconciliation adopts verified artifacts over stale claims and demotes everything else to pending', () => {
  const digest = 'c'.repeat(64);
  assert.deepEqual(
    adoptOrDemote({ state: 'running' }, 'valid', digest),
    { state: 'done', artifactDigest: digest },
    'an artifact that verifies is adopted even over a stale running claim',
  );
  assert.deepEqual(adoptOrDemote(undefined, 'missing', digest).state, 'pending');
  assert.deepEqual(
    adoptOrDemote({ state: 'done', artifactDigest: 'd'.repeat(64) }, 'corrupt', digest)
      .state,
    'pending',
  );
  assert.deepEqual(
    adoptOrDemote(
      { state: 'schedule-failed', reasonClass: 'workspace-create' },
      'missing',
      digest,
    ).state,
    'pending',
    'failure claims need their backing record too; otherwise a tampered checkpoint could silently drop units',
  );
});

// --- projection -----------------------------------------------------------

test('recorded trials project codec-relevant identity plus honest verification status', () => {
  const declaration = declarationWith();
  const result = passedResult(declaration.trialId, 1_500);

  const projected = projectRecordedTrial(declaration, result);
  assert.equal(projected.declarationId, declaration.trialId);
  assert.equal(projected.harnessVersion, '1.4.2');
  assert.equal(projected.adapterContractVersion, 1);
  assert.equal(projected.suiteRevision, '0.1.0');
  assert.equal(projected.totalWallMs, 1_500);
  assert.equal(projected.verificationPassed, true);

  const unverified: TrialResult = {
    ...result,
    verificationExit: null,
    evaluatorOutcomes: [],
  };
  assert.equal(
    projectRecordedTrial(declaration, unverified).verificationPassed,
    false,
    'no verification evidence must never masquerade as verified',
  );

  const failedVerification: TrialResult = {
    ...result,
    verificationExit: 1,
  };
  assert.equal(
    projectRecordedTrial(declaration, failedVerification).verificationPassed,
    false,
  );
});

// --- analysis -------------------------------------------------------------

test('analysis produces a codec-valid decision with classified exclusions and honest comparability', () => {
  const fast = declarationWith({ repetitionTotal: 2 });
  const slow = declarationWith({ repetitionTotal: 2, harnessVersion: '1.4.3' });
  const broken = declarationWith({ repetitionTotal: 1, harnessVersion: '1.4.4' });
  const foreign = declarationWith({ repetitionTotal: 1, suiteRevision: '9.9.9' });

  const results = new Map<string, TrialResult[]>([
    [fast.trialId, [passedResult(fast.trialId, 1_000), passedResult(fast.trialId, 1_400)]],
    [slow.trialId, [passedResult(slow.trialId, 2_000), passedResult(slow.trialId, 2_400)]],
    [broken.trialId, []],
    [
      foreign.trialId,
      [
        {
          ...passedResult(foreign.trialId, 500),
          terminalState: 'failed' as const,
          verificationExit: null,
          evaluatorOutcomes: [],
        },
      ],
    ],
  ]);

  const { decision } = analyzeResults({
    matrix: syntheticMatrix([fast, slow, broken, foreign]),
    clock: { nowIso: () => '1970-01-01T00:05:00.000Z', monotonicMs: () => 0 },
    policy: { minPassRate: 1, requireVerification: true },
    results,
  });

  const decoded = decode<QualificationDecision>(
    'qualificationDecision',
    encode('qualificationDecision', decision),
  );

  // The foreign-suite trial is incomparable with every other declaration.
  assert.equal(decoded.comparableTrialCount, 2);
  assert.equal(decoded.winnerDeclarationId, fast.trialId);

  const classes = Object.fromEntries(
    decoded.exclusions.map((e) => [e.declarationId.slice(-6), e.reasonClass]),
  );
  assert.equal(classes[broken.trialId.slice(-6)], 'no-samples');
  assert.equal(classes[foreign.trialId.slice(-6)], 'failed-or-unverified');

  assert.ok(decoded.gates.length > 0);
  assert.ok(decoded.tradeoffsAndLimitations.length > 0);
  assert.ok(decoded.tradeoffsAndLimitations.length <= 2048);
});
