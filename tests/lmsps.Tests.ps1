Set-StrictMode -Version Latest

Assert-That 'Given lms ps returns valid JSON when capturing telemetry then parsed instances are returned' -Expectation {
    $fake = { '[{"modelKey":"m1"},{"modelKey":"m2"}]' | Out-String; $global:LASTEXITCODE = 0 }
    $snap = Get-LmsPsSnapshot -FetchCommand $fake
    Assert-Equal 2 @($snap).Count
    Assert-Equal 'm1' @($snap)[0].modelKey
}

Assert-That 'Given lms ps prints error prose when capturing telemetry then null is recorded' -Expectation {
    $fake = { 'Error: daemon not running'; $global:LASTEXITCODE = 1 }
    Assert-Null (Get-LmsPsSnapshot -FetchCommand $fake)
}

Assert-That 'Given lms ps exits zero with unparseable output when capturing telemetry then null is recorded' -Expectation {
    $fake = { '<html>gateway junk</html>'; $global:LASTEXITCODE = 0 }
    Assert-Null (Get-LmsPsSnapshot -FetchCommand $fake)
}

Assert-That 'Given lms ps produces no output when capturing telemetry then null is recorded' -Expectation {
    $fake = { ''; $global:LASTEXITCODE = 0 }
    Assert-Null (Get-LmsPsSnapshot -FetchCommand $fake)
}
