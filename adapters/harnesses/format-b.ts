import { BaseFixtureAdapter } from '../../core/harness/base-fixture-adapter.ts';
import type { EventLine } from '../../core/harness/types.ts';

// Dialect B: JSON Lines with entirely different vocabulary
// (evt/tool_call/status vs A's [tool]/name/ok).
export class FormatBAdapter extends BaseFixtureAdapter {
  readonly kind = 'fixture-format-b';
  protected get mode(): string {
    return 'tools';
  }
  protected get formatFlag(): 'a' | 'b' {
    return 'b';
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
  }

  renderConfiguration(settings: Record<string, unknown>): string {
    return JSON.stringify({
      alias: String(settings['requestedModelAlias'] ?? ''),
      allow_tools: settings['toolsEnabled'] === true,
    });
  }

  parseLine(rawLine: string): EventLine | null {
    let frame: Record<string, unknown>;
    try {
      frame = JSON.parse(rawLine) as Record<string, unknown>;
    } catch {
      return null;
    }
    if (frame['evt'] === 'tool_call') {
      return {
        kind: 'tool',
        fields: {
          tool: String(frame['name'] ?? ''),
          ok: frame['status'] === 'ok',
        },
      };
    }
    if (frame['evt'] === 'cfg') {
      return {
        kind: 'config_effective',
        fields: { model: String(frame['model_alias'] ?? ''), ctx: frame['ctx_tokens'] },
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
      return {
        unknowns: [
          'model identity not reported by harness',
          'effective configuration not reported by harness',
        ],
      };
    }
    return {
      modelReportedByHarness: String(config.fields['model']),
      unknowns: [],
    };
  }
}
