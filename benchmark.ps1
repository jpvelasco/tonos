#requires -Version 7.0
<#
.SYNOPSIS
  Reproducible LM Studio benchmark for Batmobile.
.DESCRIPTION
  Loads and verifies a model, captures GPU/config metadata, then measures cold
  prompt ingestion, exact-prefix reuse, prefix extension, reasoning decode,
  visible-text decode, and an actual coding response. Every request is streamed
  and hard-cancelled at TimeoutSec.
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
    [string] $ApiRoot = 'http://192.168.0.112:1234',
    [string] $OutDir = (Join-Path $PSScriptRoot 'benchmark-results')
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$script:ExplicitPhysicalBatch = $PSBoundParameters.ContainsKey('PhysicalBatchSize')
$script:ApiRoot = $ApiRoot.TrimEnd('/')
$script:OpenAiRoot = "$($script:ApiRoot)/v1"
$script:Results = [System.Collections.Generic.List[object]]::new()
$script:NativeResults = [System.Collections.Generic.List[object]]::new()

function Get-Prop {
    param([AllowNull()] $Object, [string] $Name, $Default = $null)
    if ($null -eq $Object) { return $Default }
    $property = $Object.PSObject.Properties[$Name]
    if ($null -eq $property -or $null -eq $property.Value) { return $Default }
    return $property.Value
}

function Convert-MiBValue {
    param([AllowNull()][string] $Text)
    if ($null -eq $Text) { return $null }
    $parsed = 0
    if ([int]::TryParse($Text.Trim().Trim('[', ']'), [ref]$parsed)) { return $parsed }
    return $null
}

function Get-GpuSnapshot {
    $raw = & nvidia-smi --query-gpu=name,memory.total,memory.used,memory.free,utilization.gpu,pstate --format=csv,noheader,nounits 2>$null
    if ($LASTEXITCODE -ne 0 -or -not $raw) { return $null }
    $lines = @($raw)
    if ($lines.Count -gt 1) { Write-Warning "nvidia-smi reported $($lines.Count) GPUs; capturing the first only." }
    $parts = @($lines[0] -split ',' | ForEach-Object { $_.Trim() })
    if ($parts.Count -lt 6) { Write-Warning "Unexpected nvidia-smi output; GPU snapshot skipped."; return $null }
    [pscustomobject]@{
        name=$parts[0]; memory_total_mib=(Convert-MiBValue $parts[1]); memory_used_mib=(Convert-MiBValue $parts[2])
        memory_free_mib=(Convert-MiBValue $parts[3]); utilization_pct=(Convert-MiBValue $parts[4]); pstate=$parts[5]
        captured_at=(Get-Date).ToString('o')
    }
}

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
        if ($LASTEXITCODE -ne 0) { throw "LM Studio SDK loader failed with exit code ${LASTEXITCODE}." }
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

function Assert-EffectiveConfig {
    param($Config)
    $checks = [ordered]@{
        context_length=$ContextLength; parallel=$Parallel; eval_batch_size=$EvalBatchSize
        physical_batch_size=$PhysicalBatchSize; flash_attention=$true
        offload_kv_cache_to_gpu=[bool]$KvCacheGpu; speculative_draft_mtp=[bool]$Mtp
    }
    $mismatches = [System.Collections.Generic.List[string]]::new()
    foreach ($entry in $checks.GetEnumerator()) {
        $actual = Get-Prop $Config $entry.Key '__missing__'
        if ("$actual" -ne "$($entry.Value)") { $mismatches.Add("$($entry.Key): requested=$($entry.Value), effective=${actual}") }
    }
    if ($mismatches.Count -gt 0) { throw "LM Studio did not apply requested config: $($mismatches -join '; ')" }
    if ($KvCacheGpu -and $KvCacheQuantization -ne 'f16') {
        $kvKeys = @('kv_cache_quantization', 'llama_k_cache_quantization_type', 'llama_v_cache_quantization_type')
        $observed = @($kvKeys | ForEach-Object {
            $value = Get-Prop $Config $_
            if ($null -ne $value) { "${_}=${value}" }
        })
        $confirmed = $observed | Where-Object { ($_ -split '=', 2)[1] -ieq $KvCacheQuantization }
        if ($observed.Count -gt 0 -and -not $confirmed) {
            throw "KV cache quantization '${KvCacheQuantization}' was requested but effective config reports: $($observed -join ', ')."
        }
        if ($confirmed) {
            $script:KvQuantizationVerified = $true
        } else {
            $script:KvQuantizationVerified = $false
            Write-Warning "KV cache quantization '${KvCacheQuantization}' could not be verified: the server reports no quantization fields in its effective config. Recorded as unverified."
        }
    }
}

function New-OpenCodeLikePrompt {
    param([int] $ApproxTokens, [string] $Nonce)
    $targetChars = [int]($ApproxTokens * 2.4)
    $builder = [Text.StringBuilder]::new($targetChars + 1000)
    [void]$builder.AppendLine("CACHE-BUSTER: ${Nonce}")
    [void]$builder.AppendLine('You are a coding agent. Inspect the repository, make minimal edits, run focused tests, and report exact evidence.')
    $i = 0
    while ($builder.Length -lt $targetChars) {
        [void]$builder.AppendLine(('tool_{0:D5}: function(path_{0:D5}: string, line_{0:D5}: integer, pattern_{0:D5}: string): Promise<{{status: "ok"|"error"; output: string}}>;') -f $i)
        $i++
    }
    [void]$builder.AppendLine('Task: inspect retry.go and identify one correctness risk. Answer in one sentence.')
    $builder.ToString()
}

function Convert-Usage {
    param($Usage)
    $promptTokens = [int](Get-Prop $Usage 'prompt_tokens' 0)
    $completionTokens = [int](Get-Prop $Usage 'completion_tokens' 0)
    $details = Get-Prop $Usage 'completion_tokens_details'
    $reasoningTokens = [int](Get-Prop $details 'reasoning_tokens' 0)
    [pscustomobject]@{ prompt=$promptTokens; completion=$completionTokens; reasoning=$reasoningTokens; text=[Math]::Max(0,$completionTokens-$reasoningTokens) }
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
    $stats=Get-Prop $result 'stats'
    $output=@(Get-Prop $result 'output' @())
    $inputTokens=[int](Get-Prop $stats 'input_tokens' 0)
    $totalOutput=[int](Get-Prop $stats 'total_output_tokens' 0)
    $reasoningOutput=[int](Get-Prop $stats 'reasoning_output_tokens' 0)
    $record=[pscustomobject]@{
        phase=$Phase; reasoning_mode=$Reasoning; success=($null-eq$failure); timed_out=$timedOut; error=$failure
        input_tokens=$inputTokens; output_tokens=$totalOutput; reasoning_tokens=$reasoningOutput
        text_tokens=[Math]::Max(0,$totalOutput-$reasoningOutput)
        ttft_sec=if($stats){[Math]::Round([double](Get-Prop $stats 'time_to_first_token_seconds' 0),4)}else{$null}
        authoritative_output_tok_s=if($stats){[Math]::Round([double](Get-Prop $stats 'tokens_per_second' 0),2)}else{$null}
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
            $reasoningPart = [string](Get-Prop $delta 'reasoning_content' '')
            if ($reasoningPart.Length -gt 0) {
                if ($null -eq $firstAnyMs) { $firstAnyMs=$nowMs }
                if ($null -eq $firstReasoningMs) { $firstReasoningMs=$nowMs }
                $lastReasoningMs=$nowMs
                if ($Capture) { [void]$reasoning.Append($reasoningPart) }
            }
            $textPart = [string](Get-Prop $delta 'content' '')
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

function Get-Median {
    param([AllowEmptyCollection()][object[]] $Values)
    $numbers=@($Values|Where-Object{$null-ne$_}|Sort-Object)
    if($numbers.Count-eq0){return $null}
    $mid=[int][Math]::Floor($numbers.Count/2)
    if($numbers.Count%2){return [double]$numbers[$mid]}
    ([double]$numbers[$mid-1]+[double]$numbers[$mid])/2.0
}

function Get-PhaseSummary {
    param([string]$Phase)
    $rows=@($script:Results|Where-Object phase -eq $Phase)
    if($rows.Count-eq0){return $null}
    [pscustomobject]@{
        runs=$rows.Count; prompt_tokens_median=Get-Median @($rows.prompt_tokens); ttft_sec_median=Get-Median @($rows.ttft_sec)
        estimated_prefill_median=Get-Median @($rows.estimated_prefill_tok_s); reasoning_tok_s_median=Get-Median @($rows.reasoning_tok_s)
        text_tok_s_median=Get-Median @($rows.text_tok_s); decode_tok_s_median=Get-Median @($rows.decode_tok_s); wall_sec_median=Get-Median @($rows.wall_sec)
    }
}

function Invoke-GoQualityTest {
    if(-not(Test-Path -LiteralPath $PromptFile -PathType Leaf)){throw "Coding prompt not found: ${PromptFile}"}
    $prompt=Get-Content -LiteralPath $PromptFile -Raw -Encoding utf8
    $result=Invoke-StreamingCompletion -Messages @(@{role='user';content=$prompt}) -Phase 'coding-quality' -TokenLimit $QualityMaxTokens -Capture
    $quality=[ordered]@{visible_output=$result.visible_output;extraction='none';executable=$false;go_test_passed=$false;go_test_output=$null}
    if(-not$result.visible_output){return [pscustomobject]$quality}
    $match=[regex]::Match($result.text,'(?s)```go\s*(.*?)```')
    if($match.Success){
        $quality.extraction='go-tagged'
    } else {
        $match=[regex]::Match($result.text,'(?s)```\s*(.*?)```')
        if(-not$match.Success){return [pscustomobject]$quality}
        $quality.extraction='untagged-fallback'
    }
    $code=$match.Groups[1].Value
    if($code-notmatch'(?m)^\s*package\s+retry\s*$'){return [pscustomobject]$quality}
    $testRoot=Join-Path $env:TEMP "batmobile-quality-$([guid]::NewGuid().ToString('N'))"
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
    Assert-EffectiveConfig -Config $loaded.config
    $lmsPs=(& lms ps --json 2>&1|Out-String).Trim()
    if($KvCacheGpu-and-not[bool]$loaded.config.offload_kv_cache_to_gpu){throw 'GPU KV cache requested but inactive; refusing CPU-spill benchmark.'}

    Write-Host 'Warming model and CUDA kernels...'
    Invoke-StreamingCompletion -Messages @(@{role='user';content='Return exactly: READY'}) -Phase 'warmup' -TokenLimit 16|Out-Null
    $gpuLoaded=Get-GpuSnapshot
    $reasoningCapability=Get-Prop (Get-Prop $catalogRecord 'capabilities') 'reasoning'
    $reasoningOptions=@(Get-Prop $reasoningCapability 'allowed_options' @())
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
    $promptTargets=switch($Suite){'Quick'{@(1000)}'OpenCode'{@($OpenCodePromptTokens)}'Full'{@(1000,8000,$OpenCodePromptTokens,32000)}}
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
foreach($phase in $phaseNames){$summaries[$phase]=Get-PhaseSummary -Phase $phase}
$headroomPass=if($gpuAfter){$gpuAfter.memory_free_mib-ge1536}else{$false}
$document=[ordered]@{
    schema_version=3;timestamp=(Get-Date).ToString('o');label=$Label
    model=[ordered]@{key=$catalogRecord.key;display_name=$catalogRecord.display_name;architecture=$catalogRecord.architecture;quantization=$catalogRecord.quantization;size_bytes=$catalogRecord.size_bytes;params_string=$catalogRecord.params_string;max_context_length=$catalogRecord.max_context_length}
    benchmark=[ordered]@{suite=$Suite;runs=$Runs;max_tokens=$MaxTokens;timeout_sec=$TimeoutSec;open_code_prompt_target=$OpenCodePromptTokens;temperature=$Temperature;reasoning_effort=$ReasoningEffort}
    requested_config=[ordered]@{context_length=$ContextLength;parallel=$Parallel;eval_batch_size=$EvalBatchSize;physical_batch_size=$PhysicalBatchSize;flash_attention=$true;offload_kv_cache_to_gpu=[bool]$KvCacheGpu;kv_cache_quantization=$KvCacheQuantization;num_experts=$NumExperts;speculative_draft_mtp=[bool]$Mtp;mtp_draft_tokens=$MtpDraftTokens}
    effective_config=$(if($loaded){$loaded.config}else{$null});load_response=$loadResponse
    gpu=[ordered]@{before_load=$gpuBefore;after_load=$gpuLoaded;after_benchmark=$gpuAfter;headroom_floor_mib=1536;headroom_pass=$headroomPass;kv_quantization_verified=$script:KvQuantizationVerified}
    lms_ps=$lmsPs;summaries=$summaries;quality=$quality;native_per_run=$script:NativeResults;per_run=$script:Results
    run_error=$script:RunError;incomplete=($null-ne$script:RunError)
}
$timestamp=Get-Date -Format 'yyyyMMdd-HHmmssfff'
$outputPath=Join-Path $OutDir "${timestamp}-${Label}.json"
$document|ConvertTo-Json -Depth 16|Set-Content -LiteralPath $outputPath -Encoding utf8
Write-Host "Saved ${outputPath}"
if($null-eq$gpuAfter){Write-Warning 'GPU telemetry unavailable; VRAM headroom criterion could not be evaluated and fails closed.'}
elseif($headroomPass-eq$false){Write-Warning "Only $($gpuAfter.memory_free_mib) MiB VRAM remained after the benchmark run; configuration fails headroom criterion."}
if($null-ne$caught){throw $caught.Exception}
