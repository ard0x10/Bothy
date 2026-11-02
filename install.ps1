# Installs the latest Bothy release for the current user.
#
#   irm https://raw.githubusercontent.com/ard0x10/Bothy/main/install.ps1 | iex
#
# Finds the installer on the latest GitHub release, downloads it to the temp
# folder, runs it and removes it again. Nothing else on the machine is touched.

& {
    $ErrorActionPreference = 'Stop'
    # Windows PowerShell 5.1 offers older TLS first, which GitHub refuses, and
    # its progress bar slows a download to a crawl.
    [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
    $ProgressPreference = 'SilentlyContinue'

    $release = Invoke-RestMethod -Uri 'https://api.github.com/repos/ard0x10/Bothy/releases/latest' -Headers @{ 'User-Agent' = 'bothy-install' }
    $asset = $release.assets | Where-Object { $_.name -like 'Bothy-Setup-*.exe' } | Select-Object -First 1
    if (-not $asset) {
        throw "The latest release ($($release.tag_name)) has no installer yet. Try again in a few minutes."
    }

    $setup = Join-Path $env:TEMP $asset.name
    Write-Host "Downloading $($asset.name)..."
    Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $setup -UseBasicParsing

    try {
        Write-Host 'Running the installer...'
        $run = Start-Process -FilePath $setup -Wait -PassThru
    } finally {
        Remove-Item -LiteralPath $setup -Force -ErrorAction SilentlyContinue
    }
    if ($run.ExitCode -eq 0) {
        Write-Host 'Bothy is installed. Find it in the Start Menu.'
    } else {
        Write-Host "The installer stopped without installing (exit code $($run.ExitCode))."
    }
}
