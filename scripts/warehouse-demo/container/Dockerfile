FROM docker.io/library/ubuntu:24.04 AS video
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*

FROM video AS runtime
COPY scripts/warehouse-demo/container/publish-rtsp.sh /publish-rtsp.sh
USER 65534:65534
CMD ["/bin/sh", "/publish-rtsp.sh"]

FROM runtime AS simulator
COPY scripts/warehouse-demo/container/transfer.mp4 /warehouse.mp4

FROM video AS render
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates curl xz-utils xauth xvfb libgl1 libegl1 libgl1-mesa-dri \
    libxfixes3 libxi6 libxkbcommon0 libxrandr2 libxrender1 \
    && rm -rf /var/lib/apt/lists/*
RUN curl --fail --show-error --silent --location --retry 3 \
    https://download.blender.org/release/Blender5.2/blender-5.2.4-linux-x64.tar.xz -o /tmp/blender.tar.xz \
    && echo '2fd14c50987426897ba60237ee996edf2b4151f4b1a72a460ca20be58c1d2d86  /tmp/blender.tar.xz' | sha256sum -c - \
    && mkdir /opt/blender && tar -xJf /tmp/blender.tar.xz --strip-components=1 -C /opt/blender \
    && rm /tmp/blender.tar.xz

WORKDIR /warehouse
COPY assets ./assets
COPY scripts/warehouse-demo/render.py scripts/warehouse-demo/scenarios.py scripts/warehouse-demo/scene.py ./scripts/warehouse-demo/
COPY scripts/warehouse-demo/container/pack-cameras.sh /pack-cameras.sh
ARG WAREHOUSE_SCENARIO=transfer
RUN LIBGL_ALWAYS_SOFTWARE=1 xvfb-run -a /opt/blender/blender -b --factory-startup -t 6 \
    --python-exit-code 1 -P scripts/warehouse-demo/render.py -- \
    --scenario "$WAREHOUSE_SCENARIO" --output /tmp/fixtures \
    && sh /pack-cameras.sh "/tmp/fixtures/$WAREHOUSE_SCENARIO" /warehouse.mp4

FROM runtime AS simulator-rendered
COPY --from=render /warehouse.mp4 /warehouse.mp4
