#requires -Version 7.0
<#
.SYNOPSIS
    LEGACY MACHINE-LAB OPERATION — bench-rig LM Studio benchmark.

.DESCRIPTION
    LEGACY MACHINE-LAB OPERATION: this script UNLOADS ALL LOADED LLMs, loads the
    requested model with engine settings, and drives LM Studio lifecycle
    endpoints (/api/v1/models/load, /api/v1/models/unload) plus the Node SDK
    loader. It mutates the local inference engine and is not part of the
    provider-agnostic Tonos path. Invoke deliberately.

    Reproducible LM Studio benchmark for bench-rig. Loads and verifies a model,
    captures GPU/config metadata, then measures cold prompt ingestion,
    exact-prefix reuse, prefix extension, reasoning decode, visible-text decode,
    and an actual coding response. Every request is streamed and hard-cancelled
    at TimeoutSec.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory)][string] $Model,
    [Parameter(Mandatory)][ValidatePattern('^[a-zA-Z0-9._-]+$')][string] $Label,
    [ValidateSet('Quick', 'OpenCode', 'Full')][string] $Suite = 'OpenCode',
    [ValidateRange(8192, 262144)][int] $ContextLength = 65536,
    [ValidateRange(1, 8)][int] $Parallel = 1,
    [ValidateRange(32, 8192)][int] $EvalBatchSize = 2048,
    [ValidateRange(32, 2048)][int] $PhysicalBatchSize = 512,
    [ValidateRange(0, 256)][int] $NumExperts = 8,
    [ValidateRange(1, 20)][int] $Runs = 3,
    [ValidateRange(8, 16384)][int] $MaxTokens = 512,
    [ValidateRange(30, 300)][int] $TimeoutSec = 300,
    [ValidateRange(60, 3600)][int] $LoadTimeoutSec = 600,
    [ValidateRange(1000, 50000)][int] $OpenCodePromptTokens = 12700,
    [ValidateRange(0.0, 2.0)][double] $Temperature = 0.2,
    [ValidateSet('auto','none','low','medium','high')][string] $ReasoningEffort = 'none',
    [switch] $KvCacheGpu,
    [ValidateSet('f16','q8_0','q4_0')][string] $KvCacheQuantization = 'f16',
    [switch] $Mtp,
    [ValidateRange(1, 16)][int] $MtpDraftTokens = 3,
    [ValidateRange(0.0, 1.0)][double] $MtpMinContinueProbability = 0.75,
    [switch] $SkipLoad,
    [switch] $RunQuality,
    [ValidateRange(128, 8192)][int] $QualityMaxTokens = 2000,
    [string] $PromptFile = (Join-Path $PSScriptRoot 'coding_prompt.txt'),
    [string] $ApiRoot = 'http://127.0.0.1:1234',
    [string] $OutDir = (Join-Path $PSScriptRoot 'benchmark-results')
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
. (Join-Path $PSScriptRoot 'harness-lib.ps1')
. (Join-Path $PSScriptRoot 'measurement-lib.ps1')
$script:ExplicitPhysicalBatch = $PSBoundParameters.ContainsKey('PhysicalBatchSize')
$script:ApiRoot = $ApiRoot.TrimEnd('/')
$script:OpenAiRoot = "$($script:ApiRoot)/v1"
$script:Results = [System.Collections.Generic.List[object]]::new()
$script:NativeResults = [System.Collections.Generic.List[object]]::new()

function Get-LmModels {
    Invoke-RestMethod -Method Get -Uri "$($script:ApiRoot)/api/v1/models" -TimeoutSec 30
}

function Get-ModelRecord {
    param([string] $Key)
    $catalog = Get-LmModels
    $record = @($catalog.models | Where-Object key -eq $Key)
    if ($record.Count -ne 1) {
        $available = @($catalog.models | ForEach-Object key) -join ', '
        throw "Model '${Key}' was not found. Installed models: ${available}"
    }
    $record[0]
}

function Get-LoadedInstance {
    param([string] $Key)
    $record = Get-ModelRecord -Key $Key
    $instances = @($record.loaded_instances)
    if ($instances.Count -eq 0) { return $null }
    $instances[0]
}

function Wait-LoadedInstance {
    param([string] $Key, [int] $TimeoutSeconds)
    if ($TimeoutSeconds -le 0) { return Get-LoadedInstance -Key $Key }
    $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
    while ($true) {
        $instance = Get-LoadedInstance -Key $Key
        if ($null -ne $instance) { return $instance }
        if ([DateTime]::UtcNow -ge $deadline) { return $null }
        Start-Sleep -Seconds 2
    }
}

function Unload-AllLlmModels {
    $catalog = Get-LmModels
    foreach ($record in @($catalog.models | Where-Object type -eq 'llm')) {
        foreach ($instance in @($record.loaded_instances)) {
            Write-Host "Unloading $($instance.id)..."
            $body = @{ instance_id = $instance.id } | ConvertTo-Json -Compress
            Invoke-RestMethod -Method Post -Uri "$($script:ApiRoot)/api/v1/models/unload" -ContentType 'application/json' -Body $body -TimeoutSec 120 | Out-Null
        }
    }
}

function Load-BenchmarkModel {
    param($Record)
    Unload-AllLlmModels
    if ($KvCacheGpu -and $KvCacheQuantization -ne 'f16') {
        if ($Mtp) { throw 'MTP and quantized KV loading cannot be combined by this LM Studio SDK version.' }
        if ($script:ExplicitPhysicalBatch) { throw "The SDK loader cannot apply PhysicalBatchSize (unsupported by SDK 1.x); omit -PhysicalBatchSize or drop KV quantization." }
        $loader = Join-Path $PSScriptRoot 'load-model.mjs'
        Write-Host "Loading ${Model} through LM Studio SDK: context=${ContextLength}, parallel=${Parallel}, batch=${EvalBatchSize}, KV-GPU=${KvCacheQuantization}, MTP=false (physical batch not controllable; server default applies)"
        $loaderOutput = & node $loader --model $Model --server $script:ApiRoot --context $ContextLength --parallel $Parallel --batch $EvalBatchSize --experts $NumExperts --kv $KvCacheQuantization --load-timeout-ms ([int]($LoadTimeoutSec * 1000))
        $loaderExit = $LASTEXITCODE
        $teardownFailFast = -1073740791
        if (-not $loaderOutput) { throw "LM Studio SDK loader produced no instance JSON (exit ${loaderExit})." }
        if ($loaderExit -ne 0 -and $loaderExit -ne $teardownFailFast) { throw "LM Studio SDK loader failed with exit code ${loaderExit}." }
        return ($loaderOutput | Select-Object -Last 1 | ConvertFrom-Json)
    }
    $body = @{
        model=$Model; context_length=$ContextLength; eval_batch_size=$EvalBatchSize
        physical_batch_size=$PhysicalBatchSize; parallel=$Parallel; flash_attention=$true
        offload_kv_cache_to_gpu=[bool]$KvCacheGpu; speculative_draft_mtp=[bool]$Mtp
        speculative_draft_max_tokens=$MtpDraftTokens
        speculative_draft_min_continue_probability=$MtpMinContinueProbability
        echo_load_config=$true
    }
    if ($Record.architecture -match 'moe' -and $NumExperts -gt 0) { $body['num_experts'] = $NumExperts }
    Write-Host "Loading ${Model}: context=${ContextLength}, parallel=${Parallel}, batch=${EvalBatchSize}/${PhysicalBatchSize}, KV-GPU=$([bool]$KvCacheGpu), MTP=$([bool]$Mtp)"
    try {
        Invoke-RestMethod -Method Post -Uri "$($script:ApiRoot)/api/v1/models/load" -ContentType 'application/json' -Body ($body | ConvertTo-Json -Depth 8 -Compress) -TimeoutSec $LoadTimeoutSec
    } catch [System.OperationCanceledException] {
        Write-Warning "Load request hit the ${LoadTimeoutSec}s client timeout; continuing readiness polling."
        $null
    }
}

function Assert-EffectiveBenchmarkConfig {
    param($Config)
    $requested = [ordered]@{
        context_length = $ContextLength; parallel = $Parallel; eval_batch_size = $EvalBatchSize
        physical_batch_size = $PhysicalBatchSize; flash_attention = $true
        offload_kv_cache_to_gpu = [bool]$KvCacheGpu; speculative_draft_mtp = [bool]$Mtp
    }
    $script:KvQuantizationVerified = Assert-EffectiveConfig -Config $Config -Requested $requested -KvCacheGpu:$KvCacheGpu -KvCacheQuantization $KvCacheQuantization
}

function Invoke-NativeStreamingChat {
    param(
        [Parameter(Mandatory)][string] $InputText,
        [Parameter(Mandatory)][string] $Phase,
        [Parameter(Mandatory)][ValidateSet('auto','off','on','low','medium','high')][string] $Reasoning,
        [int] $TokenLimit = $MaxTokens,
        [switch] $Capture
    )
    $payloadBody = @{
        model=$Model; input=$InputText; max_output_tokens=$TokenLimit
        temperature=$Temperature; stream=$true; store=$false
    }
    if($Reasoning-ne'auto'){$payloadBody['reasoning']=$Reasoning}
    $payload = $payloadBody | ConvertTo-Json -Depth 10 -Compress
    $handler = [Net.Http.HttpClientHandler]::new()
    $client = [Net.Http.HttpClient]::new($handler)
    $client.Timeout = [Threading.Timeout]::InfiniteTimeSpan
    $request = [Net.Http.HttpRequestMessage]::new([Net.Http.HttpMethod]::Post,"$($script:ApiRoot)/api/v1/chat")
    $request.Content = [Net.Http.StringContent]::new($payload,[Text.Encoding]::UTF8,'application/json')
    $cancel = [Threading.CancellationTokenSource]::new()
    $cancel.CancelAfter([TimeSpan]::FromSeconds($TimeoutSec))
    $clock = [Diagnostics.Stopwatch]::StartNew()
    $response=$null; $stream=$null; $reader=$null; $result=$null
    $reasoningText=[Text.StringBuilder]::new(); $visibleText=[Text.StringBuilder]::new()
    $timedOut=$false; $failure=$null
    try {
        $response = $client.SendAsync($request,[Net.Http.HttpCompletionOption]::ResponseHeadersRead,$cancel.Token).GetAwaiter().GetResult()
        if (-not $response.IsSuccessStatusCode) {
            $errorBody = $response.Content.ReadAsStringAsync().GetAwaiter().GetResult()
            throw "HTTP $([int]$response.StatusCode): ${errorBody}"
        }
        $stream = $response.Content.ReadAsStreamAsync($cancel.Token).GetAwaiter().GetResult()
        $reader = [IO.StreamReader]::new($stream)
        while (-not $reader.EndOfStream) {
            $line = $reader.ReadLineAsync($cancel.Token).GetAwaiter().GetResult()
            if (-not $line.StartsWith('data: ')) { continue }
            $eventData = $line.Substring(6) | ConvertFrom-Json
            switch ($eventData.type) {
                'reasoning.delta' { if($Capture){[void]$reasoningText.Append([string]$eventData.content)} }
                'message.delta' { if($Capture){[void]$visibleText.Append([string]$eventData.content)} }
                'chat.end' { $result=$eventData.result }
            }
        }
    } catch [OperationCanceledException] {
        $timedOut=$true; $failure="Exceeded hard timeout of ${TimeoutSec}s"
    } catch { $failure=$_.Exception.Message }
    finally {
        $clock.Stop()
        if($reader){$reader.Dispose()}; if($stream){$stream.Dispose()}; if($response){$response.Dispose()}
        $request.Dispose(); $client.Dispose(); $handler.Dispose(); $cancel.Dispose()
    }
    if($null-eq$result-and$null-eq$failure){$failure='Native stream ended without a chat.end result.'}
    $stats=Get-RecordProp $result 'stats'
    $output=@(Get-RecordProp $result 'output' @())
    $inputTokens=[int](Get-RecordProp $stats 'input_tokens' 0)
    $totalOutput=[int](Get-RecordProp $stats 'total_output_tokens' 0)
    $reasoningOutput=[int](Get-RecordProp $stats 'reasoning_output_tokens' 0)
    $record=[pscustomobject]@{
        phase=$Phase; reasoning_mode=$Reasoning; success=($null-eq$failure); timed_out=$timedOut; error=$failure
        input_tokens=$inputTokens; output_tokens=$totalOutput; reasoning_tokens=$reasoningOutput
        text_tokens=[Math]::Max(0,$totalOutput-$reasoningOutput)
        ttft_sec=if($stats){[Math]::Round([double](Get-RecordProp $stats 'time_to_first_token_seconds' 0),4)}else{$null}
        authoritative_output_tok_s=if($stats){[Math]::Round([double](Get-RecordProp $stats 'tokens_per_second' 0),2)}else{$null}
        wall_sec=[Math]::Round($clock.Elapsed.TotalSeconds,4)
        visible_output=(@($output|Where-Object type -eq 'message').Count-gt0)
        reasoning=if($Capture){$reasoningText.ToString()}else{$null}
        text=if($Capture){$visibleText.ToString()}else{$null}
    }
    $script:NativeResults.Add($record)
    Write-Host ("  {0,-20} input={1,6} TTFT={2,8}s native={3,7} tok/s reason={4,5} text={5,5} wall={6,8}s" -f $Phase,$record.input_tokens,$record.ttft_sec,$record.authoritative_output_tok_s,$record.reasoning_tokens,$record.text_tokens,$record.wall_sec)
    if($timedOut){throw "Phase '${Phase}' exceeded ${TimeoutSec}s and was aborted."}
    if($failure){throw "Phase '${Phase}' failed: ${failure}"}
    $record
}
function Invoke-StreamingCompletion {
    param(
        [Parameter(Mandatory)][object[]] $Messages,
        [Parameter(Mandatory)][string] $Phase,
        [int] $TokenLimit = $MaxTokens,
        [switch] $Capture
    )
    $requestBody = @{ model=$Model; messages=$Messages; max_tokens=$TokenLimit; temperature=$Temperature; stream=$true; stream_options=@{include_usage=$true} }
    if($ReasoningEffort-ne'auto'){$requestBody['reasoning_effort']=$ReasoningEffort}
    $payload = $requestBody | ConvertTo-Json -Depth 12 -Compress
    $handler = [Net.Http.HttpClientHandler]::new()
    $client = [Net.Http.HttpClient]::new($handler)
    $client.Timeout = [Threading.Timeout]::InfiniteTimeSpan
    $request = [Net.Http.HttpRequestMessage]::new([Net.Http.HttpMethod]::Post,"$($script:OpenAiRoot)/chat/completions")
    $request.Content = [Net.Http.StringContent]::new($payload,[Text.Encoding]::UTF8,'application/json')
    $cancel = [Threading.CancellationTokenSource]::new()
    $cancel.CancelAfter([TimeSpan]::FromSeconds($TimeoutSec))
    $clock = [Diagnostics.Stopwatch]::StartNew()
    $response=$null; $stream=$null; $reader=$null; $usage=$null; $finishReason=$null
    $firstAnyMs=$null; $firstReasoningMs=$null; $firstTextMs=$null; $lastReasoningMs=$null
    $reasoning=[Text.StringBuilder]::new(); $text=[Text.StringBuilder]::new()
    $timedOut=$false; $failure=$null
    try {
        $response = $client.SendAsync($request,[Net.Http.HttpCompletionOption]::ResponseHeadersRead,$cancel.Token).GetAwaiter().GetResult()
        if (-not $response.IsSuccessStatusCode) {
            $errorBody = $response.Content.ReadAsStringAsync().GetAwaiter().GetResult()
            throw "HTTP $([int]$response.StatusCode): ${errorBody}"
        }
        $stream = $response.Content.ReadAsStreamAsync($cancel.Token).GetAwaiter().GetResult()
        $reader = [IO.StreamReader]::new($stream)
        while (-not $reader.EndOfStream) {
            $line = $reader.ReadLineAsync($cancel.Token).GetAwaiter().GetResult()
            if (-not $line.StartsWith('data: ')) { continue }
            $data = $line.Substring(6)
            if ($data -eq '[DONE]') { break }
            $chunk = $data | ConvertFrom-Json
            $nowMs = $clock.Elapsed.TotalMilliseconds
            if ($chunk.PSObject.Properties['usage'] -and $null -ne $chunk.usage) { $usage=$chunk.usage }
            if (-not $chunk.choices -or $chunk.choices.Count -eq 0) { continue }
            $choice=$chunk.choices[0]
            if ($choice.finish_reason) { $finishReason=$choice.finish_reason }
            $delta=$choice.delta
            $reasoningPart = [string](Get-RecordProp $delta 'reasoning_content' '')
            if ($reasoningPart.Length -gt 0) {
                if ($null -eq $firstAnyMs) { $firstAnyMs=$nowMs }
                if ($null -eq $firstReasoningMs) { $firstReasoningMs=$nowMs }
                $lastReasoningMs=$nowMs
                if ($Capture) { [void]$reasoning.Append($reasoningPart) }
            }
            $textPart = [string](Get-RecordProp $delta 'content' '')
            if ($textPart.Length -gt 0) {
                if ($null -eq $firstAnyMs) { $firstAnyMs=$nowMs }
                if ($null -eq $firstTextMs) { $firstTextMs=$nowMs }
                if ($Capture) { [void]$text.Append($textPart) }
            }
        }
    } catch [OperationCanceledException] {
        $timedOut=$true; $failure="Exceeded hard timeout of ${TimeoutSec}s"
    } catch { $failure=$_.Exception.Message }
    finally {
        $clock.Stop()
        if($reader){$reader.Dispose()}; if($stream){$stream.Dispose()}; if($response){$response.Dispose()}
        $request.Dispose(); $client.Dispose(); $handler.Dispose(); $cancel.Dispose()
    }
    $tokens=Convert-Usage -Usage $usage
    $totalSeconds=[Math]::Max(0.001,$clock.Elapsed.TotalSeconds)
    $ttftSeconds=if($null-ne$firstAnyMs){$firstAnyMs/1000.0}else{$null}
    $decodeSeconds=if($null-ne$firstAnyMs){[Math]::Max(0.001,($clock.Elapsed.TotalMilliseconds-$firstAnyMs)/1000.0)}else{0.0}
    $reasoningEndMs=if($null-ne$firstTextMs){$firstTextMs}else{$lastReasoningMs}
    $reasoningSeconds=if($null-ne$firstReasoningMs-and$null-ne$reasoningEndMs){[Math]::Max(0.001,($reasoningEndMs-$firstReasoningMs)/1000.0)}else{0.0}
    $textSeconds=if($null-ne$firstTextMs){[Math]::Max(0.001,($clock.Elapsed.TotalMilliseconds-$firstTextMs)/1000.0)}else{0.0}
    $record=[pscustomobject]@{
        phase=$Phase; success=($null-eq$failure); timed_out=$timedOut; error=$failure; finish_reason=$finishReason
        prompt_tokens=$tokens.prompt; completion_tokens=$tokens.completion; reasoning_tokens=$tokens.reasoning; text_tokens=$tokens.text
        ttft_sec=if($null-ne$ttftSeconds){[Math]::Round($ttftSeconds,4)}else{$null}; wall_sec=[Math]::Round($totalSeconds,4); decode_sec=[Math]::Round($decodeSeconds,4)
        estimated_prefill_tok_s=if($ttftSeconds-and$tokens.prompt-gt0){[Math]::Round($tokens.prompt/$ttftSeconds,2)}else{$null}
        reasoning_tok_s=if($reasoningSeconds-gt0-and$tokens.reasoning-gt0){[Math]::Round($tokens.reasoning/$reasoningSeconds,2)}else{$null}
        text_tok_s=if($textSeconds-gt0-and$tokens.text-gt0){[Math]::Round($tokens.text/$textSeconds,2)}else{$null}
        decode_tok_s=if($decodeSeconds-gt0-and$tokens.completion-gt0){[Math]::Round($tokens.completion/$decodeSeconds,2)}else{$null}
        wall_completion_tok_s=[Math]::Round($tokens.completion/$totalSeconds,2)
        first_reasoning_sec=if($null-ne$firstReasoningMs){[Math]::Round($firstReasoningMs/1000,4)}else{$null}
        first_text_sec=if($null-ne$firstTextMs){[Math]::Round($firstTextMs/1000,4)}else{$null}
        visible_output=($text.Length-gt0); reasoning=if($Capture){$reasoning.ToString()}else{$null}; text=if($Capture){$text.ToString()}else{$null}
    }
    $script:Results.Add($record)
    $prefill=if($null-ne$record.estimated_prefill_tok_s){"$($record.estimated_prefill_tok_s)"}else{'n/a'}
    $decode=if($null-ne$record.decode_tok_s){"$($record.decode_tok_s)"}else{'n/a'}
    Write-Host ("  {0,-20} prompt={1,6} TTFT={2,8}s prefill={3,8} tok/s decode={4,7} tok/s wall={5,8}s" -f $Phase,$record.prompt_tokens,$record.ttft_sec,$prefill,$decode,$record.wall_sec)
    if($timedOut){throw "Phase '${Phase}' exceeded ${TimeoutSec}s and was aborted."}
    if($failure){throw "Phase '${Phase}' failed: ${failure}"}
    $record
}

function Invoke-GoQualityTest {
    if(-not(Test-Path -LiteralPath $PromptFile -PathType Leaf)){throw "Coding prompt not found: ${PromptFile}"}
    $prompt=Get-Content -LiteralPath $PromptFile -Raw -Encoding utf8
    $result=Invoke-StreamingCompletion -Messages @(@{role='user';content=$prompt}) -Phase 'coding-quality' -TokenLimit $QualityMaxTokens -Capture
    $quality=Convert-QualityText -VisibleOutput $result.visible_output -Text $result.text
    $code=$quality.code
    if(-not$code){return [pscustomobject]$quality}
    $testRoot=Join-Path $env:TEMP "bench-rig-quality-$([guid]::NewGuid().ToString('N'))"
    New-Item -ItemType Directory -Path $testRoot -Force|Out-Null
    try{
        Set-Content -LiteralPath(Join-Path $testRoot 'retry.go') -Value $code -Encoding utf8
        Copy-Item -LiteralPath(Join-Path $PSScriptRoot 'quality\go-retry\go.mod') -Destination $testRoot
        Copy-Item -LiteralPath(Join-Path $PSScriptRoot 'quality\go-retry\retry_test.go') -Destination $testRoot
        $quality.executable=$true
        Push-Location $testRoot
        try{$goOutput=(& go test -count=1 . 2>&1|Out-String).Trim();$quality.go_test_passed=($LASTEXITCODE-eq0);$quality.go_test_output=$goOutput}finally{Pop-Location}
    }finally{Remove-Item -LiteralPath $testRoot -Recurse -Force -ErrorAction SilentlyContinue}
    [pscustomobject]$quality
}

New-Item -ItemType Directory -Path $OutDir -Force|Out-Null
$catalogRecord=Get-ModelRecord -Key $Model
$gpuBefore=Get-GpuSnapshot
$script:RunError=$null
$script:KvQuantizationVerified=$null
$caught=$null
$loadResponse=$null; $loaded=$null; $lmsPs=$null
$gpuLoaded=$null; $gpuAfter=$null; $quality=$null
try {
    if(-not$SkipLoad){
        $loadResponse=Load-BenchmarkModel -Record $catalogRecord
        Write-Host "Polling for loaded instance (deadline ${LoadTimeoutSec}s)..."
        $loaded=Wait-LoadedInstance -Key $Model -TimeoutSeconds $LoadTimeoutSec
        if($null-eq$loaded){throw "Model '${Model}' did not reach loaded state within ${LoadTimeoutSec}s."}
    } else {
        $loaded=Wait-LoadedInstance -Key $Model -TimeoutSeconds 0
        if($null-eq$loaded){throw "Model '${Model}' is not loaded after load step."}
    }
    Assert-EffectiveBenchmarkConfig -Config $loaded.config
    $lmsPs=Get-LmsPsSnapshot
    if($KvCacheGpu-and-not[bool]$loaded.config.offload_kv_cache_to_gpu){throw 'GPU KV cache requested but inactive; refusing CPU-spill benchmark.'}

    Write-Host 'Warming model and CUDA kernels...'
    Invoke-StreamingCompletion -Messages @(@{role='user';content='Return exactly: READY'}) -Phase 'warmup' -TokenLimit 16|Out-Null
    $gpuLoaded=Get-GpuSnapshot
    $reasoningCapability=Get-RecordProp (Get-RecordProp $catalogRecord 'capabilities') 'reasoning'
    $reasoningOptions=@(Get-RecordProp $reasoningCapability 'allowed_options' @())
    $decodePrompt='Generate a numbered list of 300 distinct, valid Go variable names. Do not explain, summarize, or stop early.'
    if($reasoningOptions -contains 'off'){
        Invoke-NativeStreamingChat -InputText $decodePrompt -Phase 'native-decode-off' -Reasoning off -TokenLimit $MaxTokens|Out-Null
    }
    if($reasoningOptions -contains 'on'){
        Invoke-NativeStreamingChat -InputText $decodePrompt -Phase 'native-decode-on' -Reasoning on -TokenLimit $MaxTokens|Out-Null
    }
    if($reasoningOptions.Count-eq0){
        Invoke-NativeStreamingChat -InputText $decodePrompt -Phase 'native-decode-auto' -Reasoning auto -TokenLimit $MaxTokens|Out-Null
    }
    $promptTargets=Get-PromptTargets -Suite $Suite -OpenCodePromptTokens $OpenCodePromptTokens
    foreach($target in $promptTargets){
        for($run=1;$run-le$Runs;$run++){
            $prompt=New-OpenCodeLikePrompt -ApproxTokens $target -Nonce ([guid]::NewGuid().ToString('N'))
            $baseMessages=@(@{role='user';content=$prompt})
            Invoke-StreamingCompletion -Messages $baseMessages -Phase "cold-${target}" -TokenLimit 8|Out-Null
            if($Suite-ne'Quick'){
                Invoke-StreamingCompletion -Messages $baseMessages -Phase "reuse-${target}" -TokenLimit 8|Out-Null
                $extended=@(@{role='user';content=$prompt},@{role='assistant';content='Acknowledged.'},@{role='user';content='Now answer the final task in one sentence.'})
                Invoke-StreamingCompletion -Messages $extended -Phase "append-${target}" -TokenLimit 8|Out-Null
            }
        }
    }
    if($RunQuality){Write-Host 'Running executable Go quality test...';$quality=Invoke-GoQualityTest}
    $gpuAfter=Get-GpuSnapshot
} catch {
    $caught=$_
    $script:RunError=$_.Exception.Message
    Write-Warning "Benchmark aborted before completion: $($script:RunError) (partial results will still be saved)"
}
$phaseNames=@($script:Results | ForEach-Object phase | Where-Object{$_-ne'warmup'}|Sort-Object -Unique)
$summaries=[ordered]@{}
foreach($phase in $phaseNames){$summaries[$phase]=Get-PhaseSummary -Rows @($script:Results) -Phase $phase}
$headroomPass=if($gpuAfter){$gpuAfter.memory_free_mib-ge1536}else{$false}
$document=New-SchemaV3Document `
    -Label $Label -Timestamp (Get-Date).ToString('o') -CatalogRecord $catalogRecord `
    -Suite $Suite -Runs $Runs -MaxTokens $MaxTokens -TimeoutSec $TimeoutSec `
    -OpenCodePromptTokens $OpenCodePromptTokens -Temperature $Temperature -ReasoningEffort $ReasoningEffort `
    -ContextLength $ContextLength -Parallel $Parallel -EvalBatchSize $EvalBatchSize -PhysicalBatchSize $PhysicalBatchSize `
    -KvCacheGpu:$KvCacheGpu -KvCacheQuantization $KvCacheQuantization -NumExperts $NumExperts -Mtp:$Mtp -MtpDraftTokens $MtpDraftTokens `
    -EffectiveConfig $(if($loaded){$loaded.config}else{$null}) -LoadResponse $loadResponse `
    -GpuBefore $gpuBefore -GpuAfterLoad $gpuLoaded -GpuAfterBenchmark $gpuAfter `
    -HeadroomPass:$headroomPass -KvQuantizationVerified $script:KvQuantizationVerified `
    -LmsPs $lmsPs -Summaries $summaries -Quality $quality `
    -NativePerRun @($script:NativeResults) -PerRun @($script:Results) -RunError $script:RunError
$timestamp=Get-Date -Format 'yyyyMMdd-HHmmssfff'
$outputPath=Join-Path $OutDir "${timestamp}-${Label}.json"
$document|ConvertTo-Json -Depth 16|Set-Content -LiteralPath $outputPath -Encoding utf8
Write-Host "Saved ${outputPath}"
if($null-eq$gpuAfter){Write-Warning 'GPU telemetry unavailable; VRAM headroom criterion could not be evaluated and fails closed.'}
elseif($headroomPass-eq$false){Write-Warning "Only $($gpuAfter.memory_free_mib) MiB VRAM remained after the benchmark run; configuration fails headroom criterion."}
if($null-ne$caught){throw $caught.Exception}
