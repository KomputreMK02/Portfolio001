// =============================================================
//  Portfolio Gallery — Three.js
//  Loads a Blender-exported room (assets/room.glb) and attaches
//  artworks to named empties inside it.
//
//  HOW THIS IS ORGANIZED
//   1. Loading manager + UI hooks
//   2. Renderer / scene / camera / lights
//   3. Room loader (assets/room.glb)
//   4. Artworks (attached to named empties from the .glb)
//   5. Desktop controls (PointerLock + WASD + raycast collisions)
//   6. Mobile controls (virtual joystick + drag-to-look)
//   7. Interaction (raycast → "Press E to view" → modal)
//   8. Resume overlay + start menu
//   9. Animation loop + resize
// =============================================================

import * as THREE from 'three';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';
import { GLTFLoader }          from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader }         from 'three/addons/loaders/DRACOLoader.js';
import { RoomEnvironment }     from 'three/addons/environments/RoomEnvironment.js';

// =============================================================
// CLASSIC-ERA AESTHETIC KNOBS
// =============================================================
// All three effects can be dialed individually. Set any to its
// "off" value to disable that effect cleanly.

// Render at 1/Nth of the screen resolution and let CSS nearest-neighbor
// upscale. 1 = no pixelation, 3–4 = mid PS2 vibe, 6+ = crunchy PS1.
const PIXELATION = 3;

// Snap vertices to a grid of (N × N) positions in clip space. Lower N =
// more wobble. Set to 0 to disable.
const PS1_JITTER = 160;

// Apply NEAREST filtering to all textures (no bilinear smoothing).
const PIXEL_TEXTURES = true;

// =============================================================
// 1. LOADING MANAGER
// =============================================================
const manager = new THREE.LoadingManager();
const progressBar  = document.getElementById('progress-bar');
const progressText = document.getElementById('progress-text');
const startBtn     = document.getElementById('start-button');

manager.onProgress = (url, loaded, total) => {
  const pct = total > 0 ? Math.round((loaded / total) * 100) : 0;
  progressBar.style.width = pct + '%';
  progressText.textContent = `Loading… ${pct}%`;
};
manager.onLoad = () => {
  progressBar.style.width = '100%';
  progressText.textContent = 'Ready';
  startBtn.disabled = false;
  startBtn.classList.add('ready');
};
manager.onError = (url) => {
  console.warn('Failed to load', url);
};

// =============================================================
// 2. RENDERER / SCENE / CAMERA / LIGHTS
// =============================================================
const canvas   = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
renderer.setPixelRatio(1); // ignore device DPR — we want fixed low-res output
function applyRendererSize() {
  const w = Math.max(1, Math.floor(window.innerWidth  / PIXELATION));
  const h = Math.max(1, Math.floor(window.innerHeight / PIXELATION));
  // setSize(w, h, false) means: don't update canvas style — let CSS upscale.
  renderer.setSize(w, h, false);
}
applyRendererSize();
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping       = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true;
// BasicShadowMap = no filtering, hard pixelated edges. Combined with a
// low-resolution shadow map below, this is the chunky PS2 / Dreamcast look.
renderer.shadowMap.type    = THREE.BasicShadowMap;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0a0a0a);
scene.fog = new THREE.Fog(0x0a0a0a, 12, 40);

const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.05, 100);
camera.position.set(0, 1.7, 5); // 1.7m = roughly eye height

// Neutral image-based lighting — same setup gltf-viewer.donmccurdy.com uses.
// RoomEnvironment is a procedural "indoor box" preset baked through Three's
// PMREMGenerator; the result is soft, even fill from every direction.
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
pmrem.dispose();

// Soft hemisphere fill so faces that the directional sun can't reach
// (notably the underside of the ceiling) aren't pitch black. Once you
// add light_* fixtures to room.glb, this will mostly be redundant —
// the fixtures will provide proper directional fill from above.
const fillHemi = new THREE.HemisphereLight(0xffffff, 0x666666, 0.35);
scene.add(fillHemi);

// PS2-vibe shadow caster. Low intensity (most of the lighting is from the
// environment map above) — this light exists mainly to throw chunky
// hard-edged shadows under frames and props. Smaller mapSize = more pixely.
const shadowSun = new THREE.DirectionalLight(0xffffff, 0.4);
shadowSun.position.set(5, 10, 3);
shadowSun.castShadow = true;
shadowSun.shadow.mapSize.set(512, 512);   // try 256 for extra chunky PS1 vibe
shadowSun.shadow.camera.left   = -10;
shadowSun.shadow.camera.right  =  10;
shadowSun.shadow.camera.top    =  10;
shadowSun.shadow.camera.bottom = -10;
shadowSun.shadow.camera.near   = 0.5;
shadowSun.shadow.camera.far    = 30;
scene.add(shadowSun);

// =============================================================
// PS1/PS2 EFFECT HELPERS
// =============================================================
// Use these on any texture / material we create or load.

function ps1Texture(tex) {
  if (!tex || !PIXEL_TEXTURES) return tex;
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

function ps1Material(mat) {
  if (!mat || PS1_JITTER <= 0) return mat;
  // Hook into the standard material's vertex shader to snap clip-space
  // positions to a low-res grid. This is the classic "vertex wobble".
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader.replace(
      '#include <project_vertex>',
      `
        #include <project_vertex>
        // PS1 vertex snap
        float ps1Res = ${PS1_JITTER.toFixed(1)};
        gl_Position.xy = floor(gl_Position.xy * ps1Res / gl_Position.w)
                          * gl_Position.w / ps1Res;
      `
    );
  };
  // Force shader recompile if the material was already used
  mat.customProgramCacheKey = () => 'ps1_jitter_' + PS1_JITTER;
  mat.needsUpdate = true;
  return mat;
}

function ps1MeshMaterials(node) {
  if (!node.material) return;
  const mats = Array.isArray(node.material) ? node.material : [node.material];
  for (const m of mats) {
    ps1Material(m);
    // Also crunch any textures the material is using
    for (const slot of ['map', 'normalMap', 'roughnessMap', 'metalnessMap',
                        'aoMap', 'emissiveMap', 'alphaMap']) {
      if (m[slot]) ps1Texture(m[slot]);
    }
  }
}

// =============================================================
// 3. ROOM LOADER
// =============================================================
// Loads assets/room.glb, treats meshes as collidable walls/floors,
// and finds the named empties (frame_01, video_01, pedestal_01…)
// where artworks should be attached.
//
// To skip collision on a mesh (decorative props you can walk through),
// give it a name starting with `decor_`, `prop_`, or `nocollide`.
const collidables = [];

const dracoLoader = new DRACOLoader();
dracoLoader.setDecoderPath('https://www.gstatic.com/draco/v1/decoders/');
const gltfLoader = new GLTFLoader(manager);
gltfLoader.setDRACOLoader(dracoLoader);

// Anchor name → Object3D in the loaded scene. Populated after .glb loads.
const anchors = {};

gltfLoader.load('./assets/room.glb', (gltf) => {
  const room = gltf.scene;

  room.traverse(node => {
    // Mesh → enable shadows and (unless decorative) treat as collidable
    if (node.isMesh) {
      node.castShadow = true;
      node.receiveShadow = true;

      // Render both faces. Belt-and-suspenders against Blender exports
      // where some faces have inward-facing normals (which would otherwise
      // appear black under the lighting).
      if (node.material) {
        const mats = Array.isArray(node.material) ? node.material : [node.material];
        for (const m of mats) m.side = THREE.DoubleSide;
      }

      // Apply the PS1/PS2 vertex jitter + nearest-filter textures
      ps1MeshMaterials(node);

      // Light fixture meshes (e.g. ceiling panels) become emissive AND
      // spawn a real PointLight at their world position. Don't make them
      // shadow-casters — they'd block their own light.
      if (node.name && /^light_/i.test(node.name)) {
        node.castShadow = false;

        if (node.material) {
          const mats = Array.isArray(node.material) ? node.material : [node.material];
          for (const m of mats) {
            m.emissive = new THREE.Color(0xfff4dd);
            m.emissiveIntensity = 1.2;
          }
        }

        const pos = new THREE.Vector3();
        node.getWorldPosition(pos);
        const lamp = new THREE.PointLight(0xfff4dd, 8, 12, 2);
        lamp.position.copy(pos);
        lamp.position.y -= 0.05; // nudge below the panel so it casts down
        scene.add(lamp);
      }

      const skip = /^(decor_|prop_|nocollide|light_)/i.test(node.name);
      if (!skip) collidables.push(node);
    }

    // Anything with a known anchor name (mesh, empty, group — doesn't
    // matter) becomes an attachment point for an artwork.
    if (node.name && /^(frame_|video_|pedestal_)/.test(node.name)) {
      anchors[node.name] = node;
    }
  });

  scene.add(room);

  // Now that the empties are in the scene graph (and have valid world
  // transforms), attach the artworks defined below.
  attachArtworks();
});

// =============================================================
// 4. ARTWORKS
// =============================================================
// Each entry is attached as a child of the matching named empty in
// the loaded room.glb. Edit this array to add / remove / reorder works.
const ARTWORK_DATA = [
  {
    anchor: 'frame_01',
    type: 'image',
    src: 'https://picsum.photos/seed/portfolio1/1024/768',
    title: 'Project One',
    description: 'A short description of this image piece. Replace this text and the image URL with your own work.',
  },
  {
    anchor: 'frame_02',
    type: 'image',
    src: 'https://picsum.photos/seed/portfolio2/1024/768',
    title: 'Project Two',
    description: 'Another image work, hung wherever frame_02 is in your room.',
  },
  {
    anchor: 'frame_03',
    type: 'image',
    src: 'https://picsum.photos/seed/portfolio3/1024/768',
    title: 'Project Three',
    description: 'A third image piece. Move the empty in Blender to relocate.',
  },
  {
    anchor: 'video_01',
    type: 'video',
    src: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4',
    title: 'Showreel',
    description: 'A looping video piece. Use H.264 mp4 for best browser support.',
  },
  {
    anchor: 'pedestal_01',
    type: 'sculpture',
    title: '3D Sculpture',
    description: 'Placeholder torus knot. Swap with a GLTFLoader-loaded model later.',
    color: 0xff6a00,
  },
];

const interactables = [];

function attachArtworks() {
  for (const data of ARTWORK_DATA) {
    const anchor = anchors[data.anchor];
    if (!anchor) {
      console.warn(`[artworks] No anchor named "${data.anchor}" found in room.glb — skipping.`);
      continue;
    }
    if (data.type === 'image')      addFramedImage(anchor, data);
    else if (data.type === 'video') addFramedVideo(anchor, data);
    else if (data.type === 'sculpture') addPedestalSculpture(anchor, data);
  }
}

function addFramedImage(anchor, { src, title, description }) {
  const tex = new THREE.TextureLoader(manager).load(src);
  tex.colorSpace = THREE.SRGBColorSpace;
  ps1Texture(tex);

  const frame = new THREE.Mesh(
    new THREE.BoxGeometry(2.2, 1.7, 0.08),
    ps1Material(new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.6 }))
  );
  const art = new THREE.Mesh(
    new THREE.PlaneGeometry(2, 1.5),
    ps1Material(new THREE.MeshStandardMaterial({ map: tex, roughness: 0.5 }))
  );
  art.position.z = 0.05;

  const group = new THREE.Group();
  group.add(frame);
  group.add(art);
  group.userData = { title, description, type: 'image', src };
  anchor.add(group);            // inherits anchor's world transform
  interactables.push(group);
}

function addFramedVideo(anchor, { src, title, description }) {
  const video = document.createElement('video');
  video.src = src;
  video.loop = true;
  video.muted = true;
  video.playsInline = true;
  video.crossOrigin = 'anonymous';
  video.play().catch(() => { /* will play after user gesture */ });

  const tex = new THREE.VideoTexture(video);
  tex.colorSpace = THREE.SRGBColorSpace;
  ps1Texture(tex);

  const frame = new THREE.Mesh(
    new THREE.BoxGeometry(2.4, 1.5, 0.08),
    ps1Material(new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.6 }))
  );
  const screen = new THREE.Mesh(
    new THREE.PlaneGeometry(2.2, 1.3),
    new THREE.MeshBasicMaterial({ map: tex }) // BasicMaterial = no jitter shader, that's fine
  );
  screen.position.z = 0.05;

  const group = new THREE.Group();
  group.add(frame);
  group.add(screen);
  group.userData = { title, description, type: 'video', src, video };
  anchor.add(group);
  interactables.push(group);
}

function addPedestalSculpture(anchor, { title, description, color = 0xff6a00 }) {
  // Pedestal (visible) + collider so you can't walk through it
  const pedestal = new THREE.Mesh(
    new THREE.CylinderGeometry(0.4, 0.4, 1, 24),
    ps1Material(new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.4 }))
  );
  pedestal.position.y = 0.5;
  pedestal.castShadow = pedestal.receiveShadow = true;
  anchor.add(pedestal);

  const pedCollider = new THREE.Mesh(
    new THREE.BoxGeometry(0.9, 1, 0.9),
    new THREE.MeshBasicMaterial({ visible: false })
  );
  pedCollider.position.y = 0.5;
  anchor.add(pedCollider);
  collidables.push(pedCollider);

  // Sculpture (placeholder torus knot — swap for a GLTFLoader model later)
  const sculpture = new THREE.Mesh(
    new THREE.TorusKnotGeometry(0.25, 0.08, 128, 16),
    ps1Material(new THREE.MeshStandardMaterial({ color, metalness: 0.7, roughness: 0.25 }))
  );
  sculpture.position.y = 1.35;
  sculpture.castShadow = true;
  sculpture.userData = { title, description, type: 'sculpture', rotates: true };
  anchor.add(sculpture);
  interactables.push(sculpture);
}

// =============================================================
// 5. DESKTOP CONTROLS
// =============================================================
const controls = new PointerLockControls(camera, document.body);
const keys = Object.create(null);

document.addEventListener('keydown', (e) => {
  keys[e.code] = true;

  // Enter on the title screen starts the experience;
  // Enter on the resume overlay re-engages pointer lock.
  if (e.code === 'Enter') {
    if (!menuHiddenFlag && !startBtn.disabled) {
      startExperience();
    } else if (menuHiddenFlag && !resumeOverlay.classList.contains('hidden')) {
      hideResumeOverlay();
      controls.lock();
    }
  }
  // E to interact with whatever the crosshair is on
  if (e.code === 'KeyE' && currentInteractable && controls.isLocked) {
    openArtworkModal(currentInteractable.userData);
  }
  // Esc closes the modal. Because Escape itself releases pointer lock and
  // Chrome blocks immediate re-locking, we surface the resume overlay
  // instead of trying to lock right away.
  if (e.code === 'Escape') {
    if (!modal.classList.contains('hidden')) {
      closeArtworkModal();
      if (!isMobile && menuHiddenFlag) showResumeOverlay();
    }
  }
});
document.addEventListener('keyup', (e) => { keys[e.code] = false; });

// =============================================================
// 6. MOBILE CONTROLS
// =============================================================
const isMobile = matchMedia('(pointer: coarse)').matches || /iPhone|iPad|Android|Mobile/i.test(navigator.userAgent);
const touchUI    = document.getElementById('touch-ui');
const joystick   = document.getElementById('joystick');
const knob       = document.getElementById('joystick-knob');
const interactBtn= document.getElementById('touch-interact');

let joyVec = { x: 0, y: 0 };
let joyTouchId = null;
let lookTouchId = null;
let lookLast = { x: 0, y: 0 };
const cameraEuler = new THREE.Euler(0, 0, 0, 'YXZ');

if (isMobile) {
  touchUI.classList.remove('hidden');

  joystick.addEventListener('touchstart', (e) => {
    e.preventDefault();
    const t = e.changedTouches[0];
    joyTouchId = t.identifier;
    updateJoystick(t);
  }, { passive: false });

  document.addEventListener('touchmove', (e) => {
    for (const t of e.changedTouches) {
      if (t.identifier === joyTouchId) updateJoystick(t);
      else if (t.identifier === lookTouchId) {
        const dx = t.clientX - lookLast.x;
        const dy = t.clientY - lookLast.y;
        lookLast = { x: t.clientX, y: t.clientY };
        cameraEuler.setFromQuaternion(camera.quaternion);
        cameraEuler.y -= dx * 0.0035;
        cameraEuler.x -= dy * 0.0035;
        cameraEuler.x = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, cameraEuler.x));
        camera.quaternion.setFromEuler(cameraEuler);
      }
    }
  }, { passive: false });

  document.addEventListener('touchend', (e) => {
    for (const t of e.changedTouches) {
      if (t.identifier === joyTouchId) { joyTouchId = null; joyVec = { x: 0, y: 0 }; resetKnob(); }
      if (t.identifier === lookTouchId) { lookTouchId = null; }
    }
  });

  document.addEventListener('touchstart', (e) => {
    if (!menuHiddenFlag) return;
    for (const t of e.changedTouches) {
      const onUi = t.target.closest('#touch-ui, #artwork-modal, #menu, #resume-overlay');
      if (onUi) continue;
      if (t.clientX > window.innerWidth / 2 && lookTouchId === null) {
        lookTouchId = t.identifier;
        lookLast = { x: t.clientX, y: t.clientY };
      }
    }
  }, { passive: true });

  interactBtn.addEventListener('click', () => {
    if (currentInteractable) openArtworkModal(currentInteractable.userData);
  });
}

function updateJoystick(touch) {
  const r = joystick.getBoundingClientRect();
  const cx = r.left + r.width / 2;
  const cy = r.top  + r.height / 2;
  const dx = touch.clientX - cx;
  const dy = touch.clientY - cy;
  const max = r.width / 2;
  const dist = Math.min(max, Math.hypot(dx, dy));
  const ang = Math.atan2(dy, dx);
  joyVec.x =  Math.cos(ang) * (dist / max);
  joyVec.y = -Math.sin(ang) * (dist / max);
  knob.style.transform = `translate(calc(-50% + ${Math.cos(ang) * dist}px), calc(-50% + ${Math.sin(ang) * dist}px))`;
}
function resetKnob() {
  knob.style.transform = 'translate(-50%, -50%)';
}

// =============================================================
// 7. INTERACTION (raycast → prompt → modal)
// =============================================================
const raycaster = new THREE.Raycaster();
raycaster.far = 3.5;
const promptEl = document.getElementById('prompt');
const modal    = document.getElementById('artwork-modal');
const modalMedia       = document.getElementById('modal-media');
const modalTitle       = document.getElementById('modal-title');
const modalDescription = document.getElementById('modal-description');
let currentInteractable = null;

function checkInteraction() {
  const active = isMobile ? menuHiddenFlag : controls.isLocked;
  if (!active) { promptEl.classList.add('hidden'); currentInteractable = null; return; }

  raycaster.setFromCamera({ x: 0, y: 0 }, camera);
  const hits = raycaster.intersectObjects(interactables, true);

  if (hits.length > 0) {
    let obj = hits[0].object;
    while (obj.parent && !interactables.includes(obj)) obj = obj.parent;
    currentInteractable = obj;
    promptEl.textContent = `[E] View "${obj.userData.title}"`;
    promptEl.classList.remove('hidden');
  } else {
    currentInteractable = null;
    promptEl.classList.add('hidden');
  }
}

function openArtworkModal(data) {
  modalMedia.innerHTML = '';
  if (data.type === 'image') {
    const img = document.createElement('img');
    img.src = data.src; img.alt = data.title;
    modalMedia.appendChild(img);
  } else if (data.type === 'video') {
    const v = document.createElement('video');
    v.src = data.src; v.controls = true; v.autoplay = true; v.playsInline = true;
    modalMedia.appendChild(v);
  }
  modalTitle.textContent       = data.title;
  modalDescription.textContent = data.description;
  modal.classList.remove('hidden');
  if (controls.isLocked) controls.unlock();
}

function closeArtworkModal() {
  modal.classList.add('hidden');
  modalMedia.innerHTML = '';
}

document.getElementById('modal-close').addEventListener('click', () => {
  closeArtworkModal();
  if (!isMobile && menuHiddenFlag) controls.lock();
});

// =============================================================
// 8. RESUME OVERLAY + START MENU
// =============================================================
const resumeOverlay = document.getElementById('resume-overlay');
const resumeButton  = document.getElementById('resume-button');

function showResumeOverlay() { resumeOverlay.classList.remove('hidden'); }
function hideResumeOverlay() { resumeOverlay.classList.add('hidden'); }

resumeButton.addEventListener('click', () => {
  hideResumeOverlay();
  controls.lock();
});

controls.addEventListener('unlock', () => {
  if (menuHiddenFlag && modal.classList.contains('hidden')) showResumeOverlay();
});
controls.addEventListener('lock', () => { hideResumeOverlay(); });

let menuHiddenFlag = false;
function startExperience() {
  document.getElementById('menu').classList.add('hidden');
  document.getElementById('hud').classList.remove('hidden');
  menuHiddenFlag = true;
  if (!isMobile) controls.lock();
}
startBtn.addEventListener('click', startExperience);

// =============================================================
// MOVEMENT WITH RAYCAST COLLISIONS
// =============================================================
const PLAYER_HEIGHT = 1.7;
const PLAYER_RADIUS = 0.4;
const SPEED         = 4.0;

const _forward = new THREE.Vector3();
const _right   = new THREE.Vector3();
const _move    = new THREE.Vector3();
const _testRay = new THREE.Raycaster();

function canMove(direction, distance) {
  _testRay.set(camera.position, direction);
  _testRay.far = PLAYER_RADIUS + distance + 0.01;
  const hits = _testRay.intersectObjects(collidables, false);
  return hits.length === 0;
}

function updateMovement(dt) {
  const active = isMobile ? menuHiddenFlag : controls.isLocked;
  if (!active) return;

  _forward.set(0, 0, -1).applyQuaternion(camera.quaternion);
  _forward.y = 0; _forward.normalize();
  _right.set(1, 0, 0).applyQuaternion(camera.quaternion);
  _right.y = 0; _right.normalize();

  let inputX = 0, inputZ = 0;
  if (keys['KeyW']) inputZ += 1;
  if (keys['KeyS']) inputZ -= 1;
  if (keys['KeyA']) inputX -= 1;
  if (keys['KeyD']) inputX += 1;
  inputX += joyVec.x;
  inputZ += joyVec.y;

  if (inputX === 0 && inputZ === 0) {
    camera.position.y = PLAYER_HEIGHT;
    return;
  }

  _move.set(0, 0, 0)
    .addScaledVector(_forward, inputZ)
    .addScaledVector(_right,   inputX);
  if (_move.lengthSq() > 1) _move.normalize();

  const distance = SPEED * dt;

  if (Math.abs(_move.x) > 1e-4) {
    const dir = new THREE.Vector3(Math.sign(_move.x), 0, 0);
    if (canMove(dir, Math.abs(_move.x) * distance)) {
      camera.position.x += _move.x * distance;
    }
  }
  if (Math.abs(_move.z) > 1e-4) {
    const dir = new THREE.Vector3(0, 0, Math.sign(_move.z));
    if (canMove(dir, Math.abs(_move.z) * distance)) {
      camera.position.z += _move.z * distance;
    }
  }

  camera.position.y = PLAYER_HEIGHT;
}

// =============================================================
// 9. ANIMATION LOOP + RESIZE
// =============================================================
const clock = new THREE.Clock();
function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.1);
  updateMovement(dt);
  checkInteraction();
  scene.traverse(o => { if (o.userData && o.userData.rotates) o.rotation.y += dt * 0.4; });
  renderer.render(scene, camera);
}
animate();

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  applyRendererSize();
});
