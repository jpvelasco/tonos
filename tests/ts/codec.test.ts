import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  canonicalJson,
  sha256Hex,
  contentId,
} from '../../core/canonical.ts';
import {
  encode,
  decode,
  CURRENT_SCHEMA_VERSION,
  type RecordKind,
} from '../../core/codec.ts';
import {
  fixtureHarnessIdentity,
  fixtureHarnessConfiguration,
  fixtureProviderProfile,
  fixtureServedModelObservation,
  fixtureTaskSuite,
  fixtureTrialDeclaration,
  fixtureTrialResult,
  fixtureTrialMatrix,
  fixtureQualificationDecision,
  RECORD_FIXTURES,
} from '../fixtures/records.ts';

const TERMINAL_STATES = [
  'passed',
  'failed',
  'timed-out',
  'cancelled',
  'unsupported',
  'invalid',
] as const;

test('canonicalJson sorts keys recursively so identical payloads serialize identically', () => {
  const a = canonicalJson({ b: 1, a: { d: 2, c: [3, { z: 1, y: 2 }] } });
  const b = canonicalJson({ a: { c: [3, { y: 2, z: 1 }], d: 2 }, b: 1 });
  assert.equal(a, b);
  assert.equal(a, '{"a":{"c":[3,{"y":2,"z":1}],"d":2},"b":1}');
});

test('contentId is prefixed sha256 of canonical bytes', () => {
  const id = contentId('trn_trial_', { x: 1 });
  assert.match(id, /^trn_trial_[0-9a-f]{64}$/);
  assert.equal(id, contentId('trn_trial_', { x: 1 }));
  assert.notEqual(id, contentId('trn_trial_', { x: 2 }));
});

test(`every record kind round-trips byte-deterministically at schema version ${CURRENT_SCHEMA_VERSION}`, () => {
  for (const kind of Object.keys(RECORD_FIXTURES) as RecordKind[]) {
    const record = RECORD_FIXTURES[kind]();
    const first = encode(kind, record);
    const second = encode(kind, record);
    assert.equal(first, second, `${kind} encoding must be deterministic`);
    const decoded = decode(kind, first);
    assert.deepEqual(decoded, record, `${kind} must survive a round-trip`);
  }
});

test('decode rejects foreign schema versions closed', () => {
  const encoded = JSON.parse(
    encode('harnessIdentity', fixtureHarnessIdentity()),
  ) as Record<string, unknown>;
  const future = JSON.stringify({
    ...encoded,
    schema_version: CURRENT_SCHEMA_VERSION + 42,
  });
  assert.throws(
    () => decode('harnessIdentity', future),
    /schema_version 43 is not supported .* expected 1\. .*explicit/u,
  );
  const ancient = JSON.stringify({
    ...encoded,
    schema_version: CURRENT_SCHEMA_VERSION - 1,
  });
  assert.throws(
    () => decode('harnessIdentity', ancient),
    /schema_version 0 is not supported/u,
  );
});

test('decode rejects mismatched kinds', () => {
  const encoded = encode('taskSuite', fixtureTaskSuite());
  assert.throws(
    () => decode('providerProfile', encoded),
    /kind mismatch: document says taskSuite, decoder expects providerProfile/u,
  );
});

test('terminal states are exactly the six honest outcomes', async () => {
  const { terminalStates } = await import('../../core/records/trial.ts');
  assert.deepEqual([...terminalStates], TERMINAL_STATES);
});
