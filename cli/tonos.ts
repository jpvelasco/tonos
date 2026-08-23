#!/usr/bin/env -S npx tsx
import { parseArgs } from 'node:util';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { decode, encode, CodecError } from '../core/codec.ts';
import { TrialMatrix } from '../core/records/matrix.ts';
import type { TrialMatrix as TrialMatrixType } from '../core/records/matrix.ts';
import { matrixDigestOf } from '../core/matrix/units.ts';
import { planMatrixRetention } from '../core/matrix/retention.ts';
import {
  MatrixRunner,
  type MatrixStorePort,
} from '../core/matrix/runner.ts';
import { FileSystemMatrixStore } from '../adapters/matrix/fs-matrix-store.ts';
import { FileSystemArtifactGc } from '../adapters/matrix/fs-artifact-gc.ts';
import { FixtureTrialExecutor } from '../adapters/matrix/trial-executor.ts';
import { createCancellation } from '../core/trial-runner.ts';

const EXIT_OK = 0;
const EXIT_USAGE = 1;
const EXIT_INVALID_MATRIX = 2;
const EXIT_INCOMPLETE = 3;
const EXIT_SCHEDULE_FAILURES = 4;
const EXIT_UNSUPPORTED_ADAPTER = 5;

function fail(code: number, message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(code);
}

async function loadMatrix(path: string): Promise<TrialMatrixType> {
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(path, 'utf8'));
  } catch (cause) {
    return fail(EXIT_INVALID_MATRIX, `invalid matrix document: cannot parse JSON (${String(cause)})`);
  }
  const document = raw as { kind?: unknown; schema_version?: unknown };
  if (document.kind === 'trialMatrix' && document.schema_version !== undefined) {
    try {
      return decode<TrialMatrixType>('trialMatrix', raw);
    } catch (cause) {
      if (cause instanceof CodecError) {
        return fail(EXIT_INVALID_MATRIX, `invalid matrix document: ${cause.message}`);
      }
      throw cause;
    }
  }
  const parsed = TrialMatrix.safeParse(raw);
  if (!parsed.success) {
    return fail(
      EXIT_INVALID_MATRIX,
      `invalid matrix document: ${parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ')}`,
    );
  }
  return parsed.data;
}

function buildStore(matrix: TrialMatrixType, artifactsDir: string): MatrixStorePort {
  const digest = matrixDigestOf(matrix);
  return new FileSystemMatrixStore(
    join(artifactsDir, `${matrix.matrixId}-${digest.slice(0, 12)}`),
  );
}

async function commandRun(args: {
  matrixPath: string;
  artifacts: string;
  workspaceTemplate?: string | undefined;
  fixtureHarness?: string | undefined;
  maxConcurrent?: number | undefined;
}): Promise<number> {
  const matrix = await loadMatrix(args.matrixPath);
  if (args.workspaceTemplate === undefined || args.fixtureHarness === undefined) {
    return fail(EXIT_USAGE, 'matrix run requires --workspace-template and --fixture-harness');
  }

  const unsupported = matrix.declarations.filter(
    (declaration) => declaration.harness.adapterKind !== 'fixture',
  );
  if (unsupported.length > 0) {
    return fail(
      EXIT_UNSUPPORTED_ADAPTER,
      `no executor for adapter kind '${unsupported[0]!.harness.adapterKind}' (${unsupported.length} declaration(s)); only 'fixture' is registered`,
    );
  }

  const cancellation = createCancellation();
  process.once('SIGINT', () => cancellation.requestCancel());

  const runner = new MatrixRunner(
    buildStore(matrix, args.artifacts),
    new FixtureTrialExecutor({
      workspaceTemplateDir: args.workspaceTemplate,
      fixtureHarnessPath: args.fixtureHarness,
    }),
    { nowIso: () => new Date().toISOString(), monotonicMs: () => Date.now() },
  );

  const report = await runner.run(matrix, {
    maxConcurrentTrials: args.maxConcurrent,
    cancellation,
  });
  process.stderr.write(
    `matrix ${matrix.matrixId}: done=${report.done} scheduleFailed=${report.scheduleFailed} pendingRemaining=${report.pendingRemaining}\n`,
  );

  if (report.pendingRemaining > 0) {
    process.stderr.write('run incomplete; re-run the same command to resume\n');
    return EXIT_INCOMPLETE;
  }
  if (report.scheduleFailed > 0) {
    process.stderr.write(
      'completed with schedule failures; see schedule-failures/ in the artifacts directory\n',
    );
    return EXIT_SCHEDULE_FAILURES;
  }
  return EXIT_OK;
}

async function commandQualify(args: {
  matrixPath: string;
  artifacts: string;
}): Promise<number> {
  const matrix = await loadMatrix(args.matrixPath);
  const runner = new MatrixRunner(
    buildStore(matrix, args.artifacts),
    {
      async executeUnit(): Promise<never> {
        throw new Error('qualify does not execute units');
      },
    },
    { nowIso: () => new Date().toISOString(), monotonicMs: () => Date.now() },
  );
  try {
    const decision = await runner.qualify(matrix);
    process.stdout.write(`${encode('qualificationDecision', decision)}\n`);
    return EXIT_OK;
  } catch (cause) {
    return fail(EXIT_INCOMPLETE, String(cause instanceof Error ? cause.message : cause));
  }
}

async function commandPrune(args: {
  artifacts: string;
  keepLast?: number | undefined;
  olderThanDays?: number | undefined;
  apply: boolean;
}): Promise<number> {
  if (args.keepLast === undefined && args.olderThanDays === undefined) {
    return fail(
      EXIT_USAGE,
      'matrix prune requires --keep-last or --older-than-days (refusing to plan without a retention axis)',
    );
  }
  const gc = new FileSystemArtifactGc(args.artifacts);
  const entries = await gc.listMatrixDirectories();
  const plan = planMatrixRetention(
    entries,
    { keepLastPerMatrix: args.keepLast, olderThanDays: args.olderThanDays },
    Date.now(),
  );

  for (const name of plan.unrecognized) {
    process.stderr.write(`ignored (not a matrix store directory): ${name}\n`);
  }
  if (plan.delete.length === 0) {
    process.stdout.write('nothing to prune\n');
    return EXIT_OK;
  }

  if (!args.apply) {
    process.stdout.write(
      `would delete ${plan.delete.length} matrix store director${plan.delete.length === 1 ? 'y' : 'ies'} (dry run; pass --apply):\n`,
    );
    for (const name of plan.delete) {
      process.stdout.write(`  - ${name}\n`);
    }
    return EXIT_OK;
  }

  for (const name of plan.delete) {
    await gc.removeDirectory(name);
    process.stdout.write(`deleted ${name}\n`);
  }
  process.stdout.write(
    `deleted ${plan.delete.length} matrix store director${plan.delete.length === 1 ? 'y' : 'ies'}\n`,
  );
  return EXIT_OK;
}

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    artifacts: { type: 'string' },
    'workspace-template': { type: 'string' },
    'fixture-harness': { type: 'string' },
    'max-concurrent': { type: 'string' },
    'keep-last': { type: 'string' },
    'older-than-days': { type: 'string' },
    apply: { type: 'boolean', default: false },
  },
});

const [group, command, matrixPath] = positionals;

if (group === 'matrix' && command === 'prune') {
  if (values.artifacts === undefined) {
    fail(EXIT_USAGE, '--artifacts is required');
  }
  const exitCode = await commandPrune({
    artifacts: values.artifacts,
    keepLast:
      values['keep-last'] !== undefined
        ? Number(values['keep-last'])
        : undefined,
    olderThanDays:
      values['older-than-days'] !== undefined
        ? Number(values['older-than-days'])
        : undefined,
    apply: values.apply === true,
  });
  process.exit(exitCode);
}

if (group !== 'matrix' || command === undefined || matrixPath === undefined) {
  fail(
    EXIT_USAGE,
    'usage: tonos matrix <run|qualify> <matrix.json> --artifacts <dir> [--workspace-template <dir>] [--fixture-harness <path>] [--max-concurrent <n>]\n' +
      '       tonos matrix prune --artifacts <dir> [--keep-last N] [--older-than-days D] [--apply]\n' +
      "resume is implicit: re-running against the same --artifacts dir adopts verified results and executes only what remains",
  );
}
if (values.artifacts === undefined) {
  fail(EXIT_USAGE, '--artifacts is required');
}

const exitCode = await (command === 'run'
  ? commandRun({
      matrixPath: matrixPath!,
      artifacts: values.artifacts,
      workspaceTemplate: values['workspace-template'],
      fixtureHarness: values['fixture-harness'],
      maxConcurrent:
        values['max-concurrent'] !== undefined
          ? Number(values['max-concurrent'])
          : undefined,
    })
  : command === 'qualify'
    ? commandQualify({ matrixPath: matrixPath!, artifacts: values.artifacts })
    : Promise.resolve(
        fail(EXIT_USAGE, `unknown command '${command}'; expected 'run' or 'qualify'`),
      ));
process.exit(exitCode);
