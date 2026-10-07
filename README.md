# Layer Math for Photoshop

Apply formulas to layers and masks in 16-bit or 32-bit RGB and grayscale documents.

Assign names to source layers, enter a formula, and click **Apply** to create a
result layer. Enable **Live result** to update it when the sources or formula change.

| Operation | Formula |
| --- | --- |
| Subtract a background | `A - B` |
| Average two layers | `(A + B) / 2` |
| Multiply by a mask | `A * M` |
| Blend through a mask | `mix(A, B, M)` |
| Stretch midtones | `mtf(0.25, A)` |

## Combine stars and nebula

```text
combine(Starless, Stars, op_screen())
```

| Starless input | Result with stars |
| --- | --- |
| ![Starless input](docs/images/starless.jpg) | ![Screen blend result](docs/images/screen-result.jpg) |

## Edit a mask, update the result

Assign the original image to `A` and the stretched image to `B`, both as **Pixels**.
Assign the source layer's mask to `M` as **Mask**. Enable **Live result**.

```text
mix(A, B, M)
```

Black keeps `A`. White selects `B`. Paint or invert `M` to update the same result layer.

| Before mask inversion | After automatic update |
| --- | --- |
| ![Stretch applied on the right](docs/images/gallery/live-mask-before.jpg) | ![Stretch applied on the left](docs/images/gallery/live-mask-after.jpg) |

Read an attached mask with **Mask**, or use a separate grayscale layer with
**Pixels**. Choose **Write layer mask** to write a formula into an attached mask.

Live updates require the plugin running and the document active. Use **Pause**,
**Resume**, or **Freeze** to control updates. Undo pauses them automatically.

Images above are Photoshop exports from synthetic data.
[See all 19 examples](docs/gallery.md) or [browse 35 recipes](docs/recipes.md).

## Setup

Development build, tested on Windows Photoshop 27.10. No signed release yet.
[Build and load the plugin](DEVELOPMENT.md). [Build installers](docs/releasing.md).

Use opaque, full-canvas raster inputs outside groups, with Normal blending and
100% opacity/fill. Mask inputs require density 100% and feather 0.
[Supported inputs and output limits](DEVELOPMENT.md#use-the-feasibility-panel).

[Expression reference](docs/expression-language.md) · [Apache-2.0 license](LICENSE)
