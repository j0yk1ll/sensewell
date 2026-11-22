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

From the repository root, render the fixture variants.

```sh
blender -b -t 6 --python-exit-code 1 -P scripts/warehouse-demo/render.py -- --output warehouse-fixtures
```

To render just the normal transfer, run:

```sh
blender -b -t 6 --python-exit-code 1 -P scripts/warehouse-demo/render.py -- --scenario transfer --output warehouse-fixtures
```

This writes `staging.mp4`, `aisle.mp4`, `dispatch.mp4`, and `manifest.json` to `warehouse-fixtures/transfer/`. Each video starts at 00:00 and contains 240 frames at 10 fps over 24 seconds. Use `--still 6 --still 9 --still 18` to render preview PNGs at those times in place of the videos. Output defaults to 960 × 540. The default Workbench renderer reuses stills for the stationary part of the dwell and across variants that share the same choreography. Use `--engine BLENDER_EEVEE` for higher-quality lighting at a longer render time.

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
| `ground-position` | W1 walks through the pedestrian gate and behind a foreground carton | Visible ankles support crossings when there is enough continuous evidence. The carton can obscure ground contact |
| `dwell` | F1 enters the loading zone at 00:04, reaches five minutes at 05:04, and leaves at 05:14 | One continuous qualifying occurrence |
| `dwell-gap` | Same dwell with dispatch coverage absent from 02:35 to 03:05 | Continuous presence is undecided. The other cameras cannot establish it |

F1 picks up P1 in the staging zone, crosses the transfer aisle, and sets P1 down in the loading zone within dispatch. Staging and the transfer aisle meet at X = −5 m. The cameras overlap across that boundary so the staging view can still see part of the departing forklift as the aisle view picks up its front and load. The aisle and dispatch views overlap across X = 5 m in the same way.

Compare these zero-based frames in the `transfer` clips. The manifest uses `F1` for the forklift and `P1` for its pallet throughout.

| Source time | Frame | Views | What to verify |
| --- | ---: | --- | --- |
| 00:06 | 60 | Staging | F1 finishes lifting P1. Matches `groundTruth.pickupMs` (6000). |
| 00:09 | 90 | Staging and aisle | F1 is at X = −5.1 m with P1 raised. Staging shows the rear of F1 at the right edge. The aisle shows the front and P1 at the left edge. |
| 00:16 | 160 | Aisle and dispatch | F1 is at X = 5 m with P1 raised. The aisle shows F1 at the right edge, and dispatch shows F1 and P1 entering on the left. |
| 00:18 | 180 | Dispatch | F1 finishes lowering P1. Matches `groundTruth.deliveryMs` (18000). |
| 00:23 | 230 | Dispatch | P1 stays on the floor after F1 backs away. |

## Import and replay through Sensewell

Start Sensewell and its detector using the [local setup](../README.md). Create an account in the app first. The presenter script needs Node.js 24 and signs in with that account. Set `SENSEWELL_URL` if the app uses a different origin.

```sh
export SENSEWELL_EMAIL=you@example.com
read -rs -p 'Sensewell password: ' SENSEWELL_PASSWORD
export SENSEWELL_PASSWORD

node scripts/warehouse-demo/replay.mjs import warehouse-fixtures/transfer
node scripts/warehouse-demo/replay.mjs play warehouse-fixtures/transfer
```

Import uploads the clips as Synthetic Cameras, saves calibrated floor zones whose four corners are fully visible, and writes the camera IDs into `replay-cameras.json` beside the fixture manifest. To use regenerated footage, render into a fresh directory and import it there. Repeat the same commands with another fixture directory to switch scenarios.

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

Each scenario directory has a `manifest.json` with camera IDs and files, the shared frame rate and duration, floor-plan zones, fixture-only identities, event times, evidence windows, and coverage gaps. Reference annotations are for comparison with footage-derived results. The replay script sends recordings, calibration landmarks and floor zones, and fault timing to Sensewell. See the [ground-position benchmark](warehouse-ground-position.md) for setup, annotations, and results.

- Floor points are in meters on Blender’s ground plane, with +X running from staging toward dispatch and +Y toward the racks. Each zone is a rectangle `[minX, minY, maxX, maxY]`. Each camera’s row-major `floorToImage` matrix multiplies `[X, Y, 1]`. Divide its first two outputs by the third to get normalized image coordinates from the top-left corner.
- Choreography entries give `[second, [X, Y, liftHeight]]` for each forklift. Interpolate linearly between entries. The F1 and P1 times in `groundTruth` apply across all views. For dwell, 05:04 is the exact five-minute boundary, so a strictly-greater rule can first qualify on the following 10 fps frame at 05:04.100.
- Compare the footage-derived result with `expected`, keeping camera and source times together. An unavailable interval carries missing coverage. A processed frame can also have zero detections. Real detector output depends on the model and available inference throughput.
- Use `ffprobe` to check stream timing. From the `transfer` directory, extract the staging and aisle frames at 00:09 with `ffmpeg -ss 9 -i staging.mp4 -frames:v 1 staging-9s.png` and `ffmpeg -ss 9 -i aisle.mp4 -frames:v 1 aisle-9s.png`.

## Local verification

The 24-second transfer produced 35 saved detector observations on each camera, about 4.4 analyzed frames per second across the group, with a display lag of about 2.5 seconds. In the delay run, staging and dispatch stayed near 30 seconds of display lag and the aisle delivered 30 analyzed frames at source times in the handoff interval, roughly 44.5 seconds after occurrence. In the outage run, the aisle recorded zero observations during that interval and the other views recorded 17 each. The detector found forklifts in all three views and produced zero pallet classifications in these runs.
