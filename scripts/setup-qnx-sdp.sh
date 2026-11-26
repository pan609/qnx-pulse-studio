#!/usr/bin/env bash
# Headless installation of QNX Software Center + QNX SDP 8.0 into a persistent host directory.
# Runs inside the x86_64 Docker container so credentials/license keys are NEVER baked into images or git.
#
# Required env vars:
#   QNX_USER        - myQNX account email
#   QNX_PASSWORD    - myQNX account password
#   QNX_LICENSE_KEY - QNX Everywhere / SDP 8.0 non-commercial license key
#   QSC_INSTALLER   - Path to downloaded qnx-setup-*-linux.run on host
#
# Optional:
#   QNX_HOST_DIR    - Persistent host directory (default: $HOME/qnx-env)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
QNX_HOST_DIR="${QNX_HOST_DIR:-${HOME}/qnx-env}"
IMAGE_NAME="qnx-pulse-studio-builder:8.0"

: "${QNX_USER:?Set QNX_USER (myQNX email)}"
: "${QNX_PASSWORD:?Set QNX_PASSWORD (myQNX password)}"
: "${QSC_INSTALLER:?Set QSC_INSTALLER (path to qnx-setup-*-linux.run)}"

if [[ ! -f "${QSC_INSTALLER}" ]]; then
  echo "ERROR: QSC installer not found at ${QSC_INSTALLER}" >&2
  exit 1
fi

mkdir -p "${QNX_HOST_DIR}/qsc" "${QNX_HOST_DIR}/qnx800" "${QNX_HOST_DIR}/qemu-image" "${QNX_HOST_DIR}/qnx-dot"
cp -f "${QSC_INSTALLER}" "${QNX_HOST_DIR}/qsc/qnx-setup-linux.run"
chmod +x "${QNX_HOST_DIR}/qsc/qnx-setup-linux.run"

echo "==> [1/3] Building x86_64 QNX builder image (${IMAGE_NAME})..."
docker build --platform linux/amd64 -t "${IMAGE_NAME}" "${PROJECT_DIR}/docker"

echo "==> [2/3] Extracting QNX Software Center & installing SDP 8.0 into ${QNX_HOST_DIR}/qnx800..."
docker run --rm --platform linux/amd64 \
  -v "${QNX_HOST_DIR}:/opt/qnx-host" \
  -v "${QNX_HOST_DIR}/qnx-dot:/root/.qnx" \
  -v "${PROJECT_DIR}:/workspace" \
  -e QNX_USER="${QNX_USER}" \
  -e QNX_PASSWORD="${QNX_PASSWORD}" \
  -e QNX_LICENSE_KEY="${QNX_LICENSE_KEY:-}" \
  "${IMAGE_NAME}" bash -lc '
    set -euo pipefail
    cd /opt/qnx-host/qsc
    if [[ ! -x /opt/qnx-host/qsc/extracted/qnxsoftwarecenter/qnxsoftwarecenter_clt ]]; then
      mkdir -p /opt/qnx-host/qsc/extracted
      ./qnx-setup-linux.run --tar xvf -C /opt/qnx-host/qsc/extracted
    fi

    CLT="/opt/qnx-host/qsc/extracted/qnxsoftwarecenter/qnxsoftwarecenter_clt"
    if [[ ! -x "$CLT" ]]; then
      CLT="$(find /opt/qnx-host/qsc/extracted -name qnxsoftwarecenter_clt -type f | head -n 1)"
    fi
    echo "Using CLT: $CLT"

    if [[ -n "$QNX_LICENSE_KEY" ]]; then
      "$CLT" -myqnx.user "$QNX_USER" -myqnx.password "$QNX_PASSWORD" -addLicenseKey "$QNX_LICENSE_KEY" || true
    fi
    "$CLT" -myqnx.user "$QNX_USER" -myqnx.password "$QNX_PASSWORD" -syncLicenseKeys -activateAll
    "$CLT" -myqnx.user "$QNX_USER" -myqnx.password "$QNX_PASSWORD" -mirrorBaseline qnx800
    "$CLT" -myqnx.user "$QNX_USER" -myqnx.password "$QNX_PASSWORD" \
      -installBaseline com.qnx.qnx800 \
      -destination /opt/qnx-host/qnx800 \
      -cleanInstall
    "$CLT" -myqnx.user "$QNX_USER" -myqnx.password "$QNX_PASSWORD" \
      -installPackage com.qnx.qnx800.target.qemuvirt,com.qnx.qnx800.target.driver.virtio,com.qnx.qnx800.target.net.devsvirtio \
      -destination /opt/qnx-host/qnx800
  '

echo "==> [3/3] Verifying QNX 8.0 cross-compiler (qcc)..."
docker run --rm --platform linux/amd64 \
  -v "${QNX_HOST_DIR}:/opt/qnx-host" \
  -v "${QNX_HOST_DIR}/qnx-dot:/root/.qnx" \
  "${IMAGE_NAME}" bash -lc '
    source /opt/qnx-host/qnx800/qnxsdp-env.sh
    qcc -V
  '

echo "DONE! QNX SDP 8.0 installed cleanly into ${QNX_HOST_DIR}/qnx800."
