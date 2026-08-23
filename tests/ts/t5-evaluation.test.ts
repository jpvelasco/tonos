import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createT5Evaluation } from '../../adapters/evaluators/t5-evaluation.ts';
import { composeTrialResult } from '../../core/result-composition.ts';
import { encode, decode } from '../../core/codec.ts';
import type { TrialResult } from '../../core/records/trial.ts';
import { fixtureTrialDeclaration } from '../fixtures/records.ts';
import type { EvaluationHook } from '../../core/trial-runner.ts';

const DECLARATION = fixtureTrialDeclaration();

function snapshot(inputDigest: string, files: Record<string, string>) {
  return {
    inputDigest,
    fileCount: Object.keys(files).length,
    files: Object.fromEntries(
      Object.entries(files).map(([path, digest]) => [path, { digest, lines: 1 }]),
    ),
  };
}

function hookContext(overrides?: Partial<Parameters<EvaluationHook>[0]>) {
  return {
    workspaceRoot: '.',
    evaluatorIds: ['tool-trace', 'workspace-assertions'],
    toolEvents: [{ tool: 'read-file', ok: true }],
    before: snapshot('a'.repeat(64), { 'README.md': 'x'.repeat(64) }),
    after: snapshot('b'.repeat(64), {
      'README.md': 'y'.repeat(64),
      'notes.txt': 'z'.repeat(64),
    }),
    ...overrides,
  };
}

test('T5 evaluators produce canonical outcomes that survive result composition', async () => {
  const hook = createT5Evaluation({
    tracePolicy: { expectedOrder: ['read-file'] },
    writablePaths: ['README.md', 'notes.txt'],
  });
  const evaluation = await hook(hookContext());

  assert.deepEqual(evaluation.outcomes, [
    { evaluatorId: 'tool-trace', passed: true, subjective: false },
    { evaluatorId: 'workspace-assertions', passed: true, subjective: false },
  ]);

  const output = {
    trialId: DECLARATION.trialId,
    terminalState: 'passed' as const,
    startedAt: '1970-01-01T00:00:00.000Z',
    finishedAt: '1970-01-01T00:01:00.000Z',
    totalWallMs: 1_000,
    invokeWallMs: 900,
    toolEvents: [{ tool: 'read-file', ok: true }],
    missingEvidence: [],
    errorMessages: [],
    workspaceDiff: { filesChanged: 1, insertions: 1, deletions: 0 },
    workspaceAfterDigest: 'b'.repeat(64),
    evaluatorOutcomes: evaluation.outcomes,
    verificationExit: evaluation.verificationExit ?? null,
    cleanupComplete: true,
  };
  const decoded = decode<TrialResult>(
    'trialResult',
    encode('trialResult', composeTrialResult({ output, declaration: DECLARATION })),
  );
  assert.deepEqual(decoded.evaluatorOutcomes, [
    { evaluatorId: 'tool-trace', passed: true, subjective: false },
    { evaluatorId: 'workspace-assertions', passed: true, subjective: false },
  ]);
});

test('declared evaluators without derivable parameters report no verdict instead of a vacuous pass', async () => {
  const hook = createT5Evaluation();
  const evaluation = await hook(
    hookContext({
      evaluatorIds: ['tool-trace', 'workspace-assertions', 'mystery-check'],
    }),
  );

  assert.deepEqual(evaluation.outcomes, [
    { evaluatorId: 'tool-trace', passed: null, subjective: false },
    { evaluatorId: 'workspace-assertions', passed: null, subjective: false },
    { evaluatorId: 'mystery-check', passed: null, subjective: false },
  ]);
});

test('trace violations and out-of-policy edits are honest failures', async () => {
  const hook = createT5Evaluation({
    tracePolicy: { forbidden: ['apply-diff'], requiredLast: 'run-tests' },
    writablePaths: [],
  });
  const evaluation = await hook(
    hookContext({
      toolEvents: [
        { tool: 'read-file', ok: true },
        { tool: 'apply-diff', ok: true },
      ],
    }),
  );

  assert.deepEqual(
    evaluation.outcomes.map((outcome) => outcome.passed),
    [false, false],
  );
});
