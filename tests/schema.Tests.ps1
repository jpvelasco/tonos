#requires -Version 7.0
Set-StrictMode -Version Latest

function New-MinimalCatalog {
    [pscustomobject]@{
        key = 'test-model'
        display_name = 'Test Model'
        architecture = 'llama'
        quantization = 'Q4_0'
        size_bytes = 8000000000
        params_string = '8B'
        max_context_length = 131072
    }
}

Assert-That 'Given the schema-v3 constructor when building a document then top-level keys are exactly the pinned v3 set in order' -Expectation {
    $doc = New-SchemaV3Document -Label 'shape-probe' -Timestamp '1970-01-01T00:00:00.0000000+00:00' `
        -CatalogRecord (New-MinimalCatalog) -Suite 'Quick' -Runs 1 -MaxTokens 512 -TimeoutSec 300 `
        -OpenCodePromptTokens 12700 -Temperature 0.2 -ReasoningEffort 'none' `
        -ContextLength 65536 -Parallel 1 -EvalBatchSize 2048 -PhysicalBatchSize 512 `
        -KvCacheGpu:$false -KvCacheQuantization 'f16' -NumExperts 8 -Mtp:$false `
        -MtpDraftTokens 3 -EffectiveConfig $null -LoadResponse $null `
        -GpuBefore $null -GpuAfterLoad $null -GpuAfterBenchmark $null `
        -HeadroomPass $false -KvQuantizationVerified $null -LmsPs $null `
        -Summaries ([ordered]@{}) -Quality $null -NativePerRun @() -PerRun @() `
        -RunError $null
    $expected = @('schema_version','timestamp','label','model','benchmark','requested_config','effective_config','load_response','gpu','lms_ps','summaries','quality','native_per_run','per_run','run_error','incomplete')
    Assert-Equal (@($doc.Keys) -join ',') ($expected -join ',')
}

Assert-That 'Given the schema-v3 constructor when building a document then schema_version is 3 and incomplete mirrors run_error absence' -Expectation {
    $doc = New-SchemaV3Document -Label 'x' -Timestamp '1970-01-01T00:00:00.0000000+00:00' `
        -CatalogRecord (New-MinimalCatalog) -Suite 'Quick' -Runs 1 -MaxTokens 512 -TimeoutSec 300 `
        -OpenCodePromptTokens 12700 -Temperature 0.2 -ReasoningEffort 'none' `
        -ContextLength 65536 -Parallel 1 -EvalBatchSize 2048 -PhysicalBatchSize 512 `
        -KvCacheGpu:$false -KvCacheQuantization 'f16' -NumExperts 8 -Mtp:$false `
        -MtpDraftTokens 3 -EffectiveConfig $null -LoadResponse $null `
        -GpuBefore $null -GpuAfterLoad $null -GpuAfterBenchmark $null `
        -HeadroomPass $false -KvQuantizationVerified $null -LmsPs $null `
        -Summaries ([ordered]@{}) -Quality $null -NativePerRun @() -PerRun @() `
        -RunError $null
    Assert-Equal 3 $doc.schema_version
    Assert-Equal $false $doc.incomplete
    Assert-Null $doc.run_error
}

Assert-That 'Given a mid-run failure when building the document then run_error is preserved and incomplete flips true' -Expectation {
    $doc = New-SchemaV3Document -Label 'x' -Timestamp '1970-01-01T00:00:00.0000000+00:00' `
        -CatalogRecord (New-MinimalCatalog) -Suite 'Quick' -Runs 1 -MaxTokens 512 -TimeoutSec 300 `
        -OpenCodePromptTokens 12700 -Temperature 0.2 -ReasoningEffort 'none' `
        -ContextLength 65536 -Parallel 1 -EvalBatchSize 2048 -PhysicalBatchSize 512 `
        -KvCacheGpu:$false -KvCacheQuantization 'f16' -NumExperts 8 -Mtp:$false `
        -MtpDraftTokens 3 -EffectiveConfig $null -LoadResponse $null `
        -GpuBefore $null -GpuAfterLoad $null -GpuAfterBenchmark $null `
        -HeadroomPass $false -KvQuantizationVerified $null -LmsPs $null `
        -Summaries ([ordered]@{}) -Quality $null -NativePerRun @() -PerRun @() `
        -RunError 'Phase cold-1000 exceeded 300s and was aborted.'
    Assert-Equal 'Phase cold-1000 exceeded 300s and was aborted.' $doc.run_error
    Assert-True $doc.incomplete -Because 'a failed run must remain visible as incomplete evidence'
}

Assert-That 'Given the constructor when inspecting subsections then model, benchmark, requested_config, and gpu field sets match the producer contract' -Expectation {
    $doc = New-SchemaV3Document -Label 'x' -Timestamp '1970-01-01T00:00:00.0000000+00:00' `
        -CatalogRecord (New-MinimalCatalog) -Suite 'Full' -Runs 3 -MaxTokens 512 -TimeoutSec 300 `
        -OpenCodePromptTokens 12700 -Temperature 0.2 -ReasoningEffort 'none' `
        -ContextLength 65536 -Parallel 2 -EvalBatchSize 4096 -PhysicalBatchSize 1024 `
        -KvCacheGpu:$true -KvCacheQuantization 'q8_0' -NumExperts 4 -Mtp:$true `
        -MtpDraftTokens 3 -EffectiveConfig @{ context_length = 65536 } -LoadResponse @{ id = 'inst-1' } `
        -GpuBefore @{ name = 'GPU' } -GpuAfterLoad @{ name = 'GPU' } -GpuAfterBenchmark @{ name = 'GPU'; memory_free_mib = 4096 } `
        -HeadroomPass $true -KvQuantizationVerified $true -LmsPs @() `
        -Summaries ([ordered]@{}) -Quality $null -NativePerRun @() -PerRun @() -RunError $null
    Assert-Equal 'key,display_name,architecture,quantization,size_bytes,params_string,max_context_length' (@($doc.model.Keys) -join ',')
    Assert-Equal 'suite,runs,max_tokens,timeout_sec,open_code_prompt_target,temperature,reasoning_effort' (@($doc.benchmark.Keys) -join ',')
    Assert-Equal 'context_length,parallel,eval_batch_size,physical_batch_size,flash_attention,offload_kv_cache_to_gpu,kv_cache_quantization,num_experts,speculative_draft_mtp,mtp_draft_tokens' (@($doc.requested_config.Keys) -join ',')
    Assert-Equal 'before_load,after_load,after_benchmark,headroom_floor_mib,headroom_pass,kv_quantization_verified' (@($doc.gpu.Keys) -join ',')
    Assert-Equal 1536 $doc.gpu.headroom_floor_mib
    Assert-Equal 65536 $doc.requested_config.context_length
    Assert-True $doc.requested_config.flash_attention -Because 'flash attention is always requested on'
}

Assert-That 'Given the same inputs when serializing twice then the JSON is byte-identical apart from nothing (determinism)' -Expectation {
    $args = @{
        Label = 'det'; Timestamp = '1970-01-01T00:00:00.0000000+00:00'
        CatalogRecord = (New-MinimalCatalog); Suite = 'Quick'; Runs = 1; MaxTokens = 512
        TimeoutSec = 300; OpenCodePromptTokens = 12700; Temperature = 0.2; ReasoningEffort = 'none'
        ContextLength = 65536; Parallel = 1; EvalBatchSize = 2048; PhysicalBatchSize = 512
        KvCacheGpu = $false; KvCacheQuantization = 'f16'; NumExperts = 8; Mtp = $false
        MtpDraftTokens = 3; EffectiveConfig = $null; LoadResponse = $null
        GpuBefore = $null; GpuAfterLoad = $null; GpuAfterBenchmark = $null
        HeadroomPass = $false; KvQuantizationVerified = $null; LmsPs = $null
        Summaries = [ordered]@{}; Quality = $null; NativePerRun = @(); PerRun = @(); RunError = $null
    }
    $first = New-SchemaV3Document @args | ConvertTo-Json -Depth 16
    $second = New-SchemaV3Document @args | ConvertTo-Json -Depth 16
    Assert-Equal $first $second
}

function New-GoldenDocumentArgs {
    @{
        Label = 'golden-current-shape'; Timestamp = '1970-01-01T00:00:00.0000000+00:00'
        CatalogRecord = New-MinimalCatalog
        Suite = 'OpenCode'; Runs = 3; MaxTokens = 512; TimeoutSec = 300
        OpenCodePromptTokens = 12700; Temperature = 0.2; ReasoningEffort = 'none'
        ContextLength = 65536; Parallel = 1; EvalBatchSize = 2048; PhysicalBatchSize = 512
        KvCacheGpu = $true; KvCacheQuantization = 'q8_0'; NumExperts = 8; Mtp = $false
        MtpDraftTokens = 3
        EffectiveConfig = [pscustomobject]@{
            context_length = 65536; parallel = 1; eval_batch_size = 2048
            physical_batch_size = 512; flash_attention = $true; offload_kv_cache_to_gpu = $true
        }
        LoadResponse = [pscustomobject]@{ id = 'test-instance' }
        GpuBefore = [pscustomobject]@{ name = 'Test GPU'; memory_total_mib = 16384; memory_used_mib = 800; memory_free_mib = 15584; utilization_pct = 0; pstate = 'P8'; captured_at = '1970-01-01T00:00:00.0000000+00:00' }
        GpuAfterLoad = [pscustomobject]@{ name = 'Test GPU'; memory_total_mib = 16384; memory_used_mib = 9500; memory_free_mib = 6884; utilization_pct = 0; pstate = 'P2'; captured_at = '1970-01-01T00:00:00.0000000+00:00' }
        GpuAfterBenchmark = [pscustomobject]@{ name = 'Test GPU'; memory_total_mib = 16384; memory_used_mib = 9600; memory_free_mib = 6784; utilization_pct = 97; pstate = 'P2'; captured_at = '1970-01-01T00:00:00.0000000+00:00' }
        HeadroomPass = $true; KvQuantizationVerified = $false
        LmsPs = @([pscustomobject]@{ type = 'llm'; modelKey = 'test-model'; status = 'loaded' })
        Summaries = [ordered]@{}
        Quality = [ordered]@{ visible_output = $true; extraction = 'none'; executable = $false; go_test_passed = $false; go_test_output = $null }
        NativePerRun = @()
        PerRun = @()
        RunError = $null
    }
}

Assert-That 'Given the committed current-shape golden fixture when rebuilding its pinned inputs then serialization reproduces the committed bytes exactly' -Expectation {
    $fixturePath = Join-Path $PSScriptRoot 'fixtures\schema-v3-current.golden.json'
    Assert-True (Test-Path $fixturePath) -Because "golden fixture must exist at $fixturePath"
    $goldenArgs = New-GoldenDocumentArgs
    $produced = (New-SchemaV3Document @goldenArgs | ConvertTo-Json -Depth 16).Trim()
    $committed = (Get-Content $fixturePath -Raw).Trim()
    Assert-Equal ($produced.Trim()) $committed
}

$script:HistoricalGolden = Join-Path $PSScriptRoot 'fixtures\schema-v3-historical.golden.json'

Assert-That 'Given the sanitized historical golden when validated then it pins the recorded 14-field era of schema-v3 with honest structure' -Expectation {
    Assert-True (Test-Path $script:HistoricalGolden) -Because "historical golden must exist at $($script:HistoricalGolden)"
    $doc = Get-Content $script:HistoricalGolden -Raw | ConvertFrom-Json
    Assert-Equal 3 $doc.schema_version
    $expectedEra = @('schema_version','timestamp','label','model','benchmark','requested_config','effective_config','load_response','gpu','lms_ps','summaries','quality','native_per_run','per_run')
    $actual = @($doc.PSObject.Properties.Name)
    Assert-Equal ($expectedEra -join ',') ($actual -join ',')
    Assert-True ($null -ne $doc.summaries) -Because 'phase summaries are the core measurement payload'
}

Assert-That 'Given the sanitized historical golden when scanned then no captured model content or machine identity survives' -Expectation {
    $raw = Get-Content $script:HistoricalGolden -Raw
    foreach ($canary in @('CACHE-BUSTER', 'package retry', 'C:\Users\', '192.168.')) {
        Assert-True ($raw -notmatch [regex]::Escape($canary)) -Because "'$canary' must never appear in a committed golden"
    }
    $doc = $raw | ConvertFrom-Json
    foreach ($row in @($doc.per_run)) {
        Assert-Null $row.reasoning -Because 'reasoning content is sanitized from committed evidence'
        Assert-Null $row.text -Because 'visible text is sanitized from committed evidence'
    }
}
