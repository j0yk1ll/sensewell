#!/bin/sh
set -eu

# Frequent keyframes let an IP camera join partway through the loop.
ffmpeg -nostdin -v error -y \
    -i "$1/staging.mp4" -i "$1/aisle.mp4" -i "$1/dispatch.mp4" \
    -map 0:v:0 -map 1:v:0 -map 2:v:0 -c:v libx264 -preset fast -crf 25 \
    -g 20 -sc_threshold 0 -bf 0 -threads 2 -pix_fmt yuv420p "$2"
