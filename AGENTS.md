# AGENTS.md

## Where We Left Off (2026-09-09)

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

### Current work: multi-harness qualification lanes landed

Done and stable: hardening pass (#23), matrix execution loop with CLI
(#33–#36), operator-driven retention via `matrix prune` (#38), and
terminalReason `'disconnected'` for mid-body transport deaths (#39). Entry
points: `core/matrix/`, `adapters/matrix/`, `cli/tonos.ts` (exit codes
documented in-file), design rationale in `docs/MATRIX_RUNNER_DESIGN.md`.
Prune old result directories with
`npm run cli -- matrix prune --artifacts <dir> [--keep-last N]
[--older-than-days D] [--apply]` (dry-run by default).

The first real-harness adapter, Codex CLI, is complete through M4 (issue #40;
PRs #41, #45, and #59): sanitized JSONL replay fixtures, a disposable
`CODEX_HOME`, process-local `TONOS_SECRET_*` injection, live `ProcessPort`
spawn with suite prompt content, and opt-in smoke execution via
`TONOS_LIVE_CODEX=1`. No network or auth is needed for its contract tests.

Claude Code (`openclaude`, #62), Aider, and Cline (#65) now pass the same
shared adapter contract. They use replay fixtures, isolated configuration
roots, `ProcessPort` live execution, and suite task prompts; their live lanes
are separately gated by `TONOS_LIVE_CLAUDE=1`, `TONOS_LIVE_AIDER=1`, and
`TONOS_LIVE_CLINE=1`. The matrix executor registry is keyed by
`declaration.harness.adapterKind`; register the required kinds explicitly with
`--harness fixture|codex|openclaude|aider|cline`.

Provider and qualification evidence also expanded:

- `anthropic-compatible` maps Anthropic Messages exchanges to the canonical
  observation shape (#66). Provider protocol is a comparability axis, so
  mixed-protocol cells are never silently compared.
- Trial results retain optional provider-reported token usage and
  operator-rate-table cost estimates (#61). Missing observations remain
  explicitly missing evidence; no usage or cost is invented.
- `matrix qualify --report markdown|html` emits sanitized derived reports
  with gates, exclusions, limitations, and explicit no-winner outcomes (#63).
  The encoded qualification decision remains the source of truth.
- The `tonos-matrix` workflow runs the committed fixture matrix on pull
  requests and uploads sanitized artifacts (#64). Live execution is
  `workflow_dispatch` only and requires an explicit repository secret.

Read these files before changing product behavior:

1. `docs/PRODUCT_SPECIFICATION.md` — accepted purpose, invariants, and scope;
2. `docs/ARCHITECTURE.md` — target ports, records, data flow, and safety model;
3. `docs/IMPLEMENTATION_PLAN.md` — T0-through-T8 agent work order and gates;
4. `docs/INTEROPERABILITY.md` — optional, non-coupling Morpheus relationship;
5. `legacy/lmstudio/CLAUDE.md` + handoff doc there — historical evidence only.

Status text in `README.md`, `docs/IMPLEMENTATION_PLAN.md`,
`docs/ARCHITECTURE.md`, and `docs/PRODUCT_SPECIFICATION.md` establishes the
product and milestone baseline (T0–T6+T8 landed; T7 optional). This handoff
also records the post-plan multi-harness, reporting, cost-evidence, and
dual-protocol work through PR #66.

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
- Live provider and real-harness lanes are opt-in and must identify every
  external service, workspace, configuration root, and allowed mutation
  before execution; they never run in default CI.

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

Testing gotchas:

- Suites must run through tsx (`npm test`, or
  `npx tsx --test tests/ts/<file>.test.ts` for one file). Plain
  `node --test` fails on TS parameter properties
  (`ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`).
- New loopback test servers must bind through the `listen()` helper in
  `tests/ts/providers.test.ts`: it probes-and-rebinds ports the fetch spec
  forbids (`Error: bad port`) — Windows dynamic ranges can deal them, and a
  bare `listen(0)` there produces retry-immune flakes.
- Process-tree assertions filter by a per-run `--marker=` argument; do not
  scan all system processes (parallel test files run their own fixtures).
- Live adapter lanes are opt-in env-gated (`TONOS_LIVE_CODEX=1`,
  `TONOS_LIVE_CLAUDE=1`, `TONOS_LIVE_AIDER=1`, or `TONOS_LIVE_CLINE=1`) and
  never run in default CI.

On every PR, `ci` runs `gates` (Windows pwsh: legacy syntax checks and legacy
unit tests — always, not only when legacy files change) plus `node-gates` on
Ubuntu and Windows (`npm ci` → typecheck → test → `verify-generated`). The
separate `tonos-matrix` workflow runs the fixture-only matrix and uploads
sanitized artifacts. Generated artifacts are LF-pinned via `.gitattributes` —
never hand-edit `schemas/*.json` or `tests/fixtures/goldens/*.json`; rerun
the emitters and commit the output.
