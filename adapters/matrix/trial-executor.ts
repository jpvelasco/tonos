import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createProcessPort } from '../process/process-port.ts';
import { FileSystemWorkspacePort } from '../workspace/fs-workspace-port.ts';
import { createT5Evaluation } from '../evaluators/t5-evaluation.ts';
import { TrialRunner, secretEnvName } from '../../core/trial-runner.ts';
import type { OperatorCancellation } from '../../core/trial-runner.ts';
import { composeTrialResult } from '../../core/result-composition.ts';
import type {
  MatrixUnitExecutorPort,
  UnitOutcome,
} from '../../core/matrix/runner.ts';
import type {
  ConfigurationPort,
  EvidenceSink,
  RenderedConfiguration,
  SecretProvider,
} from '../../core/ports.ts';
import type { TrialDeclarationPayload, TrialResult } from '../../core/records/trial.ts';

export interface FixtureExecutorOptions {
  workspaceTemplateDir: string;
  fixtureHarnessPath: string;
  mode?: string | undefined;
}

export class EnvSecretProvider implements SecretProvider {
  resolve(reference: string): string {
    const fromEnvironment = process.env[secretEnvName(reference)];
    if (fromEnvironment === undefined || fromEnvironment === '') {
      throw new Error(
        `secret reference '${reference}' is unresolved; set ${secretEnvName(reference)} in the CLI environment`,
      );
    }
    return fromEnvironment;
  }
}

class DisposableFileConfigurationPort implements ConfigurationPort {
  async renderDisposableRoot(
    harnessId: string,
    trialToken: string,
    settings: Readonly<Record<string, unknown>>,
  ): Promise<RenderedConfiguration> {
    const root = await mkdtemp(join(tmpdir(), 'tonos-config-'));
    await writeFile(
      join(root, `${harnessId}.${trialToken}.json`),
      JSON.stringify(settings, null, 2),
      'utf8',
    );
    return { configRoot: root, effectiveNotes: [`rendered-for-${harnessId}`] };
  }

  async removeOwned(configRoot: string): Promise<void> {
    await rm(configRoot, { recursive: true, force: true });
  }
}

const SILENT_EVIDENCE: EvidenceSink = {
  append: () => undefined,
  boundedEvents: () => [],
};

export class FixtureTrialExecutor implements MatrixUnitExecutorPort {
  readonly #runner: TrialRunner;
  readonly #options: FixtureExecutorOptions;

  constructor(options: FixtureExecutorOptions) {
    this.#options = options;
    this.#runner = new TrialRunner(
      createProcessPort(),
      new FileSystemWorkspacePort(),
      new DisposableFileConfigurationPort(),
      {
        nowIso: () => new Date().toISOString(),
        monotonicMs: () => Date.now(),
      },
      new EnvSecretProvider(),
      SILENT_EVIDENCE,
    );
  }

  supports(declaration: TrialDeclarationPayload): boolean {
    return declaration.harness.adapterKind === 'fixture';
  }

  async executeUnit(
    unit: { declarationId: string; repetitionIndex: number },
    declaration: TrialDeclarationPayload,
    cancellation: OperatorCancellation,
  ): Promise<UnitOutcome> {
    if (!this.supports(declaration)) {
      return {
        kind: 'schedule-failed',
        reasonClass: 'unsupported-adapter',
        detail: `no executor for adapter kind '${declaration.harness.adapterKind}'`,
      };
    }
    try {
      const output = await this.#runner.run({
        declaration,
        harnessArgv: [
          process.execPath,
          this.#options.fixtureHarnessPath,
          this.#options.mode ?? 'tools',
        ],
        workspaceTemplateDir: this.#options.workspaceTemplateDir,
        cancellation,
        evaluate: createT5Evaluation(),
      });
      const document = composeTrialResult({ output, declaration });
      return { kind: 'result', document };
    } catch (cause) {
      return {
        kind: 'schedule-failed',
        reasonClass: 'executor-error',
        detail: String(cause).slice(0, 256),
      };
    }
  }
}

export type { TrialResult };
