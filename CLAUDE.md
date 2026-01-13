# kosmos-gen

Procedural world generation library with spine-Voronoi terrain.

## Project Structure

```
kosmos-gen/
├── src/                  # Library source
│   ├── core/             # Seeds, math, noise
│   ├── geometry/         # Voronoi, polylines, SDF
│   ├── terrain/          # Spines, elevation, profiles
│   ├── world/            # World data structure, queries, storage
│   └── index.js          # Public API
├── editor/               # Template editor application
├── templates/            # Example templates
└── docs/                 # Documentation
```

## Key Concepts

**Spine-Voronoi terrain**: Mountain spines (polylines) define ridges. Spine vertices become Voronoi seeds. Each vertex creates half-cells with configurable elevation profiles.

**Half-cells**: Interior vertices create 2 half-cells (left/right of spine). Endpoints create 1 radial cell. Each half-cell has a profile (ramp/plateau/bowl/shield) and noise parameters.

**Power diagram**: Weighted Voronoi where vertex `influence` controls cell extent.

**Profiles**: Named terrain shapes—ramp (linear slope), plateau (flat top), bowl (concave), shield (convex).

## Running

```bash
npm install
npm run dev     # Start editor at localhost:5174
npm run build   # Build for production
```

## Architecture

See `docs/architecture.md` for full design.

## Conventions

- ES6 modules, lowercase filenames
- Pure functions where possible
- Deterministic: same seed = same output
- No Three.js or DOM dependencies in src/ (editor only)
- Coordinates in normalized space [-1, 1] unless noted

## Editor Tabs

1. **Spines** — Draw spines, see Voronoi cells and coastline
2. **Terrain Noise** — Add procedural detail
3. **Hydrology** — Rivers and lakes
4. **Climate** — Temperature, humidity, biomes
5. **Zones & Routes** — Gameplay regions
6. **Landmarks & Content** — Setpieces, NPCs, quests

## Current Focus

Building Tab 1: spine drawing → Voronoi → elevation → coastline display.
