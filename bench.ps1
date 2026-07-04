<#
.SYNOPSIS
    Compatibility entry point for the authoritative Batmobile benchmark.
.DESCRIPTION
    Forwards all supported parameters to benchmark.ps1. The benchmark itself
    loads and verifies the requested LM Studio configuration before measuring.
#>

[CmdletBinding(PositionalBinding = $false)]
param(
    [Parameter(Mandatory = $true)][string] $Model,
    [Parameter(Mandatory = $true)][string] $Label,
    [ValidateSet('Quick', 'OpenCode', 'Full')][string] $Suite = 'OpenCode',
    [ValidateRange(4096, 262144)][int] $ContextLength = 65536,
    [ValidateRange(1, 8)][int] $Parallel = 1,
    [ValidateRange(128, 8192)][int] $EvalBatchSize = 2048,
    [ValidateRange(128, 2048)][int] $PhysicalBatchSize = 512,
    [ValidateRange(1, 128)][int] $NumExperts = 8,
    [ValidateRange(1, 20)][int] $Runs = 3,
    [ValidateRange(8, 8192)][int] $MaxTokens = 512,
    [ValidateRange(10, 300)][int] $TimeoutSec = 300,
    [ValidateRange(1000, 60000)][int] $OpenCodePromptTokens = 12700,
    [ValidateRange(0.0, 2.0)][double] $Temperature = 0.2,
    [ValidateSet('auto', 'none', 'low', 'medium', 'high')][string] $ReasoningEffort = 'none',
    [switch] $KvCacheGpu,
    [ValidateSet('f16', 'q8_0', 'q4_0')][string] $KvCacheQuantization = 'f16',
    [switch] $Mtp,
    [ValidateRange(1, 16)][int] $MtpDraftTokens = 3,
    [ValidateRange(0.0, 1.0)][double] $MtpMinContinueProbability = 0.75,
    [switch] $SkipLoad,
    [switch] $RunQuality,
    [ValidateRange(128, 8192)][int] $QualityMaxTokens = 2000,
    [string] $PromptFile = (Join-Path $PSScriptRoot 'coding_prompt.txt'),
    [string] $ApiRoot = 'http://192.168.0.112:1234',
    [string] $OutDir = (Join-Path $PSScriptRoot 'benchmark-results')
)

$ErrorActionPreference = 'Stop'
& (Join-Path $PSScriptRoot 'benchmark.ps1') @PSBoundParameters
