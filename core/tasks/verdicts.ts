export interface ToolTraceEvent {
  tool: string;
  args?: Record<string, unknown>;
}

export interface TracePolicy {
  expectedOrder?: string[];
  requiredLast?: string;
  forbidden?: string[];
}

export interface WorkspaceVerdict {
  evaluatorId: string;
  passed: boolean;
  violations: string[];
}

export interface EvaluatorOutcome {
  evaluatorId: string;
  /** null means the evaluator could not run (declared missing evidence). */
  passed: boolean | null;
  subjective: boolean;
  skipped?: boolean | undefined;
  detail?: string | undefined;
}
