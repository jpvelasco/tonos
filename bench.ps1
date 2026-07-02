<#
.SYNOPSIS
    Batmobile benchmark script — tests local LLM models via LM Studio API.
.DESCRIPTION
    Runs structured test prompts against a model loaded in LM Studio (localhost:1234),
    capturing tokens/sec, latency, and output quality metrics.
    One model at a time — caller is responsible for loading/unloading in LM Studio.
.PARAMETER ModelName
    Human-readable model name (for result labels).
.PARAMETER PromptFile
    Path to the test prompt file. Defaults to nyxtest_prompt.txt.
.PARAMETER ApiUrl
    LM Studio API base URL. Defaults to http://localhost:1234/v1.
.PARAMETER ModelId
    The model ID as known to LM Studio. If omitted, uses the currently active model.
.PARAMETER TimeoutSec
    Max seconds to wait for completion. Defaults to 600 (10 min).
.EXAMPLE
    .\bench.ps1 -ModelName "Qwen3.6-35B-A3B-Q3_K_M"
    .\bench.ps1 -ModelName "Qwen3.6-27B-Q4_K_S" -PromptFile my_prompt.txt
#>

[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$ModelName,

    [string]$PromptFile = "nyxtest_prompt.txt",

    [string]$ApiUrl = "http://localhost:1234/v1",

    [string]$ModelId,

    [int]$TimeoutSec = 600
)

$ErrorActionPreference = "Stop"

# --- Read prompt ---
if (-not (Test-Path $PromptFile)) {
    Write-Error "Prompt file not found: $PromptFile"
    exit 1
}
$Prompt = Get-Content $PromptFile -Raw -Encoding utf8

# --- Detect current model if ModelId not provided ---
if (-not $ModelId) {
    try {
        $Models = Invoke-RestMethod -Uri "$ApiUrl/models" -Method Get -TimeoutSec 10
        $ModelId = $Models.data[0].id
        Write-Host "Using active model: $ModelId" -ForegroundColor DarkGray
    } catch {
        Write-Error "Could not fetch model list from LM Studio. Is it running? ($ApiUrl)"
        exit 1
    }
}

# --- Result directory ---
$ResultsDir = "results"
if (-not (Test-Path $ResultsDir)) { New-Item -ItemType Directory -Path $ResultsDir -Force | Out-Null }

$Timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$ResultFile = Join-Path $ResultsDir "$Timestamp-${ModelName}.json"

# --- Run benchmark ---
Write-Host "`n🚀 Benchmarking: $ModelName ($ModelId)" -ForegroundColor Cyan
Write-Host "   Prompt: $PromptFile" -ForegroundColor DarkGray
Write-Host "   API:    $ApiUrl" -ForegroundColor DarkGray
Write-Host "   Timeout: ${TimeoutSec}s`n" -ForegroundColor DarkGray

$Start = Get-Date

try {
    $body = @{
        model       = $ModelId
        temperature = 0.6
        max_tokens  = 4096
        messages    = @( @{ role = 'user'; content = $Prompt } )
    } | ConvertTo-Json -Depth 10

    $response = Invoke-WebRequest -Uri "$ApiUrl/chat/completions" -Method Post `
        -Body $body -ContentType "application/json" -TimeoutSec $TimeoutSec -UseBasicParsing

    # Non-streaming fallback
    $result = $response.Content | ConvertFrom-Json
    $End = Get-Date
    $Duration = [math]::Round(($End - $Start).TotalSeconds, 2)
    $Output = $result.choices[0].message.content
    $PromptTokens = $result.usage.prompt_tokens
    $CompletionTokens = $result.usage.completion_tokens
    $TotalTokens = $result.usage.total_tokens
    $Tps = if ($Duration -gt 0) { [math]::Round($CompletionTokens / $Duration, 2) } else { 0 }

} catch {
    Write-Error "Request failed: $($_.Exception.Message)"
    exit 1
}

# --- Quality heuristics ---
$hasStructure = $Output -match '\d+\.' -or $Output -match '##' -or $Output -match '\|'
$hasRecommendations = $Output -match 'recommend|suggest|improve|fix|consider' -caseinsensitive
$hasSpecificity = $Output -match '\w+\.\w+|line \d+|function|class|import' -caseinsensitive
$lengthScore = [Math]::Min($CompletionTokens / 1000, 1.0)  # normalize to 0-1

$QualityScore = [math]::Round((
    ($hasStructure ? 0.25 : 0) +
    ($hasRecommendations ? 0.25 : 0) +
    ($hasSpecificity ? 0.25 : 0) +
    ($lengthScore * 0.25)
) * 100, 0)

# --- Build result ---
$result = [PSCustomObject]@{
    Timestamp      = $Timestamp
    ModelName      = $ModelName
    ModelId        = $ModelId
    PromptFile     = $PromptFile
    ApiUrl         = $ApiUrl
    # Performance
    DurationSec    = $Duration
    PromptTokens   = $PromptTokens
    CompletionTokens = $CompletionTokens
    TotalTokens    = $TotalTokens
    TokensPerSec   = $Tps
    # Quality (heuristic 0-100)
    QualityScore   = $QualityScore
    HasStructure   = $hasStructure
    HasRecommendations = $hasRecommendations
    HasSpecificity = $hasSpecificity
    # Output (truncated for readability)
    OutputPreview  = $Output.Substring(0, [Math]::Min(500, $Output.Length))
    OutputLength   = $Output.Length
}

# Save full output separately
$outputFile = Join-Path $ResultsDir "$Timestamp-${ModelName}-output.txt"
$Output | Out-File -FilePath $outputFile -Encoding utf8

# Save structured result
$result | ConvertTo-Json -Depth 3 | Out-File -FilePath $ResultFile -Encoding utf8

# --- Display summary ---
Write-Host "`n✅ Benchmark complete: $ModelName" -ForegroundColor Green
Write-Host ("─" * 60)
Write-Host "  Duration:        $($Duration)s"
Write-Host "  Prompt tokens:   $PromptTokens"
Write-Host "  Output tokens:   $CompletionTokens"
Write-Host "  Tokens/sec:      $Tps"
Write-Host "  Quality score:   ${QualityScore}/100"
Write-Host "  Structure:       $hasStructure"
Write-Host "  Recommendations: $hasRecommendations"
Write-Host "  Specificity:     $hasSpecificity"
Write-Host ("─" * 60)
Write-Host "  Results: $ResultFile" -ForegroundColor DarkGray
Write-Host "  Output:  $outputFile" -ForegroundColor DarkGray