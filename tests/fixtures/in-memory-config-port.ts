import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type {
  ConfigurationPort,
  RenderedConfiguration,
} from '../../core/ports.ts';

export class InMemoryConfigurationPort implements ConfigurationPort {
  readonly renderedRoots: string[] = [];

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
    this.renderedRoots.push(root);
    return {
      configRoot: root,
      effectiveNotes: [`rendered-for-${harnessId}`],
    };
  }

  async removeOwned(configRoot: string): Promise<void> {
    await rm(configRoot, { recursive: true, force: true });
    const index = this.renderedRoots.indexOf(configRoot);
    if (index >= 0) this.renderedRoots.splice(index, 1);
  }
}
