FROM debian:trixie-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 python3-pip \
    && pip install --no-cache-dir --break-system-packages httpkom \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

EXPOSE 5001

CMD ["python3", "-m", "httpkom", "--config", "/etc/httpkom.cfg", "--host", "0.0.0.0", "--port", "5001"]
