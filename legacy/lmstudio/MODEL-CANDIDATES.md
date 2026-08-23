# Historical bench-rig Candidate Queue

Status: Provider- and machine-specific research input. These candidates are not
a Tonos catalog, a universal ranking, or an active implementation queue. See
[`docs/PRODUCT_SPECIFICATION.md`](docs/PRODUCT_SPECIFICATION.md) for the current
provider-agnostic harness-qualification scope.

Hardware constraint: RTX 4070 Ti Super with 16 GB VRAM, 64 GB system RAM, one loaded model, 65,536-token working context. A candidate is not accepted merely because its weights load. It must keep the KV cache on GPU, retain at least 1.5 GiB of VRAM headroom, expose visible output promptly, and pass the repository-backed coding test.

## Test order

| Priority | Candidate | Role | Why it is testable | Initial quantization strategy |
|---:|---|---|---|---|
| 1 | [Qwen3 Coder 30B A3B Instruct](https://lmstudio.ai/models/qwen/qwen3-coder-30b) | Coder | 30.5B total / 3.3B active, 256K native context, tool use, and no hidden thinking stream | Start IQ3/3-bit; require 65K GPU KV and >=1.5 GiB free |
| 2 | [Qwen3 30B A3B Instruct 2507](https://lmstudio.ai/models/qwen/qwen3-30b-a3b-2507) | Everyday | 3.3B active, 262K context, tool use, non-thinking only | Start IQ3/3-bit; same fit gate |
| 3 | [GLM-4.7 Flash](https://lmstudio.ai/models/glm-4.7) | Coder challenger | 30B-A3B MoE with coding, tool use, and reasoning | Smallest useful quant; reject if 65K GPU KV spills |
| 4 | [GLM-4.6V Flash](https://lmstudio.ai/models/zai-org/glm-4.6v-flash) | Fast everyday/vision | 9B, 128K context, tool use, vision, ample VRAM for GPU KV | Q4 or Q5, then tune batch size |

## Not candidates for this GPU-only performance target

- [Qwen3-Coder-Next](https://lmstudio.ai/models/qwen3-coder-next): smallest package is 42 GB. Its 3B active count does not remove the need to move roughly 42 GB of weights, so it cannot stay within 16 GB VRAM.
- [NVIDIA Nemotron 3 Nano](https://lmstudio.ai/models/nvidia/nemotron-3-nano): LM Studio lists 25 GB minimum system memory. The NVIDIA name does not make a 25 GB model fit a 16 GB VRAM budget; the likely CPU weight/KV traffic defeats the latency target.

## Acceptance gates

1. Load at 65,536 context, parallel 1, Flash Attention on, and GPU KV on.
2. Verify LM Studio's echoed effective configuration; a silent fallback is a failed run.
3. Keep at least 1,536 MiB VRAM free after the full benchmark.
4. Measure cold 12.7K-token TTFT, exact-prefix reuse, appended-prefix latency, and authoritative native decode speed.
5. Separate reasoning from visible text. Hidden reasoning that consumes the completion cap is a quality failure.
6. Compile the generated Go solution and run tests.
7. Abort any request at 300 seconds.
8. A challenger must either beat 50 visible tok/s with passing code, or materially improve code quality without falling below 30 visible tok/s.
