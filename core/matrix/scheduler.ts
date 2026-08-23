import type { CheckpointUnit, UnitState } from './checkpoint.ts';

export interface ScheduleEntry {
  state: UnitState;
  artifactDigest?: string | undefined;
  reasonClass?: string | undefined;
}

/**
 * Dispatch the next pending units while at most maxInFlight units are
 * neither done nor failed. Order is the derived deterministic unit order,
 * so partial runs always leave a completed prefix.
 */
export function planNext(
  entries: ReadonlyMap<string, ScheduleEntry>,
  maxInFlight: number,
  order: readonly string[],
): string[] {
  if (maxInFlight <= 0) return [];
  let inFlight = 0;
  for (const entry of entries.values()) {
    if (entry.state === 'running') inFlight += 1;
  }
  const next: string[] = [];
  for (const key of order) {
    if (next.length + inFlight >= maxInFlight) break;
    const entry = entries.get(key);
    if (entry === undefined || entry.state !== 'pending') continue;
    next.push(key);
  }
  return next;
}

export type ArtifactVerification = 'valid' | 'missing' | 'corrupt';

/**
 * The checkpoint may claim anything; only a backing artifact that verifies
 * earns a `done` state. Every other combination lands on pending so work is
 * re-run rather than trusted or silently dropped. This is what makes a
 * tampered or stale checkpoint cost redundant work instead of fabricated
 * evidence.
 */
export function adoptOrDemote(
  claim: CheckpointUnit | ScheduleEntry | undefined,
  verification: ArtifactVerification,
  verifiedDigest: string,
): ScheduleEntry {
  if (
    verification === 'valid' &&
    claim !== undefined &&
    (claim as ScheduleEntry).state !== 'schedule-failed'
  ) {
    return { state: 'done', artifactDigest: verifiedDigest };
  }
  return { state: 'pending' };
}
