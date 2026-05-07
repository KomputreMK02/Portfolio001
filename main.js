// =============================================================
//  Portfolio Gallery — Three.js
//  Single-file scene logic. No build step required.
//
//  HOW THIS IS ORGANIZED
//   1. Loading manager + UI hooks
//   2. Renderer / scene / camera / lights
//   3. Placeholder room (replace with your Blender .glb later)
//   4. Artworks (images, videos, 3D objects)
//   5. Desktop controls (PointerLock + WASD + raycast collisions)
//   6. Mobile controls (virtual joystick + drag-to-look)
//   7. Interaction (raycast → "Press E to view" → modal)
//   8. Animation loop + resize
// =============================================================

import * as THREE from 'three';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';
import { GLTFLoader }          from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader }         from 'three/addons/loaders/DRACOLoader.js';

// =============================================================
// 1. LOADING MANAGER
// =============================================================
// Every loader (textures, models, etc.) we wire into this manager
// reports back to a single progress bar. Once everything is done,
// we enable the Start button.
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
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping       = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type    = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0a0a0a);
scene.fog = new THREE.Fog(0x0a0a0a, 12, 40);

const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.05, 100);
camera.position.set(0, 1.7, 5); // 1.7m = roughly eye height

scene.add(new THREE.AmbientLight(0xffffff, 0.45));

const sun = new THREE.DirectionalLight(0xffffff, 0.9);
sun.position.set(6, 10, 4);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left   = -10;
sun.shadow.camera.right  =  10;
sun.shadow.camera.top    =  10;
sun.shadow.camera.bottom = -10;
scene.add(sun);

// =============================================================
// 3. PLACEHOLDER ROOM
// =============================================================
// REPLACE THIS BLOCK WITH YOUR BLENDER MODEL when you're ready.
// See the README for the swap-in steps. For now we build a
// simple boxy white-cube gallery so you can see everything work.
const collidables = []; // anything the player should not walk through

const ROOM_SIZE   = 14;
const WALL_HEIGHT = 4;
const half        = ROOM_SIZE / 2;

// Floor
const floor = new THREE.Mesh(
  new THREE.PlaneGeometry(ROOM_SIZE, ROOM_SIZE),
  new THREE.MeshStandardMaterial({ color: 0x6b563a, roughness: 0.9 })
);
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
scene.add(floor);

// Ceiling
const ceiling = new THREE.Mesh(
  new THREE.PlaneGeometry(ROOM_SIZE, ROOM_SIZE),
  new THREE.MeshStandardMaterial({ color: 0xeeeeee, roughness: 0.95 })
);
ceiling.rotation.x = Math.PI / 2;
ceiling.position.y = WALL_HEIGHT;
scene.add(ceiling);

// Walls — and a hidden box collider behind each one
const wallMat = new THREE.MeshStandardMaterial({ color: 0xf0ece4, roughness: 0.8 });

function buildWall(width, height, position, rotationY) {
  const wall = new THREE.Mesh(new THREE.PlaneGeometry(width, height), wallMat);
  wall.position.copy(position);
  wall.rotation.y = rotationY;
  wall.receiveShadow = true;
  scene.add(wall);

  // Invisible thicker box for collisions (planes are 1-sided / thin)
  const collider = new THREE.Mesh(
    new THREE.BoxGeometry(width, height, 0.2),
    new THREE.MeshBasicMaterial({ visible: false })
  );
  collider.position.copy(position);
  collider.rotation.y = rotationY;
  scene.add(collider);
  collidables.push(collider);
}

buildWall(ROOM_SIZE, WALL_HEIGHT, new THREE.Vector3(0, WALL_HEIGHT / 2, -half), 0);
buildWall(ROOM_SIZE, WALL_HEIGHT, new THREE.Vector3(0, WALL_HEIGHT / 2,  half), Math.PI);
buildWall(ROOM_SIZE, WALL_HEIGHT, new THREE.Vector3(-half, WALL_HEIGHT / 2, 0), Math.PI / 2);
buildWall(ROOM_SIZE, WALL_HEIGHT, new THREE.Vector3( half, WALL_HEIGHT / 2, 0), -Math.PI / 2);

// Ambient warm light from a "skylight" rectangle in the ceiling
const skylight = new THREE.Mesh(
  new THREE.PlaneGeometry(4, 4),
  new THREE.MeshBasicMaterial({ color: 0xfff4dd })
);
skylight.rotation.x = Math.PI / 2;
skylight.position.set(0, WALL_HEIGHT - 0.01, 0);
scene.add(skylight);

// =============================================================
// 4. ARTWORKS
// =============================================================
// Each artwork is registered as an "interactable". Stand in front
// of one and the crosshair raycast will pick it up; pressing E
// opens the modal with title/description and the original media.
const interactables = [];

function addFramedImage({ url, position, rotationY, title, description }) {
  // Texture + plane "canvas" inside a slightly larger dark "frame"
  const tex = new THREE.TextureLoader(manager).load(url);
  tex.colorSpace = THREE.SRGBColorSpace;

  const frame = new THREE.Mesh(
    new THREE.BoxGeometry(2.2, 1.7, 0.08),
    new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.6 })
  );
  const art = new THREE.Mesh(
    new THREE.PlaneGeometry(2, 1.5),
    new THREE.MeshStandardMaterial({ map: tex, roughness: 0.5 })
  );
  art.position.z = 0.05;

  const group = new THREE.Group();
  group.add(frame);
  group.add(art);
  group.position.copy(position);
  group.rotation.y = rotationY;
  group.userData = {
    title, description,
    type: 'image',
    src: url,
  };
  scene.add(group);
  interactables.push(group);
}

function addFramedVideo({ url, position, rotationY, title, description }) {
  const video = document.createElement('video');
  video.src = url;
  video.loop = true;
  video.muted = true;
  video.playsInline = true;
  video.crossOrigin = 'anonymous';
  video.play().catch(() => { /* will play after user gesture */ });

  const tex = new THREE.VideoTexture(video);
  tex.colorSpace = THREE.SRGBColorSpace;

  const frame = new THREE.Mesh(
    new THREE.BoxGeometry(2.4, 1.5, 0.08),
    new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.6 })
  );
  const screen = new THREE.Mesh(
    new THREE.PlaneGeometry(2.2, 1.3),
    new THREE.MeshBasicMaterial({ map: tex })
  );
  screen.position.z = 0.05;

  const group = new THREE.Group();
  group.add(frame);
  group.add(screen);
  group.position.copy(position);
  group.rotation.y = rotationY;
  group.userData = {
    title, description,
    type: 'video',
    src: url,
    video,
  };
  scene.add(group);
  interactables.push(group);
}

function addPedestalSculpture({ position, title, description, color = 0xff6a00 }) {
  // Pedestal
  const pedestal = new THREE.Mesh(
    new THREE.CylinderGeometry(0.4, 0.4, 1, 24),
    new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.4 })
  );
  pedestal.position.set(position.x, 0.5, position.z);
  pedestal.castShadow = pedestal.receiveShadow = true;
  scene.add(pedestal);

  // Pedestal collider so you can't walk through it
  const pedCollider = new THREE.Mesh(
    new THREE.BoxGeometry(0.9, 1, 0.9),
    new THREE.MeshBasicMaterial({ visible: false })
  );
  pedCollider.position.copy(pedestal.position);
  scene.add(pedCollider);
  collidables.push(pedCollider);

  // Sculpture (placeholder — swap with a GLTFLoader-loaded model)
  const sculpture = new THREE.Mesh(
    new THREE.TorusKnotGeometry(0.25, 0.08, 128, 16),
    new THREE.MeshStandardMaterial({ color, metalness: 0.7, roughness: 0.25 })
  );
  sculpture.position.set(position.x, 1.35, position.z);
  sculpture.castShadow = true;
  sculpture.userData = {
    title, description,
    type: 'sculpture',
    rotates: true,
  };
  scene.add(sculpture);
  interactables.push(sculpture);
}

// --- Sample contents (replace with your own works) ---
addFramedImage({
  url: 'https://picsum.photos/seed/portfolio1/1024/768',
  position: new THREE.Vector3(-3, 1.9, -half + 0.1),
  rotationY: 0,
  title: 'Project One',
  description: 'A short description of this image piece. Replace this text and the image URL with your own work.',
});
addFramedImage({
  url: 'https://picsum.photos/seed/portfolio2/1024/768',
  position: new THREE.Vector3( 3, 1.9, -half + 0.1),
  rotationY: 0,
  title: 'Project Two',
  description: 'Another image work, hung on the back wall.',
});
addFramedImage({
  url: 'https://picsum.photos/seed/portfolio3/1024/768',
  position: new THREE.Vector3(-half + 0.1, 1.9, 0),
  rotationY: Math.PI / 2,
  title: 'Project Three',
  description: 'Hung on the left wall — rotation matters.',
});
addFramedVideo({
  // Public sample. Replace with ./assets/videos/your-reel.mp4 once you have one.
  url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4',
  position: new THREE.Vector3( half - 0.1, 1.9, 0),
  rotationY: -Math.PI / 2,
  title: 'Showreel',
  description: 'A looping video piece. Use H.264 mp4 for best browser support.',
});
addPedestalSculpture({
  position: new THREE.Vector3(0, 0, 0),
  title: '3D Sculpture',
  description: 'Replace this torus knot with your own .glb via GLTFLoader.',
});

// =============================================================
// 5. DESKTOP CONTROLS
// =============================================================
const controls = new PointerLockControls(camera, document.body);
const keys = Object.create(null);

document.addEventListener('keydown', (e) => {
  keys[e.code] = true;

  // Enter on the title screen also starts the experience
  if (e.code === 'Enter' && !startBtn.disabled && !menuHidden()) {
    startExperience();
  }
  // E to interact with whatever the crosshair is on
  if (e.code === 'KeyE' && currentInteractable && controls.isLocked) {
    openArtworkModal(currentInteractable.userData);
  }
  // Esc closes modal (the browser already releases pointer lock for us)
  if (e.code === 'Escape') {
    if (!modal.classList.contains('hidden')) closeArtworkModal();
  }
});
document.addEventListener('keyup', (e) => { keys[e.code] = false; });

// =============================================================
// 6. MOBILE CONTROLS
// =============================================================
// Pointer lock isn't available on mobile, so we replace it with:
//   • a virtual joystick on the left (movement)
//   • drag-to-look on the right half of the screen
//   • an "E" button that fires the same interact action
const isMobile = matchMedia('(pointer: coarse)').matches || /iPhone|iPad|Android|Mobile/i.test(navigator.userAgent);
const touchUI    = document.getElementById('touch-ui');
const joystick   = document.getElementById('joystick');
const knob       = document.getElementById('joystick-knob');
const interactBtn= document.getElementById('touch-interact');

let joyVec = { x: 0, y: 0 };       // -1..1 on each axis
let joyTouchId = null;
let lookTouchId = null;
let lookLast = { x: 0, y: 0 };
const cameraEuler = new THREE.Euler(0, 0, 0, 'YXZ'); // for manual rotation on mobile

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

  // Any touch that starts on the right half (and isn't on the UI) becomes a "look" touch
  document.addEventListener('touchstart', (e) => {
    if (!menuHiddenFlag) return;
    for (const t of e.changedTouches) {
      const onUi = t.target.closest('#touch-ui, #artwork-modal, #menu');
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
  joyVec.y = -Math.sin(ang) * (dist / max); // up = forward
  knob.style.transform = `translate(calc(-50% + ${Math.cos(ang) * dist}px), calc(-50% + ${Math.sin(ang) * dist}px))`;
}
function resetKnob() {
  knob.style.transform = 'translate(-50%, -50%)';
}

// =============================================================
// 7. INTERACTION (raycast → prompt → modal)
// =============================================================
const raycaster = new THREE.Raycaster();
raycaster.far = 3.5; // only show prompt within ~3.5m
const promptEl = document.getElementById('prompt');
const modal    = document.getElementById('artwork-modal');
const modalMedia       = document.getElementById('modal-media');
const modalTitle       = document.getElementById('modal-title');
const modalDescription = document.getElementById('modal-description');
let currentInteractable = null;

function checkInteraction() {
  // On desktop the experience is "started" when pointer is locked.
  // On mobile we use a flag instead.
  const active = isMobile ? menuHiddenFlag : controls.isLocked;
  if (!active) { promptEl.classList.add('hidden'); currentInteractable = null; return; }

  raycaster.setFromCamera({ x: 0, y: 0 }, camera);
  const hits = raycaster.intersectObjects(interactables, true);

  if (hits.length > 0) {
    // Walk up parents until we hit one of the registered interactables
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
  // Clear previous media node
  modalMedia.innerHTML = '';

  if (data.type === 'image') {
    const img = document.createElement('img');
    img.src = data.src;
    img.alt = data.title;
    modalMedia.appendChild(img);
  } else if (data.type === 'video') {
    const v = document.createElement('video');
    v.src = data.src;
    v.controls = true;
    v.autoplay = true;
    v.playsInline = true;
    modalMedia.appendChild(v);
  } else {
    // 3D sculpture or unknown: skip media, show only text
  }

  modalTitle.textContent       = data.title;
  modalDescription.textContent = data.description;
  modal.classList.remove('hidden');

  // Release pointer lock so user can read / scroll / click
  if (controls.isLocked) controls.unlock();
}
function closeArtworkModal() {
  modal.classList.add('hidden');
  modalMedia.innerHTML = '';
  // Re-engage pointer lock on desktop (mobile keeps using flag-based active state)
  if (!isMobile) controls.lock();
}
document.getElementById('modal-close').addEventListener('click', closeArtworkModal);

// =============================================================
// 8. STARTING THE EXPERIENCE (title menu → 3D scene)
// =============================================================
let menuHiddenFlag = false;
function menuHidden() { return menuHiddenFlag; }

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
const SPEED         = 4.0; // m/s

const _forward = new THREE.Vector3();
const _right   = new THREE.Vector3();
const _move    = new THREE.Vector3();
const _testRay = new THREE.Raycaster();

function canMove(direction, distance) {
  // Cast a ray from the player position in `direction` and check if any
  // collidable is closer than (radius + distance). If so, we'd embed in it.
  _testRay.set(camera.position, direction);
  _testRay.far = PLAYER_RADIUS + distance + 0.01;
  const hits = _testRay.intersectObjects(collidables, false);
  return hits.length === 0;
}

function updateMovement(dt) {
  const active = isMobile ? menuHiddenFlag : controls.isLocked;
  if (!active) return;

  // Build forward / right vectors flattened to the XZ plane
  _forward.set(0, 0, -1).applyQuaternion(camera.quaternion);
  _forward.y = 0; _forward.normalize();
  _right.set(1, 0, 0).applyQuaternion(camera.quaternion);
  _right.y = 0; _right.normalize();

  // Combine keyboard + joystick input
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
  if (_move.lengthSq() > 1) _move.normalize(); // cap diagonal speed

  const distance = SPEED * dt;

  // Test X and Z separately so you slide along walls instead of getting stuck
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
// ANIMATION LOOP
// =============================================================
const clock = new THREE.Clock();

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.1);

  updateMovement(dt);
  checkInteraction();

  // Spin anything tagged userData.rotates (e.g. the sculpture)
  scene.traverse(o => { if (o.userData && o.userData.rotates) o.rotation.y += dt * 0.4; });

  renderer.render(scene, camera);
}
animate();

// =============================================================
// RESIZE
// =============================================================
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// =============================================================
// LOADING YOUR BLENDER ROOM (uncomment when ready)
// =============================================================
// To replace the placeholder room with your own .glb:
//   1. Export from Blender as glTF 2.0 (.glb), with Draco compression.
//   2. Drop the file at ./assets/room.glb
//   3. Delete (or comment out) the "PLACEHOLDER ROOM" block above
//      and the placeholder collidables it pushes.
//   4. Uncomment this block.
//
// const dracoLoader = new DRACOLoader();
// dracoLoader.setDecoderPath('https://www.gstatic.com/draco/v1/decoders/');
// const gltfLoader = new GLTFLoader(manager);
// gltfLoader.setDRACOLoader(dracoLoader);
//
// gltfLoader.load('./assets/room.glb', (gltf) => {
//   const room = gltf.scene;
//   room.traverse(node => {
//     if (node.isMesh) {
//       node.castShadow = node.receiveShadow = true;
//       // Treat every wall/floor mesh as a collidable. If you want only
//       // *some* meshes to be collidable, name them e.g. "wall_*" in
//       // Blender and check `if (node.name.startsWith('wall_'))` here.
//       collidables.push(node);
//     }
//   });
//   scene.add(room);
// });
