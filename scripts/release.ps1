# Archive a verified build. Does not build, commit, push, publish, or remove files.
$ErrorActionPreference = 'Stop'
$workspacePath = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$manifestPath = Join-Path $workspacePath 'package.json'
$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
$version = $manifest.version
if ($version -notmatch '^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$') { throw 'Invalid release version' }
$releasePath = [IO.Path]::GetFullPath((Join-Path $workspacePath "release/$version"))
$releaseRoot = [IO.Path]::GetFullPath((Join-Path $workspacePath 'release'))
if (-not $releasePath.StartsWith($releaseRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Release path escapes workspace' }
$appPath = Join-Path $releasePath 'MyMonitor-win32-x64'
$archivePath = Join-Path $appPath 'resources/app.asar'
$exePath = Join-Path $appPath 'MyMonitor.exe'
if (-not (Test-Path -LiteralPath $archivePath) -or -not (Test-Path -LiteralPath $exePath)) { throw 'Run npm run package first' }
if ((Get-Item -LiteralPath $appPath).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Linked distribution directories are not supported' }
$zipName = "MyMonitor-v$version-windows-x64.zip"
$zipPath = Join-Path $releasePath $zipName
if (Test-Path -LiteralPath $zipPath) { throw 'ZIP already exists; preserve it outside this directory before creating a new candidate' }
$exeVersion = (Get-Item -LiteralPath $exePath).VersionInfo.ProductVersion
if ($exeVersion -ne $version) { throw "Executable version differs: $exeVersion vs $version" }
Push-Location $workspacePath
try {
  & node scripts/verify-package.mjs $archivePath
  if ($LASTEXITCODE -ne 0) { throw 'Packaged source verification failed' }
} finally { Pop-Location }
# Retain Electron/Chromium notices already present in the distribution.
Copy-Item -LiteralPath (Join-Path $workspacePath 'LICENSE') -Destination (Join-Path $appPath 'LICENSE.MyMonitor.txt')
$notesPath = Join-Path $workspacePath "docs/releases/v$version.md"
if (-not (Test-Path -LiteralPath $notesPath)) { throw "Missing release notes: docs/releases/v$version.md" }
Copy-Item -LiteralPath $notesPath -Destination (Join-Path $releasePath 'RELEASE_NOTES.md')
Add-Type -AssemblyName System.IO.Compression.FileSystem
Add-Type -AssemblyName System.IO.Compression
# Explicit entry names keep standard '/' separators even on Windows PowerShell
# 5.1, whose older ZipFile.CreateFromDirectory may write backslashes.
$entries = @(Get-ChildItem -LiteralPath $appPath -Recurse -Force)
if (@($entries | Where-Object { $_.Attributes -band [IO.FileAttributes]::ReparsePoint }).Count -gt 0) { throw 'Linked distribution entries are not supported' }
$zip = [IO.Compression.ZipFile]::Open($zipPath, [IO.Compression.ZipArchiveMode]::Create)
try {
  foreach ($entry in $entries | Where-Object { -not $_.PSIsContainer }) {
    $relativeName = $entry.FullName.Substring($appPath.Length + 1).Replace('\', '/')
    [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $entry.FullName, "MyMonitor-win32-x64/$relativeName", [IO.Compression.CompressionLevel]::Optimal) | Out-Null
  }
} finally { $zip.Dispose() }
$hash = (Get-FileHash -LiteralPath $zipPath -Algorithm SHA256).Hash.ToLowerInvariant()
$checksumPath = Join-Path $releasePath 'SHA256SUMS.txt'
[IO.File]::WriteAllText($checksumPath, "$hash  $zipName`n", [Text.UTF8Encoding]::new($false))
Write-Output "Prepared: $zipPath"
Write-Output "SHA256: $hash"
