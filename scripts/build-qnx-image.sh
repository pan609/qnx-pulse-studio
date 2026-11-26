#!/usr/bin/env bash
# Builds a bootable QNX 8.0 AArch64 QEMU target image (ifs.bin + disk-qemu.vmdk) using mkqnximage.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
QNX_HOST_DIR="${QNX_HOST_DIR:-${HOME}/qnx-env}"
IMAGE_NAME="qnx-pulse-studio-builder:8.0"

if [[ ! -f "${QNX_HOST_DIR}/qnx800/qnxsdp-env.sh" ]]; then
  echo "ERROR: QNX SDP 8.0 not found in ${QNX_HOST_DIR}/qnx800. Run scripts/setup-qnx-sdp.sh first." >&2
  exit 1
fi

mkdir -p "${QNX_HOST_DIR}/qemu-image"
if [[ ! -f "${QNX_HOST_DIR}/qnx_id_ed25519" ]]; then
  ssh-keygen -t ed25519 -N "" -f "${QNX_HOST_DIR}/qnx_id_ed25519" -C "qnx-pulse-studio" >/dev/null
fi

echo "==> Building QNX 8.0 aarch64le QEMU image in ${QNX_HOST_DIR}/qemu-image..."
docker run --rm --platform linux/amd64 \
  -v "${QNX_HOST_DIR}:/opt/qnx-host" \
  -v "${QNX_HOST_DIR}/qnx-dot:/root/.qnx" \
  -v "${PROJECT_DIR}:/workspace" \
  "${IMAGE_NAME}" bash -lc '
    set -euo pipefail
    source /opt/qnx-host/qnx800/qnxsdp-env.sh
    cd /opt/qnx-host/qemu-image
    mkqnximage --type=qemu --arch=aarch64le --ssh-ident=/opt/qnx-host/qnx_id_ed25519.pub --noprompt --build
    ls -lh /opt/qnx-host/qemu-image/output/
  '

echo "DONE! Image ready in ${QNX_HOST_DIR}/qemu-image/output/"
