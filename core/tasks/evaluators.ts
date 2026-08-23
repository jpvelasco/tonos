import { access, rm, writeFile, readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { join } from 'node:path';

import type {
  ToolTraceEvent,
  TracePolicy,
  WorkspaceVerdict,
  EvaluatorOutcome,
} from './verdicts.ts';
import type { WorkspaceSnapshot } from '../ports.ts';

export type { ToolTraceEvent, TracePolicy };

// --- executable tests -----------------------------------------------------

export async function evaluateExecutableTests(
  workspaceDir: string,
  timeoutMs: number = 60_000,
  options?: { cleanupEphemeral?: string[] },
): Promise<EvaluatorOutcome & { detail?: string; exitCode?: number | null }> {
  for (const ephemeral of options?.cleanupEphemeral ?? []) {
    try {
      await writeFile(join(workspaceDir, ephemeral), 'ephemeral\n', 'utf8');
    } catch {
      // marker is best-effort; removal is asserted by the caller
    }
  }

  let passed = false;
  let detail = '';

  try {
    await execWithTimeout('go', ['version'], 10_000);
  } catch {
    return {
      evaluatorId: 'executable-tests',
      passed: null,
      subjective: false,
      skipped: true,
      detail: 'go toolchain unavailable; executable evaluation not run',
    };
  }
  let code: number | null = null;
  try {
    const result = await execWithTimeout(
      'go',
      ['test', '-count=1', './...'],
      timeoutMs,
      workspaceDir,
    );
    code = result.code;
    passed = code === 0;
    detail = result.output.slice(0, 2_000);
  } catch (cause) {
    passed = false;
    detail = String(cause).slice(0, 500);
  }

  for (const ephemeral of options?.cleanupEphemeral ?? []) {
    await rm(join(workspaceDir, ephemeral), { force: true });
  }

  return {
    evaluatorId: 'executable-tests',
    passed,
    subjective: false,
    exitCode: code,
    ...(detail !== '' ? { detail } : {}),
  };
}

async function exists(path: string, otherwise: () => boolean): Promise<boolean> {
  try {
    await readFile(path);
    return true;
  } catch {
    return otherwise();
  }
}

function execWithTimeout(
  cmd: string,
  args: string[],
  timeoutMs: number,
  cwd?: string,
): Promise<{ code: number | null; output: string }> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let output = '';
    child.stdout?.on('data', (c: Buffer) => {
      output += c.toString('utf8');
    });
    child.stderr?.on('data', (c: Buffer) => {
      output += c.toString('utf8');
    });
    const timer = setTimeout(() => child.kill(), timeoutMs);
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, output });
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ code: -1, output: String(err) });
    });
  });
}

// --- tool traces ----------------------------------------------------------

export function evaluateToolTrace(
  events: ToolTraceEvent[],
  policy: TracePolicy,
): WorkspaceVerdict & { evaluatorId: string } {
  const violations: string[] = [];

  if (policy.expectedOrder !== undefined) {
    const actualTools = events.map((e) => e.tool);
    const positions = policy.expectedOrder.map((tool) =>
      actualTools.indexOf(tool),
    );
    if (positions.some((p) => p === -1)) {
      violations.push(
        `missing expected tools: ${policy.expectedOrder
          .filter((t, i) => positions[i] === -1)
          .join(', ')}`,
      );
    } else {
      const inOrder = positions.every(
        (p, i) => i === 0 || p > (positions[i - 1] as number),
      );
      if (!inOrder) {
        violations.push(
          `expected tool order ${JSON.stringify(policy.expectedOrder)} but observed ${JSON.stringify(actualTools)}`,
        );
      }
    }
  }

  if (
    policy.requiredLast !== undefined &&
    (events.length === 0 || events[events.length - 1]?.tool !== policy.requiredLast)
  ) {
    violations.push(
      `missing verification: last tool must be '${String(policy.requiredLast)}'`,
    );
  }

  for (const event of events) {
    if (policy.forbidden?.includes(event.tool)) {
      violations.push(`forbidden tool used: ${event.tool}`);
    }
  }

  return { evaluatorId: 'tool-trace', passed: violations.length === 0, violations };
}

// --- workspace assertions ---------------------------------------------------

export function evaluateWorkspaceAssertions(
  before: WorkspaceSnapshot,
  after: WorkspaceSnapshot,
  writablePaths: readonly string[],
): WorkspaceVerdict {
  const violations: string[] = [];
  for (const path of Object.keys(after.files)) {
    const changed = before.files[path] === undefined ||
      before.files[path]?.digest !== after.files[path]?.digest;
    if (changed && !writablePaths.includes(path)) {
      violations.push(`unintended edit outside declared writable paths: ${path}`);
    }
  }
  for (const path of Object.keys(before.files)) {
    if (after.files[path] === undefined && !writablePaths.includes(path)) {
      violations.push(`undeclared deletion outside declared writable paths: ${path}`);
    }
  }
  return {
    evaluatorId: 'workspace-assertions',
    passed: violations.length === 0,
    violations,
  };
}

// --- rubrics ---------------------------------------------------------------

export function declareRubricOutcome(
  score: number,
  note: string,
): EvaluatorOutcome & { detail?: string } {
  if (score < 0 || score > 1) {
    throw new RangeError('rubric scores are bounded to [0, 1]');
  }
  return {
    evaluatorId: 'rubric',
    passed: score >= 0.5,
    subjective: true,
    ...(note !== '' ? { detail: `rubric(${score}): ${note}` } : {}),
  };
}
