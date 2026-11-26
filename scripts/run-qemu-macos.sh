#!/usr/bin/env bash
# Runs the QNX 8.0 AArch64 target natively on Apple Silicon macOS via QEMU + Hypervisor.framework (hvf).
# Forwards:
#   localhost:8022 -> QNX SSH (port 22)
#   localhost:8080 -> QNX Pulse Studio Telemetry & Control Agent (port 8080)
#   localhost:8000 -> QNX qconn debug agent (port 8000)

set -euo pipefail

QNX_HOST_DIR="${QNX_HOST_DIR:-${HOME}/qnx-env}"
OUT_DIR="${QNX_IMAGE_OUT:-${QNX_HOST_DIR}/qemu-image/output}"
IFS_BIN="${OUT_DIR}/ifs.bin"
DISK_IMG="${OUT_DIR}/disk-qemu.vmdk"

if ! command -v qemu-system-aarch64 >/dev/null 2>&1; then
  echo "ERROR: qemu-system-aarch64 not found. Install via: brew install qemu" >&2
  exit 1
fi

if [[ ! -f "${IFS_BIN}" || ! -f "${DISK_IMG}" ]]; then
  echo "ERROR: Missing ${IFS_BIN} or ${DISK_IMG}. Run scripts/build-qnx-image.sh first." >&2
  exit 1
fi

# Note on Apple Silicon macOS:
# QEMU's -accel hvf forces GICv3 without a memory-mapped GICC base, which triggers
# `gic_v3.c:966 -- ASSERT((use_memory_mapped_callouts == 0) || (gicc_paddr_base != -1))`
# in QNX 8.0's startup-qemu-virt. Using QNX's official `virt-7.2` (GICv2) + `cortex-a76`
# boots QNX 8.0 cleanly with full virtio-blk, virtio-net (vtnet0), and virtio-rng support.
ACCEL_ARGS="${QNX_QEMU_MACHINE:--M virt-7.2 -cpu cortex-a76}"

echo "==> Booting QNX 8.0 (aarch64le) on QEMU..."
echo "    SSH:       ssh -i ${QNX_HOST_DIR}/qnx_id_ed25519 -p 8022 root@127.0.0.1"
echo "    Telemetry: http://127.0.0.1:8080/api/snapshot"
echo "    Exit QEMU: Ctrl-A then X"
echo ""

# Device order matches QNX startup.sh virtio-mmio slots:
#   1st (0xa003e00, irq 79): virtio-blk-device (devb-virtio)
#   2nd (0xa003c00, irq 78): virtio-net-device (io-sock vtnet_mmio + QEMU user NAT)
#   3rd (0xa003a00, irq 77): virtio-rng-device (random devr-virtio.so)
# shellcheck disable=SC2086
exec qemu-system-aarch64 \
  ${ACCEL_ARGS} \
  -smp 2 \
  -m 2G \
  -drive "file=${DISK_IMG},if=none,id=drv0" \
  -device virtio-blk-device,drive=drv0 \
  -netdev "user,id=net0,hostfwd=tcp::8022-:22,hostfwd=tcp::8080-:8080,hostfwd=tcp::8000-:8000" \
  -device virtio-net-device,netdev=net0,mac=52:54:00:12:34:56 \
  -kernel "${IFS_BIN}" \
  -object rng-random,filename=/dev/urandom,id=rng0 \
  -device virtio-rng-device,rng=rng0 \
  -serial mon:stdio \
  -nographic
