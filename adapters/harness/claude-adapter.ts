import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type {
  EffectiveBehavior,
  EventLine,
  HarnessAdapter,
} from '../../core/harness/types.ts';
import type { TrialDeclarationPayload } from '../../core/records/trial.ts';
import type { ConfigurationPort, ProcessPort } from '../../core/ports.ts';
import { secretEnvName } from '../../core/trial-runner.ts';
import { readObservedSpawn } from './observed-spawn.ts';

export interface ClaudeObservedSpawn {
  argv: readonly string[];
  promptTail: string;
  secretKeyCount: number;
}

export interface ClaudeAdapterOptions {
  replayTranscriptPath?: string | undefined;
  processPort?: ProcessPort | undefined;
  configurationPort?: ConfigurationPort | undefined;
  command?: string | undefined;
  extraArgv?: readonly string[] | undefined;
  resolveSecret?: ((reference: string) => string | undefined) | undefined;
  promptPath?: string | undefined;
  workspaceRoot?: string | undefined;
}

const TOOL_MAP: Record<string, string> = {
  Bash: 'command-execution',
  Edit: 'file-change',
  Write: 'file-change',
  Read: 'read-file',
};

function bound(value: string, max = 128): string {
  return value.length > max ? value.slice(0, max) : value;
}

export class ClaudeAdapter implements HarnessAdapter {
  readonly kind = 'openclaude';
  lastConfigRoot: string | undefined;
  lastObserved: ClaudeObservedSpawn | undefined;

  constructor(private readonly options: ClaudeAdapterOptions = {}) {}

  static liveSmokeEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
    return env['TONOS_LIVE_CLAUDE'] === '1';
  }

  preflight(settings: Record<string, unknown>): void {
    if (settings.toolsEnabled === false) {
      throw new Error(
        'claude qualification requires tools enabled; refusing a tool-less configuration',
      );
    }
  }

  renderConfiguration(settings: Record<string, unknown>): string {
    return JSON.stringify({
      model: String(settings.requestedModelAlias ?? 'sonnet'),
      permissionMode: 'bypassPermissions',
    });
  }

  parseLine(rawLine: string): EventLine | null {
    let event: unknown;
    try {
      event = JSON.parse(rawLine);
    } catch {
      return null;
    }
    if (typeof event !== 'object' || event === null) return null;
    const record = event as {
      type?: unknown;
      message?: { content?: unknown };
      subtype?: unknown;
    };
    if (typeof record.type !== 'string') return null;
    if (record.type === 'system') return null;
    if (record.type === 'result') {
      return { kind: 'turn_completed', fields: {} };
    }
    if (record.type === 'assistant') {
      const content = record.message?.content;
      if (!Array.isArray(content)) return null;
      const tool = content.find(
        (part) =>
          typeof part === 'object' &&
          part !== null &&
          (part as { type?: unknown }).type === 'tool_use',
      ) as { name?: unknown } | undefined;
      if (typeof tool?.name !== 'string') return null;
      const mapped = TOOL_MAP[tool.name];
      if (mapped === undefined) {
        return { kind: 'unknown_item', fields: { type: tool.name } };
      }
      return { kind: 'tool', fields: { tool: mapped, ok: true } };
    }
    if (record.type === 'user') return null;
    return { kind: 'unknown_event', fields: { type: record.type } };
  }

  collectEffectiveBehavior(
    _requested: { requestedModelAlias?: string },
    events: EventLine[],
  ): EffectiveBehavior {
    const unknowns: string[] = [];
    for (const event of events) {
      if (event.kind === 'unknown_event' || event.kind === 'unknown_item') {
        unknowns.push(
          bound(`unrecognized claude event type: ${String(event.fields['type'])}`),
        );
      }
    }
    if (!events.some((event) => event.kind === 'turn_completed')) {
      unknowns.push('claude turn completion was not observed');
    }
    unknowns.push('claude events do not report the effective model');
    return { unknowns };
  }

  async runCanonical(
    declaration: TrialDeclarationPayload,
    _mode: string,
  ): Promise<CanonicalRun> {
    const captured =
      this.options.replayTranscriptPath !== undefined
        ? { stdout: await readFile(this.options.replayTranscriptPath, 'utf8'), exitCode: 0 }
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

  private async spawnAndCollect(
    declaration: TrialDeclarationPayload,
  ): Promise<{ stdout: string; exitCode: number }> {
    const processPort = this.options.processPort;
    const configurationPort = this.options.configurationPort;
    const promptPath = this.options.promptPath;
    if (processPort === undefined || configurationPort === undefined) {
      throw new Error(
        'claude live path requires ProcessPort and a disposable configuration root',
      );
    }
    if (promptPath === undefined) {
      throw new Error('claude live path requires the suite task prompt path');
    }

    const prompt = (await readFile(promptPath, 'utf8')).trim();
    const rendered = await configurationPort.renderDisposableRoot(
      declaration.harness.harnessId,
      'claude',
      declaration.configuration as unknown as Record<string, unknown>,
    );
    this.lastConfigRoot = rendered.configRoot;
    await writeFile(
      join(rendered.configRoot, 'settings.json'),
      this.renderConfiguration(
        declaration.configuration as unknown as Record<string, unknown>,
      ),
      'utf8',
    );

    const secrets: string[] = [];
    const childEnv: Record<string, string> = {
      PATH: process.env['PATH'] ?? '',
      HOME: rendered.configRoot,
      CLAUDE_CONFIG_DIR: rendered.configRoot,
      TONOS_CONFIG_SOURCE: 'disposable-render',
    };
    for (const ref of declaration.provider.secretRefs) {
      const value = this.options.resolveSecret?.(ref);
      if (value === undefined || value === '') {
        await configurationPort.removeOwned(rendered.configRoot);
        throw new Error(`secret reference '${ref}' is unresolved`);
      }
      secrets.push(value);
      childEnv[secretEnvName(ref)] = value;
    }

    const command = this.options.command ?? process.env['TONOS_CLAUDE_COMMAND'] ?? 'claude';
    const extra = this.options.extraArgv ?? [];
    const claudeArgv = [
      '-p',
      '--output-format',
      'stream-json',
      '--dangerously-skip-permissions',
      prompt,
    ];
    const argv = [command, ...extra, ...claudeArgv];

    try {
      const outcome = await processPort.run(
        {
          argv,
          cwd: this.options.workspaceRoot ?? rendered.configRoot,
          envAllowlist: childEnv,
          stdoutLimitBytes: 1_048_576,
          stderrLimitBytes: 65_536,
          cancelGraceMs: declaration.limits.cancelGraceMs,
        },
        declaration.limits.wallMs,
      );
      this.lastObserved = await readObservedSpawn(rendered.configRoot, {
        argv: claudeArgv,
        promptTail: prompt,
        secretKeyCount: secrets.length,
      });
      return {
        stdout: outcome.stdout.toString('utf8'),
        exitCode: outcome.exitCode ?? -1,
      };
    } finally {
      await configurationPort.removeOwned(rendered.configRoot);
    }
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
