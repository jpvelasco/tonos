# AGENTS.md

## Where We Left Off (2026-08-23)

Tonos is a **provider-agnostic AI harness qualification lab**. It compares
developer harnesses such as Codex, Grok CLI, Zero, OpenClaude, and future
adapters across reproducible task suites, harness configurations, served
models, and provider endpoints.

The refactor from the legacy LM Studio toolkit is **executed**: milestones
T0–T6 and T8 landed as PRs #15–#22 (issues #5–#13 closed, epic #14 has the
execution summary). The primary path is TypeScript under `core/`, `adapters/`,
and `tasks/`; the entire engine-control toolkit is archived under
`legacy/lmstudio/` with explicit LEGACY MACHINE-LAB banners. Ordinary use —
fresh clone → `npm ci` → gates — requires no LM Studio, `lms`, `nvidia-smi`,
GPU, Node model loader, or Morpheus.

**The only open milestone is T7 interoperability (issue #12)**, deferred by
design: it is blocked on external work in the Morpheus repository (rectifications
R1 and R2) plus cross-repo agreement on static golden exchange fixtures. Do not
implement it before those land; it must never block Tonos qualification.

### Current work: hardening / bug hunt

The next session's job is finding bugs in the new code. Known weak spots to
start from (see issue #23 for the full backlog):

- `tests/ts/providers.test.ts` equivalence scenario failed intermittently
  under load twice ('' !== 'Hello', then 'cancelled'); transport retry and a
  tail-buffer flush were added but the root cause was never confirmed.
- The T2 runner emits its own `TrialRunOutput`; composing that into a codec-
  valid canonical `TrialResult` document (with workspace digests and diff
  summaries persisted) is not wired end-to-end yet.
- Windows uses `taskkill /T /F` rather than true Job Objects; tree-kill
  semantics are what the tests pin, not the mechanism.
- Matrix execution (bounded concurrency, checkpoint/resume) exists only as
  pure comparison logic in `core/comparison/engine.ts`; there is no runner
  loop over a matrix declaration yet.

Read these files before changing product behavior:

1. `docs/PRODUCT_SPECIFICATION.md` — accepted purpose, invariants, and scope;
2. `docs/ARCHITECTURE.md` — target ports, records, data flow, and safety model;
3. `docs/IMPLEMENTATION_PLAN.md` — T0-through-T8 agent work order and gates;
4. `docs/INTEROPERABILITY.md` — optional, non-coupling Morpheus relationship;
5. `legacy/lmstudio/CLAUDE.md` and `legacy/lmstudio/LEGACY_LM_STUDIO_HANDOFF.md` — historical LM Studio
   operating evidence only.

Do not begin multiple named-harness adapters without an issue-scoped plan;
the fixture adapter contract (`core/harness/contract.ts`) is the gate every
real adapter must pass first.

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

Primary path (TypeScript, Node ≥ 22):

```powershell
npm ci
npm run typecheck
npm test
npm run verify-generated   # emitted schemas/goldens must match the repo byte-for-byte
```

Legacy archive lane (required when touching `legacy/lmstudio/` or its tests):

```powershell
.\check-syntax.ps1
.\tests\run-tests.ps1
```

CI runs all of these on every PR (windows pwsh gates; node gates on ubuntu +
windows). Generated artifacts are LF-pinned via `.gitattributes` — never
hand-edit `schemas/*.json` or `tests/fixtures/goldens/*.json`; rerun the
emitters and commit the output. Live provider and real-harness lanes are
opt-in and must identify every external service, workspace, configuration
root, and allowed mutation before execution.
