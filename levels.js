// =============================================================
// LEVELS — shared registry of every gallery room
// =============================================================
// This file is the single source of truth for level metadata. It is
// imported by:
//   - main.js   (resolves the current level's glb path + display name,
//                and validates doorway destinations before navigating)
//   - menu.js   (will list levels in the start-up menu's "Level Select")
//
// Adding a new level
// ------------------
// 1. Drop a new .glb into ./assets/ (e.g. ./assets/studio.glb)
// 2. Create a new HTML page at ./<id>.html (e.g. ./studio.html) by
//    copying the existing gallery page. Inside it, set:
//        <script>window.LEVEL_ID = 'studio';</script>
//    before the main.js <script> tag.
// 3. Append an entry to the LEVELS array below.
// 4. In Blender, add a `door_<id>` mesh to any room that should lead
//    to this level. Walking through the door navigates to <id>.html.

export const LEVELS = [
  {
    id:   'gallery',
    name: 'Gallery',
    glb:  './assets/room.glb',
    // Override the default <id>.html navigation target. Used while we
    // still serve this level as index.html — once we rename the file to
    // gallery.html in a later step, this `file` line can be removed.
    file: 'index.html',
    // description: 'The main hall.',
    // thumbnail:   './assets/levels/gallery.jpg',
  },
  // Example for the next room you build:
  // {
  //   id:   'studio',
  //   name: 'Studio',
  //   glb:  './assets/studio.glb',
  // },
];

export function getLevelById(id) {
  return LEVELS.find(l => l.id === id);
}

export function getDefaultLevel() {
  return LEVELS[0];
}
