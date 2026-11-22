"""Build the shared set and animate the supplied forklift and road-worker rigs."""

import math
from pathlib import Path

import bpy
from mathutils import Vector

from scenarios import CAMERAS, DWELL, FPS, LOOKALIKE, TRANSFER, ZONES, pallet_position, position

ASSETS = Path(__file__).resolve().parents[2] / 'assets'


class Warehouse:
    def __init__(self, width, height, engine):
        bpy.ops.wm.read_factory_settings(use_empty=True)
        self.scene = bpy.context.scene
        self.scene.render.engine = engine
        self.scene.render.resolution_x = width
        self.scene.render.resolution_y = height
        self.scene.render.resolution_percentage = 100
        self.scene.render.fps = FPS
        self.scene.render.image_settings.file_format = 'PNG'
        self.scene.render.image_settings.color_mode = 'RGB'
        self.scene.render.image_settings.compression = 12
        self.scene.render.use_persistent_data = True
        self.scene.view_settings.view_transform = 'AgX' if engine == 'BLENDER_EEVEE' else 'Standard'
        self.scene.view_settings.exposure = .7 if engine == 'BLENDER_WORKBENCH' else 0
        shading = self.scene.display.shading
        shading.color_type = 'TEXTURE'
        shading.light = 'STUDIO'
        shading.show_shadows = True
        shading.show_cavity = True
        shading.cavity_type = 'WORLD'
        shading.background_type = 'WORLD'
        self.scene.display.render_aa = 'FXAA'
        if engine == 'BLENDER_EEVEE':
            self.scene.eevee.taa_render_samples = 12

        self.asset('warehouse-v2', 'Warehouse')
        for x in (-12.5, -3.2, 6.1):
            self.asset('steel-pallet-rack-v1', f'Rack {x}', (x, 7.6, 0))
        for x, y in ((-13.9, 6.4), (-9.7, 6.4), (4.9, 6.4), (12.9, 6.4)):
            self.asset('wrapped-pallet-load-v1', f'Stored load {x}', (x, y, 0))
        self.asset('tool-chest-bench-v1', 'Packing bench', (-11.8, -4.9, 0))
        self.asset('blue-hand-trolley-v1', 'Hand trolley', (-11, -4.6, 0))
        for x, y in ((-6.8, -2.25), (5.8, -2.25), (11.8, -2.25)):
            self.asset('traffic-cone-v1', f'Cone {x}', (x, y, 0))
        self.asset('steel-drum-v1', 'Dispatch drum', (13.3, 5.3, 0))
        self.asset('semi-truck-v1', 'Parked trailer', (16.8, 1.5, 0))

        safety = material('Safety yellow', (.96, .61, .035))
        white = material('Painted letters', (.93, .91, .78))
        box_material = material('Kraft carton', (.36, .17, .063))
        tape = material('Carton tape', (.68, .43, .21))
        for name in ('staging', 'loading-zone'):
            left, near, right, far = ZONES[name]
            for y in (near, far):
                cube(f'{name} stripe', ((left + right) / 2, y, .024), (right - left, .07, .012), safety)
            for x in (left, right):
                cube(f'{name} stripe', (x, (near + far) / 2, .024), (.07, far - near, .012), safety)
            label(name.replace('-', ' ').upper(), (left + .25, near + .23, .035), white)
        for x in (-5, -3, -1, 1, 3, 5):
            cube('Aisle stripe', (x, -1.5, .026), (1.25, .09, .012), safety)

        self.cameras = {}
        for name, center, lens in zip(CAMERAS, (-9.6, 0, 9.6), (31, 29, 29)):
            data = bpy.data.cameras.new(name)
            data.lens = lens
            camera = bpy.data.objects.new(name, data)
            self.scene.collection.objects.link(camera)
            camera.location = (center, -7.6, 6.7)
            camera.rotation_euler = (Vector((center, 1, 0)) - camera.location).to_track_quat('-Z', 'Y').to_euler()
            self.cameras[name] = camera
        world = bpy.data.worlds.new('Warehouse ambient')
        world.color = (.16, .16, .16)
        world.use_nodes = True
        world.node_tree.nodes['Background'].inputs['Strength'].default_value = .32
        self.scene.world = world
        for x in (-15, -7.5, 0, 7.5, 15):
            for y in (-3, 5):
                data = bpy.data.lights.new('High bay', 'AREA')
                data.energy = 1300
                data.shape = 'DISK'
                data.size = 4.3
                lamp = bpy.data.objects.new('High bay', data)
                lamp.location = (x, y, 7.9)
                self.scene.collection.objects.link(lamp)

        self.forklifts = [self.asset('forklift-v1', name) for name in ('F1', 'F2')]
        self.carriages = [next(item for item in root.children_recursive if item.name.split('.')[0] == 'carriage')
                          for root in self.forklifts]
        self.carriage_rest = [carriage.location.copy() for carriage in self.carriages]
        self.lift_axes = [carriage.parent.matrix_world.to_3x3().inverted() @ Vector((0, 0, 1))
                          for carriage in self.carriages]
        self.pallets = [self.asset('wrapped-pallet-load-v1', name) for name in ('P1', 'P2')]
        self.worker = self.asset('road-worker-v1', 'W1')
        self.carton = cube('B1', (0, 0, 0), (.48, .23, .3), box_material)
        self.carton.parent = self.worker
        tape_strip = cube('Carton seam', (0, 0, .151), (.055, .23, .004), tape)
        tape_strip.parent = self.carton
        self.rig = next(item for item in self.worker.children if item.type == 'ARMATURE')
        self.setup_carry()

    def asset(self, filename, instance, location=(0, 0, 0), heading=0):
        before = set(bpy.data.objects)
        glb = ASSETS / f'{filename}-lod0.glb'
        bpy.ops.import_scene.gltf(filepath=str(glb))
        imported = set(bpy.data.objects) - before
        root = bpy.data.objects.new(instance, None)
        self.scene.collection.objects.link(root)
        for item in imported:
            # The importer creates an unlinked mesh as a bone-shape widget.
            if item.users_collection and not item.parent:
                item.parent = root
        root.location = location
        root.rotation_euler.z = heading
        bpy.context.view_layer.update()
        return root

    def setup_carry(self):
        animation = self.rig.animation_data
        walk = bpy.data.actions['walk'].copy()
        walk.name = 'Two-handed carton carry'
        for track in list(animation.nla_tracks):
            animation.nla_tracks.remove(track)
        animation.action = walk
        channelbag = walk.layers[0].strips[0].channelbag(animation.action_slot)
        arms = ('shoulder_', 'upperarm_', 'forearm_', 'hand_')
        for curve in list(channelbag.fcurves):
            if any(f'["{prefix}' in curve.data_path for prefix in arms):
                channelbag.fcurves.remove(curve)
        self.carry_bones = {}
        # Target elbow and wrist positions in armature space. Retarget the walk's
        # arm swing into a two-handed grip while keeping its hips and footfall.
        for side, sign in (('L', 1), ('R', -1)):
            for part, start, end in (
                ('upperarm', (.19, .01, 1.48), (.25, -.13, 1.21)),
                ('forearm', (.25, -.13, 1.21), (.23, -.39, 1.17)),
                ('hand', (.23, -.39, 1.17), (.22, -.47, 1.18)),
            ):
                bone = self.rig.pose.bones[f'{part}_{side}']
                direction = Vector(((end[0] - start[0]) * sign, end[1] - start[1], end[2] - start[2]))
                self.carry_bones[bone.name] = direction.normalized()

    def pose(self, scenario, second):
        dwell = scenario.get('dwell', False)
        two = scenario.get('second_forklift', False)
        for i, (forklift, carriage, pallet, path) in enumerate(
            zip(self.forklifts, self.carriages, self.pallets, (DWELL if dwell else TRANSFER, LOOKALIKE))
        ):
            visible(forklift, i == 0 or two)
            visible(pallet, not dwell and (i == 0 or two))
            x, y, lift = position(path, second)
            forklift.location = (x, y, .018)
            forklift.rotation_euler.z = math.pi / 2
            carriage.location = self.carriage_rest[i] + self.lift_axes[i] * lift
            pallet.location = Vector(pallet_position(path, second, i == 1)) + Vector((0, 0, .023))
            pallet.rotation_euler.z = math.pi / 2

        worker_in_scene = not dwell and second < 9.5
        visible(self.worker, worker_in_scene)
        if worker_in_scene:
            # The worker exits through the foreground, clear of the forklift lane.
            forward = min(second, 6.2)
            turn = min(max(second - 6.2, 0), 1)
            self.worker.location = (-12.6 + 1.22 * forward + .6 * turn, -3.1 - 1.22 * max(second - 6.2, 0), .02)
            self.worker.rotation_euler.z = (1 - turn) * math.pi / 2
            walk_frame = 1 + (second % 1) * FPS
            self.scene.frame_set(int(walk_frame), subframe=walk_frame % 1)
            bpy.context.view_layer.update()
            for name, direction in self.carry_bones.items():
                bone = self.rig.pose.bones[name]
                matrix = bone.matrix.copy()
                current = matrix.to_3x3() @ Vector((0, 1, 0))
                rotation = current.normalized().rotation_difference(direction)
                target = rotation.to_matrix().to_4x4() @ matrix
                target.translation = matrix.translation
                bone.matrix = target
                bpy.context.view_layer.update()
            hands = [self.rig.pose.bones[f'hand_{side}'].head for side in ('L', 'R')]
            middle = sum(hands, Vector()) / 2
            self.carton.location = middle + Vector((0, -.12, .07))
        bpy.context.view_layer.update()


def visible(root, show):
    if root.hide_render != (not show):
        for part in (root, *root.children_recursive):
            part.hide_render = not show


def material(name, rgb):
    result = bpy.data.materials.new(name)
    result.diffuse_color = (*rgb, 1)
    return result


def cube(name, location, size, surface):
    bpy.ops.mesh.primitive_cube_add(size=1, location=location)
    obj = bpy.context.object
    obj.name = name
    obj.dimensions = size
    obj.data.materials.append(surface)
    return obj


def label(value, location, surface):
    text = bpy.data.curves.new(value, 'FONT')
    text.body = value
    text.size = .41
    obj = bpy.data.objects.new(value, text)
    bpy.context.scene.collection.objects.link(obj)
    obj.location = location
    obj.data.materials.append(surface)
