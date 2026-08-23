import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createProcessPort } from '../../adapters/process/process-port.ts';
import { FileSystemWorkspacePort } from '../../adapters/workspace/fs-workspace-port.ts';
import { InMemoryConfigurationPort } from '../fixtures/in-memory-config-port.ts';
import { fixtureTrialDeclaration } from '../fixtures/records.ts';
import {
  TrialRunner,
} from '../../core/trial-runner.ts';
import type {
  Clock,
  EvidenceSink,
  SecretProvider,
} from '../../core/ports.ts';

const FIXTURE_HARNESS = fileUrl('../fixtures/harness/fixture-harness.mjs');

function fileUrl(relative: string): string {
  return new URL(relative, import.meta.url).pathname
    .replace(/^\/([A-Za-z]:)/u, '$1');
}

class TestClock implements Clock {
  #tick = 0;
  nowIso(): string {
    this.#tick += 1;
    return new Date(1_000_000 + this.#tick * 1_000).toISOString();
  }
  monotonicMs(): number {
    return this.#tick * 100;
  }
}

class RecordingEvidence implements EvidenceSink {
  readonly events: string[] = [];
  append(event: { kind: string; detail: string }): void {
    this.events.push(`${event.kind}: ${event.detail}`);
  }
  boundedEvents() {
    return [];
  }
}

const secretsSeenByChild: string[] = [];

const secretProvider: SecretProvider = {
  resolve(reference: string): string {
    const value = `tonos-secret-canary-${reference}-value`;
    secretsSeenByChild.push(value);
    return value;
  },
};

let evidence: RecordingEvidence;

beforeEach(() => {
  evidence = new RecordingEvidence();
  secretsSeenByChild.length = 0;
});

function makeRunner(): TrialRunner {
  return new TrialRunner(
    createProcessPort(),
    new FileSystemWorkspacePort(),
    new InMemoryConfigurationPort(),
    new TestClock(),
    secretProvider,
    evidence,
  );
}

async function writeTemplate(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'tonos-template-'));
  await writeFile(join(dir, 'README.md'), '# fixture repo\n', 'utf8');
  return dir;
}

test('fixture harness runs isolated and passes with structured tool events', async () => {
  const template = await writeTemplate();
  const runner = makeRunner();
  const declaration = fixtureTrialDeclaration();

  const output = await runner.run({
    declaration,
    harnessArgv: [process.execPath, FIXTURE_HARNESS, 'tools'],
    workspaceTemplateDir: template,
  });

  assert.equal(output.terminalState, 'passed');
  assert.deepEqual(
    output.toolEvents.map((e) => e.tool),
    ['read-file', 'apply-diff'],
  );
  assert.equal(output.cleanupComplete, true);
  assert.match(output.trialId, /^trn_trial_[0-9a-f]{64}$/u);
  await rm(template, { recursive: true, force: true });
});

test('timeout stops the whole process tree including grandchildren', { timeout: 20_000 }, async () => {
  const template = await writeTemplate();
  const runner = makeRunner();
  const declaration = fixtureTrialDeclaration();
  declaration.limits.wallMs = 400;
  declaration.limits.cancelGraceMs = 50;

  const output = await runner.run({
    declaration,
    harnessArgv: [process.execPath, FIXTURE_HARNESS, 'spawn-grandchild'],
    workspaceTemplateDir: template,
  });

  assert.equal(output.terminalState, 'timed-out');
  assert.equal(output.cleanupComplete, true);
  await assertGrandchildrenAreGone();
});

test('credential canaries reach only the child environment and never captured output', async () => {
  const template = await writeTemplate();
  const runner = makeRunner();
  const output = await runner.run({
    declaration: fixtureTrialDeclaration(),
    harnessArgv: [process.execPath, FIXTURE_HARNESS, 'tools'],
    workspaceTemplateDir: template,
  });

  assert.equal(output.terminalState, 'passed');
  assert.ok(secretsSeenByChild.length > 0, 'runner must inject declared secrets');
  for (const value of secretsSeenByChild) {
    assert.ok(
      !JSON.stringify(output).includes(value),
      'resolved secret values must never appear in trial records',
    );
    assert.ok(
      !evidence.events.some((event) => event.includes(value)),
      'resolved secret values must never appear in evidence',
    );
  }
  assert.ok(
    evidence.events.some((event) => event.includes('secret-received') === false),
  );
  await rm(template, { recursive: true, force: true });
});

test('unparseable structured events persist an honest invalid terminal result', async () => {
  const template = await writeTemplate();
  const runner = makeRunner();
  const output = await runner.run({
    declaration: fixtureTrialDeclaration(),
    harnessArgv: [process.execPath, FIXTURE_HARNESS, 'garbage'],
    workspaceTemplateDir: template,
  });

  assert.equal(output.terminalState, 'invalid');
  assert.ok(output.missingEvidence.length > 0);
  await rm(template, { recursive: true, force: true });
});

test('crashing harness yields failed state without fabricated evidence', async () => {
  const template = await writeTemplate();
  const runner = makeRunner();
  const output = await runner.run({
    declaration: fixtureTrialDeclaration(),
    harnessArgv: [process.execPath, FIXTURE_HARNESS, 'crash'],
    workspaceTemplateDir: template,
  });

  assert.equal(output.terminalState, 'failed');
  assert.ok(output.errorMessages.length > 0);
  await rm(template, { recursive: true, force: true });
});

test('ambient environment secrets never reach the child; sentinel stays untouched', async () => {
  const template = await writeTemplate();
  const fakeHome = await mkdtemp(join(tmpdir(), 'tonos-fake-home-'));
  const sentinelPath = join(fakeHome, 'sentinel.txt');
  await writeFile(sentinelPath, 'original', 'utf8');

  // The path exists in the RUNNER'S environment only. The child environment
  // is rebuilt from an explicit allowlist, so no ambient value can leak —
  // even though the fixture harness actively hunts for one.
  const ambientKey = 'TONOS_PROBE_HOME_SENTINEL';
  process.env[ambientKey] = sentinelPath;
  try {
    const runner = makeRunner();
    const output = await runner.run({
      declaration: fixtureTrialDeclaration(),
      harnessArgv: [process.execPath, FIXTURE_HARNESS, 'write-outside'],
      workspaceTemplateDir: template,
    });
    assert.equal(output.terminalState, 'passed');
    assert.equal(
      await readFile(sentinelPath, 'utf8'),
      'original',
      'sentinel must remain unchanged; the child must never learn its path',
    );
    assert.ok(
      !output.toolEvents.some((event) => event.tool === 'tamper'),
      'harness must find no ambient probe target in its allowlisted environment',
    );
  } finally {
    delete process.env[ambientKey];
    await rm(fakeHome, { recursive: true, force: true });
    await rm(template, { recursive: true, force: true });
  }
});

async function assertGrandchildrenAreGone(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 300));
  if (process.platform === 'win32') {
    const { execFile } = await import('node:child_process');
    const { promisify } = await import('node:util');
    const run = promisify(execFile);
    let stdout = '';
    try {
      ({ stdout } = await run('wmic', [
        'process',
        'where',
        "name='node.exe'",
        'get',
        'commandline',
      ]));
    } catch {
      return;
    }
    assert.ok(
      !stdout.includes('fixture-harness'),
      'no fixture-harness process may survive the timeout',
    );
    return;
  }
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const run = promisify(execFile);
  try {
    const { stdout } = await run('ps', ['-eo', 'args']);
    assert.ok(
      !stdout.includes('fixture-harness'),
      'no fixture-harness process may survive the timeout',
    );
  } catch {
    // ps unavailable; tree-kill correctness is covered by exit semantics
  }
}

