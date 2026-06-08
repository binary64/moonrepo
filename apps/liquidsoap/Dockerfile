# Liquidsoap — music player + BPM-aware crossfade
FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive
ENV TZ=Europe/London

RUN apt-get update && apt-get install -y --no-install-recommends \
    liquidsoap \
    python3 \
    ffmpeg \
    netcat-openbsd \
    curl \
    jq \
    ca-certificates \
    tzdata \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

WORKDIR /radio

COPY radio-dj.liq /radio/radio-dj.liq
COPY next_track.py /radio/next_track.py
# dj-commentary.sh: next_track.py execs this to air timed (start/end/seam) DJ
# clips from inside the liquidsoap pod. Kept byte-identical to apps/dj-brain's
# copy (same TTS->telnet push path); update both together.
COPY dj-commentary.sh /radio/dj-commentary.sh
COPY track-filter.sh /radio/track-filter.sh
COPY announce-track.sh /radio/announce-track.sh
COPY dj-outro-event.sh /radio/dj-outro-event.sh
COPY entrypoint.sh /radio/entrypoint.sh

RUN chmod +x /radio/*.sh /radio/*.py

RUN groupadd -r -g 999 radio && useradd -r -u 999 -g radio -s /bin/false radio \
    && mkdir -p /state /data /config \
    && chown -R radio:radio /state /radio

EXPOSE 1234

USER radio

ENTRYPOINT ["/radio/entrypoint.sh"]
