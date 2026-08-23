import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { emitAllSchemas } from './lib/emit-schemas.ts';

const schemasDir = fileURLToPath(new URL('../schemas/', import.meta.url));
mkdirSync(schemasDir, { recursive: true });

for (const [kind, json] of emitAllSchemas()) {
  const target = `${schemasDir}${kind}.schema.json`;
  writeFileSync(target, json, 'utf8');
  console.log(`wrote schemas/${kind}.schema.json`);
}
