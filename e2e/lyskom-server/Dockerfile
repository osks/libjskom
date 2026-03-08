FROM debian:trixie-slim

RUN apt-get update \
    && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
       lyskom-server netbase netcat-openbsd python3 python3-pip \
    && pip install --no-cache-dir --break-system-packages httpkom \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

RUN mkdir -p /var/run/lyskom-server \
    && chown lyskom:root /var/run/lyskom-server

COPY seed.py /seed.py
COPY fixture.json /fixture.json

EXPOSE 4894

HEALTHCHECK --interval=2s --timeout=2s --retries=30 \
  CMD test -f /tmp/seed-done || exit 1

CMD lyskomd -f & \
    until nc -z localhost 4894; do sleep 0.5; done && \
    python3 /seed.py --host localhost --port 4894 /fixture.json && \
    touch /tmp/seed-done && \
    wait
