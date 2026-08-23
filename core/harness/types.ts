import type { TrialDeclarationPayload } from '../records/trial.ts';

export interface EventLine {
  kind: string;
  fields: Record<string, unknown>;
}

export interface CanonicalToolEvent {
  tool: string;
  ok: boolean;
}

export interface EffectiveBehavior {
  modelReportedByHarness?: string | undefined;
  unknowns: string[];
}

export interface CanonicalTrialRecord {
  harnessId: string;
  harnessVersion: string;
  terminalState: 'passed' | 'failed' | 'invalid';
  toolEvents: CanonicalToolEvent[];
  effectiveBehavior: EffectiveBehavior;
  declaredUnknowns: string[];
}

export interface HarnessAdapter {
  readonly kind: string;
  /** Throws before any process spawns if settings are unsupported. */
  preflight(settings: Record<string, unknown>): void;
  /** Native configuration rendering — each adapter differs on purpose. */
  renderConfiguration(settings: Record<string, unknown>): string;
  /** Native event vocabulary → canonical lines. */
  parseLine(rawLine: string): EventLine | null;
  collectEffectiveBehavior(
    requested: { requestedModelAlias?: string },
    events: EventLine[],
  ): EffectiveBehavior;
  runCanonical(
    declaration: TrialDeclarationPayload,
    mode: string,
  ): Promise<CanonicalTrialRecord>;
  onBeforeSpawn?: undefined | (() => void);
}

export interface ContractResult {
  adapterKind: string;
  violations: string[];
}

export async function runSharedContract(
  factories: Array<() => HarnessAdapter>,
): Promise<ContractResult[]> {
  const results: ContractResult[] = [];
  for (const factory of factories) {
    const adapter = factory();
    const violations: string[] = [];

    // preflight must reject impossible configs without spawning
    let rejectedCleanly = false;
    try {
      adapter.preflight({ reasoningEffort: 'high', toolsEnabled: false });
    } catch {
      rejectedCleanly = true;
    }
    if (!rejectedCleanly) {
      violations.push('preflight accepted an impossible configuration');
    }

    // canonical record must be produced and well-formed
    const record = await adapter.runCanonical(
      fixtureDeclaration(),
      'tools',
    );
    if (record.terminalState !== 'passed') {
      violations.push(`expected passed, got ${record.terminalState}`);
    }
    if (record.toolEvents.length === 0) {
      violations.push('no canonical tool events were produced');
    }
    if (record.effectiveBehavior.modelReportedByHarness === undefined &&
        !record.declaredUnknowns.some((u) => u.length > 0)) {
      violations.push('neither effective behavior nor a declared unknown was recorded');
    }

    results.push({ adapterKind: adapter.kind, violations });
  }
  return results;
}

function fixtureDeclaration(): TrialDeclarationPayload {
  return {
    harness: {
      harnessId: 'fixture-harness',
      adapterKind: 'fixture',
      version: '1.0.0',
      adapterContractVersion: 1,
      capabilities: ['streaming'],
    },
    configuration: {
      requestedModelAlias: 'test-model',
      toolsEnabled: true,
      timeoutMs: 30_000,
      retryPolicy: { maxAttempts: 1, backoffMs: 0 },
      declaredUnknowns: [],
    },
    provider: {
      profileId: 'local-fixture-endpoint',
      protocolAdapterKind: 'fixture',
      endpointDisplay: 'http://127.0.0.1:1234/v1',
      servedModelAlias: 'test-model',
      capabilityObservations: ['streaming'],
      secretRefs: [],
      transportPolicy: { connectTimeoutMs: 1_000, requestTimeoutMs: 30_000 },
    },
    servedModel: {
      providerProfileId: 'local-fixture-endpoint',
      providerReportedId: 'test-model@fixture',
      capabilitiesObserved: [],
      observedAt: '1970-01-01T00:00:00.000Z',
      source: 'operator-declared',
    },
    taskSuite: {
      suiteId: 'fixture-suite',
      revision: '0.1.0',
      fixtureDigests: {},
      evaluatorIds: [],
      requiredCapabilities: [],
      retention: 'ephemeral',
      workspacePolicy: {
        allowedCommands: ['node --version'],
        networkAccess: false,
        maxFilesTouched: 10,
      },
      limits: { perTrialWallMs: 60_000, maxConcurrentTrials: 2 },
    },
    repetition: { index: 0, total: 1 },
    environmentClass: 'local-machine',
    limits: { wallMs: 60_000, cancelGraceMs: 100 },
  };
}
