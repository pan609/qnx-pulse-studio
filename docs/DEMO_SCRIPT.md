# Local review video storyboard

English narration uses local macOS Samantha synthetic speech. All measurement footage is captured from the actual QNX guest; the proof scene is a labeled excerpt of successful SSH command output. No source footage is claimed to be a physical board.

## 0–13 seconds · intro

QNX Pulse Studio is a zero hardware observatory for QNX OS eight. It combines a native user space resource manager, a scheduling experiment, and a reproducible Apple Silicon codelab.

## 13–26 seconds · proof

These are captured commands from the actual QNX eight guest, running under QEMU's TCG emulator. The kernel identity and compiled ELF verification logs are included with the project.

## 26–41 seconds · connect

Studio starts in clearly labeled, read only recorded mode. Here I connect to the local target. Live failures never silently switch to simulation. Fault injection uses the native telemetry bridge.

## 41–59 seconds · off

The sensor uses synchronous message passing through controller and actuator threads. With mutex priority inheritance disabled, medium priority CPU work can delay the low priority lock holder and the high priority sensor.

## 59–77 seconds · on

Enabling inheritance can reduce that blocking. These curves are live measurements, not generated traces. QEMU scheduling still creates outliers, so I make no worst case timing or vehicle safety claim.

## 77–97 seconds · benchmark

The A B benchmark waits for the sensor's configuration generation acknowledgment before resetting counters and sampling. End to end response time and pulse interval jitter use separate statistical buckets. Each late cycle is counted once.

## 97–113 seconds · scope

Scope all reveals real QNX system threads, and a process filter inspects another application. This is bounded, non atomic observation. The end to end timing metrics still belong to the built in experiment.

## 113–128 seconds · analysis

The default trace analyst uses observed priorities, blocking states and measured counters, without reading fault switches. Its explanations are local evidence rules. Causal claims need additional native tracing.

## 128–145 seconds · codelab

Nine bilingual codelab steps explain the zero hardware workflow and include checkpoints, original data, and troubleshooting. The archived priority inheritance run keeps its real deadline miss instead of hiding it.

## 145–159 seconds · outro

Export the raw trace, reproduce the experiment, and inspect the code. QNX Pulse Studio turns microkernel mechanisms into an accessible, honest development and learning workflow.
