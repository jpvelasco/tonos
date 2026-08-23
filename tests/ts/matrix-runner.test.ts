import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  MatrixRunner,
  type MatrixStorePort,
  type MatrixUnitExecutorPort,
  type UnitOutcome,
} from '../../core/matrix/runner.ts';
import {
  matrixDigestOf,
  unitsOf,
  unitKeyOf,
  resultPathFor,
} from '../../core/matrix/units.ts';
import { serializeCheckpoint } from '../../core/matrix/checkpoint.ts';
import { encode } from '../../core/codec.ts';
import { sha256Hex } from '../../core/canonical.ts';
import {
  createCancellation,
  TrialRunner,
} from '../../core/trial-runner.ts';
import { composeTrialResult } from '../../core/result-composition.ts';
import { createProcessPort } from '../../adapters/process/process-port.ts';
import { FileSystemWorkspacePort } from '../../adapters/workspace/fs-workspace-port.ts';
import { InMemoryConfigurationPort } from '../fixtures/in-memory-config-port.ts';
import { trialIdOf } from '../../core/records/trial.ts';
import type { TrialResult } from '../../core/records/trial.ts';
import { FileSystemMatrixStore } from '../../adapters/matrix/fs-matrix-store.ts';
import { createT5Evaluation } from '../../adapters/evaluators/t5-evaluation.ts';
import { fixtureTrialDeclaration } from '../fixtures/records.ts';

const FIXTURE_HARNESS = new URL(
  '../fixtures/harness/fixture-harness.mjs',
  import.meta.url,
).pathname.replace(/^\/([A-Za-z]:)/u, '$1');

// --- fixtures -------------------------------------------------------------

function declarationWith(overrides?: {
  harnessVersion?: string;
  suiteId?: string;
  maxConcurrentTrials?: number;
  repetitionTotal?: number;
}) {
  const mutated = fixtureTrialDeclaration();
  if (overrides?.harnessVersion !== undefined) {
    mutated.harness.version = overrides.harnessVersion;
  }
  if (overrides?.suiteId !== undefined) {
    mutated.taskSuite.suiteId = overrides.suiteId;
  }
  if (overrides?.maxConcurrentTrials !== undefined) {
    mutated.taskSuite.limits.maxConcurrentTrials = overrides.maxConcurrentTrials;
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

const CLOCK = {
  nowIso: () => '1970-01-01T00:05:00.000Z',
  monotonicMs: () => 0,
};

function resultFor(declarationId: string, wallMs = 1_000): TrialResult {
  return {
    declarationId,
    observedHarnessVersion: '1.4.2',
    observedProviderProfileId: 'local-fixture-endpoint',
    observedServedModelId: 'test-model@2026-08-01',
    terminalState: 'passed',
    startedAt: '1970-01-01T00:00:00.000Z',
    finishedAt: '1970-01-01T00:01:00.000Z',
    phaseDurationsMs: { invoke: wallMs },
    clientTiming: { totalWallMs: wallMs },
    toolEvents: [],
    workspaceAfterDigest: null,
    evaluatorOutcomes: [],
    verificationExit: null,
    errors: [],
    missingEvidence: [],
    redactionReport: { removedCategories: [] },
    artifactDigests: {},
  };
}

class MemoryStore implements MatrixStorePort {
  readonly files = new Map<string, string>();
  async readText(path: string): Promise<string | null> {
    return this.files.get(path) ?? null;
  }
  async writeAtomic(path: string, contents: string): Promise<void> {
    this.files.set(path, contents);
  }
}

let active = 0;
let peak = 0;

class FakeExecutor implements MatrixUnitExecutorPort {
  readonly executed: string[] = [];
  #outcomes = new Map<string, UnitOutcome>();
  #onExecute: ((key: string) => void) | undefined;

  setResult(declarationId: string, result: TrialResult): void {
    this.#outcomes.set(declarationId, { kind: 'result', document: result });
  }
  fail(declarationId: string, reasonClass = 'workspace-create'): void {
    this.#outcomes.set(declarationId, {
      kind: 'schedule-failed',
      reasonClass,
      detail: `${reasonClass} boom`,
    });
  }
  onExecute(handler: (key: string) => void): void {
    this.#onExecute = handler;
  }
  async executeUnit(
    unit: { declarationId: string; repetitionIndex: number },
  ): Promise<UnitOutcome> {
    const key = unitKeyOf(unit);
    this.executed.push(key);
    this.#onExecute?.(key);
    active += 1;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, 5));
    active -= 1;
    const outcome = this.#outcomes.get(unit.declarationId);
    if (outcome === undefined) throw new Error('no outcome scripted');
    return outcome.kind === 'schedule-failed'
      ? outcome
      : { kind: 'result', document: outcome.document };
  }
}

function makeRunner(
  store: MatrixStorePort,
  executor: MatrixUnitExecutorPort,
): MatrixRunner {
  return new MatrixRunner(store, executor, CLOCK);
}

let store: MemoryStore;
let executor: FakeExecutor;

beforeEach(() => {
  store = new MemoryStore();
  executor = new FakeExecutor();
  active = 0;
  peak = 0;
});

// --- execution ------------------------------------------------------------

test('a full run executes every unit once and persists results plus a truthful checkpoint', async () => {
  const a = declarationWith({ repetitionTotal: 2 });
  const b = declarationWith({ repetitionTotal: 1, harnessVersion: '1.4.3' });
  executor.setResult(a.trialId, resultFor(a.trialId));
  executor.setResult(b.trialId, resultFor(b.trialId));

  const report = await makeRunner(store, executor).run(syntheticMatrix([a, b]));

  assert.equal(report.completed, true);
  assert.equal(report.done, 3);
  assert.equal(report.scheduleFailed, 0);
  assert.equal(new Set(executor.executed).size, 3);

  for (const unit of unitsOf(syntheticMatrix([a, b]))) {
    const path = resultPathFor(unit);
    const text = store.files.get(path);
    assert.ok(text !== undefined, `missing artifact ${path}`);
    const decoded = JSON.parse(text!) as { declarationId: string };
    assert.equal(decoded.declarationId, unit.declarationId);
  }

  const checkpoint = JSON.parse(store.files.get('checkpoint.json')!) as {
    units: Record<string, { state: string }>;
  };
  const doneEntries = Object.values(checkpoint.units).filter(
    (u) => u.state === 'done',
  );
  assert.equal(doneEntries.length, 3);
});

test('resume adopts digest-verified artifacts without re-executing their units', async () => {
  const a = declarationWith({ repetitionTotal: 1 });
  const matrix = syntheticMatrix([a]);
  const unit = unitsOf(matrix)[0]!;
  const encoded = encode('trialResult', resultFor(a.trialId));
  store.files.set(resultPathFor(unit), encoded);
  store.files.set(
    'checkpoint.json',
    serializeCheckpoint({
      checkpointVersion: 1,
      matrixDigest: matrixDigestOf(matrix),
      units: {
        [unitKeyOf(unit)]: {
          state: 'done',
          artifactPath: resultPathFor(unit),
          artifactDigest: sha256Hex(encoded),
        },
      },
    }),
  );

  const report = await makeRunner(store, executor).run(matrix);

  assert.deepEqual(executor.executed, [], 'verified work must not re-run');
  assert.equal(report.completed, true);
  assert.equal(report.done, 1);
});

test('corrupt artifacts demote their claims to pending and re-run exactly those units', async () => {
  const a = declarationWith({ repetitionTotal: 2 });
  const matrix = syntheticMatrix([a]);
  const [unitA, unitB] = unitsOf(matrix);
  const goodEncoded = encode('trialResult', resultFor(a.trialId));
  store.files.set(resultPathFor(unitA!), goodEncoded);
  store.files.set(resultPathFor(unitB!), '{"not": "the real bytes"}');
  store.files.set(
    'checkpoint.json',
    serializeCheckpoint({
      checkpointVersion: 1,
      matrixDigest: matrixDigestOf(matrix),
      units: {
        [unitKeyOf(unitA!)]: {
          state: 'done',
          artifactPath: resultPathFor(unitA!),
          artifactDigest: sha256Hex(goodEncoded),
        },
        [unitKeyOf(unitB!)]: {
          state: 'done',
          artifactPath: resultPathFor(unitB!),
          artifactDigest: sha256Hex(goodEncoded),
        },
      },
    }),
  );
  executor.setResult(a.trialId, resultFor(a.trialId));

  const report = await makeRunner(store, executor).run(matrix);

  assert.equal(report.completed, true);
  assert.equal(executor.executed.length, 1, 'only the corrupt unit re-runs');
  assert.notEqual(executor.executed[0], unitKeyOf(unitA!));
});

test('a corrupt checkpoint document forces re-execution even where artifacts exist', async () => {
  const a = declarationWith({ repetitionTotal: 1 });
  const matrix = syntheticMatrix([a]);
  const unit = unitsOf(matrix)[0]!;
  const encoded = encode('trialResult', resultFor(a.trialId));
  store.files.set(resultPathFor(unit), encoded);
  store.files.set('checkpoint.json', '{not json');
  executor.setResult(a.trialId, resultFor(a.trialId));

  // Unverifiable bytes must never be trusted as evidence: without a valid
  // digest-bearing claim the unit re-runs and atomically replaces them.
  const report = await makeRunner(store, executor).run(matrix);

  assert.equal(executor.executed.length, 1);
  assert.equal(report.done, 1);
  const replacement = store.files.get(resultPathFor(unit))!;
  const checkpoint = JSON.parse(
    store.files.get('checkpoint.json')!,
  ) as {
    units: Record<string, { state: string; artifactDigest?: string }>;
  };
  const claim = checkpoint.units[unitKeyOf(unit)]!;
  assert.equal(claim.state, 'done');
  assert.equal(claim.artifactDigest, sha256Hex(replacement));
});

test('schedule failures persist explicit records and survive resume only while backed', async () => {
  const a = declarationWith({ repetitionTotal: 1 });
  const matrix = syntheticMatrix([a]);
  executor.fail(a.trialId, 'workspace-create');

  const first = await makeRunner(store, executor).run(matrix);
  assert.equal(first.scheduleFailed, 1);
  assert.equal(first.completed, true);
  assert.ok(
    [...store.files.keys()].some((path) => path.startsWith('schedule-failures/')),
  );
  const executionsAfterFirstRun = executor.executed.length;

  const second = await makeRunner(store, executor).run(matrix);
  assert.equal(second.scheduleFailed, 1);
  assert.equal(
    executor.executed.length,
    executionsAfterFirstRun,
    'backed failure claims suppress re-execution',
  );

  for (const path of [...store.files.keys()]) {
    if (path.startsWith('schedule-failures/')) store.files.delete(path);
  }
  executor.setResult(a.trialId, resultFor(a.trialId));
  const third = await makeRunner(store, executor).run(matrix);
  assert.equal(third.done, 1);
  assert.equal(third.scheduleFailed, 0);
  assert.equal(executor.executed.length, executionsAfterFirstRun + 1);
});

test('concurrency never exceeds the suite-declared minimum or the operator cap', async () => {
  const a = declarationWith({ maxConcurrentTrials: 4, repetitionTotal: 4 });
  const b = declarationWith({
    suiteId: 'other-suite',
    maxConcurrentTrials: 2,
    harnessVersion: '1.4.3',
    repetitionTotal: 4,
  });
  executor.setResult(a.trialId, resultFor(a.trialId));
  executor.setResult(b.trialId, resultFor(b.trialId));

  const report = await makeRunner(store, executor).run(syntheticMatrix([a, b]), {
    maxConcurrentTrials: 8,
  });

  assert.equal(report.completed, true);
  assert.equal(report.done, 8);
  assert.ok(peak <= 2, `peak concurrency ${peak} exceeded the suite minimum 2`);
});

test('operator cancellation stops dispatch and leaves honest pending state for resume', async () => {
  const cancellation = createCancellation();
  const a = declarationWith({ repetitionTotal: 6, maxConcurrentTrials: 2 });
  executor.setResult(a.trialId, resultFor(a.trialId));
  executor.onExecute(() => {
    if (executor.executed.length >= 2) cancellation.requestCancel();
  });

  const report = await makeRunner(store, executor).run(syntheticMatrix([a]), {
    cancellation,
  });

  assert.equal(report.completed, false);
  assert.ok(report.pendingRemaining > 0);
  assert.equal(executor.executed.length + report.pendingRemaining, 6);

  const resumed = await makeRunner(store, executor).run(syntheticMatrix([a]));
  assert.equal(resumed.completed, true);
  assert.equal(resumed.pendingRemaining, 0);
});

test('qualify loads artifacts fresh and persists a codec-valid decision; it refuses incomplete matrices', async () => {
  const a = declarationWith({ repetitionTotal: 1 });
  const b = declarationWith({ repetitionTotal: 1, harnessVersion: '1.4.3' });
  const matrix = syntheticMatrix([a, b]);
  executor.setResult(a.trialId, {
    ...resultFor(a.trialId, 900),
    verificationExit: 0,
    evaluatorOutcomes: [
      { evaluatorId: 'executable-tests', passed: true, subjective: false },
    ],
  });
  executor.setResult(b.trialId, {
    ...resultFor(b.trialId, 1_800),
    verificationExit: 3,
    evaluatorOutcomes: [
      { evaluatorId: 'executable-tests', passed: false, subjective: false },
    ],
  });

  const runner = makeRunner(store, executor);
  await runner.run(matrix);

  const decision = await runner.qualify(matrix);
  assert.equal(decision.winnerDeclarationId, a.trialId);
  const persisted = store.files.get('qualification.json');
  assert.ok(persisted !== undefined);
  assert.match(persisted!, /"kind":"qualificationDecision"/u);
  assert.match(persisted!, /"schema_version":1/u);

  store.files.delete(resultPathFor(unitsOf(matrix)[0]!));
  await assert.rejects(runner.qualify(matrix), /cannot qualify/u);
});

// --- filesystem store -------------------------------------------------------

test('the filesystem store writes atomically, reads back, and rejects unsafe paths', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tonos-matrix-store-'));
  try {
    const fsStore = new FileSystemMatrixStore(root);
    await fsStore.writeAtomic('results/x/rep-0.json', '{"ok":true}');
    assert.equal(
      await readFile(join(root, 'results/x/rep-0.json'), 'utf8'),
      '{"ok":true}',
    );
    assert.equal(await fsStore.readText('results/x/rep-0.json'), '{"ok":true}');
    assert.equal(await fsStore.readText('missing.json'), null);
    await fsStore.writeAtomic('results/x/rep-0.json', '{"ok":false}');
    assert.equal(await fsStore.readText('results/x/rep-0.json'), '{"ok":false}');

    await assert.rejects(fsStore.writeAtomic('../escape.json', 'x'));
    await assert.rejects(fsStore.writeAtomic('C:\\abs.json', 'x'));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// --- end-to-end: real runner, real workspace/process ports ------------------

test('a fixture matrix runs end-to-end through real ports and qualifies honestly', { timeout: 180_000 }, async () => {
  const template = await mkdtemp(join(tmpdir(), 'tonos-matrix-template-'));
  const root = await mkdtemp(join(tmpdir(), 'tonos-matrix-e2e-'));
  try {
    await writeFile(join(template, 'README.md'), '# fixture repo\n', 'utf8');
    await writeFile(
      join(template, 'go.mod'),
      'module fixture\n\ngo 1.22\n',
      'utf8',
    );
    await writeFile(
      join(template, 'fixture_test.go'),
      'package fixture\n\nimport "testing"\n\nfunc TestOk(t *testing.T) {}\n',
      'utf8',
    );

    const a = declarationWith({ repetitionTotal: 1 });
    const b = declarationWith({ repetitionTotal: 1, harnessVersion: '1.4.3' });
    const matrix = syntheticMatrix([a, b]);

    const evidenceEvents: string[] = [];
    const secretProvider = {
      resolve(reference: string): string {
        return `tonos-secret-canary-${reference}-value`;
      },
    };
    const systemClock = {
      nowIso: () => new Date().toISOString(),
      monotonicMs: () => Date.now(),
    };
    const trialRunner = new TrialRunner(
      createProcessPort(),
      new FileSystemWorkspacePort(),
      new InMemoryConfigurationPort(),
      systemClock,
      secretProvider,
      { append: (e: { kind: string; detail: string }) => void evidenceEvents.push(`${e.kind}: ${e.detail}`), boundedEvents: () => [] },
    );

    class FixtureExecutor implements MatrixUnitExecutorPort {
      readonly executedUnits: string[] = [];
      async executeUnit(
        unit: { declarationId: string; repetitionIndex: number },
        declaration: Parameters<TrialRunner['run']>[0]['declaration'],
        cancellation: Parameters<MatrixUnitExecutorPort['executeUnit']>[2],
      ): Promise<UnitOutcome> {
        this.executedUnits.push(unitKeyOf(unit));
        const output = await trialRunner.run({
          declaration,
          harnessArgv: [process.execPath, FIXTURE_HARNESS, 'tools'],
          workspaceTemplateDir: template,
          cancellation,
          evaluate: createT5Evaluation(),
        });
        return {
          kind: 'result',
          document: composeTrialResult({ output, declaration }),
        };
      }
    }

    const store = new FileSystemMatrixStore(root);
    const executor = new FixtureExecutor();
    const runner = new MatrixRunner(store, executor, systemClock);

    const report = await runner.run(matrix);
    assert.equal(report.completed, true);
    assert.equal(report.done, 2);

    // The fixture suite declares no evaluators, so verification evidence is
    // honestly absent; this policy does not demand it.
    const decision = await runner.qualify(matrix, {
      minPassRate: 1,
      requireVerification: false,
    });
    assert.ok(
      decision.winnerDeclarationId === a.trialId ||
        decision.winnerDeclarationId === b.trialId,
    );

    for (const relative of [
      'checkpoint.json',
      'qualification.json',
      resultPathFor(unitsOf(matrix)[0]!),
      resultPathFor(unitsOf(matrix)[1]!),
    ]) {
      await readFile(join(root, relative), 'utf8');
    }

    // A resumed run adopts everything and re-executes nothing.
    const rerun = new MatrixRunner(store, executor, systemClock);
    const secondReport = await rerun.run(matrix);
    assert.deepEqual(executor.executedUnits.length, 2);
    assert.equal(secondReport.completed, true);
    assert.equal(secondReport.done, 2);

    // No resolved secret value may reach any persisted artifact.
    const secretValue = `tonos-secret-canary-${fixtureTrialDeclaration().provider.secretRefs[0]}-value`;
    for (const relative of ['checkpoint.json', 'qualification.json']) {
      const text = await readFile(join(root, relative), 'utf8');
      assert.ok(!text.includes(secretValue));
    }
  } finally {
    await rm(template, { recursive: true, force: true });
    await rm(root, { recursive: true, force: true });
  }
});
