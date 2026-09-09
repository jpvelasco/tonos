import { ScriptedCliAdapter, AIDER_PROFILE } from '../harness/scripted-cli-adapter.ts';
import { createNamedHarnessExecutor } from './named-harness-executor.ts';

export const AiderTrialExecutor = createNamedHarnessExecutor(
  'aider',
  (input) => new ScriptedCliAdapter(AIDER_PROFILE, input),
);
