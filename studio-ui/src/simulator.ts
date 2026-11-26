import type { FaultConfig, Snapshot, TelemetryEvent, ThreadSnap } from './types';

/**
 * Physics-accurate QNX 8.0 microkernel telemetry simulator used automatically
 * when QEMU QNX 8.0 (localhost:8080) is offline or when ?demo=1 is active.
 * Lets Devpost judges test every fault injection, /dev/pulse_scope command,
 * and AI trace diagnosis directly in the browser without installing QEMU.
 */
export class QnxSimEngine {
  private seq = 1;
  private startMs = Date.now();
  private totalIpc = 0;
  private totalPulses = 0;
  private prioBoosts = 0;
  private deadlineMisses = 0;
  private maxIpcUs = 0;
  private latWindow: number[] = [];
  private jitterWindow: number[] = [];
  private events: TelemetryEvent[] = [];

  public config: FaultConfig = {
    prio_inherit_enabled: true,
    fault_prio_inversion: false,
    fault_reply_stall: false,
    fault_cpu_hog: false,
    tick_period_ms: 50,
    stall_ms: 35,
  };

  public reset(): void {
    this.seq = 1;
    this.totalIpc = 0;
    this.totalPulses = 0;
    this.prioBoosts = 0;
    this.deadlineMisses = 0;
    this.maxIpcUs = 0;
    this.latWindow = [];
    this.jitterWindow = [];
    this.events = [];
  }

  public updateConfig(patch: Partial<FaultConfig>): void {
    this.config = { ...this.config, ...patch };
    this.pushEvent({
      kind: 5,
      src_pid: 4108,
      dst_pid: 4096,
      src_prio: 10,
      dst_prio: 10,
      latency_us: 14,
      jitter_us: 0,
      flags: this.config.prio_inherit_enabled ? 1 : 0,
      label: `devctl:pi=${this.config.prio_inherit_enabled ? 1 : 0},inv=${this.config.fault_prio_inversion ? 1 : 0},st=${this.config.fault_reply_stall ? 1 : 0}`,
    });
  }

  public execResmgrCommand(cmd: string): string {
    const c = cmd.trim();
    if (c.includes('prio_inherit=1')) this.config.prio_inherit_enabled = true;
    if (c.includes('prio_inherit=0')) this.config.prio_inherit_enabled = false;
    if (c.includes('prio_inv=1')) this.config.fault_prio_inversion = true;
    if (c.includes('prio_inv=0')) this.config.fault_prio_inversion = false;
    if (c.includes('reply_stall=1')) this.config.fault_reply_stall = true;
    if (c.includes('reply_stall=0')) this.config.fault_reply_stall = false;
    if (c.includes('cpu_hog=1')) this.config.fault_cpu_hog = true;
    if (c.includes('cpu_hog=0')) this.config.fault_cpu_hog = false;
    if (c.includes('reset')) this.reset();

    if (c.length > 0 && !c.startsWith('cat')) {
      this.pushEvent({
        kind: 4,
        src_pid: 4108,
        dst_pid: 4096,
        src_prio: 10,
        dst_prio: 10,
        latency_us: 18,
        jitter_us: 0,
        flags: this.config.prio_inherit_enabled ? 1 : 0,
        label: `write:${c.slice(0, 22)}`,
      });
    }

    const snap = this.tick();
    return JSON.stringify(
      {
        device: '/dev/pulse_scope',
        os: 'QNX 8.0 (Sim Trace)',
        cycles_per_sec: snap.cycles_per_sec,
        total_ipc_msgs: snap.metrics.total_ipc_msgs,
        total_pulses: snap.metrics.total_pulses,
        prio_boosts: snap.metrics.prio_boost_count,
        deadline_misses: snap.metrics.deadline_misses,
        avg_ipc_us: snap.metrics.avg_ipc_us,
        p99_jitter_us: snap.metrics.p99_jitter_us,
        prio_inherit: snap.config.prio_inherit_enabled ? 1 : 0,
        fault_prio_inv: snap.config.fault_prio_inversion ? 1 : 0,
        fault_reply_stall: snap.config.fault_reply_stall ? 1 : 0,
      },
      null,
      2
    );
  }

  private pushEvent(partial: Omit<TelemetryEvent, 'seq' | 'ts_ns'>): void {
    const tsNs = (Date.now() - this.startMs) * 1_000_000;
    this.events.push({
      seq: this.seq++,
      ts_ns: tsNs,
      ...partial,
    });
    if (this.events.length > 64) {
      this.events.shift();
    }
  }

  public tick(): Snapshot {
    const { prio_inherit_enabled, fault_prio_inversion, fault_reply_stall, fault_cpu_hog, stall_ms } =
      this.config;

    // Realistic QNX 8.0 microkernel latency physics (microseconds)
    let baseIpc = 165 + Math.round(Math.random() * 45); // ~165-210 us nominal 2-hop MsgSend/Reply
    let jitterUs = 14 + Math.round(Math.random() * 24); // ~14-38 us nominal SCHED_FIFO jitter
    let boostedNow = false;
    let anomaly = false;

    if (fault_cpu_hog && !fault_prio_inversion) {
      // SCHED_FIFO prio 30 preempts prio 24 CPU hog cleanly! Minimal impact.
      baseIpc += 30 + Math.round(Math.random() * 35);
      jitterUs += 22 + Math.round(Math.random() * 40);
    }

    if (fault_prio_inversion) {
      if (prio_inherit_enabled) {
        // QNX PTHREAD_PRIO_INHERIT boosts low_calib_worker (15 -> 30) immediately!
        baseIpc += 380 + Math.round(Math.random() * 220);
        jitterUs += 95 + Math.round(Math.random() * 140);
        boostedNow = true;
        this.prioBoosts += 1;
        this.pushEvent({
          kind: 3,
          src_pid: 4102,
          dst_pid: 4102,
          src_prio: 15,
          dst_prio: 30,
          latency_us: 0,
          jitter_us: 0,
          flags: 1,
          label: 'qnx:prio_inherit_boost',
        });
      } else {
        // Classic unbounded priority inversion: med_cpu_hog (24) starves low_calib_worker (15)
        // holding the mutex needed by sensor_rt_loop (30)!
        const storm = 18500 + Math.round(Math.random() * 11500);
        baseIpc += storm;
        jitterUs = storm + Math.round(Math.random() * 2500);
        anomaly = true;
      }
    }

    if (fault_reply_stall) {
      const stallUs = (stall_ms || 35) * 1000 + Math.round(Math.random() * 1800);
      baseIpc += stallUs;
      jitterUs = Math.max(jitterUs, Math.round(stallUs * 0.45));
      anomaly = true;
    }

    this.totalIpc += 3;
    this.totalPulses += 1;
    if (baseIpc > this.maxIpcUs) this.maxIpcUs = baseIpc;
    if (anomaly || jitterUs > 5000) this.deadlineMisses += 1;

    this.latWindow.push(baseIpc);
    this.jitterWindow.push(jitterUs);
    if (this.latWindow.length > 64) {
      this.latWindow.shift();
      this.jitterWindow.shift();
    }

    const flags = (prio_inherit_enabled ? 1 : 0) | (anomaly ? 2 : 0);
    this.pushEvent({
      kind: 1,
      src_pid: 4102,
      dst_pid: 4102,
      src_prio: 30,
      dst_prio: 20,
      latency_us: baseIpc,
      jitter_us: jitterUs,
      flags,
      label: fault_reply_stall ? 'controller->actuator [STALL]' : 'e2e:sensor->actuator',
    });

    const avgIpc = Math.round(
      this.latWindow.reduce((a, b) => a + b, 0) / Math.max(1, this.latWindow.length)
    );
    const sortedJ = [...this.jitterWindow].sort((a, b) => a - b);
    const p99Jitter = sortedJ[Math.min(sortedJ.length - 1, Math.floor(sortedJ.length * 0.99))] ?? 0;

    const threads: ThreadSnap[] = [
      {
        pid: 4102,
        tid: 5,
        name: 'sensor_rt_loop',
        priority: 30,
        real_priority: 30,
        state:
          fault_prio_inversion && !prio_inherit_enabled
            ? 'MUTEX'
            : fault_reply_stall
              ? 'REPLY'
              : 'RUNNING',
        policy: 'SCHED_FIFO',
        blocked_on_pid: fault_reply_stall ? 4102 : 0,
        cpu: 0,
      },
      {
        pid: 4102,
        tid: 2,
        name: 'controller_srv',
        priority: prio_inherit_enabled ? 30 : 25,
        real_priority: 25,
        state: fault_reply_stall ? 'REPLY' : 'RECEIVE',
        policy: 'SCHED_FIFO',
        blocked_on_pid: fault_reply_stall ? 4102 : 0,
        cpu: 0,
      },
      {
        pid: 4102,
        tid: 1,
        name: 'actuator_srv',
        priority: prio_inherit_enabled ? 30 : 20,
        real_priority: 20,
        state: fault_reply_stall ? 'NANOSLEEP' : 'RECEIVE',
        policy: 'SCHED_FIFO',
        blocked_on_pid: 0,
        cpu: 1,
      },
      {
        pid: 4102,
        tid: 3,
        name: 'low_calib_worker',
        priority: boostedNow ? 30 : 15,
        real_priority: 15,
        state:
          fault_prio_inversion && !prio_inherit_enabled
            ? 'READY'
            : fault_prio_inversion
              ? 'RUNNING'
              : 'NANOSLEEP',
        policy: 'SCHED_FIFO',
        blocked_on_pid: 0,
        cpu: 0,
      },
      {
        pid: 4102,
        tid: 4,
        name: 'med_cpu_hog',
        priority: 24,
        real_priority: 24,
        state: fault_cpu_hog || fault_prio_inversion ? 'RUNNING' : 'NANOSLEEP',
        policy: 'SCHED_FIFO',
        blocked_on_pid: 0,
        cpu: 0,
      },
      {
        pid: 4096,
        tid: 1,
        name: 'pulse_scope_resmgr',
        priority: 12,
        real_priority: 12,
        state: 'RECEIVE',
        policy: 'SCHED_RR',
        blocked_on_pid: 0,
        cpu: 1,
      },
      {
        pid: 4108,
        tid: 1,
        name: 'telemetry_agent',
        priority: 10,
        real_priority: 10,
        state: 'RUNNING',
        policy: 'SCHED_OTHER',
        blocked_on_pid: 0,
        cpu: 1,
      },
    ];

    return {
      source: 'qnx-8.0-sim',
      host: {
        sysname: 'QNX',
        release: '8.0.0',
        machine: 'aarch64le',
        nodename: 'qnx800-qemu-hvf',
      },
      snapshot_ns: (Date.now() - this.startMs) * 1_000_000,
      cycles_per_sec: 24_000_000,
      metrics: {
        total_ipc_msgs: this.totalIpc,
        total_pulses: this.totalPulses,
        prio_boost_count: this.prioBoosts,
        deadline_misses: this.deadlineMisses,
        avg_ipc_us: avgIpc,
        max_ipc_us: this.maxIpcUs,
        p99_jitter_us: p99Jitter,
        last_jitter_us: jitterUs,
      },
      config: { ...this.config },
      threads,
      events: [...this.events],
    };
  }
}
