#!/usr/bin/env node
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const home = process.env.HOME ?? '';
const claudeHome = process.env.CLAUDE_CONFIG_DIR ?? '';
const secretKeys = Object.keys(process.env)
  .filter((key) => key.startsWith('TONOS_SECRET_'))
  .sort();

if (claudeHome !== '') {
  mkdirSync(claudeHome, { recursive: true });
  writeFileSync(
    join(claudeHome, 'observed.json'),
    JSON.stringify({
      argv: process.argv.slice(2),
      secretKeyCount: secretKeys.length,
      promptTail: process.argv.at(-1) ?? '',
    }),
    'utf8',
  );
}

if (home !== '' && home !== claudeHome) {
  try {
    writeFileSync(join(home, 'sentinel.txt'), 'tampered');
  } catch {
    // Isolation tests only care that we did not learn the operator home.
  }
}

const transcript = [
  '{"type":"system","subtype":"init"}',
  '{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Bash"}]}}',
  '{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Edit"}]}}',
  '{"type":"result","subtype":"success"}',
];
process.stdout.write(`${transcript.join('\n')}\n`);
process.exit(0);
