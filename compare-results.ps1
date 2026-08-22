<#
.SYNOPSIS
    Compare schema-v3 Batmobile benchmark results.
.DESCRIPTION
    Reports native LM Studio generation speed, OpenCode-size cold and cached
    TTFT, hidden-reasoning share, coding quality, and post-run VRAM headroom.
    Tiny streamed probe completions are intentionally not used as decode-speed
    measurements because transport buffering makes them misleading.
#>

[CmdletBinding()]
param(
    [string] $ResultsDir = (Join-Path $PSScriptRoot 'benchmark-results'),
    [ValidateSet('table', 'json', 'csv')][string] $Format = 'table',
    [string] $Label = '*'
)

$ErrorActionPreference = 'Stop'

function Get-Median {
    param([object[]] $Values)
    $numbers = @($Values | Where-Object { $null -ne $_ } | ForEach-Object { [double] $_ } | Sort-Object)
    if ($numbers.Count -eq 0) { return $null }
    $middle = [math]::Floor($numbers.Count / 2)
    if ($numbers.Count % 2) { return $numbers[$middle] }
    return ($numbers[$middle - 1] + $numbers[$middle]) / 2
}

function Get-RoundedMedian {
    param([object[]] $Values)
    $median = Get-Median $Values
    if ($null -eq $median) { return $null }
    return [math]::Round([double]$median, 3)
}

if (-not (Test-Path -LiteralPath $ResultsDir)) {
    throw "Results directory not found: ${ResultsDir}"
}

$rows = foreach ($file in Get-ChildItem -LiteralPath $ResultsDir -Filter '*.json' | Sort-Object LastWriteTime) {
    try {
        $result = Get-Content -LiteralPath ${file}.FullName -Raw -Encoding utf8 | ConvertFrom-Json
        if ([int]$result.schema_version -ne 3 -or $result.label -notlike $Label) { continue }

        $native = @($result.native_per_run | Where-Object {
            $_.success -and ($_.phase -eq 'native-decode-off' -or $_.phase -eq 'native-decode-auto')
        }) | Select-Object -First 1
        if (-not $native) {
            $native = @($result.native_per_run | Where-Object { $_.success }) | Select-Object -First 1
        }

        $promptTarget = [int]$result.benchmark.open_code_prompt_target
        $cold = @($result.per_run | Where-Object { $_.phase -eq "cold-${promptTarget}" -and $_.success })
        $reuse = @($result.per_run | Where-Object { $_.phase -eq "reuse-${promptTarget}" -and $_.success })
        $qualityRun = @($result.per_run | Where-Object { $_.phase -eq 'coding-quality' -and $_.success }) | Select-Object -Last 1

        $reasonPct = $null
        if ($native -and [double]$native.output_tokens -gt 0) {
            $reasonPct = 100 * [double]$native.reasoning_tokens / [double]$native.output_tokens
        }

        $quality = if ($result.quality.go_test_passed) {
            'PASS'
        } elseif ($result.quality.executable) {
            'EXEC'
        } elseif ($result.quality.visible_output) {
            'VISIBLE'
        } elseif ($result.quality) {
            'FAIL'
        } else {
            'N/A'
        }

        [PSCustomObject][ordered]@{
            Label = [string]$result.label
            Model = [string]$result.model.key
            Quant = [string]$result.model.quantization.name
            ContextK = [math]::Round([double]$result.effective_config.context_length / 1024, 0)
            GPUKV = [bool]$result.effective_config.offload_kv_cache_to_gpu
            MTP = [bool]$result.effective_config.speculative_draft_mtp
            Batch = "$($result.effective_config.eval_batch_size)/$($result.effective_config.physical_batch_size)"
            PromptTarget = $promptTarget
            ColdTTFT = Get-RoundedMedian $cold.ttft_sec
            ReuseTTFT = Get-RoundedMedian $reuse.ttft_sec
            NativeTokS = if ($native) { [math]::Round([double]$native.authoritative_output_tok_s, 2) } else { $null }
            CodingTokS = if ($qualityRun) { [math]::Round([double]$qualityRun.text_tok_s, 2) } else { $null }
            ReasonPct = if ($null -ne $reasonPct) { [math]::Round($reasonPct, 1) } else { $null }
            Quality = $quality
            FreeVRAMMiB = if ($result.gpu.after_benchmark -and $null -ne $result.gpu.after_benchmark.memory_free_mib) { [int]$result.gpu.after_benchmark.memory_free_mib } else { $null }
            Timestamp = [datetime]$result.timestamp
            File = ${file}.Name
        }
    } catch {
        Write-Warning "Skipping $(${file}.Name): $(${_}.Exception.Message)"
    }
}

$rows = @($rows | Sort-Object @{ Expression = {
    if ($_.Quality -eq 'PASS') { $_.CodingTokS } else { $_.NativeTokS }
}; Descending = $true })

if ($rows.Count -eq 0) {
    Write-Host "No schema-v3 results matched '${Label}' in ${ResultsDir}."
    exit 0
}

switch ($Format) {
    'json' { $rows | ConvertTo-Json -Depth 4 }
    'csv' { $rows | ConvertTo-Csv -NoTypeInformation }
    'table' {
        $rows | Format-Table Label, Quant, ContextK, GPUKV, MTP, Batch, PromptTarget, ColdTTFT,
            ReuseTTFT, NativeTokS, CodingTokS, ReasonPct, Quality, FreeVRAMMiB -AutoSize
        Write-Host 'NativeTokS comes from LM Studio native stats; coding quality requires executable Go and passing tests.' -ForegroundColor DarkGray
    }
}
