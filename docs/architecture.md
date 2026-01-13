# kosmos-worldgen Architecture

**Purpose**: Procedural world generation library with spine-first terrain  
**Primary interface**: Template editor  
**Consumers**: GolemCraft (and future games)

---

## Core Principle

**The spine defines everything.**

A spine is a polyline representing a mountain ridge. All terrain derives from spines:
- Elevation derives from distance to spine
- Coastline is where elevation meets sea level
- Rivers flow from spine toward coast
- Biomes depend on elevation and position
- Zones place on generated terrain

No competing systems. No reconciliation. One source of truth.

---

## Spine Model

### What is a Spine?

A spine is a polyline representing a mountain ridge. Vertices are seeds for a Voronoi diagram.

```
Spine = polyline of vertices
Vertex = { x, z, elevation, influence }
```

- `x, z`: Position in normalized coordinates [-1, 1]
- `elevation`: Peak height (0-1 normalized)
- `influence`: Weight for power diagram (controls cell extent)

### Vertices and Half-Cells

Each vertex generates Voronoi cells:
- **Interior vertices**: 2 half-cells, split by the spine segment
- **Endpoint vertices**: 1 radial cell (360° around the point)

Half-cells are the authorable units. Each has:

```
HalfCell = {
  profile: "ramp" | "plateau" | "bowl" | "shield",
  baseElevation: number,     // Elevation at cell boundary
  falloffCurve: number,      // Shape of descent (0=linear, 1=exponential)
  noise: {
    roughness: number,       // Amplitude (0=smooth, 1=chaotic)
    featureScale: number,    // Frequency of detail
  }
}
```

All half-cells get sensible defaults. Author only configures cells they care about.

### Profile Types

Four named shapes capture common terrain:

| Profile | Shape | Use Case |
|---------|-------|----------|
| **Ramp** | Linear slope | Standard mountain sides |
| **Plateau** | Flat top, steep edges | Mesas, tablelands, highlands |
| **Bowl** | Concave, collects water | Mountain lakes, cirques, calderas |
| **Shield** | Convex, sheds water | Domed peaks, gentle rounded mountains |

### Multiple Spines

Draw as many spines as needed. All spines are equal—no primary/secondary distinction.

- Longer/higher spines naturally dominate
- Spines that approach create straits
- Spines that meet create junction cells
- Disconnected spines create islands

When spines meet or approach, the Voronoi naturally creates cells between them. These internal cells also get profiles—they're not special cases.

### Weighted Voronoi (Power Diagram)

Standard Voronoi gives each seed equal territory. We use a power diagram where `influence` controls cell extent:

```
For point P, owning cell = argmin_i( distance(P, vertex_i)² - influence_i² )
```

Higher influence means the cell reaches further. This controls:
- How far mountains extend into lowlands
- Which spine dominates at contested boundaries
- Relative prominence of peaks

---

## Generation Pipeline

### Phase 1: Voronoi Construction

**Input**: All spine vertices

**Process**:
1. Collect all spine vertices as weighted seeds
2. Compute power diagram (weighted Voronoi)
3. Identify half-cells: interior vertices get 2, endpoints get 1 radial
4. Assign default profiles to all half-cells
5. Apply any authored profile overrides

**Output**: Voronoi cells with half-cell assignments and profiles

### Phase 2: Base Elevation Field

**Input**: Voronoi cells, half-cell profiles

**Process**:
1. For any point, find its Voronoi cell and half-cell
2. Compute distance to the owning spine segment
3. Apply profile function (ramp/plateau/bowl/shield)
4. Elevation = f(spine elevation, base elevation, distance, profile)
5. At cell boundaries: blend using SDF-weighted interpolation

**Output**: Clean elevation field (no noise yet)

### Phase 3: Coastline Extraction

**Input**: Base elevation field

**Process**:
1. Sea level is a constant (e.g., 0.1 normalized)
2. Coastline = contour where elevation = sea level
3. Extract as polyline(s) using marching squares
4. This is the "ideal" coastline from pure geometry

**Output**: Coastline polylines (clean, no noise)

### Phase 4: Terrain Noise

**Input**: Base elevation, half-cell noise parameters

**Process**:
1. For each point, look up owning half-cell's noise config
2. Generate noise deviation: amplitude from roughness, frequency from featureScale
3. Add deviation to base elevation
4. Seed secondary features (ridges, peaks) per cell probability
5. Store secondary feature locations for chunk generation

**Output**: 
- Noisy elevation field
- Secondary feature seed locations
- Coastline may shift slightly from noise

### Phase 5: Hydraulic Simulation

**Input**: Elevation field (with noise), coastline

**Process**:
1. Identify water sources (high elevation, humidity, or author-placed)
2. Simulate water flow via gradient descent
3. Water carves terrain (erosion), deposits sediment
4. Rivers merge when paths meet
5. Rivers terminate at coastline or lakes
6. Lakes fill depressions (bowl-profile cells naturally collect water)

**Output**: 
- River polylines with width/flow data
- Lake polygons
- Modified elevation field (carved valleys)

### Phase 6: Climate

**Input**: Elevation field, coastline, cell configurations

**Process**:
1. Temperature: base from latitude, reduced by elevation
2. Humidity: high near coast/rivers, reduced inland
3. Rain shadow: cells on leeward side of spines are drier
4. Biome: lookup from temperature × humidity × elevation

**Output**: Climate fields, biome assignment per cell

### Phase 7: Zones

**Input**: Terrain, rivers, coastline, template zone rules

**Process**:
1. For each zone slot, find valid placement per constraints
2. Constraints: terrain type, near water, elevation range, on corridor
3. Place zone centers, compute boundaries
4. Connect zones per progression graph

**Output**: Zone polygons with type assignments

### Phase 8: Infrastructure

**Input**: Zones, terrain, corridor definition

**Process**:
1. Identify passes (low-elevation vertices between higher neighbors)
2. Route travel corridor through passes and zone centers
3. Place settlements: along corridor, at river crossings, zone centers
4. Road network: primary roads follow corridor, secondary connect settlements
5. A* pathfinding respecting terrain slope

**Output**: Corridor, settlements, roads

### Phase 9: Landmarks

**Input**: Terrain, zones, settlements, roads

**Process**:
1. For each landmark type, evaluate placement constraints
2. Place as "stamps" that modify local terrain
3. Each landmark: position, type, terrain delta, POI data

**Output**: Landmark placements

### Phase 10: Naming

**Input**: All features, naming palette

**Process**:
1. Generate names for continent, zones, settlements, rivers, mountains
2. Deterministic from seed + palette

**Output**: Name assignments

**Input**: Elevation field, coastline

**Process**:
1. Place water sources along spine (high elevation, humidity)
2. Simulate water flow via gradient descent
3. Water carves terrain (erosion), deposits sediment
4. Rivers merge when paths meet
5. Rivers terminate at coastline or lakes

**Output**: 
- River polylines with width/flow data
- Modified elevation field (carved valleys)
- Lake polygons (where water pools)

### Phase 5: Climate

**Input**: Elevation field, coastline, latitude

**Process**:
1. Temperature: Base from latitude, reduced by elevation
2. Humidity: High near coast/rivers, reduced inland, rain shadow behind mountains
3. Biome: Lookup from temperature × humidity × elevation

**Output**: Climate fields queryable at any point, biome assignment

### Phase 6: Zones

**Input**: Terrain, rivers, coastline, template zone rules

**Process**:
1. For each zone slot in template, find valid placement
2. Constraints: terrain type, near water, elevation range, etc.
3. Place zone centers, compute boundaries (Voronoi or influence blend)
4. Connect zones per template's progression graph

**Output**: Zone polygons with type assignments

### Phase 7: Infrastructure

**Input**: Zones, terrain, travel corridor, passes

**Process**:
1. Travel corridor first: connect origin → passes → crossroads → destination
2. Place settlements per zone rules:
   - Along travel corridor (high priority)
   - At river mouths, crossings
   - Near passes (fortress/waystation)
   - Zone centers
3. Road network:
   - Primary roads follow travel corridor
   - Secondary roads connect settlements to corridor
   - A* pathfinding: minimize slope, avoid water, prefer passes
   - Bridges/fords where roads cross rivers

**Output**: Travel corridor polyline, settlement points, road polylines

### Phase 8: Landmarks

**Input**: Terrain, zones, settlements, roads

**Process**:
1. For each landmark type, evaluate placement constraints:
   - Citadel: steep hill + river + road access
   - Pass fortress: at pass + steep valley walls
   - Ruins: remote + high elevation OR coastal cliff
   - Dark tower: corruption zone + visible from distance
2. Place as "stamps" that modify local terrain
3. Each landmark has: position, type, terrain delta, POI data

**Output**: Landmark placements with terrain modifications

### Phase 9: Naming

**Input**: All generated features, naming palette

**Process**:
1. Generate names for: continent, zones, settlements, rivers, lakes, mountains
2. Deterministic from seed + palette

**Output**: Name assignments for all features

---

## Data Representation

### Vector First, Raster Second

All features stored as vectors:
- Spines: polylines
- Coastlines: polylines
- Rivers: polylines with width
- Roads: polylines
- Zones: polygons
- Lakes: polygons

Rasterize on demand for:
- Editor display
- Game terrain chunks
- Minimap

### Distance Fields (SDF)

For efficient queries, bake vectors to distance field textures:
- 512×512 or 1024×1024 resolution
- Multiple channels per texture
- O(1) lookup: "how far is this point from nearest river?"

SDFs are derived from vectors, not source of truth.

### Continental Metadata

Complete generated output, stored for reuse:

```
ContinentMetadata = {
  id, seed, version, bounds,
  
  // Vector data
  spines: [...],
  coastlines: [...],
  rivers: [...],
  lakes: [...],
  zones: [...],
  roads: [...],
  settlements: [...],
  names: {...},
  
  // Raster data (baked SDFs)
  elevationSDF: Uint8Array,
  hydroSDF: Uint8Array,
  climateSDF: Uint8Array,
}
```

---

## Template Structure

Templates define geometry and defaults. Same template + different seed = varied but recognizable terrain.

```javascript
{
  id: "verdania",
  name: "Verdania",
  
  // All spines (no primary/secondary distinction)
  spines: [
    {
      id: "southern_range",
      vertices: [
        { x: -0.4, z: 0.3, elevation: 0.7, influence: 400 },
        { x: 0.0, z: 0.2, elevation: 0.9, influence: 450 },   // highest peak
        { x: 0.15, z: 0.25, elevation: 0.5, influence: 300 }, // pass (low elevation)
        { x: 0.4, z: 0.3, elevation: 0.75, influence: 400 },
      ]
    },
    {
      id: "northern_hills",
      vertices: [
        { x: -0.2, z: -0.3, elevation: 0.4, influence: 250 },
        { x: 0.1, z: -0.35, elevation: 0.45, influence: 280 },
      ]
    },
    {
      id: "eastern_island",
      vertices: [
        { x: 0.6, z: 0.0, elevation: 0.5, influence: 200 },
        { x: 0.7, z: 0.05, elevation: 0.55, influence: 220 },
      ]
    }
  ],
  
  // Half-cell overrides (most use defaults)
  halfCells: {
    "southern_range:1:left": {
      profile: "shield",
      noise: { roughness: 0.6, featureScale: 0.3 }
    },
    "southern_range:1:right": {
      profile: "ramp",
      noise: { roughness: 0.4, featureScale: 0.2 }
    },
    "southern_range:2:left": {
      profile: "bowl",  // mountain lake here
      noise: { roughness: 0.2, featureScale: 0.1 }
    }
  },
  
  // Defaults for unconfigured half-cells
  defaults: {
    profile: "ramp",
    baseElevation: 0.1,  // sea level
    falloffCurve: 0.5,
    noise: {
      roughness: 0.3,
      featureScale: 0.2
    }
  },
  
  // Climate
  climate: {
    temperatureGradient: { direction: "north-south", strength: 0.5 },
    humidityBase: 0.5,
    rainShadowSide: "right",  // right side of spine direction is dry
    excludedBiomes: ["desert", "volcanic"]
  },
  
  // Zone placement rules
  zones: [
    {
      slot: "origin",
      type: "haven",
      placement: { terrain: "coastal", climate: "temperate", onCorridor: true },
      levelRange: [1, 3],
      required: true
    },
    {
      slot: "mountain_pass",
      type: "crossroads",
      placement: { nearVertex: "southern_range:2", onCorridor: true },
      levelRange: [4, 6]
    }
  ],
  
  // Travel corridor
  corridor: {
    waypoints: ["origin", "southern_range:2", "borderlands"]
  },
  
  // Landmarks
  landmarks: [
    {
      type: "citadel",
      zone: "origin",
      constraints: ["steep_hill", "river_adjacent"]
    }
  ],
  
  // Naming
  naming: {
    palette: "pastoral-english"
  }
}
```

### Half-Cell Addressing

Half-cells are addressed as: `spineId:vertexIndex:side`

- `side` is "left" or "right" relative to spine direction
- Endpoints (first and last vertex) have only one cell, addressed as `spineId:0:radial` or `spineId:N:radial`

### Passes

Passes aren't marked explicitly. A pass is simply a vertex with lower elevation than its neighbors. The system detects these automatically for corridor routing.

---

## Editor Role

The editor is the primary authoring tool. Direct manipulation with instant feedback.

### Design Philosophy

**Draw, don't configure.** Instead of filling forms, draw on the canvas and see results immediately.

**Progressive refinement.** Each tab builds on the previous. See clean geometry first, add complexity later.

### Editor Tabs

The editor has global tabs representing generation phases:

---

**Tab 1: Spines**

Draw mountain spines, see Voronoi cells and ideal coastline.

*Actions:*
- Draw spines (click to add vertices)
- Drag vertices to reposition
- Adjust vertex elevation (drag handle or slider)
- Adjust vertex influence (drag radial handle)
- Select half-cells, assign profiles
- Configure half-cell parameters (falloff, base elevation)

*Display:*
- Voronoi cells with boundaries
- Coastline contour (where elevation = sea level)
- Elevation coloring per cell (no noise yet)
- Clean geometric preview

*Result:* Continent shape and cell structure established.

---

**Tab 2: Terrain Noise**

Add procedural detail to the clean geometry.

*Actions:*
- Set global noise defaults
- Override noise per half-cell (roughness, feature scale)
- Toggle secondary features (ridges, peaks) per cell
- Seed secondary feature locations

*Display:*
- Noisy elevation preview
- Toggle between clean/noisy views
- Secondary ridges and peaks visible

*Result:* Terrain has natural variation and detail.

---

**Tab 3: Hydrology**

Add water features that respond to terrain.

*Actions:*
- Place water sources (springs, rainfall zones)
- Mark lake basins (or auto-detect from bowl profiles)
- Adjust river density, meandering
- Run flow simulation

*Display:*
- Rivers tracing from sources to coast
- Lakes filling depressions
- Watershed boundaries (optional overlay)

*Result:* Coherent drainage network.

---

**Tab 4: Climate**

Set temperature and humidity patterns.

*Actions:*
- Set temperature gradient (drag arrow)
- Set base humidity
- Configure rain shadow (which side of spines is dry)
- Exclude biomes

*Display:*
- Temperature/humidity overlays
- Biome colors
- Rain shadow visualization

*Result:* Biome distribution established.

---

**Tab 5: Zones & Routes**

Place gameplay regions and travel routes.

*Actions:*
- Define zone slots with placement rules
- Draw travel corridor through terrain
- Mark passes as waypoints
- Set zone connections (progression graph)

*Display:*
- Zone placements (colored regions)
- Travel corridor path
- Zone connection graph

*Result:* Gameplay geography defined.

---

**Tab 6: Landmarks & Content**

Place setpieces and import content.

*Actions:*
- Define landmark constraints
- Place landmark hints
- Import content pools (NPCs, quests, lore)
- Configure naming palette

*Display:*
- Landmark placements
- Content coverage statistics
- Generated names preview

*Result:* Ready for export.

---

### Instant Feedback

Every edit triggers immediate preview update:
- Tab 1-2: <100ms for geometry, 1-2s for full noise
- Tab 3: Flow simulation may take seconds (show progress)
- Tab 4-6: Nearly instant

No "Generate" button for basic edits. Preview is always live.

### View Mode

Any tab can switch to View Mode:
- Load existing template
- Change seed to see variations
- Compare multiple seeds side-by-side
- Pan/zoom the result
- Inspect values at cursor

---

## Determinism

**Absolute requirement**: Same template + same seed = identical output.

Every random decision uses seeded RNG derived from world seed:
- Spine vertex jitter
- River source placement
- Zone placement tiebreakers
- Name generation

No `Math.random()`. No time-based seeds. No floating point indeterminism.

---

## Performance Targets

**Continental generation** (one-time):
- 30-120 seconds acceptable
- Show progress: "Carving rivers...", "Placing settlements..."
- Result cached in IndexedDB

**Chunk generation** (runtime):
- <10ms per chunk
- Query SDFs, no simulation
- Pure function of position + metadata

**Editor preview**:
- Coarse view in <100ms
- Full detail in <2 seconds
- Pan/zoom instant (image transform)

---

## Module Structure

```
kosmos-worldgen/
├── src/
│   ├── core/
│   │   ├── seeds.js        # Deterministic RNG, seed derivation
│   │   ├── math.js         # Vector math, interpolation
│   │   ├── noise.js        # Perlin, simplex (for detail/warp)
│   │   └── warp.js         # Canonical space warping
│   │
│   ├── geometry/
│   │   ├── voronoi.js      # Voronoi diagram construction
│   │   ├── polyline.js     # Polyline utilities
│   │   ├── polygon.js      # Polygon utilities
│   │   ├── sdf.js          # Distance field generation/sampling
│   │   └── contour.js      # Contour extraction (marching squares)
│   │
│   ├── terrain/
│   │   ├── spine.js        # Spine representation and operations
│   │   ├── elevation.js    # Elevation field from Voronoi + spines
│   │   ├── erosion.js      # Hydraulic erosion simulation
│   │   ├── coastline.js    # Coastline extraction and refinement
│   │   └── passes.js       # Pass detection and saddle generation
│   │
│   ├── hydrology/
│   │   ├── rivers.js       # River tracing from spine to coast
│   │   ├── lakes.js        # Lake detection and filling
│   │   └── watersheds.js   # Drainage basin analysis
│   │
│   ├── climate/
│   │   ├── temperature.js  # Temperature field (latitude + elevation)
│   │   ├── humidity.js     # Humidity field (coast + rain shadow)
│   │   └── biomes.js       # Biome classification
│   │
│   ├── infrastructure/
│   │   ├── corridor.js     # Travel corridor placement
│   │   ├── zones.js        # Zone placement from constraints
│   │   ├── settlements.js  # Settlement placement
│   │   ├── roads.js        # Road pathfinding
│   │   └── landmarks.js    # Landmark stamp placement
│   │
│   ├── naming/
│   │   ├── generator.js    # Name generation
│   │   └── palettes/       # Naming palettes (JSON)
│   │
│   ├── content/
│   │   ├── loader.js       # Content pool loading
│   │   ├── selector.js     # Seed-based selection
│   │   └── instantiator.js # Variable binding
│   │
│   ├── storage/
│   │   └── indexeddb.js    # Persistence
│   │
│   └── index.js            # Public API
│
├── editor/
│   ├── index.html
│   ├── app.js
│   ├── state.js            # Template state, undo/redo
│   ├── canvas/
│   │   ├── renderer.js     # Offscreen canvas, progressive refinement
│   │   ├── layers.js       # Layer rendering
│   │   └── interaction.js  # Pan, zoom, hit testing
│   ├── tools/
│   │   ├── spine.js        # Spine drawing/editing tool
│   │   ├── pass.js         # Pass marking tool
│   │   ├── corridor.js     # Corridor drawing tool
│   │   ├── region.js       # Region painting tool
│   │   └── point.js        # Point placement tool
│   ├── stages/
│   │   ├── spines.js       # Stage 1
│   │   ├── coastline.js    # Stage 2
│   │   ├── hydrology.js    # Stage 3
│   │   ├── climate.js      # Stage 4
│   │   ├── zones.js        # Stage 5
│   │   └── landmarks.js    # Stage 6
│   ├── panels/
│   │   ├── properties.js   # Context-sensitive properties
│   │   ├── layers.js       # Layer toggles
│   │   └── seeds.js        # Seed controls, comparison
│   └── io/
│       ├── export.js       # Export template
│       └── import.js       # Import template
│
├── templates/
│   └── verdania.json       # Example template
│
├── docs/
│   └── architecture.md     # This document
│
├── package.json
├── vite.config.js
├── CLAUDE.md
└── README.md
```

---

## Public API

```javascript
import { 
  generateContinent,
  loadTemplate,
  sampleElevation,
  sampleBiome,
  getZoneAt,
  getRiverInfluence
} from 'kosmos-worldgen';

// Generate a continent
const metadata = await generateContinent(template, seed, { 
  onProgress: (stage, percent) => updateUI(stage, percent)
});

// Query at runtime
const elevation = sampleElevation(metadata, x, z);
const biome = sampleBiome(metadata, x, z);
const zone = getZoneAt(metadata, x, z);
```

---

## Migration Path

1. **Build kosmos-worldgen** with editor, working independently
2. **Validate** by creating Verdania template, comparing to GolemCraft's current terrain
3. **Integrate** into GolemCraft: replace worldgen imports, adapt terrain worker
4. **Deprecate** old GolemCraft worldgen code

The game's rendering (Three.js, chunks) is unaffected. Only the terrain data source changes.

---

## First Milestone

Minimum viable terrain to validate the approach:

1. **Editor with Tab 1 (Spines)**
2. **Draw spines** (click to add vertices, drag to move)
3. **Adjust vertex elevation and influence** (handles)
4. **Compute power diagram** (weighted Voronoi) from vertices
5. **Generate elevation field** from half-cell profiles (default ramp)
6. **Display clean heightmap** (colored by elevation, no noise)
7. **See coastline** emerge where elevation = sea level
8. **Select half-cell**, change its profile, see terrain update

No rivers, zones, biomes, or noise yet. Just: spine → Voronoi → elevation → display.

This validates:
- Half-cell model gives intuitive control
- Power diagram creates coherent cell structure
- Profiles shape terrain predictably
- Coastline emerges naturally from geometry
- Direct manipulation feels responsive

Once this works, add Tab 2 (noise), then Tab 3 (hydrology), and so on.

---

*End of Architecture Document*
