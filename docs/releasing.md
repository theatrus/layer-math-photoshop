# Build a release

Ship one cross-platform CCX inside the Windows setup, macOS DMG, and ZIP files.
Adobe installs and removes the plugin. Do not copy UXP files into native Plug-ins folders.

The Inno build/test scripts and DMG layout, alias checks, signing and notarization
follow [xisf-photoshop](https://github.com/theatrus/xisf-photoshop).
The Windows wrapper uses [Adobe UPIA](https://developer.adobe.com/uxp/guides/how-to/distribution/install/#use-the-upia-tool),
waits for completion, and checks the installed version. Installation runs as the
current Windows user. Adobe owns rollback of its plugin files; setup does not
modify Adobe's database or migrate other plugins.

## Current checks

- Windows setup compiles with Inno Setup 6.7.3. Isolated tests pass for missing
  Adobe tools, failed/false-success installs, repeat install, upgrade, failed
  upgrade, Photoshop-running checks, failed removal, removal and recipe preservation.
  These tests use a fake UPIA and do not change real Adobe installations.
- [Windows signing and Mac signing/notarization smoke tests passed](https://github.com/theatrus/layer-math-photoshop/actions/runs/37679773453).
- The DMG builder checks both Mac architectures and publisher signatures, signs,
  notarizes and staples the image, remounts it, checks Finder metadata and resolves
  the background alias through macOS. It compares the CCX and documentation bytes.
  CI runs `scripts/test-dmg-build.sh` with test binaries to exercise construction
  and remounting without Adobe SDKs. The release DMG still needs a Finder visual check.
- Real CCX install/update/removal, the Adobe distribution ID, minimum Photoshop
  version and both Mac architectures still need release validation.

## 1. Enable signed native builds

Provision the pinned SDK once. The script uploads encrypted SDK input only and
stores the decryption key as a repository secret. It refuses an existing SDK release.

```powershell
python scripts/provision-sdk.py "$env:USERPROFILE/Downloads/uxp-hybrid-plugin-sdk-v6.5.0.zip" --repo theatrus/layer-math-photoshop
gh variable set ENABLE_SIGNING --repo theatrus/layer-math-photoshop --body true
```

The repository already has the signing environment and credentials. Check its
environment rules if a signing job cannot authenticate. Do not copy OIDC repository
identifiers from another project.

## 2. Tag the source and build addons

Set the same version in `Cargo.toml`, `Cargo.lock`, `package.json`,
`package-lock.json`, and `uxp/manifest.json`. Commit it, then create and push
the matching `v<version>` tag. The tag starts CI.

After CI passes, check out that exact tag and download both signed artifacts from
the same CI run. Use a clean checkout; release packaging rejects tracked changes.

```powershell
gh run download <run-id> -n LayerMath-win-signed -D build/addons/win
gh run download <run-id> -n LayerMath-mac-signed -D build/addons/mac
python scripts/artifact.py verify win --signed
python scripts/artifact.py verify mac --signed
```

## 3. Assemble the CCX on a Photoshop host

Start Photoshop's UXP Developer Service. Adobe CLI 1.2.0 needs a connected host
for packaging; this step does not run on GitHub's hosted runners.

```powershell
python scripts/package-uxp.py --cli C:/tools/node_modules/@adobe/uxp-devtools-cli/src/uxp.js
```

This creates the versioned CCX, its checksum, and `dist/LayerMath-release-input.json`.
The record binds the CCX hash to the source commit and version. Packaging verifies
the signed addon inventories. Later jobs check the record and panel source bytes.

## 4. Build setup and DMG from a draft

For version 0.1.0:

```powershell
gh release create v0.1.0 --verify-tag --draft --title 'Layer Math 0.1.0' --notes 'Release validation in progress.' dist/LayerMath-Photoshop-0.1.0.ccx dist/LayerMath-Photoshop-0.1.0.ccx.sha256 dist/LayerMath-release-input.json
gh workflow run release.yml --ref main -f release_tag=v0.1.0
```

The workflow downloads the draft inputs once, verifies the tag/source/hash, and
uses the same CCX for both platforms. It produces:

- `LayerMath-Windows-release`: Azure-signed setup EXE, ZIP, and checksums.
- `LayerMath-macOS-release`: signed, notarized, stapled DMG, ZIP, and checksums.

Checksums are computed after signing and stapling. The workflow does not publish
the draft. Download both artifacts, run the host checks below, then upload the
validated files to the existing draft. Publish that draft after validation.

## Host checks

On a disposable Windows user account, install with setup, reinstall, upgrade,
and remove it. Confirm the plugin version in Creative Cloud and load it in
Photoshop. Check failure/cancellation paths and keep exported recipes and PSDs.
Repeat installation through the CCX directly. Unload the UDT development copy
before checking the installed plugin.

On Intel and Apple silicon Macs, open the final DMG in Finder. Check its artwork,
labels and CCX launch. Install, load, update and remove the plugin through Adobe.
Run the Photoshop smoke suites at 16 and 32 bits. Check Gatekeeper on a downloaded
copy. ZIP delivery also needs an installation check; bare addon binaries cannot
carry stapled notarization tickets.

After publishing, download each asset and verify its `.sha256` file.

## Local packaging commands

```powershell
./scripts/test-installer.ps1
./scripts/build-installer.ps1 -Ccx dist/LayerMath-Photoshop-0.1.0.ccx
```

Local setup compilation requires a signed Windows addon inside the complete CCX.
It emits an unsigned EXE; sign and verify that EXE before distribution.

```sh
bash scripts/build-macos-dmg.sh dist/LayerMath-Photoshop-0.1.0.ccx 'Developer ID Application: StackFoundry LLC (HSRHLHH333)'
```

Set `APPLE_API_KEY_PATH`, `APPLE_API_KEY` and `APPLE_API_ISSUER` for notarization.
The DMG script refuses an existing output and hashes the final verified image.
