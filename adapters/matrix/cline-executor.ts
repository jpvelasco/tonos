import { ScriptedCliAdapter, CLINE_PROFILE } from '../harness/scripted-cli-adapter.ts';
import { createNamedHarnessExecutor } from './named-harness-executor.ts';

export const ClineTrialExecutor = createNamedHarnessExecutor(
  'cline',
  (input) => new ScriptedCliAdapter(CLINE_PROFILE, input),
);
