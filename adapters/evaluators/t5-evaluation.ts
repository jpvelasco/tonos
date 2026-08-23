import type {
  EvaluationHook,
  RawEvaluatorOutcome,
  TrialEvaluation,
} from '../../core/trial-runner.ts';
import {
  evaluateExecutableTests,
  evaluateToolTrace,
  evaluateWorkspaceAssertions,
} from '../../core/tasks/evaluators.ts';
import type { TracePolicy } from '../../core/tasks/verdicts.ts';

export interface T5EvaluationOptions {
  /** Required for a tool-trace verdict; without it no verdict is claimed. */
  tracePolicy?: TracePolicy | undefined;
  /** Required for workspace-assertions; without it no verdict is claimed. */
  writablePaths?: readonly string[] | undefined;
}

export function createT5Evaluation(
  options: T5EvaluationOptions = {},
): EvaluationHook {
  return async (context): Promise<TrialEvaluation> => {
    const outcomes: RawEvaluatorOutcome[] = [];
    let verificationExit: number | null = null;

    for (const evaluatorId of context.evaluatorIds) {
      switch (evaluatorId) {
        case 'executable-tests': {
          const verdict = await evaluateExecutableTests(context.workspaceRoot);
          outcomes.push({
            evaluatorId: verdict.evaluatorId,
            passed: verdict.passed,
            subjective: false,
          });
          if (typeof verdict.exitCode === 'number') {
            verificationExit = verdict.exitCode;
          }
          break;
        }
        case 'tool-trace': {
          if (options.tracePolicy === undefined) {
            outcomes.push({ evaluatorId, passed: null, subjective: false });
            break;
          }
          const verdict = evaluateToolTrace(
            context.toolEvents.map((event) => ({ tool: event.tool })),
            options.tracePolicy,
          );
          outcomes.push({
            evaluatorId: verdict.evaluatorId,
            passed: verdict.passed,
            subjective: false,
          });
          break;
        }
        case 'workspace-assertions': {
          if (options.writablePaths === undefined) {
            outcomes.push({ evaluatorId, passed: null, subjective: false });
            break;
          }
          const verdict = evaluateWorkspaceAssertions(
            context.before,
            context.after,
            [...options.writablePaths],
          );
          outcomes.push({
            evaluatorId: verdict.evaluatorId,
            passed: verdict.passed,
            subjective: false,
          });
          break;
        }
        default:
          outcomes.push({ evaluatorId, passed: null, subjective: false });
      }
    }

    return { outcomes, verificationExit };
  };
}
