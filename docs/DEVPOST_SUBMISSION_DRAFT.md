# Devpost submission draft — QNX Pulse Studio

Status: editable draft. The local review video is saved under deliverables/demo (not committed). YouTube upload is deferred at the user’s request; no YouTube URL or Devpost submission receipt is claimed here.

## Project name
QNX Pulse Studio

## Tagline
A zero-hardware QNX 8.0 scheduling observatory with real IPC experiments and an Apple Silicon codelab.

## Inspiration
Microkernel mechanisms are easier to understand when developers can see and reproduce their effects. Getting a QNX development workflow running on Apple Silicon can be difficult before an experiment even starts. We wanted a short path from a laptop and a non-commercial QNX license to a real QNX guest, an observable experiment, and an honest record of what happened.

## What it does
Studio connects a native QNX 8.0 user-space resource manager to a browser observatory. The built-in workload uses synchronous sensor–controller–actuator messaging, a pulse timer, and competing real-time threads to explore mutex priority inversion and inheritance. Developers can inject controlled faults, compare end-to-end response times, inspect sampled thread states, export original telemetry, and follow a nine-step bilingual codelab.

Three sources are explicit: recorded QNX telemetry is read-only and the default; a manually connected QNX target provides live data and controls; browser simulation is synthetic. Target failures do not silently substitute simulated data. System/PID scope can inspect other processes' threads, while E2E timing remains specific to the instrumented lab.

## How we built it
The target stack is C cross-compiled with QNX SDP 8.0 for aarch64le. It uses resmgr_attach and POSIX read/write, custom devctl messages, ClockCycles, /proc introspection, ChannelCreate, MsgSend/MsgReceive/MsgReply, SIGEV_PULSE timers and scheduling APIs. The resource manager runs in user space. The web interface uses React, TypeScript and Canvas.

On Apple Silicon, the Linux SDK runs in an x86_64 container through Colima/Rosetta. QNX itself runs in QEMU TCG with virt-7.2/GICv2. The repository contains our application source and setup instructions; QNX installers, SDK, keys and disk images are not redistributed.

The default analyst is a local evidence rule engine. Optional BYOK LLM commentary is separate and is not required for the core workflow. We do not claim the default rules are an LLM or that optional paid-provider quality has been measured.

## Challenges
The difficult parts were host/guest architecture differences, QEMU interrupt-controller compatibility, VirtIO device ordering and QNX-specific APIs. Measurement integrity was another challenge: we separated E2E response from pulse interval jitter, counted misses once per cycle, and made A/B sampling wait for a sensor configuration-generation acknowledgement instead of assuming a fixed delay was enough.

Input validation, resource-manager reply lifetime and observable-data boundaries were independently reviewed. Follow-up focused tests cover typed JSON members, ambiguous HTTP framing and sparse high thread IDs.

## Accomplishments
A real QNX OS 8.0 guest runs the three native ELF services and supports interactive browser controls. The bundled capture preserves 82 original snapshots and 276 E2E points. Its original events reproduce the counters and statistics, and its source/binary/Trace checksums are provided with the exact capture revision. Later protocol fixes have a separate build manifest.

One archived run contained 92 PI OFF cycles with 9 E2E misses and 91 PI ON cycles with 1 miss; P99 E2E was 21,548 and 7,029 microseconds respectively. The PI ON outlier remains in the archive. This is a short QEMU observation on one host, not a stability distribution, WCET guarantee or vehicle-safety result. Pulse jitter is a separate wakeup-interval metric.

## What we learned
A visually persuasive demo is not enough: source identity, raw events, statistical definitions and a reproducible setup must agree. A sampled /proc view can suggest correlations but does not establish a mutex owner or complete kernel causality. The most useful tutorial explains these limits alongside its checkpoints.

## What's next
Evaluate the workflow with QNX developers and measure the onboarding experience. Broader native tracing and arbitrary-application timing would require additional instrumentation and validation; they are not claimed as current features.

## Built with
QNX OS 8.0, QNX SDP 8.0, C, QEMU, Colima, Rosetta 2, React, TypeScript, Vite, Canvas, Playwright.

## Links
- Source: https://github.com/pan609/qnx-pulse-studio
- Studio: https://pan609.github.io/qnx-pulse-studio/
- Codelab: https://pan609.github.io/qnx-pulse-studio/codelab/
- Public YouTube video: **pending actual upload and visibility verification**

## Track / awards
Primary: Developer Tooling & Host Tools. Bonus focus: Best Codelab / Tutorial; QNX-specific technology use is also documented. The official rule permits at most one Bonus award per project; the two bonus prizes must not be added together.

## Final external checklist
- Upload the reviewed MP4 to the intended YouTube channel, set visibility Public, and verify playback and duration <3 minutes.
- Enter the actual video URL in Devpost, verify track/category selections and all required fields, and submit.
- Save the actual Devpost confirmation/project URL and time. A draft, prepared video, public repository or judge PASS alone does not establish submission.
