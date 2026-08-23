import type { ContractResult, HarnessAdapter } from './types.ts';

/**
 * The one harness contract. Every adapter — fixture or real — must pass this
 * suite. Adapter-specific tests cover only genuinely native behavior.
 */
export async function runSharedContract(
  factories: Array<() => HarnessAdapter>,
): Promise<ContractResult[]> {
  const results: ContractResult[] = [];
  for (const factory of factories) {
    const adapter = factory();
    const violations: string[] = [];

    let rejectedCleanly = false;
    try {
      adapter.preflight({ reasoningEffort: 'high', toolsEnabled: false });
    } catch {
      rejectedCleanly = true;
    }
    if (!rejectedCleanly) {
      violations.push('preflight accepted an impossible configuration');
    }

    const rendered = adapter.renderConfiguration({
      requestedModelAlias: 'test-model',
      toolsEnabled: true,
    });
    if (rendered.trim() === '') {
      violations.push('renderConfiguration produced an empty document');
    }

    // unparseable lines are skipped, never fatal
    const ghost = adapter.parseLine('this is not a structured line');
    if (ghost !== null) {
      violations.push('parseLine returned a record for garbage input');
    }

    const record = await adapter.runCanonical(fixtureDeclaration(), 'tools');
    if (record.terminalState !== 'passed') {
      violations.push(`expected passed, got ${record.terminalState}`);
    }
    if (record.toolEvents.length === 0) {
      violations.push('no canonical tool events were produced');
    }
    if (
      record.effectiveBehavior.modelReportedByHarness === undefined &&
      !record.declaredUnknowns.some((u) => u.length > 0)
    ) {
      violations.push(
        'neither effective behavior nor a declared unknown was recorded',
      );
    }

    results.push({ adapterKind: adapter.kind, violations });
  }
  return results;
}

function fixtureDeclaration() {
  return {
    harness: {
      harnessId: 'fixture-harness',
      adapterKind: 'fixture' as const,
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
      protocolAdapterKind: 'fixture' as const,
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
      source: 'operator-declared' as const,
    },
    taskSuite: {
      suiteId: 'fixture-suite',
      revision: '0.1.0',
      fixtureDigests: {},
      evaluatorIds: [],
      requiredCapabilities: [],
      retention: 'ephemeral' as const,
      workspacePolicy: {
        allowedCommands: ['node --version'],
        networkAccess: false,
        maxFilesTouched: 10,
      },
      limits: { perTrialWallMs: 60_000, maxConcurrentTrials: 2 },
    },
    repetition: { index: 0, total: 1 },
    environmentClass: 'local-machine' as const,
    limits: { wallMs: 60_000, cancelGraceMs: 100 },
  };
}
