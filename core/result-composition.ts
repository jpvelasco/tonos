import { trialIdOf } from './records/trial.ts';
import type {
  ErrorClass,
  TrialDeclarationPayload,
  TrialResult,
} from './records/trial.ts';
import type { Slug } from './records/primitives.ts';
import type { TrialRunOutput } from './trial-runner.ts';

const SLUG_PATTERN = /^[a-z][a-z0-9-]{0,63}$/u;

const ERROR_CLASS_BY_STATE: Record<TrialRunOutput['terminalState'], ErrorClass> = {
  passed: 'unknown',
  failed: 'unknown',
  'timed-out': 'timeout',
  cancelled: 'unknown',
  unsupported: 'unknown',
  invalid: 'parse',
};

export function composeTrialResult(input: {
  output: TrialRunOutput;
  declaration: TrialDeclarationPayload;
}): TrialResult {
  const { output, declaration } = input;
  if (output.trialId !== trialIdOf(declaration)) {
    throw new Error(
      'refusing to compose: output trial id does not match declaration content; results must link to the exact declaration that produced them',
    );
  }

  const missingEvidence = [...output.missingEvidence];
  const toolEvents: TrialResult['toolEvents'] = [];
  for (const event of output.toolEvents) {
    if (!SLUG_PATTERN.test(event.tool)) {
      missingEvidence.push(
        bounded(`tool event with non-canonical name was not persisted: ${event.tool}`, 128),
      );
      continue;
    }
    toolEvents.push({
      seq: toolEvents.length,
      toolName: event.tool as Slug,
      ok: event.ok,
    });
  }

  const evaluatorOutcomes: TrialResult['evaluatorOutcomes'] = [];
  for (const outcome of output.evaluatorOutcomes ?? []) {
    if (!SLUG_PATTERN.test(outcome.evaluatorId)) {
      missingEvidence.push(
        bounded(
          `evaluator outcome with non-canonical id was not persisted: ${outcome.evaluatorId}`,
          128,
        ),
      );
      continue;
    }
    if (outcome.passed === null) {
      missingEvidence.push(
        bounded(`evaluator could not run and reported no verdict: ${outcome.evaluatorId}`, 128),
      );
      continue;
    }
    evaluatorOutcomes.push({
      evaluatorId: outcome.evaluatorId as Slug,
      passed: outcome.passed,
      subjective: outcome.subjective,
    });
  }

  return {
    declarationId: output.trialId,
    observedHarnessVersion: declaration.harness.version,
    observedProviderProfileId: declaration.provider.profileId,
    observedServedModelId: declaration.servedModel.providerReportedId,
    terminalState: output.terminalState,
    startedAt: output.startedAt,
    finishedAt: output.finishedAt,
    phaseDurationsMs: {
      invoke: nonNegativeInt(output.invokeWallMs),
      total: nonNegativeInt(output.totalWallMs),
    },
    clientTiming: { totalWallMs: nonNegativeInt(output.totalWallMs) },
    toolEvents,
    workspaceAfterDigest: output.workspaceAfterDigest ?? null,
    diffSummary: {
      filesChanged: nonNegativeInt(output.workspaceDiff.filesChanged),
      insertions: nonNegativeInt(output.workspaceDiff.insertions),
      deletions: nonNegativeInt(output.workspaceDiff.deletions),
    },
    evaluatorOutcomes,
    verificationExit: output.verificationExit ?? null,
    errors: output.errorMessages.map((message) => ({
      errorClass: ERROR_CLASS_BY_STATE[output.terminalState],
      message: bounded(message, 256),
    })),
    missingEvidence: missingEvidence.map((entry) => bounded(entry, 128)).slice(0, 32),
    redactionReport: { removedCategories: [] },
    artifactDigests: {},
  };
}

function bounded(value: string, max: number): string {
  const sliced = value.length > max ? value.slice(0, max) : value;
  return sliced.trim();
}

function nonNegativeInt(value: number): number {
  return Math.max(0, Math.round(value));
}
