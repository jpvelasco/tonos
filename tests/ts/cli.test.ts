import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, readFile, mkdir, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);
const DAY_MS = 86_400_000;

async function seedArtifacts(root: string): Promise<void> {
  const now = Date.now();
  const dirs: Array<[string, number]> = [
    ['cli-matrix-aaaaaaaaaaaa', now - 1 * DAY_MS],
    ['cli-matrix-bbbbbbbbbbbb', now - 30 * DAY_MS],
    ['other-cccccccccccc', now - 2 * DAY_MS],
  ];
  for (const [name, mtime] of dirs) {
    await mkdir(join(root, name, 'results'), { recursive: true });
    await writeFile(join(root, name, 'checkpoint.json'), '{"checkpointVersion":1}', 'utf8');
    await utimes(join(root, name), new Date(mtime), new Date(mtime));
  }
  await writeFile(join(root, 'stray-file.txt'), 'keep me', 'utf8');
}
const CLI_ENTRY = new URL('../../cli/tonos.ts', import.meta.url).pathname.replace(
  /^\/([A-Za-z]:)/u,
  '$1',
);

function tsxCli(args: string[]): string[] {
  return ['--import', 'tsx', CLI_ENTRY, ...args];
}

async function writeMatrixDocument(
  dir: string,
): Promise<{ matrixPath: string }> {
  const mod = await import('../fixtures/records.ts');
  const { encode } = await import('../../core/codec.ts');
  const declaration = mod.fixtureTrialDeclaration();
  declaration.repetition = { index: 0, total: 1 };
  const { trialId: _stripped, ...payload } = declaration;
  const matrix = {
    matrixId: 'cli-matrix',
    policyRevision: '0.1.0',
    axes: [{ axis: 'harness' as const, variants: 1 }],
    declarations: [payload],
    createdAt: '1970-01-01T00:00:00.000Z',
  };
  const matrixPath = join(dir, 'matrix.json');
  await writeFile(matrixPath, encode('trialMatrix', matrix), 'utf8');
  return { matrixPath };
}

function runCli(args: string[], overrides?: { env?: NodeJS.ProcessEnv }) {
  return run(process.execPath, tsxCli(args), {
    env: { ...process.env, ...overrides?.env },
  });
}

const SECRET_ENV = { TONOS_SECRET_CREDMAN_FIXTURE_KEY_REF: 'cli-canary-value' };

test('cli runs a fixture matrix, then qualifies it; rerun resumes without re-execution', { timeout: 180_000 }, async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'tonos-cli-run-'));
  try {
    await writeFile(join(workspace, 'go.mod'), 'module fixture\n\ngo 1.22\n', 'utf8');
    await writeFile(
      join(workspace, 'fixture_test.go'),
      'package fixture\n\nimport "testing"\n\nfunc TestOk(t *testing.T) {}\n',
      'utf8',
    );
    const { matrixPath } = await writeMatrixDocument(workspace);
    const artifacts = join(workspace, 'artifacts');
    const harnessPath = new URL(
      '../fixtures/harness/fixture-harness.mjs',
      import.meta.url,
    ).pathname.replace(/^\/([A-Za-z]:)/u, '$1');

    const runOut = await runCli([
      'matrix', 'run', matrixPath,
      '--artifacts', artifacts,
      '--workspace-template', workspace,
      '--fixture-harness', harnessPath,
    ], { env: SECRET_ENV });
    assert.match(runOut.stderr, /done=1/u);

    const qualifyOut = await runCli([
      'matrix', 'qualify', matrixPath,
      '--artifacts', artifacts,
    ]);
    const decision = JSON.parse(qualifyOut.stdout);
    assert.equal(decision.kind, 'qualificationDecision');
    assert.equal(typeof decision.winnerDeclarationId, 'string');

    // Second run adopts everything from the checkpoint: nothing re-executes.
    await runCli([
      'matrix', 'run', matrixPath,
      '--artifacts', artifacts,
      '--workspace-template', workspace,
      '--fixture-harness', harnessPath,
    ], { env: SECRET_ENV });
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('cli rejects invalid matrix documents and unknown adapter kinds with distinct exit codes', { timeout: 120_000 }, async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'tonos-cli-bad-'));
  try {
    const badPath = join(workspace, 'bad.json');
    await writeFile(badPath, '{ not json', 'utf8');

    let failed = false;
    try {
      await run(process.execPath, tsxCli(['matrix', 'run', badPath, '--artifacts', join(workspace, 'a')]));
    } catch (error) {
      failed = true;
      const err = error as { code: number; stderr: string };
      assert.equal(err.code, 2);
      assert.match(err.stderr, /invalid matrix document/u);
    }
    assert.ok(failed, 'invalid json must fail');

    // A codex-kind declaration has no registered executor yet.
    const mod = await import('../fixtures/records.ts');
    const { encode } = await import('../../core/codec.ts');
    const declaration = mod.fixtureTrialDeclaration();
    declaration.harness.adapterKind = 'codex';
    const { trialId: _s, ...payload } = declaration;
    const codexMatrix = {
      matrixId: 'codex-matrix',
      policyRevision: '0.1.0',
      axes: [],
      declarations: [payload],
      createdAt: '1970-01-01T00:00:00.000Z',
    };
    const codexPath = join(workspace, 'codex.json');
    await writeFile(codexPath, encode('trialMatrix', codexMatrix), 'utf8');

    failed = false;
    try {
      await run(process.execPath, tsxCli([
        'matrix', 'run', codexPath,
        '--artifacts', join(workspace, 'a'),
        '--workspace-template', workspace,
        '--fixture-harness', 'unused-for-codex',
      ]));
    } catch (error) {
      failed = true;
      const err = error as { code: number; stderr: string };
      assert.equal(err.code, 5);
      assert.match(err.stderr, /no executor for adapter kind/u);
    }
    assert.ok(failed, 'unregistered adapter kind must fail cleanly');
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('qualify refuses an unfinished matrix with exit code 3', { timeout: 120_000 }, async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'tonos-cli-q-'));
  try {
    const { matrixPath } = await writeMatrixDocument(workspace);
    let failed = false;
    try {
      await run(process.execPath, tsxCli([
        'matrix', 'qualify', matrixPath,
        '--artifacts', join(workspace, 'empty-artifacts'),
      ]));
    } catch (error) {
      failed = true;
      const err = error as { code: number; stderr: string };
      assert.equal(err.code, 3);
      assert.match(err.stderr, /cannot qualify/u);
    }
    assert.ok(failed);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('matrix prune plans by default and deletes only on --apply', { timeout: 120_000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'tonos-cli-prune-'));
  try {
    await seedArtifacts(root);

    const dry = await runCli([
      'matrix', 'prune', '--artifacts', root,
      '--keep-last', '1',
    ]);
    assert.match(dry.stdout, /would delete 1 matrix store directory/u);
    assert.match(dry.stdout, /cli-matrix-bbbbbbbbbbbb/u);
    assert.equal(await readFile(join(root, 'cli-matrix-bbbbbbbbbbbb', 'checkpoint.json'), 'utf8'), '{"checkpointVersion":1}', 'dry run must not delete');

    const applied = await runCli([
      'matrix', 'prune', '--artifacts', root,
      '--keep-last', '1', '--apply',
    ]);
    assert.match(applied.stdout, /deleted 1 matrix store director/u);
    await assert.rejects(readFile(join(root, 'cli-matrix-bbbbbbbbbbbb', 'checkpoint.json')));
    await readFile(join(root, 'cli-matrix-aaaaaaaaaaaa', 'checkpoint.json'), 'utf8');
    await readFile(join(root, 'other-cccccccccccc', 'checkpoint.json'), 'utf8');
    await readFile(join(root, 'stray-file.txt'), 'utf8');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('matrix prune without a retention axis is a usage error', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tonos-cli-prune-bad-'));
  try {
    let failed = false;
    try {
      await runCli(['matrix', 'prune', '--artifacts', root]);
    } catch (error) {
      failed = true;
      const err = error as { code: number; stderr: string };
      assert.equal(err.code, 1);
      assert.match(err.stderr, /at least one retention axis|requires --keep-last or --older-than-days/u);
    }
    assert.ok(failed);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
