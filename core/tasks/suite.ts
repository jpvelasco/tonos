import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

import type { TaskSuite } from '../records/task.ts';

export interface LoadedSuite {
  suiteId: string;
  revision: string;
  retention: TaskSuite['retention'];
  workspacePolicy: TaskSuite['workspacePolicy'];
  limits: TaskSuite['limits'];
  evaluatorIds: string[];
  requiredCapabilities: string[];
  fixtureDigests: Record<string, string>;
  prompt: string;
}

const FIXTURES_DIR = 'fixtures';

export async function loadSuite(suiteDir: string): Promise<LoadedSuite> {
  const manifestRaw = await readFile(join(suiteDir, 'suite.json'), 'utf8');
  const manifest = JSON.parse(manifestRaw) as {
    suiteId: string;
    revision: string;
    evaluatorIds?: string[];
    requiredCapabilities?: string[];
    retention?: TaskSuite['retention'];
    workspacePolicy?: TaskSuite['workspacePolicy'];
    limits?: TaskSuite['limits'];
  };
  if (!/^[a-z][a-z0-9-]{0,63}$/u.test(manifest.suiteId)) {
    throw new Error(`suite manifest has invalid suiteId '${manifest.suiteId}'`);
  }

  const fixtureDigests = await computeFixtureDigests(join(suiteDir, FIXTURES_DIR));
  if (Object.keys(fixtureDigests).length === 0) {
    throw new Error(`suite '${manifest.suiteId}' declares no fixtures`);
  }

  const prompt = await readFile(
    join(suiteDir, FIXTURES_DIR, 'prompt.md'),
    'utf8',
  );

  return {
    suiteId: manifest.suiteId,
    revision: manifest.revision,
    retention: manifest.retention ?? 'public_fixture',
    workspacePolicy:
      manifest.workspacePolicy ??
      ({
        allowedCommands: ['go test ./...'],
        networkAccess: false,
        maxFilesTouched: 10,
      } satisfies TaskSuite['workspacePolicy']),
    limits:
      manifest.limits ??
      ({ perTrialWallMs: 120_000, maxConcurrentTrials: 4 } satisfies TaskSuite['limits']),
    evaluatorIds: manifest.evaluatorIds ?? [],
    requiredCapabilities: manifest.requiredCapabilities ?? [],
    fixtureDigests,
    prompt,
  };
}

/** Content-derived identity of the whole suite directory. */
export async function suiteDigest(suiteDir: string): Promise<string> {
  const digests = await computeFixtureDigests(suiteDir, { includeManifest: true });
  const hash = createHash('sha256');
  for (const [path, digest] of Object.entries(digests)) {
    hash.update(`${path}:${digest}\n`);
  }
  return hash.digest('hex');
}

async function computeFixtureDigests(
  dir: string,
  options?: { includeManifest?: boolean },
): Promise<Record<string, string>> {
  const digests: Record<string, string> = {};
  async function walk(current: string, prefix: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries.sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const rel = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
      const full = join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(full, rel);
      } else if (entry.isFile()) {
        const content = await readFile(full);
        digests[rel] = createHash('sha256').update(content).digest('hex');
      }
    }
  }
  await walk(dir, '');
  if (options?.includeManifest === true) {
    try {
      const manifestPath = join(dir, '..', 'suite.json');
      const manifest = await readFile(manifestPath);
      digests['../suite.json'] =
        createHash('sha256').update(manifest).digest('hex');
    } catch {
      // no manifest sibling; caller decides
    }
  }
  return digests;
}
