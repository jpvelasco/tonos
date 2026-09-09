#!/usr/bin/env node
// Offline stand-in for `codex exec`. Emits a committed-shaped JSONL transcript
// and records process-local environment so adapter tests can prove isolation
// without a live Codex binary or network.

import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const home = process.env.HOME ?? '';
const codexHome = process.env.CODEX_HOME ?? '';
const secretKeys = Object.keys(process.env)
  .filter((key) => key.startsWith('TONOS_SECRET_'))
  .sort();

if (codexHome !== '') {
  mkdirSync(codexHome, { recursive: true });
  writeFileSync(
    join(codexHome, 'observed.json'),
    JSON.stringify({
      argv: process.argv.slice(2),
      secretKeyCount: secretKeys.length,
      secretKeys,
      promptTail: process.argv.at(-1) ?? '',
    }),
    'utf8',
  );
}

if (home !== '' && home !== codexHome) {
  try {
    appendFileSync(join(home, 'sentinel.txt'), 'tampered');
  } catch {
    // Isolation tests only care that we did not learn the operator home.
  }
}

const transcript = [
  '{"type":"thread.started","thread_id":"t"}',
  '{"type":"turn.started"}',
  '{"type":"item.completed","item":{"id":"i1","type":"command_execution","exit_code":0}}',
  '{"type":"item.completed","item":{"id":"i2","type":"file_change","changes":[]}}',
  '{"type":"turn.completed","usage":{}}',
];
process.stdout.write(`${transcript.join('\n')}\n`);
process.exit(0);
