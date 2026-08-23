#!/usr/bin/env -S npx tsx
import { parseArgs } from 'node:util';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { decode, encode, CodecError } from '../core/codec.ts';
import { TrialMatrix } from '../core/records/matrix.ts';
import type { TrialMatrix as TrialMatrixType } from '../core/records/matrix.ts';
import { matrixDigestOf } from '../core/matrix/units.ts';
import {
  MatrixRunner,
  type MatrixStorePort,
} from '../core/matrix/runner.ts';
import { FileSystemMatrixStore } from '../adapters/matrix/fs-matrix-store.ts';
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

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    artifacts: { type: 'string' },
    'workspace-template': { type: 'string' },
    'fixture-harness': { type: 'string' },
    'max-concurrent': { type: 'string' },
  },
});

const [group, command, matrixPath] = positionals;
if (group !== 'matrix' || command === undefined || matrixPath === undefined) {
  fail(
    EXIT_USAGE,
    'usage: tonos matrix <run|qualify> <matrix.json> --artifacts <dir> [--workspace-template <dir>] [--fixture-harness <path>] [--max-concurrent <n>]\n' +
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
