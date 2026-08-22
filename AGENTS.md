# AGENTS.md

PowerShell toolkit that benchmarks and qualifies local LLMs on bench-rig (RTX 4070 Ti Super 16 GB) through LM Studio's API at `http://127.0.0.1:1234`. Not an application — no build, package manager, or test framework. Operating details live in [CLAUDE.md](CLAUDE.md); evidence and decision record in [LEGACY_LM_STUDIO_HANDOFF.md](LEGACY_LM_STUDIO_HANDOFF.md).

## Verify changes

```powershell
.\check-syntax.ps1    # parses every *.ps1 + node --check load-model.mjs
.\tests\run-tests.ps1 # zero-dependency BDD-style unit tests (tests/*.Tests.ps1)
```

These are the only offline checks. Harness logic is tested through injectable command scriptblocks; live-server behavior still requires LM Studio.

## Hard dependencies

- LM Studio server must be reachable at the default `-ApiRoot` or benchmark/model-manager commands throw. You cannot smoke-test or benchmark without it (`test-load.ps1` hits the loaded model directly).
- PowerShell 7+ (`benchmark.ps1` has `#requires -Version 7.0`).
- `lms` CLI and `nvidia-smi` on PATH (used during load and VRAM capture); Node.js for `load-model.mjs`; Go toolchain only when running `-RunQuality`.

## Scripts

- `benchmark.ps1` is the authoritative schema-v3 harness. `bench.ps1` only forwards parameters to it — edit behavior in `benchmark.ps1` only.
- `model-manager.ps1` actions are `catalog | loaded | status | unload` (no load action; loading happens inside `benchmark.ps1`).
- `-RunQuality` extracts the first ```go block from the model reply, drops it into a `%TEMP%` dir alongside `quality/go-retry/{go.mod,retry_test.go}`, runs `go test -count=1 .`, then deletes the temp dir. Fixtures under `quality/` are the permanent copies.
- Result labels must match `^[a-zA-Z0-9._-]+$`.

## Benchmarking rules (violating these invalidates comparisons)

- Change **one** configuration variable at a time; keep suite, prompt file, run count, and output limit fixed across compared runs.
- Use `-SkipLoad` only when the exact requested configuration is already loaded and verified; otherwise let the script load and re-verify.
- The script throws unless LM Studio's echoed effective config matches the request — a silent fallback is a failed run, never reinterpret it as success.
- Acceptance gates: ≥ 1,536 MiB free VRAM after the run, visible non-reasoning output required (hidden reasoning consuming the token cap is a failure), and `-RunQuality` passing before trusting a fast config. Throughput alone is not acceptance.

## Data conventions

- Schema-v3 JSON goes to `benchmark-results/` (gitignored). `results/` holds legacy harness output and must never be mixed into current comparisons.
- Compare with `compare-results.ps1` (`-Format table|json|csv`, `-Label 'gemma4-*'`). Commit only summarized decision records, never generated artifacts.
- Prompt corpora are plain `.txt` files in root (`coding_prompt.txt` is the default `-PromptFile`).

## Current state

Gemma 4 12B QAT Q4_0 is the qualified winner (65,536 context / parallel 1 / eval batch 8192 / physical batch 2048 / GPU-resident f16 KV). Qwen3 Coder 30B A3B and both Qwen3.6 35B A3B variants are already rejected on this GPU — see CLAUDE.md before re-testing them.
