# Derived ring-mqtt image: stock upstream + two-way-audio "speak" patch.
#
# WHY THIS EXISTS
#   ring-mqtt has no upstream "speak out the doorbell" command. The bundled
#   @tsightler/ring-client-api already exposes activateCameraSpeaker() +
#   transcodeReturnAudio(), so we add a thin `speak` MQTT command that drives
#   them. Only two files in /app/ring-mqtt/devices change.
#
#   The full patched files live in ./patched and are COPYed over the originals.
#   The exact diffs vs the 5.9.3 upstream are committed in ./patches for review
#   (the upstream Alpine image ships no `patch` binary, so we overlay the whole
#   files rather than apply diffs at build time).
#
# MAINTENANCE
#   Pinned to upstream 5.9.3. On a deliberate base bump: re-extract the two
#   upstream files, re-apply the changes marked "two-way-audio patch (Arthur)",
#   regenerate ./patches, and bump the image tag. The node --check below fails
#   the build loudly if either file is syntactically broken.
FROM tsightler/ring-mqtt:5.9.3@sha256:4a4e0db460d7023aa5851ff25491401fd23b2fd153b7269af481f0953cd6f00a

COPY patched/camera.js /app/ring-mqtt/devices/camera.js
COPY patched/camera-livestream.js /app/ring-mqtt/devices/camera-livestream.js

RUN node --check /app/ring-mqtt/devices/camera.js \
    && node --check /app/ring-mqtt/devices/camera-livestream.js
