import { cp, mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type {
  WorkspaceDiff,
  WorkspacePort,
  WorkspaceSnapshot,
} from '../../core/ports.ts';

interface FileRecord {
  digest: string;
  lines: number;
}

export class FileSystemWorkspacePort implements WorkspacePort {
  async createDisposable(sourceTemplateDir: string): Promise<string> {
    const parent = await mkdtemp(join(tmpdir(), 'tonos-workspace-'));
    const root = join(parent, 'workspace');
    await cp(sourceTemplateDir, root, { recursive: true });
    return root;
  }

  async snapshot(root: string): Promise<WorkspaceSnapshot> {
    const records = await collectFileRecords(root);
    const hash = createHash('sha256');
    for (const [path, record] of records) {
      hash.update(`${path}:${record.digest}\n`);
    }
    return {
      inputDigest: hash.digest('hex'),
      fileCount: records.size,
      files: Object.fromEntries(records),
    };
  }

  async digest(root: string): Promise<string> {
    return (await this.snapshot(root)).inputDigest;
  }

  diff(
    before: WorkspaceSnapshot,
    after: WorkspaceSnapshot,
  ): WorkspaceDiff {
    let filesChanged = 0;
    let insertions = 0;
    let deletions = 0;

    for (const [path, beforeRecord] of Object.entries(before.files)) {
      const afterRecord = after.files[path];
      if (afterRecord === undefined) {
        filesChanged += 1;
        deletions += beforeRecord.lines;
      } else if (afterRecord.digest !== beforeRecord.digest) {
        filesChanged += 1;
        insertions += Math.max(0, afterRecord.lines - beforeRecord.lines);
        deletions += Math.max(0, beforeRecord.lines - afterRecord.lines);
      }
    }
    for (const [path, afterRecord] of Object.entries(after.files)) {
      if (before.files[path] === undefined) {
        filesChanged += 1;
        insertions += afterRecord.lines;
      }
    }
    return { filesChanged, insertions, deletions };
  }

  async removeOwned(root: string): Promise<void> {
    await rm(root, { recursive: true, force: true });
  }
}

async function collectFileRecords(
  root: string,
): Promise<Map<string, FileRecord>> {
  const records = new Map<string, FileRecord>();
  async function walk(dir: string, prefix: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries.sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const relative = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full, relative);
      } else if (entry.isFile()) {
        const content = await readFile(full);
        records.set(relative, {
          digest: createHash('sha256').update(content).digest('hex'),
          lines: countLines(content),
        });
      }
    }
  }
  await walk(root, '');
  return records;
}

function countLines(content: Buffer): number {
  if (content.byteLength === 0) return 0;
  let lines = 1;
  for (const byte of content) {
    if (byte === 0x0a) lines += 1;
  }
  return lines;
}

