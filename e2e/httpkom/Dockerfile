FROM debian:trixie-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 python3-pip \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

# Local pylyskom/httpkom checkouts, copied in by global-setup.ts when
# PYLYSKOM_SRC/HTTPKOM_SRC are set. Anything not provided comes from PyPI.
COPY src/ /src/
RUN pkgs="$(ls -d /src/*/ 2>/dev/null)"; \
    [ -d /src/httpkom ] || pkgs="$pkgs httpkom"; \
    pip install --no-cache-dir --break-system-packages $pkgs

EXPOSE 5001

CMD ["python3", "-m", "httpkom", "--config", "/etc/httpkom.cfg", "--host", "0.0.0.0", "--port", "5001"]
