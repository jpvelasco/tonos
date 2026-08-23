<#
.SYNOPSIS
    LEGACY MACHINE-LAB OPERATION — run a short OpenAI-compatible smoke test
    against the currently loaded model.

.DESCRIPTION
    LEGACY MACHINE-LAB OPERATION: request-only (it never loads or unloads), but
    it belongs to the bench-rig legacy lane, not the provider-agnostic Tonos
    path. Invoke deliberately.
#>

[CmdletBinding()]
param(
    [string] $Model = 'google/gemma-4-12b-qat',
    [string] $ApiRoot = 'http://127.0.0.1:1234',
    [ValidateRange(1, 256)][int] $MaxTokens = 32
)

$ErrorActionPreference = 'Stop'
$body = @{
    model = $Model
    messages = @(@{ role = 'user'; content = 'Reply with exactly: bench-rig ready' })
    temperature = 0.1
    max_tokens = $MaxTokens
    stream = $false
} | ConvertTo-Json -Depth 10 -Compress

$clock = [Diagnostics.Stopwatch]::StartNew()
$response = Invoke-RestMethod -Uri "$($ApiRoot.TrimEnd('/'))/v1/chat/completions" -Method Post `
    -Body $body -ContentType 'application/json' -TimeoutSec 60
$clock.Stop()
$message = [string]$response.choices[0].message.content

[PSCustomObject]@{
    model = $response.model
    wall_sec = [math]::Round($clock.Elapsed.TotalSeconds, 3)
    prompt_tokens = $response.usage.prompt_tokens
    completion_tokens = $response.usage.completion_tokens
    output = $message
} | Format-List
