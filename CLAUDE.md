# bench-rig — Local AI Desktop Dojo

**Purpose:** Test and tune local LLM models on the bench-rig box (RTX 4070 Ti Super, 16GB VRAM, 64GB RAM, Ryzen 7 2700X) via LM Studio. Find the best model/quant/settings combo for code review, architecture assessment, and general dev work.

## Hardware

- **GPU:** RTX 4070 Ti Super (16GB VRAM)
- **RAM:** 64GB
- **CPU:** AMD Ryzen 7 2700X
- **OS:** Windows 11 Pro
- **Inference:** LM Studio (local OpenAI-compatible API at `localhost:1234`)
- **Model storage:** `X:\.lmstudio\models`

## Model Candidates (16GB VRAM)

**Baseline (bench-rig box `192.0.2.10`):** `qwen36-27b-nvfp4` — NVIDIA FP4 quant on Blackwell GPU. That's the current primary coder in opencode config. **Not relevant for local testing** — NVFP4 is optimized for Blackwell (5090), not your Ada Lovelace 4070 Ti Super.

**Local targets (bench-rig box `127.0.0.1`, LM Studio, Ada Lovelace 16GB):**

| Priority | Model | Quant Format | ~VRAM | Notes |
|---|---|---|---|---|
| **Primary** | Qwen3.6-35B-A3B (MoE) | GGUF Q3/Q4 | 16–17 GB | Best capability/fit. MoE = ~3B active params per token. Source: `Qwen/Qwen3.6-35B-A3B` |
| Alt 1 | Qwen3.6-27B | GGUF Q3/Q4 | ~14–16 GB | Dense 27B, lower quants only. Smaller context window than MoE |
| Avoid | NVIDIA NVFP4 variants | NVFP4 | ❌ | Blackwell-only. Not optimal for Ada Lovelace |

GGUF quants from Unsloth/community on HuggingFace are the way to go — not NVFP4.

## Test Prompts

- `nyxtest_prompt.txt` — Code review / architecture assessment of the nyx repo (Go CLI, homelab network validation)
- More prompts added as testing progresses

## Tuning Scripts

- `bench-coder-tuner.ps1` — PS7 tuner, tests Grok coder parameter combos (temp/presence/freq)
- `bench-coder-tuner-v5.ps1` — PS 5.1 compatible version (older, uses `Repeat` instead of `Freq`)

## Results

Tuning results logged to `results/` as timestamped files.

## Conventions

- Results stored in `results/` with date-stamped filenames
- Test scripts in root, prompts in root
- Keep it lean — this is a dojo, not a product