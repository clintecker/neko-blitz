# Assets and attribution

The repository includes the assets needed to run the game. External images and music are not fetched during a hand.

## Artwork

`public/art/` contains the project-specific generated illustrations and pixel-style game graphics.

| File | Use |
| --- | --- |
| `blitz-logo.png` | Main wordmark |
| `club-doors.webp` | Cat dealer and illustrated lobby backdrop |
| `neon-alley.webp` | Club atmosphere and supporting backgrounds |
| `neko-playmat.webp` | Nine-slice table frame and felt |
| `neko-card-back.webp` | Face-down deck |
| `card-cat.png`, `mochi.webp`, `pip.webp`, `hex.webp` | Player and crew portraits |
| `og-neko-blitz.jpg` | Social share card for link unfurls (Open Graph and Twitter) |

The illustrations were created with AI image-generation tools for this project. The repository includes the final assets. Original image-generation prompts and intermediate images are not part of the source snapshot. Project artwork is distributed under the root MIT terms.

`og-neko-blitz.jpg` is exported from the same AI-generated club art at 1216 × 640 for Open Graph and Twitter cards.

The table frame's source artwork is 1440 × 720. Corner caps are 200 × 140. The CSS repeats the rails and preserves corner proportions rather than stretching the whole image.

`docs/images/` contains screenshots of the game, provided under the same project terms.

## Fonts

Inter is bundled with its full SIL Open Font License and original attribution in `public/fonts/Inter-OFL.txt`. Retain that file when redistributing the font.

Neko Pixel is the project-specific pixel font. Its adjacent `Neko-Pixel-LICENSE.txt` carries the project's MIT terms, and the font metadata identifies that license. The original font generator is not included in this snapshot. System monospace and sans-serif fallbacks are specified in CSS.

## Sound

The current score is generated at runtime by `app/audio/night-score.mjs` and
`app/audio/night-synth.mjs`. It uses Web Audio oscillators and effects, with no external music service or sampled commercial recordings. The source is covered by the project's MIT license.

All current music and effects are generated from the score and instrument sources above. The source package needs no sampled-audio directory or separate rendering toolchain.

## Third-party material

Lucide supplies the interface icons. The installed package retains its upstream license, and a copy is included in `vendor/lucide-LICENSE.txt`. Vinext's license is copied to `vendor/vinext-LICENSE.txt`. The installed dependency packages carry their additional upstream notices.

See [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md) for the complete attribution map. Every newly added third-party asset should have a source and compatible license recorded before it is committed.
