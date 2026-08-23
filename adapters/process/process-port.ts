import { spawn } from 'node:child_process';
import { platform } from 'node:os';

import type { ProcessPort, SpawnOutcome, SpawnRequest } from '../../core/ports.ts';

const POLL_GRACE_MS = 25;

class WindowsTreeStop implements ProcessPort {
  readonly platform = 'windows' as const;

  run(request: SpawnRequest, deadlineMs: number): Promise<SpawnOutcome> {
    return runWithTreeKill(request, deadlineMs, windowsTaskKillTree);
  }
}

class PosixProcessGroupStop implements ProcessPort {
  readonly platform = 'posix' as const;

  run(request: SpawnRequest, deadlineMs: number): Promise<SpawnOutcome> {
    return runWithTreeKill(request, deadlineMs, posixKillProcessGroup);
  }
}

export function createProcessPort(): ProcessPort {
  return platform() === 'win32' ? new WindowsTreeStop() : new PosixProcessGroupStop();
}

type StopMode = 'graceful' | 'force';

type TreeStopper = (pid: number, mode: StopMode) => Promise<boolean>;

async function runWithTreeKill(
  request: SpawnRequest,
  deadlineMs: number,
  stopTree: TreeStopper,
): Promise<SpawnOutcome> {
  const started = Date.now();
  const child = spawn(request.argv[0] ?? '', request.argv.slice(1), {
    cwd: request.cwd,
    env: request.envAllowlist,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: process.platform !== 'win32',
    windowsHide: true,
  });

  let killedByTreeStop = false;
  let timedOut = false;
  let cancelledByOperator = false;
  let stopStarted = false;
  let settled = false;
  const stdoutChunks: Buffer[] = [];
  const stderrChunks: Buffer[] = [];
  let stdoutBytes = 0;
  let stderrBytes = 0;
  const graceMs = Math.max(0, request.cancelGraceMs ?? 0);

  child.stdout?.on('data', (chunk: Buffer) => {
    if (stdoutBytes < request.stdoutLimitBytes) {
      stdoutChunks.push(chunk.subarray(0, request.stdoutLimitBytes - stdoutBytes));
      stdoutBytes += chunk.byteLength;
    }
  });
  child.stderr?.on('data', (chunk: Buffer) => {
    if (stderrBytes < request.stderrLimitBytes) {
      stderrChunks.push(chunk.subarray(0, request.stderrLimitBytes - stderrBytes));
      stderrBytes += chunk.byteLength;
    }
  });

  const forceStop = (): void => {
    void stopTree(child.pid ?? 0, 'force').then((stopped) => {
      killedByTreeStop ||= stopped;
    });
  };

  const gracefulThenForce = (): void => {
    if (stopStarted || settled) return;
    stopStarted = true;
    cancelledByOperator = true;
    void stopTree(child.pid ?? 0, 'graceful').catch(() => false);
    setTimeout(forceStop, graceMs);
  };

  const timer = setTimeout(() => {
    timedOut = true;
    forceStop();
  }, deadlineMs);

  if (request.cancel !== undefined) {
    request.cancel.onCancel(gracefulThenForce);
  }

  const outcome = await new Promise<SpawnOutcome>((resolve) => {
    const settle = (exitCode: number | null, signal: string | null) => {
      if (settled) return;
      settled = true;
      resolve({
        exitCode,
        signal,
        timedOut,
        killedByTreeStop,
        cancelledByOperator,
        wallMs: Date.now() - started,
        stdout: Buffer.concat(stdoutChunks),
        stderr: Buffer.concat(stderrChunks),
      });
    };
    child.on('close', (code, signal) => {
      if (!timedOut && !cancelledByOperator) {
        settle(code, signal);
        return;
      }
      // Windows tree-kill is asynchronous; give the pipes a moment to flush
      // so captured evidence is not truncated before the close event lands.
      setTimeout(() => settle(code, signal), POLL_GRACE_MS);
    });
    child.on('error', () => settle(-1, null));
  });

  clearTimeout(timer);
  return outcome;
}

async function windowsTaskKillTree(pid: number, mode: StopMode): Promise<boolean> {
  if (pid <= 0) return false;
  const args =
    mode === 'force'
      ? ['/pid', String(pid), '/T', '/F']
      : ['/pid', String(pid), '/T'];
  const killer = spawn('taskkill', args, {
    windowsHide: true,
  });
  return new Promise((resolve) => {
    killer.on('close', (code) => resolve(mode === 'force' ? code === 0 : true));
    killer.on('error', () => resolve(false));
  });
}

async function posixKillProcessGroup(pid: number, mode: StopMode): Promise<boolean> {
  if (pid <= 0) return false;
  try {
    process.kill(-pid, mode === 'force' ? 'SIGKILL' : 'SIGTERM');
    return true;
  } catch {
    return false;
  }
}

