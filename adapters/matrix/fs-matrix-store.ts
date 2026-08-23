import { mkdir, rename, readFile, writeFile, rm } from 'node:fs/promises';
import { dirname, join, isAbsolute } from 'node:path';
import { randomUUID } from 'node:crypto';

import type { MatrixStorePort } from '../../core/matrix/runner.ts';

export class FileSystemMatrixStore implements MatrixStorePort {
  readonly #root: string;

  constructor(rootDir: string) {
    this.#root = rootDir;
  }

  async readText(relativePath: string): Promise<string | null> {
    try {
      return await readFile(this.#resolve(relativePath), 'utf8');
    } catch (cause) {
      if (
        cause instanceof Error &&
        (cause as { code?: string }).code === 'ENOENT'
      ) {
        return null;
      }
      throw cause;
    }
  }

  async writeAtomic(relativePath: string, contents: string): Promise<void> {
    const target = this.#resolve(relativePath);
    await mkdir(dirname(target), { recursive: true });
    const temporary = join(dirname(target), `.${randomUUID()}.tmp`);
    await writeFile(temporary, contents, 'utf8');
    try {
      await rename(temporary, target);
    } catch (cause) {
      await rm(temporary, { force: true });
      throw cause;
    }
  }

  #resolve(relativePath: string): string {
    if (
      isAbsolute(relativePath) ||
      relativePath.split(/[\\/]+/u).includes('..')
    ) {
      throw new Error(
        `unsafe store path '${relativePath.slice(0, 80)}': paths must stay inside the matrix store root`,
      );
    }
    return join(this.#root, relativePath);
  }
}
