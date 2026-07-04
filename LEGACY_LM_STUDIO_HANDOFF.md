# bench-rig LM Studio — Findings and Next Steps

Date: 2026-07-03
Machine: Windows 11, RTX 4070 Ti Super 16 GB, 64 GB RAM, Ryzen 7 2700X
LM Studio endpoint: `http://127.0.0.1:1234/v1`

## Current verified state

The OpenCode and Grok CLI configurations are valid and resolve successfully. The previous `n_keep >= n_ctx` context-length failure is no longer occurring.

Controlled schema-v3 benchmarking is complete enough to identify **Gemma 4 12B QAT Q4_0 as the provisional bench-rig winner**. It is not yet the client default because a real OpenCode repository task with tool use and edits remains outstanding.

### OpenCode

- Active config: `%USERPROFILE%\.config\opencode\opencode.json`
- The active path is a symbolic link to:
  `X:\dotfiles\opencode\opencode.json`
- Windows may report the symbolic link itself as zero bytes. The target file is valid JSON and was verified as 1,510 bytes.
- Default model: `lmstudio/qwen3.6-35b-a3b`
- bench-rig provider: `http://127.0.0.1:1234/v1`
- Configured bench-rig models:
  - `qwen3.6-35b-a3b`
    - Context: 65,536
    - Maximum output: 16,384
    - Reasoning and tool calls enabled
  - `google/gemma-4-12b-qat`
    - Context: 65,536
    - Maximum output: 16,384
- bench-rig remains configured separately:
  - Endpoint: `http://192.0.2.10:8082/v1`
  - Model: `qwen36-27b-nvfp4`
  - Context: 131,072
  - Maximum output: 16,384

`opencode debug config` resolved the expected default and model list successfully.

An end-to-end OpenCode smoke test using Qwen3.6 returned exactly `OK` without a context-length error:

- Exit code: 0
- Input tokens: 10,141
- Output tokens: 4
- Reasoning tokens: 16
- Total tokens: 10,161
- Wall time: 162.6 seconds

### Grok CLI

- Config: `%USERPROFILE%\.grok\config.toml`
- Default remains `bench-rig-coder`.
- Available local aliases:
  - `bench-rig-coder`
  - `bench-rig-qwen36`
  - `bench-rig-gemma4`
- Removed stale or broken aliases:
  - `bench-rig-qwen3-coder`
  - Qwen3.5 9B
  - Qwen2.5 Coder
  - GPT-OSS
  - Nemotron

`grok models` parses the config and lists the expected models.

Previously measured smoke-test times:

| Model | Result | Wall time |
|---|---:|---:|
| bench-rig coder | `OK` | 12.3 s |
| bench-rig Gemma 4 | `OK` | 21.6 s |
| bench-rig Qwen3.6 | `OK` | 164.4 s |
| Qwen3 Coder 30B A3B | Failed | Embedded Jinja template error |

The Qwen3 Coder failure was:

`Cannot apply filter "string" to type: NullValue`

### LM Studio

No model was loaded at the last catalog refresh. Installed inference models are:

| Model | Quant | Disk size |
|---|---|---:|
| Gemma 4 12B QAT | Q4_0 | 7.15 GB |
| Qwen3 Coder 30B A3B Instruct | IQ3_XXS | 12.85 GB |
| Qwen3.6 35B A3B MTP | IQ3_XXS | 14.07 GB |
| Qwen3.6 35B A3B | Q3_K_S | 15.36 GB |

The controlled winner was loaded at 65,536 context, parallel 1, evaluation batch 8,192, physical batch 2,048, and GPU-resident KV cache.

An `EPERM` warning occurred while the LM Studio CLI attempted to update:

`%USERPROFILE%\.lmstudio\.internal\cli-pref.json`

The model itself nevertheless loaded successfully. The warning affected CLI preference persistence, not the completed model load.

## Original performance problem

Qwen3.6 is functional but too slow for interactive OpenCode usage on this machine.

The OpenCode smoke test took 162.6 seconds, although the recorded output-generation events occupied only about 2.5 seconds. Approximately 160 seconds were therefore spent before or around generation, primarily processing/prefilling the roughly 10,000-token OpenCode system prompt.

This explains why even a simple `hello` appeared to take more than two minutes. The principal problem was prompt-prefill latency, not just visible output-token generation speed.

The controlled parallel-1 Qwen3.6 Q3_K_S run reduced cold OpenCode TTFT to 18.68 seconds, showing that the original parallel-4 setup was materially harmful. It did not make the model competitive: native generation remained 10.09 tok/s. The 15.36 GB model also leaves little room on a 16 GB GPU for KV cache, compute buffers, and desktop use.

## Controlled benchmark conclusion

All comparison rows below used a 65,536-token configured context and parallel 1. Qwen3 Coder requested Q4 KV-cache quantization; the result did not prove that LM Studio applied it, so it is not described as an effective setting.

| Model/configuration | Cold TTFT | Reuse TTFT | Native tok/s | Quality | Free VRAM |
|---|---:|---:|---:|---|---:|
| Gemma 4 12B QAT Q4_0, GPU KV, batch 8192/2048 | 4.23 s | 0.23 s | 63.53 | PASS | 4,289 MiB |
| Qwen3 Coder 30B A3B IQ3_XXS, GPU KV requested, batch 1024/512 | 7.70 s | 0.66 s | 35.33 | Executable; tests failed | 1,518 MiB |
| Qwen3.6 35B A3B MTP IQ3_XXS, CPU KV, batch 2048/512 | No final OpenCode result | — | 13.32 | 99.2% reasoning; no visible answer | 2,436 MiB |
| Qwen3.6 35B A3B Q3_K_S, CPU KV | 18.68 s | 1.16 s | 10.09 | Smoke only | 2,439 MiB |

Gemma also passed a separate runtime validation at 61.26 native tok/s with 4,165 MiB free VRAM. Its 10K-prompt cold and reuse TTFT measurements were 3.24 seconds and 0.21 seconds.

Qwen3 Coder missed the 1,536 MiB post-run free-VRAM gate by 18 MiB and failed the semantic Go fixture: its retry implementation returned an aggregate error instead of the final underlying error. The Qwen3.6 MTP result spent nearly all generated tokens on reasoning and produced no visible coding answer. Both are disqualifying independently of speed.

Primary result labels:

- `gemma4-12b-65k-gpukv`
- `gemma4-65k-runtime-validation`
- `qwen3-coder-q4kv-65k-final`
- `qwen36-35b-iq3-mtp-authoritative`
- `qwen36-q3-baseline-opencode`

## Backups

Backups made before editing:

- `%USERPROFILE%\.config\opencode\opencode.json.backup-20260703-124632`
- `%USERPROFILE%\.grok\config.toml.backup-20260703-124632`

## Next steps

The synthetic tuning loop is complete. Remaining work is client validation and cleanup:

1. Load Gemma with the winning 65K/parallel-1/8192/2048/GPU-KV configuration.
2. Run a normal OpenCode task against a disposable or clean repository. Require successful file inspection, tool calls, a targeted edit, and verification—not a trivial `OK` response.
3. Run a comparable Grok CLI task using `bench-rig-gemma4`.
4. Check both client logs for context, template, malformed tool-call, truncation, or silent fallback errors.
5. If both clients pass, change the bench-rig OpenCode default from Qwen3.6 to Gemma. Keep bench-rig unchanged.
6. Archive or remove stale pre-schema-v3 result artifacts and resolve `.grok-config.toml.pending` before committing a coherent checkpoint.

## Decision criteria

A usable bench-rig default should:

- Process the normal OpenCode prompt without multi-minute prefill.
- Remain inside the RTX 4070 Ti Super's 16 GB VRAM during typical use.
- Support at least the configured 65,536-token context without an 8K fallback.
- Produce valid tool calls and reliable code.
- Avoid template errors and context-retention failures.

Controlled tuning is complete enough to reject both Qwen3.6 configurations and Qwen3 Coder for this GPU. Gemma is the provisional bench-rig default candidate, pending real OpenCode and Grok tool-use validation. bench-rig remains Grok CLI's default.
