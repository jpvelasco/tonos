Set-StrictMode -Version Latest

Assert-That 'Given healthy single-line smi output when snapshotting then fields parse correctly' -Expectation {
    $snap = Get-GpuSnapshot -Attempts 1 -NvidiaSmiCommand { 'NVIDIA RTX, 16383, 12000, 4383, 97, P2'; $global:LASTEXITCODE = 0 }
    Assert-Equal 'NVIDIA RTX' $snap.name
    Assert-Equal 4383 $snap.memory_free_mib
    Assert-Equal 97 $snap.utilization_pct
}

Assert-That 'Given smi fails twice then succeeds when snapshotting with retries then a valid snapshot is returned' -Expectation {
    $script:calls = 0
    $snap = Get-GpuSnapshot -Attempts 3 -RetryMs 1 -NvidiaSmiCommand {
        $script:calls++
        if ($script:calls -lt 3) { $global:LASTEXITCODE = 1; $null } else { 'GPU X, 8192, 100, 8092, 5, P8'; $global:LASTEXITCODE = 0 }
    }
    Assert-Equal 8092 $snap.memory_free_mib
    Assert-Equal 3 $script:calls
}

Assert-That 'Given smi fails on every attempt when snapshotting then null is returned without hanging' -Expectation {
    $snap = Get-GpuSnapshot -Attempts 2 -RetryMs 1 -NvidiaSmiCommand { $global:LASTEXITCODE = 1; $null }
    Assert-Null $snap
}

Assert-That 'Given malformed rows on every attempt when snapshotting then null is returned and nothing throws' -Expectation {
    $snap = Get-GpuSnapshot -Attempts 2 -RetryMs 1 -NvidiaSmiCommand { 'unexpected'; $global:LASTEXITCODE = 0 }
    Assert-Null $snap
}

Assert-That 'Given multiple GPUs reported when snapshotting then the first GPU is captured' -Expectation {
    $snap = Get-GpuSnapshot -Attempts 1 -NvidiaSmiCommand { @('GPU A, 8192, 100, 8092, 5, P8', 'GPU B, 8192, 100, 8092, 5, P8'); $global:LASTEXITCODE = 0 }
    Assert-Equal 'GPU A' $snap.name
}
