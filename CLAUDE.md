# bench-rig — Local AI Desktop Dojo

**Purpose:** Test and tune local LLM models on the bench-rig box (RTX 4070 Ti Super, 16GB VRAM, 64GB RAM, Ryzen 7 2700X) via LM Studio. Find the best model/quant/settings combo for code review, architecture assessment, and general dev work.

## Hardware

- **GPU:** RTX 4070 Ti Super (16GB VRAM)
- **RAM:** 64GB
- **CPU:** AMD Ryzen 7 2700X
- **OS:** Windows 11 Pro
- **Inference:** LM Studio (local Ollama-compatible API)

## Model Candidates (16GB VRAM)

| Priority | Model | Quant | ~VRAM | Notes |
|---|---|---|---|---|
| **Primary** | Qwen3.6-35B-A3B (MoE) | Q3/Q4 | 16–17 GB | Best capability/fit balance. MoE = ~3B active params per token |
| Alt 1 | Gemma 3 27B | Q4 | ~16 GB | Tight fit, minimal headroom |
| Alt 2 | Mistral Small 24B | Q4 | 13–14 GB | More headroom for context, slightly less capability |
| Avoid | 27B dense | high quant | ❌ | Doesn't fit well at high quants |

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