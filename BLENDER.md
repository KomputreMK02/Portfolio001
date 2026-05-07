# Blender Cheatsheet — Building the Gallery Room

A short reference for modeling your portfolio room so it drops into the
Three.js scene cleanly.

## Scale & units

- **1 Blender unit = 1 meter** in Three.js. Set `Scene → Units → Metric`
  and keep all dimensions in meters.
- Player **eye height**: 1.7 m. Use a 1.7 m reference cube as a stand-in
  while you model so you can sanity-check ceilings and doorways.
- Player **collision radius**: ~0.4 m. Doorways narrower than ~0.9 m will
  feel claustrophobic and likely block passage with the current collider.
- Comfortable ceiling: 3–4 m. Anything lower feels oppressive in first-person.

## The player's perspective

The camera spawns at world origin `(0, 1.7, 5)` and looks toward `-Z`. So
make sure:

- `(0, 0, 0)` lands somewhere walkable inside your room.
- `+Z` is the direction the player is facing on spawn — put your "hero"
  artwork on the back wall facing them.

## Geometry rules

- **Triangulate before exporting** if you can — `Ctrl+T` in edit mode, or
  enable "Triangulate Faces" in the export settings. Avoids n-gon weirdness.
- Keep total triangle count **under 100k** for the room. Browsers on phones
  start to suffer past that.
- **Normals point outward** — `Mesh → Normals → Recalculate Outside` (or
  `Shift+N` in edit mode). Inside-out faces render invisible from the
  player's side.
- **No internal geometry the player won't see.** Delete the bottom of the
  floor, the back of the walls, etc. Saves polys.
- **Apply all transforms** before export — `Object → Apply → All Transforms`.
  Otherwise scale and rotation may get baked weirdly.

## Naming convention (matters for the code)

Name objects in Blender with these prefixes — the JS can find them by name:

- `wall_*`, `floor_*`, `ceiling_*` — anything with these prefixes will be
  treated as a **collidable** (player can't walk through).
- `frame_01`, `frame_02`, … — empties at the position/rotation where you
  want a framed image to appear. JS attaches the image at the empty's
  transform.
- `video_01`, … — same idea for video frames.
- `pedestal_01`, … — placement for 3D sculptures.
- `decor_*`, `prop_*` — anything else, no special handling.

(Just tell me what naming you used after you export and I'll wire up the
loader to read those names.)

## Materials & textures

- Use the **Principled BSDF** shader. It's the only thing glTF reliably
  exports. Skip Mix Shaders, Glass BSDF, etc.
- **Texture sizes**: 2048×2048 max for walls/floors, 1024×1024 for props.
  Anything larger is a waste — the screen can't show that detail anyway.
- Use **JPG** for color textures, **PNG** only for transparency. JPG is
  ~10× smaller than PNG for the same visual quality.
- **UV unwrap** everything: select all in edit mode, `U → Smart UV Project`
  for a fast result, or do it manually for the showpieces.
- Keep textures in a single folder; use **relative paths** in the texture
  Image Editor before exporting.

## Lighting — bake it

This is the biggest single quality-vs-performance win.

- Set up your lights in Cycles (Sun, Area, Point lights for accents).
- Add a second UV map called `Lightmap` to your room mesh, unwrap with
  `U → Lightmap Pack`.
- **Bake** to a 1024×1024 image: `Render → Bake → Combined` (or just
  `Indirect` + `Ambient Occlusion` if you want lights to remain dynamic).
- Hook the baked image into the Principled BSDF base color, or as an extra
  texture multiplied into it.
- Now you can delete or hide the lights — the look is baked in. The room
  renders almost free in the browser.

If you skip baking, the placeholder real-time directional light in the
code will do — just expect flatter, less atmospheric results.

## Pre-export checklist

- [ ] All transforms applied (`Object → Apply → All Transforms`)
- [ ] All modifiers either applied, or "Apply Modifiers" enabled in export
- [ ] Normals recalculated outside (`Shift+N`)
- [ ] No hidden objects you forgot about (toggle with `Alt+H` to check)
- [ ] Textures saved as external files, not packed into the .blend
- [ ] Lights baked (or removed) if you're doing baked lighting
- [ ] Scene origin is somewhere the player should be standing

## Export settings

`File → Export → glTF 2.0 (.glb)`

- **Format**: glTF Binary (.glb) — single file, smaller
- **Include**: Selected Objects (if you only want the room)
- **Transform**: leave at default
- **Geometry → Compression**: ✅ Draco (huge size win, no quality loss)
- **Geometry → Apply Modifiers**: ✅
- **Geometry → UVs / Normals / Tangents**: ✅
- **Materials**: Export
- **Animation**: only tick if you have animated geometry (rotating doors etc.)

Save as `assets/room.glb` in this repo and tell me you've added it — I'll
swap the placeholder room for your model in `main.js`.

## Common gotchas

- **The room renders but the player falls through the floor.** Your floor
  mesh isn't named `floor_*`, so the JS isn't treating it as collidable.
- **Walls invisible from inside.** Normals are flipped — recalculate outside,
  or in some cases recalculate *inside* if the room is enclosed and you
  modeled it as a single closed mesh.
- **Textures missing in browser, fine in Blender.** Texture paths got baked
  in absolute. Re-link as relative before exporting.
- **File is huge (50+ MB).** You forgot Draco compression, and/or your
  textures are 4K. Both fixable with the export settings above.
- **Everything is white.** No materials assigned, or you used a non-Principled
  shader. Switch to Principled BSDF.

## Useful shortcuts

| Shortcut       | What it does                                      |
| -------------- | ------------------------------------------------- |
| `Tab`          | Toggle edit / object mode                         |
| `N`            | Toggle the right-side properties panel            |
| `Numpad 1/3/7` | Front / side / top view                           |
| `Numpad 5`     | Toggle ortho / perspective                        |
| `Shift+A`      | Add menu (objects, empties, lights, …)            |
| `Shift+N`      | Recalculate normals outside (in edit mode)        |
| `Ctrl+J`       | Join selected objects into one                    |
| `Ctrl+A`       | Apply transform menu                              |
| `U`            | UV unwrap menu (in edit mode)                     |
| `Z`            | Toggle solid / wireframe / material / rendered    |
