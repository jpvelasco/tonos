import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  planMatrixRetention,
  matrixDirNameOf,
  parseMatrixDirName,
} from '../../core/matrix/retention.ts';

const DAY = 86_400_000;

function entry(name: string, ageDays: number) {
  return { name, modifiedAtMs: 1_000 * DAY - ageDays * DAY };
}

test('keep-last protects the newest N directories per matrix id and marks the excess for deletion', () => {
  const plan = planMatrixRetention(
    [
      entry('matrix-a-aaaaaaaaaaaa', 1),
      entry('matrix-a-bbbbbbbbbbbb', 5),
      entry('matrix-a-cccccccccccc', 9),
      entry('matrix-b-dddddddddddd', 2),
    ],
    { keepLastPerMatrix: 1 },
    1_000 * DAY,
  );

  assert.deepEqual(plan.delete.sort(), ['matrix-a-bbbbbbbbbbbb', 'matrix-a-cccccccccccc']);
  assert.deepEqual(plan.keep.sort(), ['matrix-a-aaaaaaaaaaaa', 'matrix-b-dddddddddddd']);
});

test('older-than-days prunes aged directories beyond the keep-last floor', () => {
  const plan = planMatrixRetention(
    [
      entry('matrix-a-aaaaaaaaaaaa', 30),
      entry('matrix-a-bbbbbbbbbbbb', 10),
      entry('matrix-a-cccccccccccc', 2),
      entry('matrix-b-dddddddddddd', 40),
    ],
    { olderThanDays: 7 },
    1_000 * DAY,
  );

  // matrix-a keeps its newest (cccc, age 2); bbbbb (age 10) is old AND not
  // protected; aaaaa (age 30) likewise.
  assert.deepEqual(plan.delete.sort(), ['matrix-a-aaaaaaaaaaaa', 'matrix-a-bbbbbbbbbbbb', 'matrix-b-dddddddddddd']);
  assert.deepEqual(plan.keep, ['matrix-a-cccccccccccc']);
});

test('combining axes: the keep-last floor wins over age for the newest entries', () => {
  const plan = planMatrixRetention(
    [
      entry('matrix-a-aaaaaaaaaaaa', 90),
      entry('matrix-a-bbbbbbbbbbbb', 60),
    ],
    { keepLastPerMatrix: 2, olderThanDays: 30 },
    1_000 * DAY,
  );

  assert.deepEqual(plan.delete, []);
  assert.equal(plan.keep.length, 2);
});

test('a policy with no axis, or negative values, is rejected up front', () => {
  assert.throws(() => planMatrixRetention([], {}, 0), /at least one retention axis/u);
  assert.throws(() => planMatrixRetention([], { keepLastPerMatrix: -1 }, 0), /non-negative/u);
  assert.throws(() => planMatrixRetention([], { olderThanDays: -1 }, 0), /non-negative/u);
  assert.throws(() => planMatrixRetention([], { keepLastPerMatrix: 1.5 }, 0), /integer/u);
});

test('entries that are not matrix store directories are reported and never deleted', () => {
  const plan = planMatrixRetention(
    [entry('README.txt', 400), entry('not-a-matrix-dir', 400)],
    { keepLastPerMatrix: 1 },
    1_000 * DAY,
  );

  assert.deepEqual(plan.delete, []);
  assert.deepEqual(plan.unrecognized.sort(), ['README.txt', 'not-a-matrix-dir']);
});

test('directory names round-trip through matrixDirNameOf', () => {
  assert.equal(matrixDirNameOf('cli-matrix', 'ec4268ed20b6'), 'cli-matrix-ec4268ed20b6');
  const name = 'my_matrix-abcdef123456';
  const parsed = parseMatrixDirName(name);
  assert.deepEqual(parsed, { matrixId: 'my_matrix', digestPrefix: 'abcdef123456' });
  assert.equal(parseMatrixDirName('random-junk'), undefined);
});
