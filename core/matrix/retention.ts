const DAY_MS = 86_400_000;

const MATRIX_DIR_PATTERN = /^(?<matrixId>.+)-(?<digestPrefix>[0-9a-f]{12})$/u;

export interface RetentionEntry {
  name: string;
  modifiedAtMs: number;
}

export interface RetentionPolicy {
  /** Protect the newest N directories per matrix id from pruning. */
  keepLastPerMatrix?: number | undefined;
  /** Delete directories not touched within this many days. */
  olderThanDays?: number | undefined;
}

export interface RetentionPlan {
  keep: string[];
  delete: string[];
  unrecognized: string[];
}

export function matrixDirNameOf(
  matrixId: string,
  digestPrefix: string,
): string {
  return `${matrixId}-${digestPrefix}`;
}

export function parseMatrixDirName(
  name: string,
): { matrixId: string; digestPrefix: string } | undefined {
  const match = MATRIX_DIR_PATTERN.exec(name);
  if (match === null || match.groups === undefined) return undefined;
  return {
    matrixId: match.groups.matrixId!,
    digestPrefix: match.groups.digestPrefix!,
  };
}

/**
 * Decide which matrix store directories to delete. This only computes the
 * plan; deletion itself is always a separate explicit operator act.
 */
export function planMatrixRetention(
  entries: readonly RetentionEntry[],
  policy: RetentionPolicy,
  nowMs: number,
): RetentionPlan {
  const keepLast = policy.keepLastPerMatrix;
  const olderThanDays = policy.olderThanDays;

  if (keepLast === undefined && olderThanDays === undefined) {
    throw new TypeError(
      'refusing to plan without at least one retention axis (keepLastPerMatrix or olderThanDays)',
    );
  }
  for (const [axis, value] of [
    ['keepLastPerMatrix', keepLast],
    ['olderThanDays', olderThanDays],
  ] as const) {
    if (value === undefined) continue;
    if (!Number.isInteger(value)) {
      throw new TypeError(`retention axis ${axis} must be an integer`);
    }
    if (value < 0) {
      throw new TypeError(`retention axis ${axis} must be non-negative`);
    }
  }

  const cutoffMs =
    olderThanDays === undefined
      ? Number.POSITIVE_INFINITY
      : nowMs - olderThanDays * DAY_MS;

  const groups = new Map<string, RetentionEntry[]>();
  const unrecognized: string[] = [];
  for (const entry of entries) {
    const parsed = parseMatrixDirName(entry.name);
    if (parsed === undefined) {
      unrecognized.push(entry.name);
      continue;
    }
    const bucket = groups.get(parsed.matrixId) ?? [];
    bucket.push(entry);
    groups.set(parsed.matrixId, bucket);
  }

  const keep = new Set<string>();
  const del = new Set<string>();
  for (const bucket of groups.values()) {
    const newestFirst = [...bucket].sort((a, b) => b.modifiedAtMs - a.modifiedAtMs);
    const floor =
      keepLast === undefined ? 0 : Math.min(keepLast, newestFirst.length);
    for (const protectedEntry of newestFirst.slice(0, floor)) {
      keep.add(protectedEntry.name);
    }
    for (const candidate of newestFirst.slice(floor)) {
      // Without an age axis the floor alone bounds accumulation: everything
      // beyond it goes, regardless of age.
      if (olderThanDays === undefined || candidate.modifiedAtMs < cutoffMs) {
        del.add(candidate.name);
      } else {
        keep.add(candidate.name);
      }
    }
  }

  return {
    keep: [...keep].sort(),
    delete: [...del].sort(),
    unrecognized: [...unrecognized].sort(),
  };
}
