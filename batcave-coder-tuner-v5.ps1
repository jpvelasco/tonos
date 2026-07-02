$PromptFile = "nyxtest_prompt.txt"
$TestPrompt = @"
You are reviewing the nyx repository (cloned locally).
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

$Combinations = @(
    @{Temp=0.60; Presence=0.5; Repeat=1.25},
    @{Temp=0.65; Presence=0.6; Repeat=1.30},
    @{Temp=0.68; Presence=0.7; Repeat=1.35},
    @{Temp=0.72; Presence=0.5; Repeat=1.28}
)

Write-Host "🚀 Batcave Coder Tuner v5 (PS 5.1 Safe)" -ForegroundColor Cyan

foreach ($p in $Combinations) {
    Write-Host "`n=== Temp=$($p.Temp) Presence=$($p.Presence) Repeat=$($p.Repeat) ===" -ForegroundColor Yellow | Tee-Object -FilePath $LogFile -Append
    
    $Start = Get-Date
    try {
        $Output = & grok $TestPrompt 2>&1
        $Status = "Completed"
    } catch {
        $Output = $_.Exception.Message
        $Status = "Failed"
    }
    $End = Get-Date
    $Duration = [math]::Round(($End - $Start).TotalSeconds, 1)
    
    $ToolCalls = ($Output | Select-String -Pattern "→Read|✓Explore|✱Glob" -AllMatches).Matches.Count
    if ($ToolCalls -eq 0) { $ToolCalls = "unknown" }
    
    $row = [PSCustomObject]@{
        Temp       = $p.Temp
        Presence   = $p.Presence
        Repeat     = $p.Repeat
        TimeSec    = $Duration
        ToolCalls  = $ToolCalls
        Status     = $Status
    }
    $row | Format-Table -AutoSize | Tee-Object -FilePath $LogFile -Append
}

Write-Host "`n✅ Tuner v5 finished. Check $LogFile" -ForegroundColor Green
