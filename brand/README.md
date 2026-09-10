# Brand assets

Source TechTorch brand files. These are the originals; nothing here is bundled into the packaged extension.

| File | Use |
| --- | --- |
| `techtorch-icon-mark-2048.png` | Icon mark, brand colour on transparent |
| `techtorch-icon-mark-white-2048.png` | Icon mark, white on transparent, for dark surfaces |
| `techtorch-wordmark-3200.png` | Wordmark, brand colour on transparent |
| `techtorch-wordmark-white-3200.png` | Wordmark, white on transparent, for dark surfaces |

The brand is monochrome **`#252b38`**. The mark is a circle with a four-pointed star in negative space, its points meeting the circle edge at the four cardinal positions.

## Derived assets

Two files in [../resources/](../resources/) are traced from the mark and are what the extension actually ships:

- `resources/benchmark.svg` — Activity Bar icon. The mark as four petal subpaths filled with `currentColor`, so VS Code tints it per theme.
- `resources/icon.png` — 128px extension icon. The white mark on a `#252b38` rounded square.
- `resources/icon-source.svg` — vector source for `icon.png`.

Regenerate the raster icon by editing `icon-source.svg` and re-exporting at 128×128. Keep the geometry identical to the mark above.
