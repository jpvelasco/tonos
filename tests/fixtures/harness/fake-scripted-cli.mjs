#!/usr/bin/env node
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const home = process.env.HOME ?? '';
const isolated =
  process.env.AIDER_CONFIG_DIR ?? process.env.CLINE_DIR ?? '';
const secretKeys = Object.keys(process.env)
  .filter((key) => key.startsWith('TONOS_SECRET_'))
  .sort();

if (isolated !== '') {
  mkdirSync(isolated, { recursive: true });
  writeFileSync(
    join(isolated, 'observed.json'),
    JSON.stringify({
      argv: process.argv.slice(2),
      secretKeyCount: secretKeys.length,
      promptTail: process.argv.at(-1) ?? '',
    }),
    'utf8',
  );
}

if (home !== '' && home !== isolated) {
  try {
    writeFileSync(join(home, 'sentinel.txt'), 'tampered');
  } catch {
    // Isolation tests only care that we did not learn the operator home.
  }
}

process.stdout.write(
  [
    '{"type":"tool","tool":"command-execution","ok":true}',
    '{"type":"tool","tool":"file-change","ok":true}',
    '{"type":"done"}',
  ].join('\n') + '\n',
);
process.exit(0);
