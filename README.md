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

The current PowerShell toolkit is a valuable but provider-coupled predecessor.
It qualified Gemma 4 12B QAT Q4_0 on the Batmobile RTX 4070 Ti Super through LM
Studio and established useful measurement patterns: requested/effective config
verification, cold and reused-prefix TTFT, visible-versus-reasoning output,
executable coding evaluation, partial-result retention, and VRAM observations.

That evidence remains valid only for its recorded machine, model, LM Studio,
configuration, and task fixtures. The target product direction is documented in
the [Tonos documentation index](docs/README.md); the existing scripts have not
yet been refactored to that architecture.

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

The existing LM Studio path remains usable while the provider-agnostic path is
built:

- Run syntax checks: `.\check-syntax.ps1`
- Run unit tests: `.\tests\run-tests.ps1`
- Inspect LM Studio: `.\model-manager.ps1 -Action status`
- Run the legacy benchmark: `.\benchmark.ps1 ...`
- Compare local schema-v3 results: `.\compare-results.ps1`

These commands can load or unload LM Studio models. They are explicit legacy
machine-lab operations, not the target provider adapter contract. Read
[CLAUDE.md](CLAUDE.md) and
[BATMOBILE_LM_STUDIO_HANDOFF.md](BATMOBILE_LM_STUDIO_HANDOFF.md) before using
them.

## Documentation

- [Documentation index](docs/README.md)
- [Product specification](docs/PRODUCT_SPECIFICATION.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Implementation plan](docs/IMPLEMENTATION_PLAN.md)
- [Optional Morpheus interoperability](docs/INTEROPERABILITY.md)
- [Historical LM Studio operating guide](CLAUDE.md)
- [Historical Batmobile evidence](BATMOBILE_LM_STUDIO_HANDOFF.md)

Generated results remain ignored. Commit schemas, fixtures, tests, and concise
sanitized decision records rather than prompts, model responses, credentials,
or raw repository content.
