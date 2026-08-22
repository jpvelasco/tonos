#requires -Version 7.0
Set-StrictMode -Version Latest

function Get-LmsPsSnapshot {
    param([scriptblock] $FetchCommand = { & lms ps --json 2>&1 | Out-String })
    $raw = & $FetchCommand
    if ($LASTEXITCODE -ne 0) { return $null }
    $joined = ($raw | Out-String).Trim()
    if (-not $joined) { return $null }
    try {
        $parsed = @($joined | ConvertFrom-Json -ErrorAction Stop)
    } catch {
        return $null
    }
    if ($parsed.Count -eq 0) { return $null }
    return ,$parsed
}

function Convert-MiBValue {
    param([AllowNull()][string] $Text)
    if ($null -eq $Text) { return $null }
    $parsed = 0
    if ([int]::TryParse($Text.Trim().Trim('[', ']'), [ref]$parsed)) { return $parsed }
    return $null
}

function Get-GpuSnapshot {
    param(
        [int] $Attempts = 3,
        [int] $RetryMs = 400,
        [scriptblock] $NvidiaSmiCommand = { & nvidia-smi --query-gpu=name,memory.total,memory.used,memory.free,utilization.gpu,pstate --format=csv,noheader,nounits 2>$null }
    )
    for ($attempt = 1; $attempt -le $Attempts; $attempt++) {
        $raw = & $NvidiaSmiCommand
        if ($LASTEXITCODE -eq 0 -and $raw) {
            $lines = @($raw)
            if ($lines.Count -gt 1) { Write-Warning "nvidia-smi reported $($lines.Count) GPUs; capturing the first only." }
            $parts = @($lines[0] -split ',' | ForEach-Object { $_.Trim() })
            if ($parts.Count -ge 6) {
                return [pscustomobject]@{
                    name=$parts[0]; memory_total_mib=(Convert-MiBValue $parts[1]); memory_used_mib=(Convert-MiBValue $parts[2])
                    memory_free_mib=(Convert-MiBValue $parts[3]); utilization_pct=(Convert-MiBValue $parts[4]); pstate=$parts[5]
                    captured_at=(Get-Date).ToString('o')
                }
            }
            Write-Warning 'Unexpected nvidia-smi output; GPU snapshot skipped.'
        }
        if ($attempt -lt $Attempts) { Start-Sleep -Milliseconds $RetryMs }
    }
    return $null
}

function Get-StatusRows {
    param([AllowEmptyCollection()][object[]] $Models)
    @($Models | ForEach-Object {
        [pscustomobject]@{
            Key = $_.key
            Type = $_.type
            Loaded = (@($_.loaded_instances).Count -gt 0)
            DisplayName = $_.display_name
        }
    })
}
