import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { emitAllSchemas } from '../../scripts/lib/emit-schemas.ts';

test('published JSON Schemas match the runtime zod definitions exactly', async () => {
  const emitted = emitAllSchemas();
  for (const [kind, json] of emitted) {
    const path = fileURLToPath(
      new URL(`../../schemas/${kind}.schema.json`, import.meta.url),
    );
    const committed = (await readFile(path, 'utf8')).replace(/\r\n/gu, '\n');
    assert.ok(
      committed !== undefined,
      `schemas/${kind}.schema.json must be committed; run npm run emit-schemas`,
    );
    assert.equal(committed.trim(), json.trim(), `${kind} schema drifted`);
  }
});

test('committed golden fixtures are sanitized', async () => {
  const goldens = [
    'harnessIdentity',
    'harnessConfiguration',
    'providerProfile',
    'servedModelObservation',
    'taskSuite',
    'trialDeclaration',
    'trialResult',
    'trialMatrix',
    'qualificationDecision',
  ];
  for (const kind of goldens) {
    const path = fileURLToPath(
      new URL(`../../tests/fixtures/goldens/${kind}.golden.json`, import.meta.url),
    );
    const raw = await readFile(path, 'utf8');
    for (const canary of ['sk-', 'ghp_', 'C:\\Users\\', '192.168.', 'password']) {
      assert.ok(
        !raw.includes(canary),
        `${kind} golden contains canary ${canary}`,
      );
    }
  }
});

test('every record round-trips through its committed golden document', async () => {
  const { decode, encode, RECORD_KINDS } = await import('../../core/codec.ts');
  for (const kind of RECORD_KINDS) {
    const path = fileURLToPath(
      new URL(`../../tests/fixtures/goldens/${kind}.golden.json`, import.meta.url),
    );
    const raw = (await readFile(path, 'utf8')).replace(/\r\n/gu, '\n');
    const decoded = decode<object>(kind, raw);
    assert.equal(encode(kind, decoded), raw.trim());
  }
});
