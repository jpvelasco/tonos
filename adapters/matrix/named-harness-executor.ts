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
import type { HarnessAdapter } from '../../core/harness/types.ts';
import { EnvSecretProvider } from './trial-executor.ts';
import { DisposableFileConfigurationPort } from './disposable-config.ts';

export interface NamedHarnessExecutorOptions {
  workspaceTemplateDir: string;
  promptPath?: string | undefined;
}

const DEFAULT_PROMPT = 'tasks/retry-suite/fixtures/prompt.md';

export interface NamedAdapterFactoryInput {
  processPort: ReturnType<typeof createProcessPort>;
  configurationPort: DisposableFileConfigurationPort;
  resolveSecret: (ref: string) => string | undefined;
  promptPath: string;
  workspaceRoot: string;
}

export function createNamedHarnessExecutor(
  adapterKind: TrialDeclarationPayload['harness']['adapterKind'],
  createAdapter: (input: NamedAdapterFactoryInput) => HarnessAdapter,
): new (options: NamedHarnessExecutorOptions) => MatrixUnitExecutorPort {
  return class NamedHarnessExecutor implements MatrixUnitExecutorPort {
    constructor(private readonly options: NamedHarnessExecutorOptions) {}

    supports(declaration: TrialDeclarationPayload): boolean {
      return declaration.harness.adapterKind === adapterKind;
    }

    async executeUnit(
      _unit: { declarationId: string; repetitionIndex: number },
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
        this.options.workspaceTemplateDir,
      );
      const startedAt = new Date().toISOString();
      const startMs = Date.now();
      try {
        const before = await workspace.snapshot(workspaceRoot);
        const adapter = createAdapter({
          processPort: createProcessPort(),
          configurationPort: new DisposableFileConfigurationPort(),
          resolveSecret: (ref) => {
            try {
              return new EnvSecretProvider().resolve(ref);
            } catch {
              return undefined;
            }
          },
          promptPath: this.options.promptPath ?? DEFAULT_PROMPT,
          workspaceRoot,
        });
        const record = await adapter.runCanonical(declaration, 'tools');
        const after = await workspace.snapshot(workspaceRoot);
        return {
          kind: 'result',
          document: composeTrialResult({
            output: {
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
                  : [`${adapterKind} trial ended in state ${record.terminalState}`],
              workspaceDiff: workspace.diff(before, after),
              workspaceAfterDigest: after.inputDigest,
              evaluatorOutcomes: [],
              verificationExit: null,
              cleanupComplete: true,
            },
            declaration,
          }),
        };
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
  };
}
