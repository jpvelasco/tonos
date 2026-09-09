import type {
  MatrixUnitExecutorPort,
  UnitOutcome,
} from '../../core/matrix/runner.ts';
import type { TrialDeclarationPayload } from '../../core/records/trial.ts';
import type { OperatorCancellation } from '../../core/trial-runner.ts';
import { FixtureTrialExecutor } from './trial-executor.ts';
import { CodexTrialExecutor } from './codex-executor.ts';
import { ClaudeTrialExecutor } from './claude-executor.ts';
import { AiderTrialExecutor } from './aider-executor.ts';
import { ClineTrialExecutor } from './cline-executor.ts';

export type RegisteredHarnessKind =
  | 'fixture'
  | 'codex'
  | 'openclaude'
  | 'aider'
  | 'cline';

export interface RegistryOptions {
  workspaceTemplateDir: string;
  fixtureHarnessPath?: string | undefined;
  promptPath?: string | undefined;
  kinds: readonly RegisteredHarnessKind[];
}

export function parseHarnessKinds(
  raw: readonly string[] | undefined,
): RegisteredHarnessKind[] {
  if (raw === undefined || raw.length === 0) return ['fixture'];
  const kinds: RegisteredHarnessKind[] = [];
  for (const value of raw) {
    if (
      value !== 'fixture' &&
      value !== 'codex' &&
      value !== 'openclaude' &&
      value !== 'aider' &&
      value !== 'cline'
    ) {
      throw new Error(
        `unknown harness kind '${value}'; registered kinds are fixture, codex, openclaude, aider, cline`,
      );
    }
    if (!kinds.includes(value)) kinds.push(value);
  }
  return kinds;
}

export class RegistryTrialExecutor implements MatrixUnitExecutorPort {
  readonly #byKind: Map<RegisteredHarnessKind, MatrixUnitExecutorPort>;

  constructor(options: RegistryOptions) {
    this.#byKind = new Map();
    for (const kind of options.kinds) {
      this.#byKind.set(kind, executorFor(kind, options));
    }
  }

  supports(declaration: TrialDeclarationPayload): boolean {
    return this.#byKind.has(declaration.harness.adapterKind as RegisteredHarnessKind);
  }

  async executeUnit(
    unit: { declarationId: string; repetitionIndex: number },
    declaration: TrialDeclarationPayload,
    cancellation: OperatorCancellation,
  ): Promise<UnitOutcome> {
    const executor = this.#byKind.get(
      declaration.harness.adapterKind as RegisteredHarnessKind,
    );
    if (executor === undefined) {
      return {
        kind: 'schedule-failed',
        reasonClass: 'unsupported-adapter',
        detail: `no executor for adapter kind '${declaration.harness.adapterKind}'`,
      };
    }
    return executor.executeUnit(unit, declaration, cancellation);
  }
}

function executorFor(
  kind: RegisteredHarnessKind,
  options: RegistryOptions,
): MatrixUnitExecutorPort {
  if (kind === 'fixture') {
    if (options.fixtureHarnessPath === undefined) {
      throw new Error('fixture harness path is required when --harness fixture is selected');
    }
    return new FixtureTrialExecutor({
      workspaceTemplateDir: options.workspaceTemplateDir,
      fixtureHarnessPath: options.fixtureHarnessPath,
    });
  }
  if (kind === 'codex') {
    return new CodexTrialExecutor({
      workspaceTemplateDir: options.workspaceTemplateDir,
      promptPath: options.promptPath,
    });
  }
  if (kind === 'openclaude') {
    return new ClaudeTrialExecutor({
      workspaceTemplateDir: options.workspaceTemplateDir,
      promptPath: options.promptPath,
    });
  }
  if (kind === 'aider') {
    return new AiderTrialExecutor({
      workspaceTemplateDir: options.workspaceTemplateDir,
      promptPath: options.promptPath,
    });
  }
  return new ClineTrialExecutor({
    workspaceTemplateDir: options.workspaceTemplateDir,
    promptPath: options.promptPath,
  });
}
