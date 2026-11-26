# R1 remediation and reproducible evidence

Date: 2026-11-26. Review baseline: `84c793b`. Scope: R1 P0/P1 checklist, not the final submission video.

| R1 item | Implementation | Verification |
|---|---|---|
| P0-1 authentic trace | Removed formula-generated “verified” archive. Default loads v2 JSON with every original phase snapshot and E2E event. Replay stays offline and read-only. | 276 E2E cycles across Nominal / PI OFF / PI ON; capture script and tests recompute P99/misses from raw events. SHA-256 manifest links source/binaries/capture. |
| P0-2 reply lifetime | `io_read()` calls `MsgReply()` synchronously before returning `_RESMGR_NOREPLY`. | QNX cross-build, deploy, repeated POSIX JSON reads and quote/newline smoke. |
| P0-2 statistics | E2E-only latency/miss bucket; pulse-only interval-jitter bucket; no asymmetric jitter override. Once-per-cycle misses; separate `total_cycles` denominator. | Original events match counters and nearest-rank P99 in each phase. 128-sample window disclosed. |
| P0-2 contention/config | Config protected by a mutex; nominal busy work reduced to 6×300 µs. A/B applies config → wait for CONFIG_APPLIED generation acknowledgement → reset → 3 s sampling; errors abort rather than fall back. | Actual live browser A/B and export. No claim of a QEMU WCET guarantee. |
| P0-3 framing/JSON | Complete Content-Length body required, oversized/incomplete input rejected; output strings escaped/sanitized. | `scripts/smoke-target.py`: split headers/body, incomplete body without mutation, oversized body, quoted/newline POSIX writes, system-thread JSON. |
| P0-3 mode/wording | Hosted default makes no target probes; explicit target URL and connection; no automatic simulation fallback. TCG / virt-7.2 / GICv2 documented. | Browser assertions for no `/api/` requests in recorded mode, explicit synthetic mode, source-specific A/B label. |
| P1-1 arbitrary processes | `lab / all / pid` scans real names, states and effective priority; UI scope/PID controls and per-PID wait edges. | QNX capture includes system and selected-PID snapshots; live browser test observes `devb-virtio` outside the lab. |
| P1-1 evidence analysis | Local rules depend on thread states/priorities and counters, never fault switches. Candidate correlation is not presented as confirmed mutex ownership. | Regression flips fault config while holding observations fixed and verifies diagnosis unchanged. |
| P1-2 first screen / impact | Guide collapsed; sampled thread workspace and scope controls share the first screen with oscilloscope; E2E-only 100 km/h extra-travel ruler. | Desktop viewport assertion, mobile overflow assertion, real screenshots. Ruler explicitly excludes braking distance/safety claims. |
| P1-3 tutorial evidence | Nine steps, per-step checkpoint with executable command or explicit manual license check; real screenshots/GIF, canonical tutorial copied by build hooks. | Browser navigates all nine steps in EN/ZH and confirms screenshot images load. |

## Evidence

- `studio-ui/public/captures/qnx8-qemu-verified-trace.json`: original telemetry, including original snapshots/events/threads.
- `docs/capture-sha256.json`: source, compiled QNX ELF and archive SHA-256 at capture time.
- `docs/qnx8-verified-capture-proof.txt`: successful SSH identity, `pidin`, `/dev/pulse_scope`, QNX ELF interpreter.
- `docs/target-smoke.json`: actual HTTP/JSON regression result.
- `docs/browser-tests.json`: browser regression machine-readable result (see latest run statistics).
- `docs/assets/`: actual live/recorded UI screenshots and PI OFF→ON GIF. Frames show a running QNX OS guest, not a physical board.

## Reproduce

```sh
bash scripts/build-target.sh
bash scripts/deploy-to-qnx.sh
python3 scripts/smoke-target.py
python3 scripts/capture-qnx-trace.py
cd studio-ui
npm ci
npm run build
npm test
```

Downloads, myQNX acceptance/activation and license keys remain local. The SDK, license and QNX disk image are not redistributed.

## Deliberate limits

- QEMU TCG samples on one host establish observations, not worst-case latency or vehicle safety.
- /proc scans are non-atomic, capped at 48 threads and 16 per PID; brief waits/boosts can be missed.
- Scope changes only the thread view; E2E metrics always describe the built-in instrumented lab, not arbitrary applications.
- Pulse jitter is successive wakeup interval deviation, not absolute timer-expiry lateness.
- Default diagnosis is a local rule engine. BYOK is optional, sends sampled telemetry to the specified endpoint and was schema/failure-path checked; no paid external LLM call is needed for the default workflow.
- Final ≤3 minute English video and Devpost submission remain after the judge gate.

## Independent source-review fixes

First source review: 20261126-144848-71ad, five findings validated and fixed. Label buffers are zero-initialized; optional proc_name is type checked; benchmark requires sensor CONFIG_APPLIED acknowledgment after the prior E2E cycle, normalizes period/stall, and verifies generation throughout; explicit LLM reports persist across samples; failed default capture displays a no-data state, never simulated KPIs under a recorded badge. Regression includes an incoming 500 ms period / 200 ms reply-stall configuration and a mocked LLM endpoint (no paid API call).

Second source review: 20261126-145319-c9ab identified benchmark.source render-field validation; fixed with an explicit allowed-source enum and regression.

Final source audit: 20261126-145449-e97b, no findings. Full production-build browser regression: 9 expected, 0 failed, 0 skipped. Final targeted regression: 2 expected, 0 failed.
