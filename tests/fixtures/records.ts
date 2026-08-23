import { trialIdOf } from '../../core/records/trial.ts';
import type { RecordKind } from '../../core/codec.ts';
import type { HarnessConfiguration, HarnessIdentity } from '../../core/records/harness.ts';
import type {
  ProviderProfile,
  ServedModelObservation,
} from '../../core/records/provider.ts';
import type { TaskSuite } from '../../core/records/task.ts';
import type {
  QualificationDecision,
  TrialMatrix,
} from '../../core/records/matrix.ts';
import type {
  TrialDeclarationPayload,
  TrialResult,
} from '../../core/records/trial.ts';



export function fixtureHarnessIdentity(): HarnessIdentity {
  return {
    harnessId: 'fixture-harness',
    adapterKind: 'fixture',
    version: '1.4.2',
    adapterContractVersion: 1,
    capabilities: ['streaming', 'tools'],
  };
}

export function fixtureHarnessConfiguration(): HarnessConfiguration {
  return {
    requestedModelAlias: 'test-model',
    reasoningEffort: 'none',
    toolsEnabled: true,
    contextLengthTokens: 65_536,
    maxOutputTokens: 2_048,
    timeoutMs: 300_000,
    retryPolicy: { maxAttempts: 2, backoffMs: 500 },
    declaredUnknowns: [],
  };
}

export function fixtureProviderProfile(): ProviderProfile {
  return {
    profileId: 'local-fixture-endpoint',
    protocolAdapterKind: 'fixture',
    endpointDisplay: 'http://127.0.0.1:1234/v1',
    servedModelAlias: 'test-model',
    capabilityObservations: ['streaming', 'usage-reporting'],
    secretRefs: ['credman:fixture-key-ref'],
    transportPolicy: { connectTimeoutMs: 2_000, requestTimeoutMs: 300_000 },
  };
}

export function fixtureServedModelObservation(): ServedModelObservation {
  return {
    providerProfileId: 'local-fixture-endpoint',
    providerReportedId: 'test-model@2026-08-01',
    contextWindowTokens: 131_072,
    capabilitiesObserved: ['streaming'],
    observedAt: '1970-01-01T00:00:00.000Z',
    source: 'provider-api',
  };
}

export function fixtureTaskSuite(): TaskSuite {
  return {
    suiteId: 'fixture-suite',
    revision: '0.1.0',
    fixtureDigests: {
      'tasks/retry/go.mod': 'a'.repeat(64),
      'tasks/retry/retry_test.go': 'b'.repeat(64),
    },
    evaluatorIds: ['executable-tests', 'tool-trace'],
    requiredCapabilities: ['tools', 'streaming'],
    retention: 'public_fixture',
    workspacePolicy: {
      allowedCommands: ['go test ./...', 'node --version'],
      networkAccess: false,
      maxFilesTouched: 50,
    },
    limits: { perTrialWallMs: 600_000, maxConcurrentTrials: 4 },
  };
}

export function fixtureTrialDeclaration(): TrialDeclarationPayload & {
  trialId: string;
} {
  const payload: TrialDeclarationPayload = {
    harness: fixtureHarnessIdentity(),
    configuration: fixtureHarnessConfiguration(),
    provider: fixtureProviderProfile(),
    servedModel: fixtureServedModelObservation(),
    taskSuite: fixtureTaskSuite(),
    repetition: { index: 0, total: 3 },
    environmentClass: 'local-machine',
    limits: { wallMs: 600_000, cancelGraceMs: 1_000 },
    randomizationSeed: '0123456789abcdef',
    declaredAt: '1970-01-01T00:00:00.000Z',
  };
  return { ...payload, trialId: trialIdOf(payload) };
}

export function fixtureTrialResult(): TrialResult {
  return {
    declarationId: fixtureTrialDeclaration().trialId,
    observedHarnessVersion: '1.4.2',
    observedProviderProfileId: 'local-fixture-endpoint',
    observedServedModelId: 'test-model@2026-08-01',
    terminalState: 'passed',
    startedAt: '1970-01-01T00:00:00.000Z',
    finishedAt: '1970-01-01T00:01:30.000Z',
    phaseDurationsMs: { setup: 120, invoke: 89_000, evaluate: 400 },
    clientTiming: { totalWallMs: 90_100, ttftMs: 340 },
    attributedProviderTiming: {
      sourceTag: 'provider-reported',
      ttftSeconds: 0.29,
      tokensPerSecond: 42.5,
    },
    toolEvents: [
      { seq: 0, toolName: 'read-file', ok: true },
      { seq: 1, toolName: 'apply-diff', ok: true },
    ],
    workspaceAfterDigest: 'c'.repeat(64),
    diffSummary: { filesChanged: 2, insertions: 14, deletions: 3 },
    evaluatorOutcomes: [
      { evaluatorId: 'executable-tests', passed: true, subjective: false },
      { evaluatorId: 'tool-trace', passed: true, subjective: false },
    ],
    verificationExit: 0,
    errors: [],
    missingEvidence: [],
    redactionReport: { removedCategories: ['prompt-content'] },
    artifactDigests: { 'diff.patch': 'd'.repeat(64) },
  };
}

export function fixtureTrialMatrix(): TrialMatrix {
  const declaration = fixtureTrialDeclaration();
  const { trialId: _stripped, ...payloadOnly } = declaration;
  return {
    matrixId: 'fixture-matrix',
    policyRevision: '0.1.0',
    axes: [
      { axis: 'harness', variants: 2 },
      { axis: 'served-model', variants: 1 },
    ],
    declarations: [payloadOnly],
    createdAt: '1970-01-01T00:00:00.000Z',
  };
}

export function fixtureQualificationDecision(): QualificationDecision {
  return {
    matrixId: 'fixture-matrix',
    policyRevision: '0.1.0',
    gates: [
      { gateId: 'correctness-floor', passed: true },
      { gateId: 'headroom', passed: true },
    ],
    comparableTrialCount: 6,
    exclusions: [],
    winnerDeclarationId: fixtureTrialDeclaration().trialId,
    tradeoffsAndLimitations:
      'Winner leads on task success and p50 wall time; single machine, three repetitions.',
    decidedAt: '1970-01-01T00:05:00.000Z',
  };
}

export const RECORD_FIXTURES: Record<RecordKind, () => object> = {
  harnessIdentity: fixtureHarnessIdentity,
  harnessConfiguration: fixtureHarnessConfiguration,
  providerProfile: fixtureProviderProfile,
  servedModelObservation: fixtureServedModelObservation,
  taskSuite: fixtureTaskSuite,
  trialDeclaration: fixtureTrialDeclaration,
  trialResult: fixtureTrialResult,
  trialMatrix: fixtureTrialMatrix,
  qualificationDecision: fixtureQualificationDecision,
};



