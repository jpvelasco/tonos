import { z } from 'zod';
import { canonicalJson } from './canonical.ts';
import { HarnessConfiguration, HarnessIdentity } from './records/harness.ts';
import {
  ProviderProfile,
  ServedModelObservation,
} from './records/provider.ts';
import { TaskSuite } from './records/task.ts';
import {
  TrialDeclarationPayload,
  TrialResult,
  trialIdOf,
} from './records/trial.ts';
import { QualificationDecision, TrialMatrix } from './records/matrix.ts';

export const CURRENT_SCHEMA_VERSION = 1;

export const RECORD_KINDS = [
  'harnessIdentity',
  'harnessConfiguration',
  'providerProfile',
  'servedModelObservation',
  'taskSuite',
  'trialDeclaration',
  'trialResult',
  'trialMatrix',
  'qualificationDecision',
] as const;
export type RecordKind = (typeof RECORD_KINDS)[number];

export class CodecError extends Error {}

const TrialDeclarationDocument = TrialDeclarationPayload.extend({
  trialId: z.string().regex(/^trn_trial_[0-9a-f]{64}$/u),
}).refine(
  (document) => document.trialId === trialIdOf(document),
  {
    message:
      'embedded trialId does not match the declaration content; declarations are tamper-evident and cannot be reidentified manually',
  },
);

type AnySchema = z.ZodType<{ [key: string]: unknown }, unknown>;

const DOCUMENT_SCHEMAS: Record<RecordKind, AnySchema> = {
  harnessIdentity: HarnessIdentity as unknown as AnySchema,
  harnessConfiguration: HarnessConfiguration as unknown as AnySchema,
  providerProfile: ProviderProfile as unknown as AnySchema,
  servedModelObservation: ServedModelObservation as unknown as AnySchema,
  taskSuite: TaskSuite as unknown as AnySchema,
  trialDeclaration: TrialDeclarationDocument as unknown as AnySchema,
  trialResult: TrialResult as unknown as AnySchema,
  trialMatrix: TrialMatrix as unknown as AnySchema,
  qualificationDecision: QualificationDecision as unknown as AnySchema,
};

export function encode<T extends object>(kind: RecordKind, record: T): string {
  const parsed = DOCUMENT_SCHEMAS[kind].parse(record) as object;
  return canonicalJson({
    schema_version: CURRENT_SCHEMA_VERSION,
    kind,
    ...(parsed as Record<string, unknown>),
  });
}

export function decode<S>(kind: RecordKind, raw: string | object): S {
  let doc: Record<string, unknown>;
  if (typeof raw === 'string') {
    try {
      doc = JSON.parse(raw) as Record<string, unknown>;
    } catch (cause) {
      throw new CodecError(`document is not valid JSON: ${String(cause)}`);
    }
  } else {
    doc = raw as Record<string, unknown>;
  }

  const version = doc['schema_version'];
  if (version !== CURRENT_SCHEMA_VERSION) {
    throw new CodecError(
      `schema_version ${String(version)} is not supported by this codec; expected ${CURRENT_SCHEMA_VERSION}. ` +
        `Migrations must be explicit: register a migration before reading documents from another era.`,
    );
  }
  const documentKind = doc['kind'];
  if (documentKind !== kind) {
    throw new CodecError(
      `kind mismatch: document says ${String(documentKind)}, decoder expects ${kind}`,
    );
  }

  const body: Record<string, unknown> = { ...doc };
  delete body['schema_version'];
  delete body['kind'];

  return DOCUMENT_SCHEMAS[kind].parse(body) as S;
}
