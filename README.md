# 3D Portfolio Gallery

An interactive, walk-through portfolio website built with Three.js. Single-page,
no build step, hosts on GitHub Pages as-is.

## Files

```
portfolio/
├── index.html      Title menu, HUD, modal, mobile UI
├── style.css       All styling
├── main.js         Three.js scene, controls, interactions
├── assets/         (you create this — see below)
│   ├── room.glb            your Blender export
│   ├── images/             portfolio images
│   ├── videos/             portfolio videos
│   └── models/             additional .glb sculptures
└── README.md
```

## Run it locally

You can't open `index.html` directly with `file://` because ES modules and
textures need a real HTTP origin. Two easy options:

```bash
# option 1: Python
python3 -m http.server 8000

# option 2: Node
npx serve .
```

Then visit `http://localhost:8000`.

## Deploy to GitHub Pages

1. Push these files to your repo's `main` branch.
2. In the repo: **Settings → Pages → Source: Deploy from branch → Branch: `main` / `/`**.
3. Wait ~1 minute. Your site is at `https://your-username.github.io/repo-name/`.

That's it. No build, no Actions, no config needed.

## Replace the placeholder room with your Blender model

1. **Export from Blender**: `File → Export → glTF 2.0 (.glb)`
   - Format: **glTF Binary (.glb)** (single file, smaller)
   - Tick **Compression** (Draco) for smaller geometry
   - Apply modifiers: yes
   - Set the player spawn area near world origin so the camera's starting
     position (`0, 1.7, 5`) lands inside the room
2. Save the file as `./assets/room.glb`.
3. In `main.js`:
   - Delete (or comment out) the `// 3. PLACEHOLDER ROOM` block.
   - Uncomment the GLTFLoader block at the very bottom of the file.

### Blender workflow tips

- **Scale**: 1 Blender unit = 1 meter in Three.js. Make your player's eye
  height ~1.7m in Blender to sanity-check proportions.
- **Bake lighting**: real-time directional lights look fine, but baking
  ambient occlusion + indirect light into a vertex color or lightmap looks
  *much* better and runs much faster than dynamic lighting.
- **Texture sizes**: 2048×2048 max for walls/floors, 1024×1024 for props.
  Compress to KTX2 with `gltf-transform` for big wins on load time.
- **Empties as anchors**: place empty objects in Blender named like
  `frame_01`, `frame_02`, `pedestal_01`. In your loader, find them by name
  and attach images/videos/models at those positions — that way you can
  rearrange the room in Blender without changing code.

## Add your own images / videos / models

Edit the "Sample contents" section of `main.js`:

```js
addFramedImage({
  url: './assets/images/my-photo.jpg',
  position: new THREE.Vector3(-3, 1.9, -6.9),
  rotationY: 0,
  title: 'Series Title',
  description: 'What this work is about. 2024, mixed media.',
});

addFramedVideo({
  url: './assets/videos/showreel.mp4',
  position: new THREE.Vector3(3, 1.9, 6.9),
  rotationY: Math.PI,
  title: 'Showreel',
  description: '90-second cut, 2024.',
});
```

For 3D sculptures, follow the existing `addPedestalSculpture` function as
a model — replace the `TorusKnotGeometry` with a `gltfLoader.load()` call.

## Performance checklist

- [ ] Total page weight under ~30 MB on first load (otherwise mobile users
      will leave before the menu finishes loading)
- [ ] Room model under 100k triangles
- [ ] Textures compressed (KTX2 or at minimum aggressive JPEG)
- [ ] Lighting baked in Blender; minimal real-time lights
- [ ] Test on a mid-range phone, not just your laptop

## Controls

**Desktop:** WASD / arrow keys to move, mouse to look, **E** to interact,
**Esc** to release the cursor or close a modal.

**Mobile:** virtual joystick (bottom-left) to walk, drag the right side of
the screen to look, the **E** button to interact.

## License

Use freely for your own portfolio. The Three.js library is MIT-licensed.
