# kosmos-gen

Procedural world generation with spine-Voronoi terrain.

## Overview

kosmos-gen generates coherent continental terrain from authored mountain spines. Instead of pure noise, terrain structure emerges from the spine geometry:

- **Spines** define mountain ridges as polylines
- **Voronoi cells** partition terrain around spine vertices  
- **Half-cells** allow asymmetric slopes (steep cliffs vs. gentle foothills)
- **Profiles** shape each cell (ramp, plateau, bowl, shield)
- **Coastlines** emerge where elevation meets sea level

The result: authored macro-structure with procedural detail. Same template + different seed = recognizably similar but unique terrain.

## Features

- Spine-based terrain generation
- Weighted Voronoi (power diagram) for cell control
- Per-cell elevation profiles and noise parameters
- River simulation with erosion
- Climate and biome mapping
- Zone placement with constraints
- Template editor with live preview

## Installation

```bash
npm install kosmos-gen
```

## Quick Start

```javascript
import { generateWorld, sampleElevation } from 'kosmos-gen';

// Generate from template and seed
const world = await generateWorld(template, seed);

// Query terrain at any point
const elevation = sampleElevation(world, x, z);
const biome = sampleBiome(world, x, z);
```

## Editor

The template editor provides direct manipulation authoring:

```bash
npm run dev
```

Open `http://localhost:5174` to draw spines, configure cells, and preview terrain.

## Documentation

See [docs/architecture.md](docs/architecture.md) for full design details.

## License

MIT
