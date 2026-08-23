#requires -Version 7.0
<#
.SYNOPSIS
    Reusable, provider-neutral measurement and evaluation logic extracted from
    benchmark.ps1 for characterization under T0.

.DESCRIPTION
    Everything here is pure or explicitly parameterized: no process, network,
    filesystem, or LM Studio access. benchmark.ps1 delegates to these helpers
    so future refactors can prove measurement semantics are preserved.
#>

Set-StrictMode -Version Latest

function Get-Median {
    param([AllowEmptyCollection()][object[]] $Values)
    $numbers = @($Values | Where-Object { $null -ne $_ } | Sort-Object)
    if ($numbers.Count -eq 0) { return $null }
    $mid = [int][Math]::Floor($numbers.Count / 2)
    if ($numbers.Count % 2) { return [double]$numbers[$mid] }
    ([double]$numbers[$mid - 1] + [double]$numbers[$mid]) / 2.0
}

function Convert-Usage {
    param($Usage)
    $promptTokens = [int](Get-RecordProp $Usage 'prompt_tokens' 0)
    $completionTokens = [int](Get-RecordProp $Usage 'completion_tokens' 0)
    $details = Get-RecordProp $Usage 'completion_tokens_details'
    $reasoningTokens = [int](Get-RecordProp $details 'reasoning_tokens' 0)
    [pscustomobject]@{ prompt = $promptTokens; completion = $completionTokens; reasoning = $reasoningTokens; text = [Math]::Max(0, $completionTokens - $reasoningTokens) }
}

function Get-PromptTargets {
    param(
        [Parameter(Mandatory)][ValidateSet('Quick', 'OpenCode', 'Full')][string] $Suite,
        [Parameter(Mandatory)][int] $OpenCodePromptTokens
    )
    switch ($Suite) {
        'Quick' { @(1000) }
        'OpenCode' { @($OpenCodePromptTokens) }
        'Full' { @(1000, 8000, $OpenCodePromptTokens, 32000) }
    }
}

function New-OpenCodeLikePrompt {
    param([int] $ApproxTokens, [string] $Nonce)
    $targetChars = [int]($ApproxTokens * 2.4)
    $builder = [Text.StringBuilder]::new($targetChars + 1000)
    [void]$builder.AppendLine("CACHE-BUSTER: ${Nonce}")
    [void]$builder.AppendLine('You are a coding agent. Inspect the repository, make minimal edits, run focused tests, and report exact evidence.')
    $i = 0
    while ($builder.Length -lt $targetChars) {
        [void]$builder.AppendLine(('tool_{0:D5}: function(path_{0:D5}: string, line_{0:D5}: integer, pattern_{0:D5}: string): Promise<{{status: "ok"|"error"; output: string}}>;') -f $i)
        $i++
    }
    [void]$builder.AppendLine('Task: inspect retry.go and identify one correctness risk. Answer in one sentence.')
    $builder.ToString()
}

function Get-PhaseSummary {
    param(
        [Parameter(Mandatory)][AllowEmptyCollection()][object[]] $Rows,
        [Parameter(Mandatory)][string] $Phase
    )
    $selected = @($Rows | Where-Object phase -eq $Phase)
    if ($selected.Count -eq 0) { return $null }
    [pscustomobject]@{
        runs = $selected.Count; prompt_tokens_median = Get-Median @($selected.prompt_tokens); ttft_sec_median = Get-Median @($selected.ttft_sec)
        estimated_prefill_median = Get-Median @($selected.estimated_prefill_tok_s); reasoning_tok_s_median = Get-Median @($selected.reasoning_tok_s)
        text_tok_s_median = Get-Median @($selected.text_tok_s); decode_tok_s_median = Get-Median @($selected.decode_tok_s); wall_sec_median = Get-Median @($selected.wall_sec)
    }
}

function Convert-QualityText {
    param(
        [Parameter(Mandatory)][bool] $VisibleOutput,
        [AllowNull()][string] $Text
    )
    $quality = [ordered]@{ visible_output = $VisibleOutput; extraction = 'none'; executable = $false; go_test_passed = $false; go_test_output = $null; code = $null }
    if (-not $VisibleOutput) { return $quality }
    $match = [regex]::Match($Text, '(?s)```go\s*(.*?)```')
    if ($match.Success) {
        $quality.extraction = 'go-tagged'
    } else {
        $match = [regex]::Match($Text, '(?s)```\s*(.*?)```')
        if (-not $match.Success) { return $quality }
        $quality.extraction = 'untagged-fallback'
    }
    $code = $match.Groups[1].Value
    if ($code -notmatch '(?m)^\s*package\s+retry\s*$') { return $quality }
    $quality.code = $code
    $quality
}

function Assert-EffectiveConfig {
    param(
        [AllowNull()] $Config,
        [Parameter(Mandatory)][System.Collections.IDictionary] $Requested,
        [Parameter(Mandatory)][bool] $KvCacheGpu,
        [Parameter(Mandatory)][ValidateSet('f16', 'q8_0', 'q4_0')][string] $KvCacheQuantization
    )
    $mismatches = [System.Collections.Generic.List[string]]::new()
    foreach ($entry in $Requested.GetEnumerator()) {
        $actual = if ($null -ne $Config) { Get-RecordProp $Config $entry.Key '__missing__' } else { '__missing__' }
        if ("$actual" -ne "$($entry.Value)") { $mismatches.Add("$($entry.Key): requested=$($entry.Value), effective=${actual}") }
    }
    if ($mismatches.Count -gt 0) { throw "LM Studio did not apply requested config: $($mismatches -join '; ')" }
    if (-not $KvCacheGpu -or $KvCacheQuantization -eq 'f16') { return $null }
    $kvKeys = @('kv_cache_quantization', 'llama_k_cache_quantization_type', 'llama_v_cache_quantization_type')
    $observed = @($kvKeys | ForEach-Object {
        $value = Get-RecordProp $Config $_
        if ($null -ne $value) { "${_}=${value}" }
    })
    $confirmed = $observed | Where-Object { ($_ -split '=', 2)[1] -ieq $KvCacheQuantization }
    if ($observed.Count -gt 0 -and -not $confirmed) {
        throw "KV cache quantization '${KvCacheQuantization}' was requested but effective config reports: $($observed -join ', ')."
    }
    if ($confirmed) { return $true }
    Write-Warning "KV cache quantization '${KvCacheQuantization}' could not be verified: the server reports no quantization fields in its effective config. Recorded as unverified."
    return $false
}

function Get-RecordProp {
    param([AllowNull()] $Object, [string] $Name, $Default = $null)
    if ($null -eq $Object) { return $Default }
    $property = $Object.PSObject.Properties[$Name]
    if ($null -eq $property -or $null -eq $property.Value) { return $Default }
    return $property.Value
}

function New-SchemaV3Document {
    param(
        [Parameter(Mandatory)][string] $Label,
        [Parameter(Mandatory)][string] $Timestamp,
        [Parameter(Mandatory)] $CatalogRecord,
        [Parameter(Mandatory)][ValidateSet('Quick', 'OpenCode', 'Full')][string] $Suite,
        [Parameter(Mandatory)][int] $Runs,
        [Parameter(Mandatory)][int] $MaxTokens,
        [Parameter(Mandatory)][int] $TimeoutSec,
        [Parameter(Mandatory)][int] $OpenCodePromptTokens,
        [Parameter(Mandatory)][double] $Temperature,
        [Parameter(Mandatory)][string] $ReasoningEffort,
        [Parameter(Mandatory)][int] $ContextLength,
        [Parameter(Mandatory)][int] $Parallel,
        [Parameter(Mandatory)][int] $EvalBatchSize,
        [Parameter(Mandatory)][int] $PhysicalBatchSize,
        [Parameter(Mandatory)][bool] $KvCacheGpu,
        [Parameter(Mandatory)][string] $KvCacheQuantization,
        [Parameter(Mandatory)][int] $NumExperts,
        [Parameter(Mandatory)][bool] $Mtp,
        [Parameter(Mandatory)][int] $MtpDraftTokens,
        [AllowNull()] $EffectiveConfig,
        [AllowNull()] $LoadResponse,
        [AllowNull()] $GpuBefore,
        [AllowNull()] $GpuAfterLoad,
        [AllowNull()] $GpuAfterBenchmark,
        [Parameter(Mandatory)][bool] $HeadroomPass,
        [AllowNull()] $KvQuantizationVerified,
        [AllowNull()] $LmsPs,
        [AllowNull()] $Summaries,
        [AllowNull()] $Quality,
        [AllowEmptyCollection()][object[]] $NativePerRun = @(),
        [AllowEmptyCollection()][object[]] $PerRun = @(),
        [AllowNull()] $RunError
    )
    [ordered]@{
        schema_version = 3; timestamp = $Timestamp; label = $Label
        model = [ordered]@{ key = $CatalogRecord.key; display_name = $CatalogRecord.display_name; architecture = $CatalogRecord.architecture; quantization = $CatalogRecord.quantization; size_bytes = $CatalogRecord.size_bytes; params_string = $CatalogRecord.params_string; max_context_length = $CatalogRecord.max_context_length }
        benchmark = [ordered]@{ suite = $Suite; runs = $Runs; max_tokens = $MaxTokens; timeout_sec = $TimeoutSec; open_code_prompt_target = $OpenCodePromptTokens; temperature = $Temperature; reasoning_effort = $ReasoningEffort }
        requested_config = [ordered]@{ context_length = $ContextLength; parallel = $Parallel; eval_batch_size = $EvalBatchSize; physical_batch_size = $PhysicalBatchSize; flash_attention = $true; offload_kv_cache_to_gpu = $KvCacheGpu; kv_cache_quantization = $KvCacheQuantization; num_experts = $NumExperts; speculative_draft_mtp = $Mtp; mtp_draft_tokens = $MtpDraftTokens }
        effective_config = $EffectiveConfig; load_response = $LoadResponse
        gpu = [ordered]@{ before_load = $GpuBefore; after_load = $GpuAfterLoad; after_benchmark = $GpuAfterBenchmark; headroom_floor_mib = 1536; headroom_pass = $HeadroomPass; kv_quantization_verified = $KvQuantizationVerified }
        lms_ps = $LmsPs; summaries = $Summaries; quality = $Quality; native_per_run = @($NativePerRun); per_run = @($PerRun)
        run_error = $RunError; incomplete = ($null -ne $RunError)
    }
}
