import { createProcessPort } from './adapters/process/process-port.ts';
import { FileSystemWorkspacePort } from './adapters/workspace/fs-workspace-port.ts';
import { InMemoryConfigurationPort } from './tests/fixtures/in-memory-config-port.ts';
import { TrialRunner } from './core/trial-runner.ts';
import { fixtureTrialDeclaration } from './tests/fixtures/records.ts';

const clock = { nowIso: () => '1970-01-01T00:00:00.000Z', monotonicMs: () => 0 };
const ev = { append: () => {}, boundedEvents: () => [] };
const sp = { resolve: () => 'tonos-secret-canary-x-value' };
process.env['TONOS_PROBE_HOME_SENTINEL'] = 'C:\\nonexistent\\sentinel.txt';
const runner = new TrialRunner(createProcessPort(), new FileSystemWorkspacePort(), new InMemoryConfigurationPort(), clock, sp, ev);
const out = await runner.run({
  declaration: fixtureTrialDeclaration(),
  harnessArgv: [process.execPath, 'tests/fixtures/harness/fixture-harness.mjs', 'write-outside'],
  workspaceTemplateDir: '.',
});
console.log(JSON.stringify(out, null, 2));
