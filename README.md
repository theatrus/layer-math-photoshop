# Layer Math for Photoshop

Combine Photoshop layers with mathematical expressions, including PixelMath-style
blend operations, in 16-bit and 32-bit RGB or grayscale documents.

The Windows feasibility build now includes the expression evaluator, native UXP
addon and a working Photoshop panel. A signed public release is not available
yet. See the [development guide](DEVELOPMENT.md) for building and loading it.

```text
combine(Starless, Stars, op_screen())
0.7*A + 0.3*B
combine(A, B, op_multiply())
iif(A > 0.8, B, A)
```

Assign names to input layers, enter an expression, inspect a full-resolution
crop numerically, and create a result layer. Enable **Live result** to update that
same layer when its source pixels, input masks or formula change. Source layers
remain intact, and the result keeps its own mask, opacity and visibility.
Separate R/G/B expressions support channel mixing and narrowband combinations.
The compact panel includes 35 presets: arithmetic, blends, background subtraction,
midtones/gamma stretches, threshold masks and channel mappings. Matching input
bindings survive preset changes; Apply stays visible while the editor scrolls.
Write formulas directly as text, for example `mtf(0.25, A)`; optional named
parameters use simple name/value fields. No JSON is shown in the editor.

Browse the [35-recipe cookbook](docs/recipes.md) and the
[19-image example gallery](docs/gallery.md) ([visual gallery](docs/gallery.html)),
including the mask and live-result sequence below.

Bind an input as **Pixels** or **Mask**. For example, `mix(A, B, M)` blends two
layers through a pixel mask, and `A*M` multiplies pixels by that mask. You can
also write a formula directly into another layer's mask. No clipping mask is
required. See the [mask and live workflow](DEVELOPMENT.md#masks-and-live-results).

The current pixel adapter accepts opaque, full-canvas, top-level raster layers in
Normal mode with ordinary pixel masks, but no effects or clipping. Mask inputs
require density 100% and feather 0. A rendered preview and the full editor
remain planned. Windows Photoshop 27.10.0 has passed the synthetic host suite;
macOS and clean-machine installation still need verification.

32-bit output preserves finite negative and HDR values. Out-of-range 16-bit
results require an explicit choice to rescale, clip, or create a 32-bit document.
There is no automatic clipping inside blend functions.

### Example: a live blend controlled by a layer mask

Bind `A` to the original image's **Pixels**, `B` to the stretched image's
**Pixels**, and `M` to the original image's **Mask**. Enter the formula and check
**Live result** before Apply:

```text
mix(A, B, M)
```

Black in the mask keeps `A`; white selects `B`. Invert or paint the source mask
and the same result layer updates automatically while the plugin is running.
No clipping mask is required. Use mask density 100% and feather 0.

| Before editing the source mask | After inverting the source mask |
| --- | --- |
| ![Source mask: black on the left, white on the right](docs/images/gallery/layer-mask-before.jpg) | ![Inverted source mask: white on the left, black on the right](docs/images/gallery/layer-mask-after.jpg) |
| ![Live blend before: stretch applied on the right](docs/images/gallery/live-mask-before.jpg) | ![Same live result after automatic refresh: stretch applied on the left](docs/images/gallery/live-mask-after.jpg) |

These are **actual Photoshop image exports**, captured before and after a verified
automatic refresh of the same output layer. They use a synthetic 16-bit RGB
fixture; they are not panel screenshots. The formula and source pixels stayed
unchanged. [Download the formula](examples/gallery/live-mask-before.json), bind
the inputs, and enable Live result separately after importing.

The gallery also shows [`A*M`](docs/gallery.html#multiply-layer-mask) and
[writing a brightness formula into an attached mask](docs/gallery.html#generated-layer-mask).
Mask output is currently a one-shot operation. Reproduce the sequence with
[the live demo script](scripts/demo-live-gallery.js) after running
[the source fixture](scripts/demo-photoshop.js).

### Example: restore a separate stars layer

Actual Photoshop exports from a synthetic 960 × 640, 16-bit RGB fixture:

| Starless input | Screen result |
| --- | --- |
| ![Synthetic starless input](docs/images/starless.jpg) | ![Result with stars restored](docs/images/screen-result.jpg) |

`combine(Starless, Stars, op_screen())` reads two separate input layers and creates
a new result layer. The [stars input](docs/images/stars.jpg) and both sources remain
intact. These JPEGs are display exports, not panel screenshots or real sky data.
The reproducible fixture is [scripts/demo-photoshop.js](scripts/demo-photoshop.js);
evaluate it in the loaded plugin's UXP development console. It leaves a new demo
document open and does not change existing documents.

The demo also creates a separate midtones result with `mtf(0.25, A)`:

![Midtones stretch of the screen result](docs/images/midtones-result.jpg)

- [Implementation plan](docs/plan.md): scope, interface, architecture, milestones,
  SDK/toolchain setup, Windows and macOS signing, installers, DMGs, and release gates.
- [Expression language and blend operators](docs/expression-language.md): proposed
  functions, `combine` and `op_*` semantics, precision, and compatibility limits.
- [Recipe cookbook](docs/recipes.md): ready-to-use formulas, parameters, inputs
  and domain notes for all shipped presets.

The first release targets Windows x64 and macOS on Apple silicon and Intel.
It builds on the integration and release experience from
[FITS and XISF for Photoshop](https://github.com/theatrus/xisf-photoshop).

Licensed under [Apache-2.0](LICENSE).
