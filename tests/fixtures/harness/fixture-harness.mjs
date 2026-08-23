#!/usr/bin/env node
// Fixture harness for trial-runner acceptance tests. Emits structured events,
// probes its environment, and never touches anything outside cwd.

import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const mode = process.argv[2] ?? 'pass';

function emit(event) {
  process.stdout.write(JSON.stringify({ tonos_event: event.type, ...event }) + '\n');
}

function emitRaw(line) {
  process.stdout.write(line + '\n');
}

function main() {
  const args = Object.fromEntries(
    process.argv.slice(3)
      .filter((a) => a.startsWith('--'))
      .map((a) => {
        const eq = a.indexOf('=');
        return eq >= 0 ? [a.slice(2, eq), a.slice(eq + 1)] : [a.slice(2), true];
      }),
  );
  const format = args['format'] ?? 'tonos';
  const model = args['model'] ?? 'test-model';

  emit({ type: 'start', mode });

  if (format === 'a') {
    emitRaw(`[tool] name=read-file ok=true`);
    emitRaw(`[tool] name=apply-diff ok=true`);
    emitRaw(`[config] model=${model} ctx=4096`);
  } else if (format === 'b') {
    emitRaw(JSON.stringify({ evt: 'tool_call', name: 'read-file', status: 'ok' }));
    emitRaw(JSON.stringify({ evt: 'tool_call', name: 'apply-diff', status: 'ok' }));
    emitRaw(JSON.stringify({ evt: 'cfg', model_alias: model, ctx_tokens: 4096 }));
  } else if (mode === 'tools') {
    emit({ type: 'tool', tool: 'read-file', ok: true });
    emit({ type: 'tool', tool: 'apply-diff', ok: true });
  }

  if (process.env['TONOS_SECRET_CANARY_KEY'] !== undefined) {
    // Report receipt WITHOUT echoing the value; the runner refuses trials
    // whose captured output contains a resolved secret value.
    emit({
      type: 'secret-received',
      length: process.env['TONOS_SECRET_CANARY_KEY'].length,
    });
  }

  if (mode === 'spawn-grandchild') {
    const grandchild = spawn(
      process.execPath,
      ['-e', 'setInterval(() => {}, 1000)'],
      { stdio: 'ignore' },
    );
    grandchild.unref();
    emit({ type: 'tool', tool: 'spawn', ok: true });
    // The harness itself now hangs so the runner must stop the whole tree.
    setInterval(() => {}, 1000);
    return;
  }

  if (mode === 'hang') {
    emit({ type: 'tool', tool: 'begin-hang', ok: true });
    setInterval(() => {}, 1000);
    return;
  }

  if (mode === 'garbage') {
    process.stdout.write('{"tonos_event" broken json\n');
    process.exit(0);
  }

  if (mode === 'crash') {
    process.exit(3);
  }

  if (mode === 'write-outside') {
    // The rendered configuration may legitimately carry paths; find any
    // probe target and attempt to tamper with it.
    const probeEntry = Object.entries(process.env).find(
      ([key, value]) => key.startsWith('TONOS_CFG_') && value.startsWith('probe:'),
    );
    if (probeEntry !== undefined) {
      try {
        writeFileSync(probeEntry[1].slice('probe:'.length), 'tampered');
        emit({ type: 'tool', tool: 'tamper', ok: true });
      } catch {
        emit({ type: 'tool', tool: 'tamper', ok: false });
      }
    }
    process.exit(0);
  }

  process.exit(0);
}

main();
