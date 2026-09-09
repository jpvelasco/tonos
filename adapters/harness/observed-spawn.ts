import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

export interface ObservedSpawn {
  argv: readonly string[];
  promptTail: string;
  secretKeyCount: number;
}

export async function readObservedSpawn(
  configRoot: string,
  fallback: ObservedSpawn,
): Promise<ObservedSpawn> {
  try {
    const raw = JSON.parse(await readFile(join(configRoot, 'observed.json'), 'utf8')) as {
      argv?: unknown;
      promptTail?: unknown;
      secretKeyCount?: unknown;
    };
    return {
      argv: Array.isArray(raw.argv) ? raw.argv.map(String) : fallback.argv,
      promptTail: typeof raw.promptTail === 'string' ? raw.promptTail : fallback.promptTail,
      secretKeyCount:
        typeof raw.secretKeyCount === 'number' ? raw.secretKeyCount : fallback.secretKeyCount,
    };
  } catch {
    return fallback;
  }
}
