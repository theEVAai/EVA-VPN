param(
  [Parameter(Mandatory=$true)][int]$ParentId,
  [Parameter(Mandatory=$true)][string]$Target,
  [Parameter(Mandatory=$true)][string]$Source,
  [Parameter(Mandatory=$true)][string]$ExpectedHash
)
$ErrorActionPreference = 'Stop'
$portableTarget = [IO.Path]::GetFullPath($Target)
$updateSource = [IO.Path]::GetFullPath($Source)
$portableDirectory = Split-Path -Parent $portableTarget
$token = [Guid]::NewGuid().ToString('N')
$staged = Join-Path $portableDirectory ('.eva-update-' + $token + '.exe')
$backup = Join-Path $portableDirectory ('.eva-previous-' + $token + '.exe')
$movedOriginal = $false
try {
  if ([IO.Path]::GetExtension($portableTarget) -ne '.exe' -or $portableTarget -eq $updateSource) { throw 'Invalid portable update path' }
  if ($ExpectedHash -notmatch '^[0-9a-f]{64}$') { throw 'Invalid checksum' }
  if ((Get-FileHash -LiteralPath $updateSource -Algorithm SHA256).Hash -ne $ExpectedHash) { throw 'Update checksum mismatch' }
  # All moves below use these three absolute paths in the portable directory.
  foreach ($file in @($staged, $backup)) {
    if ((Split-Path -Parent ([IO.Path]::GetFullPath($file))) -ne $portableDirectory) { throw 'Invalid update destination' }
  }
  Copy-Item -LiteralPath $updateSource -Destination $staged
  if (Get-Process -Id $ParentId -ErrorAction SilentlyContinue) { Wait-Process -Id $ParentId -Timeout 90 -ErrorAction Stop }
  # The outer portable launcher can release its file after the Electron child.
  $deadline = [DateTime]::UtcNow.AddSeconds(30)
  do {
    try { Move-Item -LiteralPath $portableTarget -Destination $backup; $movedOriginal = $true; break }
    catch { if ([DateTime]::UtcNow -ge $deadline) { throw }; Start-Sleep -Milliseconds 300 }
  } while ($true)
  Move-Item -LiteralPath $staged -Destination $portableTarget
  Start-Process -FilePath $portableTarget -WorkingDirectory $portableDirectory -WindowStyle Normal
  # Keep the previous executable available for a manual rollback.
} catch {
  if ($movedOriginal -and (Test-Path -LiteralPath $backup)) {
    if (Test-Path -LiteralPath $portableTarget) { Remove-Item -LiteralPath $portableTarget -Force }
    Move-Item -LiteralPath $backup -Destination $portableTarget
    Start-Process -FilePath $portableTarget -WorkingDirectory $portableDirectory -WindowStyle Normal
  }
  $_.Exception.Message | Set-Content -LiteralPath (Join-Path (Split-Path -Parent $updateSource) 'portable-update-error.txt') -Encoding UTF8
} finally {
  if (Test-Path -LiteralPath $staged) { Remove-Item -LiteralPath $staged -Force }
}
