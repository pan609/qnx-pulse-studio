# Codelab: Zero Hardware on Apple Silicon — Build & Visualize a QNX 8.0 Resource Manager and Priority-Inherited IPC Pipeline in QEMU HVF

> **Target Platform**: QNX OS 8.0 (`aarch64le`) via **QNX Everywhere** (free non-commercial license)  
> **Host Machine**: Apple Silicon Mac (M1/M2/M3/M4) or Linux x86_64 — **No physical embedded board required**  
> **Time to Complete**: ~25 minutes  
> **What You Will Build**:
> 1. A headless **Docker + QNX SDP 8.0** cross-compilation pipeline on Apple Silicon.
> 2. A hardware-accelerated **QNX 8.0 AArch64 QEMU VM** running at near-native speed via Apple `Hypervisor.framework` (`accel=hvf`).
> 3. A custom **QNX 8.0 Resource Manager** (`/dev/pulse_scope`) supporting POSIX `read()`, `write()`, custom `devctl()`, and live `/proc/<pid>/as` (`DCMD_PROC_TIDSTATUS`) thread introspection.
> 4. A **3-stage real-time Message Passing IPC & Priority Inheritance experiment** where you intentionally trigger—and then cure—Priority Inversion in front of a live microsecond oscilloscope.

---

## Step 1: Claim Your Free QNX Everywhere (SDP 8.0) License

1. Visit [`https://www.qnx.com/getqnx`](https://www.qnx.com/getqnx) and create a free myQNX account.
2. Activate a **QNX Software Development Platform 8.0 (Non-Commercial)** license and copy your License Key.
3. Download the **Linux x86_64** QNX Software Center installer (`qnx-setup-*-linux.run`).

> **Why Linux x86_64 on a Mac?**  
> QNX SDP 8.0 host compilers (`qcc`, `mkqnximage`) ship for x86_64 Linux and Windows. On Apple Silicon, we run the x86_64 toolchain cleanly inside an Ubuntu Docker container with Rosetta 2, while running the compiled `aarch64le` QNX 8.0 OS **natively on Apple Silicon hardware** through QEMU HVF!

---

## Step 2: Prepare macOS Host Tooling (Colima + Rosetta 2 + Native QEMU)

1. Install **Colima** (lightweight CLI Docker runtime using Apple Virtualization.framework + Rosetta 2 — no Docker Desktop GUI required!) and **QEMU 10+** via Homebrew:
   ```bash
   brew install colima qemu
   colima start --cpu 4 --memory 4 --disk 30 --vm-type=vz --vz-rosetta
   docker context use colima
   qemu-system-aarch64 --version
   ```

---

## Step 3: Headless QNX SDP 8.0 Installation (No Secrets in Docker Images)

Never bake your myQNX password or license key into a `Dockerfile` layer. Instead, install SDP 8.0 at runtime into a mounted persistent host directory (`~/qnx-env`) and mount `~/qnx-env/qnx-dot` to `/root/.qnx` so activated licenses persist across container runs:

```bash
export QNX_USER="your-email@example.com"
export QNX_PASSWORD="your-password"
export QSC_INSTALLER="$HOME/Downloads/qnx-setup-2.0.4-*-linux.run"

./scripts/setup-qnx-sdp.sh
```

Under the hood, the script uses QNX Software Center's headless CLI (`qnxsoftwarecenter_clt`) inside an `ubuntu:22.04` (`--platform linux/amd64`) container:
```bash
# 1. Pull & activate your deployed myQNX non-commercial license automatically
qnxsoftwarecenter_clt -myqnx.user "$QNX_USER" -myqnx.password "$QNX_PASSWORD" -syncLicenseKeys -activateAll
# 2. Mirror remote metadata FIRST (required to avoid 'allrepos is null'!)
qnxsoftwarecenter_clt -myqnx.user "$QNX_USER" -myqnx.password "$QNX_PASSWORD" -mirrorBaseline qnx800
# 3. Install QNX SDP 8.0 + QEMU AArch64 virtio BSP & drivers
qnxsoftwarecenter_clt -myqnx.user "$QNX_USER" -myqnx.password "$QNX_PASSWORD" \
  -installBaseline com.qnx.qnx800 -destination /opt/qnx-host/qnx800 -cleanInstall
qnxsoftwarecenter_clt -myqnx.user "$QNX_USER" -myqnx.password "$QNX_PASSWORD" \
  -installPackage com.qnx.qnx800.target.qemuvirt,com.qnx.qnx800.target.driver.virtio,com.qnx.qnx800.target.net.devsvirtio \
  -destination /opt/qnx-host/qnx800
```

---

## Step 4: Build & Boot QNX 8.0 AArch64 on macOS QEMU

Generate the QEMU boot image (`output/ifs.bin`) and virtual disk (`output/disk-qemu.vmdk`) with passwordless SSH key injection:
```bash
./scripts/build-qnx-image.sh
```

Now launch QNX 8.0 **directly on macOS** using `scripts/run-qemu-macos.sh`. Three Apple Silicon details are baked into this script:
1. **GICv2 machine (`-M virt-7.2 -cpu cortex-a76`)**: Avoids QNX `startup-qemu-virt`'s `gic_v3.c:966` assertion triggered when Apple HVF exposes GICv3 without a memory-mapped GICC base.
2. **Exact `virtio-mmio` device slot ordering**: Matches `startup.sh` (`devb-virtio` at `0xa003e00`, `vtnet_mmio` at `0xa003c00`, `devr-virtio.so` at `0xa003a00`).
3. **User-mode NAT (`-netdev user,hostfwd=...`)**: Replaces Linux `br0` bridging (which QNX's stock `runimage` marks unsupported on macOS) and forwards `localhost:8022` (SSH) and `localhost:8080` (Telemetry API).

```bash
./scripts/run-qemu-macos.sh
```

Inside the QNX serial prompt, verify you are running genuine QNX 8.0 on AArch64:
```sh
uname -a
# Verified output: QNX noname 8.0.0 ... QEMU_virt aarch64le
```

---

## Step 5: Anatomy of a QNX 8.0 Resource Manager (`/dev/pulse_scope`)

In QNX, device drivers and system services live in user space as **Resource Managers**—any process can attach a path into the global filesystem namespace and serve POSIX `open()`, `read()`, `write()`, and `devctl()` over QNX Message Passing.

Open [`qnx-target/src/pulse_scope_resmgr.c`](../qnx-target/src/pulse_scope_resmgr.c). Notice four key QNX 8.0 idioms:

1. **QNX 8.0 Ability Awareness (`procmgr_ability`)**:
   ```c
   procmgr_ability(0,
       PROCMGR_ADN_ROOT | PROCMGR_AOP_ALLOW | PROCMGR_AID_PATHSPACE,
       PROCMGR_ADN_ROOT | PROCMGR_AOP_ALLOW | PROCMGR_AID_XPROCESS_QUERY,
       PROCMGR_AID_EOL);
   ```
2. **Nanosecond Hardware Timing (`ClockCycles` + `SYSPAGE_ENTRY`)**:
   On AArch64 QNX 8.0, `ClockCycles()` reads `CNTVCT_EL0` directly without a kernel trap:
   ```c
   uint64_t cps = SYSPAGE_ENTRY(qtime)->cycles_per_sec;
   uint64_t ns  = (ClockCycles() / cps) * 1000000000ULL +
                  ((ClockCycles() % cps) * 1000000000ULL) / cps;
   ```
3. **Custom Binary `devctl()` Commands**:
   Defined in [`qnx-target/include/pulse_scope.h`](../qnx-target/include/pulse_scope.h) using `<devctl.h>`:
   ```c
   #define DCMD_PULSE_SCOPE_RECORD   __DIOT(_DCMD_MISC, 1, ps_event_t)
   #define DCMD_PULSE_SCOPE_SNAPSHOT __DIOF(_DCMD_MISC, 2, ps_snapshot_t)
   #define DCMD_PULSE_SCOPE_SET_CFG  __DIOT(_DCMD_MISC, 3, ps_fault_config_t)
   ```
4. **Live `/proc/<pid>/as` Thread Introspection**:
   Opening `/proc/<pid>/as` and calling `devctl(fd, DCMD_PROC_TIDSTATUS, &st, sizeof(st), NULL)` lets us read every thread's true microkernel state (`STATE_RUNNING`, `STATE_SEND`, `STATE_REPLY`, `STATE_MUTEX`) and effective priority in real time.

---

## Step 6: Cross-Compile & Run the Priority Inversion Lab

Cross-compile all three QNX 8.0 binaries (`pulse_scope_resmgr`, `ipc_lab_workload`, `telemetry_agent`):
```bash
./scripts/build-target.sh
```

Deploy and launch them inside your running QEMU QNX 8.0 VM:
```bash
./scripts/deploy-to-qnx.sh
```

Test your brand-new QNX Resource Manager straight from the QNX shell (or via SSH on port 8022):
```sh
cat /dev/pulse_scope
echo "prio_inv=1 prio_inherit=0" > /dev/pulse_scope
cat /dev/pulse_scope
```

---

## Step 7: Observe Priority Inversion vs. QNX Priority Inheritance Rescue

Start the host visual observatory:
```bash
cd studio-ui && npm install && npm run dev
```

Open `http://localhost:5173` and run the 4-step experiment:
1. **Nominal Deterministic**: Observe ~180 µs E2E IPC across `sensor_rt_loop (P30) → controller_srv (P25) → actuator_srv (P20)` with sub-50 µs wakeup jitter.
2. **Trigger Priority Inversion (`PTHREAD_PRIO_NONE`)**: `low_calib_worker (P15)` holds the calibration mutex while `med_cpu_hog (P24)` saturates the CPU. Watch `sensor_rt_loop (P30)` enter `STATE_MUTEX` and P99 jitter explode past the 5 ms hard real-time deadline!
3. **Flip Priority Inheritance ON (`PTHREAD_PRIO_INHERIT`)**: Watch the QNX 8.0 microkernel boost `low_calib_worker` from **P15 → P30**, preempt `med_cpu_hog (P24)`, and collapse latency back under the 5 ms deadline immediately.
4. **Click "Analyze Live Trace"**: Inspect the AI Co-Pilot's root-cause breakdown and copyable QNX C API fix diff.

---

## Verified Live Benchmark (QNX 8.0.0 `aarch64le` on Apple Silicon QEMU)

Measured directly from `/dev/pulse_scope` (`ClockCycles()` @ 62.5 MHz, contending threads pinned to CPU 0 via `ThreadCtl(_NTO_TCTL_RUNMASK, 0x1)`):

| Scenario | QNX Priority Boosts (`SchedGet` P15→P30) | Avg E2E IPC | P99 Wakeup Jitter |
| :--- | :---: | :---: | :---: |
| **Priority Inversion (`PTHREAD_PRIO_NONE`)** | `0` | `5,374 µs` | **`63,666 µs` (63.7 ms — breaches 5 ms deadline!)** |
| **QNX Priority Inheritance (`PTHREAD_PRIO_INHERIT`)** | **`35`** | **`1,256 µs`** | **`4,776 µs` (4.8 ms — 13.3× jitter reduction!)** |

---

## Troubleshooting (macOS Apple Silicon — Battle-Tested)

| Symptom | Cause | Fix |
| :--- | :--- | :--- |
| `Error: Cannot read the array length because "allrepos" is null` | Calling `qnxsoftwarecenter_clt -listAccessible` before mirroring metadata | Run `-mirrorBaseline qnx800` first |
| `qcc: license check failed` inside Docker | `/root/.qnx` wasn't mounted into subsequent container runs | Always pass `-v "$HOME/qnx-env/qnx-dot:/root/.qnx"` |
| `output/build/ifs.build: Host file 'startup-qemu-virt' not available` or `devb-virtio missing` | Base `com.qnx.qnx800` omits QEMU virtio BSP & block driver | Install `com.qnx.qnx800.target.qemuvirt,com.qnx.qnx800.target.driver.virtio,com.qnx.qnx800.target.net.devsvirtio` |
| `gic_v3.c:966 -- ASSERT(...) failed!` on QEMU boot | Apple HVF forces GICv3 without memory-mapped GICC base | Boot with `-M virt-7.2 -cpu cortex-a76` (GICv2) |
| `mkqnximage --run` says `Networking not supported` on macOS | Stock script expects Linux `br0`/`virbr0` | Use `scripts/run-qemu-macos.sh` (`-netdev user,hostfwd=...` + exact `virtio-blk` → `virtio-net` → `virtio-rng` MMIO slot order) |
| `scp: dest open ... Failure` on hot redeploy | QNX returns `ETXTBSY` when overwriting running executables | Kill processes and `rm -f` binaries before `scp` (handled by `scripts/deploy-to-qnx.sh`) |
