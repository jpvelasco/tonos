import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { encode, RECORD_KINDS } from '../core/codec.ts';
import { RECORD_FIXTURES } from '../tests/fixtures/records.ts';

const goldensDir = fileURLToPath(
  new URL('../tests/fixtures/goldens/', import.meta.url),
);
mkdirSync(goldensDir, { recursive: true });

for (const kind of RECORD_KINDS) {
  const build = RECORD_FIXTURES[kind];
  if (build === undefined) {
    throw new Error(`no fixture registered for ${kind}`);
  }
  const golden = encode(kind, build());
  writeFileSync(`${goldensDir}${kind}.golden.json`, `${golden}\n`, 'utf8');
  console.log(`wrote tests/fixtures/goldens/${kind}.golden.json`);
}
