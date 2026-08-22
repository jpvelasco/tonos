<#
.SYNOPSIS
    Inspect or unload models on the Batmobile LM Studio server.
#>

[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('catalog', 'loaded', 'status', 'unload')]
    [string] $Action,
    [string] $ApiRoot = 'http://192.168.0.112:1234'
)

$ErrorActionPreference = 'Stop'
$ApiRoot = $ApiRoot.TrimEnd('/')
. (Join-Path $PSScriptRoot 'harness-lib.ps1')

function Get-Catalog {
    Invoke-RestMethod -Method Get -Uri "${ApiRoot}/api/v1/models" -TimeoutSec 30
}

switch ($Action) {
    'catalog' {
        (Get-Catalog).models | Select-Object key, type, display_name, params_string,
            max_context_length, @{Name='quant';Expression={$_.quantization.name}},
            @{Name='loaded';Expression={@($_.loaded_instances).Count -gt 0}} |
            Format-Table -AutoSize
    }
    'loaded' {
        $instances = @((Get-Catalog).models | Where-Object type -eq 'llm' | ForEach-Object { $_.loaded_instances })
        if ($instances.Count -eq 0) { Write-Host 'No LLM is loaded.'; break }
        $instances | Select-Object id, status,
            @{Name='context_length';Expression={$_.config.context_length}},
            @{Name='parallel';Expression={$_.config.parallel}},
            config | Format-List
        & lms ps
    }
    'status' {
        $catalog = Get-Catalog
        Write-Host "LM Studio is responding at ${ApiRoot}." -ForegroundColor Green
        Get-StatusRows -Models @($catalog.models) | Format-Table -AutoSize
    }
    'unload' {
        $instances = @((Get-Catalog).models | Where-Object type -eq 'llm' | ForEach-Object { $_.loaded_instances })
        foreach ($instance in $instances) {
            $body = @{ instance_id = $instance.id } | ConvertTo-Json -Compress
            Invoke-RestMethod -Method Post -Uri "${ApiRoot}/api/v1/models/unload" `
                -ContentType 'application/json' -Body $body -TimeoutSec 120 | Out-Null
            Write-Host "Unloaded $($instance.id)." -ForegroundColor Green
        }
        if ($instances.Count -eq 0) { Write-Host 'No LLM was loaded.' }
    }
}
