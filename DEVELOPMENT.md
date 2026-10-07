# Developing Layer Math

This is a working Windows feasibility build, not a signed public release.
The engine, C ABI, native addon and Photoshop integration are implemented.
macOS builds and DMG scripts still require target-host verification. Both signing
smoke jobs passed. See [release steps](docs/releasing.md) and the
[full design](docs/plan.md).

## Build and test

Use Rust 1.98.0 (selected by `rust-toolchain.toml`), Node 22+ (tested with
24.7.0), Python 3.11+ (tested with 3.12), and C++17. Python 3.11 is needed for
`tomllib`; this is higher than the reference project's Python 3.10 requirement.

```powershell
cargo test --locked
npm ci
npm test
python -m unittest discover -s test -p "test_*.py"
./scripts/build.ps1 -BackendOnly
./scripts/build.ps1 -UxpSdk C:\path\to\uxp-hybrid-plugin-sdk-main
```

The Windows script finds Visual Studio Build Tools with `vswhere`, builds the
release Rust static library, runs the real C++ ABI harness, and compiles the
addon. Tested with MSVC 14.51.36231. No Adobe headers are required for backend
tests. The hybrid SDK is **6.5.0**, pinned by the ZIP hash in
[scripts/sdk.json](scripts/sdk.json). Extract it outside Git and point
`UXP_HYBRID_SDK` or `-UxpSdk` at the directory containing `src`.

On macOS, install Xcode, the same Rust toolchain, and Python 3.11+:

```sh
bash scripts/build-macos.sh --backend-only
bash scripts/build-macos.sh /path/to/uxp-hybrid-plugin-sdk-main
```

The script emits separate `mac/arm64` and `mac/x64` addons, inspects both
architectures and runs the ABI test on the local architecture. The deployment
target is provisionally macOS 12; it is not a tested support promise yet.

Builds stage an allowlisted UXP plugin in a fresh `build/plugin-*` directory.
`build/staged-plugin.json` records its path and native hashes. Add that directory's
manifest to Adobe UXP Developer Tool, or load it using Adobe CLI 1.2.0. Enable
Photoshop developer mode and start the UXP Developer Service first. The manifest
currently declares Photoshop 25.0+, but only **27.10.0 on Windows** has been tested.

## Use the feasibility panel

Open a 16-bit or 32-bit RGB or grayscale document, then open Plugins > Layer Math.
Refresh layers, bind each alias, enter a shared expression or separate RGB
expressions, and Apply. The panel supports recipe presets and recipe file
import/export. Imported recipes always require fresh bindings. Renames/reordering
retain IDs when refreshing the same document; switching documents clears them.

The compact panel uses 2 px button corners, a scrolling editor and a persistent
Apply footer. Parameters and crop inspection expand on demand; parameterized
presets open their values automatically. Switching built-in presets keeps bindings
for matching aliases in the same document. The 35 presets include arithmetic,
difference, minimum/maximum, average, overlay, soft light, gain/offset, background
subtraction, inversion, midtones, gamma, threshold masks and channel mapping.
Formulas are plain text; named parameters use editable name/value rows, with
duplicate names, empty values and non-finite values rejected before evaluation.
JSON is used only internally and in recipe files.

The current adapter accepts opaque full-canvas **top-level** raster layers only.
Nested layers and layers with vector/filter masks, effects or clipping are rejected.
Ordinary pixel masks are supported. Clear selections first. Pixel inputs must use Normal blend
mode and 100% opacity/fill. Numeric failures leave no output. A successful Apply
is one history step. Source layer pixels and visibility remain unchanged.

## Masks and live results

Each binding now chooses **Pixels** or **Mask**. Pixels reads stored channels
independently of the layer's ordinary pixel mask; Mask reads that mask as a scalar
from 0 (black) to 1 (white), broadcast across RGB. Bind `A` and `B` as Pixels and
`M` as Mask, then use `mix(A, B, M)` or `A*M`. A pixel mask must have density 100%
and feather 0. Vector/filter masks and masks whose returned bounds are cropped
are unsupported. Disabled pixel masks can still be read as raw mask inputs.

Choose **Write layer mask** and a target layer to create or replace its pixel
mask. Use one shared expression; for RGB luminance, for example,
`0.2126*A[0]+0.7152*A[1]+0.0722*A[2]`. Masks always require a 0–1 range policy,
including in 32-bit documents. An input mask cannot also be the output target.
Mask output is currently a one-shot operation; live output is a pixel result layer.

Check **Live result**, then Apply. Source pixel/mask edits trigger a refresh after
they settle while the plugin is running and the document is active. Subsequent
formula/parameter edits update the same result after a short delay. Its layer ID,
stack position, name, mask, opacity and visibility are preserved. Clipping masks
are not required. This is a plugin-managed pixel layer, not an adjustment layer
or Smart Filter; its last rendered pixels remain usable without the plugin.

Use **Saved results → Edit** to reopen a formula, **New result** to create another,
**Pause/Resume** for automatic updates in the current document, or **Freeze** to
disable updates for a saved result. Freeze before painting result pixels. Undo
automatically pauses updates to preserve redo history; Resume explicitly brings
results up to date. Invalid formulas, missing inputs and dependency cycles leave
the last good pixels intact and report the problem. Fix/remap the formula and
Apply or Resume. Dependencies between live results run upstream first, subject
to the same input restrictions (including 100% source opacity/fill).

Recipes and layer-ID bindings are stored in document XMP and survive PSD
save/reopen. Existing metadata is preserved. Copying an individual result layer
to another document does not transfer/rebind its recipe. Pause is session state;
Freeze is saved in the document. Only PSD persistence has been verified so far.
Results are rechecked when returning to a document or loading the plugin.

The adapter temporarily disables source pixel masks inside a modal, suspended
history transaction to obtain full-canvas raw channels: Photoshop still crops
masked reads with `applyAlpha:false`. Masks are restored before commit, and
preview, unchanged refresh and failure roll back the transaction. This does not
read a rendered composite. Change detection hashes all input samples and recipe
settings; unchanged inputs create no output write or history entry. Checking
large documents still reads/evaluates all tiles; performance tuning remains open.

Inspect crop evaluates up to 128 x 128 pixels without resampling. It reports the
crop's range and the selected top-left pixel's channel values. This is a numerical
feasibility probe; a rendered preview and function browser are still planned.
Crop results never authorize full-image clipping or rescaling. Apply analyzes the
whole image and rereads the same modal-protected source in a second write pass.

32-bit output preserves negatives/HDR. For 16-bit output, the default stops and
reports out-of-range values before creating a layer. Select Rescale (one common
RGB range), Clip, or New 32-bit document and Apply again. A constant out-of-range
result cannot be rescaled. New documents transfer dimensions, resolution and the
applicable profile; additional metadata copying is not implemented yet.

## Real-host tests

From the loaded development plugin's UDT debugger console:

```js
await require('./smoke.js').suite()
await require('./smoke.js').operations()
await require('./smoke.js').cookbook()
// Stop the panel controller to keep it from competing with the test controller.
live.stop();
try {
  for (const depth of [16, 32]) {
    await require('./live-smoke.js').suite(depth);
    await require('./live-smoke.js').persistence(depth);
  }
} finally { live.start(); }
```

This creates and closes synthetic documents, never editing an existing user
document. It checks RGB and grayscale at both depths, exact screen-blend output,
hidden inputs, one-step undo, numeric-failure cleanup, cancellation during the
write pass, explicit range choice, new-32-bit output, and partial edge tiles.
The suite passed in Photoshop 27.10.0 on Windows, with zero pixel error in all
five cases. The 32-bit gray test exposed Photoshop's `Linear Grayscale Profile`
name: use the target document's profile when creating image data because the
Imaging API rejects that literal profile name.

The operations suite checks the 16 arithmetic/tonal presets against known pixel
values through native evaluation and new 32-bit document output, including a
negative subtraction result. All 16 passed in Windows Photoshop 27.10.0; maximum
absolute error was 1.2e-8 (Float32 rounding). Panel behavior and host-reported
bounds were checked at the minimum 320 × 480 size, including expanded RGB/crop
controls. Screenshot-based visual review remains pending.

The cookbook suite adds 12 RGB sample checks for mask blending, channel math,
screen inversion and tonal recipes; all passed in Photoshop 27.10.0, maximum
absolute error 2.6e-8. Live panel checks verified named numeric fields, scientific
notation, blank/duplicate rejection and a parameter-free `mtf(0.25, A)` formula.

The mask/live suite checks mask normalization and RGB broadcasting, raw reads
under an enabled mask, output appearance preservation, unchanged refresh history,
cancellation, mask output, automatic source-mask refresh, Undo/pause/resume/freeze,
dependency ordering/cycles and missing-source recovery. Persistence tests save
and reopen PSDs, verify layer bindings and retain unrelated XMP metadata.
Both suites pass at 16 and 32 bits in Windows Photoshop 27.10.0. Panel checks
also pass for debounced formula edits, saved-result editing, Freeze and the
persistent footer at 320 × 480 and 420 × 720. Visual screenshot review remains open.

To reproduce the [gallery](docs/gallery.html), evaluate `scripts/demo-photoshop.js`
and then `scripts/demo-gallery.js` in the same development plugin context. Save
the second returned value wrapped as `{"value": ...}` to a local file and run
`python scripts/save-demo-gallery.py <file>`. The latter also accepts the output
of the development-console CLI helper, including its leading log lines. This
creates JPEG exports and importable recipes. The synthetic document is left open
with separate source/result layers; existing documents are unchanged. Channel
gains explicitly selects Clip for its 16-bit display example, as labeled in the
gallery. Other displayed examples fit the native 16-bit range without rescaling.

For the six mask/live images, evaluate `scripts/demo-live-gallery.js` after the
source fixture (and after the original gallery export when rebuilding both).
It attaches a gradient mask, creates a live blend, edits the source mask, waits
for an actual automatic refresh, and exports both states of the same result.
It also exports mask multiplication and a generated attached mask. Save its
return value to `build/live-gallery-export.json`, then combine both exports:

```powershell
python scripts/save-demo-gallery.py build/live-gallery-export.json build/gallery-export.json
```

This regenerates all 19 images, matching importable recipes, and HTML/Markdown
galleries. The live example remains open with its saved recipe loaded in the
panel. Imported recipe files require binding and a separate Live result choice.
The README embeds the mask and live before/after sequence. These are Photoshop
image exports; a native panel screenshot is still unavailable because the
Windows capture API does not expose the running Photoshop window in this session.

SDK 6.5 loads the addon asynchronously: use `await require('layer_math.uxpaddon')`.
Native compilation returns an owned numeric handle. Evaluation takes complete
Float64 ArrayBuffers and returns a Float64Array. Dispose handles in `finally`.
The synchronous native call processes at most 16,384 pixels; cancellation is
checked between tile calls. CPU parallelization and large-image throughput/memory
measurement remain open gates; no performance claim is made yet.

## CI and signing setup

The checked-in workflow runs public Rust, JavaScript, Python and C++ ABI checks
on Windows and macOS. SDK and signing jobs are opt-in repository configuration;
they never run for pull requests. No repository secrets or Azure credentials
were copied by writing this implementation.

On 2026-10-07, the repository's Windows signing and macOS signing/notarization
smoke jobs passed in [run 37679773453](https://github.com/theatrus/layer-math-photoshop/actions/runs/37679773453).
The `signing` environment and repository configuration are present. Native CI
still needs the encrypted hybrid SDK provisioned and its enable flags set.

To provision the pinned SDK inputs explicitly, with `gh` authenticated as a repo
administrator and GnuPG installed:

```powershell
python scripts/provision-sdk.py C:\path\to\uxp-hybrid-plugin-sdk-v6.5.0.zip --repo theatrus/layer-math-photoshop
```

This verifies the ZIP, generates a new passphrase in memory, encrypts with AES256,
sets `UXP_HYBRID_SDK_PASSPHRASE`, uploads ciphertext to the `sdk-uxp-6.5.0`
prerelease, and sets `ENABLE_NATIVE_BUILDS=true`. It refuses an existing input
release; upgrades require a new reviewed pin and release. Plaintext is never
uploaded. CI cleans only `.sdk/ci/extracted` and its plaintext ZIP.

Create the `signing` GitHub environment restricted to main and v* tags, without
manual reviewers, matching xisf-photoshop. Set the six Apple environment secrets
and six Azure signing variables listed in the [design](docs/plan.md#windows-signing-and-setup).
Configure Entra federation for this repository's **actual** OIDC subject and
Certificate Profile Signer role. The existing repository's immutable IDs cannot
be copied. Run the manual signing smoke workflow, then set `ENABLE_SIGNING=true`.

CI emits signed per-platform addons with source/version/hash inventories. To
assemble a release, download both signed artifacts from the same source run into
`build/addons/win` and `build/addons/mac`, at that exact source checkout. Packaging
requires matching signed-stage inventory records; those records attest the
trusted workflow result and are not cryptographic signatures themselves.

## CCX packaging and macOS DMG

Adobe CLI **1.2.0** successfully packaged the Windows hybrid build through the
local UXP Developer Service. It requires a connected Photoshop packaging host;
hosted CI does not yet automate that step. Install Adobe's CLI in a local tools
directory and pass its `src/uxp.js` path:

```powershell
# Local unsigned, single-platform development package:
python scripts/package-uxp.py --cli C:\tools\node_modules\@adobe\uxp-devtools-cli\src\uxp.js --development
# All architectures from verified signing jobs:
python scripts/package-uxp.py --cli C:\tools\node_modules\@adobe\uxp-devtools-cli\src\uxp.js
```

The script rejects missing output even when Adobe reports exit code zero, checks
the addon bytes inside the CCX, and writes a SHA-256 file. Existing output is never
overwritten. A Windows development CCX was generated and its native bytes verified;
clean-machine CCX installation is still a separate acceptance gate. UDT loading
alone does not establish Creative Cloud installer behavior.

On a Mac, with Apple credentials available through `APPLE_API_KEY_PATH`,
`APPLE_API_KEY`, and `APPLE_API_ISSUER`:

```sh
bash scripts/sign-macos.sh build/addons/mac 'Developer ID Application: Name (TEAMID)'
# Package the same verified signed payloads into CCX before the next step.
bash scripts/build-macos-dmg.sh dist/LayerMath-Photoshop-0.1.0.ccx 'Developer ID Application: Name (TEAMID)'
```

Bare `.uxpaddon` binaries are notarized but cannot be stapled. The final DMG is
signed, notarized, stapled and hashed after verification. Its instructions open
the CCX; no native Plug-ins-folder shortcut is used. The adapted alias/layout
checks remount it read-only and compare the embedded CCX byte-for-byte. Confirm
the compressed image visually in Finder too. Run all Mac scripts on a Mac before
claiming a macOS release. Artwork regeneration uses Pillow 10.4.0 and explicit
font paths; the resulting PNG is committed, so packaging does not need Pillow.

Windows setup is built with `scripts/build-installer.ps1 -Ccx <file>` and Inno
Setup 6.7.3. It calls Adobe UPIA, checks its exit status and reported version, and
supports removal through Windows Settings. `scripts/test-installer.ps1` exercises
the wrapper with an isolated fake Adobe agent. Real CCX lifecycle testing remains
open. Signing the addon, setup wrapper and final DMG are separate steps.

The [release workflow](.github/workflows/release.yml) builds signed setup, signed
and notarized DMG, ZIPs and final checksums from a verified draft-release CCX.
Follow [the release steps](docs/releasing.md). Adobe distribution-ID validation
remains open; `us.theatr.layer-math` is the current development identity.

Before a release, finish the open gates in the design, validate the oldest
advertised Photoshop version and both Mac architectures, add third-party license
texts when updating shipped dependency versions, and verify downloaded release
hashes. Current locked dependency license texts are in `THIRD_PARTY_NOTICES.txt`.
