import { spawn } from 'node:child_process';
import { platform } from 'node:os';

import type { ProcessPort, SpawnOutcome, SpawnRequest } from '../../core/ports.ts';

const POLL_GRACE_MS = 25;

class WindowsTreeStop implements ProcessPort {
  readonly platform = 'windows' as const;

  run(request: SpawnRequest, deadlineMs: number): Promise<SpawnOutcome> {
    return runWithTreeKill(request, deadlineMs, (pid) =>
      windowsTaskKillTree(pid),
    );
  }
}

class PosixProcessGroupStop implements ProcessPort {
  readonly platform = 'posix' as const;

  run(request: SpawnRequest, deadlineMs: number): Promise<SpawnOutcome> {
    return runWithTreeKill(request, deadlineMs, (pid) =>
      posixKillProcessGroup(pid),
    );
  }
}

export function createProcessPort(): ProcessPort {
  return platform() === 'win32' ? new WindowsTreeStop() : new PosixProcessGroupStop();
}

async function runWithTreeKill(
  request: SpawnRequest,
  deadlineMs: number,
  stopTree: (pid: number) => Promise<boolean>,
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
  const stdoutChunks: Buffer[] = [];
  const stderrChunks: Buffer[] = [];
  let stdoutBytes = 0;
  let stderrBytes = 0;

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

  const timer = setTimeout(() => {
    timedOut = true;
    void stopTree(child.pid ?? 0).then((stopped) => {
      killedByTreeStop = stopped;
    });
  }, deadlineMs);

  const outcome = await new Promise<SpawnOutcome>((resolve) => {
    const settle = (exitCode: number | null, signal: string | null) => {
      resolve({
        exitCode,
        signal,
        timedOut,
        killedByTreeStop,
        wallMs: Date.now() - started,
        stdout: Buffer.concat(stdoutChunks),
        stderr: Buffer.concat(stderrChunks),
      });
    };
    child.on('close', (code, signal) => {
      if (!timedOut || killedByTreeStop || signal !== null) {
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

async function windowsTaskKillTree(pid: number): Promise<boolean> {
  if (pid <= 0) return false;
  const killer = spawn('taskkill', ['/pid', String(pid), '/T', '/F'], {
    windowsHide: true,
  });
  return new Promise((resolve) => {
    killer.on('close', (code) => resolve(code === 0));
    killer.on('error', () => resolve(false));
  });
}

async function posixKillProcessGroup(pid: number): Promise<boolean> {
  if (pid <= 0) return false;
  try {
    process.kill(-pid, 'SIGKILL');
    return true;
  } catch {
    return false;
  }
}

