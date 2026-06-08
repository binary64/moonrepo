FROM python:3.12-slim

# ffmpeg for MP3 -> PCM decoding (Hume returns MP3, Wyoming needs raw PCM).
# Not version-pinned deliberately: Debian point releases drop superseded
# package versions, so a hard pin would break future rebuilds of this rarely
# rebuilt image. skipcq: DOK-DL3008
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

RUN pip install --no-cache-dir "wyoming==1.9.0"

COPY server.py /app/server.py

EXPOSE 10200

ENV WYOMING_URI=tcp://0.0.0.0:10200

ENTRYPOINT ["python", "/app/server.py"]
