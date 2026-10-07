# Layer Math implementation plan

This document describes the first-release target. Acceptance criteria below
are not claims that every gate has passed. See the implementation status below
and [development guide](../DEVELOPMENT.md) for the tested subset.

## Implementation status (2026-10-07)

- Implemented: bounded Rust expression engine and C ABI, Windows hybrid addon
  built against SDK 6.5.0, feasibility panel, input bindings, recipe import/export,
  numeric crop inspection, range analysis, transactional output and host smoke tests.
- Implemented: typed pixel/mask inputs, one-shot layer-mask output and live pixel
  results with in-place refresh, saved formulas, Pause/Resume/Freeze, dependency
  ordering and Undo protection. PSD recipes persist in document XMP by layer ID.
- Verified locally: Rust/JS/Python tests, compiled C++ ABI harness, and Photoshop
  27.10.0 on Windows. RGB/grayscale at both depths, HDR, hidden input, exact output,
  undo, write-pass cancellation, new-32-bit documents and partial tiles pass.
- Packaged: an unsigned Windows development CCX using Adobe CLI 1.2.0 and the
  local Developer Service; packaged addon bytes verified. Clean installation
  has not yet been validated.
- Implemented but not yet exercised on their target infrastructure: macOS builds,
  trusted SDK CI, platform signing jobs, notarization, and DMG generation/checks.
- Packaging added: Inno setup via Adobe UPIA, isolated lifecycle tests, versioned
  ZIPs, source/hash-bound CCX records, and a draft-input release workflow for
  signed setup and signed/notarized DMG. See [release steps](releasing.md).
- Signing configuration: Windows and Mac signing/notarization smoke jobs passed.
- Still open: SDK repository provisioning, both Mac host checks, minimum
  host validation, installer lifecycle, large-image performance/parallel evaluation,
  rendered preview/function browser, fuller layer configuration coverage and
  new-document metadata. Inputs currently exclude nested layers, vector/filter
  masks and effects; ordinary pixel-mask inputs are supported.

The initial scripts require Python **3.11+** for `tomllib`. The reference below
uses 3.10+; this is an intentional toolchain difference. Milestone 0 is partially
implemented and remains open until signing and cross-platform installation pass.

The build and distribution baseline is `xisf-photoshop`, reviewed on 2026-10-07
at commit [`d40d9ad`](https://github.com/theatrus/xisf-photoshop/tree/d40d9ad7fe078d2140c029c942dfaf793b9a8b42).
Mirror its local setup, private SDK handling, separate signing jobs, Windows
setup behavior, macOS DMG quality, and verification discipline. Where its native
file-format packaging differs from this design's UXP hybrid packaging, the
adaptation is specified below. The implementation status above distinguishes
working code from open infrastructure and host-verification gates. No credentials
or release infrastructure have been provisioned by this document.

## Product

A Photoshop plugin for combining aligned image layers using a documented subset
of PixelMath-style expressions. General layer arithmetic is the initial focus,
with star recombination and narrowband mixing as the first presets.

Build this as a separate product and repository from the FITS/XISF file-format
plugins. It operates on Photoshop documents; importing astronomy file formats is
not part of this plugin.

## First-release scope

- RGB and grayscale documents, at 16 or 32 bits per channel.
- Multiple raster-layer inputs from the current document.
- Input aliases such as `A`, `B`, `Stars`, `Starless`, `Ha`, and `OIII`.
- One expression evaluated independently for each output channel, or separate
  R/G/B expressions for RGB documents.
- Arithmetic, comparisons, lazy conditionals, named scalar constants, and the
  functions and blend operators in the [language specification](expression-language.md).
- `combine(A, B, op_screen())` and related operators are required v1 functionality.
- Full-resolution crop preview, pixel-value inspection, and an optional reduced
  overview explicitly labeled approximate.
- New result layer as the normal output; explicit new 32-bit document output.
- Optional live result refresh and scalar pixel-mask inputs; one-shot mask output.
- Reusable recipes, cancellation, progress, and a single undoable apply operation.

Do not include automatic alignment, resizing, cross-document inputs, neighborhood
filters, global image statistics, loops, arbitrary scripts, GPU execution, live
Smart Filters, or full PixInsight compatibility in v1.

## Input and layer semantics

Aliases bind to document/layer IDs, not layer positions or names. Layer renaming
or reordering must not silently change a bound input. A missing layer stops
evaluation and requests remapping. Imported recipes always request input binding;
IDs in one document are not portable identities for another document.

V1 accepts opaque, aligned, full-canvas pixel layers. Require Normal blend mode,
100% opacity and fill, and no vector/filter masks, effects, clipping relationships,
adjustment layers, Smart Objects, or group compositing effects on the inputs.
List unsupported inputs with the reason and require a user-prepared raster copy.
Validate parent-group effects too. Pixel alpha and document bounds must be checked
from returned data, not inferred solely from the layer type or thumbnail.

The intended input is each layer's own stored channels, independent of visibility.
The feasibility milestone must prove hidden-layer reads, offsets, masks, and
effects behave as expected. Unsupported host behavior must stop with a clear
diagnostic. Do not read a composite as source pixels. For ordinary pixel masks,
the tested adapter disables the mask inside a modal suspended-history scope,
reads raw channels and restores its enabled state before commit. Preview and
failed/unchanged operations roll back. Source visibility is never changed.

### Masks and live result behavior

Bindings record a layer ID and an explicit Pixels/Mask kind. Mask values are
normalized 0–1 scalar inputs, broadcast to RGB. Require density 100%, feather 0
and full-canvas returned bounds; mask enabled state does not alter raw values.
Use `mix(A, B, M)` to blend through a mask. Write layer mask is a separate,
one-shot destination with one expression and bounded output, even in 32-bit.

Live result is a normal pixel layer with a saved formula. Formula changes and
source edits update its pixels in place, preserving its layer identity, mask,
position and appearance. No clipping relationship is required. Photoshop does
not provide the recomputation; the plugin must be running with the document
active. Unchanged input samples/settings produce no output write or history step.
Poll document history, debounce changes, and evaluate dependencies upstream first.
Reject feedback cycles and retain the last good output when an input is missing
or evaluation fails. Undo pauses automatic writes until explicit Resume.

Store versioned recipes and typed bindings in document XMP under persistent layer
IDs, preserving unrelated metadata; PSD save/reopen is tested. Copying a result
layer alone does not transfer a recipe. Pause is per-document session state;
Freeze persists the disabled state. Direct painting on result pixels requires
Freeze to prevent later source changes replacing those edits. Smart Filters and
custom adjustment-layer integration remain outside this implementation.

Selections are outside v1 scope. Require the user to clear an active selection
before Apply so the output region is unambiguous.

## Precision and output range

Normalize native Photoshop 16-bit values using 32768, including the endpoint.
Float32 input retains its decoded values, including finite negatives and HDR.
Use Float64 intermediates initially; write Float32 or Photoshop-native 16-bit
samples only at the final output boundary. Benchmark this choice before adding
alternative precision modes.

| Destination | Behavior |
| --- | --- |
| 32-bit result | Preserve finite results representable in Float32; reject invalid values or overflow |
| 16-bit, all results within 0..1 | Preserve scale and round once to 0..32768 |
| 16-bit, any result outside 0..1 | Require an explicit range policy before committing output |

Out-of-range choices are **Rescale**, **Clip**, or **New 32-bit document**. Recommend
Rescale. For a nonconstant result, map its global minimum and maximum to 0 and 1,
using one common range across RGB. A constant out-of-range result cannot be
meaningfully min/max rescaled: request explicit clipping or 32-bit output.
Show the measured range and explain precision and absolute-scale loss.

Use a first pass for range/validity analysis and a second pass for rescaling when
needed. Both passes must use the same input snapshot. Never normalize separately
per tile or per channel. A reduced preview cannot decide the final output range.

Document bit depth applies to all layers. Do not convert a source document merely
to create a 32-bit result: create a new 32-bit document when requested. Do not
promise to recover precision or scale already lost in a 16-bit source.

## Color and metadata

Evaluate stored channel values in the document's color space and profile, with
no automatic stretch, linearization, gamma transform, or conversion to sRGB.
The same equation can look different on linear and display-encoded images.

Match the document profile when reading and writing pixels. Verify Photoshop's
32-bit linear-profile naming behavior in the host adapter. A display stretch,
if later added for preview, must never alter computed output.

New layers retain the current document's profile and metadata. For a new result
document, transfer the reference document's dimensions, resolution, profile,
and explicitly supported metadata. Do not merge metadata from unrelated sources
or replace the astronomy plugins' retention packet with recipe data.

## Interface and recipes

The panel contains input bindings, a function/operator browser, an expression
editor, scalar parameters, preview, output settings, and Apply/Cancel controls.
Provide error locations and show the relevant pixel/channel for numeric errors.
The operator browser inserts calls such as `combine(A, B, op_screen())` and
explains argument order and applicable value ranges.

Provide presets for additive and screen star recombination, a weighted blend,
SHO/HOO mapping, and a conditional replacement. Explain that additive and screen
recombination require stars extracted with compatible methods; they are not
interchangeable recipes for all star-only images.

Recipes store a format version, language version, expressions, scalar parameters,
input aliases, output mode, and range policy. Global defaults and document-specific
choices are separate. Unsupported future versions fail explicitly.
The JSON in [examples](../examples/recipes.json) illustrates the planned format;
the implementation milestone must introduce a schema and validate imports.

## Architecture

Preferred design: **UXP panel -> thin C++ hybrid addon -> Rust evaluator**.

- UXP manages the document, input bindings, pixel transfers, UI, and history.
- A small C++ addon bridges native buffers and Rust through a versioned C ABI.
- Rust parses and validates expressions once, compiles a typed intermediate
  representation, and evaluates bounded tiles. `op_*` descriptors resolve during
  compilation rather than creating callbacks or objects for every pixel.
- Parallelize CPU evaluation. Photoshop API calls remain on the supported host
  execution path. Use bounded buffers and dispose host image data promptly.
- Snapshot inputs or hold an appropriate modal/history scope so sources cannot
  change between tiles or between range and output passes.
- Write only a new output. Publish it when complete; errors and cancellation roll
  back the temporary layer/document and preserve source data and user settings.

The Photoshop C++ SDK already exposes layer descriptors and channel read ports.
Keep that as a fallback integration route if the UXP feasibility tests cannot
preserve required pixel semantics or performance. Do not commit to the fallback
without measuring the limitation.

Reuse the prior project's precision lessons, Rust/native ABI discipline, large
image tests, and release verification. Hybrid integration uses a different SDK
and package format; existing C++ format-plugin builds are not drop-in packaging.
Determine the minimum Photoshop version from the actual APIs used and test it.

### Native boundary and repository layout

Statically link the Rust evaluator into the C++ addon. No separate evaluator
process or Rust runtime DLL is required. Keep the expression engine independent
of Adobe headers so contributors and pull-request CI can build it without an SDK.
The C ABI must define its version, buffer dimensions/strides/sample types, ownership,
error lifetime, cancellation, and destruction of compiled expressions. Catch Rust
panics and C++ exceptions before they cross that boundary. Validate lengths and
overflow before accessing caller buffers; do not retain borrowed UXP values after
their valid lifetime. Worker threads own their data and never call Photoshop APIs.

Use this planned layout, retaining familiar script entry points from the reference:

| Path | Responsibility |
| --- | --- |
| `Cargo.toml`, `Cargo.lock`, `rust-toolchain.toml` | Evaluator/static library, locked dependencies, pinned Rust |
| `src/`, `tests/` | Parser, typed IR, evaluator, range analysis, independent numerical tests |
| `native/` | Small UXP bridge, versioned C header, C++/Rust ABI smoke harness |
| `uxp/` | Manifest, panel, Photoshop adapter, recipes and generated addon staging |
| `scripts/build.ps1`, `scripts/build-macos.sh` | Local build and native smoke checks |
| `scripts/ci_sdk.py` | Encrypted SDK acquisition contract, verification and cleanup |
| `scripts/sign-macos.sh`, `scripts/notarize-macos.sh` | Addon signing and notarization, adapted from the reference |
| `scripts/package-uxp.*` | Validated CCX packaging entry point; tooling selected in milestone 0 |
| `scripts/build-installer.ps1`, `installer/windows.iss` | Windows setup wrapper once Adobe installation handoff is proven |
| `scripts/build-macos-dmg.sh`, `scripts/dmg-layout.py` | Branded DMG with installation instructions |
| `scripts/test-installer.ps1`, `scripts/test-macos-dmg.sh` | Isolated installer and final-image verification |
| `.github/workflows/` | Public tests, trusted builds, signing, packaging, signing smoke test |

Generated files belong in ignored `target/`, `build/`, `dist/`, and `.sdk/` trees.
Keep Adobe SDK files, credentials, local images, and developer machine paths out
of Git and distributables. Carry forward applicable Apache-2.0 notices when
adapting scripts; generate a `NOTICE` for dependencies actually shipped.

## Setup and SDK management

### Local toolchain

Start with the reference's pinned Rust **1.98.0**, `rustfmt`, `clippy`, locked
Cargo dependencies, and C++17. This is the observed reference pin, not a claim
that it is the latest release. Record exact tested compiler, SDK, UXP Developer
Tool (UDT), and packaging-tool versions in the future `DEVELOPMENT.md`.

| Build | Setup and target |
| --- | --- |
| Evaluator only | Rust; `cargo fmt --check`, `cargo clippy --locked --all-targets -- -D warnings`, `cargo test --locked` |
| Windows x64 addon | Visual Studio C++ Build Tools and Windows SDK; MSVC `x86_64-pc-windows-msvc`; Release build with no debug-runtime dependency |
| macOS addons | Mac with Xcode and Python 3.10+; Rust `aarch64-apple-darwin` and `x86_64-apple-darwin`; test the runner's native architecture and inspect both outputs |
| Panel development | Photoshop, UDT, UXP Hybrid Plugin SDK; pin any JS build/test runtime and commit its lockfile |
| DMG generation | macOS tools plus isolated Python environment; reference pins `ds-store==1.3.3` and `mac-alias==2.2.3` |
| Windows setup | Reference's portable, SHA-256-verified Inno Setup 6.7.3, staged under `build/tools` |

Preserve `build.ps1 -BackendOnly` as the SDK-free Rust plus C++ ABI path.
The planned hybrid build uses `-UxpSdk <path>` / `UXP_HYBRID_SDK` on Windows
and the equivalent explicit path or environment variable on macOS. Reserve
`-PhotoshopSdk` / `PHOTOSHOP_SDK` for a C++ host-adapter experiment; do not silently
accept the wrong SDK because both products use C++.

Use the UXP Hybrid Plugin SDK for the preferred architecture. The Adobe Photoshop
C++ SDK 2026 v2 used by `xisf-photoshop` is only needed if testing the native
fallback. Its `PIFormat.h`, `cnvtpipl.exe`, format PiPL resources and
`FormatRecord` harness do not register a UXP panel.

Adobe documents a hybrid host floor of Photoshop 24.2.0; the selected Imaging
APIs may impose a higher floor. Finalize manifest settings, minimum Photoshop
and OS versions against the downloaded SDK and tested hosts. Do not inherit
the reference's macOS 11.0 deployment target as a support promise.
[Adobe hybrid overview](https://developer.adobe.com/uxp/guides/how-to/hybrid-plugins/)

### Encrypted build inputs

Mirror the reference's `sdk-2026-v2` build-input release pattern: encrypted SDK
archives held outside source, a checked-in SHA-256 allowlist for the original
archives, and a repository decryption secret passed to GnuPG through stdin.
For this repository, record the chosen hybrid SDK release, platform archive
names, hashes and required headers before enabling trusted builds. Use
`UXP_HYBRID_SDK_PASSPHRASE` for those inputs; keep
`PHOTOSHOP_SDK_PASSPHRASE` separate if the fallback SDK is needed. The reference's
SDK hashes identify C++ SDK archives and must not be reused for hybrid inputs.

Acquire the SDK through Adobe's permitted distribution route. Encrypt with
AES256 and verify the decrypted ZIP before extraction; reject unsafe archive
paths. Always remove CI-created plaintext archives and extracted SDK files,
including on failure. Cleanup must never target a developer's external SDK
installation. Never upload plaintext SDKs, SDK examples, or SDK contents in logs,
caches, test artifacts, or release packages.

SDK-backed builds run only for trusted upstream `main`, `v*` tags and permitted
manual runs. Pull requests run SDK-free checks without decryption or signing
credentials; do not use `pull_request_target`. Fork contributors can use their
own SDK locally. Copying workflow files does not provision secrets, release
assets, Azure authorization, or the GitHub `signing` environment in this repository.

## Installation and distribution contract

### Hybrid package and identities

The preferred design produces one versioned CCX containing the panel and signed
native addons for Windows x64, macOS arm64 and macOS x64. Use Adobe's required
`win/x64`, `mac/arm64`, and `mac/x64` addon layout. Both Mac architectures are
required; do not assume the native project's `lipo`-combined `.plugin` bundle
can substitute for that layout. Verify loading on both kinds of Mac.
Adobe's documented packaging path is UDT creating a `.ccx` installer.
[Adobe hybrid build and packaging](https://developer.adobe.com/uxp/guides/how-to/hybrid-plugins/build)

Milestone 0 must select and prove a repeatable packaging command/tool or document
a UDT packaging handoff. Do not label a renamed ZIP as a validated CCX or claim
fully unattended CI packaging until it has been demonstrated. Pin the selected
tool and test that packaging preserves native signatures and architecture paths.

Use **Layer Math for Photoshop** as the display name and `LayerMath-Photoshop`
as the artifact stem. Establish a stable, separate Adobe plugin ID, native code
identifiers, settings namespace, and Windows setup AppId before first release.
Do not reuse Seiza's identities, installation ownership, preferences or backups.
Derive all versions from the root Cargo package and verify the manifest, native
metadata, installer, filenames and release tag agree.

| Planned artifact | Contents and installation |
| --- | --- |
| `LayerMath-Photoshop-<version>.ccx` | Canonical cross-platform hybrid installer; Adobe manages installation and updates |
| `LayerMath-Photoshop-Windows-x64-Setup-<version>.exe` | Signed setup wrapper around that CCX, contingent on verified Adobe handoff |
| `LayerMath-Photoshop-Windows-x64.zip` | Same CCX plus installation notes, license and notices |
| `LayerMath-Photoshop-macOS-universal-<version>.dmg` | Signed, notarized, stapled image containing the same CCX and documentation |
| `LayerMath-Photoshop-macOS-universal.zip` | Alternative transport for the same CCX and documentation |
| Matching `.sha256` files | Hashes of final bytes after signing, packaging and stapling |

The CCX is the installation payload inside the DMG and Windows wrapper.
The DMG's artwork should instruct users to open the CCX and follow Adobe's
installer. Do not include a shortcut to the native Photoshop Plug-ins directory
for this route. An Inno wrapper must use a supported Adobe installation handoff,
report its completion accurately, and explain prerequisites. It must not copy
UXP files into native plugin folders or directly manipulate Adobe-managed state.
If completion/update/uninstall cannot be verified, keep the wrapper behind its
gate and document CCX installation as the supported Windows setup route.

If measured host limitations force a native C++ architecture, record that
decision and replace this package contract before implementation. That route
can reuse the shared-folder installer and DMG shortcut from `xisf-photoshop`,
with Layer Math's own registration type and identities. A layer-processing plugin
must not inherit file-format `.8bi`/`8BIF` registration by copying Seiza resources.

### Windows signing and setup

Mirror the reference's Azure Artifact Signing flow in a separate `sign-windows`
job under GitHub environment **`signing`**. Grant `contents: read` and
`id-token: write` only where needed. Configure these environment variables:

| Variable | Purpose |
| --- | --- |
| `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID` | Azure OIDC login |
| `SIGNING_ENDPOINT`, `SIGNING_ACCOUNT`, `SIGNING_PROFILE` | Artifact Signing endpoint/account/certificate profile |

Reuse the existing signing service and **StackFoundry LLC** publisher where
authorized, with a federated credential for this repository's actual OIDC subject
and the Certificate Profile Signer role. The reference uses an ID-qualified
subject; do not copy its repository IDs or assume GitHub's default subject form.
Keep `environment: signing` aligned with that credential. Limit the environment
to `main` and `v*` tags, matching the reference's no-manual-reviewer setup.

Sign the Windows `.uxpaddon` first with SHA-256 and an RFC3161 timestamp using
the reference's Azure signing action. Verify Authenticode validity and expected
publisher before CCX assembly. After building the setup wrapper around the final
CCX, sign and verify the EXE, then recompute its checksum. An outer installer
signature alone is insufficient. Keep signing credentials out of ordinary builds.

Port the on-demand signing smoke workflow using a throwaway PE and the same
action, identity, environment and verification as production. Run it after
configuring this repository and after credential/profile changes. Follow the
reference's executable workflow conditions: signing covers trusted main/tag/manual
builds, despite an older smoke-workflow comment saying it is tag-only.

Adapt the setup regression suite to the actual Adobe handoff: first install,
repeat install, upgrade, Photoshop-running handling, cancellation/failure, locked
files, and uninstall. Preserve recipes, preferences and unrelated plugins.
Wrapper-owned files and backups use Layer Math paths and an isolated test AppId.
Filesystem tests stay under `build/installer-tests`; real CCX lifecycle tests use
a disposable host/user environment. Never scan for or migrate Seiza plugins.

### macOS signing, notarization and DMG

Use a separate `sign-macos` job in the same protected `signing` environment.
Mirror the reference's six environment secrets by name:

- `APPLE_BUILD_CERTIFICATE`: base64 Developer ID Application P12 and private key.
- `APPLE_BUILD_CERTIFICATE_PASSWORD`: P12 password.
- `KEYCHAIN_PASSWORD`: temporary CI keychain password.
- `APPLE_API_ISSUER`: App Store Connect issuer ID.
- `APPLE_API_KEY`: API key ID.
- `APPLE_API_KEY_PRIVATE`: base64 P8 key.

Import into an ephemeral keychain, select the Developer ID Application identity
by name rather than a renewal-sensitive thumbprint, and verify the expected team.
Delete the keychain, P12 and P8 on success or failure. SDK inputs and decryption
secrets do not enter signing jobs. Preserve local ad-hoc builds for development;
release jobs require valid signing and notarization and must fail closed.

Validate the expected addon paths, architectures, identities and versions before
signing. Sign the Mac executables with Developer ID, hardened runtime and secure
timestamps, then verify each signature. Submit a ZIP of the signed native payload
to `notarytool`, require `Accepted`, retain the submission ID and inspect its log.
Only those verified bytes may enter the CCX.

Adapt the reference's notarization helper rather than invoking its mandatory
bundle-stapling loop unchanged: a standalone `.uxpaddon` is not a stapleable
`.plugin` bundle, and ZIPs cannot be stapled. Separate submission from stapling
of supported containers. After CCX assembly, build, sign and notarize the DMG,
staple and validate its ticket, assess it with Gatekeeper, then hash it.
Test a browser-downloaded package on a clean Mac, including the installed addon's
first load; do not infer installed-addon or offline behavior from DMG acceptance
alone. Record any network requirement for the CCX/ZIP installation path.
[Apple notarization workflow](https://developer.apple.com/documentation/security/customizing-the-notarization-workflow)

Carry forward the reference's DMG engineering with Layer Math artwork and layout:

- Generate Finder metadata without driving Finder, using a temporary Python venv.
- Create the background alias on the mounted image with resolved paths, avoiding
  build-machine `/var` versus `/private/var` links.
- Keep complete icon-view settings, valid grid spacing, window bounds and icon
  positions synchronized with the instruction background.
- Refuse to overwrite an existing release image. Size staging for the actual CCX
  rather than inheriting the reference's fixed 64 MiB image size.
- Remount the final compressed DMG read-only at a different path; verify the
  background bytes, alias file IDs and macOS alias resolution, layout, exact CCX
  hash, documentation and signatures. Verification never installs the product.
- Open that final image in Finder, eject and reopen it, and check readable text,
  unclipped labels, saved layout and the CCX launch flow on a test machine.

## CI and release flow

Adapt `.github/workflows/ci.yml` and `signing-smoke-test.yml` from the pinned
reference, using this repository's names and identities. Pin actions by commit,
use checkout with `persist-credentials: false`, read-only default permissions,
bounded job timeouts and same-ref concurrency cancellation. Record the checked-out
source SHA in every job. All artifacts in a package must belong to that same SHA
and version; validate their inventory before executing any packaging step.

1. **Public checks:** Windows and macOS evaluator tests, formatting, clippy,
   generated numerical fixtures, SDK-free C++/Rust ABI tests, panel tests and
   recipe/schema validation. Run on pull requests as well as trusted builds.
2. **Trusted native builds:** decrypt the appropriate SDK, compile Windows x64
   and both Mac targets, run available native checks, and upload unsigned/ad-hoc
   archives with one-day retention. Always clean plaintext SDK material.
3. **Platform signing:** sign/verify the Windows addon and sign/notarize/verify
   the Mac addons in independent jobs. Treat downloaded artifacts as data, with
   an explicit expected-file inventory. Neither job needs the SDK.
4. **CCX assembly:** combine the panel and both platforms' verified payloads using
   the tool proven in milestone 0. Verify paths, versions and preserved signatures.
   If UDT still requires a manual step, record that handoff and package checksum;
   do not mark this stage automated. Feed this exact CCX to both wrapper jobs.
5. **Distribution wrappers:** build/sign/verify Windows setup if its gate passes;
   build/sign/notarize/staple/verify the DMG; create ZIP alternatives. Hash final
   outputs and retain validated development artifacts for 30 days.
6. **Release:** after host and installation gates pass, publish the original
   validated files and SHA-256 files to GitHub Releases. Never repackage a signed
   release during upload. Download the published assets and verify their hashes.

Keep the reference's manual `macos_runner` choice (`macos-15` or
`macos-15-intel`) and optional existing `release_tag` rebuild input. Both runner
choices must build both Mac architectures. A tag rebuild must validate the input
as an allowed existing release tag and use its exact commit in every job; record
the workflow revision separately because the run's `headSha` may refer to the
workflow branch. Runner-native tests and architecture inspection do not replace
interactive Photoshop validation on Apple silicon and Intel.

The release evidence should identify source/workflow commits, version, SDK and
toolchain pins, native architecture checks, signature/publisher verification,
notarization IDs, final hashes, installer results, and the Photoshop/OS versions
used for precision, performance and host checks. Private astronomy images remain
local; publish only non-sensitive measurements and generated test fixtures.

## Milestones and acceptance gates

### 0. Reproducible setup and installable skeleton

Adapt the build skeleton and establish the SDK-free Rust/C++ ABI check. Acquire
and pin the hybrid SDK; make the minimal panel load its addon on Windows x64,
Apple silicon and Intel. Register Layer Math's identities, configure encrypted
CI inputs and signing, and pass the Azure smoke test. Package a minimal signed
CCX and install it on clean hosts; prove the DMG flow and assess the Inno wrapper
handoff. Record the packaging automation decision, actual host/OS minimums,
upgrade/uninstall behavior, and notarization/stapling targets. This gate must
pass before the interface implementation expands beyond the feasibility panel.

### 1. Real Photoshop feasibility

Read two layers, calculate `A+B` and `combine(A,B,op_screen())`, and produce a new
layer in 16-bit and 32-bit documents. Verify exact known pixel values, negative/HDR
Float32, profile preservation, hidden inputs, bounds, undo, cancellation, and
new-32-bit-document output in real Photoshop on Windows and Mac. Probe every
excluded layer configuration to ensure it is detected. Measure tiled transfers
and memory on a large image. Record SDK/API requirements before building the UI.

### 2. Expression engine

Implement parsing, typed operator descriptors, scalar broadcasting, channel
selection, lazy conditionals, functions, and numerical diagnostics. Test operator
identities, operand order, branch boundaries, HDR extension, invalid domains,
rounding, and all 32,769 native 16-bit codes. Fuzz malformed expressions and set
explicit limits on expression length, nesting, and compiled work per pixel.

### 3. Usable workflow

Build the editor, operator browser, input binding, full-resolution preview,
recipe persistence, range analysis, and output transaction. Verify renamed,
deleted, and reordered layers; preset remapping; cancellations during both passes;
unchanged source pixels; and one-step undo. Compare preview crops with final output.

### 4. Packaging and release

Complete the CI and distribution contract above using the actual evaluator and
panel. Pass installation, upgrade, cancellation and uninstall checks; verify the
signed addons inside the final CCX, the signed Windows setup if supported, and
the notarized/stapled DMG and its Finder layout. Finish user installation notes,
developer setup, third-party notices, and a tested compatibility matrix. Publish
only validated artifacts; complete the release check by downloading the published
assets and comparing them with the recorded checksums.

Use real Photoshop on both platforms as a release gate. Record precision and
profile results, not just successful load or screenshots. Include a locally held
large astronomy image comparable to the Iris image from the previous project;
do not commit or upload private source images. Report throughput and peak memory.

## References

- [Adobe Imaging API](https://developer.adobe.com/photoshop/uxp/2022/ps-reference/media/imaging)
  documents per-layer reads, pixel writes, native depth ranges, profiles, and memory handling.
- [Adobe hybrid plugins](https://developer.adobe.com/uxp/guides/how-to/hybrid-plugins/)
  describes the UXP/native bridge and platform requirements.
- [FITS and XISF for Photoshop](https://github.com/theatrus/xisf-photoshop)
  is the related project whose integration lessons inform this plan.
- [Reference CI](https://github.com/theatrus/xisf-photoshop/blob/d40d9ad7fe078d2140c029c942dfaf793b9a8b42/.github/workflows/ci.yml)
  is authoritative for the reviewed job conditions and both platform signing flows.
- [Reference development guide](https://github.com/theatrus/xisf-photoshop/blob/d40d9ad7fe078d2140c029c942dfaf793b9a8b42/DEVELOPMENT.md)
  and [scripts](https://github.com/theatrus/xisf-photoshop/tree/d40d9ad7fe078d2140c029c942dfaf793b9a8b42/scripts)
  supply local setup, encrypted SDK, installer, signing and DMG verification patterns.
