import { spawn } from 'node:child_process';

import type {
  CanonicalTrialRecord,
  EffectiveBehavior,
  EventLine,
  HarnessAdapter,
} from './types.ts';
import type { TrialDeclarationPayload } from '../records/trial.ts';

export interface FormatAdapterOptions {
  fixtureHarnessPath: string;
}

function collect(
  child: ReturnType<typeof spawn>,
): Promise<{ stdout: string; code: number | null }> {
  return new Promise((resolve) => {
    let stdout = '';
    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });
    child.on('close', (code) => resolve({ stdout, code }));
  });
}

export abstract class BaseFixtureAdapter implements HarnessAdapter {
  abstract renderConfiguration(settings: Record<string, unknown>): string;
  abstract collectEffectiveBehavior(
    requested: { requestedModelAlias?: string },
    events: EventLine[],
  ): EffectiveBehavior;
  abstract readonly kind: string;
  onBeforeSpawn?: undefined | (() => void);

  constructor(protected readonly fixtureHarnessPath: string) {}

  abstract preflight(settings: Record<string, unknown>): void;
  /** Mode string understood by the fixture harness binary. */
  protected abstract get mode(): string;
  /** Native format tag passed to the harness so it emits that dialect. */
  protected abstract get formatFlag(): 'a' | 'b';
  abstract parseLine(rawLine: string): EventLine | null;

  async runCanonical(
    declaration: TrialDeclarationPayload,
    _mode: string,
  ): Promise<CanonicalTrialRecord> {
    this.preflight({
      reasoningEffort: declaration.configuration.reasoningEffort ?? 'none',
      toolsEnabled: declaration.configuration.toolsEnabled,
      requestedModelAlias: declaration.configuration.requestedModelAlias,
    });

    const argv = [
      process.execPath,
      this.fixtureHarnessPath,
      'tools',
      `--format=${this.formatFlag}`,
      `--model=${declaration.configuration.requestedModelAlias}`,
    ];
    this.onBeforeSpawn?.();
    const child = spawn(argv[0] ?? '', argv.slice(1), { stdio: ['ignore', 'pipe', 'ignore'] });
    const { stdout, code } = await collect(child);

    const events: EventLine[] = [];
    for (const line of stdout.split(/\r?\n/u)) {
      if (line.trim() === '') continue;
      const parsed = this.parseLine(line);
      if (parsed !== null) events.push(parsed);
    }

    const toolEvents = events
      .filter((e) => e.kind === 'tool')
      .map((e) => ({ tool: String(e.fields['tool'] ?? ''), ok: e.fields['ok'] === true }));

    const behavior = this.collectEffectiveBehavior(
      { requestedModelAlias: declaration.configuration.requestedModelAlias },
      events,
    );

    const unknowns = [...behavior.unknowns];
    let terminal: CanonicalTrialRecord['terminalState'];
    if (code === 0 && toolEvents.length > 0 && events.some((e) => e.kind === 'config_effective')) {
      terminal = 'passed';
    } else if (code === 0) {
      terminal = 'invalid';
      if (!events.some((e) => e.kind === 'config_effective')) {
        unknowns.push('effective configuration not reported by harness');
      }
    } else {
      terminal = 'failed';
    }

    return {
      harnessId: declaration.harness.harnessId,
      harnessVersion: declaration.harness.version,
      terminalState: terminal,
      toolEvents,
      effectiveBehavior: behavior,
      declaredUnknowns: unknowns,
    };
  }
}
