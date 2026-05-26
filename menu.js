// =============================================================
// menu.js — start-up menu logic (lives only on index.html)
// =============================================================
// Intentionally NOT importing Three.js or anything from main.js —
// the menu is a separate, lighter page. We only share `levels.js`
// (for the Level Select list) and a single localStorage key
// (for syncing the volume slider with the gallery's pause menu).
//
// Audio files are all optional. The menu falls back gracefully if
// the title song / SFX / video backdrop aren't on disk yet — drop
// them in later and they activate automatically.

import { LEVELS } from './levels.js';

const STORAGE_VOLUME_KEY = 'portfolio.volume';

// =============================================================
// DOM refs
// =============================================================
const mainMenu      = document.getElementById('main-menu');
const levelPanel    = document.getElementById('level-select');
const settingsPanel = document.getElementById('settings-panel');
const levelList     = document.getElementById('level-list');
const volumeSlider  = document.getElementById('menu-volume');
const body          = document.body;

// =============================================================
// Build Level Select from levels.js
// =============================================================
function buildLevelList() {
  levelList.innerHTML = '';
  for (const level of LEVELS) {
    const li = document.createElement('li');
    li.tabIndex = 0;
    li.textContent = level.name;
    li.dataset.levelId = level.id;
    li.dataset.file    = level.file || `${level.id}.html`;
    levelList.appendChild(li);
  }
}
buildLevelList();

// =============================================================
// Audio system — uses Web Audio so we get a single master gain
// =============================================================
const audioCtx   = new (window.AudioContext || window.webkitAudioContext)();
const masterGain = audioCtx.createGain();
masterGain.connect(audioCtx.destination);

// Volume: read from localStorage so settings persist across pages.
const storedVolume = parseInt(localStorage.getItem(STORAGE_VOLUME_KEY) ?? '70', 10);
masterGain.gain.value = storedVolume / 100;
volumeSlider.value = storedVolume;
volumeSlider.addEventListener('input', () => {
  masterGain.gain.value = volumeSlider.value / 100;
  localStorage.setItem(STORAGE_VOLUME_KEY, volumeSlider.value);
});

const audioBuffers = { music: null, hover: null, select: null };
let musicSource = null;
let audioUnlocked = false;
let musicWantsStart = false;

async function loadBuffer(url) {
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(res.status);
    const ab = await res.arrayBuffer();
    return await audioCtx.decodeAudioData(ab);
  } catch (e) {
    // Silent fail — the asset is optional.
    return null;
  }
}

(async function loadAllAudio() {
  audioBuffers.music  = await loadBuffer('./assets/sounds/menu/title_theme.mp3');
  audioBuffers.hover  = await loadBuffer('./assets/sounds/menu/hover.mp3');
  audioBuffers.select = await loadBuffer('./assets/sounds/menu/select.mp3');
  console.log('[menu] audio loaded',
    'music:',  !!audioBuffers.music,
    'hover:',  !!audioBuffers.hover,
    'select:', !!audioBuffers.select);
  if (musicWantsStart && audioBuffers.music) startMusic();
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

function startMusic() {
  if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
  musicWantsStart = true;
  if (musicSource || !audioBuffers.music) return;
  musicSource = playBuffer(audioBuffers.music, 0.6, true);
}

function unlockAudio() {
  if (audioUnlocked) return;
  audioUnlocked = true;
  if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
  startMusic();
}
// Any first interaction satisfies the autoplay gate.
document.addEventListener('click',     unlockAudio, { once: true });
document.addEventListener('keydown',   unlockAudio, { once: true });
document.addEventListener('mousemove', unlockAudio, { once: true });

function playHover()  { playBuffer(audioBuffers.hover,  0.5); }
function playSelect() { playBuffer(audioBuffers.select, 0.7); }

// =============================================================
// Panel state machine
// =============================================================
let currentPanel = 'main';        // 'main' | 'levels' | 'settings'
let selectedIndex = 0;

function getCurrentItems() {
  if (currentPanel === 'main')     return Array.from(mainMenu.querySelectorAll('li'));
  if (currentPanel === 'levels')   return Array.from(levelPanel.querySelectorAll('li, .panel-back'));
  if (currentPanel === 'settings') return Array.from(settingsPanel.querySelectorAll('.panel-back'));
  return [];
}

function setSelected(el) {
  document.querySelectorAll('.selected').forEach(e => e.classList.remove('selected'));
  if (el) {
    el.classList.add('selected');
    selectedIndex = getCurrentItems().indexOf(el);
  }
}

function resetSelection() {
  const items = getCurrentItems();
  if (items.length) {
    selectedIndex = 0;
    setSelected(items[0]);
  }
}

function showPanel(name) {
  currentPanel = name;
  mainMenu.classList.toggle('hidden',      name !== 'main');
  levelPanel.classList.toggle('hidden',    name !== 'levels');
  settingsPanel.classList.toggle('hidden', name !== 'settings');
  resetSelection();
}

// =============================================================
// Navigation
// =============================================================
function navigateToFile(file) {
  if (window.__navigating) return;
  window.__navigating = true;
  playSelect();
  body.classList.add('fading-out');
  // Audio cross-fade-out so the hard cut into the gallery doesn't pop.
  try {
    masterGain.gain.linearRampToValueAtTime(0, audioCtx.currentTime + 0.4);
  } catch (e) {}
  setTimeout(() => {
    window.location.href = './' + file;
  }, 420);
}

function handleAction(action) {
  if (action === 'new-game') {
    const first = LEVELS[0];
    if (!first) return;
    navigateToFile(first.file || `${first.id}.html`);
    return;
  }
  if (action === 'level-select') { playSelect(); showPanel('levels');   return; }
  if (action === 'settings')     { playSelect(); showPanel('settings'); return; }
  if (action === 'back')         { playSelect(); showPanel('main');     return; }
}

// =============================================================
// Mouse — click + hover
// =============================================================
body.addEventListener('click', (e) => {
  const action = e.target.dataset.action;
  if (action) { handleAction(action); return; }
  const file = e.target.dataset.file;
  if (file) navigateToFile(file);
});

// Attach hover listeners to every nav item, including the dynamically
// generated level list. Re-run when the level list is built.
function attachHoverListeners() {
  document
    .querySelectorAll('.menu-nav li, .panel-list li, .panel-back')
    .forEach(el => {
      if (el.__hoverWired) return;
      el.__hoverWired = true;
      el.addEventListener('mouseenter', () => {
        setSelected(el);
        playHover();
      });
    });
}
attachHoverListeners();

// =============================================================
// Keyboard navigation
// =============================================================
document.addEventListener('keydown', (e) => {
  const items = getCurrentItems();
  if (items.length === 0) return;

  if (e.code === 'ArrowDown' || e.code === 'KeyS') {
    e.preventDefault();
    selectedIndex = (selectedIndex + 1) % items.length;
    setSelected(items[selectedIndex]);
    playHover();
  } else if (e.code === 'ArrowUp' || e.code === 'KeyW') {
    e.preventDefault();
    selectedIndex = (selectedIndex - 1 + items.length) % items.length;
    setSelected(items[selectedIndex]);
    playHover();
  } else if (e.code === 'Enter' || e.code === 'Space') {
    e.preventDefault();
    const item = items[selectedIndex];
    if (!item) return;
    if (item.dataset.action) handleAction(item.dataset.action);
    else if (item.dataset.file) navigateToFile(item.dataset.file);
  } else if (e.code === 'Escape' && currentPanel !== 'main') {
    e.preventDefault();
    showPanel('main');
  }
});

// =============================================================
// Boot
// =============================================================
resetSelection();
