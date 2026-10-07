# Layer Math for Photoshop

Combine Photoshop layers with mathematical expressions, including PixelMath-style
blend operations, in 16-bit and 32-bit RGB or grayscale documents.

This repository contains the design and implementation roadmap. An installable
plugin is not available yet.

```text
combine(Starless, Stars, op_screen())
0.7*A + 0.3*B
combine(A, B, op_multiply())
iif(A > 0.8, B, A)
```

The planned workflow is to assign names to input layers, enter an expression,
preview the result, and create a new result layer. Source layers remain intact.
Separate R/G/B expressions support channel mixing and narrowband combinations.

32-bit output preserves finite negative and HDR values. Out-of-range 16-bit
results require an explicit choice to rescale, clip, or create a 32-bit document.
There is no automatic clipping inside blend functions.

- [Implementation plan](docs/plan.md): scope, interface, architecture, milestones,
  and release criteria.
- [Expression language and blend operators](docs/expression-language.md): proposed
  functions, `combine` and `op_*` semantics, precision, and compatibility limits.
- [Example recipes](examples/recipes.json): star recombination, blends, and channel
  combinations, expressed in the proposed recipe format.

The first release targets Windows x64 and macOS on Apple silicon and Intel.
It builds on the integration and release experience from
[FITS and XISF for Photoshop](https://github.com/theatrus/xisf-photoshop).

Licensed under [Apache-2.0](LICENSE).
