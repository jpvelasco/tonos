export interface RecordedTrial {
  declarationId: string;
  harnessId: string;
  harnessVersion: string;
  adapterContractVersion: number;
  effectiveConfigDigest: string;
  providerProtocol: string;
  servedModelId: string;
  suiteId: string;
  suiteRevision: string;
  terminalState: 'passed' | 'failed' | 'timed-out' | 'cancelled' | 'unsupported' | 'invalid';
  verificationPassed: boolean;
  totalWallMs: number;
}

export interface Comparability {
  comparable: boolean;
  reason?: string | undefined;
}

const IDENTITY_AXES: Array<{
  label: string;
  pick: (t: RecordedTrial) => string | number;
}> = [
  { label: 'harness identity', pick: (t) => t.harnessId },
  { label: 'harness version', pick: (t) => t.harnessVersion },
  {
    label: 'adapter contract version',
    pick: (t) => t.adapterContractVersion,
  },
  {
    label: 'effective configuration',
    pick: (t) => t.effectiveConfigDigest,
  },
  { label: 'provider protocol', pick: (t) => t.providerProtocol },
  { label: 'served model observation', pick: (t) => t.servedModelId },
  { label: 'task suite revision', pick: (t) => `${t.suiteId}@${t.suiteRevision}` },
];

export function comparabilityOf(a: RecordedTrial, b: RecordedTrial): Comparability {
  for (const axis of IDENTITY_AXES) {
    if (axis.pick(a) !== axis.pick(b)) {
      return {
        comparable: false,
        reason: `incomparable: ${axis.label} differs (${String(axis.pick(a))} vs ${String(axis.pick(b))})`,
      };
    }
  }
  return { comparable: true };
}

export interface TrialSummary {
  declarationId: string;
  samples: number;
  failures: number;
  passRate: number;
  wallMsMedian: number;
  wallMsMin: number;
  wallMsMax: number;
}

export function aggregateTrial(
  declarationId: string,
  results: RecordedTrial[],
): TrialSummary {
  if (results.length === 0) {
    throw new RangeError('cannot aggregate zero repetitions');
  }
  const walls = results.map((r) => r.totalWallMs).sort((a, b) => a - b);
  const failures = results.filter(
    (r) =>
      r.terminalState !== 'passed' ||
      r.verificationPassed === false,
  ).length;
  const mid = Math.floor(walls.length / 2);
  const median =
    walls.length % 2 === 1
      ? (walls[mid] as number)
      : Math.round(((walls[(mid ?? 1) - 1] ?? 0) + (walls[mid] ?? 0)) / 2);

  return {
    declarationId,
    samples: results.length,
    failures,
    passRate: Number(((results.length - failures) / results.length).toFixed(4)),
    wallMsMedian: median,
    wallMsMin: walls[0] ?? 0,
    wallMsMax: walls[walls.length - 1] ?? 0,
  };
}

export interface QualificationPolicy {
  minPassRate: number;
  requireVerification: boolean;
}

export interface Exclusion {
  declarationId: string;
  reason: string;
}

export interface QualificationOutcome {
  outcome: 'winner' | 'no-winner';
  winnerDeclarationId: string | null;
  exclusions: Exclusion[];
  explanations: string[];
}

export function evaluatePolicy(
  policy: QualificationPolicy,
  summaries: TrialSummary[],
): QualificationOutcome {
  const exclusions: Exclusion[] = [];
  const eligible: TrialSummary[] = [];

  for (const summary of summaries) {
    if (summary.failures > 0 && policy.requireVerification) {
      exclusions.push({
        declarationId: summary.declarationId,
        reason: `failed or unverified in ${summary.failures}/${summary.samples} repetitions; a fast trial that fails its task can never win`,
      });
      continue;
    }
    if (summary.passRate < policy.minPassRate) {
      exclusions.push({
        declarationId: summary.declarationId,
        reason: `pass rate ${summary.passRate} below policy minimum ${policy.minPassRate}`,
      });
      continue;
    }
    eligible.push(summary);
  }

  if (eligible.length === 0) {
    return {
      outcome: 'no-winner',
      winnerDeclarationId: null,
      exclusions,
      explanations: [
        'no trial satisfied the policy gates; reporting an explicit no-winner instead of promoting a failure',
      ],
    };
  }

  // Among eligible trials the fastest median wall time wins, honestly
  // reported with sample counts and dispersion.
  const sorted = [...eligible].sort((x, y) => x.wallMsMedian - y.wallMsMedian);
  const winner = sorted[0];
  if (winner === undefined || sorted.length === 0) {
    return {
      outcome: 'no-winner',
      winnerDeclarationId: null,
      exclusions,
      explanations: ['empty candidate set'],
    };
  }

  return {
    outcome: 'winner',
    winnerDeclarationId: winner.declarationId,
    exclusions,
    explanations: [
      `won with median ${winner.wallMsMin === winner.wallMsMax ? winner.wallMsMax : `${winner.wallMsMedian} ms`} over ${winner.samples} repetition(s); dispersion ${winner.wallMsMin}-${winner.wallMsMax} ms`,
      ...sorted.slice(1).map(
        (s) =>
          `candidate ${s.declarationId.slice(0, 16)}… median ${s.wallMsMedian} ms`,
      ),
    ],
  };
}

export interface MatrixAxisPreview {
  axis: string;
  variants: number;
}

export interface MatrixPreview {
  axes: MatrixAxisPreview[];
  singleVariableAttributionAllowed: boolean;
  attributionNote: string;
}

export function matrixPreview(axes: MatrixAxisPreview[]): MatrixPreview {
  const varying = axes.filter((a) => a.variants > 1);
  const multiAxis = varying.length > 1;
  return {
    axes,
    singleVariableAttributionAllowed: !multiAxis,
    attributionNote: multiAxis
      ? `multi-axis matrix (${varying.map((a) => a.axis).join(' × ')}): observed differences must not be attributed to one variable`
      : 'single experimental axis; differences are attributable to that axis',
  };
}
