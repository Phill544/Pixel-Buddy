param(
    # Steam Deck IP or hostname. Remembered in .deckip after the first run.
    [string]$DeckIP,

    # First-time setup (also rerun after changing plugin.json or reinstalling
    # Decky): installs your SSH key on the Deck, installs the plugin with sudo
    # and restarts Decky. Asks for your Deck password at most twice.
    [switch]$Setup
)

$ErrorActionPreference = "Stop"

$DeckUser = "deck"
$PluginName = "pixel-buddy"
$Dest = "/home/$DeckUser/homebrew/plugins/$PluginName"
$Staging = "/tmp/$PluginName-deploy"
$DeckIPFile = ".deckip"

# $ErrorActionPreference doesn't cover native commands like ssh and scp, so
# check their exit codes explicitly
function Assert-Success([string]$Step) {
    if ($LASTEXITCODE -ne 0) {
        Write-Error "$Step failed (exit code $LASTEXITCODE)."
        exit 1
    }
}

function Test-KeyAuth([string]$Target) {
    # Redirecting a native command's stderr raises errors under "Stop" in Windows PowerShell
    $ErrorActionPreference = "Continue"
    ssh -o BatchMode=yes -o ConnectTimeout=5 $Target true 2>$null | Out-Null
    return $LASTEXITCODE -eq 0
}

if (-not $DeckIP) {
    if (Test-Path $DeckIPFile) {
        $DeckIP = (Get-Content $DeckIPFile -Raw).Trim()
    } else {
        $DeckIP = Read-Host "Steam Deck IP"
    }
}
Set-Content -Path $DeckIPFile -Value $DeckIP -Encoding ascii
$Target = "$DeckUser@$DeckIP"

if (-not (Test-Path "bin/pbpctrl")) {
    Write-Error "bin/pbpctrl not found. Build it first (see README)."
    exit 1
}

Write-Host "Building plugin..." -ForegroundColor Cyan
& node "node_modules/rollup/dist/bin/rollup" -c
Assert-Success "Build"

if (-not (Test-Path "dist/index.js")) {
    Write-Error "dist/index.js missing after build."
    exit 1
}

Write-Host ""
Write-Host "Deploying to ${Target}:${Dest}" -ForegroundColor Cyan

if ($Setup -and -not (Test-KeyAuth $Target)) {
    $KeyFile = @("$HOME\.ssh\id_ed25519.pub", "$HOME\.ssh\id_rsa.pub") |
        Where-Object { Test-Path $_ } | Select-Object -First 1
    if (-not $KeyFile) {
        Write-Error "No SSH key found. Create one with: ssh-keygen -t ed25519"
        exit 1
    }
    $PublicKey = (Get-Content $KeyFile -Raw).Trim()

    Write-Host ""
    Write-Host "Installing your SSH key ($KeyFile) so future deploys don't need a password..."
    ssh $Target "mkdir -p ~/.ssh && chmod 700 ~/.ssh && touch ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys && (grep -qxF '$PublicKey' ~/.ssh/authorized_keys || echo '$PublicKey' >> ~/.ssh/authorized_keys)"
    Assert-Success "Installing SSH key"
}

Write-Host ""
Write-Host "Uploading files..."
ssh $Target "rm -rf $Staging && mkdir -p $Staging"
Assert-Success "Creating staging folder"
scp "dist/index.js" "bin/pbpctrl" "main.py" "package.json" "${Target}:${Staging}/"
Assert-Success "Uploading files"

if ($Setup) {
    # Decky only hot-reloads a plugin on file changes when it has the "debug"
    # flag. Add it to the Deck's copy only, so the store build stays unchanged.
    $PluginJson = Get-Content "plugin.json" -Raw | ConvertFrom-Json
    $PluginJson.flags = @($PluginJson.flags | Where-Object { $_ -ne "debug" }) + "debug"
    $DevPluginJson = Join-Path $env:TEMP "$PluginName-plugin.json"
    # plugin.json must not have a BOM, which Set-Content -Encoding UTF8 adds
    [System.IO.File]::WriteAllText($DevPluginJson, ($PluginJson | ConvertTo-Json -Depth 10), (New-Object System.Text.UTF8Encoding $false))
    scp $DevPluginJson "${Target}:${Staging}/plugin.json"
    Assert-Success "Uploading plugin.json"

    $InstallSteps = (
        "sudo mkdir -p $Dest/dist $Dest/bin",
        "sudo install -m 755 $Staging/pbpctrl $Dest/bin/pbpctrl",
        "sudo cp $Staging/main.py $Staging/package.json $Staging/plugin.json $Dest/",
        "sudo cp $Staging/index.js $Dest/dist/index.js",
        "sudo chown -R ${DeckUser}:${DeckUser} $Dest",
        "rm -rf $Staging"
    ) -join " && "

    # Stop Decky while copying. Copying into a running Decky makes it hot-reload
    # the plugin mid-restart, which can orphan a plugin process and stop the old
    # Decky from exiting. Start it again even if a copy step fails.
    Write-Host ""
    Write-Host "Installing with sudo and restarting Decky..."
    ssh -t $Target "sudo systemctl stop plugin_loader && { $InstallSteps; }; status=`$?; sudo systemctl start plugin_loader; exit `$status"
    Assert-Success "Installing plugin"
} else {
    # Decky makes the plugin folder and plugin.json root-owned whenever it loads
    # the plugin, but leaves the other files writable by deck, so overwrite
    # those in place. Changing main.py and dist/index.js makes Decky hot-reload
    # the plugin.
    Write-Host ""
    Write-Host "Installing..."
    ssh $Target ((
        "grep -q debug $Dest/plugin.json",
        # Swap the binary in with a rename, which works even while pbpctrl is running
        "install -m 755 $Staging/pbpctrl $Dest/bin/pbpctrl.new",
        "mv -f $Dest/bin/pbpctrl.new $Dest/bin/pbpctrl",
        "cp $Staging/package.json $Staging/main.py $Dest/",
        "cp $Staging/index.js $Dest/dist/index.js",
        "rm -rf $Staging",
        # Decky queues hot reloads from a background thread, and only handles
        # them once its event loop next wakes up. Wake it with a request to its
        # local web server.
        "sleep 1",
        "{ curl -s -o /dev/null http://127.0.0.1:1337/frontend/index.js || true; }"
    ) -join " && ")
    if ($LASTEXITCODE -ne 0) {
        Write-Error "Installing failed. If this is the first deploy (or Decky was reinstalled), run: .\deploy.ps1 -Setup"
        exit 1
    }
}

Write-Host ""
if ($Setup) {
    Write-Host "Done! Plugin installed to $Dest. Future deploys won't need a password." -ForegroundColor Green
} else {
    Write-Host "Done! Decky is reloading the plugin." -ForegroundColor Green
}
