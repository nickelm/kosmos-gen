# kosmos-gen

Build-time asset pipeline for GolemCraft. Web-based tool for procedural generation, preview, and export of game assets.

## Project Structure

```
kosmos-gen/
├── src/
│   ├── core/             # Seeds, math, noise (reused from original)
│   ├── textures/         # Procedural texture generation
│   │   ├── noisegen.js       # Modular Perlin noise, tileable
│   │   ├── palettes.js       # Color palettes for 8 base textures
│   │   └── exporter.js       # PNG export utilities
│   └── index.js          # Public API
├── app/                  # Web UI (Vite + Three.js)
│   ├── main.js           # Entry point, tab routing
│   ├── tabs/
│   │   └── textures.js   # Texture generator tab
│   └── style.css
├── package.json
└── docs/
```

## Running

```bash
npm install
npm run dev     # Start at localhost:5174
npm run build   # Build for production
```

## Conventions

- ES6 modules, lowercase filenames
- Pure functions in `src/` (no DOM, no Three.js)
- Three.js allowed in `app/` only
- Deterministic: same seed + params = same output

---

## Current Focus: Texture Generator

### Purpose

Generate 8 tileable ground textures at 128×128 for GolemCraft's terrain system. These replace the current 1024×1024 PolyHaven PBR textures as part of the visual overhaul (stylized painterly aesthetic, Lambert shading, no normal maps).

The textures are intentionally low-detail: colored Perlin noise with no recognizable features. Visual richness comes from vegetation billboards on top, not from the ground texture.

### Architecture

Generation logic lives in `src/textures/` (pure functions, no DOM). The web UI in `app/tabs/textures.js` provides interactive controls and Three.js preview.

### Noise Generation (`src/textures/noisegen.js`)

Tileable noise using modular coordinates (wrap at texture boundaries for seamless tiling). Supports multiple noise types that can be layered.

#### Noise Types

| Type | Function | Character | Best For |
|------|----------|-----------|----------|
| `perlin` | Standard Perlin noise | Smooth, organic blobs | Base layer for most textures |
| `ridged` | `1.0 - abs(perlin)` | Vein-like ridges | Rock veins, cracked surfaces |
| `worley` | Distance to nearest cell point | Stippled, cellular | Gravel pebbles, ice crystals |

#### Parameters Per Layer

- `type` (`"perlin"`, `"ridged"`, `"worley"`): Noise function. Default: `"perlin"`.
- `octaves` (1–5): Number of noise layers. Default: 3.
- `frequency` (0.5–12.0): Base frequency. Higher = smaller features. Default: 3.0.
- `amplitude` (0.0–1.0): Strength of this layer. Default: 0.8.
- `lacunarity` (1.5–3.0): Frequency multiplier per octave. Default: 2.0.
- `persistence` (0.3–0.7): Amplitude multiplier per octave. Default: 0.5.
- `seed` (integer): Deterministic seed.

#### Multi-Layer Composition

Each texture preset defines 1–3 noise layers that are blended additively (then normalized to [0, 1]). The base layer provides broad character; detail layers add material-appropriate grain.

```javascript
// Example: rock texture with base shapes + vein detail
layers: [
    { type: 'perlin', octaves: 2, frequency: 2.0, amplitude: 0.7 },      // broad shapes
    { type: 'ridged', octaves: 2, frequency: 5.0, amplitude: 0.2 },      // vein detail
    { type: 'perlin', octaves: 1, frequency: 10.0, amplitude: 0.1 }      // fine grain
]
```

Output: 2D array of values in [0, 1] at the target resolution.

### Color Palettes (`src/textures/palettes.js`)

Each texture maps noise values [0, 1] to a color gradient defined by 3–5 color stops. The palette determines the texture's character. Palettes should be muted/desaturated since GolemCraft's biome tint system multiplies color on top.

#### 8 Base Texture Presets

```javascript
const PALETTES = {
    grass: {
        name: 'Grass',
        // Muted olive-brown, seen between grass billboard blades
        stops: [
            { t: 0.0, color: [0.25, 0.30, 0.15] },  // Dark earth-green
            { t: 0.3, color: [0.35, 0.42, 0.20] },  // Olive
            { t: 0.6, color: [0.40, 0.48, 0.22] },  // Muted green
            { t: 1.0, color: [0.45, 0.52, 0.25] },  // Light olive
        ],
        layers: [
            { type: 'perlin', octaves: 3, frequency: 3.0, amplitude: 0.75, persistence: 0.5 },
            { type: 'perlin', octaves: 1, frequency: 8.0, amplitude: 0.15 },  // fine grain
        ]
    },
    forest_floor: {
        name: 'Forest Floor',
        // Dark umber, leaf litter impression
        stops: [
            { t: 0.0, color: [0.18, 0.14, 0.10] },  // Dark brown
            { t: 0.3, color: [0.25, 0.20, 0.14] },  // Umber
            { t: 0.7, color: [0.30, 0.26, 0.18] },  // Warm brown
            { t: 1.0, color: [0.28, 0.30, 0.18] },  // Hint of moss
        ],
        layers: [
            { type: 'perlin', octaves: 3, frequency: 4.0, amplitude: 0.65, persistence: 0.45 },
            { type: 'worley', octaves: 1, frequency: 6.0, amplitude: 0.2 },   // clumpy litter
            { type: 'perlin', octaves: 1, frequency: 10.0, amplitude: 0.1 },  // fine grain
        ]
    },
    dirt: {
        name: 'Dirt',
        // Warm earth brown, mottled
        stops: [
            { t: 0.0, color: [0.30, 0.22, 0.14] },  // Dark earth
            { t: 0.4, color: [0.42, 0.32, 0.20] },  // Medium brown
            { t: 0.7, color: [0.48, 0.38, 0.24] },  // Warm brown
            { t: 1.0, color: [0.52, 0.42, 0.28] },  // Light earth
        ],
        layers: [
            { type: 'perlin', octaves: 3, frequency: 3.0, amplitude: 0.7, persistence: 0.5 },
            { type: 'perlin', octaves: 1, frequency: 9.0, amplitude: 0.15 },  // mottling
        ]
    },
    sand: {
        name: 'Sand',
        // Pale gold, minimal variation — stays smooth
        stops: [
            { t: 0.0, color: [0.72, 0.65, 0.48] },  // Darker sand
            { t: 0.5, color: [0.80, 0.74, 0.55] },  // Medium sand
            { t: 1.0, color: [0.85, 0.80, 0.62] },  // Light sand
        ],
        layers: [
            { type: 'perlin', octaves: 2, frequency: 2.0, amplitude: 0.8, persistence: 0.4 },
        ]
    },
    rock: {
        name: 'Rock',
        // Cool gray with vein detail
        stops: [
            { t: 0.0, color: [0.30, 0.30, 0.32] },  // Dark gray
            { t: 0.3, color: [0.40, 0.40, 0.42] },  // Medium gray
            { t: 0.7, color: [0.48, 0.47, 0.50] },  // Blue-gray
            { t: 1.0, color: [0.55, 0.54, 0.56] },  // Light gray
        ],
        layers: [
            { type: 'perlin', octaves: 2, frequency: 2.0, amplitude: 0.6, persistence: 0.5 },
            { type: 'ridged', octaves: 2, frequency: 5.0, amplitude: 0.25 },  // veins
            { type: 'perlin', octaves: 1, frequency: 10.0, amplitude: 0.1 },  // fine grain
        ]
    },
    snow: {
        name: 'Snow',
        // Near-white, very subtle — stays smooth
        stops: [
            { t: 0.0, color: [0.82, 0.85, 0.92] },  // Blue shadow
            { t: 0.3, color: [0.90, 0.92, 0.96] },  // Light blue
            { t: 0.7, color: [0.95, 0.96, 0.98] },  // Near white
            { t: 1.0, color: [0.98, 0.98, 1.00] },  // White
        ],
        layers: [
            { type: 'perlin', octaves: 2, frequency: 2.5, amplitude: 0.8, persistence: 0.3 },
        ]
    },
    ice: {
        name: 'Ice',
        // Pale cyan-blue with crystal structure hint
        stops: [
            { t: 0.0, color: [0.65, 0.78, 0.88] },  // Deep ice blue
            { t: 0.4, color: [0.75, 0.85, 0.92] },  // Medium ice
            { t: 0.8, color: [0.85, 0.92, 0.96] },  // Light ice
            { t: 1.0, color: [0.90, 0.95, 0.98] },  // Near white
        ],
        layers: [
            { type: 'perlin', octaves: 2, frequency: 2.0, amplitude: 0.7, persistence: 0.4 },
            { type: 'worley', octaves: 1, frequency: 4.0, amplitude: 0.15 },  // crystal cells
        ]
    },
    gravel: {
        name: 'Gravel',
        // Speckled warm gray-brown, stippled
        stops: [
            { t: 0.0, color: [0.32, 0.28, 0.24] },  // Dark gravel
            { t: 0.3, color: [0.42, 0.38, 0.34] },  // Medium
            { t: 0.6, color: [0.50, 0.46, 0.40] },  // Warm gray
            { t: 1.0, color: [0.56, 0.52, 0.46] },  // Light gravel
        ],
        layers: [
            { type: 'perlin', octaves: 2, frequency: 3.0, amplitude: 0.5, persistence: 0.5 },
            { type: 'worley', octaves: 1, frequency: 8.0, amplitude: 0.3 },   // pebble stipple
            { type: 'perlin', octaves: 1, frequency: 12.0, amplitude: 0.1 },  // fine grain
        ]
    }
};
```

### Biome Tint Presets (for preview)

The UI shows how each texture looks after biome tint multiplication. These are the current GolemCraft tint values:

```javascript
const BIOME_TINTS = {
    // Temperate
    plains:           [0.30, 0.80, 0.25],
    meadow:           [0.25, 0.90, 0.30],
    autumn_forest:    [0.85, 0.50, 0.20],
    deciduous_forest: [0.40, 0.35, 0.25],
    swamp:            [0.30, 0.40, 0.25],
    // Hot/Arid
    desert:           [1.00, 0.95, 0.80],
    red_desert:       [0.95, 0.55, 0.35],
    savanna:          [0.80, 0.70, 0.30],
    badlands:         [0.75, 0.35, 0.20],
    // Tropical
    jungle:           [0.20, 0.40, 0.15],
    beach:            [1.00, 0.98, 0.90],
    // Cold
    taiga:            [0.35, 0.40, 0.35],
    tundra:           [1.00, 1.00, 1.00],
    glacier:          [1.00, 1.00, 1.00],
    // Mountain
    mountains:        [0.60, 0.60, 0.60],
    volcanic:         [0.25, 0.25, 0.25],
};
```

### Web UI (`app/tabs/textures.js`)

Single-page HTML tool using Three.js for 3D preview.

#### Layout

Left panel: controls. Right panel: preview viewport.

#### Controls

1. **Texture selector** — Dropdown to pick one of 8 base textures. Loading a preset fills all parameters.
2. **Noise parameters** — Sliders for octaves, frequency, amplitude, lacunarity, persistence, seed.
3. **Palette editor** — Color stops displayed as a gradient bar. Click to edit individual stop colors. Add/remove stops.
4. **Resolution** — Dropdown: 64, 128, 256 (default 128).
5. **Biome tint preview** — Dropdown of 16 biomes. Multiplies tint onto the texture in real-time.
6. **Export** — "Export PNG" button saves the current texture. "Export All" batch-exports all 8 presets.

#### Three.js Preview Viewport

Three preview modes, togglable:

**Flat tiled view (default):**
- 3×3 grid of the texture tiled on a flat plane
- Camera looking down at ~45°
- Lambert material, simple directional light
- Verifies seamless tiling at a glance

**Heightfield view:**
- Small heightfield mesh (32×32 vertices) using a separate noise heightmap
- Texture applied with Lambert material
- Normals computed from the heightfield for proper lighting
- Shows how the texture looks on undulating terrain with light/shadow
- Rotate camera with mouse drag

**Voxel block view:**
- Small cluster of 1×1×1 meter voxel cubes (e.g., 4×4×4 or a stepped terrain shape)
- Each top face textured, side faces use a darkened variant
- Lambert material with vertex AO on edges
- Shows how the texture reads on GolemCraft's actual voxel geometry
- Rotate camera with mouse drag
- This is the most accurate preview of how the texture appears in-game on voxel surfaces (caves, cliffs, structures)

All views update in real-time as parameters change.

#### Interaction Flow

1. Select texture preset (e.g., "grass") → fills noise params + palette
2. Tweak parameters → preview updates live on canvas
3. Toggle between flat tiled view and heightfield view
4. Select biome tint from dropdown → see tinted result
5. When satisfied, click Export PNG → saves `[name].png` (128×128)
6. Export All → saves all 8 textures with current preset defaults

#### Export

Textures export as PNG at the selected resolution. Export path targets GolemCraft's `public/textures/` directory structure. File naming: `grass.png`, `forest_floor.png`, `dirt.png`, `sand.png`, `rock.png`, `snow.png`, `ice.png`, `gravel.png`.

---

## Roadmap

### Phase 1: Texture Generator (current)

Build the texture generation tool as described above. This is the immediate priority to unblock GolemCraft's visual overhaul.

Deliverables:
- `src/textures/noisegen.js` — tileable Perlin noise
- `src/textures/palettes.js` — 8 preset palettes with noise params
- `app/tabs/textures.js` — interactive UI with Three.js preview
- 8 exported PNG textures ready for GolemCraft

### Phase 2: Sprite Preview

Preview tool for vegetation billboard sprites (imported PNGs, not generated).

- Import RGBA PNGs (from DALL-E or hand-painted in Aseprite)
- Crossed-quad billboard preview from multiple angles
- Biome tint overlay preview
- Density scatter preview (N instances on a flat plane)
- Alpha edge validation (highlight semi-transparent pixels)
- Wind animation preview (vertex displacement simulation)

### Phase 3: Monster Viewer

Three.js viewport for mob mesh preview.

- Load/display low-poly mob models
- Animation preview (walk, attack, idle)
- Biome tint/color variations
- Export mesh data for GolemCraft entity system

### Phase 4: Voxel Building Editor

3D voxel editor for landmark structures.

- Voxel painting with block type palette
- Preview with lighting
- Export as VoxelVolume data (compatible with GolemCraft landmark system)
- Template library for procedural variation

---

## Integration with GolemCraft

kosmos-gen runs as a development tool (localhost:5174). It produces static files that GolemCraft consumes. The two repositories remain independent with no build coupling.

Workflow:
1. Open kosmos-gen alongside GolemCraft dev server
2. Generate/tweak assets with interactive controls
3. Export to GolemCraft's `public/textures/`
4. Vite hot-reloads changed assets in GolemCraft
5. See results in-game immediately

---

## Dependencies

- **vite** — Dev server and build
- **three** — 3D preview in the web UI (app/ only, not in src/)

---

## Project Context

kosmos-gen is part of the GolemCraft family project. It was originally a procedural island/map generator (spine-Voronoi terrain). That functionality is preserved in git history but the tool's primary role is now build-time asset generation for GolemCraft's visual overhaul.