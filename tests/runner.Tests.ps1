Set-StrictMode -Version Latest

Assert-That 'Given the assertion library when asserting equality of equal values then it passes' -Expectation {
    Assert-Equal 42 42
}

Assert-That 'Given unequal values when asserting equality then it throws naming both values' -Expectation {
    Assert-Throws { Assert-Equal 1 2 } -MessageLike "expected '1' but got '2'"
}

Assert-That 'Given a failing expectation when using Assert-Throws then mismatched messages are reported' -Expectation {
    Assert-Throws { throw 'exact expected text' } -MessageLike 'expected text'
}
