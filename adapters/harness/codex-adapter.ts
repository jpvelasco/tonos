import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';

import type {
  EffectiveBehavior,
  EventLine,
  HarnessAdapter,
} from '../../core/harness/types.ts';
import type { TrialDeclarationPayload } from '../../core/records/trial.ts';

export interface CodexAdapterOptions {
  /** Replay a committed transcript instead of spawning codex (offline tests). */
  replayTranscriptPath?: string | undefined;
}

const KNOWN_ITEM_TYPES = new Set([
  'reasoning',
  'agent_message',
  'command_execution',
  'file_change',
  'error',
]);

function bound(value: string, max = 128): string {
  return value.length > max ? value.slice(0, max) : value;
}

export class CodexAdapter implements HarnessAdapter {
  readonly kind = 'codex';

  constructor(private readonly options: CodexAdapterOptions = {}) {}

  preflight(settings: Record<string, unknown>): void {
    if (settings.toolsEnabled === false) {
      throw new Error(
        'codex qualification requires tools enabled; refusing a tool-less configuration',
      );
    }
    const effort = settings.reasoningEffort;
    if (
      effort !== undefined &&
      !['auto', 'none', 'low', 'medium', 'high'].includes(String(effort))
    ) {
      throw new Error(`unsupported reasoning effort '${String(effort)}'`);
    }
  }

  renderConfiguration(settings: Record<string, unknown>): string {
    const model = String(settings.requestedModelAlias ?? 'luna');
    const effort = String(settings.reasoningEffort ?? 'medium');
    return [
      `model = ${JSON.stringify(model)}`,
      `model_reasoning_effort = "${effort}"`,
      'approval_policy = "never"',
      'sandbox_mode = "workspace-write"',
    ].join('\n');
  }

  parseLine(rawLine: string): EventLine | null {
    let event: unknown;
    try {
      event = JSON.parse(rawLine);
    } catch {
      return null;
    }
    if (typeof event !== 'object' || event === null) return null;
    const record = event as { type?: unknown; item?: unknown; [k: string]: unknown };
    if (typeof record.type !== 'string') return null;

    switch (record.type) {
      case 'item.started':
      case 'turn.started':
        return null;
      case 'item.completed': {
        const item = record.item as
          | { type?: unknown; exit_code?: unknown }
          | undefined;
        if (
          typeof item !== 'object' ||
          item === null ||
          typeof item.type !== 'string'
        ) {
          return { kind: 'unknown_item', fields: { type: String(record.type) } };
        }
        if (!KNOWN_ITEM_TYPES.has(item.type)) {
          return { kind: 'unknown_item', fields: { type: item.type } };
        }
        if (item.type === 'command_execution') {
          return {
            kind: 'tool',
            fields: {
              tool: 'command-execution',
              ok: (item.exit_code ?? 0) === 0,
            },
          };
        }
        if (item.type === 'file_change') {
          return { kind: 'tool', fields: { tool: 'file-change', ok: true } };
        }
        return null;
      }
      case 'turn.completed':
        return { kind: 'turn_completed', fields: {} };
      case 'error':
      case 'turn.failed': {
        const message =
          typeof record.message === 'string'
            ? record.message
            : JSON.stringify(record.error ?? '');
        return { kind: 'harness_error', fields: { message } };
      }
      default:
        return { kind: 'unknown_event', fields: { type: record.type } };
    }
  }

  collectEffectiveBehavior(
    _requested: { requestedModelAlias?: string },
    events: EventLine[],
  ): EffectiveBehavior {
    const unknowns: string[] = [];
    for (const event of events) {
      if (event.kind === 'unknown_event' || event.kind === 'unknown_item') {
        unknowns.push(
          bound(`unrecognized codex event type: ${String(event.fields['type'])}`),
        );
      }
    }
    if (!events.some((event) => event.kind === 'turn_completed')) {
      unknowns.push('codex turn completion was not observed');
    }
    // Codex events do not echo the effective model; absence is recorded.
    return { unknowns };
  }

  async runCanonical(
    declaration: TrialDeclarationPayload,
    _mode: string,
  ): Promise<CanonicalRun> {
    const captured =
      this.options.replayTranscriptPath !== undefined
        ? await this.readTranscript(this.options.replayTranscriptPath)
        : await this.spawnAndCollect(declaration);

    const events: EventLine[] = [];
    for (const line of captured.stdout.split(/\r?\n/u)) {
      if (line.trim() === '') continue;
      const parsed = this.parseLine(line);
      if (parsed !== null) events.push(parsed);
    }

    const behavior = this.collectEffectiveBehavior({}, events);
    const toolEvents = events
      .filter((event) => event.kind === 'tool')
      .map((event) => ({
        tool: String(event.fields['tool'] ?? ''),
        ok: event.fields['ok'] === true,
      }));

    let terminalState: CanonicalRun['terminalState'];
    if (
      captured.exitCode === 0 &&
      events.some((event) => event.kind === 'turn_completed') &&
      toolEvents.length > 0
    ) {
      terminalState = 'passed';
    } else if (captured.exitCode === 0) {
      terminalState = 'invalid';
      behavior.unknowns.push(
        bound('trial ended without tool activity or a completed turn'),
      );
    } else {
      terminalState = 'failed';
    }

    return {
      harnessId: declaration.harness.harnessId,
      harnessVersion: declaration.harness.version,
      terminalState,
      toolEvents,
      effectiveBehavior: behavior,
      declaredUnknowns: behavior.unknowns,
    };
  }

  private async readTranscript(path: string): Promise<CapturedRun> {
    return { stdout: await readFile(path, 'utf8'), exitCode: 0 };
  }

  private async spawnAndCollect(
    declaration: TrialDeclarationPayload,
  ): Promise<CapturedRun> {
    const prompt =
      'Working from the repository in the current directory, make progress on the declared task and finish with a summary.';
    const argv = [
      'exec',
      '--json',
      '--sandbox',
      'workspace-write',
      '--skip-git-repo-check',
      '-c',
      `model_reasoning_effort="${String(declaration.configuration.reasoningEffort ?? 'medium')}"`,
      '-m',
      declaration.configuration.requestedModelAlias,
      prompt,
    ];
    const child = spawn(this.codexCommand(), argv, {
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    let stdout = '';
    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });
    const exitCode = await new Promise<number>((resolve) => {
      child.on('close', (code) => resolve(code ?? -1));
      child.on('error', () => resolve(-1));
    });
    return { stdout, exitCode };
  }

  private codexCommand(): string {
    return process.env['TONOS_CODEX_COMMAND'] ?? 'codex';
  }
}

interface CanonicalRun {
  harnessId: string;
  harnessVersion: string;
  terminalState: 'passed' | 'failed' | 'invalid';
  toolEvents: Array<{ tool: string; ok: boolean }>;
  effectiveBehavior: EffectiveBehavior;
  declaredUnknowns: string[];
}

interface CapturedRun {
  stdout: string;
  exitCode: number;
}
