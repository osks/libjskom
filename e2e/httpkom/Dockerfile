FROM debian:trixie-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 python3-pip \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

# pylyskom/httpkom versions used unless local checkouts are given.
# Pin commits (not branches): the build cache would otherwise keep
# serving an old install.
ARG PYLYSKOM_REF=840679e
ARG HTTPKOM_REF=f4738ce

# Local pylyskom/httpkom checkouts, copied in by global-setup.ts (by default
# from next to libjskom; see localSource() there).
COPY src/ /src/
RUN pkgs="$(ls -d /src/*/ 2>/dev/null)"; \
    [ -d /src/pylyskom ] || pkgs="$pkgs pylyskom@https://github.com/osks/pylyskom/archive/${PYLYSKOM_REF}.tar.gz"; \
    [ -d /src/httpkom ] || pkgs="$pkgs httpkom@https://github.com/osks/httpkom/archive/${HTTPKOM_REF}.tar.gz"; \
    pip install --no-cache-dir --break-system-packages $pkgs

EXPOSE 5001

CMD ["python3", "-m", "httpkom", "--config", "/etc/httpkom.cfg", "--host", "0.0.0.0", "--port", "5001"]
