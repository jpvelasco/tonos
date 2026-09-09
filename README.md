# Tonos

Tonos is a provider-agnostic qualification lab for AI developer harnesses. It
compares harnesses such as Codex, Grok CLI, Zero, OpenClaude, and future adapters
across versioned task suites, client configurations, served models, and local,
LAN, or remote provider endpoints.

Tonos optimizes the **developer-facing harness experience**: task correctness,
tool use, repository edits, recovery behavior, end-to-end latency, and the
effect of harness configuration. It treats inference endpoints as external
providers and does not install models, tune inference engines, manage GPU
resources, or control provider lifecycle.

## Status

The provider-agnostic TypeScript path is the primary product. T0–T6 and T8
have landed; T7 interoperability remains optional and externally gated.
The first real-harness adapter (Codex CLI) is complete through M4, including
disposable config roots and ProcessPort live spawn. Live Codex stays opt-in
(`TONOS_LIVE_CODEX=1`) and never runs in default CI.

The archived PowerShell LM Studio toolkit under `legacy/lmstudio/` is
historical evidence only. Its bench-rig measurements remain valid only for
their recorded machine, model, LM Studio, configuration, and task fixtures.

## Specialization

Tonos owns:

- harness adapters and isolated client configuration;
- provider-neutral endpoint adapters;
- versioned repository/task suites;
- end-to-end evaluation and comparison;
- sanitized, reproducible harness-qualification evidence.

Inference deployment belongs to the provider operator. A tool such as Morpheus
may independently select and tune the model, quantization, engine, and hardware
configuration. Tonos can test the resulting endpoint, but neither project is a
dependency of the other. See [Optional interoperability](docs/INTEROPERABILITY.md).

## Current Legacy Toolkit

The provider-agnostic domain layer (canonical records, codecs, schemas,
trial runner, harness and provider adapters, task suites, evaluators, and
comparison) is TypeScript under `core/` and `adapters/`; ordinary use
requires **no LM Studio, `lms`, `nvidia-smi`, GPU, Node model loader, or
engine-control privilege**. Run its gates with `npm run typecheck`,
`npm test`, and `npm run verify-generated`.

The retired engine-control toolkit lives under
[legacy/lmstudio/](legacy/lmstudio/). It remains deliberately invocable:

- Syntax checks (legacy scripts): `.\check-syntax.ps1`
- Legacy unit tests: `.\tests\run-tests.ps1`
- Inspect LM Studio: `.\legacy\lmstudio\model-manager.ps1 -Action status`
- Run the legacy benchmark: `.\legacy\lmstudio\benchmark.ps1 ...`

These commands can load or unload LM Studio models. They are explicit legacy
machine-lab operations, not the target provider adapter contract. Read
[CLAUDE.md](legacy/lmstudio/CLAUDE.md) and
[LEGACY_LM_STUDIO_HANDOFF.md](legacy/lmstudio/LEGACY_LM_STUDIO_HANDOFF.md)
before using them.

## Documentation

- [Documentation index](docs/README.md)
- [Product specification](docs/PRODUCT_SPECIFICATION.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Implementation plan](docs/IMPLEMENTATION_PLAN.md)
- [Optional Morpheus interoperability](docs/INTEROPERABILITY.md)
- [Historical LM Studio operating guide](legacy/lmstudio/CLAUDE.md)
- [Historical bench-rig evidence](legacy/lmstudio/LEGACY_LM_STUDIO_HANDOFF.md)

Generated results remain ignored. Commit schemas, fixtures, tests, and concise
sanitized decision records rather than prompts, model responses, credentials,
or raw repository content.
