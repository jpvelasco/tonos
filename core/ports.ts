import type { TerminalState } from './records/trial.ts';

export interface Clock {
  nowIso(): string;
  monotonicMs(): number;
}

export interface SecretProvider {
  resolve(reference: string): string;
}

export interface SpawnRequest {
  argv: readonly string[];
  cwd: string;
  envAllowlist: Readonly<Record<string, string>>;
  stdoutLimitBytes: number;
  stderrLimitBytes: number;
  /** Present when the operator may cancel; the port stages graceful-then-force. */
  cancel?: ProcessCancelSignal | undefined;
  cancelGraceMs?: number | undefined;
}

export interface ProcessCancelSignal {
  onCancel(listener: () => void): void;
}

export interface SpawnOutcome {
  exitCode: number | null;
  signal: string | null;
  timedOut: boolean;
  killedByTreeStop: boolean;
  cancelledByOperator: boolean;
  wallMs: number;
  stdout: Buffer;
  stderr: Buffer;
}

export interface ProcessPort {
  readonly platform: 'posix' | 'windows';
  run(request: SpawnRequest, deadlineMs: number): Promise<SpawnOutcome>;
}

export interface WorkspaceSnapshot {
  inputDigest: string;
  fileCount: number;
  files: Readonly<Record<string, { digest: string; lines: number }>>;
}

export interface WorkspaceDiff {
  filesChanged: number;
  insertions: number;
  deletions: number;
}

export interface WorkspacePort {
  createDisposable(sourceTemplateDir: string): Promise<string>;
  snapshot(root: string): Promise<WorkspaceSnapshot>;
  diff(
    before: WorkspaceSnapshot,
    after: WorkspaceSnapshot,
  ): WorkspaceDiff;
  digest(root: string): Promise<string>;
  removeOwned(root: string): Promise<void>;
}

export interface RenderedConfiguration {
  configRoot: string;
  effectiveNotes: readonly string[];
}

export interface ConfigurationPort {
  renderDisposableRoot(
    harnessId: string,
    trialToken: string,
    settings: Readonly<Record<string, unknown>>,
  ): Promise<RenderedConfiguration>;
  removeOwned(configRoot: string): Promise<void>;
}

export interface EvidenceEvent {
  atMs: number;
  kind: 'phase' | 'stdout-line' | 'stderr-line' | 'cleanup' | 'terminal';
  detail: string;
}

export interface EvidenceSink {
  append(event: EvidenceEvent): void;
  boundedEvents(): readonly EvidenceEvent[];
}

export type RunnerFailureClass = Extract<
  TerminalState,
  'timed-out' | 'cancelled' | 'invalid' | 'unsupported'
>;

export const TERMINAL_MESSAGES: Record<TerminalState, string> = {
  passed: 'trial completed and verification succeeded',
  failed: 'trial completed but evaluation or verification failed',
  'timed-out': 'trial exceeded its declared wall-clock limit',
  cancelled: 'trial was cancelled before completion',
  unsupported: 'declared configuration is not supported by the adapter',
  invalid: 'trial produced unparseable or incomplete evidence',
};
