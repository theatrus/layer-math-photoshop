[CmdletBinding()]
param([string]$UxpSdk = $env:UXP_HYBRID_SDK, [switch]$BackendOnly)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
Push-Location $projectRoot
try {
    $vswhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
    $vs = & $vswhere -latest -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
    if (-not $vs) { throw 'Install Visual Studio C++ build tools and a Windows SDK.' }
    & (Join-Path $vs 'Common7\Tools\Launch-VsDevShell.ps1') -Arch amd64 -HostArch amd64 -SkipAutomaticLocation | Out-Null
    cargo fmt --check
    if ($LASTEXITCODE) { throw 'Rust format check failed' }
    cargo clippy --locked --all-targets -- -D warnings
    if ($LASTEXITCODE) { throw 'Clippy failed' }
    cargo test --locked
    if ($LASTEXITCODE) { throw 'Rust tests failed' }
    cargo build --release --locked --target x86_64-pc-windows-msvc
    if ($LASTEXITCODE) { throw 'Rust release build failed' }
    New-Item -ItemType Directory -Force build/native | Out-Null
    $lib = Join-Path $projectRoot 'target/x86_64-pc-windows-msvc/release/layer_math_photoshop.lib'
    $libs = @($lib, 'ws2_32.lib', 'userenv.lib', 'bcrypt.lib', 'ntdll.lib', 'advapi32.lib')
    & cl.exe /nologo /std:c++17 /EHsc /O2 /MD /W4 native/abi_smoke.cpp /Fobuild/native/abi_smoke.obj /Febuild/native/abi_smoke.exe /link @libs
    if ($LASTEXITCODE) { throw 'ABI harness compilation failed' }
    & ./build/native/abi_smoke.exe
    if ($LASTEXITCODE) { throw 'ABI smoke failed' }
    if ($BackendOnly) { return }
    if (-not $UxpSdk -or -not (Test-Path -LiteralPath $UxpSdk)) { throw 'Set UXP_HYBRID_SDK or pass -UxpSdk to the extracted hybrid SDK. Backend checks passed.' }
    $sdkRoot = (Resolve-Path -LiteralPath $UxpSdk).Path
    $headers = @(Get-ChildItem -LiteralPath $sdkRoot -Filter UxpAddon.h -Recurse | Where-Object FullName -NotMatch '[\\/]template[\\/]')
    if ($headers.Count -ne 1) { throw 'Expected one SDK src/utilities/UxpAddon.h outside template copies.' }
    $include = $headers[0].DirectoryName
    New-Item -ItemType Directory -Force build/addons/win/x64 | Out-Null
    & cl.exe /nologo /std:c++17 /EHsc /O2 /MD /W4 /LD "/I$include" native/addon.cpp /Fobuild/native/addon.obj /link @libs /OUT:build/addons/win/x64/layer_math.uxpaddon /IMPLIB:build/native/layer_math.lib
    if ($LASTEXITCODE) { throw 'UXP addon compilation failed' }
    python scripts/stage.py --platform win
    if ($LASTEXITCODE) { throw 'Plugin staging failed' }
} finally { Pop-Location }
