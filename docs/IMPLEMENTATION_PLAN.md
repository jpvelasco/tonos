# Tonos Provider-Agnostic Implementation Plan

Status: Active future implementation handoff; documentation work only is
authorized as of 2026-08-22

Audited predecessor source: `906145182cb93b21d7cce28fbd28a32d12813dde`

## 1. Objective

Refactor Tonos from a bench-rig/LM Studio model-and-engine tuner into the
provider-agnostic harness qualification product defined by
[`PRODUCT_SPECIFICATION.md`](PRODUCT_SPECIFICATION.md), without losing the
useful historical benchmark evidence or its strongest measurement techniques.

This plan does not authorize live provider access, changes to user harness
configuration, engine lifecycle operations, or Morpheus implementation.

## 2. Delivery Rules

For every milestone:

1. Write the failing contract or acceptance test first.
2. Keep canonical domain logic independent of harness, provider, process, and
   filesystem libraries.
3. Exercise the real public boundary named by the milestone; mocked records
   alone do not complete a harness or provider adapter.
4. Use disposable workspaces and configuration roots in all normal lanes.
5. Preserve errors, timeouts, incomplete results, and missing provenance.
6. Run legacy checks when existing PowerShell/Node scripts change.
7. Update this plan, the specification, architecture, and README together when
   a boundary changes.

One integration owner must own T1 through T3. Do not parallelize named harness
adapters before the domain records, runner, and fake adapters are fixed.

## 3. Milestones

### T0 — Characterize and Bound the Predecessor

Entry: clean `main` at the audited source.

Tests and evidence:

- fixture-test the schema-v3 document shape produced by `benchmark.ps1`;
- characterize requested/effective config rejection, cold/reuse/append timing,
  visible/reasoning separation, partial-result persistence, quality fixture,
  and VRAM snapshot behavior;
- prove which commands load/unload models or otherwise mutate LM Studio;
- capture sanitized golden schema-v3 fixtures with no prompts, responses,
  reasoning, endpoint secrets, or private paths.

Implementation/documentation:

- label engine-control scripts as legacy explicit machine-lab operations;
- separate reusable measurement/evaluation behaviors from provider-specific
  loading and GPU tuning in the test inventory;
- record every current schema-v3 provenance limitation.

Exit: future refactors can prove they preserved useful measurement semantics
without treating LM Studio lifecycle behavior as a target requirement.

### T1 — Freeze Canonical Identities and Schemas

Entry: T0 characterization green.

First failing tests:

- deterministic codecs round-trip every record in the architecture;
- secret values and unbounded/free-form command fields are rejected;
- changing harness, configuration, provider, model observation, suite, fixture,
  evaluator, or repetition changes the content-derived trial identity;
- timestamps and optional correlation metadata do not masquerade as stable
  harness/provider/model identities;
- future schema versions fail closed and migrations are explicit.

Implementation:

- define `HarnessIdentity`, `HarnessConfiguration`, `ProviderProfile`,
  `ServedModelObservation`, `TaskSuite`, `TrialDeclaration`, `TrialResult`,
  `TrialMatrix`, and `QualificationDecision`;
- publish JSON Schemas and sanitized golden documents;
- define terminal states for passed, failed, timed-out, cancelled, unsupported,
  and invalid trials.

Exit: exactly one canonical identity/result family exists and contains no
process handles, adapter instances, provider internals, or secrets.

### T2 — Build the Isolated Trial Runner

Entry: T1 records fixed.

First failing acceptance tests:

- a fixture harness runs in a disposable config root and workspace while
  canaries in the user's simulated home and source repository remain unchanged;
- timeout, cancellation, parser failure, and runner crash leave no child or
  grandchild process and no undeclared files;
- credential canaries reach only the intended child environment and never
  appear in command lines, records, logs, or exports;
- incomplete trials persist an honest terminal result and cleanup evidence.

Implementation:

- add typed process, workspace, configuration, clock, secret, and evidence
  ports;
- use POSIX process groups and Windows Job Objects through platform adapters;
- capture bounded structured stdout/stderr/events and phase timings;
- compute before/after workspace digests and structured diff summaries.

Exit: the fake harness acceptance lane is safe, durable, cancellable, and
cross-platform without contacting a provider.

### T3 — Add Provider-Neutral Request Adapters

Entry: T2 runner green.

First failing tests:

- an OpenAI-compatible fixture and a materially different provider fixture map
  capability, streaming, usage, error, cancellation, and timeout behavior into
  attributed canonical observations;
- profiles containing lifecycle commands, engine flags, or embedded secret
  values are rejected;
- the same provider may be local, LAN, or remote without changing ownership;
- provider-reported timing remains separate from Tonos client timing.

Implementation:

- implement protocol adapters, beginning with OpenAI-compatible behavior;
- add normalized provider/model capability observations and explicit unknowns;
- keep LM Studio as an ordinary profile; do not call its model-management APIs.

Exit: Tonos can exercise a served endpoint without knowing or changing its
engine, hardware, model files, or process lifecycle.

### T4 — Freeze the Harness Adapter Contract

Entry: T2 and T3 green.

First failing tests:

- two fake harnesses with different native configuration and event formats
  produce equivalent canonical trial records;
- requested versus effective harness behavior is recorded or declared unknown;
- unsupported configuration fails before trial execution;
- adapter cancellation and cleanup use only the T2 runner boundary.

Implementation:

- define discovery/version, configuration rendering, invocation, event parsing,
  effective behavior, cancellation, and cleanup methods;
- implement one simple executable fixture adapter before named real harnesses;
- add named harness adapters one at a time with isolated acceptance fixtures.

Exit: at least two materially different real harnesses pass the shared contract
without editing active user configuration.

### T5 — Version Task Suites and Objective Evaluators

Entry: T4 first real harness lane green.

First failing tests:

- executable correctness detects semantically wrong but compilable output;
- structured tool traces detect wrong tool, arguments, order, retry, and missing
  verification;
- workspace assertions detect unintended edits and repository corruption;
- rubric-only outcomes remain visibly subjective;
- content-retention canaries prove ephemeral content is removed and exports are
  sanitized.

Implementation:

- migrate the Go retry fixture into a versioned public task suite;
- add debugging, repository edit, tool-use, architecture/review, and recovery
  tasks with bounded evaluators;
- record suite/evaluator/fixture digests and allowed command/network policy.

Exit: task success is more than model text or throughput and is reproducible
from committed non-sensitive fixtures.

### T6 — Matrices, Comparison, and Qualification

Entry: T4 and T5 green.

First failing tests:

- direct comparisons require compatible identities and effective behavior;
- multi-axis changes are not attributed to one variable;
- repeated trials report sample counts, dispersion, failures, and uncertainty;
- a fast trial that fails a required task cannot win;
- qualification may return no winner.

Implementation:

- add matrix preview, bounded concurrency, checkpointing, resumption, and
  cancellation;
- add versioned qualification policies and comparison explanations;
- provide human-readable table plus machine-readable JSON/JSONL export.

Exit: Tonos can qualify harness/configuration/provider/model tuples without a
universal leaderboard claim.

### T7 — Optional Independent Evidence Interoperability

Entry: standalone T1 through T6 complete. This milestone is optional and must
not block Tonos qualification.

First failing contract tests:

- sanitized bundles validate without Morpheus installed or reachable;
- missing optional correlation values do not alter behavior;
- correlation values are bounded, opaque, untrusted, and rejected as identity
  or authorization inputs;
- a golden bundle can be imported by a separately implemented consumer while
  preserving limitations and source digest;
- secret/content canaries are absent.

Implementation:

- publish a generic harness-qualification export schema;
- support optional operator-supplied external deployment/evidence references
  and correlation metadata;
- maintain static golden fixtures rather than a source/package dependency.

Exit: Tonos remains fully standalone and an operator can manually associate its
sanitized client evidence with independently collected server evidence.

### T8 — Retire Engine Control from the Primary Path

Entry: T3 through T6 replace the useful predecessor path and legacy evidence is
preserved.

Implementation:

- move LM Studio load/unload, engine tuning, NVIDIA telemetry, and model matrix
  scripts under a clearly named legacy/archive boundary or a separate historical
  branch;
- keep schema-v3 import/reading support and historical decision records;
- remove provider-lifecycle dependencies from ordinary setup and documentation;
- do not delete evidence or rewrite old conclusions.

Exit: installing and using Tonos requires no LM Studio, `lms`, `nvidia-smi`,
Node loader, GPU, Morpheus, or engine-control privilege unless the operator
deliberately invokes the archived legacy lane.

## 4. Validation Matrix

| Boundary | Minimum gate |
|---|---|
| T0 predecessor | PowerShell syntax + legacy unit tests + schema-v3 goldens |
| T1 domain | unit + codec/schema + migration + canary tests |
| T2 runner | unit + platform contract + disposable process acceptance |
| T3 providers | protocol contract + fixture integration + cancellation |
| T4 harnesses | adapter contract + isolated real-harness acceptance |
| T5 tasks | evaluator unit + adversarial fixture + content/privacy tests |
| T6 matrices | comparison/qualification unit + restart/cancel integration |
| T7 exchange | standalone schema + cross-repo golden + redaction checks |
| T8 closure | clean standalone install/gate with legacy lane excluded |

Live tests must declare the provider endpoint, harness binary, disposable
workspace, configuration root, secret references, network policy, and allowed
external mutations. The default live-provider authority is request-only.

## 5. Completion Standard

The refactor is complete when Tonos independently compares multiple harnesses
and providers through the same records and safety boundaries; ordinary use
cannot change provider engines or active user configuration; objective task and
end-to-end evidence drives bounded qualification; results remain reproducible,
privacy-safe, and honest about comparability; and optional external evidence
correlation remains a removable leaf feature.
