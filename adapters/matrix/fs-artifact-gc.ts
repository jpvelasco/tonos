import { readdir, rm, stat } from 'node:fs/promises';
import { join, isAbsolute } from 'node:path';

import {
  parseMatrixDirName,
  type RetentionEntry,
} from '../../core/matrix/retention.ts';

export class FileSystemArtifactGc {
  readonly #root: string;

  constructor(rootDir: string) {
    this.#root = rootDir;
  }

  /** Immediate subdirectories that look like matrix store directories. */
  async listMatrixDirectories(): Promise<RetentionEntry[]> {
    let dirents;
    try {
      dirents = await readdir(this.#root, { withFileTypes: true });
    } catch (cause) {
      if (
        cause instanceof Error &&
        (cause as { code?: string }).code === 'ENOENT'
      ) {
        return [];
      }
      throw cause;
    }
    const entries: RetentionEntry[] = [];
    for (const dirent of dirents) {
      if (!dirent.isDirectory()) continue;
      if (parseMatrixDirName(dirent.name) === undefined) continue;
      const stats = await stat(join(this.#root, dirent.name));
      entries.push({ name: dirent.name, modifiedAtMs: stats.mtimeMs });
    }
    return entries;
  }

  async removeDirectory(name: string): Promise<void> {
    if (parseMatrixDirName(name) === undefined || isAbsolute(name)) {
      throw new Error(
        `refusing to remove '${name.slice(0, 80)}': not a matrix store directory name`,
      );
    }
    await rm(join(this.#root, name), { recursive: true, force: true });
  }
}
