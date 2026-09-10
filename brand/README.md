# Brand assets

TechTorch brand source files. Nothing in this directory is bundled into the packaged extension; `.vscodeignore` excludes it.

The brand is monochrome **`#252b38`**. The mark is a circle with a four-pointed star in negative space, the star's points meeting the circle edge at the four cardinal positions.

## Masters

| File | Contents |
| --- | --- |
| `mark.svg` | The mark, vector, brand colour. Preferred master — scale it instead of the PNGs. |
| `mark-2048.png` | The mark, 2048×2048, brand colour on transparent |
| `mark-white-2048.png` | The mark, 2048×2048, white on transparent, for dark surfaces |
| `wordmark-3200.png` | The wordmark, 3200×640, brand colour on transparent |
| `wordmark-white-3200.png` | The wordmark, 3200×640, white on transparent, for dark surfaces |

The wordmark has no vector master here because its lettering is custom; request the vector from the brand owner rather than tracing it.

These files were supplied as `techtorch-icon-mark-2048.png`, `techtorch-icon-mark-white-2048.png`, `techtorch-wordmark-3200.png`, and `techtorch-wordmark-white-3200.png`. The `techtorch-` prefix was dropped as redundant inside this directory; the original names are recorded here so they can still be matched against the brand kit.

## Geometry

The mark is fully described by two numbers: a circle of radius `R`, minus four discs of the same radius `R` centred at `(±R, ±R)` from the circle's centre. That leaves four petals in the diagonal quadrants and a four-pointed star of negative space whose tips touch the circle at the cardinal points.

`mark.svg` draws those four petals as four subpaths. The construction was checked against `mark-2048.png` and reproduces it to within 0.6% of sampled pixels, so it can be re-derived at any size without redrawing by hand.

## Derived assets

The files the extension actually ships live in [../resources/](../resources/) and are traced from the geometry above:

| File | Use |
| --- | --- |
| `resources/benchmark.svg` | Activity Bar icon, 24×24. The four petals filled with `currentColor`, so VS Code tints it per theme. |
| `resources/icon-source.svg` | Vector source for the extension icon: the white mark on a `#252b38` rounded square. |
| `resources/icon.png` | The extension icon, 128×128, rendered from `icon-source.svg`. |

To change the icon, edit `icon-source.svg` and re-export `icon.png` at 128×128. Keep the geometry identical to the mark.
