# QNX SDP 8.0 Build Host Container (x86_64 Linux for Apple Silicon Rosetta 2 / Linux / Windows)
# Zero secrets are baked into this image: QNX SDP 8.0 is installed at runtime into a mounted host volume.
FROM --platform=linux/amd64 ubuntu:22.04

ENV DEBIAN_FRONTEND=noninteractive
ENV TZ=UTC

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    wget \
    git \
    make \
    cmake \
    python3 \
    python3-pip \
    openssh-client \
    sshpass \
    dosfstools \
    mtools \
    parted \
    fdisk \
    e2fsprogs \
    qemu-utils \
    rsync \
    xz-utils \
    bzip2 \
    unzip \
    file \
    libxtst6 \
    libxi6 \
    libfreetype6 \
    fontconfig \
    libgtk-3-0 \
    libdbus-glib-1-2 \
    libglib2.0-0 \
    libxrender1 \
    libnss3 \
    && rm -rf /var/lib/apt/lists/*

# Mount points:
#   /opt/qnx-host  -> persistent host directory holding QNX Software Center + qnx800 SDP
#   /workspace     -> qnx-pulse-studio repo root
WORKDIR /workspace

CMD ["/bin/bash"]
