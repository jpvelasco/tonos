# Tonos

Local LM Studio benchmark and qualification tools for the bench-rig RTX 4070 Ti Super workstation.

The qualified model is **Gemma 4 12B QAT Q4_0** at 65,536 context, parallel 1, eval/physical batch 8192/2048, and GPU-resident f16 KV cache. It delivered 63.53 native tok/s, 4.23 s cold TTFT, 0.23 s reuse TTFT, passed the executable Go quality fixture, and passed real OpenCode and Grok CLI repository tasks.

## Use

- Run syntax checks: `.\check-syntax.ps1`
- Inspect LM Studio: `.\model-manager.ps1 -Action status`
- Smoke-test the loaded model: `.\test-load.ps1`
- Benchmark one configuration: `.\benchmark.ps1 -Model 'google/gemma-4-12b-qat' -Label 'gemma4' -Suite OpenCode -ContextLength 65536 -Parallel 1 -EvalBatchSize 8192 -PhysicalBatchSize 2048 -KvCacheGpu -RunQuality`
- Compare local schema-v3 results: `.\compare-results.ps1`

Generated results are intentionally ignored. See [CLAUDE.md](CLAUDE.md) for operating details and [LEGACY_LM_STUDIO_HANDOFF.md](LEGACY_LM_STUDIO_HANDOFF.md) for the evidence and decision record.
