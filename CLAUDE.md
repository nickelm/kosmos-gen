# kosmos-gen

Procedural island generation library for GolemCraft.

## Project Structure

```
kosmos-gen/
├── src/
│   ├── core/             # Seeds, math, noise
│   ├── geometry/         # Polylines, SDF utilities
│   ├── generation/       # Island generation pipeline
│   │   ├── island-generator.js   # Main orchestrator
│   │   ├── spine-placer.js       # Procedural spine placement
│   │   ├── elevation-field.js    # Height from spines + noise
│   │   ├── hydrology.js          # Rivers, lakes
│   │   ├── settlements.js        # Placement and A* roads
│   │   ├── sdf.js                # Distance/influence field baking
│   │   ├── polyline-index.js     # Spatial indexing (NEW)
│   │   ├── queries.js            # Hybrid query API (NEW)
│   │   ├── profiles.js           # Terrain profiles (NEW)
│   │   └── metadata.js           # IslandMetadata structure
│   ├── visualizer/       # Debug/preview UI
│   └── index.js          # Public API
├── templates/            # Example island configs
└── docs/                 # Documentation
```

## Current State

**Working:**
- Island generation pipeline (spines → elevation → climate → biomes → rivers → settlements → roads)
- Visualizer with stage-by-stage inspection
- SDF baking for coastlines, rivers, roads

**Problem:**
- Raw SDF sampling produces visual artifacts in-game
- Coastlines: sheer drops at zero crossing
- Roads: circular disk shapes instead of natural paths
- Rivers: no proper channel profiles

## Current Focus: Hybrid Query System

Replace raw SDF thresholding with influence textures + vector queries.

### Key Files to Modify/Add

| File | Status | Purpose |
|------|--------|---------|
| `src/generation/polyline-index.js` | NEW | Spatial index for fast polyline lookup |
| `src/generation/sdf.js` | MODIFY | Bake influence (smooth falloff) not raw distance |
| `src/generation/queries.js` | NEW | Hybrid query API for terrain worker |
| `src/generation/profiles.js` | NEW | Coastline/river/road terrain shaping |
| `src/generation/metadata.js` | MODIFY | Add indices and per-vertex polyline attributes |

### Implementation Order

1. `polyline-index.js` — pure geometry, no dependencies
2. Modify SDF baking → influence encoding
3. `queries.js` — two-phase query (influence texture → vector precision)
4. `profiles.js` — terrain modification functions
5. Update metadata schema
6. Visualizer debug tools

See `docs/hybrid_query_spec.md` for full specification.

## Key Concepts

**Island Generation Pipeline:**
1. Params — size, archetype, climate from seed
2. Spines — mountain ridge placement (ridge, arc, crescent, ring, star)
3. Elevation — noise + spine bias + island falloff
4. Climate — temperature, humidity fields
5. Biomes — Whittaker diagram lookup
6. Hydrology — gradient descent rivers, lakes
7. Civilization — settlement placement, A* road network
8. SDF Baking — influence fields for chunk queries

**Hybrid Queries:**
- Influence textures give O(1) "is feature nearby?" answer
- When influence > 0, query actual polyline geometry
- Polylines store per-vertex attributes (width, flow, type)
- Profile functions convert query results to terrain modifications

**IslandMetadata:**
- Exported JSON + binary arrays
- Contains elevation, climate, biomes as raster fields
- Contains coastlines, rivers, roads as polylines with attributes
- Contains spatial indices for vector queries
- GolemCraft terrain worker consumes this

## Running

```bash
npm install
npm run dev     # Start visualizer at localhost:5174
npm run build   # Build for production
```

## Conventions

- ES6 modules, lowercase filenames
- Pure functions where possible
- Deterministic: same seed = same output
- No Three.js dependencies in src/generation/ (visualizer only)
- Coordinates in world blocks unless noted

## Integration with GolemCraft

kosmos-gen produces IslandMetadata. GolemCraft's terrain worker:
1. Loads metadata on first island visit
2. Calls query functions during chunk generation
3. Applies profile functions to shape terrain
4. Stores in IndexedDB for persistence

The game's rendering (Three.js, chunks) is unaffected. Only the terrain data source changes.