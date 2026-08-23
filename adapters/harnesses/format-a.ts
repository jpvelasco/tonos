import { BaseFixtureAdapter } from '../../core/harness/base-fixture-adapter.ts';
import type { EventLine } from '../../core/harness/types.ts';

// Dialect A: bracketed INI-style tags with key=value pairs.
export class FormatAAdapter extends BaseFixtureAdapter {
  readonly kind = 'fixture-format-a';
  protected get mode(): string {
    return 'tools';
  }
  protected get formatFlag(): 'a' | 'b' {
    return 'a';
  }

  preflight(settings: Record<string, unknown>): void {
    if (
      settings['reasoningEffort'] === 'high' &&
      settings['toolsEnabled'] !== true
    ) {
      throw new Error(
        'unsupported configuration: reasoning-effort high requires tools enabled',
      );
    }
    if (
      typeof settings['requestedModelAlias'] === 'string' &&
      !/^[a-z0-9-]+$/u.test(settings['requestedModelAlias'])
    ) {
      throw new Error('unsupported configuration: model alias outside harness charset');
    }
  }

  renderConfiguration(settings: Record<string, unknown>): string {
    return [
      '[run]',
      `model = ${String(settings['requestedModelAlias'] ?? '')}`,
      `tools = ${(settings['toolsEnabled'] === true).toString()}`,
    ].join('\n');
  }

  parseLine(rawLine: string): EventLine | null {
    const tool = /^\[tool\]\s+name=([a-z0-9-]+)\s+ok=(true|false)$/u.exec(rawLine);
    if (tool) {
      return {
        kind: 'tool',
        fields: { tool: tool[1], ok: tool[2] === 'true' },
      };
    }
    const config = /^\[config\]\s+model=([^\s]+)\s+ctx=(\d+)$/u.exec(rawLine);
    if (config) {
      return {
        kind: 'config_effective',
        fields: { model: config[1], ctx: Number(config[2]) },
      };
    }
    return null;
  }

  collectEffectiveBehavior(
    _requested: { requestedModelAlias?: string },
    events: EventLine[],
  ) {
    const config = events.find((e) => e.kind === 'config_effective');
    if (config === undefined) {
      return { unknowns: ['effective configuration not reported by harness'] };
    }
    return {
      modelReportedByHarness: String(config.fields['model']),
      unknowns: [],
    };
  }
}
