# Recipe cookbook

Type formulas directly into the expression editor. Parameters are optional name/value fields; no JSON is required in the panel. Choose a preset to populate its formula and parameters, then bind each input to a layer.

Most formulas use the current channel of A or B. A[0], A[1] and A[2] explicitly select red, green and blue in an RGB document. All inputs must be aligned opaque full-canvas raster layers.

[See 13 rendered examples](gallery.md). Saved recipes use a structured file format internally; import always requires fresh bindings.

## Screen stars

For star-only data prepared for screen recombination.

Inputs: `Starless`, `Stars`.

```text
combine(Starless, Stars, op_screen())
```

## Add stars

For star-only data prepared for additive recombination.

Inputs: `Starless`, `Stars`.

```text
combine(Starless, Stars, op_add())
```

## Screen blend strength

Inputs: `A`, `B`.

```text
mix(A, combine(A, B, op_screen()), strength)
```

Parameters: `strength = 0.5`.

## Weighted blend

Inputs: `A`, `B`.

```text
mix(A, B, weight)
```

Parameters: `weight = 0.3`.

## SHO channel mapping

RGB document with SII, Ha, and OIII already present as aligned grayscale-valued RGB layers; use channel 0 from each.

Inputs: `SII`, `Ha`, `OIII`.

```text
R: SII[0]
G: Ha[0]
B: OIII[0]
```

## HOO channel mapping

RGB document with aligned grayscale-valued Ha and OIII layers; use channel 0 from each.

Inputs: `Ha`, `OIII`.

```text
R: Ha[0]
G: OIII[0]
B: OIII[0]
```

## Conditional replacement

Inputs: `A`, `B`.

```text
iif(A > threshold, B, A)
```

Parameters: `threshold = 0.8`.

## Add

Add both layers. Values above 1 require an output range choice.

Inputs: `A`, `B`.

```text
A + B
```

## Subtract

Subtract B from A. Negative values require an output range choice.

Inputs: `A`, `B`.

```text
A - B
```

## Multiply

Multiply corresponding samples in A and B.

Inputs: `A`, `B`.

```text
A * B
```

## Divide

Divide A by B. A zero denominator is an error; no epsilon is substituted.

Inputs: `A`, `B`.

```text
A / B
```

## Difference

Absolute difference between corresponding samples.

Inputs: `A`, `B`.

```text
abs(A - B)
```

## Minimum

Keep the lower value at each pixel and channel.

Inputs: `A`, `B`.

```text
min(A, B)
```

## Maximum

Keep the higher value at each pixel and channel.

Inputs: `A`, `B`.

```text
max(A, B)
```

## Average

Equal-weight average of both layers.

Inputs: `A`, `B`.

```text
(A + B) / 2
```

## Overlay

Overlay B on A. Swapping inputs changes the result.

Inputs: `A`, `B`.

```text
combine(A, B, op_overlay())
```

## Soft light

Apply the documented soft-light formula with A as the base.

Inputs: `A`, `B`.

```text
combine(A, B, op_soft_light())
```

## Invert

Invert normalized samples; HDR values remain unclipped.

Inputs: `A`.

```text
1 - A
```

## Gain and offset

Scale brightness and add a constant offset.

Inputs: `A`.

```text
gain * A + offset
```

Parameters: `gain = 1.2`, `offset = 0`.

## Subtract background

Subtract a constant background. Choose new 32-bit output to preserve negatives.

Inputs: `A`.

```text
A - background
```

Parameters: `background = 0.02`.

## Midtones stretch

Stretch samples in 0 to 1; midtones must be between 0 and 1.

Inputs: `A`.

```text
mtf(midtones, A)
```

Parameters: `midtones = 0.25`.

## Gamma

Power stretch of nonnegative samples. Use a positive gamma.

Inputs: `A`.

```text
pow(A, 1 / gamma)
```

Parameters: `gamma = 2`.

## Threshold mask

Create a binary mask independently for each channel.

Inputs: `A`.

```text
iif(A >= threshold, 1, 0)
```

Parameters: `threshold = 0.25`.

## Screen stars with strength

Recombine stars at adjustable strength. Start at 0 to 1; larger values can exceed the output range.

Inputs: `Starless`, `Stars`.

```text
combine(Starless, strength * Stars, op_screen())
```

Parameters: `strength = 0.5`.

## Extract screen stars

Invert screen recombination for normalized layers. Fully saturated starless samples are unrecoverable and explicitly return 0.

Inputs: `Combined`, `Starless`.

```text
iif(Starless < 1, (Combined - Starless) / (1 - Starless), 0)
```

## Logarithmic stretch

Compress highlights and lift shadows. Use positive strength and nonnegative input samples.

Inputs: `A`.

```text
ln(1 + strength * A) / ln(1 + strength)
```

Parameters: `strength = 20`.

## Black and white points

Map black to 0 and white to 1. Require white > black. Output is not automatically clipped.

Inputs: `A`.

```text
(A - black) / (white - black)
```

Parameters: `black = 0.02`, `white = 0.8`.

## Soft threshold mask

Ramp from 0 at low to 1 at high. Require high > low. Each channel is evaluated independently.

Inputs: `A`.

```text
clamp((A - low) / (high - low), 0, 1)
```

Parameters: `low = 0.1`, `high = 0.4`.

## Range mask

Select a closed sample interval independently in each channel.

Inputs: `A`.

```text
iif(A >= low && A <= high, 1, 0)
```

Parameters: `low = 0.15`, `high = 0.5`.

## Masked blend

Use a prepared full-canvas raster mask: 0 keeps A, 1 selects B. RGB masks act per channel.

Inputs: `A`, `B`, `Mask`.

```text
mix(A, B, clamp(Mask, 0, 1))
```

## RGB average grayscale

RGB documents only. Arithmetic channel average, not a colorimetric luminance conversion.

Inputs: `A`.

```text
(A[0] + A[1] + A[2]) / 3
```

## Saturation around RGB average

RGB documents only. 0 gives channel-average gray; 1 retains color. Above 1 can produce negative or HDR values.

Inputs: `A`.

```text
mix((A[0] + A[1] + A[2]) / 3, A, saturation)
```

Parameters: `saturation = 1.5`.

## Channel gains

RGB documents only. Independently scale red, green and blue samples.

Inputs: `A`.

```text
R: red * A[0]
G: green * A[1]
B: blue * A[2]
```

Parameters: `red = 1.2`, `green = 1`, `blue = 0.8`.

## Swap red and blue

RGB documents only. Exchange red and blue without changing green.

Inputs: `A`.

```text
R: A[2]
G: A[1]
B: A[0]
```

## Detail boost from blurred layer

Use a separately prepared aligned blurred raster layer. Layer Math does not generate the blur. Overshoot may need 32-bit output.

Inputs: `A`, `Blur`.

```text
A + amount * (A - Blur)
```

Parameters: `amount = 0.5`.

## Output range

The default asks before writing out-of-range values into a 16-bit document. Choose Clip, Rescale, or New 32-bit document explicitly. Arithmetic does not silently clamp; only formulas containing clamp do so. Domain restrictions in recipe descriptions remain your responsibility. Invalid function domains and division by zero are reported as errors.
