# GolemCraft Visual Overhaul

*Art Direction Transition Plan — From photorealistic PBR to stylized painterly aesthetic*

---

## 1. Problem Diagnosis

The current rendering pipeline is technically sound: terrain splatting with 4-texture blending, vertex AO, normal maps on desktop, day/night cycle with preset interpolation. The problem is art direction, not architecture.

Three issues compound into a visual result that falls short of the Valheim-style target:

- **Texture repetition.** 1024×1024 PolyHaven PBR textures contain photographic detail—specific leaf placements, pebble arrangements—that creates a recognizable fingerprint when tiled across 16×16 chunks. The eye detects these patterns instantly.
- **Style incoherence.** Photorealistic ground textures clash with stylized voxel geometry, blocky landmarks, and simple entity meshes. The combination creates an uncanny valley where nothing looks intentional.
- **Empty ground plane.** Without vegetation covering the terrain, every rendering shortcoming is exposed. Valheim's ground texture could be a 64×64 gradient and you'd barely notice—grass billboards occlude 80% of it.

---

## 2. Target Aesthetic

The Valheim look emerges from three visual layers working together. Each layer is simple individually; the combination produces richness.

### Layer 1: Ground Plane

Low-detail, painterly ground textures at 256×256 resolution. These serve as the color base visible between vegetation. No photographic detail, no recognizable features. Essentially colored Perlin noise with a biome-appropriate palette. Biome tinting (already implemented) multiplies on top.

Generated procedurally at build time via a Node script using layered Perlin noise with hand-tuned color palettes. Seamless tiling is trivial with modular noise. No artist dependency for ground textures.

### Layer 2: Vegetation Billboards

Dense alpha-cutout billboards covering most of the ground surface. Grass tufts, flowers, small rocks, dead shrubs. Each is a pair of crossed quads (4 triangles, X-shape from above) with a 64×64 or 128×64 RGBA sprite. Wind animation via vertex shader displacement of top vertices. This layer provides the visual detail that currently does not exist.

### Layer 3: 3D Objects

Low-poly trees (50–200 triangles), rocks, and landmarks. Already partially implemented via ObjectGenerator with instanced meshes. Trees need stylized silhouettes and wind sway to match the billboard vegetation layer.

---

## 3. What to Remove

| Remove | Reason | Savings |
|--------|--------|---------|
| **Normal maps (8×512²)** | Invisible under vegetation and with low-res textures | ~8 MB GPU memory, 1 texture sample/fragment |
| **PBR materials on terrain** | Matte ground (roughness 0.85, metalness 0.0) is visually identical to Lambert | ~30–40% cheaper fragment shader |
| **1024×1024 diffuse textures** | Replace with 256² procedural noise textures | ~60 MB → ~2 MB texture memory |
| **Complex splatting shader** | 4-texture blend with atlas UV math; simplify to tinted Lambert with 2-texture blend everywhere | Fewer ALU ops per fragment |

Total reclaimed budget: ~60 MB GPU memory and significant fragment shader headroom. This budget funds the vegetation billboard system.

---

## 4. Ground Texture Specification

### Resolution and Format

Target resolution: 256×256 pixels. Format: PNG, RGB (no alpha needed for ground). Stored in WebGL2 texture array as before, but at dramatically reduced resolution.

### Generation Method

Procedural at build time via kosmos-gen (see Section 12). The Texture Generator tab provides interactive controls for noise parameters, palette, and tiling preview. Export as PNG to GolemCraft's `public/textures/`. Run once, commit the PNGs.

### Art Style Guidelines

- No recognizable features—no individual leaves, pebbles, or cracks
- 8–12 color palette per texture, derived from noise value mapping
- Soft value variation (light/dark noise) for subtle depth
- Tiling must be seamless and undetectable
- Colors should be muted—the biome tint system adds saturation
- Think of these as what you see between grass blades: dirt, shadow, base color

### Texture Set (8 Base)

| Index | Name | Description | Base Palette | Character |
|-------|------|-------------|-------------|-----------|
| 0 | grass | Green-brown base | Muted olive, dark olive, earth brown | Soft noise, no blades |
| 1 | forest_floor | Dark brown-green | Dark umber, moss green, black-brown | Leaf litter impression |
| 2 | dirt | Warm brown | Earth brown, tan, dark sienna | Soft mottled |
| 3 | sand | Warm tan | Pale gold, warm beige, light brown | Uniform with slight value shift |
| 4 | rock | Gray stone | Cool gray, blue-gray, charcoal | Low-frequency noise |
| 5 | snow | Near-white | Blue-white, pure white, pale gray | Very subtle blue shadows |
| 6 | ice | Pale blue | Cyan-white, pale blue, white | Slight translucency feel |
| 7 | gravel | Speckled gray-brown | Warm gray, brown, dark gray | Stippled dots |

---

## 5. Vegetation Billboard System

### Architecture

The vegetation system extends the existing ObjectGenerator. Each chunk spawns vegetation instances alongside current objects (trees, rocks, cacti). Vegetation uses InstancedMesh with a custom shader for wind animation and alpha cutout.

### Rendering

- **Geometry:** Two crossed quads per instance (X-shape from above). 4 triangles total. Provides volume from any camera angle.
- **Alpha test:** `alphaTest: 0.5` on the material. Pixels are fully opaque or fully discarded. No sorting required, proper depth writes, no transparency ordering issues.
- **Instancing:** One InstancedMesh per vegetation type per chunk. Each instance stores position, rotation, scale, and color variation via instance attributes. Target: 5,000–10,000 instances visible at once, rendered in 4–8 draw calls.
- **Wind:** Vertex shader displaces top vertices using `sin(uTime + worldPosition.x * 0.5) * windStrength`. Bottom vertices are anchored. This creates a swaying motion with spatial variation so adjacent grass clumps move differently.
- **Distance culling:** Vegetation renders within 30–40 meters of the camera. Beyond that, the ground texture and fog handle the visual. The existing `ObjectGenerator.updateObjectVisibility()` pattern applies.

### Per-Biome Vegetation Sets

| Biome | Vegetation Types | Density | Height | Wind |
|-------|-----------------|---------|--------|------|
| Plains | grass_tuft ×3, wildflower ×2 | High | 0.8–1.2 | Medium |
| Meadow | grass_tuft ×2, flower ×3 | High | 0.6–1.0 | Medium |
| Savanna | dry_grass ×3, dead_stalk ×1 | Medium | 1.0–1.8 | High |
| Deciduous | fern ×2, undergrowth ×2 | Medium | 0.5–0.8 | Low |
| Autumn | dry_leaf ×3, dead_grass ×1 | Medium | 0.4–0.7 | Medium |
| Jungle | broad_leaf ×2, fern ×2, vine ×1 | Very high | 0.8–1.5 | Low |
| Swamp | reed ×2, moss_clump ×2 | Medium | 0.6–1.2 | Low |
| Taiga | snow_grass ×2, small_fir ×1 | Low | 0.4–0.8 | Medium |
| Desert | dead_bush ×2, dry_grass ×1 | Low | 0.3–0.6 | High |
| Tundra | lichen ×2, dead_shrub ×1 | Very low | 0.2–0.4 | High |
| Mountains | alpine_grass ×1, small_rock ×2 | Very low | 0.3–0.5 | High |
| Beach | beach_grass ×2, shell ×1 | Low | 0.4–0.7 | High |
| Glacier | None (bare ice) | None | — | — |

Density levels map to approximate instances per chunk (16×16 blocks): Very low = 10–20, Low = 30–60, Medium = 80–120, High = 150–250, Very high = 300+.

### Sprite Art Requirements

Total unique sprites needed: approximately 20–25 across all biomes, since many are shared (grass_tuft appears in 5+ biomes with different tinting).

| Sprite | Size | Variants | Notes |
|--------|------|----------|-------|
| grass_tuft | 128×64 | 3 silhouettes | Most-used sprite; neutral green, tinted per biome |
| dry_grass | 128×64 | 2 silhouettes | Taller, sparser; tan base color |
| wildflower | 64×64 | 2 colors | Small color accents; yellow and white |
| flower | 64×64 | 3 colors | Purple, pink, blue; meadow accents |
| fern | 64×64 | 2 silhouettes | Broad frond shape; forest floors |
| broad_leaf | 64×64 | 2 silhouettes | Tropical undergrowth |
| reed | 64×128 | 2 silhouettes | Tall, thin; swamp and water edges |
| dead_bush | 64×64 | 2 silhouettes | Bare branches; desert and tundra |
| dead_leaf | 64×64 | 3 silhouettes | Fallen leaf shapes; autumn forest |
| small_rock | 64×64 | 2 shapes | Gray pebble cluster; all biomes |
| lichen | 64×64 | 1 shape | Low flat patch; tundra and rock surfaces |
| moss_clump | 64×64 | 1 shape | Rounded mass; swamp |
| shell | 64×64 | 2 shapes | Beach decoration; white/tan |

Sprite guidelines: hard alpha edges only (every pixel fully opaque or fully transparent), 3–4 color values per sprite, neutral/desaturated colors (biome tint adds color), designed to be viewed at 1–2 world units tall.

### DALL-E Prompts for Sprites

**Grass tufts:**
"Pixel art sprite of a small grass tuft, 128x64 pixels, transparent background, hard edges, no anti-aliasing on edges, 4-5 shades of muted green, simple silhouette of grass blades, side view, game asset, stylized not realistic"

**Wildflower:**
"Pixel art sprite of a small wildflower with stem, 64x64 pixels, transparent background, hard edges, yellow petals, green stem, 3-4 colors only, simple silhouette, side view, game asset"

**Fern:**
"Pixel art sprite of a small fern frond, 64x64 pixels, transparent background, hard edges, muted green, simple curved leaf shape, 3-4 shades, side view, game asset"

**Dead bush:**
"Pixel art sprite of a small dead bush with bare branches, 64x64 pixels, transparent background, hard edges, brown and gray, 3 colors, sparse twiggy silhouette, side view, game asset"

**Dry grass:**
"Pixel art sprite of tall dry grass stalks, 128x64 pixels, transparent background, hard edges, tan and pale yellow, 3-4 colors, thin wispy blades, side view, game asset"

**Reed:**
"Pixel art sprite of cattail reeds, 64x128 pixels, transparent background, hard edges, green stems with brown tops, simple vertical silhouette, 4 colors, side view, game asset"

Note: DALL-E tends to produce soft alpha edges despite instructions. Clean up in Aseprite by thresholding alpha to 0 or 255.

---

## 6. Camera Adjustment

Lower the third-person camera from the current MOBA-style overhead position to a close shoulder view: 5–8 meters behind the character, 2–3 meters above. Effects:

- Ground is viewed at a grazing angle where texture detail matters less
- The world feels larger and more immersive
- Vegetation billboards only need to extend 30–40 meters, not the full view distance
- Fog becomes more atmospheric when viewed horizontally rather than top-down

---

## 7. Shader and Material Simplification

### Desktop and Mobile Unified

Use Lambert shading everywhere for terrain. The current branching between MeshStandardMaterial (desktop) and MeshLambertMaterial (mobile) collapses into a single path. The splatting shader simplifies to: sample 2 textures from the array, blend by weight, multiply by biome tint, apply Lambert lighting and fog.

### Vegetation Shader

A minimal custom ShaderMaterial for billboard vegetation:

- Vertex shader: instance transform, wind displacement on top vertices, pass UV and tint
- Fragment shader: sample RGBA texture, alpha test (discard if alpha < 0.5), multiply by instance tint, Lambert lighting, fog

---

## 8. Performance Budget

| Component | Before | After |
|-----------|--------|-------|
| Terrain texture memory | ~62 MB (8×1024² + 8×512²) | ~2 MB (8×256²) |
| Vegetation texture memory | 0 MB | ~2 MB (sprite atlas) |
| Terrain draw calls/chunk | 1–3 (surface + voxel + water) | 1–3 (unchanged) |
| Vegetation draw calls | 0 | 4–8 total (instanced) |
| Fragment shader cost | PBR + normal map + 4-tex splat | Lambert + 2-tex splat |
| **Total GPU memory** | **~62 MB** | **~4 MB** |

Net result: ~58 MB freed, 4–8 additional draw calls, simpler shaders. Large net improvement, especially on iPad where VRAM is the primary constraint.

---

## 9. Implementation Phases

### Phase 1: Validate Direction (1 session)

Minimal changes to test the visual hypothesis before committing to full implementation.

1. Generate 8 procedural noise textures at 256² via kosmos-gen Texture Generator tab
2. Remove normal map loading and shader references
3. Switch desktop terrain to Lambert material
4. Lower camera position to shoulder height
5. Evaluate in-game: does the direction feel right?

### Phase 2: Vegetation Prototype (2–3 sessions)

1. Create 3 grass_tuft sprites (64×64, hard alpha cutout)
2. Implement crossed-quad billboard geometry generator
3. Add InstancedMesh vegetation to ObjectGenerator for plains biome
4. Implement basic wind vertex shader
5. Test density and visual coverage

### Phase 3: Biome Coverage (2–3 sessions)

- Create remaining sprite set (~20 sprites)
- Wire vegetation types to all 16 biome definitions in biomesystem.js
- Add biome tint application to vegetation shader
- Tune density, height, and wind parameters per biome

### Phase 4: Polish (1–2 sessions)

- Replace procedural textures with hand-painted 256² versions if needed
- Add post-processing: bloom and color grading (desktop only)
- Implement height fog in terrain fragment shader
- iPad performance testing and density tuning

---

## 10. Files Affected

| File | Changes |
|------|---------|
| `public/textures/*` | Replace 1024² PBR textures with 256² procedural noise; remove normal maps |
| `src/shaders/terrainsplat.js` | Remove normal map sampling, simplify to Lambert, 2-texture blend everywhere |
| `src/world/terrain/terrainchunks.js` | Remove PBR material creation, unify desktop/mobile material path |
| `src/loaders/texturearrayloader.js` | Remove normal map array loading |
| **`src/shaders/vegetation.js`** | **NEW** — Billboard vertex/fragment shader with wind and alpha cutout |
| `src/world/objects/objectgenerator.js` | Add vegetation billboard spawning per chunk, biome-aware density |
| `src/world/terrain/biomesystem.js` | Add vegetation definitions (types, density, height, wind) per biome |
| `src/controls/` (camera files) | Adjust camera offset: lower and closer to character |
| **`public/textures/vegetation/*`** | **NEW** — Billboard sprite atlas (RGBA PNGs with hard alpha) |
| **`scripts/generate-textures.js`** | **REMOVED** — Replaced by kosmos-gen Texture Generator tab |

---

## 12. kosmos-gen as Asset Pipeline

### Reframing

kosmos-gen evolves from a standalone map generator into GolemCraft's build-time asset manager. The spine-Voronoi map generation remains as one tab, but the tool's primary role becomes procedural asset creation, preview, and export. All procedural assets flow through kosmos-gen rather than scattered scripts.

### Architecture

kosmos-gen already has the right foundation: Vite dev server, tab-based editor UI, pure-function `src/` library with no DOM dependencies, and deterministic seed-based generation. Each asset type gets its own editor tab with interactive controls and real-time preview.

### Tab Structure

| Tab | Purpose | Output | Status |
|-----|---------|--------|--------|
| **Textures** | Ground texture generation | 256² PNG tiles (8 base textures) | New — Phase 1 priority |
| **Sprites** | Vegetation billboard preview | 64×64 / 128×64 RGBA PNGs | New — Phase 2 |
| **Monsters** | 3D mob viewer/editor | Low-poly mesh definitions | New — Future |
| **Buildings** | Voxel structure editor | Voxel volume data (JSON) | New — Future |
| **Terrain** | Spine-Voronoi map gen | Continental templates | Existing |
| **Biomes** | Biome parameter tuning | Biome config preview | New — Future |

### Texture Generator Tab (Phase 1 Priority)

Interactive controls for procedural ground texture generation:

- **Noise parameters:** Octave count (1–4), frequency, amplitude, lacunarity
- **Color palette:** Pick 3–5 colors per texture, noise maps to palette via gradient
- **Tiling preview:** Show 3×3 tiled grid to verify seamlessness
- **Biome tint preview:** Apply biome tint multiplier to see final in-game appearance
- **Export:** Save as PNG to GolemCraft's `public/textures/` directory
- **Batch export:** Generate all 8 textures with current settings

The generator uses modular noise (wrap coordinates at texture boundaries) to guarantee seamless tiling. The palette mapping converts noise values [0,1] to a color gradient, avoiding recognizable features entirely.

### Sprite Preview Tab (Phase 2)

Preview billboard sprites in context:

- **Import:** Load RGBA PNGs (from DALL-E or hand-painted)
- **Crossed-quad preview:** Show the X-shape billboard from multiple angles
- **Tint preview:** Apply biome tints to see color variation
- **Density preview:** Scatter N instances on a flat plane to judge coverage
- **Alpha check:** Highlight any semi-transparent pixels that should be hard cutout
- **Wind preview:** Animate the top-vertex displacement to tune sway

### Monster Viewer Tab (Future)

Three.js viewport for previewing mob meshes:

- Load/display low-poly mob models
- Animation preview (walk, attack, idle)
- Color/tint variations per biome
- Export mesh data for GolemCraft entity system

### Building Editor Tab (Future)

Voxel editor for landmark structures:

- 3D voxel painting interface
- Palette of block types (stone, wood, mayan_stone, etc.)
- Preview with lighting
- Export as VoxelVolume data (compatible with existing landmark system)
- Template library for procedural variation

### Integration with GolemCraft

kosmos-gen runs as a development tool (localhost:5174). Asset files export directly to GolemCraft's `public/` directory structure. The workflow:

1. Open kosmos-gen in a browser tab alongside GolemCraft dev server
2. Generate/edit assets with interactive controls
3. Export to GolemCraft's `public/textures/` or `public/textures/vegetation/`
4. GolemCraft's Vite dev server hot-reloads the changed assets
5. See results immediately in-game

No build step coupling—kosmos-gen produces static files that GolemCraft consumes. The two projects remain independent repositories.

### Files in kosmos-gen

| File | Purpose |
|------|---------|
| `editor/tabs/textures.js` | **NEW** — Texture generator UI and canvas preview |
| `src/textures/noisegen.js` | **NEW** — Modular Perlin noise with palette mapping |
| `src/textures/palettes.js` | **NEW** — Predefined color palettes for 8 base textures |
| `editor/tabs/sprites.js` | **NEW** (Phase 2) — Sprite preview and validation |
| `editor/tabs/monsters.js` | **NEW** (Future) — Three.js mob viewer |
| `editor/tabs/buildings.js` | **NEW** (Future) — Voxel structure editor |

---

## 13. Open Questions

- Should vegetation billboards cast shadows? Adds visual quality but costs draw calls for shadow pass. Recommend: no shadows for grass, optional for larger flora like reeds.
- Should vegetation density scale with device capability? Could use the existing isMobile flag to halve density on iPad.
- Tree models: upgrade existing ObjectGenerator trees to stylized low-poly with wind, or defer to a later phase?
- Texture creation workflow: Viggo hand-paints sprites in Aseprite, or generate via DALL-E and clean up?