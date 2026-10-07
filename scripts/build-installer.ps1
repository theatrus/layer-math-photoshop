[CmdletBinding()]
param([Parameter(Mandatory)][string]$Ccx, [string]$Compiler, [string]$TestRoot, [string]$TestVersion)
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$Ccx = (Resolve-Path -LiteralPath $Ccx).Path
if (-not $Compiler) { $Compiler = & "$PSScriptRoot/get-inno.ps1" }
$versionLine = Select-String -LiteralPath (Join-Path $root 'Cargo.toml') -Pattern '^version = "([0-9]+\.[0-9]+\.[0-9]+)"$' | Select-Object -First 1
if (-not $versionLine) { throw 'Cargo package version is missing' }
$version = $versionLine.Matches[0].Groups[1].Value
$output = Join-Path $root 'dist'
$defines = @("/DSourceRoot=$root", "/DPackagePath=$Ccx")
if ($TestRoot) {
    $TestRoot = [IO.Path]::GetFullPath($TestRoot)
    $testBase = [IO.Path]::GetFullPath((Join-Path $root 'build/installer-tests')) + [IO.Path]::DirectorySeparatorChar
    if (-not $TestRoot.StartsWith($testBase, [StringComparison]::OrdinalIgnoreCase)) { throw 'Installer tests must stay under build/installer-tests' }
    if (-not $Ccx.StartsWith($TestRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Test CCX must be inside the isolated test directory' }
    if ($TestVersion) { $version = $TestVersion }
    if ($version -notmatch '^\d+\.\d+\.\d+$') { throw 'Invalid test version' }
    $output = Join-Path $TestRoot 'Output'
    $defines += "/DTestRoot=$TestRoot"
} else {
    if ($TestVersion) { throw 'TestVersion requires TestRoot' }
    # Require a complete CCX and inspect its inner Windows signature before wrapping.
    $checkDir = Join-Path $root ('build/installer-check-' + [guid]::NewGuid().ToString('N'))
    python "$PSScriptRoot/verify-ccx.py" $Ccx --extract-win $checkDir
    if ($LASTEXITCODE) { throw 'CCX verification failed' }
    $signature = Get-AuthenticodeSignature -LiteralPath (Join-Path $checkDir 'x64/layer_math.uxpaddon')
    if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notmatch 'StackFoundry LLC') { throw 'CCX Windows addon lacks a valid StackFoundry LLC signature' }
    if (Test-Path -LiteralPath (Join-Path $output "LayerMath-Photoshop-Windows-x64-Setup-$version.exe")) { throw 'Output exists; move it aside first' }
}
New-Item -ItemType Directory -Force -Path $output | Out-Null
& $Compiler @defines "/DPluginVersion=$version" "/DOutputRoot=$output" (Join-Path $root 'installer/windows.iss')
if ($LASTEXITCODE) { throw 'Windows installer compilation failed' }
Write-Host 'Setup compiled. Release setup must be signed and verified before hashing or distribution.'
