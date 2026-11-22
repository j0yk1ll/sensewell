"""Run with Blender in background mode. See docs/warehouse-demo.md."""

import argparse
import json
from pathlib import Path
from shutil import copyfile
import subprocess
import sys
from tempfile import TemporaryDirectory

import bpy
from bpy_extras.object_utils import world_to_camera_view
from mathutils import Vector

sys.path.insert(0, str(Path(__file__).resolve().parent))
from scenarios import CAMERAS, DWELL, FPS, LOOKALIKE, PALLET_OFFSET, PEDESTRIAN_ZONE, SCENARIOS, TRANSFER, ZONES, coverage_missing, reference
from scene import Warehouse


def calibration(setup, camera, width, height, floor_zones):
    project = camera.calc_matrix_camera(bpy.context.evaluated_depsgraph_get(), x=width, y=height)
    project = project @ camera.matrix_world.inverted()
    x, y, _, w = project
    homography = [[row[i] for i in (0, 1, 3)] for row in ((x + w) / 2, (w - y) / 2, w)]
    zones = {}
    for name, (left, near, right, far) in floor_zones.items():
        points = [(left, near), (right, near), (right, far), (left, far)]
        projected = [world_to_camera_view(setup.scene, camera, Vector((*p, 0))) for p in points]
        if all(0 <= p.x <= 1 and 0 <= p.y <= 1 and p.z > 0 for p in projected):
            zones[name] = [{'x': p.x, 'y': 1 - p.y} for p in projected]
    return dict(floorToImage=homography, zones=zones)


def render_still(setup, camera, scenario, second, output):
    setup.pose(scenario, second)
    setup.scene.camera = setup.cameras[camera]
    setup.scene.render.filepath = str(output)
    bpy.ops.render.render(write_still=True)


def run_ffmpeg(*args):
    subprocess.run(['ffmpeg', '-nostdin', '-v', 'error', '-y', *args], check=True)


def black_frame(work, width, height):
    image = work / 'coverage-gap.png'
    if not image.exists():
        run_ffmpeg('-f', 'lavfi', '-i', f'color=c=black:s={width}x{height}',
                   '-frames:v', '1', '-threads', '1', str(image))
    return image


def pose_frame(scenario, frame):
    if scenario.get('dwell'):
        for (start, location), (end, next_location) in zip(DWELL, DWELL[1:]):
            if location == next_location and start * FPS <= frame <= end * FPS:
                return start * FPS
        return min(frame, DWELL[-1][0] * FPS)
    end = max(TRANSFER[-1][0], LOOKALIKE[-1][0]) if scenario.get('second_forklift') else TRANSFER[-1][0]
    return min(frame, end * FPS)


def render_recordings(setup, name, scenario, output, work, width, height, cameras):
    output.mkdir(parents=True, exist_ok=True)
    refs = reference(name, scenario)
    frames = scenario['duration'] * FPS
    floor_zones = {**ZONES, **PEDESTRIAN_ZONE} if scenario.get('ground_position') else ZONES
    manifest = dict(
        version=1, scenario=name, fps=FPS, durationMs=scenario['duration'] * 1000,
        imageSize=dict(width=width, height=height), zones=floor_zones, cameras={}, **refs,
    )
    manifest['choreography'] = {'F1': DWELL if scenario.get('dwell') else TRANSFER}
    if scenario.get('second_forklift'):
        manifest['choreography']['F2'] = LOOKALIKE
    if not scenario.get('dwell'):
        manifest['palletOffsetM'] = PALLET_OFFSET
    family = 'dwell' if scenario.get('dwell') else 'two' if scenario.get('second_forklift') else 'one'
    if scenario.get('ground_position'):
        family = 'ground-position'
        manifest['ankles'] = []
        for frame in range(frames):
            setup.pose(scenario, frame / FPS)
            ankles = [setup.rig.matrix_world @ setup.rig.pose.bones[f'foot_{side}'].head for side in ('L', 'R')]
            manifest['ankles'].append([list(ankle.xy) for ankle in ankles])
    for camera in cameras:
        filename = f'{camera}.mp4'
        manifest['cameras'][camera] = dict(file=filename, **calibration(setup, setup.cameras[camera], width, height, floor_zones))
        sequence = []
        for frame in range(frames):
            if coverage_missing(scenario, camera, frame / FPS):
                image = black_frame(work, width, height)
            else:
                # Reuse still frames for long stationary intervals and between
                # variants whose underlying scene is identical.
                pose = pose_frame(scenario, frame)
                image = work / f'{family}-{camera}-{pose:04}.png'
                if not image.exists():
                    render_still(setup, camera, scenario, pose / FPS, image)
            sequence.append(image)
        playlist = work / 'frames.ffconcat'
        # Consecutive frames with the same render can use one timestamped still.
        with playlist.open('w') as file:
            file.write('ffconcat version 1.0\n')
            first = 0
            while first < frames:
                last = first + 1
                while last < frames and sequence[last] == sequence[first]:
                    last += 1
                file.write(f'file {sequence[first].name}\noption framerate {FPS}\nduration {(last-first)/FPS:.1f}\n')
                first = last
            file.write(f'file {sequence[-1].name}\noption framerate {FPS}\n')
        run_ffmpeg('-f', 'concat', '-safe', '0', '-i', str(playlist),
                   '-vf', f'fps={FPS}', '-frames:v', str(frames),
                   '-c:v', 'libx264', '-preset', 'fast', '-crf', '19', '-pix_fmt', 'yuv420p',
                   '-threads', '4', '-movflags', '+faststart', str(output / filename))
    (output / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=Path('warehouse-fixtures'))
    parser.add_argument('--camera', choices=CAMERAS, action='append')
    parser.add_argument('--scenario', choices=SCENARIOS, action='append')
    parser.add_argument('--width', type=int, default=960)
    parser.add_argument('--height', type=int, default=540)
    parser.add_argument('--engine', choices=('BLENDER_WORKBENCH', 'BLENDER_EEVEE'), default='BLENDER_WORKBENCH')
    parser.add_argument('--still', type=float, action='append', help='Render preview PNGs at these seconds')
    args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else [])
    if any(n < 2 or n % 2 for n in (args.width, args.height)):
        parser.error('The image width and height must be positive even integers.')
    with TemporaryDirectory(prefix='sensewell-warehouse-') as directory:
        work = Path(directory)
        setup = Warehouse(args.width, args.height, args.engine)
        for name in args.scenario or SCENARIOS:
            scenario = SCENARIOS[name]
            output = (args.output / name).resolve()
            if args.still:
                output.mkdir(parents=True, exist_ok=True)
                for second in args.still:
                    if not 0 <= second < scenario['duration']:
                        parser.error(f'The preview time is outside {name}.')
                    for camera in args.camera or CAMERAS:
                        path = output / f'{camera}-{second:g}s.png'
                        if coverage_missing(scenario, camera, second):
                            copyfile(black_frame(work, args.width, args.height), path)
                        else:
                            render_still(setup, camera, scenario, second, path)
            else:
                render_recordings(setup, name, scenario, output, work, args.width, args.height, args.camera or CAMERAS)


if __name__ == '__main__':
    main()
