#requires -Version 7.0
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

. (Join-Path $PSScriptRoot '_assertions.ps1')
. (Join-Path $PSScriptRoot '..\legacy\lmstudio\harness-lib.ps1')
. (Join-Path $PSScriptRoot '..\legacy\lmstudio\measurement-lib.ps1')

Get-ChildItem -LiteralPath $PSScriptRoot -Filter '*.Tests.ps1' -File | Sort-Object Name | ForEach-Object {
    Write-Host ''
    Write-Host "-- $($_.Name)" -ForegroundColor Cyan
    . $_.FullName
}

Write-Host ''
Write-Host "$($script:PassCount) passed, $($script:FailCount) failed"
if ($script:FailCount -gt 0) { exit 1 }

