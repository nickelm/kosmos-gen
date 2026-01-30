/**
 * 3D terrain viewer
 *
 * Three.js scene with orbit controls, heightfield mesh, water plane,
 * river ribbons, lake surfaces, and directional + ambient lighting.
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { getBiomeColorNormalized } from './biome-colors.js';

/**
 * Base vertical scale mapping [0,1] elevation to scene Y units.
 * The XZ plane spans [-1,1] (2 units). Without scaling, a peak of 0.8
 * would be 40% of terrain width — far too steep. 0.3 gives ~12%
 * height-to-width ratio, matching natural island proportions.
 */
const DEFAULT_HEIGHT_SCALE = 0.3;

/** Sand/beach color for underwater and shoreline terrain */
const SAND_COLOR = { r: 0.82, g: 0.72, b: 0.55 };

/** How far above water level (in world elevation units) to apply beach coloring */
const BEACH_BAND = 0.015;

/** SDF distance threshold (in world units) for sandy river/lake bed coloring */
const RIVER_SAND_RADIUS = 0.025;
const LAKE_SAND_RADIUS = 0.015;

export class View3D {
  /**
   * @param {HTMLElement} container - DOM element to host the WebGL canvas
   */
  constructor(container) {
    this.container = container;
    this.visible = false;
    this.heightExaggeration = 1;
    this.baseHeightScale = DEFAULT_HEIGHT_SCALE;
    this.seaLevel = 0.10;

    // Stored for exaggeration updates without full rebuild
    this.elevationData = null;
    this.hydrologyData = null;
    this.settlementsData = null;
    this.terrainMesh = null;
    this.terrainMaterial = null;

    // River and lake water surface meshes
    this.riverMeshes = [];
    this.lakeMeshes = [];
    this.inlandWaterMaterial = null;

    // Settlement markers (sprites)
    this.settlementMarkers = [];

    this._initRenderer();
    this._initCamera();
    this._initControls();
    this._initLighting();
    this._initWaterPlane();
    this._initInlandWaterMaterial();
    this._animate();
  }

  // ---------------------------------------------------------------------------
  // Initialization
  // ---------------------------------------------------------------------------

  _initRenderer() {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearColor(0x0a0a1a);

    const w = this.container.clientWidth || 1;
    const h = this.container.clientHeight || 1;
    this.renderer.setSize(w, h);
    this.container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
  }

  _initCamera() {
    const w = this.container.clientWidth || 1;
    const h = this.container.clientHeight || 1;
    this.camera = new THREE.PerspectiveCamera(50, w / h, 0.01, 100);
    this.camera.position.set(0, 1.5, 2);
    this.camera.lookAt(0, 0, 0);
  }

  _initControls() {
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.12;
    this.controls.target.set(0, 0, 0);
    this.controls.minDistance = 0.3;
    this.controls.maxDistance = 8;
    this.controls.update();
  }

  _initLighting() {
    const ambient = new THREE.AmbientLight(0xffffff, 0.4);
    this.scene.add(ambient);

    const directional = new THREE.DirectionalLight(0xffffff, 0.8);
    directional.position.set(1, 2, 1).normalize();
    this.scene.add(directional);
  }

  _initWaterPlane() {
    const geo = new THREE.PlaneGeometry(2.2, 2.2);
    geo.rotateX(-Math.PI / 2);

    this.waterMaterial = new THREE.MeshLambertMaterial({
      color: 0x1565c0,
      transparent: true,
      opacity: 0.55,
      side: THREE.DoubleSide,
    });

    this.waterMesh = new THREE.Mesh(geo, this.waterMaterial);
    this.waterMesh.position.y = this.seaLevel * this.baseHeightScale * this.heightExaggeration;
    this.scene.add(this.waterMesh);
  }

  _initInlandWaterMaterial() {
    this.inlandWaterMaterial = new THREE.MeshLambertMaterial({
      color: 0x2288cc,
      transparent: true,
      opacity: 0.5,
      side: THREE.DoubleSide,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -4,
    });
  }

  // ---------------------------------------------------------------------------
  // Animation
  // ---------------------------------------------------------------------------

  _animate() {
    this._animationId = requestAnimationFrame(() => this._animate());
    if (!this.visible) return;
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Build or update the terrain mesh from generation data.
   *
   * @param {{ width: number, height: number, data: Float32Array }} elevation
   * @param {{ width: number, height: number, data: Uint8Array } | null} biomes
   * @param {{ seaLevel?: number }} params
   * @param {Object | null} hydrology - { rivers, lakes, riverSDF, lakeSDF, width, height }
   * @param {Object | null} settlements - { settlements: Array }
   */
  updateTerrain(elevation, biomes, params, hydrology, settlements) {
    if (!elevation) return;

    // Store for exaggeration updates
    this.elevationData = elevation;
    this.hydrologyData = hydrology || null;
    this.settlementsData = settlements || null;
    if (params && params.seaLevel !== undefined) {
      this.seaLevel = params.seaLevel;
    }

    // Dispose previous mesh
    if (this.terrainMesh) {
      this.terrainMesh.geometry.dispose();
      this.scene.remove(this.terrainMesh);
    }
    if (this.terrainMaterial) {
      this.terrainMaterial.dispose();
    }

    const { width, height, data } = elevation;
    const vertexCount = width * height;

    // Build vertex positions
    const positions = new Float32Array(vertexCount * 3);
    for (let iz = 0; iz < height; iz++) {
      for (let ix = 0; ix < width; ix++) {
        const vi = iz * width + ix;
        const nx = (ix / (width - 1)) * 2 - 1;
        const nz = (iz / (height - 1)) * 2 - 1;
        const elev = data[vi] * this.baseHeightScale * this.heightExaggeration;
        positions[vi * 3] = nx;
        positions[vi * 3 + 1] = elev;
        positions[vi * 3 + 2] = nz;
      }
    }

    // Apply settlement terracing to vertex positions
    if (settlements?.settlements) {
      this._applySettlementTerracing(positions, width, height, data, settlements.settlements);
    }

    // Build vertex colors (with sandy/beach coloring)
    const colors = new Float32Array(vertexCount * 3);
    this._buildVertexColors(colors, elevation, biomes, hydrology);

    // Build triangle index buffer
    const indexCount = (width - 1) * (height - 1) * 6;
    const useUint32 = vertexCount > 65535;
    const indices = useUint32
      ? new Uint32Array(indexCount)
      : new Uint16Array(indexCount);

    let idx = 0;
    for (let iz = 0; iz < height - 1; iz++) {
      for (let ix = 0; ix < width - 1; ix++) {
        const a = iz * width + ix;
        const b = a + 1;
        const c = a + width;
        const d = c + 1;
        indices[idx++] = a;
        indices[idx++] = c;
        indices[idx++] = b;
        indices[idx++] = b;
        indices[idx++] = c;
        indices[idx++] = d;
      }
    }

    // Assemble geometry
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.setIndex(new THREE.BufferAttribute(indices, 1));
    geometry.computeVertexNormals();

    // Material
    this.terrainMaterial = new THREE.MeshLambertMaterial({ vertexColors: true });

    // Mesh
    this.terrainMesh = new THREE.Mesh(geometry, this.terrainMaterial);
    this.scene.add(this.terrainMesh);

    // Update water plane
    this.waterMesh.position.y = this.seaLevel * this.baseHeightScale * this.heightExaggeration;

    // Build river and lake water surfaces
    this._clearInlandWater();
    if (hydrology) {
      this._buildRiverMeshes(hydrology.rivers);
      this._buildLakeMeshes(hydrology.lakes);
    }

    // Build settlement markers
    this._clearSettlementMarkers();
    if (settlements?.settlements) {
      this._buildSettlementMarkers(settlements.settlements, data, width, height);
    }
  }

  /**
   * Build vertex colors with sandy/beach coloring for underwater and shoreline areas.
   */
  _buildVertexColors(colors, elevation, biomes, hydrology) {
    const { width, height, data } = elevation;
    const vertexCount = width * height;

    // First pass: base biome colors
    if (biomes && biomes.data && biomes.data.length === vertexCount) {
      for (let i = 0; i < vertexCount; i++) {
        const c = getBiomeColorNormalized(biomes.data[i]);
        colors[i * 3] = c.r;
        colors[i * 3 + 1] = c.g;
        colors[i * 3 + 2] = c.b;
      }
    } else {
      for (let i = 0; i < vertexCount; i++) {
        const v = data[i];
        colors[i * 3] = v;
        colors[i * 3 + 1] = v;
        colors[i * 3 + 2] = v;
      }
    }

    // Second pass: blend toward sandy color for underwater and near-shore areas
    const seaLevel = this.seaLevel;

    // Ocean shoreline sandy coloring
    for (let i = 0; i < vertexCount; i++) {
      const elev = data[i];

      // Underwater (below sea level): full sand
      if (elev < seaLevel) {
        const depth = seaLevel - elev;
        // Stronger sand color in shallow water, blends to darker in deep
        const t = Math.min(1.0, depth / 0.08);
        const sandBlend = 1.0 - t * 0.3; // Even deep water stays sandy
        colors[i * 3]     = colors[i * 3]     * (1 - sandBlend) + SAND_COLOR.r * sandBlend;
        colors[i * 3 + 1] = colors[i * 3 + 1] * (1 - sandBlend) + SAND_COLOR.g * sandBlend;
        colors[i * 3 + 2] = colors[i * 3 + 2] * (1 - sandBlend) + SAND_COLOR.b * sandBlend;
        continue;
      }

      // Beach band just above sea level
      if (elev < seaLevel + BEACH_BAND) {
        const t = (elev - seaLevel) / BEACH_BAND; // 0 at water, 1 at top of band
        const sandBlend = 1.0 - t; // Full sand at waterline, fading out
        colors[i * 3]     = colors[i * 3]     * (1 - sandBlend) + SAND_COLOR.r * sandBlend;
        colors[i * 3 + 1] = colors[i * 3 + 1] * (1 - sandBlend) + SAND_COLOR.g * sandBlend;
        colors[i * 3 + 2] = colors[i * 3 + 2] * (1 - sandBlend) + SAND_COLOR.b * sandBlend;
      }
    }

    // River and lake sandy coloring using SDF data
    if (hydrology) {
      this._applyRiverLakeSandColors(colors, elevation, hydrology);
    }
  }

  /**
   * Apply sandy coloring near rivers and lakes using SDF distance fields.
   */
  _applyRiverLakeSandColors(colors, elevation, hydrology) {
    const { width, height, data } = elevation;
    const { riverSDF, lakeSDF } = hydrology;
    const sdfW = hydrology.width;
    const sdfH = hydrology.height;

    // River sandy coloring
    if (riverSDF && sdfW && sdfH) {
      for (let iz = 0; iz < height; iz++) {
        for (let ix = 0; ix < width; ix++) {
          const vi = iz * width + ix;

          // Map terrain grid to SDF grid
          const sdfX = Math.floor((ix / (width - 1)) * (sdfW - 1));
          const sdfZ = Math.floor((iz / (height - 1)) * (sdfH - 1));
          const sdfIdx = sdfZ * sdfW + sdfX;

          if (sdfIdx < 0 || sdfIdx >= riverSDF.length) continue;
          const dist = riverSDF[sdfIdx];

          if (dist < RIVER_SAND_RADIUS) {
            // Stronger sand close to river, fading out
            const t = dist / RIVER_SAND_RADIUS;
            const sandBlend = (1.0 - t * t) * 0.8; // Quadratic falloff, max 80%
            colors[vi * 3]     = colors[vi * 3]     * (1 - sandBlend) + SAND_COLOR.r * sandBlend;
            colors[vi * 3 + 1] = colors[vi * 3 + 1] * (1 - sandBlend) + SAND_COLOR.g * sandBlend;
            colors[vi * 3 + 2] = colors[vi * 3 + 2] * (1 - sandBlend) + SAND_COLOR.b * sandBlend;
          }
        }
      }
    }

    // Lake sandy coloring
    if (lakeSDF && sdfW && sdfH) {
      for (let iz = 0; iz < height; iz++) {
        for (let ix = 0; ix < width; ix++) {
          const vi = iz * width + ix;

          const sdfX = Math.floor((ix / (width - 1)) * (sdfW - 1));
          const sdfZ = Math.floor((iz / (height - 1)) * (sdfH - 1));
          const sdfIdx = sdfZ * sdfW + sdfX;

          if (sdfIdx < 0 || sdfIdx >= lakeSDF.length) continue;
          const dist = lakeSDF[sdfIdx];

          // lakeSDF is signed: negative = inside lake, positive = outside
          if (dist < LAKE_SAND_RADIUS) {
            const inside = dist <= 0;
            const absDist = Math.abs(dist);
            let sandBlend;
            if (inside) {
              // Inside lake: strong sandy bed
              sandBlend = 0.85;
            } else {
              // Outside: shore band
              const t = absDist / LAKE_SAND_RADIUS;
              sandBlend = (1.0 - t * t) * 0.7;
            }
            colors[vi * 3]     = colors[vi * 3]     * (1 - sandBlend) + SAND_COLOR.r * sandBlend;
            colors[vi * 3 + 1] = colors[vi * 3 + 1] * (1 - sandBlend) + SAND_COLOR.g * sandBlend;
            colors[vi * 3 + 2] = colors[vi * 3 + 2] * (1 - sandBlend) + SAND_COLOR.b * sandBlend;
          }
        }
      }
    }
  }

  // ---------------------------------------------------------------------------
  // River ribbon meshes
  // ---------------------------------------------------------------------------

  /**
   * Build flat ribbon meshes for each river following its polyline.
   * @param {Array} rivers - River objects with vertices[].{x, z, elevation, width}
   */
  _buildRiverMeshes(rivers) {
    if (!rivers || rivers.length === 0) return;

    const hScale = this.baseHeightScale * this.heightExaggeration;
    const WATER_LIFT = 0.005; // Lift water above terrain to avoid z-fighting

    for (const river of rivers) {
      const verts = river.vertices;
      if (!verts || verts.length < 2) continue;

      // Build left/right ribbon vertices
      const ribbonPositions = [];

      for (let i = 0; i < verts.length; i++) {
        const v = verts[i];

        // Compute tangent direction
        let tx, tz;
        if (i === 0) {
          tx = verts[1].x - v.x;
          tz = verts[1].z - v.z;
        } else if (i === verts.length - 1) {
          tx = v.x - verts[i - 1].x;
          tz = v.z - verts[i - 1].z;
        } else {
          tx = verts[i + 1].x - verts[i - 1].x;
          tz = verts[i + 1].z - verts[i - 1].z;
        }

        // Normalize tangent
        const tLen = Math.sqrt(tx * tx + tz * tz);
        if (tLen < 1e-8) continue;
        tx /= tLen;
        tz /= tLen;

        // Perpendicular (normal to tangent in XZ plane)
        const nx = -tz;
        const nz = tx;

        // River half-width
        const halfW = (v.width || 0.006) * 0.5;

        // Y position: river elevation scaled to 3D
        const y = (v.elevation || 0) * hScale + WATER_LIFT;

        // Left vertex
        ribbonPositions.push(v.x + nx * halfW, y, v.z + nz * halfW);
        // Right vertex
        ribbonPositions.push(v.x - nx * halfW, y, v.z - nz * halfW);
      }

      // Need at least 2 cross-sections (4 vertices)
      const crossSections = ribbonPositions.length / 6;
      if (crossSections < 2) continue;

      // Build triangle indices for the ribbon strip
      const triCount = (crossSections - 1) * 2;
      const indices = new Uint16Array(triCount * 3);
      let idx = 0;
      for (let s = 0; s < crossSections - 1; s++) {
        const bl = s * 2;       // bottom-left
        const br = s * 2 + 1;   // bottom-right
        const tl = (s + 1) * 2; // top-left
        const tr = (s + 1) * 2 + 1; // top-right

        // Two triangles per quad
        indices[idx++] = bl;
        indices[idx++] = tl;
        indices[idx++] = br;
        indices[idx++] = br;
        indices[idx++] = tl;
        indices[idx++] = tr;
      }

      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(ribbonPositions, 3));
      geometry.setIndex(new THREE.BufferAttribute(indices, 1));
      geometry.computeVertexNormals();

      const mesh = new THREE.Mesh(geometry, this.inlandWaterMaterial);
      this.scene.add(mesh);
      this.riverMeshes.push(mesh);
    }
  }

  // ---------------------------------------------------------------------------
  // Lake polygon meshes
  // ---------------------------------------------------------------------------

  /**
   * Build flat polygon meshes for each lake at its water level.
   * @param {Array} lakes - Lake objects with boundary[].{x, z} and waterLevel
   */
  _buildLakeMeshes(lakes) {
    if (!lakes || lakes.length === 0) return;

    const hScale = this.baseHeightScale * this.heightExaggeration;
    const WATER_LIFT = 0.005;

    for (const lake of lakes) {
      const boundary = lake.boundary;
      if (!boundary || boundary.length < 3) continue;

      const y = (lake.waterLevel || this.seaLevel) * hScale + WATER_LIFT;

      // Build positions from boundary
      const positions = new Float32Array(boundary.length * 3);
      for (let i = 0; i < boundary.length; i++) {
        positions[i * 3] = boundary[i].x;
        positions[i * 3 + 1] = y;
        positions[i * 3 + 2] = boundary[i].z;
      }

      // Fan triangulation from centroid (insert centroid as vertex 0)
      // Compute centroid
      let cx = 0, cz = 0;
      for (const p of boundary) {
        cx += p.x;
        cz += p.z;
      }
      cx /= boundary.length;
      cz /= boundary.length;

      // Positions: centroid + boundary vertices
      const totalVerts = boundary.length + 1;
      const allPositions = new Float32Array(totalVerts * 3);
      allPositions[0] = cx;
      allPositions[1] = y;
      allPositions[2] = cz;
      for (let i = 0; i < boundary.length; i++) {
        allPositions[(i + 1) * 3] = boundary[i].x;
        allPositions[(i + 1) * 3 + 1] = y;
        allPositions[(i + 1) * 3 + 2] = boundary[i].z;
      }

      // Fan triangles: centroid (0) -> boundary[i] -> boundary[i+1]
      const triCount = boundary.length;
      const indices = [];
      for (let i = 0; i < boundary.length; i++) {
        const next = (i + 1) % boundary.length;
        indices.push(0, i + 1, next + 1);
      }

      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(allPositions, 3));
      geometry.setIndex(indices);
      geometry.computeVertexNormals();

      const mesh = new THREE.Mesh(geometry, this.inlandWaterMaterial);
      this.scene.add(mesh);
      this.lakeMeshes.push(mesh);
    }
  }

  /**
   * Remove all river and lake water surface meshes from the scene.
   */
  _clearInlandWater() {
    for (const mesh of this.riverMeshes) {
      mesh.geometry.dispose();
      this.scene.remove(mesh);
    }
    this.riverMeshes = [];

    for (const mesh of this.lakeMeshes) {
      mesh.geometry.dispose();
      this.scene.remove(mesh);
    }
    this.lakeMeshes = [];
  }

  // ---------------------------------------------------------------------------
  // Settlement markers (3D sprites with names)
  // ---------------------------------------------------------------------------

  /** Marker colors by settlement type */
  static MARKER_COLORS = {
    city:    { dot: '#daa520', bg: 'rgba(218, 165, 32, 0.85)', text: '#fff' },
    village: { dot: '#8b5a2b', bg: 'rgba(139, 90, 43, 0.85)',  text: '#fff' },
    hamlet:  { dot: '#999',    bg: 'rgba(128, 128, 128, 0.85)', text: '#fff' },
  };

  /** Sprite scale by settlement type (world units) */
  static MARKER_SCALE = { city: 0.14, village: 0.11, hamlet: 0.08 };

  /**
   * Build billboard sprites for each settlement with name labels.
   * @param {Array} settlements - Settlement objects
   * @param {Float32Array} elevData - Raw elevation grid
   * @param {number} gridW - Grid width
   * @param {number} gridH - Grid height
   */
  _buildSettlementMarkers(settlements, elevData, gridW, gridH) {
    if (!settlements || settlements.length === 0) return;

    const hScale = this.baseHeightScale * this.heightExaggeration;

    for (const s of settlements) {
      const [wx, wz] = s.position;
      const colors = View3D.MARKER_COLORS[s.type] || View3D.MARKER_COLORS.hamlet;
      const scale = View3D.MARKER_SCALE[s.type] || 0.08;

      // Sample terrain elevation at settlement center
      const gx = Math.floor(((wx + 1) / 2) * (gridW - 1));
      const gz = Math.floor(((wz + 1) / 2) * (gridH - 1));
      const idx = Math.min(gz * gridW + gx, elevData.length - 1);
      const terrainY = elevData[Math.max(0, idx)] * hScale;

      // Create label texture
      const texture = this._createMarkerTexture(s.name, s.type, colors);
      const aspect = texture.userData?.aspect || 2;
      const material = new THREE.SpriteMaterial({
        map: texture,
        transparent: true,
        depthTest: true,
        sizeAttenuation: true,
      });

      const spriteH = scale * 0.4;
      const spriteW = spriteH * aspect;
      const sprite = new THREE.Sprite(material);
      sprite.scale.set(spriteW, spriteH, 1);
      sprite.position.set(wx, terrainY + 0.04 + spriteH * 0.5, wz);
      sprite.renderOrder = 1;

      this.scene.add(sprite);
      this.settlementMarkers.push(sprite);
    }
  }

  /**
   * Render a settlement label to a canvas and return as a Three.js texture.
   * Canvas width is sized dynamically to fit the name text.
   * Layout: colored dot + name + type badge, with pointer triangle below.
   */
  _createMarkerTexture(name, type, colors) {
    // Measure text first to determine canvas width
    const measureCanvas = document.createElement('canvas');
    const mCtx = measureCanvas.getContext('2d');
    mCtx.font = 'bold 28px sans-serif';
    const nameWidth = mCtx.measureText(name).width;
    mCtx.font = '18px sans-serif';
    const typeWidth = mCtx.measureText(type).width;
    const textWidth = Math.max(nameWidth, typeWidth);

    const pad = 12;
    const dotR = 10;
    const dotArea = pad + dotR * 2 + dotR + 10; // left padding + dot diameter + gap
    const canvasW = Math.ceil(dotArea + textWidth + pad * 2);
    const canvasH = 80;

    const canvas = document.createElement('canvas');
    canvas.width = canvasW;
    canvas.height = canvasH;
    const ctx = canvas.getContext('2d');

    // Background pill
    const pillH = canvasH - pad * 2 - 10; // leave room for pointer
    const pillW = canvasW - pad * 2;
    const r = pillH / 2;

    ctx.fillStyle = colors.bg;
    ctx.beginPath();
    ctx.moveTo(pad + r, pad);
    ctx.lineTo(pad + pillW - r, pad);
    ctx.arcTo(pad + pillW, pad, pad + pillW, pad + r, r);
    ctx.arcTo(pad + pillW, pad + pillH, pad + pillW - r, pad + pillH, r);
    ctx.lineTo(pad + r, pad + pillH);
    ctx.arcTo(pad, pad + pillH, pad, pad + r, r);
    ctx.arcTo(pad, pad, pad + r, pad, r);
    ctx.closePath();
    ctx.fill();

    // Dot indicator
    const dotX = pad + r;
    const dotY = pad + pillH / 2;
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(dotX, dotY, dotR, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = colors.dot;
    ctx.beginPath();
    ctx.arc(dotX, dotY, dotR - 2, 0, Math.PI * 2);
    ctx.fill();

    // Name text
    const textX = dotX + dotR + 10;
    ctx.fillStyle = colors.text;
    ctx.font = 'bold 28px sans-serif';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.fillText(name, textX, dotY - 6);

    // Type text (smaller, below name)
    ctx.font = '18px sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.fillText(type, textX, dotY + 16);

    // Pointer triangle at bottom center
    const triW = 8;
    const triH = 9;
    ctx.fillStyle = colors.bg;
    ctx.beginPath();
    ctx.moveTo(canvasW / 2 - triW, pad + pillH);
    ctx.lineTo(canvasW / 2 + triW, pad + pillH);
    ctx.lineTo(canvasW / 2, pad + pillH + triH);
    ctx.closePath();
    ctx.fill();

    const texture = new THREE.CanvasTexture(canvas);
    texture.needsUpdate = true;
    // Store aspect ratio so the sprite can be scaled correctly
    texture.userData = { aspect: canvasW / canvasH };
    return texture;
  }

  /**
   * Remove all settlement marker sprites from the scene.
   */
  _clearSettlementMarkers() {
    for (const sprite of this.settlementMarkers) {
      if (sprite.material.map) sprite.material.map.dispose();
      sprite.material.dispose();
      this.scene.remove(sprite);
    }
    this.settlementMarkers = [];
  }

  // ---------------------------------------------------------------------------
  // Settlement terracing
  // ---------------------------------------------------------------------------

  /**
   * Modify vertex Y positions to create flat terraced platforms within
   * settlement footprints, with smooth blending at the edges.
   *
   * @param {Float32Array} positions - Vertex position buffer (x, y, z interleaved)
   * @param {number} width - Grid width
   * @param {number} height - Grid height
   * @param {Float32Array} elevData - Raw elevation data [0, 1]
   * @param {Array} settlements - Settlement objects with terraces
   */
  _applySettlementTerracing(positions, width, height, elevData, settlements) {
    const hScale = this.baseHeightScale * this.heightExaggeration;
    const BLEND_ZONE = 0.008;

    for (const settlement of settlements) {
      if (!settlement.terraces || settlement.terraces.length === 0) continue;

      const [sx, sz] = settlement.position;
      const radius = settlement.radius;
      const outerRadius = radius + BLEND_ZONE;

      // Find grid bounds that could be affected
      const minIx = Math.max(0, Math.floor(((sx - outerRadius) + 1) / 2 * (width - 1)));
      const maxIx = Math.min(width - 1, Math.ceil(((sx + outerRadius) + 1) / 2 * (width - 1)));
      const minIz = Math.max(0, Math.floor(((sz - outerRadius) + 1) / 2 * (height - 1)));
      const maxIz = Math.min(height - 1, Math.ceil(((sz + outerRadius) + 1) / 2 * (height - 1)));

      for (let iz = minIz; iz <= maxIz; iz++) {
        for (let ix = minIx; ix <= maxIx; ix++) {
          const vi = iz * width + ix;
          const wx = (ix / (width - 1)) * 2 - 1;
          const wz = (iz / (height - 1)) * 2 - 1;

          const dx = wx - sx;
          const dz = wz - sz;
          const dist = Math.sqrt(dx * dx + dz * dz);

          if (dist > outerRadius) continue;

          // Find the nearest terrace for this point
          const terraceElev = this._findTerraceElevation(wx, wz, settlement.terraces);
          if (terraceElev === null) continue;

          const originalElev = elevData[vi];
          const scaledTerraceElev = terraceElev * hScale;

          if (dist <= radius) {
            // Inside footprint: snap to terrace elevation
            positions[vi * 3 + 1] = scaledTerraceElev;
          } else {
            // Blend zone: lerp between terrace and original
            const t = (dist - radius) / BLEND_ZONE;
            const smoothT = t * t * (3 - 2 * t); // smoothstep
            positions[vi * 3 + 1] = scaledTerraceElev * (1 - smoothT) + originalElev * hScale * smoothT;
          }
        }
      }
    }
  }

  /**
   * Find the target elevation for a world point based on nearby terraces.
   * Returns the elevation of the terrace whose polygon is closest, or null.
   */
  _findTerraceElevation(wx, wz, terraces) {
    // Check each terrace polygon (simple point-in-polygon test)
    for (const terrace of terraces) {
      if (this._pointInPolygon(wx, wz, terrace.polygon)) {
        return terrace.targetElevation;
      }
    }

    // Not inside any terrace polygon: use nearest terrace by distance to centroid
    let bestDist = Infinity;
    let bestElev = null;
    for (const terrace of terraces) {
      let cx = 0, cz = 0;
      for (const [px, pz] of terrace.polygon) {
        cx += px;
        cz += pz;
      }
      cx /= terrace.polygon.length;
      cz /= terrace.polygon.length;

      const d = (wx - cx) ** 2 + (wz - cz) ** 2;
      if (d < bestDist) {
        bestDist = d;
        bestElev = terrace.targetElevation;
      }
    }

    return bestElev;
  }

  /**
   * Point-in-polygon test (ray casting).
   * @param {number} x
   * @param {number} z
   * @param {Array} polygon - Array of [x, z] pairs
   */
  _pointInPolygon(x, z, polygon) {
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const [xi, zi] = polygon[i];
      const [xj, zj] = polygon[j];
      if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) {
        inside = !inside;
      }
    }
    return inside;
  }

  // ---------------------------------------------------------------------------
  // Height exaggeration & controls
  // ---------------------------------------------------------------------------

  /**
   * Update vertical exaggeration without full mesh rebuild.
   * @param {number} scale - 1, 2, or 5
   */
  setHeightExaggeration(scale) {
    this.heightExaggeration = scale;

    if (this.terrainMesh && this.elevationData) {
      const position = this.terrainMesh.geometry.getAttribute('position');
      const { width, height, data } = this.elevationData;
      const count = width * height;

      for (let i = 0; i < count; i++) {
        position.setY(i, data[i] * this.baseHeightScale * scale);
      }

      // Reapply settlement terracing at new scale
      if (this.settlementsData?.settlements) {
        const posArray = position.array;
        this._applySettlementTerracing(posArray, width, height, data, this.settlementsData.settlements);
      }

      position.needsUpdate = true;
      this.terrainMesh.geometry.computeVertexNormals();
    }

    this.waterMesh.position.y = this.seaLevel * this.baseHeightScale * scale;

    // Rebuild inland water at new scale
    this._clearInlandWater();
    if (this.hydrologyData) {
      this._buildRiverMeshes(this.hydrologyData.rivers);
      this._buildLakeMeshes(this.hydrologyData.lakes);
    }

    // Rebuild settlement markers at new scale
    this._clearSettlementMarkers();
    if (this.settlementsData?.settlements && this.elevationData) {
      const { width, height, data } = this.elevationData;
      this._buildSettlementMarkers(this.settlementsData.settlements, data, width, height);
    }
  }

  /**
   * Update base height scale (visual vertical scaling).
   * @param {number} scale - e.g. 0.1 to 1.0
   */
  setBaseHeightScale(scale) {
    this.baseHeightScale = scale;
    // Reuse exaggeration update which reads baseHeightScale
    this.setHeightExaggeration(this.heightExaggeration);
  }

  /**
   * Toggle water plane visibility.
   * @param {boolean} visible
   */
  setWaterVisible(visible) {
    this.waterMesh.visible = visible;
    for (const mesh of this.riverMeshes) mesh.visible = visible;
    for (const mesh of this.lakeMeshes) mesh.visible = visible;
  }

  /**
   * Toggle wireframe rendering.
   * @param {boolean} enabled
   */
  setWireframe(enabled) {
    if (this.terrainMaterial) {
      this.terrainMaterial.wireframe = enabled;
    }
  }

  /**
   * Update renderer size and camera aspect to match container.
   */
  resize() {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    if (w === 0 || h === 0) return;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /**
   * Show or hide the 3D view.
   * @param {boolean} visible
   */
  setVisible(visible) {
    this.visible = visible;
  }

  /**
   * Clean up GPU resources.
   */
  dispose() {
    cancelAnimationFrame(this._animationId);
    if (this.terrainMesh) {
      this.terrainMesh.geometry.dispose();
    }
    if (this.terrainMaterial) {
      this.terrainMaterial.dispose();
    }
    if (this.waterMesh) {
      this.waterMesh.geometry.dispose();
      this.waterMaterial.dispose();
    }
    if (this.inlandWaterMaterial) {
      this.inlandWaterMaterial.dispose();
    }
    this._clearInlandWater();
    this._clearSettlementMarkers();
    this.renderer.dispose();
    this.controls.dispose();
  }
}
