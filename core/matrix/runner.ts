import { encode } from '../codec.ts';
import { sha256Hex } from '../canonical.ts';
import type {
  QualificationDecision,
  TrialMatrix,
} from '../records/matrix.ts';
import {
  trialIdOf,
  type TrialDeclarationPayload,
  type TrialResult,
} from '../records/trial.ts';
import type { Clock } from '../ports.ts';
import type { OperatorCancellation } from '../trial-runner.ts';
import type { QualificationPolicy } from '../comparison/engine.ts';
import { MatrixCheckpoint, serializeCheckpoint } from './checkpoint.ts';
import type { CheckpointDoc, CheckpointUnit } from './checkpoint.ts';
import { analyzeResults, type MatrixAnalysis } from './project.ts';
import { adoptOrDemote, planNext } from './scheduler.ts';
import {
  matrixDigestOf,
  resultPathFor,
  scheduleFailurePathFor,
  unitKeyOf,
  unitsOf,
} from './units.ts';

export interface MatrixStorePort {
  readText(relativePath: string): Promise<string | null>;
  writeAtomic(relativePath: string, contents: string): Promise<void>;
}

export type UnitOutcome =
  | { kind: 'result'; document: TrialResult }
  | { kind: 'schedule-failed'; reasonClass: string; detail: string };

export interface MatrixUnitExecutorPort {
  executeUnit(
    unit: { declarationId: string; repetitionIndex: number },
    declaration: TrialDeclarationPayload,
    cancellation: OperatorCancellation,
  ): Promise<UnitOutcome>;
}

export interface MatrixExecuteOptions {
  maxConcurrentTrials?: number | undefined;
  cancellation?: OperatorCancellation | undefined;
}

export interface MatrixExecuteReport {
  matrixDigest: string;
  completed: boolean;
  done: number;
  scheduleFailed: number;
  pendingRemaining: number;
}

const CHECKPOINT_PATH = 'checkpoint.json';
const DECISION_PATH = 'qualification.json';

const NO_CANCEL: OperatorCancellation = {
  requestCancel() {},
  onCancel() {},
  get requested(): boolean {
    return false;
  },
};

export class MatrixRunner {
  constructor(
    private readonly store: MatrixStorePort,
    private readonly executor: MatrixUnitExecutorPort,
    private readonly clock: Clock,
  ) {}

  async run(
    matrix: TrialMatrix,
    options?: MatrixExecuteOptions,
  ): Promise<MatrixExecuteReport> {
    const digest = matrixDigestOf(matrix);
    const units = unitsOf(matrix);
    const order = units.map(unitKeyOf);
    const declarations = new Map<string, TrialDeclarationPayload>();
    for (const payload of matrix.declarations) {
      declarations.set(trialIdOf(payload), payload);
    }

    const entries = await this.reconcile(units, digest);
    const limit = Math.min(
      options?.maxConcurrentTrials ?? Number.POSITIVE_INFINITY,
      effectiveSuiteLimit(matrix),
    );

    for (;;) {
      if (options?.cancellation?.requested === true) break;
      const batch = planNext(entries, limit, order);
      if (batch.length === 0) break;

      for (const key of batch) {
        entries.get(key)!.state = 'running';
      }
      await this.saveCheckpoint(digest, entries);

      await Promise.allSettled(
        batch.map(async (key) => {
          const outcome = await this.executeOne(key, declarations, options);
          entries.set(key, outcome);
          await this.saveCheckpoint(digest, entries);
        }),
      );
    }

    return reportOf(digest, order, entries);
  }

  async qualify(
    matrix: TrialMatrix,
    policy?: QualificationPolicy | undefined,
  ): Promise<QualificationDecision> {
    const results = new Map<string, TrialResult[]>();
    let missing = 0;
    for (const unit of unitsOf(matrix)) {
      const text = await this.store.readText(resultPathFor(unit));
      if (text === null) {
        missing += 1;
        continue;
      }
      let parsed: TrialResult;
      try {
        parsed = JSON.parse(text) as TrialResult;
      } catch {
        throw new Error(
          `cannot qualify: artifact for ${unitKeyOf(unit)} is not valid JSON`,
        );
      }
      const bucket = results.get(parsed.declarationId) ?? [];
      bucket.push(parsed);
      results.set(parsed.declarationId, bucket);
    }
    if (missing > 0) {
      throw new Error(`cannot qualify: ${missing} unit(s) have no result artifact yet`);
    }

    const analysis = this.analyze(matrix, results, policy);
    await this.store.writeAtomic(
      DECISION_PATH,
      encode('qualificationDecision', analysis.decision),
    );
    return analysis.decision;
  }

  private analyze(
    matrix: TrialMatrix,
    results: ReadonlyMap<string, readonly TrialResult[]>,
    policy?: QualificationPolicy | undefined,
  ): MatrixAnalysis {
    return analyzeResults({
      matrix,
      clock: this.clock,
      policy: policy ?? { minPassRate: 1, requireVerification: true },
      results,
    });
  }

  private async reconcile(
    units: ReturnType<typeof unitsOf>,
    digest: string,
  ): Promise<Map<string, CheckpointUnit>> {
    const claimed = await this.loadCheckpoint(digest);
    const entries = new Map<string, CheckpointUnit>();
    for (const unit of units) {
      const key = unitKeyOf(unit);
      entries.set(key, await this.verifyClaim(unit, claimed.units[key]));
    }
    return entries;
  }

  private async verifyClaim(
    unit: ReturnType<typeof unitsOf>[number],
    claim: CheckpointUnit | undefined,
  ): Promise<CheckpointUnit> {
    if (claim === undefined || claim.state === 'pending' || claim.state === 'running') {
      return { state: 'pending' };
    }
    if (claim.state === 'done') {
      const verification = await this.verifyArtifact(
        claim.artifactPath,
        claim.artifactDigest,
        unit,
      );
      return adoptOrDemote(claim, verification.verification, verification.digest);
    }
    const record = await this.store.readText(scheduleFailurePathFor(unit));
    if (record === null) return { state: 'pending' };
    return { state: 'schedule-failed', reasonClass: claim.reasonClass };
  }

  private async verifyArtifact(
    path: string | undefined,
    expectedDigest: string | undefined,
    unit: { declarationId: string; repetitionIndex: number },
  ): Promise<{ verification: 'valid' | 'missing' | 'corrupt'; digest: string }> {
    if (
      path === undefined ||
      expectedDigest === undefined ||
      path !== resultPathFor(unit)
    ) {
      return { verification: 'missing', digest: '' };
    }
    const text = await this.store.readText(path);
    if (text === null) return { verification: 'missing', digest: '' };
    const actual = sha256Hex(text);
    if (actual !== expectedDigest) {
      return { verification: 'corrupt', digest: actual };
    }
    return { verification: 'valid', digest: actual };
  }

  private async loadCheckpoint(digest: string): Promise<CheckpointDoc> {
    const text = await this.store.readText(CHECKPOINT_PATH);
    if (text !== null) {
      let raw: unknown;
      try {
        raw = JSON.parse(text);
      } catch {
        raw = undefined;
      }
      const parsed = MatrixCheckpoint.safeParse(raw);
      if (parsed.success && parsed.data.matrixDigest === digest) {
        return parsed.data;
      }
    }
    return { checkpointVersion: 1, matrixDigest: digest, units: {} };
  }

  private async saveCheckpoint(
    digest: string,
    entries: ReadonlyMap<string, CheckpointUnit>,
  ): Promise<void> {
    const doc: CheckpointDoc = {
      checkpointVersion: 1,
      matrixDigest: digest,
      units: Object.fromEntries(entries),
    };
    MatrixCheckpoint.parse(doc);
    await this.store.writeAtomic(CHECKPOINT_PATH, serializeCheckpoint(doc));
  }

  private async executeOne(
    key: string,
    declarations: ReadonlyMap<string, TrialDeclarationPayload>,
    options?: MatrixExecuteOptions,
  ): Promise<CheckpointUnit> {
    const declaration = declarations.get(declarationIdOf(key))!;
    const unit = {
      declarationId: declarationIdOf(key),
      repetitionIndex: repIndexOf(key),
    };
    try {
      const outcome = await this.executor.executeUnit(
        unit,
        declaration,
        options?.cancellation ?? NO_CANCEL,
      );
      if (outcome.kind === 'schedule-failed') {
        await this.store.writeAtomic(
          scheduleFailurePathFor(unit),
          JSON.stringify({
            unitKey: key,
            reasonClass: outcome.reasonClass,
            detail: outcome.detail.slice(0, 256),
            recordedAt: this.clock.nowIso(),
          }),
        );
        return { state: 'schedule-failed', reasonClass: outcome.reasonClass };
      }
      const encoded = encode('trialResult', outcome.document);
      const path = resultPathFor(unit);
      await this.store.writeAtomic(path, encoded);
      return {
        state: 'done',
        artifactPath: path,
        artifactDigest: sha256Hex(encoded),
      };
    } catch (cause) {
      return {
        state: 'schedule-failed',
        reasonClass: 'executor-error',
        detail: String(cause).slice(0, 256),
      };
    }
  }
}

function effectiveSuiteLimit(matrix: TrialMatrix): number {
  let minimum = Number.POSITIVE_INFINITY;
  for (const payload of matrix.declarations) {
    const value = payload.taskSuite.limits.maxConcurrentTrials;
    if (value < minimum) minimum = value;
  }
  return minimum === Number.POSITIVE_INFINITY ? 1 : minimum;
}

function reportOf(
  digest: string,
  order: readonly string[],
  entries: ReadonlyMap<string, CheckpointUnit>,
): MatrixExecuteReport {
  let done = 0;
  let scheduleFailed = 0;
  let pendingRemaining = 0;
  for (const key of order) {
    const entry = entries.get(key);
    if (entry?.state === 'done') done += 1;
    else if (entry?.state === 'schedule-failed') scheduleFailed += 1;
    else pendingRemaining += 1;
  }
  return {
    matrixDigest: digest,
    completed: pendingRemaining === 0,
    done,
    scheduleFailed,
    pendingRemaining,
  };
}

function declarationIdOf(key: string): string {
  return key.slice(0, key.indexOf('~'));
}

function repIndexOf(key: string): number {
  return Number(key.slice(key.indexOf('~rep') + '~rep'.length));
}
