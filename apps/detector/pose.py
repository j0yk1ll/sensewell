from math import ceil, floor

import numpy as np


class PersonPose:
    def __init__(self, model_path):
        import mediapipe as mp

        self.image = mp.Image
        self.image_format = mp.ImageFormat.SRGB
        self.landmarker = mp.tasks.vision.PoseLandmarker.create_from_options(
            mp.tasks.vision.PoseLandmarkerOptions(
                base_options=mp.tasks.BaseOptions(model_asset_path=model_path),
            ),
        )
        self.ankles = (mp.tasks.vision.PoseLandmark.LEFT_ANKLE, mp.tasks.vision.PoseLandmark.RIGHT_ANKLE)

    def detect_ankles(self, image, box):
        width, height = image.size
        left, top, right, bottom = box
        pad_x, pad_y = (right - left) * 0.2, (bottom - top) * 0.2
        size = max(2, ceil(1.35 * max((right - left) * width, (bottom - top) * height)))
        x0 = min(max(0, floor((left + right) * width / 2 - size / 2)), max(0, width - size))
        y0 = min(max(0, floor((top + bottom) * height / 2 - size / 2)), max(0, height - size))
        crop = np.asarray(image.crop((x0, y0, x0 + size, y0 + size)))
        result = self.landmarker.detect(self.image(image_format=self.image_format, data=crop))
        if not result.pose_landmarks:
            return [None, None]
        pose = result.pose_landmarks[0]

        def position(landmark):
            return (x0 + landmark.x * size) / width, (y0 + landmark.y * size) / height

        # A padded crop can include another person. Require this pose's torso
        # to belong to the original detector box before using either ankle.
        torso = [position(pose[i]) for i in (11, 12, 23, 24)]
        torso_x = sum(x for x, _ in torso) / len(torso)
        torso_y = sum(y for _, y in torso) / len(torso)
        if not (left < torso_x < right and top < torso_y < bottom):
            return [None, None]

        def visible_point(landmark):
            if min(landmark.visibility or 0, landmark.presence or 0) < 0.7:
                return None
            x, y = position(landmark)
            if not (0 < x < 1 and 0 < y < 1 and left - pad_x < x < right + pad_x and top < y < bottom + pad_y):
                return None
            return {"x": x, "y": y}

        return [visible_point(pose[index]) for index in self.ankles]
