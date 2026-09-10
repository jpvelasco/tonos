import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type {
  EffectiveBehavior,
  EventLine,
  HarnessAdapter,
} from '../../core/harness/types.ts';
import type { TrialDeclarationPayload } from '../../core/records/trial.ts';
import type { AdapterKind } from '../../core/records/harness.ts';
import type { ConfigurationPort, ProcessPort } from '../../core/ports.ts';
import { secretEnvName } from '../../core/trial-runner.ts';
import { readObservedSpawn, type ObservedSpawn } from './observed-spawn.ts';

export interface ScriptedCliProfile {
  kind: AdapterKind;
  defaultCommand: string;
  homeEnv: string;
  liveEnvFlag: string;
  argvFor(prompt: string, model: string): readonly string[];
  parseLine(rawLine: string): EventLine | null;
}

export interface ScriptedCliAdapterOptions {
  replayTranscriptPath?: string | undefined;
  processPort?: ProcessPort | undefined;
  configurationPort?: ConfigurationPort | undefined;
  command?: string | undefined;
  extraArgv?: readonly string[] | undefined;
  resolveSecret?: ((reference: string) => string | undefined) | undefined;
  promptPath?: string | undefined;
  workspaceRoot?: string | undefined;
}

function bound(value: string, max = 128): string {
  return value.length > max ? value.slice(0, max) : value;
}

export class ScriptedCliAdapter implements HarnessAdapter {
  lastConfigRoot: string | undefined;
  lastObserved: ObservedSpawn | undefined;

  constructor(
    private readonly profile: ScriptedCliProfile,
    private readonly options: ScriptedCliAdapterOptions = {},
  ) {}

  get kind(): string {
    return this.profile.kind;
  }

  liveSmokeEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
    return env[this.profile.liveEnvFlag] === '1';
  }

  preflight(settings: Record<string, unknown>): void {
    if (settings.toolsEnabled === false) {
      throw new Error(
        `${this.profile.kind} qualification requires tools enabled; refusing a tool-less configuration`,
      );
    }
  }

  renderConfiguration(settings: Record<string, unknown>): string {
    return JSON.stringify({
      model: String(settings.requestedModelAlias ?? 'test-model'),
      isolated: true,
    });
  }

  parseLine(rawLine: string): EventLine | null {
    return this.profile.parseLine(rawLine);
  }

  collectEffectiveBehavior(
    _requested: { requestedModelAlias?: string },
    events: EventLine[],
  ): EffectiveBehavior {
    const unknowns: string[] = [];
    for (const event of events) {
      if (event.kind === 'unknown_event' || event.kind === 'unknown_item') {
        unknowns.push(
          bound(`unrecognized ${this.profile.kind} event type: ${String(event.fields['type'])}`),
        );
      }
    }
    if (!events.some((event) => event.kind === 'turn_completed')) {
      unknowns.push(`${this.profile.kind} turn completion was not observed`);
    }
    unknowns.push(`${this.profile.kind} events do not report the effective model`);
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
    if (processPort === undefined || configurationPort === undefined || promptPath === undefined) {
      throw new Error(
        `${this.profile.kind} live path requires ProcessPort, disposable config, and suite prompt`,
      );
    }
    const prompt = (await readFile(promptPath, 'utf8')).trim();
    const rendered = await configurationPort.renderDisposableRoot(
      declaration.harness.harnessId,
      this.profile.kind,
      declaration.configuration as unknown as Record<string, unknown>,
    );
    this.lastConfigRoot = rendered.configRoot;
    await writeFile(
      join(rendered.configRoot, 'config.json'),
      this.renderConfiguration(declaration.configuration as unknown as Record<string, unknown>),
      'utf8',
    );
    const secrets: string[] = [];
    const childEnv: Record<string, string> = {
      PATH: process.env['PATH'] ?? '',
      HOME: rendered.configRoot,
      [this.profile.homeEnv]: rendered.configRoot,
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
    const command = this.options.command ?? this.profile.defaultCommand;
    const extra = this.options.extraArgv ?? [];
    const nativeArgv = this.profile.argvFor(
      prompt,
      declaration.configuration.requestedModelAlias,
    );
    try {
      const outcome = await processPort.run(
        {
          argv: [command, ...extra, ...nativeArgv],
          cwd: this.options.workspaceRoot ?? rendered.configRoot,
          envAllowlist: childEnv,
          stdoutLimitBytes: 1_048_576,
          stderrLimitBytes: 65_536,
          cancelGraceMs: declaration.limits.cancelGraceMs,
        },
        declaration.limits.wallMs,
      );
      this.lastObserved = await readObservedSpawn(rendered.configRoot, {
        argv: nativeArgv,
        promptTail: prompt,
        secretKeyCount: secrets.length,
      });
      return { stdout: outcome.stdout.toString('utf8'), exitCode: outcome.exitCode ?? -1 };
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

export function parseScriptedEvent(rawLine: string): EventLine | null {
  let event: unknown;
  try {
    event = JSON.parse(rawLine);
  } catch {
    return null;
  }
  if (typeof event !== 'object' || event === null) return null;
  const record = event as { type?: unknown; tool?: unknown; ok?: unknown };
  if (record.type === 'tool' && typeof record.tool === 'string') {
    return { kind: 'tool', fields: { tool: record.tool, ok: record.ok !== false } };
  }
  if (record.type === 'done') return { kind: 'turn_completed', fields: {} };
  if (typeof record.type === 'string') {
    return { kind: 'unknown_event', fields: { type: record.type } };
  }
  return null;
}

export const AIDER_PROFILE: ScriptedCliProfile = {
  kind: 'aider',
  defaultCommand: 'aider',
  homeEnv: 'AIDER_CONFIG_DIR',
  liveEnvFlag: 'TONOS_LIVE_AIDER',
  argvFor: (prompt, model) => ['--yes', '--message', prompt, '--model', model],
  parseLine: parseScriptedEvent,
};

export const CLINE_PROFILE: ScriptedCliProfile = {
  kind: 'cline',
  defaultCommand: 'cline',
  homeEnv: 'CLINE_DIR',
  liveEnvFlag: 'TONOS_LIVE_CLINE',
  argvFor: (prompt, model) => ['run', '--yes', '--model', model, prompt],
  parseLine: parseScriptedEvent,
};
