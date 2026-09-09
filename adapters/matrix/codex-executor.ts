import { trialIdOf } from '../../core/records/trial.ts';
import type { TrialDeclarationPayload } from '../../core/records/trial.ts';
import type {
  MatrixUnitExecutorPort,
  UnitOutcome,
} from '../../core/matrix/runner.ts';
import type { OperatorCancellation } from '../../core/trial-runner.ts';
import { composeTrialResult } from '../../core/result-composition.ts';
import { createProcessPort } from '../process/process-port.ts';
import { FileSystemWorkspacePort } from '../workspace/fs-workspace-port.ts';
import { CodexAdapter } from '../harness/codex-adapter.ts';
import { EnvSecretProvider } from './trial-executor.ts';
import { DisposableFileConfigurationPort } from './disposable-config.ts';

export interface CodexExecutorOptions {
  workspaceTemplateDir: string;
  promptPath?: string | undefined;
}

const DEFAULT_PROMPT = 'tasks/retry-suite/fixtures/prompt.md';

export class CodexTrialExecutor implements MatrixUnitExecutorPort {
  readonly #options: CodexExecutorOptions;

  constructor(options: CodexExecutorOptions) {
    this.#options = options;
  }

  supports(declaration: TrialDeclarationPayload): boolean {
    return declaration.harness.adapterKind === 'codex';
  }

  async executeUnit(
    unit: { declarationId: string; repetitionIndex: number },
    declaration: TrialDeclarationPayload,
    _cancellation: OperatorCancellation,
  ): Promise<UnitOutcome> {
    if (!this.supports(declaration)) {
      return {
        kind: 'schedule-failed',
        reasonClass: 'unsupported-adapter',
        detail: `no executor for adapter kind '${declaration.harness.adapterKind}'`,
      };
    }

    const workspace = new FileSystemWorkspacePort();
    const workspaceRoot = await workspace.createDisposable(
      this.#options.workspaceTemplateDir,
    );
    const startedAt = new Date().toISOString();
    const startMs = Date.now();
    try {
      const before = await workspace.snapshot(workspaceRoot);
      const adapter = new CodexAdapter({
        processPort: createProcessPort(),
        configurationPort: new DisposableFileConfigurationPort(),
        resolveSecret: (ref) => {
          try {
            return new EnvSecretProvider().resolve(ref);
          } catch {
            return undefined;
          }
        },
        promptPath: this.#options.promptPath ?? DEFAULT_PROMPT,
        workspaceRoot,
      });
      const record = await adapter.runCanonical(declaration, 'tools');
      const after = await workspace.snapshot(workspaceRoot);
      const output = {
        trialId: trialIdOf(declaration),
        terminalState: record.terminalState,
        startedAt,
        finishedAt: new Date().toISOString(),
        totalWallMs: Date.now() - startMs,
        invokeWallMs: Date.now() - startMs,
        toolEvents: record.toolEvents,
        missingEvidence: record.declaredUnknowns,
        errorMessages:
          record.terminalState === 'passed'
            ? []
            : [`codex trial ended in state ${record.terminalState}`],
        workspaceDiff: workspace.diff(before, after),
        workspaceAfterDigest: after.inputDigest,
        evaluatorOutcomes: [],
        verificationExit: null,
        cleanupComplete: true,
      };
      return { kind: 'result', document: composeTrialResult({ output, declaration }) };
    } catch (cause) {
      return {
        kind: 'schedule-failed',
        reasonClass: 'executor-error',
        detail: String(cause).slice(0, 256),
      };
    } finally {
      await workspace.removeOwned(workspaceRoot).catch(() => undefined);
    }
  }
}
