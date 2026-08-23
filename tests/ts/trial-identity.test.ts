import { test } from 'node:test';
import assert from 'node:assert/strict';

import { trialIdOf } from '../../core/records/trial.ts';
import { encode } from '../../core/codec.ts';
import {
  fixtureTrialDeclaration,
  fixtureProviderProfile,
} from '../fixtures/records.ts';
import { deepMutate } from '../fixtures/mutate.ts';

test('trial id is content-derived and stable across identical declarations', () => {
  const a = fixtureTrialDeclaration();
  const b = fixtureTrialDeclaration();
  assert.equal(trialIdOf(a), trialIdOf(b));
  assert.match(trialIdOf(a), /^trn_trial_[0-9a-f]{64}$/u);
});

const IDENTITY_INPUTS: Array<[string, (d: object) => object]> = [
  ['harness identity', (d) => deepMutate(d, ['harness', 'version'], '9.9.9')],
  [
    'harness configuration',
    (d) => deepMutate(d, ['configuration', 'requestedModelAlias'], 'other-model'),
  ],
  ['provider profile', (d) => deepMutate(d, ['provider', 'profileId'], 'other-provider')],
  [
    'served model observation',
    (d) => deepMutate(d, ['servedModel', 'providerReportedId'], 'other-served-id'),
  ],
  ['task suite revision', (d) => deepMutate(d, ['taskSuite', 'revision'], '0.0.2')],
  ['repetition count', (d) => deepMutate(d, ['repetition', 'index'], 7)],
];

for (const [label, mutate] of IDENTITY_INPUTS) {
  test(`changing ${label} changes the content-derived trial id`, () => {
    const base = fixtureTrialDeclaration();
    const changed = mutate(base) as ReturnType<typeof fixtureTrialDeclaration>;
    assert.notEqual(
      trialIdOf(base),
      trialIdOf(changed),
      `${label} is part of the trial identity`,
    );
  });
}

test('timestamps and correlation metadata never masquerade as identity inputs', () => {
  const base = fixtureTrialDeclaration();
  const shifted = {
    ...base,
    declaredAt: '2085-01-01T00:00:00.000Z' as const,
    correlationValue: 'someone-elses-run',
  };
  assert.equal(trialIdOf(base), trialIdOf(shifted));
});

test('a provider profile carrying engine lifecycle fields is rejected outright', () => {
  const hostile = fixtureProviderProfile() as unknown as Record<
    string,
    unknown
  >;
  hostile['engineLaunchFlags'] = '--n-gpu-layers 99';
  assert.throws(
    () => encode('providerProfile', hostile),
    /unrecognized key[\s\S]*engineLaunchFlags/iu,
  );
});

