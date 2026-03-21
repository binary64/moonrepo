# DJ Brain — LLM commentary generation + TTS injection into Liquidsoap
FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive
ENV TZ=Europe/London

RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    jq \
    ffmpeg \
    netcat-openbsd \
    python3 \
    ca-certificates \
    tzdata \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

WORKDIR /radio

COPY dj-commentary.sh /radio/dj-commentary.sh
COPY dj-watcher.sh /radio/dj-watcher.sh
COPY entrypoint.sh /radio/entrypoint.sh

RUN chmod +x /radio/*.sh

RUN groupadd -r -g 999 radio && useradd -r -u 999 -g radio -s /bin/false radio \
    && mkdir -p /state /config \
    && chown -R radio:radio /state /radio

USER radio

ENTRYPOINT ["/radio/entrypoint.sh"]
