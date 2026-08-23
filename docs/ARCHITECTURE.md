# Tonos Architecture

Status: Accepted target architecture; current PowerShell toolkit requires
refactoring

Architecture date: 2026-08-22

## 1. Architectural Objective

Tonos is a ports-and-adapters harness qualification system. Pure domain logic
defines immutable trials, task/evaluator contracts, comparison policy, and
qualification decisions. Adapters isolate harness processes, provider
protocols, workspaces, configuration roots, secrets, clocks, and storage.

The architecture deliberately places the inference engine outside Tonos:

```text
trial matrix
  = harness identity + harness configuration
  + provider profile + served-model observation
  + task suite + limits + repetitions
        |
        v
isolated harness runner -> external provider endpoint -> served deployment
        |
        v
structured trace + workspace diff + evaluator outcomes + client timing
        |
        v
immutable trial result -> comparison -> bounded qualification
```

The provider endpoint may be on the same machine, elsewhere on a LAN, or
remote. Its topology does not change Tonos ownership.

## 2. Ownership Boundaries

### 2.1 Tonos-Owned

- trial declarations, matrices, task suites, evaluator policy, and results;
- temporary harness configuration roots and disposable workspaces;
- child harness processes started for a trial;
- generated sanitized exports and local allowed evidence artifacts;
- provider and harness adapter code in this repository.

### 2.2 Externally Owned

- provider endpoints, inference engines, model artifacts, GPU resources, and
  service processes;
- installed harness binaries and their normal user configuration;
- source repositories supplied as task inputs;
- user credentials and credential stores;
- Morpheus or any other inference-management product.

An external resource never becomes Tonos-owned through reachability, a matching
name, a model alias, an optional correlation value, or a successful trial.

## 3. Canonical Domain Records

All records are immutable, schema-versioned, and serializable without adapter
objects or secret values.

### HarnessIdentity

- harness ID and adapter kind;
- executable/source identity and version;
- adapter contract version;
- observed capabilities.

### HarnessConfiguration

- requested model/provider alias;
- bounded reasoning, tool, context/output, timeout, retry, and prompt settings;
- plugin/MCP/tool-set identity without secret configuration;
- configuration template digest;
- observed effective behavior and declared unknowns.

### ProviderProfile

- profile ID and protocol adapter kind;
- normalized endpoint identity suitable for display/export;
- served-model alias and capability observations;
- secret references, never secret values;
- transport policy and timeout bounds;
- no engine launch or lifecycle fields.

### TaskSuite

- suite ID/revision and fixture digests;
- task declarations and randomization policy;
- required tools/provider capabilities;
- evaluator IDs/revisions;
- workspace, command, time, resource, network, and content-retention policy.

### TrialDeclaration

- content-derived trial ID;
- exact identities above;
- repetition and seed;
- environment classification;
- cancellation/timeout/resource limits;
- optional opaque correlation value;
- expected comparison dimensions.

### TrialResult

- declaration ID and observed identities;
- phase timestamps/durations and terminal state;
- structured harness/provider/tool events;
- client-observed measurements and attributed provider measurements;
- workspace before/after digest and bounded diff summary;
- evaluator outcomes and verification exit status;
- errors, missing evidence, redaction report, and artifact digests.

### QualificationDecision

- matrix and policy revision;
- directly comparable trial sets;
- gates, exclusions, scores, confidence, and tradeoffs;
- selected result or explicit no-winner outcome.

## 4. Adapter Contracts

### HarnessAdapter

```text
discover -> render isolated configuration -> invoke -> stream structured events
         -> cancel -> collect effective behavior -> cleanup
```

An adapter receives only an owned workspace, owned configuration root, provider
profile, task declaration, and bounded process environment. It cannot use the
operator's normal home/configuration root. Each adapter parses native output
into the canonical event vocabulary while retaining an attributed bounded raw
artifact only when policy permits.

### ProviderAdapter

```text
normalize profile -> bounded capability/health probe -> request transport
                  -> attributed usage/metric parsing
```

It cannot install, start, stop, load, unload, or configure the provider. A local
provider is still external. OpenAI-compatible and Anthropic-compatible adapters
are initial protocol families; LM Studio is represented by an ordinary profile
plus any explicitly observed extensions.

### WorkspaceAdapter

Creates a disposable copy/worktree or fixture tree, records the immutable input
digest, exposes only declared paths, computes a bounded structured diff, and
removes every owned artifact after retention decisions are applied.

### EvaluatorAdapter

Runs allowlisted typed checks such as executable tests, schema validation, tool
trace assertions, file/diff assertions, and bounded rubrics. An evaluator never
executes arbitrary model-provided commands merely because they appeared in text.

### SecretProvider

Resolves a declared reference into a process-local value at the last responsible
moment. Values are excluded from serialization, logs, subprocess arguments, and
redaction diagnostics.

## 5. Process and Configuration Isolation

Each trial receives:

- an owned temporary root;
- a disposable harness home/configuration directory;
- a disposable task workspace;
- an allowlisted environment with explicit proxy/network policy;
- a new process group or Windows Job Object;
- bounded stdout/stderr/event capture; the secret-leak refusal scans exactly
  this bounded window, and content beyond the bound can enter no persisted
  field because every persisted field is derived from within the window;
- hard and cooperative cancellation deadlines;
- cleanup verification for processes and files.

Harness-specific configuration is rendered from typed fields. Arbitrary config
fragments are rejected. A future explicit user-config experiment is a separate
opt-in lane with backup, preview, confirmation, and restoration; it is not the
ordinary trial path.

## 6. Measurement Model

Tonos owns end-to-end measurements at the harness boundary:

- process startup and configuration time;
- time to first visible/reasoning/tool event when observable;
- total task wall time;
- tool-call and edit/verification phases;
- retries, failures, cancellation, and recovery;
- task/evaluator outcomes.

Provider-reported TTFT, tokens, cache, queue, or decode metrics use a separate
source namespace and are never substituted for client timing. If server-side
evidence is independently available, an operator can correlate it later without
changing either record's ownership or truth claims.

## 7. Evidence and Privacy

Raw local evidence is content-addressed and policy-classified. Default durable
and exported records contain structured metadata, measurements, evaluator
outcomes, bounded error classes, and digests—not secrets, prompts, responses,
reasoning, arbitrary tool arguments, or repository contents.

Content-bearing fixtures and artifacts declare one of:

- `ephemeral`: evaluate and remove;
- `retained_local`: retain below an ignored owned root;
- `exportable_sanitized`: export only through the declared redactor;
- `public_fixture`: committed non-sensitive deterministic fixture.

Redaction occurs before persistence to an export bundle. Canary tests cover
credentials, home paths, endpoint tokens, prompt/response text, and repository
content.

## 8. Comparison Model

Direct comparison requires compatible harness/adapter version, effective
harness configuration, provider protocol behavior, served-model observation,
task suite/evaluator revision, workspace input, repetition policy, and declared
environment dimensions. Different provider endpoints or machines may be useful
but are labeled normalized/estimated or incomparable unless policy defines a
valid normalization.

Changing several axes is allowed in a matrix, but the report must not attribute
the difference to one axis. “Best” always names the matrix and policy.

## 9. Optional Interoperability

Tonos has no Morpheus adapter in its required runtime. A generic sanitized
qualification bundle may optionally include:

- external deployment/evidence references supplied by the operator;
- an opaque correlation value;
- served-model and provider observations;
- task quality and client-timing summaries;
- content digests, limitations, and redaction report.

Another system chooses whether and how to import it. Tonos never assumes that a
correlation match makes clocks, identities, metrics, or ownership equivalent.
See [INTEROPERABILITY.md](INTEROPERABILITY.md).

## 10. Target Repository Shape

The implementation language is TypeScript on Node.js >= 22. Domain logic lives
under `core/` with zero process, filesystem, network, or provider imports;
adapters isolate the rest. The conceptual layout is:

```text
core/                 identities, trials, matrices, evaluation, comparison
adapters/harnesses/   Codex, Grok CLI, Zero, OpenClaude, and future clients
adapters/providers/   OpenAI-compatible, Anthropic-compatible, fixtures
adapters/workspaces/  disposable repository and configuration roots
adapters/evaluators/  executable and structured evaluators
schemas/              versioned declarations, results, and exports
tasks/                public deterministic suites and fixtures
tests/                unit, contract, integration, acceptance, optional live
legacy/lmstudio/      temporary home for predecessor engine-control scripts
artifacts/             ignored local results and content-bearing evidence
```

Do not move legacy scripts until characterization tests cover the behavior that
must be preserved and the provider-neutral replacement has passed acceptance.
