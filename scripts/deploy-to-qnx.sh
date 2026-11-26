#!/usr/bin/env bash
# Deploys cross-compiled QNX 8.0 binaries to the running QEMU guest over localhost:8022 and launches them.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
ARCH="${ARCH:-aarch64le}"
BIN_DIR="${PROJECT_DIR}/qnx-target/build/${ARCH}"
QNX_HOST_DIR="${QNX_HOST_DIR:-${HOME}/qnx-env}"
QNX_HOST="${QNX_HOST_SSH:-127.0.0.1}"
QNX_PORT="${QNX_PORT_SSH:-8022}"
QNX_USER="${QNX_USER_SSH:-root}"
SSH_KEY_FLAG=""
if [[ -f "${QNX_HOST_DIR}/qnx_id_ed25519" ]]; then
  SSH_KEY_FLAG="-i ${QNX_HOST_DIR}/qnx_id_ed25519"
fi
SSH_OPTS="${SSH_KEY_FLAG} -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -P ${QNX_PORT}"
SSH_CMD_OPTS="${SSH_KEY_FLAG} -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -p ${QNX_PORT}"

for bin in pulse_scope_resmgr ipc_lab_workload telemetry_agent; do
  if [[ ! -f "${BIN_DIR}/${bin}" ]]; then
    echo "ERROR: Missing ${BIN_DIR}/${bin}. Run scripts/build-target.sh first." >&2
    exit 1
  fi
done

echo "==> Copying QNX 8.0 binaries to ${QNX_USER}@${QNX_HOST}:${QNX_PORT}:/tmp/pulse-studio/ ..."
# shellcheck disable=SC2086
ssh ${SSH_CMD_OPTS} "${QNX_USER}@${QNX_HOST}" "
  mkdir -p /tmp/pulse-studio
  for p in telemetry_agent ipc_lab_workload pulse_scope_resmgr; do
    slay -f -s KILL \$p 2>/dev/null || killall -9 \$p 2>/dev/null || true
  done
  for pid in \$(pidin -F '%a %n' 2>/dev/null | grep -E 'telemetry_agent|ipc_lab_workload|pulse_scope_resmgr' | awk '{print \$1}'); do
    kill -9 \$pid 2>/dev/null || true
  done
  sleep 1
  rm -f /tmp/pulse-studio/pulse_scope_resmgr /tmp/pulse-studio/ipc_lab_workload /tmp/pulse-studio/telemetry_agent
"
# shellcheck disable=SC2086
scp ${SSH_OPTS} \
  "${BIN_DIR}/pulse_scope_resmgr" \
  "${BIN_DIR}/ipc_lab_workload" \
  "${BIN_DIR}/telemetry_agent" \
  "${QNX_USER}@${QNX_HOST}:/tmp/pulse-studio/"

echo "==> Starting QNX Pulse Studio microkernel services inside QNX 8.0..."
# shellcheck disable=SC2086
ssh ${SSH_CMD_OPTS} "${QNX_USER}@${QNX_HOST}" '
  chmod +x /tmp/pulse-studio/*
  /tmp/pulse-studio/pulse_scope_resmgr >/tmp/pulse_scope.log 2>&1 </dev/null &
  sleep 1
  ls -la /dev/pulse_scope
  /tmp/pulse-studio/ipc_lab_workload >/tmp/ipc_lab.log 2>&1 </dev/null &
  sleep 1
  /tmp/pulse-studio/telemetry_agent 8080 >/tmp/telemetry_agent.log 2>&1 </dev/null &
  sleep 1
  cat /tmp/pulse_scope.log /tmp/ipc_lab.log /tmp/telemetry_agent.log
  pidin -p pulse_scope_resmgr,ipc_lab_workload,telemetry_agent
'
echo "DONE! QNX 8.0 telemetry stream is live on localhost:8080."
