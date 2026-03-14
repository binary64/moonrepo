# Radio DJ — Liquidsoap + Icecast streaming server
# Plays BPM-aware crossfaded music from a host-mounted library

FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive
ENV TZ=Europe/London

RUN apt-get update && apt-get install -y --no-install-recommends \
    icecast2 \
    liquidsoap \
    python3 \
    ffmpeg \
    netcat-openbsd \
    curl \
    jq \
    ca-certificates \
    tzdata \
    gettext-base \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

WORKDIR /radio

# Icecast config
COPY icecast.xml /etc/icecast2/icecast.xml

# Radio scripts (with container-adjusted paths)
COPY radio-dj.liq /radio/radio-dj.liq
COPY next_track.py /radio/next_track.py
COPY announce-track.sh /radio/announce-track.sh
COPY dj-commentary.sh /radio/dj-commentary.sh
COPY dj-session-line.sh /radio/dj-session-line.sh
COPY entrypoint.sh /radio/entrypoint.sh

RUN chmod +x /radio/*.sh /radio/*.py

# Create non-root user
RUN groupadd -r radio && useradd -r -g radio -s /bin/false radio

# Create directories for runtime state
RUN mkdir -p /state /data /config

# Icecast needs to write to its log dir (even though we log to stderr)
# Also ensure /etc/icecast2 is writable for envsubst templating at startup
RUN mkdir -p /var/log/icecast2 && chown radio:radio /var/log/icecast2 \
    && chown radio:radio /etc/icecast2/icecast.xml \
    && chown -R radio:radio /state /radio

EXPOSE 8100 1234

USER radio

ENTRYPOINT ["/radio/entrypoint.sh"]
