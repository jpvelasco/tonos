#requires -Version 7.0
Set-StrictMode -Version Latest

Assert-That 'Given no values when taking a median then null is returned' -Expectation {
    Assert-Null (Get-Median @())
    Assert-Null (Get-Median @($null, $null))
}

Assert-That 'Given an odd count when taking a median then the middle value is returned' -Expectation {
    Assert-Equal 3 (Get-Median @(5, 1, 3))
}

Assert-That 'Given an even count when taking a median then the midpoint of the two middle values is returned' -Expectation {
    Assert-Equal 2.5 (Get-Median @(1, 2, 3, 4))
}

Assert-That 'Given prompt targets per suite then Quick is one small target, OpenCode one large, Full four ascending' -Expectation {
    Assert-Equal '1000' ((Get-PromptTargets -Suite 'Quick' -OpenCodePromptTokens 12700) -join ',')
    Assert-Equal '12700' ((Get-PromptTargets -Suite 'OpenCode' -OpenCodePromptTokens 12700) -join ',')
    Assert-Equal '1000,8000,12700,32000' ((Get-PromptTargets -Suite 'Full' -OpenCodePromptTokens 12700) -join ',')
}

Assert-That 'Given phase rows when summarizing then medians cover every recorded metric with run count' -Expectation {
    $rows = @(
        [pscustomobject]@{ phase = 'cold-1000'; prompt_tokens = 1000; ttft_sec = 1.0; estimated_prefill_tok_s = 1000.0; reasoning_tok_s = $null; text_tok_s = 50.0; decode_tok_s = 60.0; wall_sec = 4.0 },
        [pscustomobject]@{ phase = 'cold-1000'; prompt_tokens = 1200; ttft_sec = 2.0; estimated_prefill_tok_s = 600.0; reasoning_tok_s = $null; text_tok_s = 70.0; decode_tok_s = 80.0; wall_sec = 6.0 }
    )
    $summary = Get-PhaseSummary -Rows $rows -Phase 'cold-1000'
    Assert-Equal 2 $summary.runs
    Assert-Equal 1100 $summary.prompt_tokens_median
    Assert-Equal 1.5 $summary.ttft_sec_median
    Assert-Equal 800 $summary.estimated_prefill_median
    Assert-Equal 70 $summary.decode_tok_s_median
    Assert-Equal 5 $summary.wall_sec_median
}

Assert-That 'Given rows for other phases when summarizing then an unknown phase yields null' -Expectation {
    Assert-Null (Get-PhaseSummary -Rows @() -Phase 'missing-phase')
}

Assert-That 'Given usage details when converting then reasoning and visible text split completion tokens' -Expectation {
    $usage = [pscustomobject]@{
        prompt_tokens = 100; completion_tokens = 90
        completion_tokens_details = [pscustomobject]@{ reasoning_tokens = 30 }
    }
    $converted = Convert-Usage -Usage $usage
    Assert-Equal 100 $converted.prompt
    Assert-Equal 90 $converted.completion
    Assert-Equal 30 $converted.reasoning
    Assert-Equal 60 $converted.text
}

Assert-That 'Given missing or null usage when converting then zeros are used and text never goes negative' -Expectation {
    $empty = Convert-Usage -Usage $null
    Assert-Equal 0 $empty.completion
    Assert-Equal 0 $empty.text
    $overReasoned = Convert-Usage -Usage ([pscustomobject]@{
        prompt_tokens = 0; completion_tokens = 5
        completion_tokens_details = [pscustomobject]@{ reasoning_tokens = 9 }
    })
    Assert-Equal 0 $overReasoned.text -Because 'text tokens are floored at zero'
}

Assert-That 'Given requested config that matches effective when asserting then no error and verification stays unclaimed for f16 KV' -Expectation {
    $requested = @{
        context_length = 4096; parallel = 1; eval_batch_size = 512; physical_batch_size = 256
        flash_attention = $true; offload_kv_cache_to_gpu = $false; speculative_draft_mtp = $false
    }
    $effective = [pscustomobject]@{
        context_length = 4096; parallel = 1; eval_batch_size = 512; physical_batch_size = 256
        flash_attention = $true; offload_kv_cache_to_gpu = $false; speculative_draft_mtp = $false
    }
    $verified = Assert-EffectiveConfig -Config $effective -Requested $requested -KvCacheGpu:$false -KvCacheQuantization 'f16'
    Assert-Null $verified -Because 'f16 requests make no quantization claim'
}

Assert-That 'Given a mismatching effective config when asserting then the error names every mismatched field with requested versus effective values' -Expectation {
    $requested = @{
        context_length = 4096; parallel = 1; eval_batch_size = 512; physical_batch_size = 256
        flash_attention = $true; offload_kv_cache_to_gpu = $false; speculative_draft_mtp = $false
    }
    $effective = [pscustomobject]@{
        context_length = 2048; parallel = 1; eval_batch_size = 512; physical_batch_size = 999
        flash_attention = $true; offload_kv_cache_to_gpu = $true; speculative_draft_mtp = $false
    }
    Assert-Throws { Assert-EffectiveConfig -Config $effective -Requested $requested -KvCacheGpu:$false -KvCacheQuantization 'f16' } `
        -MessageLike 'context_length: requested=4096, effective=2048'
}

Assert-That 'Given GPU KV with q8_0 confirmed by effective fields when asserting then quantization verification returns true' -Expectation {
    $requested = @{
        context_length = 4096; parallel = 1; eval_batch_size = 512; physical_batch_size = 256
        flash_attention = $true; offload_kv_cache_to_gpu = $true; speculative_draft_mtp = $false
    }
    $effective = [pscustomobject]@{
        context_length = 4096; parallel = 1; eval_batch_size = 512; physical_batch_size = 256
        flash_attention = $true; offload_kv_cache_to_gpu = $true; speculative_draft_mtp = $false
        llama_k_cache_quantization_type = 'q8_0'
    }
    $verified = Assert-EffectiveConfig -Config $effective -Requested $requested -KvCacheGpu:$true -KvCacheQuantization 'q8_0'
    Assert-Equal $true $verified
}

Assert-That 'Given GPU KV with q8_0 reported differently when asserting then quantization rejection throws naming both sides' -Expectation {
    $requested = @{
        context_length = 4096; parallel = 1; eval_batch_size = 512; physical_batch_size = 256
        flash_attention = $true; offload_kv_cache_to_gpu = $true; speculative_draft_mtp = $false
    }
    $effective = [pscustomobject]@{
        context_length = 4096; parallel = 1; eval_batch_size = 512; physical_batch_size = 256
        flash_attention = $true; offload_kv_cache_to_gpu = $true; speculative_draft_mtp = $false
        kv_cache_quantization = 'f16'
    }
    Assert-Throws { Assert-EffectiveConfig -Config $effective -Requested $requested -KvCacheGpu:$true -KvCacheQuantization 'q8_0' } `
        -MessageLike "KV cache quantization 'q8_0' was requested but effective config reports"
}

Assert-That 'Given GPU KV quantization absent from effective fields when asserting then verification returns false as unverified instead of throwing' -Expectation {
    $requested = @{
        context_length = 4096; parallel = 1; eval_batch_size = 512; physical_batch_size = 256
        flash_attention = $true; offload_kv_cache_to_gpu = $true; speculative_draft_mtp = $false
    }
    $effective = [pscustomobject]@{
        context_length = 4096; parallel = 1; eval_batch_size = 512; physical_batch_size = 256
        flash_attention = $true; offload_kv_cache_to_gpu = $true; speculative_draft_mtp = $false
    }
    $verified = Assert-EffectiveConfig -Config $effective -Requested $requested -KvCacheGpu:$true -KvCacheQuantization 'q8_0'
    Assert-Equal $false $verified -Because 'unverifiable quantization must be recorded honestly, not assumed'
}
