#requires -Version 7.0
Set-StrictMode -Version Latest

$script:LifecyclePatterns = @('api/v1/models/load', 'api/v1/models/unload')
$script:MjsLoader = 'load-model.mjs'

function Get-ScriptText {
    param([Parameter(Mandatory)][string] $FileName)
    Get-Content -LiteralPath (Join-Path $PSScriptRoot "..\legacy\lmstudio\$FileName") -Raw
}

function Get-LifecycleHits {
    param([Parameter(Mandatory)][string] $FileName)
    $text = Get-ScriptText -FileName $FileName
    $hits = @()
    foreach ($pattern in $script:LifecyclePatterns) {
        if ($text -match [regex]::Escape($pattern)) { $hits += $pattern }
    }
    if ($FileName -ne $script:MjsLoader -and $text -match [regex]::Escape($script:MjsLoader) -and $text -notmatch 'node --check') {
        $hits += "$($script:MjsLoader) (SDK loader invocation)"
    }
    if ($FileName -eq $script:MjsLoader -and $text -match 'client\.llm\.load') {
        $hits += 'client.llm.load (SDK model load)'
    }
    return $hits
}

Assert-That 'Given the mutation inventory then benchmark.ps1 is the only script that both loads and unloads and invokes the SDK loader' -Expectation {
    $hits = Get-LifecycleHits -FileName 'benchmark.ps1'
    Assert-True ($hits -contains 'api/v1/models/load') -Because 'Load-BenchmarkModel posts a load request'
    Assert-True ($hits -contains 'api/v1/models/unload') -Because 'Unload-AllLlmModels unloads every LLM before loading'
    Assert-True (@($hits | Where-Object { $_ -like '*SDK loader*' }).Count -gt 0) -Because 'quantized-KV loading delegates to the Node SDK loader'
}

Assert-That 'Given the mutation inventory then model-manager.ps1 unloads but never loads' -Expectation {
    $hits = Get-LifecycleHits -FileName 'model-manager.ps1'
    Assert-True ($hits -contains 'api/v1/models/unload')
    Assert-True ($hits -notcontains 'api/v1/models/load') -because 'model-manager has no load action'
}

Assert-That 'Given the mutation inventory then wrapper scripts inherit benchmark mutations only by forwarding' -Expectation {
    foreach ($wrapper in @('bench.ps1', 'run-all-benchmarks.ps1')) {
        $text = Get-ScriptText -FileName $wrapper
        Assert-True ($text -match 'benchmark\.ps1') -Because "$wrapper must forward to benchmark.ps1 for its mutations"
        Assert-True (@(Get-LifecycleHits -FileName $wrapper).Count -eq 0) -Because "$wrapper owns no direct lifecycle calls"
    }
}

Assert-That 'Given the mutation inventory then analysis and smoke scripts never mutate LM Studio' -Expectation {
    foreach ($innocent in @('test-load.ps1', 'compare-results.ps1', 'harness-lib.ps1', 'measurement-lib.ps1')) {
        Assert-True (@(Get-LifecycleHits -FileName $innocent).Count -eq 0) -Because "$innocent must stay request-only or offline"
    }
}

Assert-That 'Given the SDK loader when inspected then it drives model loading through the LM Studio SDK client' -Expectation {
    $text = Get-ScriptText -FileName $script:MjsLoader
    Assert-True ($text -match 'client\.llm\.load') -Because 'the Node loader exists solely to load models'
}

foreach ($engineScript in @('benchmark.ps1', 'model-manager.ps1', 'bench.ps1', 'run-all-benchmarks.ps1', 'test-load.ps1', 'load-model.mjs')) {
    Assert-That "Given engine-control script $engineScript when inspected then it carries the explicit legacy machine-lab banner" -Expectation {
        $text = Get-ScriptText -FileName $engineScript
        Assert-True ($text -match 'LEGACY MACHINE-LAB OPERATION') -Because 'engine lifecycle control must be unmistakable before deliberate operator use'
    }
}


