import { test } from 'node:test';
import assert from 'node:assert/strict';

import { composeTrialResult } from '../../core/result-composition.ts';
import { encode, decode } from '../../core/codec.ts';
import { trialIdOf } from '../../core/records/trial.ts';
import type { TrialResult } from '../../core/records/trial.ts';
import { fixtureTrialDeclaration } from '../fixtures/records.ts';
import type { TrialRunOutput } from '../../core/trial-runner.ts';

function fixtureRunOutput(overrides?: Partial<TrialRunOutput>): TrialRunOutput {
  const declaration = fixtureTrialDeclaration();
  return {
    trialId: declaration.trialId,
    terminalState: 'passed',
    startedAt: '1970-01-01T00:00:00.000Z',
    finishedAt: '1970-01-01T00:01:30.000Z',
    totalWallMs: 90_100,
    invokeWallMs: 89_000,
    toolEvents: [
      { tool: 'read-file', ok: true },
      { tool: 'apply-diff', ok: true },
    ],
    missingEvidence: [],
    errorMessages: [],
    workspaceDiff: { filesChanged: 2, insertions: 14, deletions: 3 },
    workspaceAfterDigest: 'c'.repeat(64),
    evaluatorOutcomes: [
      { evaluatorId: 'executable-tests', passed: true, subjective: false },
      { evaluatorId: 'tool-trace', passed: true, subjective: false },
    ],
    verificationExit: 0,
    cleanupComplete: true,
    ...overrides,
  };
}

test('runner output composes into a codec-valid canonical TrialResult with tamper-evident declaration linkage', () => {
  const declaration = fixtureTrialDeclaration();
  const result = composeTrialResult({
    output: fixtureRunOutput(),
    declaration,
  });

  const encoded = encode('trialResult', result);
  const decoded = decode<TrialResult>('trialResult', encoded);

  assert.equal(decoded.declarationId, trialIdOf(declaration));
  assert.equal(decoded.terminalState, 'passed');
  assert.equal(decoded.observedHarnessVersion, declaration.harness.version);
  assert.equal(decoded.observedProviderProfileId, declaration.provider.profileId);
  assert.equal(decoded.observedServedModelId, declaration.servedModel.providerReportedId);
  assert.equal(decoded.workspaceAfterDigest, 'c'.repeat(64));
  assert.deepEqual(decoded.diffSummary, { filesChanged: 2, insertions: 14, deletions: 3 });
  assert.deepEqual(
    decoded.toolEvents,
    [
      { seq: 0, toolName: 'read-file', ok: true },
      { seq: 1, toolName: 'apply-diff', ok: true },
    ],
  );
  assert.deepEqual(decoded.evaluatorOutcomes, [
    { evaluatorId: 'executable-tests', passed: true, subjective: false },
    { evaluatorId: 'tool-trace', passed: true, subjective: false },
  ]);
  assert.equal(decoded.verificationExit, 0);
  assert.deepEqual(decoded.errors, []);
  assert.ok((decoded.phaseDurationsMs['invoke'] ?? 0) > 0);

  // Tampering with any identity input changes the content-derived id, so a
  // result can never be silently relinked to a different declaration.
  const tampered = {
    ...declaration,
    repetition: { index: 1, total: declaration.repetition.total },
  };
  assert.notEqual(trialIdOf(tampered), decoded.declarationId);
});

test('composition refuses to link an output to a declaration it was not produced from', () => {
  const declaration = fixtureTrialDeclaration();
  const other = fixtureTrialDeclaration();
  other.repetition = { index: 2, total: 3 };
  const output = fixtureRunOutput({ trialId: trialIdOf(other) });

  assert.throws(
    () => composeTrialResult({ output, declaration }),
    /does not match declaration content/u,
  );
});

test('skipped evaluators become declared missing evidence, never fabricated failures or passes', () => {
  const declaration = fixtureTrialDeclaration();
  const result = composeTrialResult({
    output: fixtureRunOutput({
      evaluatorOutcomes: [
        { evaluatorId: 'executable-tests', passed: null, subjective: false },
        { evaluatorId: 'tool-trace', passed: false, subjective: false },
      ],
    }),
    declaration,
  });

  assert.deepEqual(result.evaluatorOutcomes, [
    { evaluatorId: 'tool-trace', passed: false, subjective: false },
  ]);
  assert.ok(
    result.missingEvidence.some((entry) => entry.includes('executable-tests')),
    'a skipped evaluator must be declared as missing evidence',
  );
});

test('non-canonical tool names are recorded as missing evidence instead of breaking the document', () => {
  const declaration = fixtureTrialDeclaration();
  const result = composeTrialResult({
    output: fixtureRunOutput({
      toolEvents: [
        { tool: 'read-file', ok: true },
        { tool: 'Weird_Tool Name!', ok: false },
      ],
    }),
    declaration,
  });

  assert.deepEqual(result.toolEvents, [{ seq: 0, toolName: 'read-file', ok: true }]);
  assert.ok(
    result.missingEvidence.some((entry) => entry.includes('Weird_Tool Name!')),
  );
});
