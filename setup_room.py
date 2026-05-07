"""
setup_room.py
=============
Run this script inside Blender to generate a starter portfolio room
that matches the dimensions, spawn point, and artwork positions used
in the Three.js code (main.js).

HOW TO USE
----------
1. Open Blender (any recent 3.x or 4.x version).
2. Click the "Scripting" workspace tab at the top of Blender.
3. In the script editor on the left side, click Text → Open and select
   this file.
4. Click "Run Script" (or press Alt+P with the cursor in the editor).
5. The default scene is wiped and the starter room is built.
6. File → Save As → save next to main.js as `assets/room.blend` (and
   later File → Export → glTF 2.0 to produce `assets/room.glb`).

WHAT YOU GET
------------
- A 14 × 14 × 4 m room, floor at y=0, walls properly named (`wall_back`,
  `wall_front`, `wall_left`, `wall_right`, `floor_main`, `ceiling_main`).
  These names are how the JS will know what to treat as collidable.
- Empty objects at the artwork positions used in main.js, named so the
  loader can find them (`frame_01..03`, `video_01`, `pedestal_01`).
- A 1.7 m human-height reference cube standing near the spawn point so
  you can sanity-check ceiling heights and doorway widths as you model.
- A camera placed at the player spawn point so you can preview what the
  player sees on load (View → Cameras → Active Camera, then Numpad 0).
- Basic Principled BSDF materials (white walls, warm wood floor) so the
  scene isn't all default grey.
- Metric units, 1 unit = 1 m, scene scale = 1.
- A sun light with sensible defaults — replace with your own setup
  before baking.
"""

import bpy
import math
from mathutils import Vector, Euler

# ---------- Constants (must match main.js) ----------
ROOM_SIZE   = 14.0
WALL_HEIGHT = 4.0
HALF        = ROOM_SIZE / 2.0
SPAWN       = Vector((0.0, 1.7, 5.0))   # NOTE: Blender uses Z-up; we'll
                                         # convert below.

# Artwork positions in Three.js coordinates. Three.js is Y-up.
# Blender is Z-up. We transform: (x, y, z)_threejs -> (x, -z, y)_blender
THREEJS_TO_BLENDER = lambda v: Vector((v.x, -v.z, v.y))

# Three.js Y-rotations in degrees (around the up axis)
ARTWORKS = [
    # name,        x,    y_eye, z,        rotY_deg
    ("frame_01",  -3.0,  1.9,  -HALF + 0.1,  0),
    ("frame_02",   3.0,  1.9,  -HALF + 0.1,  0),
    ("frame_03",  -HALF + 0.1, 1.9, 0,      90),
    ("video_01",   HALF - 0.1, 1.9, 0,     -90),
    ("pedestal_01", 0.0, 0.0,  0.0,          0),
]


# ---------- Helpers ----------
def clear_scene():
    """Wipe the default scene completely."""
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete(use_global=False)
    # also nuke orphan data
    for coll in (bpy.data.meshes, bpy.data.materials, bpy.data.lights,
                 bpy.data.cameras, bpy.data.images):
        for block in list(coll):
            if block.users == 0:
                coll.remove(block)


def make_material(name, rgba, roughness=0.8, metallic=0.0):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = rgba
    # Blender 4.x renamed some sockets; handle both
    for key in ("Roughness",):
        if key in bsdf.inputs:
            bsdf.inputs[key].default_value = roughness
    for key in ("Metallic",):
        if key in bsdf.inputs:
            bsdf.inputs[key].default_value = metallic
    return mat


def make_plane(name, width, height, location, rotation_euler, material=None):
    """A plane sized width×height (X × Y in local space). Located at
    `location` (Blender world coords) with the given Euler rotation.
    """
    bpy.ops.mesh.primitive_plane_add(size=1.0, location=location)
    obj = bpy.context.active_object
    obj.name = name
    obj.scale = (width, height, 1.0)
    obj.rotation_euler = rotation_euler
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    if material:
        obj.data.materials.append(material)
    return obj


def make_empty(name, location, rotation_euler):
    bpy.ops.object.empty_add(type='ARROWS', location=location)
    e = bpy.context.active_object
    e.name = name
    e.empty_display_size = 0.5
    e.rotation_euler = rotation_euler
    return e


# ---------- Build ----------
def build():
    clear_scene()

    # Scene units → metric, 1 unit = 1 meter
    scn = bpy.context.scene
    scn.unit_settings.system = 'METRIC'
    scn.unit_settings.scale_length = 1.0

    # Materials
    mat_floor   = make_material("Floor",   (0.42, 0.34, 0.22, 1.0), roughness=0.9)
    mat_wall    = make_material("Wall",    (0.94, 0.92, 0.89, 1.0), roughness=0.8)
    mat_ceiling = make_material("Ceiling", (0.93, 0.93, 0.93, 1.0), roughness=0.95)
    mat_pedestal= make_material("Pedestal",(0.10, 0.10, 0.10, 1.0), roughness=0.4)

    # Floor (Z=0 in Blender, room footprint ROOM_SIZE × ROOM_SIZE)
    floor = make_plane(
        "floor_main",
        ROOM_SIZE, ROOM_SIZE,
        location=(0, 0, 0),
        rotation_euler=Euler((0, 0, 0)),
        material=mat_floor,
    )

    # Ceiling
    ceiling = make_plane(
        "ceiling_main",
        ROOM_SIZE, ROOM_SIZE,
        location=(0, 0, WALL_HEIGHT),
        rotation_euler=Euler((math.pi, 0, 0)),  # face downward
        material=mat_ceiling,
    )

    # Walls (planes facing inward). In Blender Z-up:
    #   wall facing +Y is at y=-HALF, normal pointing toward +Y → rotate X by 90°
    #   wall facing -Y is at y=+HALF, normal pointing toward -Y → rotate X by -90°
    #   wall facing +X is at x=-HALF, normal toward +X → rotate Y by -90°
    #   wall facing -X is at x=+HALF, normal toward -X → rotate Y by 90°
    walls = [
        ("wall_back",   (0, -HALF, WALL_HEIGHT/2), Euler(( math.pi/2, 0, 0))),
        ("wall_front",  (0,  HALF, WALL_HEIGHT/2), Euler((-math.pi/2, 0, 0))),
        ("wall_left",   (-HALF, 0, WALL_HEIGHT/2), Euler((0, -math.pi/2, 0))),
        ("wall_right",  ( HALF, 0, WALL_HEIGHT/2), Euler((0,  math.pi/2, 0))),
    ]
    for name, loc, rot in walls:
        make_plane(name, ROOM_SIZE, WALL_HEIGHT, location=loc,
                   rotation_euler=rot, material=mat_wall)

    # Artwork anchor empties
    for name, x, y_eye, z, rot_y_deg in ARTWORKS:
        # Three.js (x, y_eye, z) -> Blender (x, -z, y_eye)
        loc = Vector((x, -z, y_eye))
        # Three.js Y-rotation = Blender Z-rotation (both are "up axis")
        rot = Euler((0, 0, math.radians(rot_y_deg)))
        e = make_empty(name, loc, rot)
        # Visualize image frames as a wire rectangle
        if name.startswith("frame_") or name.startswith("video_"):
            e.empty_display_type = 'IMAGE'
            e.empty_display_size = 1.5
        elif name.startswith("pedestal_"):
            e.empty_display_type = 'PLAIN_AXES'
            e.empty_display_size = 0.6

    # Reference human (1.7 m tall cube standing on the floor)
    bpy.ops.mesh.primitive_cube_add(size=1.0, location=(2, -3, 0.85))
    ref = bpy.context.active_object
    ref.name = "reference_human"
    ref.scale = (0.5, 0.3, 1.7)  # roughly torso-shaped, 1.7 m tall
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    ref.display_type = 'WIRE'  # don't render, just for reference

    # Camera at the player spawn point, looking down -Z (Three.js)
    # In Blender that's looking toward -Y. Camera default points -Z (Blender),
    # so we rotate it 90° around X to make it look -Y.
    bpy.ops.object.camera_add(
        location=(SPAWN.x, -SPAWN.z, SPAWN.y),
        rotation=(math.pi/2, 0, 0),
    )
    cam = bpy.context.active_object
    cam.name = "PlayerCamera"
    cam.data.lens = 28  # ~70° FOV, matches main.js
    scn.camera = cam

    # Sun light
    bpy.ops.object.light_add(type='SUN', location=(4, -4, 8))
    sun = bpy.context.active_object
    sun.name = "Sun"
    sun.data.energy = 3.0
    sun.rotation_euler = Euler((math.radians(45), 0, math.radians(45)))

    # Frame the room in the viewport
    for area in bpy.context.screen.areas:
        if area.type == 'VIEW_3D':
            for region in area.regions:
                if region.type == 'WINDOW':
                    with bpy.context.temp_override(area=area, region=region):
                        bpy.ops.view3d.view_all(center=False)
            break

    print("[setup_room] Built starter room successfully.")
    print("[setup_room] Save as assets/room.blend, then export glTF to assets/room.glb.")


if __name__ == "__main__":
    build()
