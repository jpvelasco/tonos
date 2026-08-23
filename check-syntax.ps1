$ErrorActionPreference = 'Stop'
$failed = $false

foreach ($path in Get-ChildItem -LiteralPath (Join-Path $PSScriptRoot 'legacy\lmstudio') -Filter '*.ps1' -File | Sort-Object Name) {
    $file = $path.Name
    $tokens = $null
    $errors = $null
    [void][System.Management.Automation.Language.Parser]::ParseFile(
        $path.FullName,
        [ref]$tokens,
        [ref]$errors
    )
    if ($errors.Count -eq 0) {
        Write-Host ('PASS ' + $file) -ForegroundColor Green
    } else {
        $failed = $true
        Write-Host ('FAIL ' + $file) -ForegroundColor Red
        $errors | ForEach-Object { Write-Host ('  ' + $_.Message) -ForegroundColor Red }
    }
}

if (Get-Command node -ErrorAction SilentlyContinue) {
    & node --check (Join-Path $PSScriptRoot 'legacy\lmstudio\load-model.mjs')
    if ($LASTEXITCODE -eq 0) {
        Write-Host 'PASS load-model.mjs' -ForegroundColor Green
    } else {
        $failed = $true
        Write-Host 'FAIL load-model.mjs' -ForegroundColor Red
    }
} else {
    Write-Warning 'Node.js is unavailable; load-model.mjs was not checked.'
}

if ($failed) { exit 1 }

