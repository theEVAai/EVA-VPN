param([Parameter(Mandatory=$true)][string]$Installer)
$ErrorActionPreference = 'Stop'
trap {
  $message = ($_ | Out-String).Replace('%', '%25').Replace("`r", '%0D').Replace("`n", '%0A')
  Write-Output "::error title=Installer acceptance::$message"
  break
}
if ($env:CI -ne 'true') { throw 'Installer acceptance must run on a clean CI machine.' }

$installerPath = (Resolve-Path -LiteralPath $Installer).Path
$installDir = Join-Path $env:ProgramFiles 'EVA VPN Acceptance'
$appExe = Join-Path $installDir 'EVA VPN.exe'
$evidenceDir = Join-Path $PWD 'dist/acceptance'
New-Item -ItemType Directory -Force -Path $evidenceDir | Out-Null

function Install-Eva([string]$file) {
  Write-Output "Installing $file into $installDir"
  $process = Start-Process -FilePath $file -ArgumentList "/S /allusers /D=$installDir" -WindowStyle Hidden -Wait -PassThru
  if ($process.ExitCode -ne 0) { throw "Installer exited with $($process.ExitCode)" }
  if (-not (Test-Path -LiteralPath $appExe)) { throw 'Installer did not create the application.' }
}

function Check-Eva([string]$name, [string]$migration = '', [string]$executable = $appExe) {
  & node scripts/check-ui.mjs --exe $executable --source (Join-Path $installDir 'resources/app.asar') --evidence (Join-Path $evidenceDir $name) $migration
  if ($LASTEXITCODE -ne 0) { throw "$name acceptance failed" }
}

try {
  Install-Eva $installerPath
  Check-Eva 'clean-install'

  # Download only public release artifacts. Upgrade in this disposable machine,
  # never on the developer's installed working copy.
  $legacy = Join-Path $env:RUNNER_TEMP 'EVA-VPN-0.3.1-x64.exe'
  Invoke-WebRequest -Uri 'https://github.com/theEVAai/EVA-VPN/releases/download/v0.3.1/EVA-VPN-0.3.1-x64.exe' -OutFile $legacy
  # Remove this CI installation first so testing a downgrade does not rely on an
  # unsupported version order. The old app is only installed, never connected.
  $uninstaller = Get-ChildItem -LiteralPath $installDir -Filter '*ninstall*.exe' | Select-Object -First 1
  if (-not $uninstaller) { throw 'Missing uninstaller' }
  $removed = Start-Process -FilePath $uninstaller.FullName -ArgumentList '/S /allusers' -WindowStyle Hidden -Wait -PassThru
  if ($removed.ExitCode -ne 0) { throw 'CI uninstall failed' }
  Install-Eva $legacy
  $profileDir = Join-Path $env:APPDATA 'EVA VPN'
  New-Item -ItemType Directory -Force -Path $profileDir | Out-Null
  # Preserve a legacy-compatible key and preference through the upgrade.
  $legacyKey = @{id='legacy-saved'; name='Legacy saved key'; type='vless'; server='127.0.0.1'; port=31001; uuid='11111111-2222-4333-8444-555555555555'; link='vless://11111111-2222-4333-8444-555555555555@127.0.0.1:31001?security=none&type=tcp#Legacy'; color='#e8503a'; source='manual'}
  $fixture = @{ profiles=@($legacyKey); subs=@(); activeId='legacy-saved'; settings=@{ mode='proxy'; language='ru'; mtu=1420; autoStart=$false; autoConnect=$false; vpnPriority=$false } }
  $settingsFile = Join-Path $profileDir 'settings.json'
  $fixture | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $settingsFile -Encoding utf8NoBOM
  & node node_modules/electron/cli.js scripts/install-fixture.cjs $installerPath $installDir $profileDir
  if ($LASTEXITCODE -ne 0) { throw 'Updater could not launch the installer.' }
  $deadline = (Get-Date).AddMinutes(3)
  do {
    Start-Sleep -Seconds 2
    $restarted = @(Get-CimInstance Win32_Process -Property ProcessId,ExecutablePath -ErrorAction SilentlyContinue |
      Where-Object { $_.ExecutablePath -eq $appExe })
    if ((Get-Date) -gt $deadline) { throw 'Updated application did not restart after installation.' }
  } until ($restarted.Count -gt 0)
  Start-Sleep -Seconds 2
  $restarted | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  $saved = Get-Content -LiteralPath $settingsFile -Raw | ConvertFrom-Json
  if ($saved.settings.mtu -ne 1420) { throw 'Upgrade lost the legacy settings.' }
  Check-Eva 'upgrade-0.3.1' '--migration'
  $portable = Join-Path (Split-Path $installerPath) ('EVA-VPN-' + (Get-Content package.json | ConvertFrom-Json).version + '-portable.exe')
  Check-Eva 'portable' '--continue-fixture' $portable
} finally {
  # Clean up only processes and network state owned by this disposable test.
  Get-CimInstance Win32_Process -Property ProcessId,ExecutablePath -ErrorAction SilentlyContinue |
    Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith($installDir + '\', [StringComparison]::OrdinalIgnoreCase) } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  & node -e "require('./src/main/netfix').guardCleanup().then(()=>require('./src/main/netfix').clearSystemProxy())"
}
