[CmdletBinding()]
param([string]$Compiler)
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$testRoot = Join-Path $root ('build/installer-tests/' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force -Path $testRoot | Out-Null
$csc = "$env:WINDIR/Microsoft.NET/Framework64/v4.0.30319/csc.exe"
& $csc /nologo "/out:$testRoot/FakeUPIA.exe" (Join-Path $root 'test/fake-upia.cs')
if ($LASTEXITCODE) { throw 'Cannot compile fake Adobe installer' }
$hostSource = Join-Path $testRoot 'Host.cs'
$hostExe = Join-Path $testRoot 'LayerMathInstallerTestHost.exe'
[IO.File]::WriteAllText($hostSource, 'class Host { static void Main() { System.Threading.Thread.Sleep(600000); } }')
& $csc /nologo "/out:$hostExe" $hostSource
if ($LASTEXITCODE) { throw 'Cannot compile test host' }
$ccx = Join-Path $testRoot 'test.ccx'
$mode = Join-Path $testRoot 'mode.txt'
$state = Join-Path $testRoot 'installed.txt'
$setup = Join-Path $testRoot 'Output/InstallerTest.exe'
$uninstall = Join-Path $testRoot 'App/unins000.exe'
$sentinel = Join-Path $testRoot 'keep-recipe.json'
[IO.File]::WriteAllText($sentinel, 'keep me')
function Assert($condition, [string]$message) { if (-not $condition) { throw $message } }
function Mode([string]$value) { [IO.File]::WriteAllText($mode, $value) }
function Build([string]$version) {
    [IO.File]::WriteAllText($ccx, $version)
    & "$PSScriptRoot/build-installer.ps1" -Ccx $ccx -Compiler $Compiler -TestRoot $testRoot -TestVersion $version
}
function Run([string]$exe, [string]$stage, [bool]$success) {
    $p = Start-Process -FilePath $exe -WindowStyle Hidden -PassThru -ArgumentList @('/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', ('/LOG="{0}"' -f (Join-Path $testRoot "$stage.log")))
    if (-not $p.WaitForExit(60000)) { $p.Kill(); throw "$stage timed out" }
    Assert (($p.ExitCode -eq 0) -eq $success) "$stage returned $($p.ExitCode); see $testRoot/$stage.log"
}
$helper = $null
try {
    Build '0.1.0'
    foreach ($failure in 'fail-list', 'fail-install', 'false-success') {
        Mode $failure; Run $setup $failure $false
        Assert (-not (Test-Path -LiteralPath $uninstall)) 'Failed install registered an uninstaller'
        Assert (-not (Test-Path -LiteralPath $state)) 'Failed install changed Adobe state'
    }
    Mode 'ok'
    Move-Item -LiteralPath (Join-Path $testRoot 'FakeUPIA.exe') -Destination (Join-Path $testRoot 'FakeUPIA.off')
    Run $setup 'missing-adobe' $false
    Move-Item -LiteralPath (Join-Path $testRoot 'FakeUPIA.off') -Destination (Join-Path $testRoot 'FakeUPIA.exe')
    $helper = Start-Process -FilePath $hostExe -WindowStyle Hidden -PassThru
    Run $setup 'photoshop-open' $false
    Stop-Process -Id $helper.Id; $helper.WaitForExit(); $helper = $null
    Run $setup 'install' $true
    Assert ([IO.File]::ReadAllText($state) -eq '0.1.0') 'Wrong installed version'
    Run $setup 'repeat-install' $true
    Build '0.1.1'
    Mode 'fail-install'; Run $setup 'failed-upgrade' $false
    Assert ([IO.File]::ReadAllText($state) -eq '0.1.0') 'Failed upgrade changed existing version'
    Mode 'ok'; Run $setup 'upgrade' $true
    Assert ([IO.File]::ReadAllText($state) -eq '0.1.1') 'Upgrade did not install new version'
    $helper = Start-Process -FilePath $hostExe -WindowStyle Hidden -PassThru
    Run $setup 'blocked-upgrade' $false; Run $uninstall 'blocked-uninstall' $false
    Stop-Process -Id $helper.Id; $helper.WaitForExit(); $helper = $null
    foreach ($failure in 'fail-remove', 'false-remove') {
        Mode $failure; Run $uninstall $failure $false
        Assert (Test-Path -LiteralPath $uninstall) 'Failed removal lost retry path'
        Assert (Test-Path -LiteralPath $state) 'Failed removal lost installed state'
    }
    Mode 'ok'; Run $uninstall 'uninstall' $true
    # Inno's self-deletion helper can outlive the uninstaller process briefly.
    for ($i = 0; $i -lt 40 -and (Test-Path -LiteralPath $uninstall); $i++) { Start-Sleep -Milliseconds 250 }
    Assert (-not (Test-Path -LiteralPath $state)) 'Removal did not reach Adobe'
    Assert (-not (Test-Path -LiteralPath $uninstall)) 'Uninstall left wrapper'
    Assert ([IO.File]::ReadAllText($sentinel) -eq 'keep me') 'Recipe sentinel changed'
    Assert (-not (Test-Path 'HKCU:/Software/Microsoft/Windows/CurrentVersion/Uninstall/LayerMath.Photoshop.InstallerTest_is1')) 'Uninstall left registration'
    Write-Host "Installer tests passed. Adobe boundary mocked; no real plugins changed. Logs: $testRoot"
} finally {
    if ($helper -and -not $helper.HasExited) { Stop-Process -Id $helper.Id }
}
