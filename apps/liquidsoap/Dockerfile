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
COPY announce-track.sh /radio/announce-track.sh
COPY entrypoint.sh /radio/entrypoint.sh

RUN chmod +x /radio/*.sh /radio/*.py

RUN groupadd -r radio && useradd -r -g radio -s /bin/false radio \
    && mkdir -p /state /data /config \
    && chown -R radio:radio /state /radio

EXPOSE 1234

USER radio

ENTRYPOINT ["/radio/entrypoint.sh"]
