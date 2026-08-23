# AGENTS.md

## Where We Left Off (2026-08-22)

Tonos is being redefined as a **provider-agnostic AI harness qualification
lab**. Its primary job is to compare developer harnesses such as Codex, Grok
CLI, Zero, OpenClaude, and future adapters across reproducible task suites,
harness configurations, served models, and provider endpoints.

The current PowerShell implementation at source `9061451` is useful historical
evidence but does not yet match that target. It combines a strong schema-v3
request/quality benchmark with Batmobile-specific LM Studio model loading,
engine settings, and NVIDIA telemetry. The LM Studio coupling is accidental.
Future work must separate harness qualification from inference-runtime control.

Read these files before changing product behavior:

1. `docs/PRODUCT_SPECIFICATION.md` — accepted purpose, invariants, and scope;
2. `docs/ARCHITECTURE.md` — target ports, records, data flow, and safety model;
3. `docs/IMPLEMENTATION_PLAN.md` — T0-through-T8 agent work order and gates;
4. `docs/INTEROPERABILITY.md` — optional, non-coupling Morpheus relationship;
5. `CLAUDE.md` and `BATMOBILE_LM_STUDIO_HANDOFF.md` — historical LM Studio
   operating evidence only.

The first implementation milestone is T0 characterization, followed by T1
canonical identities and trial records. Do not begin multiple harness adapters
before those records and the isolated runner are fixed. Do not implement the
optional Morpheus exchange before the standalone Tonos path is complete.

## Product Boundary

Tonos owns:

- harness identity, version, configuration, and invocation adapters;
- provider endpoint and served-model observations without engine ownership;
- versioned task suites and evaluation fixtures;
- isolated workspaces and temporary harness configuration roots;
- end-to-end correctness, tool-use, edit, recovery, and latency evidence;
- comparable trial matrices and qualification decisions.

Tonos does not own:

- model installation, loading, unloading, quantization, or conversion;
- inference-engine batch, KV-cache, tensor, scheduler, or process settings;
- GPU/service lifecycle, deployment promotion, rollback, or remote fleet control;
- the operator's normal harness configuration or credential stores;
- a universal “best model” claim independent of harness, task, provider, and
  served-deployment identity.

Provider endpoints may be local, on the LAN, or remote. Tonos treats them as
external services and uses only their declared request/capability interfaces.
LM Studio is one provider implementation, not an architecture boundary.

Morpheus is an optional peer, not a dependency. Tonos must build, test, and run
without a Morpheus checkout or service. If an operator deliberately uses both,
an opaque optional correlation value may associate client-side trial evidence
with server-side evidence. It is untrusted metadata, never authorization,
identity, ownership proof, or a required field.

## Safety Rules

- Never edit a user's active Codex, Grok, Zero, OpenClaude, provider, or shell
  configuration during an ordinary test. Use a disposable configuration root.
- Never retrieve, print, persist, or export secret values. Adapters receive
  secret references or process-local injected values only.
- Never load, unload, restart, or reconfigure a provider or inference engine as
  part of the provider-agnostic trial path.
- Never run a harness against an untrusted repository without an isolated
  disposable workspace and bounded command/file permissions.
- Persist prompts, responses, reasoning, tool arguments, or repository content
  only when the task suite explicitly permits it and the result policy declares
  the retention. Sanitized summaries are the default export.
- Treat provider-reported metrics as attributed observations, not verified
  server truth.
- Keep the legacy LM Studio scripts functional until their replacement gates
  pass; label their mutations clearly and require explicit operator invocation.

## Engineering Rules

- Use TDD: failing contract or acceptance test, minimal implementation, refactor.
- Keep trial/evaluation logic pure and put processes, files, providers, and
  harnesses behind typed adapter boundaries.
- Use structured parsers for JSON, JSONL, event streams, tool traces, and diffs.
- Make every identity and result schema versioned and deterministic.
- Record requested harness configuration separately from observed effective
  behavior; never silently accept a fallback.
- Preserve incomplete, timed-out, and failed trials as evidence without making
  them eligible winners.
- Do not add a direct Tonos-to-Morpheus source, package, or runtime dependency.
- Generated trial artifacts stay ignored; commit schemas, fixtures, tests, and
  concise sanitized decision records only.

## Current Validation

The legacy implementation has these offline checks:

```powershell
.\check-syntax.ps1
.\tests\run-tests.ps1
```

They remain required for changes to existing scripts. New architecture work
must add tests appropriate to its implementation language and the gate declared
in `docs/IMPLEMENTATION_PLAN.md`. Live provider and real-harness lanes are
opt-in and must identify every external service, workspace, configuration root,
and allowed mutation before execution.
