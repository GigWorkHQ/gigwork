# Workloom mascot assets

Created 2026-10-18 with the built-in ImageGen tool (`transparent_background: true`). These are original generated assets for the Workloom adaptation, not copied Jasper portraits. Buffy Graphics and the ImageGen skill guided production.

## Selected files

| Asset | Public path | Size | Bytes |
| --- | --- | --- | --- |
| Ivory owl with lime wings | `/assets/mascots/workloom-owl.png` | 1254 × 1254 RGBA PNG | 2,039,678 |
| Coral fox in light shirt | `/assets/mascots/workloom-fox-v2.png` | 1254 × 1254 RGBA PNG | 1,915,349 |
| Lavender friendly robot | `/assets/mascots/workloom-robot.png` | 1254 × 1254 RGBA PNG | 2,123,132 |

`workloom-fox.png` is the first draft. Use the v2 file, which preserves the character and adds headroom above both ears. No approved brand identity was replaced. All four originals are retained.

## Direction and reference roles

- Layout and collage role: the supplied Jasper recording, inspected through `research/video-contact.jpg`. The mascots replace the portrait cutouts within the existing graphic slots.
- Palette from the reference: navy `#00063d`, flame `#fa4028`, lime `#9bff65`, sky `#ceebff`, pink `#ffb3de`, yellow `#fffbb7`.
- Materials: rounded dense felt with soft-paper layering, restrained studio light, photographic cutout character. Generated color is a material approximation rather than a pixel-exact flat token.
- Characters: ivory/lime owl, coral fox in a light shirt, lavender robot. This is a coherent new family proposed for this build, not a previously approved mascot identity.

## Exact generation prompts

### Owl

Use case: stylized-concept. Asset: a single isolated Workloom mascot portrait for a polished editorial website collage. Create a small, adorable ivory owl with restrained bright lime (#9bff65) wing tips and tiny coral (#fa4028) beak, navy (#00063d) expressive eyes. Rounded tactile felt and fine soft-paper layered material, realistically photographed, subtle paper grain and fine halftone texture, soft studio light, handmade but refined professional finish. Front-facing with a slight three-quarter turn and friendly confident expression. Waist-up portrait, head and rounded wings visible, large subject filling roughly 85 percent of square canvas, nothing cropped, clean silhouette. True transparent background, no scene or ground, no backdrop, no text, logos or objects. Avoid shiny plastic, glass, glossy 3D toy styling, vector flatness, hard black outlines. This is the first of a consistent owl/fox/robot family; preserve natural tactile detail.

### Fox

Use case: stylized-concept. Asset: one isolated Workloom mascot portrait for a polished editorial website collage, part of a tactile owl/fox/robot family. Create an adorable rounded coral fox (#fa4028 with softer coral tones), fluffy ivory muzzle and chest, expressive dark navy (#00063d) eyes, wearing a simple ivory/light sky-blue casual collared shirt. Real tactile felt with layered soft-paper details, realistic photograph of refined handmade mascot, subtle paper grain, fine halftone texture, soft studio light. Friendly confident expression, slightly three-quarter portrait, head and shoulders and waist visible, large subject fills 85 percent of square image, complete ears and arms inside frame. Rounded paws lightly together near waist. True transparent background, clean cutout silhouette. No scene, ground, objects, text or logos. Avoid glossy plastic, glass, shiny 3D toy material, flat vector style, hard black outline. Preserve natural touchable texture and professional editorial charm.

### Fox v2 framing edit

Input: `workloom-fox.png`. The generated input was inspected before editing; built-in ImageGen used its local path as the edit reference.

Use case: precise-object-edit. Fix only the framing of this exact fox mascot portrait. Preserve its face, pose, expression, shirt, color, felt materials, lighting and transparent background exactly. Make the entire character slightly smaller within the square canvas so both ears are fully visible and there is a clear transparent margin of 7 percent above the highest ear and 5 percent at left and right. Keep the waist crop aligned with the bottom edge. Do not redesign the fox or add anything. Clean transparent alpha edges.

### Robot

Use case: stylized-concept. Asset: one isolated Workloom mascot portrait for a polished editorial website collage, part of a tactile owl/fox/robot family. Create a cute friendly lavender rounded robot, a large gently rounded rectangular head with ivory inset face, big expressive dark navy (#00063d) felt eyes and a small curved smiling mouth, tiny blush-pink cheeks, lavender rounded body and pill-shaped soft arms, small lime (#9bff65) chest status light. Real tactile dense felt and layered soft-paper construction, realistic studio photograph of a refined handmade mascot, subtle paper grain and fine halftone texture, soft studio light. Friendly confident slight three-quarter portrait, waist-up, hands resting lightly at waist. Complete head and arms inside the square canvas, character fills 85 percent height with 7 percent transparent margin above head. True transparent background, clean cutout silhouette. No scenery, ground, objects, text, logos, extraneous props or circuitry. Avoid metal shine, glass, glossy plastic 3D toy surfaces, flat vectors and hard black outlines. Preserve natural touchable texture and professional editorial charm.

## Validation and placement

The generated outputs were visually inspected. They form a matching family, have no generated words or logos, and preserve full heads and lateral silhouettes. The waist is intentionally cropped at the image bottom, suitable for a portrait rising from a collage baseline.

Pillow was used only for read-only decode and alpha validation, never to edit or crop images. All selected PNGs decode successfully and have real alpha. Their meaningful silhouette bounds at alpha ≥32 are:

- Owl: `(73, 18)–(1189, 1254)`.
- Fox v2: `(118, 85)–(1126, 1254)`.
- Robot: `(114, 106)–(1132, 1254)`.

Most subject pixels have generated alpha 252–253 out of 255, with soft edge pixels and sparse near-zero residual alpha beyond the silhouette. The original alpha is preserved. Do not interpret the full nonzero-alpha box as the optical silhouette. Detailed values are in `public/assets/mascots/asset-validation.json`.

For the hero, bottom-align each PNG in its slot and preserve its aspect ratio. Use equivalent visible-head scale rather than identical image height if exact optical consistency is needed. Integrating-page desktop/mobile crop checks remain with the application owner; asset-only validation does not claim that page-level check.

## Source copies

The unmodified built-in outputs remain under `C:/Users/User/.codex/generated_images/01a14e27-8fcd-71b0-80f7-d8bcdb7ce4a6/`:

- Owl: `exec-28c583ad-8269-4f6c-9bd6-e0bb0ed8f2b2.png`
- Fox draft: `exec-afaa7278-2c54-4993-88e0-b50b8f14367b.png`
- Fox v2: `exec-1ee18d11-bfc5-4930-983f-84be5a4cacb5.png`
- Robot: `exec-901bd75c-5058-4989-b0eb-62be92201659.png`

The public assets are self-contained project copies and do not require that machine-specific source location at runtime.

## Gigwork rename

The user renamed the website on 18 October 2026. The generation record above retains original names and machine paths for provenance only. Delivered mascot pixels are unchanged; their current portable filenames use `gigwork-` under `public/assets/mascots/`. The wordmark/banner/favicon generator now renders Gigwork. Original generation directories are not required to run or edit the site.
