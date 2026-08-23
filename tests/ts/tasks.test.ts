import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, readFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  loadSuite,
  suiteDigest,
} from '../../core/tasks/suite.ts';
import { cp } from 'node:fs/promises';
import {
  evaluateExecutableTests,
  evaluateToolTrace,
  evaluateWorkspaceAssertions,
  declareRubricOutcome,
} from '../../core/tasks/evaluators.ts';
import type {
  ToolTraceEvent,
  TracePolicy,
} from '../../core/tasks/evaluators.ts';

const SUITE_DIR = new URL('../../tasks/retry-suite/', import.meta.url)
  .pathname.replace(/^\/([A-Za-z]:)/u, '$1');

const CORRECT_IMPL = `package retry

import (
	"context"
	"errors"
	"time"
)

func Retry(ctx context.Context, attempts int, backoff time.Duration, op func() error) error {
	if attempts <= 0 || op == nil {
		return errors.New("retry: invalid arguments")
	}
	var last error
	for i := 0; i < attempts; i++ {
		err := op()
		if err == nil {
			return nil
		}
		last = err
		if i == attempts-1 {
			break
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(backoff):
		}
	}
	return last
}
`;

// Compiles cleanly, passes the happy-path eye test, and is semantically wrong.
const WRONG_BUT_COMPILABLE = `package retry

import (
	"context"
	"errors"
	"time"
)

func Retry(ctx context.Context, attempts int, backoff time.Duration, op func() error) error {
	if attempts <= 0 || op == nil {
		return errors.New("retry: invalid arguments")
	}
	for i := 0; i < attempts; i++ {
		if err := op(); err != nil {
			time.Sleep(backoff)
			continue
		}
		return nil
	}
	return errors.New("attempts exhausted")
}
`;

test('suite manifest loads with recomputed immutable digests', async () => {
  const suite = await loadSuite(SUITE_DIR);
  assert.equal(suite.suiteId, 'go-retry');
  assert.equal(suite.revision, '1.0.0');
  assert.ok(Object.keys(suite.fixtureDigests).length >= 3);
  for (const digest of Object.values(suite.fixtureDigests)) {
    assert.match(digest, /^[0-9a-f]{64}$/u);
  }
});

test('mutating any fixture byte changes the suite identity', async () => {
  const before = await suiteDigest(SUITE_DIR);
  const dir = await mkdtemp(join(tmpdir(), 'tonos-suite-'));
  try {
    await rm(dir, { recursive: true, force: true });
    const { cp } = await import('node:fs/promises');
    await cp(SUITE_DIR, dir, { recursive: true });
    const promptPath = join(dir, 'fixtures', 'prompt.md');
    await writeFile(promptPath, (await readFile(promptPath, 'utf8')) + '\ntampered', 'utf8');
    const after = await suiteDigest(dir);
    assert.notEqual(before, after);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('executable correctness detects semantically wrong but compilable output', { timeout: 60_000 }, async () => {
  const ws = await mkdtemp(join(tmpdir(), 'tonos-eval-'));
  try {
    await cp(join(SUITE_DIR, 'fixtures'), ws, { recursive: true });
    await writeFile(join(ws, 'retry.go'), WRONG_BUT_COMPILABLE, 'utf8');

    const verdict = await evaluateExecutableTests(ws, 60_000);
    assert.equal(verdict.evaluatorId, 'executable-tests');
    assert.equal(verdict.subjective, false);
    assert.equal(verdict.passed, false, 'wrong-but-compilable output must not pass');
    assert.ok((verdict.detail ?? '').length > 0);

    await writeFile(join(ws, 'retry.go'), CORRECT_IMPL, 'utf8');
    const goodVerdict = await evaluateExecutableTests(ws, 60_000);
    assert.equal(goodVerdict.passed, true, 'a correct implementation must pass');
  } finally {
    await rm(ws, { recursive: true, force: true });
  }
});

test('tool traces detect wrong tool, wrong order, and missing verification', () => {
  const policy: TracePolicy = {
    expectedOrder: ['read-file', 'apply-diff'],
    requiredLast: 'run-tests',
    forbidden: ['delete-repo'],
  };

  const verdict = (events: ToolTraceEvent[]) =>
    evaluateToolTrace(events, policy);

  assert.equal(verdict([
    { tool: 'read-file' },
    { tool: 'apply-diff' },
    { tool: 'run-tests' },
  ]).passed, true);

  assert.equal(verdict([
    { tool: 'write-file' },
    { tool: 'run-tests' },
  ]).passed, false, 'wrong first tool must be detected');

  assert.equal(verdict([
    { tool: 'run-tests' },
    { tool: 'apply-diff' },
  ]).passed, false, 'out-of-order tools must be detected');

  assert.equal(verdict([
    { tool: 'read-file' },
    { tool: 'apply-diff' },
  ]).passed, false, 'missing verification must be detected');

  assert.equal(verdict([
    { tool: 'read-file' },
    { tool: 'delete-repo' },
    { tool: 'run-tests' },
  ]).violations.some((v) => v.includes('forbidden')), true);
});

test('workspace assertions detect unintended edits outside declared paths', async () => {
  const port = new (await import('../../adapters/workspace/fs-workspace-port.ts')).FileSystemWorkspacePort();
  const root = await mkdtemp(join(tmpdir(), 'tonos-ws-'));
  try {
    await writeFile(join(root, 'retry.go'), 'package retry\n', 'utf8');
    await writeFile(join(root, 'notes.txt'), 'scratch\n', 'utf8');
    const before = await port.snapshot(root);
    await writeFile(join(root, 'retry.go'), 'package retry // edited\n', 'utf8');
    await writeFile(join(root, 'notes.txt'), 'CORRUPTED\n', 'utf8');
    const after = await port.snapshot(root);

    const withinPolicy = ['retry.go'];
    const verdict = evaluateWorkspaceAssertions(before, after, withinPolicy);
    assert.equal(verdict.passed, false);
    assert.ok(verdict.violations.some((v) => v.includes('notes.txt')));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('rubric-only outcomes are visibly labeled subjective', () => {
  const outcome = declareRubricOutcome(0.8, 'style looks clean to a reviewer');
  assert.equal(outcome.subjective, true);
  assert.equal(outcome.evaluatorId, 'rubric');
});

test('ephemeral artifacts are removed after evaluation', { timeout: 60_000 }, async () => {
  const ws = await mkdtemp(join(tmpdir(), 'tonos-eph-'));
  try {
    await cp(join(SUITE_DIR, 'fixtures'), ws, { recursive: true });
    await writeFile(join(ws, 'retry.go'), CORRECT_IMPL, 'utf8');
    await evaluateExecutableTests(ws, 60_000, { cleanupEphemeral: ['ephemeral-marker.txt'] });
    let exists = false;
    try {
      await access(join(ws, 'ephemeral-marker.txt'));
      exists = true;
    } catch {
      exists = false;
    }
    assert.equal(exists, false, 'declared ephemeral content must be removed');
  } finally {
    await rm(ws, { recursive: true, force: true });
  }
});

