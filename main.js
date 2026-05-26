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
import { getLevelById, getDefaultLevel } from './levels.js';

// =============================================================
// CURRENT LEVEL
// =============================================================
// Each level page sets `window.LEVEL_ID` (e.g. 'gallery', 'studio')
// before loading this script; we use it to look up the room glb and
// display name. Falls back to the first registered level if nothing
// was set, so the file still works opened directly.
const LEVEL      = getLevelById(window.LEVEL_ID) || getDefaultLevel();
const LEVEL_ID   = LEVEL.id;
const LEVEL_NAME = LEVEL.name;
console.log(`[level] loading "${LEVEL_NAME}" (id=${LEVEL_ID}) from ${LEVEL.glb}`);

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
//   160 = strong PS1 wobble (can collapse small geometry at sharp angles)
//   320 = noticeable wobble, safer for small props
//   480 = subtle, gentle PS2 character
//   0   = off
const PS1_JITTER = 480;

// Apply NEAREST filtering to all textures (no bilinear smoothing).
const PIXEL_TEXTURES = true;

// =============================================================
// 1. LOADING MANAGER + LOADING SCREEN
// =============================================================
const manager       = new THREE.LoadingManager();
const progressBar   = document.getElementById('progress-bar');
const percentText   = document.getElementById('loading-percent');
const levelNameEl   = document.getElementById('loading-level-name');
const startBtn      = document.getElementById('start-button');

// Populate the level-name label as soon as we know what level we are.
if (levelNameEl) levelNameEl.textContent = `Loading ${LEVEL_NAME}…`;

// If the player arrived here via a doorway, the URL has `?from=transition`.
// Swap the Enter button label to "Continue" so it feels like the same
// experience picking up rather than a fresh start.
const IS_FROM_TRANSITION = new URLSearchParams(window.location.search).has('from');
if (IS_FROM_TRANSITION) startBtn.textContent = 'Continue';

manager.onProgress = (url, loaded, total) => {
  const pct = total > 0 ? Math.round((loaded / total) * 100) : 0;
  progressBar.style.width = pct + '%';
  if (percentText) percentText.textContent = `${pct}%`;
};
manager.onLoad = () => {
  progressBar.style.width = '100%';
  if (percentText) percentText.textContent = '100%';
  if (levelNameEl) levelNameEl.textContent = `${LEVEL_NAME} ready`;
  startBtn.disabled = false;
  startBtn.classList.add('ready');
};
manager.onError = (url) => {
  console.warn('Failed to load', url);
};

// ----- Wallpaper slideshow + random tip -----
// Drop image paths into LOADING_WALLPAPERS to enable the slideshow above
// the progress bar. If the array is empty, the wallpaper element hides
// itself and the tip alone is shown.
const LOADING_WALLPAPERS = [
  // './assets/wallpapers/wp1.jpg',
  // './assets/wallpapers/wp2.jpg',
];
const LOADING_TIPS = [
  'Hold Q to sprint through the gallery.',
  'Press I at any time to open your inventory.',
  'Hold Shift to sneak and crouch.',
  'Walk into a doorway to travel to another room.',
  'You can adjust the volume from the pause menu.',
  'Press E to interact with framed work and pick up items.',
];
const WALLPAPER_INTERVAL_MS = 4500;

(function setupLoadingShow() {
  const wpEl  = document.getElementById('loading-wallpaper');
  const tipEl = document.getElementById('loading-tip');

  if (tipEl && LOADING_TIPS.length) {
    tipEl.textContent = LOADING_TIPS[Math.floor(Math.random() * LOADING_TIPS.length)];
  }
  if (!wpEl) return;
  if (LOADING_WALLPAPERS.length === 0) {
    // No wallpapers configured — leave the element in place so the
    // loading-screen layout still has its top panel; it just shows
    // the fallback background color from the CSS.
    return;
  }
  let i = Math.floor(Math.random() * LOADING_WALLPAPERS.length);
  const next = () => {
    wpEl.style.backgroundImage = `url('${LOADING_WALLPAPERS[i]}')`;
    i = (i + 1) % LOADING_WALLPAPERS.length;
  };
  next();
  setInterval(next, WALLPAPER_INTERVAL_MS);
})();

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
//
// Doorway triggers: any mesh named `door_<destination>` is treated as a
// walk-through trigger that loads `<destination>.html`. Model whatever
// you want as the visual (a door, a picture frame, a glowing portal) and
// name it `door_studio` or similar; the code will route through it.
const collidables = [];
const doorways = [];                // { mesh, destination, box }
const ROOM_GLB_URL = LEVEL.glb;

const dracoLoader = new DRACOLoader();
dracoLoader.setDecoderPath('https://www.gstatic.com/draco/v1/decoders/');
const gltfLoader = new GLTFLoader(manager);
gltfLoader.setDRACOLoader(dracoLoader);

// Anchor name → Object3D in the loaded scene. Populated after .glb loads.
const anchors = {};

gltfLoader.load(ROOM_GLB_URL, (gltf) => {
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

      // Doorway triggers — walk-through, NOT collidable. The mesh stays
      // visible (so it can be the actual door / portal visual the user
      // models in Blender). Walking into its bounding box loads the next
      // level page.
      if (node.name && /^door_/i.test(node.name)) {
        doorways.push({
          mesh: node,
          destination: node.name.substring(5),  // strip the "door_" prefix
          box: new THREE.Box3(),
        });
      }

      const skip = /^(decor_|prop_|nocollide|light_|door_)/i.test(node.name);
      if (!skip) collidables.push(node);
    }

    // Anything with a known anchor name becomes an attachment point.
    if (node.name && /^(frame_|video_|pedestal_|pickup_)/.test(node.name)) {
      anchors[node.name] = node;
    }
  });

  scene.add(room);

  // Compute doorway bounding boxes in world space. Needs to happen after
  // scene.add() so the world matrices are correct. Small expansion makes
  // sure fast-moving players don't tunnel through thin door planes.
  room.updateMatrixWorld(true);
  for (const door of doorways) {
    door.box.setFromObject(door.mesh);
    door.box.expandByScalar(0.15);
  }

  // Attach artworks + collectibles to the empties we just discovered.
  attachArtworks();
  attachCollectibles();
});

// =============================================================
// DOORWAY TRANSITIONS
// =============================================================
// Called every frame; if the player camera is inside a doorway box, we
// navigate to the matching destination page.
const _doorCheckPos = new THREE.Vector3();
function checkDoorways() {
  if (!menuHiddenFlag) return;
  if (window.__transitioning)  return;
  if (doorways.length === 0)   return;
  _doorCheckPos.copy(camera.position);
  for (const door of doorways) {
    if (door.box.containsPoint(_doorCheckPos)) {
      transitionToLevel(door.destination);
      return;
    }
  }
}

function transitionToLevel(destination) {
  if (window.__transitioning) return;

  // Validate against the levels registry so a typo in Blender (e.g.
  // door_studoi) warns in the console instead of triggering a 404.
  const target = getLevelById(destination);
  if (!target) {
    console.warn(`[doorway] No level registered with id "${destination}" — check levels.js. Door ignored.`);
    return;
  }

  window.__transitioning = true;
  console.log(`[doorway] transitioning to ${target.id}.html (${target.name})`);

  // Optional doorway one-shot — silent if the mp3 wasn't found at load.
  if (audioBuffers.doorway) playBuffer(audioBuffers.doorway, 1);

  // Quick fade-to-black before the page swap, so the navigation doesn't
  // look like an abrupt page jump.
  const overlay = document.createElement('div');
  overlay.style.cssText = `
    position: fixed; inset: 0; background: #000; z-index: 9999;
    opacity: 0; transition: opacity 0.5s ease;
    display: flex; align-items: center; justify-content: center;
    color: #fff; letter-spacing: 0.3em; text-transform: uppercase;
    font-size: 0.9rem;
  `;
  overlay.textContent = 'Loading…';
  document.body.appendChild(overlay);
  requestAnimationFrame(() => { overlay.style.opacity = '1'; });

  setTimeout(() => {
    // The level may override the default filename via a `file` field
    // (used while gallery is still served as index.html).
    const file = target.file || `${target.id}.html`;
    window.location.href = `./${file}?from=transition`;
  }, 600);
}

// =============================================================
// 4. ARTWORKS
// =============================================================
// Each entry is attached as a child of the matching named empty in
// the loaded room.glb. Edit this array to add / remove / reorder works.
const ARTWORK_DATA = [
  {
    anchor: 'frame_01',
    type: 'image',
    src: 'assets/frame_01.jpg',
    title: 'der andere wanderer',
    description: 'der andere wanderer',
  },
  {
    anchor: 'frame_02',
    type: 'image',
    src: 'assets/frame_02.jpg',
    title: 'Solomonica',
    description: 'a rendered still based on a reference photo. assets, texturing/illustration, shading by me',
  },
  {
    anchor: 'frame_03',
    type: 'video',
    src: 'assets/frame_03.mp4',
    title: 'Rainbow Road',
    description: 'a short animation based on a small toy car. assets, animation, shading and editing by me',
  },
  {
    anchor: 'frame_04',
    type: 'video',
    src: 'assets/frame_04.mp4',
    title: 'a building',
    description: 'a short animation based on a reference photo. assets, animation, shading and editing by me',
  },
  {
    anchor: 'pedestal_01',
    type: 'sculpture',
    title: 'Demon Skull',
    description: 'freehanded digital sculpt',
    color: 0xff6a00,

    //To load your own .glb model on this pedestal, uncomment and tweak:
    modelUrl:       './assets/skull.glb',
    scale:          0.25,         // 0.5 = half size, 2 = double size
    modelY:         1.5,        // y position above the anchor — pedestal top ≈ 1.35
    modelRotationY: 0,           // facing direction in radians: π/2 ≈ 1.57 = quarter turn
    rotates:        true,        // false to keep the sculpture static
  },
];

const interactables = [];

// =============================================================
// COLLECTIBLES — pickup items defined in the room
// =============================================================
// Each entry attaches to an empty named `pickup_*` in room.glb.
// Add empties in Blender with names matching the `anchor` strings below.
// Items appear as glowing floating cubes; press E while looking at one
// to add it to the inventory.
const COLLECTIBLES_DATA = [
  {
    anchor: 'pickup_aquario',
    id: 'aquarius',
    name: 'Aquarius',
    description: 'A mysterious pack of italian matches. It seems to resemble one of the 12 zodiac signs ...',
    color: 0xc89977,
    // iconUrl: './assets/items/aquarius.png',  // optional inventory icon

    // .glb model used as the floating collectible visual
    modelUrl:       './assets/items/aquario.glb',
    scale:          1.0,         // size multiplier
    modelY:         1.0,         // height above the anchor
    modelRotationY: 0,           // initial facing direction (radians)
    rotates:        true,        // slowly spin in place
    bobs:           true,        // gently float up and down
  },
];

function attachCollectibles() {
  for (const data of COLLECTIBLES_DATA) {
    const anchor = anchors[data.anchor];
    if (!anchor) continue; // silently skip if Blender hasn't been updated yet
    addCollectible(anchor, data);
  }
}

function addCollectible(anchor, data) {
  // The interactable is a Group so the visual (cube OR loaded .glb) can
  // change without breaking the raycaster/userData wiring.
  const group = new THREE.Group();
  group.position.y = data.modelY ?? 1.0;
  group.userData = {
    type: 'pickup',
    id: data.id,
    name: data.name,
    description: data.description,
    iconUrl: data.iconUrl,
    color: data.color,
    rotates: data.rotates !== false,    // default true
    bobs:    data.bobs    !== false,    // default true
    bobBase: group.position.y,
  };
  anchor.add(group);
  interactables.push(group);

  if (data.modelUrl) {
    // Load the user-supplied .glb and add it as a child of the group.
    gltfLoader.load(
      data.modelUrl,
      (gltf) => {
        const model = gltf.scene;
        model.scale.setScalar(data.scale ?? 1.0);
        model.rotation.y = data.modelRotationY ?? 0;
        model.traverse(node => {
          if (node.isMesh) {
            node.castShadow = true;
            node.receiveShadow = true;
            ps1MeshMaterials(node);
          }
        });
        group.add(model);
      },
      undefined,
      (err) => console.warn(`[collectible] Failed to load ${data.modelUrl}:`, err)
    );
  } else {
    // Fallback: glowing placeholder cube (the original yellow box).
    const cube = new THREE.Mesh(
      new THREE.BoxGeometry(0.18, 0.12, 0.08),
      ps1Material(new THREE.MeshStandardMaterial({
        color: data.color || 0xffffff,
        emissive: data.color || 0xffaa00,
        emissiveIntensity: 0.4,
        roughness: 0.5,
      }))
    );
    cube.castShadow = true;
    group.add(cube);
  }
}

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

// Target size for the LONGEST side of the artwork (in meters). Frames keep
// this dimension constant and let the other side flex to match the media's
// aspect ratio — so a 16:9 video is wider than a 1:1 photo, but they share
// the same "size on the wall" feeling.
const FRAME_MAX_SIDE   = 2.0;
const FRAME_BORDER     = 0.10;   // thickness of the dark border on every side
const FRAME_DEPTH      = 0.08;   // how far the frame box sticks out from the wall
const VIDEO_MAX_SIDE   = 2.2;    // videos a touch larger than photos

// Compute (width, height) that fit inside a `maxSide × maxSide` box while
// preserving the source aspect ratio.
function sizeForAspect(aspect, maxSide) {
  if (aspect >= 1) return { w: maxSide, h: maxSide / aspect };
  return            { w: maxSide * aspect, h: maxSide };
}

function buildFrameMeshes(group, tex, aspect, maxSide, { useBasic = false } = {}) {
  const { w, h } = sizeForAspect(aspect, maxSide);

  // The dark frame box keeps the PS1 vertex jitter for character.
  const frame = new THREE.Mesh(
    new THREE.BoxGeometry(w + FRAME_BORDER * 2, h + FRAME_BORDER * 2, FRAME_DEPTH),
    ps1Material(new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.6 }))
  );

  // The art plane itself is EXEMPT from the vertex jitter — otherwise the
  // four corners can snap together at sharp angles and the frame visually
  // collapses to nothing. Bump it a bit further in front of the box so a
  // little wobble on the frame can't push the art behind it.
  const artMat = useBasic
    ? new THREE.MeshBasicMaterial({ map: tex })
    : new THREE.MeshStandardMaterial({ map: tex, roughness: 0.5 });
  const art = new THREE.Mesh(new THREE.PlaneGeometry(w, h), artMat);
  art.position.z = FRAME_DEPTH / 2 + 0.01;

  group.add(frame);
  group.add(art);
}

function addFramedImage(anchor, { src, title, description, maxSide = FRAME_MAX_SIDE }) {
  // Add the group up-front so the anchor transform and interactable list are
  // wired immediately; meshes get filled in once the texture's dimensions
  // are known.
  const group = new THREE.Group();
  group.userData = { title, description, type: 'image', src };
  anchor.add(group);
  interactables.push(group);

  new THREE.TextureLoader(manager).load(src, (tex) => {
    tex.colorSpace = THREE.SRGBColorSpace;
    ps1Texture(tex);
    const aspect = (tex.image.naturalWidth || tex.image.width) /
                   (tex.image.naturalHeight || tex.image.height);
    buildFrameMeshes(group, tex, aspect, maxSide);
  });
}

function addFramedVideo(anchor, { src, title, description, maxSide = VIDEO_MAX_SIDE }) {
  const video = document.createElement('video');
  video.src = src;
  video.loop = true;
  video.muted = true;
  video.playsInline = true;
  video.crossOrigin = 'anonymous';
  video.play().catch(() => { /* will play after user gesture */ });

  const group = new THREE.Group();
  group.userData = { title, description, type: 'video', src, video };
  anchor.add(group);
  interactables.push(group);

  // Hook into the LoadingManager so the Start button waits for the metadata
  // before the user can enter the scene (otherwise frames would pop in late).
  manager.itemStart(src);

  const build = () => {
    const aspect = (video.videoWidth || 16) / (video.videoHeight || 9);
    const tex = new THREE.VideoTexture(video);
    tex.colorSpace = THREE.SRGBColorSpace;
    ps1Texture(tex);
    // useBasic: VideoTextures on MeshBasicMaterial skip the PS1 vertex jitter
    // shader, which is what the original code did and keeps video playback
    // smooth.
    buildFrameMeshes(group, tex, aspect, maxSide, { useBasic: true });
    manager.itemEnd(src);
  };

  if (video.readyState >= 1) build();
  else video.addEventListener('loadedmetadata', build, { once: true });
  video.addEventListener('error', () => manager.itemError(src), { once: true });
}

function addPedestalSculpture(anchor, {
  title, description,
  color = 0xff6a00,
  modelUrl,                  // optional: path to a .glb to load on the pedestal
  scale = 1.0,               // size multiplier for the loaded model
  modelY = 1.35,             // height above the anchor — top of pedestal ≈ 1.35
  modelRotationY = 0,        // initial facing direction (radians)
  rotates = true,            // slowly spin on its pedestal
}) {
  // ---- Pedestal (always rendered, regardless of what stands on it) ----
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

  // ---- Sculpture: load .glb if a URL is given, else placeholder ----
  if (modelUrl) {
    gltfLoader.load(
      modelUrl,
      (gltf) => {
        const model = gltf.scene;
        model.scale.setScalar(scale);
        model.position.y = modelY;
        model.rotation.y = modelRotationY;

        // Shadows + PS1 vibe on every mesh inside the loaded model
        model.traverse(node => {
          if (node.isMesh) {
            node.castShadow = true;
            node.receiveShadow = true;
            ps1MeshMaterials(node);
          }
        });

        model.userData = { title, description, type: 'sculpture', rotates };
        anchor.add(model);
        interactables.push(model);
      },
      undefined,
      (err) => console.warn(`[sculpture] Failed to load ${modelUrl}:`, err)
    );
  } else {
    // Placeholder torus knot — swap with a real .glb by setting modelUrl above
    const sculpture = new THREE.Mesh(
      new THREE.TorusKnotGeometry(0.25, 0.08, 128, 16),
      ps1Material(new THREE.MeshStandardMaterial({ color, metalness: 0.7, roughness: 0.25 }))
    );
    sculpture.position.y = modelY;
    sculpture.castShadow = true;
    sculpture.userData = { title, description, type: 'sculpture', rotates };
    anchor.add(sculpture);
    interactables.push(sculpture);
  }
}

// =============================================================
// 5. DESKTOP CONTROLS
// =============================================================
const controls = new PointerLockControls(camera, document.body);
const keys = Object.create(null);

document.addEventListener('keydown', (e) => {
  keys[e.code] = true;

  // ---------- Enter: title start / resume / close modal ----------------
  if (e.code === 'Enter') {
    if (!modal.classList.contains('hidden')) {
      closeArtworkModal();
      if (!isMobile && menuHiddenFlag) controls.lock();
      e.preventDefault();
      return;
    }
    if (!menuHiddenFlag && !startBtn.disabled) {
      startExperience();
      return;
    }
    if (menuHiddenFlag && !resumeOverlay.classList.contains('hidden')) {
      // 'lock' event listener hides the overlay on success; if Chrome
      // blocks the request, the overlay stays so the user has a fallback.
      if (isMobile) hideResumeOverlay();
      else          controls.lock();
      return;
    }
  }

  // ---------- I: inventory toggle ---------------------------------------
  // Works regardless of pointer-lock state so it can also close the
  // inventory once it's open. Disabled while the artwork modal is showing.
  if (e.code === 'KeyI' && menuHiddenFlag) {
    if (modal.classList.contains('hidden')) {
      e.preventDefault();
      toggleInventory();
    }
    return;
  }

  // ---------- E (while modal is open): close artwork modal -------------
  // Handled here, BEFORE the in-game gate, because opening the modal
  // releases pointer-lock — by the time this fires, controls.isLocked
  // is false and the in-game branch below would never see it.
  if (e.code === 'KeyE' && !modal.classList.contains('hidden')) {
    closeArtworkModal();
    if (!isMobile && menuHiddenFlag) controls.lock();
    e.preventDefault();
    return;
  }

  // ---------- Esc: close modal / inventory / show resume overlay ------
  if (e.code === 'Escape') {
    if (!modal.classList.contains('hidden')) {
      closeArtworkModal();
      if (!isMobile && menuHiddenFlag) showResumeOverlay();
      return;
    }
    if (!inventoryOverlay.classList.contains('hidden')) {
      hideInventory();
      return;
    }
    // Otherwise: Chrome already released pointer lock, the unlock event
    // listener will surface the resume overlay — and the user resumes
    // from there with Enter or by clicking the button.
  }

  // ---------- In-game actions (require pointer lock / mobile started) --
  const inGame = isMobile ? menuHiddenFlag : controls.isLocked;
  if (!inGame) return;

  // E = context interact (artwork or pickup)
  if (e.code === 'KeyE') {
    handleInteract();
    e.preventDefault();
  }

  // Space = jump
  if (e.code === 'Space') {
    e.preventDefault();
    if (isGrounded) playerVy = JUMP_VELOCITY;
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
    const ud = obj.userData;
    promptEl.textContent = ud.type === 'pickup'
      ? `[E] Pick up "${ud.name}"`
      : `[E] View "${ud.title}"`;
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
// INVENTORY + INTERACT HANDLER
// =============================================================
// `inventory` is an array of item-data objects (same shape as COLLECTIBLES_DATA
// entries). The inventory UI re-renders from this array whenever it changes.
const inventory = [];
let selectedInventoryIndex = -1;
const inventoryOverlay = document.getElementById('inventory-overlay');
const inventoryGrid    = document.getElementById('inventory-grid');
const inventoryDetail  = document.getElementById('inventory-detail');
const toastEl          = document.getElementById('toast');
const INVENTORY_SLOTS  = 12; // visual grid slots (rows × cols defined in CSS)

function renderInventory() {
  inventoryGrid.innerHTML = '';
  for (let i = 0; i < INVENTORY_SLOTS; i++) {
    const slot = document.createElement('div');
    slot.className = 'inv-slot';
    const item = inventory[i];
    if (item) {
      slot.classList.add('filled');
      if (i === selectedInventoryIndex) slot.classList.add('selected');
      slot.innerHTML = item.iconUrl
        ? `<img src="${item.iconUrl}" alt="" /><span class="slot-name">${item.name}</span>`
        : `<div style="width:60%;height:50%;background:#${(item.color ?? 0xffffff).toString(16).padStart(6,'0')};margin-bottom:0.3rem;border:1px solid #000;"></div><span class="slot-name">${item.name}</span>`;
      slot.addEventListener('click', () => { selectedInventoryIndex = i; renderInventory(); });
    }
    inventoryGrid.appendChild(slot);
  }
  // Detail panel
  const sel = inventory[selectedInventoryIndex];
  if (sel) {
    inventoryDetail.innerHTML = `<h3>${sel.name}</h3><p>${sel.description}</p>`;
  } else {
    inventoryDetail.innerHTML = `<p class="hint">Select an item to view its description.</p>`;
  }
}

function showInventory() {
  renderInventory();
  inventoryOverlay.classList.remove('hidden');
  if (controls.isLocked) controls.unlock();
}
function hideInventory() {
  inventoryOverlay.classList.add('hidden');
  if (!isMobile && menuHiddenFlag) controls.lock();
}
function toggleInventory() {
  if (inventoryOverlay.classList.contains('hidden')) showInventory();
  else hideInventory();
}
renderInventory(); // initial empty grid

function showToast(message, duration = 1800) {
  toastEl.textContent = message;
  toastEl.classList.remove('hidden');
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => toastEl.classList.add('hidden'), duration);
}

function pickupCollectible(obj) {
  const data = obj.userData;
  inventory.push({
    id: data.id,
    name: data.name,
    description: data.description,
    iconUrl: data.iconUrl,
    color: data.color,
  });
  // Remove from world
  if (obj.parent) obj.parent.remove(obj);
  const idx = interactables.indexOf(obj);
  if (idx >= 0) interactables.splice(idx, 1);
  currentInteractable = null;
  promptEl.classList.add('hidden');

  showToast(`Picked up: ${data.name}`);
  renderInventory();
}

// E = pure context interact. Inventory is now bound to I exclusively.
function handleInteract() {
  if (!modal.classList.contains('hidden')) return;
  if (!inventoryOverlay.classList.contains('hidden')) return;
  if (!currentInteractable) return;

  const data = currentInteractable.userData;
  if (data.type === 'pickup') pickupCollectible(currentInteractable);
  else                         openArtworkModal(data);
}

// =============================================================
// 8. RESUME OVERLAY + START MENU
// =============================================================
const resumeOverlay = document.getElementById('resume-overlay');
const resumeButton  = document.getElementById('resume-button');

function showResumeOverlay() { resumeOverlay.classList.remove('hidden'); }
function hideResumeOverlay() { resumeOverlay.classList.add('hidden'); }

resumeButton.addEventListener('click', () => {
  // Clicks are fresh user gestures (no Escape-cooldown), so lock should
  // succeed — but rely on the 'lock' event to hide the overlay anyway so
  // the rare failure case still leaves the button visible.
  if (isMobile) hideResumeOverlay();
  else          controls.lock();
});

controls.addEventListener('unlock', () => {
  // Don't surface the resume overlay if the unlock was caused by opening
  // the inventory or modal — those have their own UI to return from.
  if (menuHiddenFlag
      && modal.classList.contains('hidden')
      && inventoryOverlay.classList.contains('hidden')) {
    showResumeOverlay();
  }
});
controls.addEventListener('lock', () => { hideResumeOverlay(); });

let menuHiddenFlag = false;
function startExperience() {
  document.getElementById('menu').classList.add('hidden');
  document.getElementById('hud').classList.remove('hidden');
  menuHiddenFlag = true;
  if (!isMobile) controls.lock();
  // Browser autoplay policies require a user gesture before audio can start
  // — the Start button click is that gesture.
  startAmbience();
}
startBtn.addEventListener('click', startExperience);

// =============================================================
// SOUND
// =============================================================
// Built on the Web Audio API rather than <audio> elements:
//   1. <audio loop> has an audible click at every loop boundary — Web
//      Audio's AudioBufferSourceNode.loop is sample-accurate so the
//      ambience can loop without you hearing the seam (provided your
//      source file is already a clean loop with no leading/trailing
//      silence).
//   2. Everything routes through a single master gain node, which the
//      volume slider in the pause menu writes to directly.
//
// Tweak these to taste:
const AMBIENCE_VOLUME   = 0.5;
const STEP_VOLUME       = 0.6;
const RANDOM_VOLUME     = 0.7;
const STEP_INTERVAL        = 0.45;  // seconds between footsteps while walking
const SPRINT_STEP_INTERVAL = 0.28;  // shorter cadence while sprinting (Q held)
const RANDOM_MIN_GAP_S  = 1  * 60;  //  1 minute
const RANDOM_MAX_GAP_S  = 10 * 60;  // 10 minutes
// Per-clip play probability. random_03 = lowest, as requested.
const RANDOM_WEIGHTS    = [0.4, 0.4, 0.2];

const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
const masterGain = audioCtx.createGain();
masterGain.gain.value = 0.7;        // slider initial value (matches HTML)
masterGain.connect(audioCtx.destination);

const audioBuffers = { ambience: null, steps: [], random: [] };
let ambienceSource = null;
let ambienceWantsStart = false;     // user pressed Start before buffer loaded
let stepTimer = 0;
let lastStepIndex = -1;
let randomTimer = scheduleNextRandom();

async function loadBuffer(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fetch ${url}: ${res.status}`);
  const ab = await res.arrayBuffer();
  return new Promise((resolve, reject) =>
    audioCtx.decodeAudioData(ab, resolve, reject)
  );
}

(async function loadAllSounds() {
  try {
    audioBuffers.ambience = await loadBuffer('./assets/sounds/ambience_01.mp3');
    audioBuffers.steps = await Promise.all([
      loadBuffer('./assets/sounds/steps_01.mp3'),
      loadBuffer('./assets/sounds/steps_02.mp3'),
      loadBuffer('./assets/sounds/steps_03.mp3'),
      loadBuffer('./assets/sounds/steps_04.mp3'),
    ]);
    audioBuffers.random = await Promise.all([
      loadBuffer('./assets/sounds/random_01.mp3'),
      loadBuffer('./assets/sounds/random_02.mp3'),
      loadBuffer('./assets/sounds/random_03.mp3'),
    ]);
    // Optional doorway transition sound. Drop a file at the path below
    // and it will be used automatically; if it doesn't exist, transitions
    // are silent.
    try { audioBuffers.doorway = await loadBuffer('./assets/sounds/doorway.mp3'); }
    catch (e) { audioBuffers.doorway = null; }
    console.log('[sound] all clips loaded');
    console.log(`[sound] first random one-shot in ${(randomTimer/60).toFixed(1)} min`);
    if (ambienceWantsStart) startAmbience(); // user clicked Start while loading
  } catch (err) {
    console.warn('[sound] failed to load:', err);
  }
})();

function playBuffer(buf, gain = 1, loop = false) {
  if (!buf) return null;
  const src = audioCtx.createBufferSource();
  src.buffer = buf;
  src.loop = loop;
  const g = audioCtx.createGain();
  g.gain.value = gain;
  src.connect(g).connect(masterGain);
  src.start(0);
  return src;
}

function startAmbience() {
  // AudioContext starts in 'suspended' state; the Start button click is
  // the user gesture that lets us resume it.
  if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
  ambienceWantsStart = true;
  if (ambienceSource || !audioBuffers.ambience) return;
  ambienceSource = playBuffer(audioBuffers.ambience, AMBIENCE_VOLUME, true);
}

function playStepSound() {
  if (!audioBuffers.steps.length) return;
  let idx;
  do {
    idx = Math.floor(Math.random() * audioBuffers.steps.length);
  } while (idx === lastStepIndex && audioBuffers.steps.length > 1);
  lastStepIndex = idx;
  playBuffer(audioBuffers.steps[idx], STEP_VOLUME);
}

function tickFootsteps(dt, isMoving) {
  if (!isMoving) { stepTimer = 0; return; }
  // Sprinting (Q held, no Shift) = faster step cadence.
  const sneaking  = keys['ShiftLeft'] || keys['ShiftRight'];
  const sprinting = keys['KeyQ'] && !sneaking;
  const interval  = sprinting ? SPRINT_STEP_INTERVAL : STEP_INTERVAL;
  stepTimer -= dt;
  if (stepTimer <= 0) {
    playStepSound();
    stepTimer = interval;
  }
}

function scheduleNextRandom() {
  return RANDOM_MIN_GAP_S + Math.random() * (RANDOM_MAX_GAP_S - RANDOM_MIN_GAP_S);
}

function pickWeightedRandomIndex() {
  const total = RANDOM_WEIGHTS.reduce((s, w) => s + w, 0);
  let r = Math.random() * total;
  for (let i = 0; i < RANDOM_WEIGHTS.length; i++) {
    r -= RANDOM_WEIGHTS[i];
    if (r <= 0) return i;
  }
  return RANDOM_WEIGHTS.length - 1;
}

function tickRandomSounds(dt) {
  if (!menuHiddenFlag) return;
  if (!audioBuffers.random.length) return;
  randomTimer -= dt;
  if (randomTimer <= 0) {
    const idx = pickWeightedRandomIndex();
    console.log(`[sound] playing random_0${idx+1}`);
    playBuffer(audioBuffers.random[idx], RANDOM_VOLUME);
    randomTimer = scheduleNextRandom();
    console.log(`[sound] next random in ${(randomTimer/60).toFixed(1)} min`);
  }
}

function isPlayerMoving() {
  if (!menuHiddenFlag) return false;
  if (!isGrounded) return false; // no footsteps while airborne
  let ix = 0, iz = 0;
  if (keys['KeyW']) iz += 1;
  if (keys['KeyS']) iz -= 1;
  if (keys['KeyA']) ix -= 1;
  if (keys['KeyD']) ix += 1;
  ix += joyVec.x;
  iz += joyVec.y;
  return (ix !== 0 || iz !== 0);
}

// ----- Master volume slider in the pause menu -----
const volumeSlider = document.getElementById('volume-slider');
if (volumeSlider) {
  masterGain.gain.value = volumeSlider.value / 100;
  volumeSlider.addEventListener('input', () => {
    masterGain.gain.value = volumeSlider.value / 100;
  });
}

// =============================================================
// MOVEMENT — walking, crouching, sprinting, jumping
// =============================================================
const PLAYER_HEIGHT   = 1.7;   // standing eye height
const CROUCH_HEIGHT   = 1.0;   // crouched eye height
const PLAYER_RADIUS   = 0.4;
const WALK_SPEED      = 4.0;
const SNEAK_SPEED     = 1.8;
const SPRINT_SPEED    = 7.0;
const JUMP_VELOCITY   = 6.5;   // initial upward velocity on jump
const GRAVITY         = 22.0;  // m/s² — Earth is ~9.8, but games feel
                                // better with snappier (heavier) gravity.

let playerVy      = 0;
let isGrounded    = true;
let currentEyeHeight = PLAYER_HEIGHT; // eased toward target each frame

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

  // ---- Horizontal input ------------------------------------------------
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

  // ---- Speed selection: shift > Q > walk ------------------------------
  const sneaking = keys['ShiftLeft'] || keys['ShiftRight'];
  const sprinting = keys['KeyQ'] && !sneaking;
  let speed = WALK_SPEED;
  if (sneaking)       speed = SNEAK_SPEED;
  else if (sprinting) speed = SPRINT_SPEED;

  // ---- Horizontal movement with axis-separated collision --------------
  if (inputX !== 0 || inputZ !== 0) {
    _move.set(0, 0, 0)
      .addScaledVector(_forward, inputZ)
      .addScaledVector(_right,   inputX);
    if (_move.lengthSq() > 1) _move.normalize();

    const distance = speed * dt;

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
  }

  // ---- Vertical: ease toward standing/crouch height + apply gravity ---
  const targetEye = sneaking ? CROUCH_HEIGHT : PLAYER_HEIGHT;
  // Frame-rate-independent smoothing toward target eye height
  currentEyeHeight += (targetEye - currentEyeHeight) * (1 - Math.exp(-dt * 10));

  // Gravity + jump physics
  playerVy -= GRAVITY * dt;
  camera.position.y += playerVy * dt;

  // Ground check — the "floor" is wherever currentEyeHeight ends up.
  if (camera.position.y <= currentEyeHeight) {
    camera.position.y = currentEyeHeight;
    playerVy = 0;
    if (!isGrounded) {
      // Just landed — fire one random step sound, then delay the next
      // walking step so they don't double up. Use whichever cadence the
      // player will resume with (sprint or walk).
      playStepSound();
      const sneakingNow  = keys['ShiftLeft'] || keys['ShiftRight'];
      const sprintingNow = keys['KeyQ'] && !sneakingNow;
      stepTimer = sprintingNow ? SPRINT_STEP_INTERVAL : STEP_INTERVAL;
    }
    isGrounded = true;
  } else {
    isGrounded = false;
  }
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
  tickFootsteps(dt, isPlayerMoving());
  tickRandomSounds(dt);
  checkDoorways();

  const t = performance.now() * 0.002;
  scene.traverse(o => {
    if (!o.userData) return;
    if (o.userData.rotates) o.rotation.y += dt * 0.4;
    if (o.userData.bobs)    o.position.y = (o.userData.bobBase ?? 1.0) + Math.sin(t) * 0.06;
  });

  renderer.render(scene, camera);
}
animate();

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  applyRendererSize();
});
