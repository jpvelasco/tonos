<#
.SYNOPSIS
    Manage LM Studio models — list, load, unload via localhost API.
.DESCRIPTION
    Helper for the Batmobile dojo. Works with LM Studio's local server.
    Note: LM Studio's local API doesn't expose load/unload endpoints directly.
    This script works with LM Studio's model management via the UI or file-based approach.
.PARAMETER Action
    list - Show models currently loaded in LM Studio
    info - Show model details from models/ directory
    unload - Signal to unload current model (opens LM Studio UI hint)
.PARAMETER ApiUrl
    LM Studio API base URL. Defaults to http://localhost:1234/v1.
.EXAMPLE
    .\model-manager.ps1 -Action list
    .\model-manager.ps1 -Action info
    .\model-manager.ps1 -Action unload
#>

[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('list', 'info', 'unload', 'status')]
    [string]$Action,

    [string]$ApiUrl = "http://localhost:1234/v1"
)

$ErrorActionPreference = "Stop"

switch ($Action) {
    'list' {
        Write-Host "`n📋 Models loaded in LM Studio:" -ForegroundColor Cyan
        try {
            $Models = Invoke-RestMethod -Uri "$ApiUrl/models" -Method Get -TimeoutSec 10 -UseBasicParsing
            if ($Models.data.Count -eq 0) {
                Write-Host "  (no models loaded)" -ForegroundColor DarkGray
            } else {
                foreach ($m in $Models.data) {
                    Write-Host "  • $($m.id)" -ForegroundColor White
                }
            }
        } catch {
            Write-Error "Could not connect to LM Studio at $ApiUrl`n$_"
        }
    }

    'info' {
        Write-Host "`n📦 Local GGUF models (F:\.lmstudio\models):" -ForegroundColor Cyan
        $ModelsDir = "F:\.lmstudio\models"
        if (Test-Path $ModelsDir) {
            $Files = Get-ChildItem -Path $ModelsDir -Recurse -Filter "*.gguf" -ErrorAction SilentlyContinue | Where-Object { $_.Length -gt 1GB }
            if ($Files) {
                foreach ($f in $Files) {
                    $SizeGB = [math]::Round($f.Length / 1GB, 2)
                    $Repo = "$($f.Directory.Parent.Name)/$($f.Directory.Name)"
                    Write-Host "  • $Repo/$($f.Name)  (${SizeGB} GB)" -ForegroundColor White
                }
            } else {
                Write-Host "  (no GGUF files found)" -ForegroundColor DarkGray
            }
        } else {
            Write-Host "  models/ directory not found at $ModelsDir" -ForegroundColor DarkGray
        }
    }

    'status' {
        Write-Host "`n🔍 LM Studio API status:" -ForegroundColor Cyan
        try {
            $r = Invoke-WebRequest -Uri "$ApiUrl/models" -Method Get -TimeoutSec 5 -UseBasicParsing
            Write-Host "  ✓ API responding ($($r.StatusCode))" -ForegroundColor Green
            $Models = $r.Content | ConvertFrom-Json
            Write-Host "  Models loaded: $($Models.data.Count)" -ForegroundColor White
            foreach ($m in $Models.data) {
                Write-Host "    • $($m.id)" -ForegroundColor White
            }
        } catch {
            Write-Host "  ✗ API not responding — is LM Studio running?" -ForegroundColor Red
            Write-Host "    $_" -ForegroundColor DarkGray
        }
    }

    'unload' {
        Write-Host "`n⚠️  LM Studio doesn't expose a programmatic unload endpoint." -ForegroundColor Yellow
        Write-Host "   To unload a model:" -ForegroundColor White
        Write-Host "   1. Open LM Studio UI" -ForegroundColor DarkGray
        Write-Host "   2. Go to the 'My Models' / 'Load' section" -ForegroundColor DarkGray
        Write-Host "   3. Click 'Unload' on the current model" -ForegroundColor DarkGray
        Write-Host "   4. Load the next model you want to test" -ForegroundColor DarkGray
        Write-Host "" -ForegroundColor DarkGray
        Write-Host "   Alternatively, restart the LM Studio Local Server." -ForegroundColor DarkGray
    }
}