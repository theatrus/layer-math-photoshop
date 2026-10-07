# Proposed expression language

This is the Layer Math v1 design contract. It is not an implementation or a claim
of full PixInsight or Photoshop blend-mode compatibility.

## Expressions and values

Layer aliases yield the current channel's value at the current canvas coordinate.
Use `A[0]`, `A[1]`, or `A[2]` for explicit RGB channel selection. A grayscale input
has only channel 0. Numeric scalars broadcast across pixels and output channels.
An RGB document can use a shared expression or three independent expressions;
a grayscale document uses one expression. Color-mode conversion is outside v1.

Accept decimal/scientific constants, parentheses, `+ - * / ^`, unary `+ - !`,
comparisons `< <= > >= == !=`, and logical `&& ||`. Comparisons produce 0 or 1;
zero is false and nonzero is true. Reject non-finite input values. Exponentiation
is right-associative and binds tighter than unary minus: `-2^2` means `-(2^2)`.
Unary operators precede multiplication/division, then addition/subtraction,
relational comparisons, equality comparisons, `&&`, and finally `||`.
`&&`, `||`, and `iif(condition, then, else)` short-circuit at evaluation time.
Every branch is still parsed and type-checked.

Named scalar parameters are defined in the constants interface/recipe, not by
assignments inside the expression. Initial functions:

| Function | Meaning |
| --- | --- |
| `min(a,b)`, `max(a,b)` | Per-pixel minimum and maximum |
| `abs(x)`, `sqrt(x)` | Absolute value and square root |
| `pow(x,y)`, `exp(x)`, `ln(x)` | Power, natural exponential, natural logarithm |
| `clamp(x,lo,hi)` | Explicit clamping; require `lo <= hi` |
| `iif(c,a,b)` | Evaluate only the selected branch |
| `mtf(m,x)` | Midtones transfer below |
| `combine(a,b,operator)` | Apply a selected binary pixel operation |
| `mix(a,b,t)` | `(1-t)*a + t*b`; no implicit clamping of `t` |

For `mtf`, require `0 < m < 1` and `0 <= x <= 1`. Define the endpoints as 0 and 1;
otherwise use `((m-1)*x)/((2*m-1)*x-m)`. Values outside this domain are errors, so
callers must explicitly transform their data before applying this function.

Division by zero, invalid function domains, non-finite intermediates, and final
Float32 overflow are errors. Report the expression location, coordinate, channel,
and input aliases involved. Do not silently substitute zero or a tiny denominator.

## Operator-valued functions

```text
combine(Starless, Stars, op_screen())
combine(A, B, op_multiply())
mix(A, combine(A, B, op_screen()), strength)
iif(A > threshold, combine(A, B, op_min()), A)
```

`op_*()` returns a typed, compile-time operation descriptor. It is valid in the
third argument to `combine`, and is not a number, layer, or arbitrary callable.
Reject `A + op_screen()`, numeric operation IDs, unknown descriptors, and wrong
argument counts. Nested numeric expressions in the first two arguments are valid.
V1 uses exactly two numeric operands and one operator; no variadic fold or implicit
opacity argument. Use `mix` to control a blend's strength.

`A` is the base/backdrop and `B` is the blend/source. Operations act on one channel
at a time. They do not include alpha compositing, layer opacity, masks, or color
space conversion. They do not change Photoshop's layer blend-mode setting.

## Required v1 operators

These are proposed Layer Math spellings. Except for the documented `op_screen`
usage, PixInsight aliases must be checked against its current expression editor
before being advertised as compatible.

| Descriptor | Definition for scalar samples `a`, `b` |
| --- | --- |
| `op_add()` | `a+b` |
| `op_subtract()` | `a-b` |
| `op_multiply()` | `a*b` |
| `op_divide()` | `a/b`, with a zero-denominator error |
| `op_min()` | `min(a,b)` |
| `op_max()` | `max(a,b)` |
| `op_screen()` | `1-(1-a)*(1-b)` |
| `op_difference()` | `abs(a-b)` |
| `op_exclusion()` | `a+b-2*a*b` |
| `op_overlay()` | `2*a*b` when `a <= 0.5`; otherwise `1-2*(1-a)*(1-b)` |
| `op_hard_light()` | `2*a*b` when `b <= 0.5`; otherwise `1-2*(1-a)*(1-b)` |
| `op_soft_light()` | Piecewise definition below |

For soft light, choose the W3C separable blend definition on normalized inputs:

```text
d(a) = ((16*a - 12)*a + 4)*a   when a <= 0.25
       sqrt(a)                 otherwise

soft_light(a,b) = a - (1-2*b)*a*(1-a)       when b <= 0.5
                  a + (2*b-1)*(d(a)-a)    otherwise
```

Overlay and hard light are ordered operations: swapping their operands generally
changes the result. Screen is symmetric. Soft-light definitions differ across
applications; the formula above is the contract for this plugin.

## HDR and range behavior

Evaluate the stated algebraic/piecewise formulas directly for finite samples,
including values outside 0..1, unless a function explicitly restricts its domain.
For soft light, this means extending the specified piecewise formula outside its
usual normalized domain. Reject overflow/non-finite results. This HDR extension
is our design decision, not a claim of W3C or PixInsight HDR conformance.

Screen is normally used on normalized image values, but it must not secretly
clamp HDR input or output: `combine(2,0.25,op_screen())` produces `1.75`.
Choosing 16-bit output does not change any intermediate operation. The final
write follows the explicit range policy in the [plan](plan.md#precision-and-output-range).

No automatic rescaling occurs in `combine`, `mix`, or an operator descriptor.
`clamp` is an explicit user operation. A bounded blend can be written as
`combine(clamp(A,0,1), clamp(B,0,1), op_screen())`.

## Required conformance examples

These are acceptance examples for the future evaluator, not an implemented test suite.

| Expression | Expected result |
| --- | --- |
| `combine(0.2,0.4,op_screen())` | `0.52` |
| `combine(0.2,0,op_screen())` | `0.2` |
| `combine(0.2,1,op_screen())` | `1` |
| `combine(2,0.25,op_screen())` | `1.75` |
| `combine(-0.2,0.4,op_screen())` | `0.28` |
| `combine(0.2,0.4,op_multiply())` | `0.08` |
| `combine(0.2,0.4,op_difference())` | `0.2` |
| `combine(0.2,0.4,op_exclusion())` | `0.44` |
| `combine(0.2,0.8,op_overlay())` | `0.32` |
| `combine(0.8,0.2,op_overlay())` | `0.68` |
| `combine(0.2,0.8,op_hard_light())` | `0.68` |
| `combine(0.25,0.75,op_soft_light())` | `0.375` |
| `combine(0.2,0,op_divide())` | Numeric error |
| `iif(0, 1/0, 0.25)` | `0.25`; no division error |
| `mtf(0.5,0.25)` | `0.25` |

Test channel broadcasting, swapped operands, branch boundaries, negative/HDR
samples, numeric errors, and expression limits. Compare randomized samples with
an independent scalar reference. Separate mathematical tolerance from native
16-bit quantization and Float32 output rounding.

## Compatibility and later operators

Keep a versioned compatibility table of verified PixInsight spellings, signatures,
domains, formulas, and tolerances. Capture small golden input/output vectors from
a real PixInsight run before claiming numerical compatibility for an operator.
Document differences rather than silently changing a published language version.

Potential later work: color dodge/burn with explicit endpoint rules, additional
verified aliases, and non-separable hue/saturation/color/luminosity operations.
The latter require a separate color-model contract rather than scalar substitution.
Full PixelMath syntax, image generators, and automatic normalization are not goals
of this initial subset.

## References

- [ScreenStars author discussion](https://www.pixinsight.com/forum/index.php?threads/new-script-screenstars.21098/)
  documents `combine(stars, starless, op_screen())` and screen recombination.
- [W3C separable blend modes](https://www.w3.org/TR/compositing-1/#blendingseparable)
  is the normalized-domain formula reference for the listed blend modes.
  Layer Math does not implement the surrounding CSS or alpha-compositing model.
