import io
import json
import logging
import os
from socketserver import StreamRequestHandler, ThreadingTCPServer
from threading import BoundedSemaphore

import numpy as np
import onnxruntime as ort
from PIL import Image

CLASS_NAMES = [
    "box",
    "cart",
    "forklift",
    "pallet",
    "person",
    "robot",
    "white_roll",
    "amr",
    "ladder",
    "pallet_jack",
    "toolbox",
    "bottle",
    "extinguisher",
    "fitting_box",
    "full_box",
    "small_load_carrier",
    "stillage",
]
MIN_CONFIDENCE = 0.25
MAX_FRAME_BYTES = 1024 * 1024


class Detector:
    def __init__(self, path):
        options = ort.SessionOptions()
        options.intra_op_num_threads = int(os.environ.get("DETECTOR_CPU_THREADS", "4"))
        self.session = ort.InferenceSession(path, options, providers=["CPUExecutionProvider"])

        metadata = json.loads(self.session.get_modelmeta().custom_metadata_map["rfdetr_inference"])
        if metadata["box_format"] != "cxcywh_normalized" or metadata["input_layout"] != "NCHW":
            raise ValueError("Unsupported RF-DETR model input or box format")
        self.input_name = metadata["input_name"]
        _, _, self.height, self.width = metadata["input_shape"]
        self.outputs = [metadata["outputs"]["pred_boxes"], metadata["outputs"]["pred_logits"]]
        self.mean = np.array(metadata["means"], dtype=np.float32)
        self.std = np.array(metadata["stds"], dtype=np.float32)
        self.pixel_scale = np.float32(metadata["pixel_scale"])

        # The model's exported order can differ from the application's class order.
        ids_by_name = {name: int(index) for index, name in metadata["class_id_to_name"].items()}
        if set(ids_by_name) != set(CLASS_NAMES):
            raise ValueError("RF-DETR metadata does not match the warehouse classes")
        self.class_ids = [ids_by_name[name] for name in CLASS_NAMES]

    def detect(self, jpeg):
        with Image.open(io.BytesIO(jpeg), formats=["JPEG"]) as source:
            image = source.convert("RGB").resize((self.width, self.height), Image.Resampling.BILINEAR)
        pixels = (np.asarray(image, dtype=np.float32) * self.pixel_scale - self.mean) / self.std
        tensor = np.ascontiguousarray(pixels.transpose(2, 0, 1)[None])
        boxes, logits = self.session.run(self.outputs, {self.input_name: tensor})

        # Select each query's strongest foreground class and ignore the background slot.
        scores = 1 / (1 + np.exp(-np.clip(logits[0][:, self.class_ids], -80, 80)))
        classes = scores.argmax(axis=1)
        confidence = scores[np.arange(len(classes)), classes]
        qualifying = confidence >= MIN_CONFIDENCE

        detections = []
        for (cx, cy, width, height), score, class_index in zip(
            boxes[0][qualifying], confidence[qualifying], classes[qualifying],
        ):
            left, top, right, bottom = np.clip(
                [cx - width / 2, cy - height / 2, cx + width / 2, cy + height / 2], 0, 1,
            )
            if right > left and bottom > top:
                detections.append({
                    "objectType": CLASS_NAMES[class_index],
                    "box": [float(x) for x in (left, top, right, bottom)],
                    "confidence": float(score),
                })
        return detections


class InferenceServer(ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True

    def __init__(self):
        self.slot = BoundedSemaphore()
        self.detector = None
        try:
            self.detector = Detector(os.environ.get("WAREHOUSE_MODEL_PATH", "/models/warehouse_detector.onnx"))
        except Exception:
            logging.exception("Warehouse detector unavailable")
        super().__init__((os.environ.get("DETECTOR_HOST", "127.0.0.1"), 8000), InferenceHandler)


class InferenceHandler(StreamRequestHandler):
    timeout = 2

    def handle(self):
        # One JPEG per connection. The client closes its write side before reading the result.
        try:
            jpeg = self.rfile.read(MAX_FRAME_BYTES + 1)
            result = self.analyze(jpeg)
            self.wfile.write(json.dumps(result, allow_nan=False).encode())
        except (TimeoutError, BrokenPipeError, ConnectionResetError):
            return

    def analyze(self, jpeg):
        if self.server.detector is None or not 0 < len(jpeg) <= MAX_FRAME_BYTES:
            return {"state": "unavailable"}
        if not self.server.slot.acquire(blocking=False):
            return {"state": "skipped"}
        try:
            return {"state": "analyzed", "detections": self.server.detector.detect(jpeg)}
        except Exception:
            logging.exception("Warehouse frame analysis failed")
            return {"state": "unavailable"}
        finally:
            self.server.slot.release()


if __name__ == "__main__":
    InferenceServer().serve_forever()
