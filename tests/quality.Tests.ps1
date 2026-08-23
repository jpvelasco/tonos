#requires -Version 7.0
Set-StrictMode -Version Latest

$fence = '```'
$goFence = '```go'

Assert-That 'Given no visible output when classifying quality then extraction stays none and nothing executes' -Expectation {
    $quality = Convert-QualityText -VisibleOutput $false -Text $null
    Assert-Equal 'none' $quality.extraction
    Assert-Equal $false $quality.executable
    Assert-Equal $false $quality.go_test_passed
}

Assert-That 'Given visible text without any code fence when classifying quality then extraction is none' -Expectation {
    $quality = Convert-QualityText -VisibleOutput $true -Text 'No code here, just prose.'
    Assert-Equal 'none' $quality.extraction
}

Assert-That 'Given a go-tagged block with the retry package when classifying quality then mode is go-tagged and code is extracted' -Expectation {
    $code = "package retry`n`nfunc LastError() error { return nil }`n"
    $text = "Here is my fix:`n$goFence`n$code$fence`nDone."
    $quality = Convert-QualityText -VisibleOutput $true -Text $text
    Assert-Equal 'go-tagged' $quality.extraction
    Assert-True $quality.code.Contains('package retry')
    Assert-Equal $false $quality.executable -Because 'execution happens in the file-system phase, not classification'
}

Assert-That 'Given an untagged fence containing the retry package when classifying quality then mode falls back to untagged-fallback' -Expectation {
    $code = "package retry`nfunc X() {}`n"
    $text = "Output:`n$fence`n$code$fence"
    $quality = Convert-QualityText -VisibleOutput $true -Text $text
    Assert-Equal 'untagged-fallback' $quality.extraction
}

Assert-That 'Given a fenced block without the retry package declaration when classifying quality then no code is accepted' -Expectation {
    $text = "$goFence`npackage main`nfunc main() {}`n$fence"
    $quality = Convert-QualityText -VisibleOutput $true -Text $text
    Assert-Null $quality.code -Because 'only package retry sources are eligible for execution'
}
