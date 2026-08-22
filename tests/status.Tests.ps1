Set-StrictMode -Version Latest

function New-FakeCatalog {
    [pscustomobject]@{
        key = 'llm-a'
        type = 'llm'
        display_name = 'Model A'
        loaded_instances = @([pscustomobject]@{ id = 'llm-a' })
    }
    [pscustomobject]@{
        key = 'llm-b'
        type = 'llm'
        display_name = 'Model B'
        loaded_instances = @()
    }
    [pscustomobject]@{
        key = 'embed-x'
        type = 'embedding'
        display_name = 'Embedder X'
        loaded_instances = @()
    }
}

Assert-That 'Given a catalog with loaded, unloaded, and embedding models when building status rows then type and load state are truthful' -Expectation {
    $rows = @(Get-StatusRows -Models (New-FakeCatalog))
    Assert-Equal 3 $rows.Count
    Assert-Equal 'llm-a' $rows[0].Key
    Assert-True $rows[0].Loaded -Because 'llm-a has an active instance'
    Assert-True (-not $rows[1].Loaded) -Because 'llm-b has no instances'
    Assert-Equal 'embedding' $rows[2].Type
}

Assert-That 'Given an empty catalog when building status rows then zero rows are returned without throwing' -Expectation {
    Assert-Equal 0 @(Get-StatusRows -Models @()).Count
}
