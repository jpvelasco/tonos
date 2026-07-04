# bench-rig — Local AI Desktop Dojo

**Purpose:** Test and tune local LLM models on the bench-rig box (RTX 4070 Ti Super, 16GB VRAM, 64GB RAM, Ryzen 7 2700X) via LM Studio. Find the best model/quant/settings combo for code review, architecture assessment, and general dev work.

## Hardware

- **GPU:** RTX 4070 Ti Super (16GB VRAM)
- **RAM:** 64GB
- **CPU:** AMD Ryzen 7 2700X
- **OS:** Windows 11 Pro
- **Inference:** LM Studio (OpenAI-compatible API at `http://127.0.0.1:1234`)
- **Model storage:** `X:\.lmstudio\models`

## Evaluated Models (16 GB VRAM)

**External baseline (bench-rig box `192.0.2.10`):** `qwen36-27b-nvfp4` remains the primary coder outside this machine. Its NVIDIA FP4 quant is optimized for Blackwell and is not a local Ada Lovelace candidate.

**bench-rig (`127.0.0.1`, RTX 4070 Ti Super):**

| Status | Model | Quant | Controlled result |
|---|---|---|---|
| **Qualified winner** | Gemma 4 12B QAT | Q4_0 | 63.53 native tok/s, 4.23 s cold TTFT, 0.23 s reuse TTFT, quality PASS, 4,289 MiB free VRAM |
| Rejected | Qwen3 Coder 30B A3B | IQ3_XXS | 35.33 native tok/s; quality fixture executable but tests failed; 1,518 MiB free VRAM |
| Rejected | Qwen3.6 35B A3B MTP | IQ3_XXS | 13.32 native tok/s; 99.2% reasoning; no visible coding answer |
| Rejected | Qwen3.6 35B A3B | Q3_K_S | 10.09 native tok/s; controlled OpenCode cold TTFT 18.68 s |

Gemma is the qualified bench-rig winner. It passed controlled performance and executable quality tests, then real OpenCode and Grok CLI repository tasks with tool use, edits, and verification. Client-default promotion remains a separate configuration decision.

## Test Prompts

- `nyxtest_prompt.txt` — Code review / architecture assessment of the nyx repo
- `coding_prompt.txt` — Go retry decorator implementation (coding ability test)
- `debugging_prompt.txt` — Go map mutation bug (debugging ability test)

## Scripts

### Benchmark

- `benchmark.ps1` — Authoritative schema-v3 benchmark harness. It can load a model, collect cold/reuse TTFT and native throughput, run Quick/OpenCode/Full suites, and optionally run the executable Go quality fixture.
  - Example: `.\benchmark.ps1 -Model 'google/gemma-4-12b-qat' -Label 'gemma4-baseline' -Suite OpenCode -ContextLength 65536 -Parallel 1 -EvalBatchSize 8192 -PhysicalBatchSize 2048 -KvCacheGpu -Runs 3 -RunQuality`
  - Use `-PromptFile` to replace the coding-quality prompt and `-SkipLoad` only when the intended model/configuration is already loaded.
  - Outputs timestamped schema-v3 JSON under `benchmark-results/`; captured quality output is embedded in each record.
- `bench.ps1` — Compatibility wrapper that forwards the supported arguments to `benchmark.ps1`.
- `run-all-benchmarks.ps1` — Runs the retained Gemma/Qwen comparison matrix one model at a time. Example: `.\run-all-benchmarks.ps1 -Selection Gemma`.

### Compare

- `compare-results.ps1` — Compares schema-v3 results in `benchmark-results/`.
  - Usage: `.\compare-results.ps1`, `.\compare-results.ps1 -Format csv`, or `.\compare-results.ps1 -Label 'gemma4-*'`.
  - Supported formats: `table`, `json`, and `csv`.

### Model Manager

- `model-manager.ps1` — Lists installed/loaded LM Studio models and performs supported load/unload/status actions.
  - Usage: `.\model-manager.ps1 -Action status`.

## Benchmark Workflow

1. Choose one explicit model/configuration and record context, parallelism, batch sizes, KV-cache placement, and reasoning mode.
2. Run `benchmark.ps1`; let it load the model unless the exact configuration is already resident.
3. Change one configuration variable at a time and keep the suite, prompt, run count, and output limit fixed.
4. Use `-RunQuality` before advancing a fast configuration. Throughput alone is not an acceptance result.
5. Compare schema-v3 records with `compare-results.ps1`.
6. Re-run real OpenCode and Grok CLI repository tasks after any model, prompt-template, or client configuration change.

## Results

Generated `benchmark-results/` data is local and ignored by Git; `LEGACY_LM_STUDIO_HANDOFF.md` is the committed decision record. Schema-v3 files remain the authoritative local result format. Schema-v3 JSON records contain requested/effective configuration, TTFT, throughput, reasoning share, VRAM observations, and quality status. Captured quality output is embedded in the records; temporary executable fixtures are removed after each run.

`results/` contains older harness output, is ignored by Git, and must not be mixed into current comparisons.

## Conventions

- Current results use schema v3 and are stored in `benchmark-results/` with date-stamped filenames
- Test scripts in root, prompts in root
- Keep at least 1,536 MiB free VRAM after a representative run; treat a quality failure or missing visible answer as disqualifying
- Keep it lean — this is a dojo, not a product
