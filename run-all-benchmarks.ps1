<#
.SYNOPSIS
    Run controlled Batmobile benchmarks with verified per-model settings.
.DESCRIPTION
    Uses benchmark.ps1 for loading, warming, streaming measurements, quality
    validation, GPU telemetry, and hard timeouts. Only one model is loaded at
    a time. The installed models deliberately use model-specific fit settings;
    comparisons within a model should change one tuning variable at a time.
#>

[CmdletBinding()]
param(
    [ValidateSet('All', 'Gemma', 'QwenBase', 'QwenMtp')]
    [string] $Selection = 'All',
    [int] $Runs = 3,
    [int] $MaxTokens = 512,
    [int] $TimeoutSec = 300,
    [switch] $SkipQuality,
    [string] $ApiRoot = 'http://192.168.0.112:1234'
)

$ErrorActionPreference = 'Stop'
$benchmark = Join-Path $PSScriptRoot 'benchmark.ps1'

$models = @(
    [ordered]@{
        Selection = 'Gemma'
        Model = 'google/gemma-4-12b-qat'
        Label = 'gemma4-12b-q4-65k-gpukv'
        ContextLength = 65536
        Parallel = 1
        EvalBatchSize = 8192
        PhysicalBatchSize = 2048
        ReasoningEffort = 'none'
        KvCacheGpu = $true
        Mtp = $false
    },
    [ordered]@{
        Selection = 'QwenBase'
        Model = 'qwen3.6-35b-a3b'
        Label = 'qwen36-35b-q3-65k'
        ContextLength = 65536
        Parallel = 1
        EvalBatchSize = 2048
        PhysicalBatchSize = 512
        ReasoningEffort = 'auto'
        KvCacheGpu = $false
        Mtp = $false
    },
    [ordered]@{
        Selection = 'QwenMtp'
        Model = 'qwen3.6-35b-a3b-mtp'
        Label = 'qwen36-35b-iq3-65k-mtp'
        ContextLength = 65536
        Parallel = 1
        EvalBatchSize = 2048
        PhysicalBatchSize = 512
        ReasoningEffort = 'auto'
        KvCacheGpu = $false
        Mtp = $true
    }
)

$selected = @($models | Where-Object {
    $Selection -eq 'All' -or ${_}.Selection -eq $Selection
})

if ($selected.Count -eq 0) {
    throw "No model selected for '${Selection}'."
}

foreach ($model in $selected) {
    Write-Host ''
    Write-Host ('=' * 72) -ForegroundColor Cyan
    Write-Host "Benchmarking $(${model}.Label)" -ForegroundColor Cyan
    Write-Host ('=' * 72) -ForegroundColor Cyan

    $arguments = @{
        Model = ${model}.Model
        Label = ${model}.Label
        Suite = 'OpenCode'
        ContextLength = ${model}.ContextLength
        Parallel = ${model}.Parallel
        EvalBatchSize = ${model}.EvalBatchSize
        PhysicalBatchSize = ${model}.PhysicalBatchSize
        Runs = $Runs
        MaxTokens = $MaxTokens
        TimeoutSec = $TimeoutSec
        OpenCodePromptTokens = 12700
        Temperature = 0.2
        ReasoningEffort = ${model}.ReasoningEffort
        ApiRoot = $ApiRoot
    }

    if (${model}.KvCacheGpu) { $arguments.KvCacheGpu = $true }
    if (${model}.Mtp) { $arguments.Mtp = $true }
    if (-not $SkipQuality) {
        $arguments.RunQuality = $true
        $arguments.QualityMaxTokens = 2000
    }

    & $benchmark @arguments

}

Write-Host ''
Write-Host 'Benchmark run complete. Use .\compare-results.ps1 for the authoritative table.' -ForegroundColor Green
