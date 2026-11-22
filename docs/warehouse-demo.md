# Three-camera warehouse demo

The Blender fixture uses fixed staging, transfer-aisle, and dispatch cameras. Each scenario produces three H.264 MP4s at 10 fps. The clips start at source time zero and play at 1×. The road worker uses the supplied walk cycle with a retargeted two-handed carton carry. A separate pedestrian route keeps the worker clear of the forklift lane.

## Run the warehouse as IP cameras

Start the regular Sensewell stack. Then start the optional warehouse services from the same repository and Compose project.

```sh
docker compose up -d --build
docker compose -f compose.yaml -f compose.warehouse.yaml up -d --build warehouse-sim
```

The image includes the Blender-rendered 24-second transfer. It loops at 1× and publishes all three views from a shared clock over RTSP/TCP.

To render scene edits or pick a different scenario entirely in Docker, select the render target and rebuild. This target uses the Linux x86-64 Blender release and software rendering, so the first build takes longer. Use a scenario name from the table below.

```sh
WAREHOUSE_IMAGE_TARGET=simulator-rendered WAREHOUSE_SCENARIO=supported-handoff \
  docker compose -f compose.yaml -f compose.warehouse.yaml up -d --build warehouse-sim
```

In Sensewell, approve `warehouse-rtsp:8554` once in **Camera endpoints**, then add each of these as an **IP camera**. Leave the username and password blank. See the [IP camera setup](../README.md#connect-and-record-an-ip-camera) for the administrator grant.

| Camera | RTSP URL for Sensewell in Compose |
| --- | --- |
| Staging | `rtsp://warehouse-rtsp:8554/staging` |
| Transfer aisle | `rtsp://warehouse-rtsp:8554/aisle` |
| Dispatch | `rtsp://warehouse-rtsp:8554/dispatch` |

The feeds use Sensewell's normal live IP camera preview and recording workflow. To inspect a feed from the host, use `ffplay -rtsp_transport tcp rtsp://127.0.0.1:8554/staging`. Set `WAREHOUSE_RTSP_PORT` before starting the simulator if host port 8554 is occupied. The Compose URLs above keep port 8554.

Stop the simulator and RTSP server with this command. Sensewell remains running and retains recorded footage.

```sh
docker compose -f compose.yaml -f compose.warehouse.yaml stop warehouse-sim warehouse-rtsp
```

## Generate the recordings

Install Blender 5.2 or later and FFmpeg with `libx264`. Blender loads the GLBs in `assets/` directly. Their textures are embedded PNGs. [Asset provenance](../assets/README.md)

From the repository root, render all five fixture variants.

```sh
blender -b -t 6 --python-exit-code 1 -P scripts/warehouse-demo/render.py -- --output warehouse-fixtures
```

Use `--scenario transfer` to render a single variant. Add `--still 6 --still 10 --still 18` for previews at selected source times. Output defaults to 960 × 540. The default Workbench renderer reuses stills for the stationary part of the dwell and across variants that share the same choreography. Use `--engine BLENDER_EEVEE` for higher-quality lighting at a longer render time.

After rendering the transfer, regenerate the bundled RTSP loop with:

```sh
sh scripts/warehouse-demo/container/pack-cameras.sh warehouse-fixtures/transfer \
  scripts/warehouse-demo/container/transfer.mp4
```

| Fixture | Reference occurrence | Expected conclusion from available evidence |
| --- | --- | --- |
| `transfer` | Forklift F1 lifts pallet P1 at 00:06 and sets it down at 00:18 | Normal transfer from staging to dispatch |
| `supported-handoff` | F1 delivers P1 while a second identical-looking forklift carries a lookalike load | The aisle view bridges the staging and dispatch views and supports the F1 → F1 link |
| `ambiguous-handoff` | Same choreography with aisle coverage absent from 00:09 to 00:18 | The two loaded forklifts enter the blind interval and either could have emerged at dispatch. The link is undecided |
| `dwell` | F1 enters the loading zone at 00:04, reaches five minutes at 05:04, and leaves at 05:14 | One continuous qualifying occurrence |
| `dwell-gap` | Same dwell with dispatch coverage absent from 02:35 to 03:05 | Continuous presence is undecided. The other cameras cannot establish it |

Inspect the transfer around 00:09–00:10 in staging and aisle, and around 00:15–00:16 in aisle and dispatch. The edge views show parts of the same forklift and load during the overlaps. The aisle sees both midway through the handoff. At 00:23, dispatch shows the pallet on the floor after the forklift has backed away.

## Import and replay through Sensewell

Start Sensewell and its detector using the [local setup](../README.md). Create an account in the app first. The presenter script needs Node.js 24 and signs in with that account. Set `SENSEWELL_URL` if the app uses a different origin.

```sh
export SENSEWELL_EMAIL=you@example.com
read -rs -p 'Sensewell password: ' SENSEWELL_PASSWORD
export SENSEWELL_PASSWORD

node scripts/warehouse-demo/replay.mjs import warehouse-fixtures/transfer
node scripts/warehouse-demo/replay.mjs play warehouse-fixtures/transfer
```

Import uploads the clips as Synthetic Cameras, saves zones whose four corners are fully visible, and writes the camera IDs into `replay-cameras.json` beside the fixture manifest. To use regenerated footage, render into a fresh directory and import it there. Repeat the same commands with another fixture directory to switch scenarios.

One `play` starts all three cameras on the same source clock with a 2.5-second analysis buffer. It prints the run and pass IDs, followed by per-camera source time, most recent analyzed source time, displayed-frame analysis status, and analyzed-frame count. Open the three imported Synthetic Cameras in separate visible browser windows to watch the running views and detection overlays together. Use Ctrl+C to stop all three, or run `stop` with the same fixture directory and profile from another terminal.

## Exercise the analysis buffer

The fault profiles use a 30-second analysis buffer. The delay profile holds back the aisle input to the detector by 42 seconds and plays it at 1× when it arrives. Staging and dispatch continue to publish on their original schedule. The first delayed bridge frame, source 00:09, is scheduled for publication at about 00:53.500 elapsed. Its occurrence time stays tied to source 00:09. At about 00:48.500 elapsed the pickup and delivery views are available while the aisle bridge is still pending.

```sh
node scripts/warehouse-demo/replay.mjs import warehouse-fixtures/supported-handoff
node scripts/warehouse-demo/replay.mjs play warehouse-fixtures/supported-handoff delay

node scripts/warehouse-demo/replay.mjs import warehouse-fixtures/supported-handoff outage
node scripts/warehouse-demo/replay.mjs play warehouse-fixtures/supported-handoff outage
```

The outage profile selects the identically choreographed `ambiguous-handoff` footage. It marks aisle frames in `[9000, 18000)` milliseconds unavailable and creates no detector observations for them. Staging and dispatch continue across the same timestamps. The delay profile supplies late aisle evidence for revising an initially undecided handoff. The outage leaves the question undecided. The manifests specify these expected conclusions for use when implementing and testing finding revision. [Finding revision issue](https://github.com/j0yk1ll/sensewell/issues/30)

## Inspect and score the fixtures

Each scenario directory has a `manifest.json` with camera IDs and files, the shared frame rate and duration, floor-plan zones, fixture-only identities, event times, evidence windows, and coverage gaps. Reference annotations are for comparison with footage-derived results. The replay script only sends recordings, projected zone outlines, and fault timing to Sensewell.

- Floor points are in meters on Blender’s ground plane, with +X running from staging toward dispatch and +Y toward the racks. Each zone is a rectangle `[minX, minY, maxX, maxY]`. Each camera’s row-major `floorToImage` matrix multiplies `[X, Y, 1]`. Divide its first two outputs by the third to get normalized image coordinates from the top-left corner.
- Choreography entries give `[second, [X, Y, liftHeight]]` for each forklift. Interpolate linearly between entries. The F1 and P1 times in `groundTruth` apply across all views. For dwell, 05:04 is the exact five-minute boundary, so a strictly-greater rule can first qualify on the following 10 fps frame at 05:04.100.
- Compare the footage-derived result with `expected`, keeping camera and source times together. An unavailable interval carries missing coverage. A processed frame can also have zero detections. Real detector output depends on the model and available inference throughput.
- Use `ffprobe` to check stream timing and `ffmpeg -ss 10 -i aisle.mp4 -frames:v 1 aisle-10s.png` to inspect an exact source timestamp. The corresponding frame is index 100 in each 10 fps recording.

## Local verification

The 24-second transfer produced 35 saved detector observations on each camera, about 4.4 analyzed frames per second across the group, with a display lag of about 2.5 seconds. In the delay run, staging and dispatch stayed near 30 seconds of display lag and the aisle delivered 30 analyzed frames at source times in the handoff interval, roughly 44.5 seconds after occurrence. In the outage run, the aisle recorded zero observations during that interval and the other views recorded 17 each. The detector found forklifts in all three views and produced zero pallet classifications in these runs.
