# Bench Coder Tuner - Clean PS7 Version
$PromptFile = "nyxtest_prompt.txt"
$TestPrompt = @"
nyx (github.com/<owner>/nyx) is a Go CLI for declarative homelab network validation and drift detection. You declare networks, VPNs, policies, and assertions in YAML; it runs live checks (primarily via nmap + platform system commands, plus Omada SDN and OPNsense integration) and produces normalized, structured results.

Perform a structured code review and architecture assessment:
1. Overall project structure and purpose
2. Key strengths
3. Areas for improvement (architecture, code quality, DX, performance)
4. Specific actionable recommendations (with file paths if possible)
5. Any obvious bugs or risks
Be concise, decisive, and avoid repetitive planning. Give me your best analysis in one coherent response.
"@

$TestPrompt | Out-File -FilePath $PromptFile -Encoding utf8 -Force

$LogFile = "coder-tuning-$(Get-Date -Format 'yyyyMMdd-HHmm').log"
$Results = @()

$Combinations = @(
    @{Temp=0.60; Presence=0.55; Freq=1.40},
    @{Temp=0.58; Presence=0.55; Freq=1.45},
    @{Temp=0.60; Presence=0.50; Freq=1.35},
    @{Temp=0.62; Presence=0.60; Freq=1.40}
)

Write-Host "🚀 Bench Coder Tuner (PS7)" -ForegroundColor Cyan

foreach ($p in $Combinations) {
    Write-Host "
=== Temp=$($p.Temp) Presence=$($p.Presence) Freq=$($p.Freq) ===" -ForegroundColor Yellow

    $Start = Get-Date
    $Output = & timeout 480 grok --model qwopus-coder $TestPrompt 2>&1
    $End = Get-Date
    $Duration = [math]::Round(($End - $Start).TotalSeconds, 1)

    $ToolCalls = ($Output | Select-String -Pattern "→Read|✓Explore|✱Glob|Subagent" -AllMatches).Matches.Count
    if ($ToolCalls -eq 0) { $ToolCalls = "unknown" }

    $row = [PSCustomObject]@{
        Temp      = $p.Temp
        Presence  = $p.Presence
        Freq      = $p.Freq
        Duration  = $Duration
        ToolCalls = $ToolCalls
        Status    = if ($Duration -ge 480) { "TIMEOUT" } else { "OK" }
    }
    $row | Format-Table -AutoSize
    $row | Out-File -FilePath $LogFile -Append
}

Write-Host "
✅ Tuning complete. Check $LogFile" -ForegroundColor Green
