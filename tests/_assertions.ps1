Set-StrictMode -Version Latest
$script:PassCount = 0
$script:FailCount = 0

function Assert-That {
    param([Parameter(Mandatory)][string] $Scenario, [Parameter(Mandatory)][scriptblock] $Expectation)
    try {
        & $Expectation
        $script:PassCount++
        Write-Host "PASS $Scenario" -ForegroundColor Green
    } catch {
        $script:FailCount++
        Write-Host "FAIL $Scenario" -ForegroundColor Red
        Write-Host "     $($_.Exception.Message)" -ForegroundColor DarkRed
    }
}

function Assert-Equal {
    param([Parameter(Mandatory)][AllowNull()] $Expected, [Parameter(Mandatory)][AllowNull()] $Actual, [string] $Because = 'values differ')
    if ("$Expected" -ne "$Actual") { throw "expected '$Expected' but got '$Actual' ($Because)" }
}

function Assert-True {
    param([Parameter(Mandatory)] $Condition, [string] $Because = 'condition was false')
    if (-not $Condition) { throw $Because }
}

function Assert-Null {
    param([AllowNull()] $Actual, [string] $Because = 'expected null')
    if ($null -ne $Actual) { throw "$Because but got '$Actual'" }
}

function Assert-Throws {
    param([Parameter(Mandatory)][scriptblock] $Action, [string] $MessageLike)
    try { & $Action } catch {
        if ($MessageLike -and "$($_.Exception.Message)" -notlike "*$MessageLike*") {
            throw "threw '$($_.Exception.Message)' which does not contain '$MessageLike'"
        }
        return
    }
    throw 'expected a terminating error but none occurred'
}
