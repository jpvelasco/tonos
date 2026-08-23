import { contentId, sha256Hex } from '../canonical.ts';
import type { TrialMatrix } from '../records/matrix.ts';
import { trialIdOf } from '../records/trial.ts';

export interface MatrixUnit {
  declarationId: string;
  repetitionIndex: number;
}

const UNIT_KEY_PATTERN =
  /^(trn_trial_[0-9a-f]{64})~rep([0-9]{1,4})$/u;

/**
 * Content digest of everything that defines what a matrix run means.
 * createdAt is deliberately excluded: it is bookkeeping about when the
 * matrix was declared, not part of what the run compares.
 */
export function matrixDigestOf(matrix: TrialMatrix): string {
  const declarations = [...matrix.declarations]
    .map((payload) => ({ payload, id: trialIdOf(payload) }))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map(({ payload }) => payload);
  return sha256Hex(
    contentId('trn_mx_', {
      matrixId: matrix.matrixId,
      policyRevision: matrix.policyRevision,
      axes: [...matrix.axes].sort((a, b) => (a.axis < b.axis ? -1 : 1)),
      declarations,
    }).slice('trn_mx_'.length),
  );
}

export function unitsOf(matrix: TrialMatrix): MatrixUnit[] {
  const units: Array<MatrixUnit & { key: string }> = [];
  for (const payload of matrix.declarations) {
    const declarationId = trialIdOf(payload);
    for (let index = 0; index < payload.repetition.total; index++) {
      const unit = { declarationId, repetitionIndex: index };
      units.push({ ...unit, key: unitKeyOf(unit) });
    }
  }
  return units
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
    .map(({ key: _key, ...unit }) => unit);
}

export function unitKeyOf(unit: MatrixUnit): string {
  return `${unit.declarationId}~rep${unit.repetitionIndex}`;
}

export function parseUnitKey(key: string): MatrixUnit {
  const match = UNIT_KEY_PATTERN.exec(key);
  if (match === null) {
    throw new TypeError(
      `unit key '${key.slice(0, 80)}' must look like trn_trial_<hex64>~rep<n>`,
    );
  }
  return {
    declarationId: match[1] as string,
    repetitionIndex: Number(match[2]),
  };
}

export function resultPathFor(unit: MatrixUnit): string {
  return `results/${unit.declarationId}/rep-${unit.repetitionIndex}.json`;
}

export function scheduleFailurePathFor(unit: MatrixUnit): string {
  return `schedule-failures/${unitKeyOf(unit)}.json`;
}
