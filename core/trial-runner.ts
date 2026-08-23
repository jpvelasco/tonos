import { rm } from 'node:fs/promises';

import type {
  Clock,
  ConfigurationPort,
  EvidenceSink,
  ProcessPort,
  SecretProvider,
  WorkspacePort,
  WorkspaceSnapshot,
} from './ports.ts';
import type { TerminalState } from './records/trial.ts';
import type { TrialDeclarationPayload } from './records/trial.ts';
import { trialIdOf } from './records/trial.ts';

export interface TrialRunRequest {
  declaration: TrialDeclarationPayload;
  harnessArgv: readonly string[];
  workspaceTemplateDir: string;
  secretRefs?: undefined;
  evaluate?: EvaluationHook | undefined;
  cancellation?: OperatorCancellation | undefined;
}

export interface OperatorCancellation {
  requestCancel(): void;
  onCancel(listener: () => void): void;
  readonly requested: boolean;
}

export function createCancellation(): OperatorCancellation {
  const listeners: Array<() => void> = [];
  let fired = false;
  return {
    requestCancel(): void {
      if (fired) return;
      fired = true;
      for (const listener of listeners.splice(0)) listener();
    },
    onCancel(listener: () => void): void {
      if (fired) {
        listener();
        return;
      }
      listeners.push(listener);
    },
    get requested(): boolean {
      return fired;
    },
  };
}

export interface RawEvaluatorOutcome {
  evaluatorId: string;
  /** null means the evaluator could not run and reports no verdict. */
  passed: boolean | null;
  subjective: boolean;
}

export interface TrialEvaluation {
  outcomes: readonly RawEvaluatorOutcome[];
  verificationExit?: number | null | undefined;
}

export interface TrialEvaluationContext {
  workspaceRoot: string;
  evaluatorIds: readonly string[];
  toolEvents: ReadonlyArray<{ tool: string; ok: boolean }>;
  before: WorkspaceSnapshot;
  after: WorkspaceSnapshot;
}

export type EvaluationHook = (
  context: TrialEvaluationContext,
) => Promise<TrialEvaluation>;

export interface TrialRunOutput {
  trialId: string;
  terminalState: TerminalState;
  startedAt: string;
  finishedAt: string;
  totalWallMs: number;
  invokeWallMs: number;
  toolEvents: ReadonlyArray<{ tool: string; ok: boolean }>;
  missingEvidence: readonly string[];
  errorMessages: readonly string[];
  workspaceDiff: { filesChanged: number; insertions: number; deletions: number };
  workspaceAfterDigest: string | null;
  evaluatorOutcomes: readonly RawEvaluatorOutcome[];
  verificationExit: number | null;
  cleanupComplete: boolean;
}

interface OwnedRoot {
  path: string;
  remove(): Promise<void>;
}

export class TrialRunner {
  constructor(
    private readonly processPort: ProcessPort,
    private readonly workspacePort: WorkspacePort,
    private readonly configurationPort: ConfigurationPort,
    private readonly clock: Clock,
    private readonly secrets: SecretProvider,
    private readonly evidence: EvidenceSink,
  ) {}

  async run(request: TrialRunRequest): Promise<TrialRunOutput> {
    const startedAt = this.clock.nowIso();
    const startMs = this.clock.monotonicMs();
    const at = (): number => this.clock.monotonicMs() - startMs;

    const declaration = request.declaration;
    const trialId = trialIdOf(declaration);
    const owned: OwnedRoot[] = [];
    let cleanupComplete = false;

    try {
      const workspaceRoot = await this.workspacePort.createDisposable(
        request.workspaceTemplateDir,
      );
      owned.push({
        path: workspaceRoot,
        remove: () => this.workspacePort.removeOwned(workspaceRoot),
      });
      const before = await this.workspacePort.snapshot(workspaceRoot);
      this.evidence.append({
        atMs: at(),
        kind: 'phase',
        detail: `workspace ready (${before.fileCount} files)`,
      });

      const rendered = await this.configurationPort.renderDisposableRoot(
        declaration.harness.harnessId,
        trialId.slice('trn_trial_'.length, 'trn_trial_'.length + 12),
        declaration.configuration as unknown as Record<string, unknown>,
      );
      owned.push({
        path: rendered.configRoot,
        remove: () => this.configurationPort.removeOwned(rendered.configRoot),
      });

      const childEnv = allowlistedEnvironment();
      const resolvedSecrets: string[] = [];
      for (const ref of declaration.provider.secretRefs) {
        const value = this.secrets.resolve(ref);
        resolvedSecrets.push(value);
        childEnv[secretEnvName(ref)] = value;
      }

      this.evidence.append({
        atMs: at(),
        kind: 'phase',
        detail: `invoke ${declaration.harness.harnessId}`,
      });
      const outcome = await this.processPort.run(
        {
          argv: request.harnessArgv,
          cwd: workspaceRoot,
          envAllowlist: childEnv,
          stdoutLimitBytes: 1_048_576,
          stderrLimitBytes: 65_536,
          cancel: request.cancellation,
          cancelGraceMs: declaration.limits.cancelGraceMs,
        },
        declaration.limits.wallMs,
      );

      const capturedText = outcome.stdout.toString('utf8') + outcome.stderr.toString('utf8');
      const leakedSecret = resolvedSecrets.find(
        (value) => value.length > 0 && capturedText.includes(value),
      );
      if (leakedSecret !== undefined) {
        throw new Error(
          'a resolved secret value reached captured output; refusing to persist this trial',
        );
      }

      let events: ReturnType<typeof parseHarnessEvents>;
      let eventParseFailed = false;
      const missingEvidenceNotes: string[] = [];
      try {
        events = parseHarnessEvents(outcome.stdout.toString('utf8'));
      } catch (cause) {
        eventParseFailed = true;
        events = [];
        this.evidence.append({
          atMs: at(),
          kind: 'terminal',
          detail: `event parse failure: ${String(cause)}`,
        });
      }

      const after = await this.workspacePort.snapshot(workspaceRoot);
      const workspaceDiff = this.workspacePort.diff(before, after);

      let evaluation: TrialEvaluation = { outcomes: [] };
      if (request.evaluate !== undefined) {
        try {
          evaluation = await request.evaluate({
            workspaceRoot,
            evaluatorIds: declaration.taskSuite.evaluatorIds,
            toolEvents: events
              .filter((event) => event.kind === 'tool' && event.tool !== undefined)
              .map((event) => ({ tool: event.tool as string, ok: event.ok === true })),
            before,
            after,
          });
        } catch (cause) {
          this.evidence.append({
            atMs: at(),
            kind: 'terminal',
            detail: `evaluation hook failed: ${String(cause)}`,
          });
          evaluation = {
            outcomes: [],
            verificationExit: null,
          };
          missingEvidenceNotes.push('declared evaluators did not run: evaluation hook failed');
        }
      }

      const terminalState = classifyTerminalState({
        timedOut: outcome.timedOut,
        cancelledByOperator: outcome.cancelledByOperator,
        exitCode: outcome.exitCode,
        eventParseFailed,
        eventCount: events.length,
      });

      for (const root of owned.splice(0).reverse()) {
        await root.remove();
      }
      this.evidence.append({ atMs: at(), kind: 'cleanup', detail: 'owned roots removed' });
      cleanupComplete = true;

      const errorMessages =
        terminalState === 'passed'
          ? []
          : [
              outcome.timedOut
                ? `exceeded ${declaration.limits.wallMs}ms wall limit; process tree stopped`
                : outcome.cancelledByOperator
                  ? 'trial was cancelled by the operator before completion'
                  : `harness exited with code ${String(outcome.exitCode)} in state ${terminalState}`,
            ];
      if (eventParseFailed) {
        missingEvidenceNotes.push('structured harness events were unparseable');
      }

      return {
        trialId,
        terminalState,
        startedAt,
        finishedAt: this.clock.nowIso(),
        totalWallMs: this.clock.monotonicMs() - startMs,
        invokeWallMs: outcome.wallMs,
        toolEvents: events
          .filter((event) => event.kind === 'tool' && event.tool !== undefined)
          .map((event) => ({ tool: event.tool as string, ok: event.ok === true })),
        missingEvidence: missingEvidenceNotes,
        errorMessages,
        workspaceDiff,
        workspaceAfterDigest: after.inputDigest,
        evaluatorOutcomes: evaluation.outcomes,
        verificationExit: evaluation.verificationExit ?? null,
        cleanupComplete,
      };
    } finally {
      for (const root of owned.splice(0)) {
        await root.remove().catch(() => undefined);
      }
    }
  }
}

export function secretEnvName(reference: string): string {
  return `TONOS_SECRET_${reference.replace(/[^A-Za-z0-9]+/gu, '_').toUpperCase()}`;
}

function allowlistedEnvironment(): Record<string, string> {
  return {
    PATH: process.env['PATH'] ?? '',
    HOME: '',
    TONOS_CONFIG_SOURCE: 'disposable-render',
  };
}

export function classifyTerminalState(input: {
  timedOut: boolean;
  cancelledByOperator?: boolean | undefined;
  exitCode: number | null;
  eventParseFailed: boolean;
  eventCount: number;
}): TerminalState {
  if (input.timedOut) return 'timed-out';
  if (input.cancelledByOperator) return 'cancelled';
  if (input.eventParseFailed) return 'invalid';
  if (input.exitCode === 0) {
    return input.eventCount > 0 ? 'passed' : 'invalid';
  }
  return 'failed';
}

interface HarnessEvent {
  kind: string;
  tool?: string | undefined;
  ok?: boolean | undefined;
}

const EVENT_PREFIX = '{"tonos_event"';

export function parseHarnessEvents(stdoutText: string): HarnessEvent[] {
  const events: HarnessEvent[] = [];
  for (const line of stdoutText.split(/\r?\n/u)) {
    if (!line.startsWith(EVENT_PREFIX)) continue;
    try {
      const parsed = JSON.parse(line) as {
        tonos_event: string;
        tool?: string;
        ok?: boolean;
      };
      if (typeof parsed.tonos_event === 'string') {
        events.push({
          kind: parsed.tonos_event,
          tool: parsed.tool,
          ok: parsed.ok,
        });
      }
    } catch {
      throw new Error(`unparseable structured event near: ${line.slice(0, 60)}`);
    }
  }
  return events;
}
