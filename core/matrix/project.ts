import { canonicalJson, sha256Hex } from '../canonical.ts';
import {
  aggregateTrial,
  evaluatePolicy,
  matrixPreview,
  type QualificationPolicy,
  type RecordedTrial,
  type TrialSummary,
} from '../comparison/engine.ts';
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

export function projectRecordedTrial(
  declaration: TrialDeclarationPayload,
  result: TrialResult,
): RecordedTrial {
  return {
    declarationId: result.declarationId,
    harnessId: declaration.harness.harnessId,
    harnessVersion: result.observedHarnessVersion,
    adapterContractVersion: declaration.harness.adapterContractVersion,
    effectiveConfigDigest: sha256Hex(canonicalJson(declaration.configuration)),
    providerProtocol: declaration.provider.protocolAdapterKind,
    servedModelId: result.observedServedModelId,
    suiteId: declaration.taskSuite.suiteId,
    suiteRevision: declaration.taskSuite.revision,
    terminalState: result.terminalState,
    verificationPassed: verificationPassedOf(result),
    totalWallMs: result.clientTiming.totalWallMs,
  };
}

function verificationPassedOf(result: TrialResult): boolean {
  if (result.verificationExit !== null) {
    return result.verificationExit === 0;
  }
  const objective = result.evaluatorOutcomes.filter(
    (outcome) => !outcome.subjective,
  );
  return objective.length > 0 && objective.every((outcome) => outcome.passed);
}

function classifyPolicyReason(reason: string): string {
  if (reason.startsWith('pass rate')) return 'below-pass-rate';
  if (reason.includes('failed or unverified')) return 'failed-or-unverified';
  return 'policy-exclusion';
}

export interface MatrixAnalysis {
  decision: QualificationDecision;
  summaries: TrialSummary[];
}

export function analyzeResults(input: {
  matrix: TrialMatrix;
  clock: Clock;
  policy: QualificationPolicy;
  results: ReadonlyMap<string, readonly TrialResult[]>;
}): MatrixAnalysis {
  const { matrix, clock, policy } = input;

  const projectedByDeclaration = new Map<
    string,
    { declaration: TrialDeclarationPayload; recorded: RecordedTrial[] }
  >();
  for (const payload of matrix.declarations) {
    const declarationId = trialIdOf(payload);
    const results = input.results.get(declarationId) ?? [];
    projectedByDeclaration.set(declarationId, {
      declaration: payload,
      recorded: results.map((result) =>
        projectRecordedTrial(payload, result),
      ),
    });
  }

  // Direct like-for-like comparison happens between repetitions of the same
  // declaration identity (T6 identity axes); a declaration needs at least two
  // samples for any direct comparison to exist at all.
  let comparableTrialCount = 0;
  for (const group of projectedByDeclaration.values()) {
    if (group.recorded.length >= 2) comparableTrialCount += 1;
  }

  const exclusions: QualificationDecision['exclusions'] = [];
  const summaries: TrialSummary[] = [];
  for (const [declarationId, group] of projectedByDeclaration) {
    if (group.recorded.length === 0) {
      exclusions.push({
        declarationId,
        reasonClass: 'no-samples',
      });
      continue;
    }
    summaries.push(aggregateTrial(declarationId, [...group.recorded]));
  }

  const policyOutcome = evaluatePolicy(policy, summaries);
  for (const exclusion of policyOutcome.exclusions) {
    exclusions.push({
      declarationId: exclusion.declarationId,
      reasonClass: classifyPolicyReason(exclusion.reason),
    });
  }

  const gates = [
    {
      gateId: 'require-verification',
      passed: !exclusions.some((e) => e.reasonClass === 'failed-or-unverified'),
    },
    {
      gateId: 'min-pass-rate',
      passed: !exclusions.some((e) => e.reasonClass === 'below-pass-rate'),
    },
  ];

  const preview = matrixPreview(matrix.axes);
  const tradeoffsAndLimitations = [
    preview.attributionNote,
    ...policyOutcome.explanations,
    'results come from this declared matrix only; never a universal claim',
  ]
    .join(' | ')
    .slice(0, 2_048);

  return {
    decision: {
      matrixId: matrix.matrixId,
      policyRevision: matrix.policyRevision,
      gates,
      comparableTrialCount,
      exclusions,
      winnerDeclarationId: policyOutcome.winnerDeclarationId,
      tradeoffsAndLimitations,
      decidedAt: clock.nowIso(),
    },
    summaries,
  };
}
