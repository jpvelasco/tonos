import { CodexAdapter } from '../harness/codex-adapter.ts';
import { createNamedHarnessExecutor } from './named-harness-executor.ts';

export const CodexTrialExecutor = createNamedHarnessExecutor('codex', (input) =>
  new CodexAdapter(input),
);
