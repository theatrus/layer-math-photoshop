# Layer Math implementation plan

This document describes the proposed first release. Features and acceptance
criteria below are planned work, not claims about an existing implementation.

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
100% opacity and fill, and no enabled masks, effects, clipping relationships,
adjustment layers, Smart Objects, or group compositing effects on the inputs.
List unsupported inputs with the reason and require a user-prepared raster copy.
Validate parent-group effects too. Pixel alpha and document bounds must be checked
from returned data, not inferred solely from the layer type or thumbnail.

The intended input is each layer's own stored channels, independent of visibility.
The feasibility milestone must prove hidden-layer reads, offsets, masks, and
effects behave as expected. Unsupported host behavior must stop with a clear
diagnostic. Do not temporarily change source visibility or appearance to obtain
a composite and silently treat it as the source pixels.

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

## Milestones and acceptance gates

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

Set up GitHub CI for Windows x64 and universal macOS artifacts, with evaluator
tests and native ABI checks. Keep Adobe SDKs out of public source. Exercise package
installation and verify final artifacts and checksums before publishing a release.
Document only supported hosts and provide concise installation instructions.

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
