import { z } from 'zod';
import { HarnessConfiguration, HarnessIdentity } from '../../core/records/harness.ts';
import {
  ProviderProfile,
  ServedModelObservation,
} from '../../core/records/provider.ts';
import { TaskSuite } from '../../core/records/task.ts';
import {
  TrialResult,
} from '../../core/records/trial.ts';
import {
  QualificationDecision,
  TrialMatrix,
} from '../../core/records/matrix.ts';

const SCHEMAS: Record<string, z.ZodType> = {
  harnessIdentity: HarnessIdentity,
  harnessConfiguration: HarnessConfiguration,
  providerProfile: ProviderProfile,
  servedModelObservation: ServedModelObservation,
  taskSuite: TaskSuite,
  trialResult: TrialResult,
  trialMatrix: TrialMatrix,
  qualificationDecision: QualificationDecision,
};

const DECLARATION_DOCUMENT = z.object({
  schema_version: z.literal(1),
  kind: z.literal('trialDeclaration'),
});

export function emitAllSchemas(): Map<string, string> {
  const emitted = new Map<string, string>();
  for (const [kind, schema] of Object.entries(SCHEMAS)) {
    const jsonSchema = JSON.stringify(
      z.toJSONSchema(schema, { io: 'input', unrepresentable: 'throw' }),
      null,
      2,
    );
    emitted.set(kind, `${jsonSchema}\n`);
  }
  emitted.set('trialDeclarationEnvelope', `${JSON.stringify(
    z.toJSONSchema(DECLARATION_DOCUMENT, { io: 'input' }),
    null,
    2,
  )}\n`);
  return emitted;
}
