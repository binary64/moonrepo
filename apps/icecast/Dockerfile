# Icecast — streaming server only
FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive
ENV TZ=Europe/London

RUN apt-get update && apt-get install -y --no-install-recommends \
    icecast2 \
    curl \
    gettext-base \
    tzdata \
    ca-certificates \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

COPY icecast.xml /etc/icecast2/icecast.xml
COPY entrypoint.sh /entrypoint.sh

RUN groupadd -r radio && useradd -r -g radio -s /bin/false radio \
    && mkdir -p /var/log/icecast2 && chown radio:radio /var/log/icecast2 \
    && chown radio:radio /etc/icecast2/icecast.xml \
    && chmod +x /entrypoint.sh

EXPOSE 8100

USER radio

ENTRYPOINT ["/entrypoint.sh"]
