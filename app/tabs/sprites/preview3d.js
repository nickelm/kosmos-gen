/**
 * Three.js viewports for sprite preview:
 * 1. Crossed-quad single-sprite preview (orbit controls)
 * 2. Density scatter with wind animation (fixed camera)
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// ─── Helpers ────────────────────────────────────────────────────────

/** Create a texture from a sprite's Image element with nearest filtering. */
function spriteToTexture(sprite) {
  const canvas = document.createElement('canvas');
  canvas.width = sprite.width;
  canvas.height = sprite.height;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(sprite.image, 0, 0);

  const tex = new THREE.CanvasTexture(canvas);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

/** Build a merged crossed-quad geometry (two planes at 90°, bottom at y=0). */
function createCrossedQuadGeo(aspectW, aspectH) {
  const w = aspectW;
  const h = aspectH;
  const g1 = new THREE.PlaneGeometry(w, h);
  const g2 = new THREE.PlaneGeometry(w, h);
  g2.rotateY(Math.PI / 2);
  g1.translate(0, h / 2, 0);
  g2.translate(0, h / 2, 0);
  const merged = mergeGeometries([g1, g2]);
  g1.dispose();
  g2.dispose();
  return merged;
}

/** Simple seeded PRNG (mulberry32). */
function mulberry32(seed) {
  let s = seed | 0;
  return function () {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ─── Wind shader ────────────────────────────────────────────────────

const WIND_VERT = `
varying vec2 vUv;
uniform float uTime;
uniform float uWindStrength;

void main() {
  vUv = uv;
  vec3 pos = position;

  // Apply instance matrix to get world position for phase offset
  vec4 worldPos = instanceMatrix * vec4(pos, 1.0);
  float phase = worldPos.x * 0.7 + worldPos.z * 0.5;

  // Wind: bend based on local height (quadratic falloff from base)
  float heightFactor = clamp(pos.y, 0.0, 1.5) / 1.5;
  heightFactor *= heightFactor;

  float wind = sin(uTime * 2.5 + phase) * 0.5
             + sin(uTime * 1.1 + phase * 0.7) * 0.3;
  pos.x += wind * heightFactor * uWindStrength;

  vec4 mvPos = modelViewMatrix * instanceMatrix * vec4(pos, 1.0);
  gl_Position = projectionMatrix * mvPos;
}
`;

const WIND_FRAG = `
varying vec2 vUv;
uniform sampler2D uMap;

void main() {
  vec4 texel = texture2D(uMap, vUv);
  if (texel.a < 0.5) discard;
  gl_FragColor = texel;
}
`;

// ─── Crossed-Quad / Billboard Viewport ──────────────────────────────

function initQuadViewport(container) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setClearColor(0x2a2a3a);

  const w = container.clientWidth || 400;
  const h = container.clientHeight || 400;
  renderer.setSize(w, h);
  container.appendChild(renderer.domElement);

  const camera = new THREE.PerspectiveCamera(50, w / h, 0.01, 50);
  camera.position.set(1.2, 0.8, 1.2);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.1;
  controls.target.set(0, 0.4, 0);
  controls.update();

  const scene = new THREE.Scene();

  // Ground grid
  const grid = new THREE.GridHelper(2, 10, 0x444444, 0x333333);
  scene.add(grid);

  // Ambient light
  scene.add(new THREE.AmbientLight(0xffffff, 0.7));

  // View mode: 'crossed' or 'billboard'
  let viewMode = 'crossed';

  // Current mesh state
  let quadMesh = null;
  let quadMaterial = null;
  let quadGeo = null;
  let currentTexture = null;
  let currentSprite = null;

  // Mode toggle UI
  const toggle = document.createElement('div');
  toggle.className = 'sprite-3d-mode-toggle';
  const btnCrossed = document.createElement('button');
  btnCrossed.textContent = 'Crossed';
  btnCrossed.className = 'active';
  const btnBillboard = document.createElement('button');
  btnBillboard.textContent = 'Billboard';

  toggle.appendChild(btnCrossed);
  toggle.appendChild(btnBillboard);
  container.appendChild(toggle);

  function setMode(mode) {
    viewMode = mode;
    btnCrossed.classList.toggle('active', mode === 'crossed');
    btnBillboard.classList.toggle('active', mode === 'billboard');
    if (currentSprite) rebuildMesh(currentSprite);
  }

  btnCrossed.addEventListener('click', () => setMode('crossed'));
  btnBillboard.addEventListener('click', () => setMode('billboard'));

  function rebuildMesh(sprite) {
    // Remove old
    if (quadMesh) {
      scene.remove(quadMesh);
      quadGeo.dispose();
      quadMaterial.dispose();
    }

    if (!sprite) {
      quadMesh = null;
      return;
    }

    const aspect = sprite.width / sprite.height;

    if (viewMode === 'crossed') {
      quadGeo = createCrossedQuadGeo(aspect, 1);
      quadMaterial = new THREE.MeshBasicMaterial({
        map: currentTexture,
        alphaTest: 0.5,
        side: THREE.DoubleSide,
      });
      quadMesh = new THREE.Mesh(quadGeo, quadMaterial);
    } else {
      // Billboard: single plane that always faces the camera
      quadGeo = new THREE.PlaneGeometry(aspect, 1);
      quadGeo.translate(0, 0.5, 0); // bottom edge at y=0
      quadMaterial = new THREE.SpriteMaterial({
        map: currentTexture,
        alphaTest: 0.5,
      });
      // Use a Sprite for true camera-facing, but Sprite doesn't use custom geometry.
      // Instead use a regular Mesh and billboard it in the animation loop.
      quadMaterial = new THREE.MeshBasicMaterial({
        map: currentTexture,
        alphaTest: 0.5,
        side: THREE.DoubleSide,
      });
      quadMesh = new THREE.Mesh(quadGeo, quadMaterial);
      quadMesh.userData.isBillboard = true;
    }

    scene.add(quadMesh);
  }

  // Animation
  let animId = null;
  function animate() {
    animId = requestAnimationFrame(animate);
    controls.update();

    // Billboard: face camera each frame (Y-axis only, stay upright)
    if (quadMesh && quadMesh.userData.isBillboard) {
      const camPos = camera.position;
      const meshPos = quadMesh.position;
      quadMesh.rotation.y = Math.atan2(camPos.x - meshPos.x, camPos.z - meshPos.z);
    }

    renderer.render(scene, camera);
  }
  animate();

  // Resize
  const resizeObs = new ResizeObserver(() => {
    const rw = container.clientWidth;
    const rh = container.clientHeight;
    if (rw > 0 && rh > 0) {
      renderer.setSize(rw, rh);
      camera.aspect = rw / rh;
      camera.updateProjectionMatrix();
    }
  });
  resizeObs.observe(container);

  return {
    scene,
    updateSprite(sprite) {
      // Dispose old texture
      if (currentTexture) {
        currentTexture.dispose();
        currentTexture = null;
      }

      currentSprite = sprite;

      if (!sprite) {
        if (quadMesh) {
          scene.remove(quadMesh);
          quadGeo.dispose();
          quadMaterial.dispose();
          quadMesh = null;
        }
        return;
      }

      currentTexture = spriteToTexture(sprite);
      rebuildMesh(sprite);
    },
    dispose() {
      cancelAnimationFrame(animId);
      resizeObs.disconnect();
      controls.dispose();
      if (quadGeo) quadGeo.dispose();
      if (quadMaterial) quadMaterial.dispose();
      if (currentTexture) currentTexture.dispose();
      renderer.dispose();
    },
  };
}

// ─── Density Scatter Viewport ───────────────────────────────────────

function initDensityViewport(container, state) {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setClearColor(0x1a2a1a);

  const w = container.clientWidth || 800;
  const h = container.clientHeight || 200;
  renderer.setSize(w, h);
  container.appendChild(renderer.domElement);

  const camera = new THREE.PerspectiveCamera(35, w / h, 0.1, 100);
  camera.position.set(0, 1.8, 7);
  camera.lookAt(0, 0.3, 0);

  const scene = new THREE.Scene();

  // Ground plane
  const groundGeo = new THREE.PlaneGeometry(12, 12);
  groundGeo.rotateX(-Math.PI / 2);
  const groundMat = new THREE.MeshLambertMaterial({ color: 0x3a4a2a });
  const ground = new THREE.Mesh(groundGeo, groundMat);
  scene.add(ground);

  // Lighting
  scene.add(new THREE.AmbientLight(0xffffff, 0.5));
  const dirLight = new THREE.DirectionalLight(0xffffee, 0.7);
  dirLight.position.set(3, 5, 2);
  scene.add(dirLight);

  // Instance groups state
  let groups = [];
  const startTime = performance.now();

  // Controls overlay
  const ctrlDiv = document.createElement('div');
  ctrlDiv.className = 'density-controls';

  const label = document.createElement('label');
  label.textContent = 'Density';

  const slider = document.createElement('input');
  slider.type = 'range';
  slider.min = '10';
  slider.max = '300';
  slider.step = '10';
  slider.value = String(state.densityCount);

  const valSpan = document.createElement('span');
  valSpan.className = 'slider-value';
  valSpan.textContent = String(state.densityCount);

  const windBtn = document.createElement('button');
  windBtn.className = 'btn btn-secondary';
  windBtn.textContent = 'Wind: OFF';
  windBtn.style.padding = '4px 10px';
  windBtn.style.fontSize = '11px';

  ctrlDiv.appendChild(label);
  ctrlDiv.appendChild(slider);
  ctrlDiv.appendChild(valSpan);
  ctrlDiv.appendChild(windBtn);
  container.appendChild(ctrlDiv);

  slider.addEventListener('input', () => {
    state.densityCount = Number(slider.value);
    valSpan.textContent = String(state.densityCount);
    rebuild();
  });

  windBtn.addEventListener('click', () => {
    state.windEnabled = !state.windEnabled;
    windBtn.textContent = state.windEnabled ? 'Wind: ON' : 'Wind: OFF';
    // Swap materials
    for (const g of groups) {
      if (state.windEnabled) {
        if (!g.windMaterial) {
          g.windMaterial = new THREE.ShaderMaterial({
            uniforms: {
              uMap: { value: g.texture },
              uTime: { value: 0 },
              uWindStrength: { value: 0.15 },
            },
            vertexShader: WIND_VERT,
            fragmentShader: WIND_FRAG,
            side: THREE.DoubleSide,
          });
        }
        g.mesh.material = g.windMaterial;
      } else {
        g.mesh.material = g.basicMaterial;
      }
    }
  });

  function clearGroups() {
    for (const g of groups) {
      scene.remove(g.mesh);
      g.geo.dispose();
      g.basicMaterial.dispose();
      g.texture.dispose();
      if (g.windMaterial) g.windMaterial.dispose();
    }
    groups = [];
  }

  function rebuild() {
    clearGroups();

    const sprites = state.sprites;
    if (sprites.length === 0) return;

    const count = state.densityCount;
    const perSprite = Math.max(1, Math.ceil(count / sprites.length));

    for (let si = 0; si < sprites.length; si++) {
      const sprite = sprites[si];
      const aspect = sprite.width / sprite.height;
      const texture = spriteToTexture(sprite);

      const geo = createCrossedQuadGeo(aspect * 0.5, 0.5);
      const basicMaterial = new THREE.MeshBasicMaterial({
        map: texture,
        alphaTest: 0.5,
        side: THREE.DoubleSide,
      });

      const mesh = new THREE.InstancedMesh(geo, basicMaterial, perSprite);
      const dummy = new THREE.Object3D();
      const rng = mulberry32(si * 7919 + 42);

      for (let i = 0; i < perSprite; i++) {
        const x = (rng() - 0.5) * 10;
        const z = (rng() - 0.5) * 8;
        const scale = 0.6 + rng() * 0.8;
        const rotY = rng() * Math.PI * 2;

        dummy.position.set(x, 0, z);
        dummy.scale.setScalar(scale);
        dummy.rotation.y = rotY;
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
      }
      mesh.instanceMatrix.needsUpdate = true;

      scene.add(mesh);

      const group = { mesh, geo, basicMaterial, texture, windMaterial: null };

      // If wind is currently on, create wind material immediately
      if (state.windEnabled) {
        group.windMaterial = new THREE.ShaderMaterial({
          uniforms: {
            uMap: { value: texture },
            uTime: { value: 0 },
            uWindStrength: { value: 0.15 },
          },
          vertexShader: WIND_VERT,
          fragmentShader: WIND_FRAG,
          side: THREE.DoubleSide,
        });
        mesh.material = group.windMaterial;
      }

      groups.push(group);
    }
  }

  // Animation loop
  let animId = null;
  function animate() {
    animId = requestAnimationFrame(animate);

    if (state.windEnabled) {
      const elapsed = (performance.now() - startTime) / 1000;
      for (const g of groups) {
        if (g.windMaterial) {
          g.windMaterial.uniforms.uTime.value = elapsed;
        }
      }
    }

    renderer.render(scene, camera);
  }
  animate();

  // Resize
  const resizeObs = new ResizeObserver(() => {
    const rw = container.clientWidth;
    const rh = container.clientHeight;
    if (rw > 0 && rh > 0) {
      renderer.setSize(rw, rh);
      camera.aspect = rw / rh;
      camera.updateProjectionMatrix();
    }
  });
  resizeObs.observe(container);

  return {
    rebuild,
    dispose() {
      cancelAnimationFrame(animId);
      resizeObs.disconnect();
      clearGroups();
      groundGeo.dispose();
      groundMat.dispose();
      renderer.dispose();
    },
  };
}

// ─── Public API ─────────────────────────────────────────────────────

/**
 * Initialize both Three.js viewports.
 * @param {HTMLElement} quadContainer - Crossed-quad preview container
 * @param {HTMLElement} densityContainer - Density scatter container
 * @param {Object} state - Shared sprite state
 * @returns {{ updateQuad: () => void, updateDensity: () => void, dispose: () => void }}
 */
export function initPreview3D(quadContainer, densityContainer, state) {
  const quad = initQuadViewport(quadContainer);
  const density = initDensityViewport(densityContainer, state);

  return {
    updateQuad() {
      const sprite = state.sprites.find(s => s.id === state.selectedId) || null;
      quad.updateSprite(sprite);
    },
    updateDensity() {
      density.rebuild();
    },
    dispose() {
      quad.dispose();
      density.dispose();
    },
  };
}
