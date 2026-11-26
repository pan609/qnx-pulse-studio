import type { FaultConfig, Snapshot, TelemetryEvent } from './types';

/** Illustrative browser simulation. Never presented as measured QNX execution. */
export class QnxSimEngine {
  private seq = 1;
  private count = 0;
  private misses = 0;
  private boosts = 0;
  private lat: number[] = [];
  private jit: number[] = [];
  public config: FaultConfig = { prio_inherit_enabled: true, fault_prio_inversion: false,
    fault_reply_stall: false, fault_cpu_hog: false, tick_period_ms: 50, stall_ms: 35,
    scope_mode: 'lab', scope_pid: 0, generation: 1 };
  reset() { this.count = this.misses = this.boosts = 0; this.lat = []; this.jit = []; }
  updateConfig(patch: Partial<FaultConfig>) { this.config = { ...this.config, ...patch, generation:this.config.generation+1 }; }
  execResmgrCommand(cmd: string): string {
    if (cmd.trim() === 'reset') this.reset();
    else if (/^prio_inherit=[01]$/.test(cmd.trim())) this.updateConfig({ prio_inherit_enabled: cmd.endsWith('1') });
    else if (/^prio_inv=[01]$/.test(cmd.trim())) this.updateConfig({ fault_prio_inversion: cmd.endsWith('1') });
    else if (/^reply_stall=[01]$/.test(cmd.trim())) this.updateConfig({ fault_reply_stall: cmd.endsWith('1') });
    else if (cmd.trim() && cmd.trim() !== 'status') return 'SIMULATION: use the scenario buttons. No QNX device was written.';
    return JSON.stringify({ source: 'qnx-8.0-sim', config: this.config, cycles: this.count });
  }
  tick(): Snapshot {
    const c = this.config;
    const inversion = c.fault_prio_inversion && !c.prio_inherit_enabled;
    const boost = c.fault_prio_inversion && c.prio_inherit_enabled;
    const e2e = c.fault_reply_stall ? c.stall_ms * 1000 + 250 : inversion ? 27000 : boost ? 1800 : 250;
    const jitter = c.fault_cpu_hog ? 450 : 25;
    this.count++; this.misses += Number(e2e > 5000); this.boosts += Number(boost);
    this.lat = [...this.lat.slice(-127), e2e]; this.jit = [...this.jit.slice(-127), jitter];
    const avg = (v: number[]) => Math.round(v.reduce((a,b)=>a+b,0) / v.length);
    const p99 = (v: number[]) => [...v].sort((a,b)=>a-b)[Math.min(v.length-1, Math.ceil(v.length*.99)-1)];
    const ts = performance.now() * 1000000;
    const ev = (kind: number, latency: number, label: string): TelemetryEvent => ({ seq: this.seq++, ts_ns: ts,
      kind, src_pid: 4100, dst_pid: 4100, src_prio: 30, dst_prio: 25, latency_us: latency,
      jitter_us: jitter, flags: 0, label });
    const ack = ev(7, 0, 'simulated config applied'); ack.flags=c.generation;
    const events = [ack, ...(boost ? [ev(3, 0, 'simulated priority boost')] : []), ev(6,e2e,'simulated E2E cycle'), ev(2,0,'simulated pulse')];
    const threads = [
      { pid: 4100, tid: 1, name: 'sensor_rt_loop', priority: 30, real_priority: 30, state: inversion || boost ? 'MUTEX' : c.fault_reply_stall ? 'REPLY' : 'NANOSLEEP', policy: 'SCHED_FIFO', blocked_on_pid: c.fault_reply_stall ? 4100 : 0, cpu: 0 },
      { pid: 4100, tid: 2, name: 'controller_srv', priority: 30, real_priority: 25, state: c.fault_reply_stall ? 'REPLY' : 'RECEIVE', policy: 'SCHED_FIFO', blocked_on_pid: c.fault_reply_stall ? 4100 : 0, cpu: 0 },
      { pid: 4100, tid: 3, name: 'actuator_srv', priority: 30, real_priority: 20, state: c.fault_reply_stall ? 'NANOSLEEP' : 'RECEIVE', policy: 'SCHED_FIFO', blocked_on_pid: 0, cpu: 0 },
      { pid: 4100, tid: 4, name: 'low_calib_worker', priority: boost ? 30 : 15, real_priority: 15, state: boost ? 'RUNNING' : inversion ? 'READY' : 'NANOSLEEP', policy: 'SCHED_FIFO', blocked_on_pid: 0, cpu: 0 },
      { pid: 4100, tid: 5, name: 'med_cpu_hog', priority: 24, real_priority: 24, state: inversion ? 'RUNNING' : 'NANOSLEEP', policy: 'SCHED_FIFO', blocked_on_pid: 0, cpu: 0 },
    ];
    return { source: 'qnx-8.0-sim', host: { sysname: 'SIMULATED QNX', release: '8.0', machine: 'browser model', nodename: 'simulation' },
      snapshot_ns: ts, cycles_per_sec: 62500000, config: {...c}, events, threads,
      metrics: { total_ipc_msgs: this.count*3, total_cycles: this.count, total_pulses: this.count,
        prio_boost_count: this.boosts, deadline_misses: this.misses,
        avg_e2e_us: avg(this.lat), p99_e2e_us: p99(this.lat), max_e2e_us: Math.max(...this.lat), last_e2e_us: e2e,
        avg_ipc_us: avg(this.lat), max_ipc_us: Math.max(...this.lat),
        avg_jitter_us: avg(this.jit), p99_jitter_us: p99(this.jit), max_jitter_us: Math.max(...this.jit), last_jitter_us: jitter } };
  }
}
