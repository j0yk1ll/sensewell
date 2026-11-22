#!/bin/sh
set -eu

server=${WAREHOUSE_RTSP_URL:-rtsp://warehouse-rtsp:8554}
exec ffmpeg -nostdin -hide_banner -loglevel warning -nostats \
    -re -stream_loop -1 -i /warehouse.mp4 \
    -map 0:v:0 -c:v copy -f rtsp -rtsp_transport tcp "$server/staging" \
    -map 0:v:1 -c:v copy -f rtsp -rtsp_transport tcp "$server/aisle" \
    -map 0:v:2 -c:v copy -f rtsp -rtsp_transport tcp "$server/dispatch"
