<#
.SYNOPSIS
    LEGACY MACHINE-LAB OPERATION — compatibility entry point for the
    authoritative bench-rig benchmark.
.DESCRIPTION
    LEGACY MACHINE-LAB OPERATION: forwards all supported parameters to
    benchmark.ps1, which unloads and loads LM Studio models. This mutates the
    local inference engine and is not part of the provider-agnostic Tonos path.
    Invoke deliberately.

    benchmark.ps1 remains the single source of truth for defaults and
    validation. The benchmark itself loads and verifies the requested LM Studio
    configuration before measuring.
#>

#requires -Version 7.0

[CmdletBinding(PositionalBinding = $false)]
param(
    [Parameter(Mandatory = $true)][string] $Model,
    [Parameter(Mandatory = $true)][string] $Label,
    [string] $Suite,
    [int] $ContextLength,
    [int] $Parallel,
    [int] $EvalBatchSize,
    [int] $PhysicalBatchSize,
    [int] $NumExperts,
    [int] $Runs,
    [int] $MaxTokens,
    [int] $TimeoutSec,
    [int] $LoadTimeoutSec,
    [int] $OpenCodePromptTokens,
    [double] $Temperature,
    [string] $ReasoningEffort,
    [switch] $KvCacheGpu,
    [string] $KvCacheQuantization,
    [switch] $Mtp,
    [int] $MtpDraftTokens,
    [double] $MtpMinContinueProbability,
    [switch] $SkipLoad,
    [switch] $RunQuality,
    [int] $QualityMaxTokens,
    [string] $PromptFile,
    [string] $ApiRoot,
    [string] $OutDir
)

$ErrorActionPreference = 'Stop'
& (Join-Path $PSScriptRoot 'benchmark.ps1') @PSBoundParameters
