# Warehouse_027 / Camera_0004 zone-entry check

This historical check used the 60-second Warehouse_027 / Camera_0004 clip and the RF-DETR Small Warehouse model. Footage is licensed under CC BY 4.0. Sensewell adds the zone and detection overlays. [NVIDIA PhysicalAI-SmartSpaces source clip](https://huggingface.co/datasets/nvidia/PhysicalAI-SmartSpaces/blob/main/MTMC_Tracking_2026/test/Warehouse_027/videos/Camera_0004.mp4) · [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)

## Original annotated crossing

Draw the **Rack-side floor** zone along the left side of the yellow tape as seen from the camera. Include the short stretch of floor past the end of the tape. These points are fractions of the source image measured from the top left, in drawing order.

| Corner | X | Y |
| --- | ---: | ---: |
| Foreground left | .040 | .851 |
| Near end of the tape | .332 | .996 |
| Far end of the tape | .474 | .365 |
| Far end extended | .487 | .326 |
| Back edge near the racks | .412 | .326 |
| Left edge behind the racks | .080 | .400 |
| Left frame edge | .008 | .520 |

The original timing run used a rule named **Rack-side entry**, a minimum confidence of **35%**, and replay at 1×. Follow the person in a light sweater and dark trousers who is walking away from the camera on the right side of the tape.

| Source time | What to inspect |
| --- | --- |
| 0:13.500 | The person is on the aisle side at the far tip of the tape. The qualifying outside detection is 55%. |
| 0:13.800 | The person steps left at the end of the tape toward the racks. The qualifying inside detection is 38%. This was the confirmed entry on replay pass 1 of the measured run. |
| 0:14.100 | The person continues past the tape tip. The frame helps distinguish the entrant from the second person behind them. |

In the original run, **Event history** showed **Rack-side entry** at **0:13.800**. The analyzed frame shows the saved zone and the entrant's box. The source clip opens at the same time. The pass number and ID identify the original replay pass if the clip loops. That run used a near-feet overlap criterion. New passes use the box-overlap criterion below, which can shift timestamps and change which crossings are confirmed.

## Rule behavior

A detection is inside when its bounding box and the zone polygon share positive area. Touching an edge or corner leaves it outside. A box can overlap before a person visibly steps into the zone, so the crossing time is an estimate in image space. The tracker requires a unique one-to-one match with at least 0.30 box intersection over union and can recover a match within 500 ms. A confirmed entry or exit requires qualifying detections on consecutive analyzed frames at most 400 ms apart. This accounts for replay frames skipped while CPU inference is busy.

A missing person or a detection below the rule's threshold leaves their position unknown. A person first detected inside has an unknown entry. A new replay pass starts with fresh tracks. The detector emits detections from 25% confidence upward, and the rule's threshold applies to both detections that establish the entry.

## Timing at 1×

Measured on November 20, 2026 in Chrome on the local Intel Core i7-13620H demo workstation, with four ONNX Runtime CPU threads and one Synthetic Camera replay. Timing starts when Sensewell submits the paced crossing frame for analysis. The evidence measurement includes opening the event, loading the analyzed frame, and finishing the source video seek in Chrome.

| Measure | Result |
| --- | ---: |
| Qualifying frame intake to history response containing the event | 0.273 s |
| Qualifying frame intake to usable evidence in Chrome | 0.949 s |
| Acceptance limit | 60 s |

Processing throughput for the complete first pass was **3.31 analyzed frames/s**. Sensewell persisted 199 analyzed frames in 60.112 seconds of elapsed replay time. Replay itself ran at 1× and sampled the clip at up to 10 frames/s.

The check also fetched the original pass's evidence after the loop advanced to pass 2. Requests from a separate signed-in tenant returned HTTP 404 for history, evidence, and the source clip.

## Inspect uncertainty in Zone activity

In the original check, **Zone activity** reported confirmed observed entries, estimated distinct entrant tracks, and observed occupancy for each enabled rule and object class. An entry-only rule still uses observed exits to establish dwell. Selecting a source time in seconds showed the nearest analyzed observation at or before that time, within 400 ms and within the analyzed range. The panel showed the actual observation time and tracks whose positions are unknown at that observation. Missing or filtered detections can make observed occupancy lower than actual occupancy.

**Crossing evidence**, **Observation gaps**, and **Visits and dwell** showed source times and qualifying confidence scores. Selecting an observation overlaid its detection and saved zone on the source frame and showed the replay pass and source time. Possible crossings have an interval between the last qualifying observations on opposite sides. Only confirmed crossings qualify for operational events and entry counts. When a person is first observed inside, occupancy includes that observation and the visit has an unknown entry. Dwell is calculated only when a visit has a confirmed entry and exit. Ambiguous associations, expired tracks, and the end of a replay pass close open visits as partial. Each pass starts with fresh tracks, so the jump back to the start cannot create an entry or exit.

### Camera_0004 verification

In one 1× RF-DETR replay of the documented zone at 35% rule confidence, the pass had qualifying observations on opposite sides at **0:14.200** (54%, outside) and **0:15.400** (36%, inside). Three intervening detections at **0:14.500**, **0:14.800**, and **0:15.100** had confidences of 32%, 27%, and 32%. Their consecutive box intersection-over-union scores were 0.80, 0.70, and 0.42, and the final match at **0:15.400** scored 0.66. The 500 ms recovery window applies between matching detections, including those below the rule threshold. This let the tracker preserve the track while the rule showed a 1.2 s gap and a possible entry. The first inside observation had positive box overlap with the zone.

The same pass showed confirmed entries at **0:54.200** and **0:54.800** on one track, for two observed entries and one estimated distinct entrant. Both entry boxes overlapped the zone by a small positive area. The associated dwell measurements were **0.300 s** and **5.100 s**. The panel linked each interval or endpoint to the original clip. Sample selection at 1× depends on detector latency, so timestamps and counts can vary between runs.

### Controlled observations

| Observations | Expected evidence |
| --- | --- |
| Move a box from edge-only contact to positive overlap on consecutive qualifying observations. | One confirmed entry. Edge-only contact is outside. |
| Follow a qualifying outside box with a missing or below-threshold observation, then recover the same track inside. | A possible entry and a visible gap. The inside observation contributes to occupancy with entry unknown. |
| Reobserve a box uniquely on the same side exactly 500 ms after the last match. | The track is retained and the qualifying observation gap is visible. |
| Reobserve after 501 ms or offer two plausible matches for one track. | Fresh tracks and a partial visit for any open visit on the discarded track. |
| End a pass with a track inside and start the loop with a box on the opposite side. | The earlier visit is partial. The first observation after the loop creates no crossing. |

In the controlled Chrome replay, pass 1 recorded entries at **0:00.100** and **0:00.300** for one entrant track. It showed a possible entry between **0:00.400** and **0:00.600**. The final open visit became partial when the loop finished, and pass 2 produced no entry or exit at **0:00.000** when the clip restarted on the opposite side.
