#!/usr/bin/env bash
# Cross-compiles qnx-target/ C binaries for QNX 8.0 (aarch64le by default) inside Docker.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
QNX_HOST_DIR="${QNX_HOST_DIR:-${HOME}/qnx-env}"
ARCH="${ARCH:-aarch64le}"
IMAGE_NAME="qnx-pulse-studio-builder:8.0"

if [[ ! -f "${QNX_HOST_DIR}/qnx800/qnxsdp-env.sh" ]]; then
  echo "ERROR: QNX SDP 8.0 not found in ${QNX_HOST_DIR}/qnx800. Run scripts/setup-qnx-sdp.sh first." >&2
  exit 1
fi

echo "==> Cross-compiling QNX Pulse Studio target binaries for ${ARCH}..."
docker run --rm --platform linux/amd64 \
  -v "${QNX_HOST_DIR}:/opt/qnx-host" \
  -v "${QNX_HOST_DIR}/qnx-dot:/root/.qnx" \
  -v "${PROJECT_DIR}:/workspace" \
  "${IMAGE_NAME}" bash -lc "
    set -euo pipefail
    source /opt/qnx-host/qnx800/qnxsdp-env.sh
    cd /workspace/qnx-target
    make ARCH=${ARCH} clean all
    ls -lh build/${ARCH}/
  "
