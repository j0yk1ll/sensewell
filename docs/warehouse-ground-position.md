# Calibrated ground position in replay

A calibrated zone uses a fixed camera and a polygon on the site floor plan in meters. Sensewell still uses RF-DETR boxes to locate subjects and associate observations from the same camera. Person membership uses visible ankle keypoints. One ankle clearly inside establishes inside, and two visible ankles clearly outside establish outside. For forklifts and other supported wheeled equipment, the midpoint of the lower edge of the box estimates the wheel line. The estimate is withheld when the box is clipped at the sides or bottom or another detection covers the reference. Ground contact may be unknown farther from the boundary when the observation supplies too little evidence.

## Set up a calibrated replay

Download the MediaPipe Pose Landmarker Full model into the existing detector model mount, then rebuild the detector service. The detector also accepts `PERSON_POSE_MODEL_PATH` when run directly. A missing pose model leaves person ground position unknown, while boxes remain available. [MediaPipe Pose Landmarker](https://ai.google.dev/edge/mediapipe/solutions/vision/pose_landmarker)

```sh
curl -fL https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task \
  -o models/pose_landmarker_full.task
docker compose up -d --build
```

For a warehouse fixture, use the existing [import and replay commands](warehouse-demo.md#import-and-replay-through-sensewell). Import fits the fixed views from the projected Blender landmarks and checks two floor reference positions in each visible zone. Enable an entry and exit rule for the applicable object classes on the imported camera.

For another fixed view, send a zone to `POST /api/cameras/{cameraId}/zones` or update it with `PUT /api/cameras/{cameraId}/zones/{zoneId}` in the authenticated camera workspace. Supply the zone `name`, the image `points` as normalized coordinates from the top left, and a `ground` object with these fields.

- `landmarks` contains four non-collinear correspondences. Each has `image: {x, y}` and `floor: {x, y}`. Use fixed landmarks on the ground that surround the area you want to measure.
- `checks` contains one or more independently measured correspondences. `maxErrorM` limits the greatest permitted projection error on those positions.
- `points` is the floor polygon in the same metric coordinates as the landmarks. Sensewell projects it to obtain the saved image outline. Keep the entire zone in view.
- `personToleranceM` and `vehicleToleranceM` are distance allowances for the ground reference in that view. Sensewell adds the greatest observed calibration check error to each allowance when evaluating proximity to the edge. Measure reference error on representative examples for the fixed view.

Image-space zones continue to use box overlap. In **Zone activity**, select a replay pass and a source time. Open **Ground position observations**, either side of a crossing, or an uncertain observation in **Observation gaps** to see the saved outline and ground evidence on its source frame. The event timestamp is the first qualifying sample on the new side. The preceding sample bounds the crossing interval. Sensewell can confirm a crossing across a short, continuously observed boundary band. A clipped or occluded position, ambiguous association, or wider sampling gap can leave a crossing possible. Such gaps interrupt dwell.

## Reproduce the comparison

Build Sensewell and run a local detector process with the RF-DETR Small and Full pose models. The offline benchmark runs inference sequentially at 10 fps to compare geometry on the same boxes. Replay can skip frames while inference is busy. It matches labeled actors to boxes by an annotated interior point, and counts an identity switch when a later matched observation has a different camera-local track ID. A crossing is matched to the same actor and direction within ±1 second. Timing error is observed minus labeled time. Both modes use the same detector boxes and camera-local association by box overlap. For calibrated objects, a weaker second match can veto an otherwise unique assignment. The benchmark reports unassigned crossings separately by mode and scores false and missed transitions only for labeled actors. These runs produced zero unassigned crossings.

```sh
pnpm build
python3.12 -m venv /tmp/sensewell-benchmark-detector
/tmp/sensewell-benchmark-detector/bin/pip install -r apps/detector/requirements.txt
WAREHOUSE_MODEL_PATH=models/warehouse_detector.onnx PERSON_POSE_MODEL_PATH=models/pose_landmarker_full.task \
  /tmp/sensewell-benchmark-detector/bin/python apps/detector/server.py
```

In a second terminal, run the renderer and benchmark.

```sh
blender -b -t 6 --python-exit-code 1 -P scripts/warehouse-demo/render.py -- \
  --scenario ground-position --camera staging --output warehouse-fixtures
export REPLAY_DETECTOR_URL=tcp://127.0.0.1:8000

node scripts/warehouse-demo/ground-zone-reference.mjs blender-walk \
  warehouse-fixtures/ground-position/manifest.json > /tmp/walk-reference.json
node scripts/warehouse-demo/detect-frames.mjs \
  warehouse-fixtures/ground-position/staging.mp4 0 7 > /tmp/walk-detections.ndjson
node scripts/warehouse-demo/score-ground-zones.mjs /tmp/walk-reference.json /tmp/walk-detections.ndjson
```

Use the same commands with the following cases and inputs. For the dwell case, concatenate the two detector outputs in source-time order. This measures the two boundary windows. Longer dwell and interruptions are exercised through the evaluator tests. The NVIDIA source published calibration and footage with withheld test labels. The event times and subject anchors here were hand-labeled from the supplied video. The real-view projection checks verify agreement with that calibration. [NVIDIA Warehouse_026 footage and calibration](https://huggingface.co/datasets/nvidia/PhysicalAI-SmartSpaces/tree/main/MTMC_Tracking_2026/test/Warehouse_026)

| Case | Reference input | Video and interval |
| --- | --- | --- |
| `blender-box-only` | Ground-position manifest, staging zone | `ground-position/staging.mp4`, 0–7 s |
| `blender-passing` | Supported-handoff manifest | `supported-handoff/aisle.mp4`, 9–17 s |
| `blender-dwell` | Dwell manifest | `dwell/dispatch.mp4`, 0–8 s and 311–318 s |
| `real-walk` | Warehouse_026 `calibration.json` | `Camera_0003.mp4`, 7–12 s |
| `real-forklift` | Warehouse_026 `calibration.json` | `Camera_0003.mp4`, 37–44 s |

| Observed case | Missed detections / labeled samples | Track ID changes, box → ground | Box overlap false / missed transitions | Ground false / missed transitions | Matched timing error, box → ground |
| --- | ---: | ---: | ---: | ---: | --- |
| Blender box-only overlap | 0 / 60 | 3 → 3 | 1 / 0 | 0 / 0 | — |
| Blender pedestrian gate | 0 / 60 | 3 → 3 | 0 / 0 | 0 / 2 | −400, +100 ms → both possible |
| Blender passing forklifts | 54 / 158 | 10 → 12 | 0 / 1 | 0 / 1 | — |
| Blender forklift dwell boundaries | 0 / 138 | 36 → 36 | 5 / 2 | 0 / 0 | — → +400, +500 ms |
| Real pedestrian crossing | 0 / 50 | 0 → 0 | 0 / 1 | 0 / 1 | entry 0 ms → exit +400 ms |
| Real forklift in back aisle | 12 / 38 | 0 → 0 | 0 / 2 | 0 / 2 | — |

The Blender walk recorded 49 unknown ground positions among 60 matched detections at the pedestrian gate. The real walk recorded a possible entry followed by a confirmed exit. The real forklift's ground reference remained unknown in all 26 matched observations of the partly obstructed aisle. The forklift proxy deviated by up to 0.69 m in the Blender dwell clips and up to 3.41 m in the passing clip, where occlusion and box-to-actor matching were difficult. Tune the allowance for each camera and treat the wheel line as an estimate. Crowding, missed detections, ambiguous tracks, and inconsistent ankle visibility still constrain the recorded results.
