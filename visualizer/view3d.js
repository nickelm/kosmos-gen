/**
 * 3D terrain viewer
 *
 * Three.js scene with orbit controls, heightfield mesh, water plane,
 * and directional + ambient lighting.
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
    this.terrainMesh = null;
    this.terrainMaterial = null;

    this._initRenderer();
    this._initCamera();
    this._initControls();
    this._initLighting();
    this._initWaterPlane();
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
   */
  updateTerrain(elevation, biomes, params) {
    if (!elevation) return;

    // Store for exaggeration updates
    this.elevationData = elevation;
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

    // Build vertex colors
    const colors = new Float32Array(vertexCount * 3);
    if (biomes && biomes.data && biomes.data.length === vertexCount) {
      for (let i = 0; i < vertexCount; i++) {
        const c = getBiomeColorNormalized(biomes.data[i]);
        colors[i * 3] = c.r;
        colors[i * 3 + 1] = c.g;
        colors[i * 3 + 2] = c.b;
      }
    } else {
      // Fallback: grayscale from elevation
      for (let i = 0; i < vertexCount; i++) {
        const v = data[i];
        colors[i * 3] = v;
        colors[i * 3 + 1] = v;
        colors[i * 3 + 2] = v;
      }
    }

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
  }

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

      position.needsUpdate = true;
      this.terrainMesh.geometry.computeVertexNormals();
    }

    this.waterMesh.position.y = this.seaLevel * this.baseHeightScale * scale;
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
    this.renderer.dispose();
    this.controls.dispose();
  }
}
