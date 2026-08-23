# Tonos Product Specification

Status: Accepted target direction; current LM Studio toolkit is a
provider-coupled predecessor

Specification date: 2026-08-22

## 1. Purpose

Tonos is a provider-agnostic qualification lab for AI developer harnesses. It
answers a bounded question:

> For this harness version, client configuration, task suite, provider
> endpoint, and served model, what behavior does a developer actually receive?

Tonos runs reproducible tasks through harnesses such as Codex, Grok CLI, Zero,
OpenClaude, and future adapters. It measures task correctness, tool behavior,
repository changes, recovery, end-to-end latency, and stability. A provider may
be LM Studio on the same machine, a local standalone engine, a LAN endpoint, a
Morpheus-managed endpoint, or a remote service.

The endpoint is external to Tonos. Tonos configures the client harness, not the
inference engine. It does not load models, tune engine settings, own GPU
resources, manage provider processes, or promote deployments.

## 2. Terminology

- **Harness:** a developer-facing AI client that supplies prompts, tools,
  repository context, orchestration, and interaction policy.
- **Harness configuration:** the non-secret, bounded settings used for one
  trial, including model alias, context/output requests, reasoning/tool modes,
  timeouts, retry policy, and prompt/template selection.
- **Provider:** an endpoint that accepts inference requests. Tonos does not infer
  ownership or implementation from protocol compatibility.
- **Served model observation:** the provider-reported model identity and
  capabilities observed for a trial. It is not a model artifact identity unless
  independently supplied and verified.
- **Task suite:** a versioned collection of fixtures, expected behaviors,
  evaluators, workspace policy, and retention rules.
- **Trial:** one immutable harness/configuration/provider/model/task-suite tuple.
- **Matrix:** a declared set of comparable trials that changes only the named
  experimental dimensions.
- **Qualification:** a bounded decision for one matrix and policy; never a
  universal claim about a harness or model.

## 3. Product Principles

1. **Harness experience is the subject.** Tonos measures the behavior delivered
   to the developer, including client overhead and orchestration.
2. **Provider neutrality.** OpenAI-compatible, Anthropic-compatible, and future
   provider protocols are adapters, not product boundaries.
3. **No inference ownership.** Providers remain externally operated. A trial
   cannot load, unload, restart, retune, or adopt an engine.
4. **Isolated configuration.** Ordinary trials never overwrite a user's active
   harness configuration, credentials, repository, or shell environment.
5. **Evidence before leaderboard.** Winners require declared gates, executable
   or otherwise objective evaluation, complete provenance, and comparable runs.
6. **Failures remain evidence.** Timeouts, malformed tool calls, missing visible
   output, incomplete edits, and provider errors remain visible and ineligible
   for silent promotion.
7. **Data minimization.** Sanitized metrics and evaluator results are the default
   retained/exported data. Content retention is explicit per suite.
8. **Independent operation.** Tonos has no source, package, runtime, or service
   dependency on Morpheus or any specific provider.

## 4. Primary Workflows

### 4.1 Define a Trial Matrix

The operator selects harness versions, bounded harness configurations, provider
profiles, served-model observations, task suites, repetitions, timeouts, and
acceptance policy. Tonos previews the matrix and identifies dimensions that
would make a comparison invalid.

### 4.2 Run Isolated Trials

For each trial, Tonos creates a disposable workspace and configuration root,
injects credentials without persisting their values, invokes the harness through
its adapter, captures structured events and bounded process telemetry, runs the
declared evaluators, and cleans up all owned resources.

### 4.3 Compare and Qualify

Tonos compares only compatible trials. Reports show correctness, tool-use,
edit/verification results, latency distributions, failure classes, repetitions,
and uncertainty. A policy can select a winner or report no qualified result.

### 4.4 Export Evidence

Tonos exports a versioned sanitized result bundle. Raw prompts, responses,
reasoning, tool arguments, repository contents, and secrets are excluded unless
the task suite explicitly declares a bounded content artifact and the operator
chooses to retain it.

## 5. Functional Requirements

### HARNESS-001 Typed Harness Adapters

Every supported harness implements discovery/version, isolated configuration
rendering, bounded invocation, structured-event parsing, cancellation, cleanup,
and exact effective-configuration reporting where the harness exposes it.

### HARNESS-002 Configuration Isolation

A normal trial uses a temporary home/configuration root and disposable
workspace. It cannot change the operator's default model, aliases, credentials,
plugins, MCP configuration, or repository state.

### PROVIDER-001 Provider-Neutral Endpoints

Provider profiles describe protocol, base endpoint, capability observations,
served-model alias, timeouts, and secret references. They contain no engine
launch flags or lifecycle commands.

### PROVIDER-002 Black-Box Boundary

The provider path may perform bounded health/capability probes and trial
requests. It cannot load, unload, restart, update, reconfigure, or inspect
private provider internals as part of an ordinary trial.

### TASK-001 Versioned Task Suites

Every suite has an immutable identity, fixture digests, evaluator versions,
required tools/capabilities, workspace policy, time/resource limits, and content
retention classification.

### TRIAL-001 Immutable Trial Declaration

The declaration binds exact harness, requested configuration, provider profile,
served-model observation, task suite, repetition, randomization policy,
environment class, limits, and optional opaque correlation value.

### TRIAL-002 Complete Trial Result

Every result records declaration identity, observed harness/provider/model
identity, timestamps, phase durations, exit/cancellation state, structured tool
events, evaluator outcomes, generated diff digest, verification commands and
exit status, errors, and declared missing evidence.

### EVAL-001 Objective Evaluation

Suites prefer executable tests, structured-output validation, tool-trace checks,
bounded diff assertions, and deterministic repository invariants. Subjective
rubrics are versioned, separately labeled, and never presented as executable
proof.

### EVAL-002 End-to-End Measurements

Tonos measures wall-clock behavior at the harness boundary. Provider-reported
TTFT, token, usage, or server metrics may be retained as attributed evidence but
remain distinct from client-observed timing.

### MATRIX-001 Comparable Experiments

Matrices name the dimensions allowed to vary. Comparisons distinguish direct,
normalized/estimated, and incomparable trials and report sample counts and
dispersion rather than one unqualified percentage.

### MATRIX-002 Bounded Qualification

A qualification decision records the matrix, policy revision, gates, excluded
trials, winner if any, tradeoffs, and limitations. It cannot claim that a model
or harness is universally best.

### DATA-001 Versioned Durable Evidence

Raw local observations are immutable and checksummed. Derived summaries carry a
reducer version. Exports are sanitized, schema-versioned, and reproducible from
the retained allowed inputs.

### SAFE-001 Secret and Content Protection

Secret values never enter trial records, logs, command lines, exports, or
fixtures. Content-bearing artifacts follow the suite's declared retention and
redaction policy and are excluded from default exports.

### INT-001 Optional Correlation

An operator may provide an opaque bounded correlation value so independently
operated client and server evidence can be searched together. Absence never
reduces Tonos functionality. The value is untrusted metadata and cannot grant
access, establish identity, prove ownership, or imply clock synchronization.

### INT-002 Optional External Evidence Exchange

Tonos may export a generic sanitized qualification bundle that another system,
including Morpheus, can choose to import. Tonos never calls a Morpheus control
API, depends on Morpheus schemas at runtime, or assumes an imported deployment
manifest is authorized engine configuration.

## 6. Explicit Non-Goals

- model download, conversion, quantization, loading, unloading, or deletion;
- engine batch, KV-cache, tensor, scheduler, speculative-decoding, or GPU tuning;
- inference process/service installation, restart, promotion, rollback, or
  recovery;
- remote fleet management or provider adoption;
- mutating the operator's active harness configuration by default;
- replacing harness-native functionality with a Tonos chat or agent product;
- persisting credentials or unrestricted prompt/response history;
- a public leaderboard detached from exact trial provenance;
- requiring Morpheus, LM Studio, or a particular harness to use Tonos.

## 7. Acceptance Standard

The provider-agnostic direction is source-complete only when:

- at least two materially different harness adapters run through one contract;
- at least two provider profiles, including a provider-neutral test fixture,
  run without engine lifecycle access;
- ordinary trials prove active user configuration and repositories unchanged;
- one task suite produces objective correctness, tool, edit, verification,
  latency, and failure evidence;
- repeated matrices classify comparable and incomparable trials honestly;
- restart/cancellation leaves no child process or disposable workspace behind;
- sanitized exports contain no secret/content canaries;
- Tonos passes all standalone gates with no Morpheus or LM Studio dependency;
- the legacy LM Studio evidence remains available and accurately bounded.
