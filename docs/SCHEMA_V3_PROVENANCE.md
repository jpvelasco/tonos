# Schema-v3 Provenance and Limitations

Status: T0 characterization record

Producer: `benchmark.ps1` (legacy machine-lab lane), document constructor
extracted to `New-SchemaV3Document` in `measurement-lib.ps1`.

This record states what each part of a schema-v3 document actually proves.
Per the product specification, provider-reported values are attributed
observations, never verified server truth.

## Measurement provenance

| Field group | Source | Trust boundary |
|---|---|---|
| `per_run[*].ttft_sec`, `wall_sec`, `decode_sec`, `first_*_sec` | Client clock (`Stopwatch`) around the streamed HTTP request | Tonos-owned end-to-end timing |
| `per_run[*].estimated_prefill_tok_s` | Derived: `prompt_tokens / ttft_sec` | Estimate; conflates transport, queueing, and prefill |
| `per_run[*].*_tok_s` (decode/reasoning/text/wall_completion) | Derived from client durations over provider-reported token counts | Mixed; token counts are provider-reported |
| `native_per_run[*].ttft_sec`, `authoritative_output_tok_s` | Provider-reported `stats` block of the LM Studio native endpoint | Provider-reported; separate namespace from client timing |
| `per_run[*].prompt/completion/reasoning/text_tokens` | Provider usage report (`stream_options.include_usage`) | Provider-reported |
| `effective_config`, `load_response` | Provider echo after load | Verified only against `requested_config` field equality by `Assert-EffectiveConfig`; anything outside the checked keys is unverified |
| `gpu.kv_quantization_verified` | Tri-state: `$true` confirmed from effective fields, `$false` requested-but-unverifiable (warning emitted), `$null` claim not made | Honest unknowns preserved |
| `lms_ps` | `lms ps --json` output captured verbatim | Provider-reported process telemetry; unverified |
| `gpu.*_load` | `nvidia-smi` CSV snapshot, retried 3x | First GPU only when several are reported; degraded telemetry yields `null` and `headroom_pass` fails closed |

## Structural conventions

- Phase names: `warmup` (excluded from summaries), `cold-<target>`,
  `reuse-<target>`, `append-<target>` per prompt target; suite targets are
  Quick=`1000`, OpenCode=`<OpenCodePromptTokens>`,
  Full=`1000,8000,<OpenCodePromptTokens>,32000`.
- `summaries[phase]` medians cover exactly one row set per phase name;
  `runs` is the row count.
- `incomplete=true` iff `run_error` is non-null; partial `per_run` rows remain
  in the document (partial-result persistence).
- Quality extraction modes: `go-tagged`, `untagged-fallback`, `none`;
  execution eligibility requires visible output plus a fenced block whose code
  declares `package retry`.
- `label` accepts `[a-zA-Z0-9._-]+` only; otherwise free-form.

## Known limitations

1. **Timestamps are wall-clock writes**, not content-derived identities.
   Nothing in schema-v3 is a stable identity; do not treat label+timestamp as
   reproducible provenance.
2. **No committed golden exists for the current 16-field document era**
   (`run_error`, `incomplete`) from a live run. The committed
   `tests/fixtures/schema-v3-current.golden.json` is a deterministic synthesis
   pinning shape; `schema-v3-historical.golden.json` is sanitized real
   evidence from the earlier 14-field era.
3. **Captured model content** (`reasoning`, `text` in quality-phase rows,
   `go_test_output`) is tool/model output. Committed goldens must have
   `reasoning`/`text` nulled; `go_test_output` is retained because it is
   deterministic output of the committed public Go fixture.
4. **Secrets**: the schema records no credentials, but `lms_ps` and catalog
   records may embed local filesystem paths depending on server build; review
   before exporting any real result.
5. **Single-GPU bias**: multi-GPU hosts silently record GPU 0 only (with a
   console warning that does not survive into the JSON).
6. **Effective-config verification is shallow**: only the seven checked keys
   are compared; extra or divergent unchecked engine settings pass silently.
7. **Timing resolution**: sub-millisecond values are rounded to 4 decimals;
   `decode_sec` floors at 0.001s; empty streams can produce sentinel minima.

## Test inventory split (T0 requirement)

Reusable measurement/evaluation logic (provider-neutral):
`tests/phases.Tests.ps1`, `tests/quality.Tests.ps1`,
`tests/schema.Tests.ps1`.

Provider-specific legacy lanes: `tests/gpu.Tests.ps1`,
`tests/lmsps.Tests.ps1`, `tests/mutation-inventory.Tests.ps1`
(engine-control proof + legacy banner enforcement).
