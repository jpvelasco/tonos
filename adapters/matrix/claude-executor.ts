import { ClaudeAdapter } from '../harness/claude-adapter.ts';
import { createNamedHarnessExecutor } from './named-harness-executor.ts';

export const ClaudeTrialExecutor = createNamedHarnessExecutor(
  'openclaude',
  (input) => new ClaudeAdapter(input),
);
