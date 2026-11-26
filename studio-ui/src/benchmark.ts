import type { OscPoint, Snapshot } from './types';

export interface BenchmarkSide {
  avgE2eUs: number; p99E2eUs: number; maxE2eUs: number;
  p99JitterUs: number; prioBoosts: number; deadlineMisses: number; samples: number;
}
export interface BenchmarkComparison {
  capturedAt: string;
  source: 'qnx-8.0-live' | 'qnx-8.0-sim' | 'verified-qnx-8.0-capture';
  hostLabel: string; piOff: BenchmarkSide; piOn: BenchmarkSide;
}
export interface TraceArchive {
  schema: 'qnx-pulse-studio-trace/v2'; exportedAt: string; source: string;
  host: Snapshot['host']; cycles_per_sec: number;
  points: OscPoint[]; lastSnapshot: Snapshot;
  benchmark?: BenchmarkComparison;
  phaseSnapshots?: Record<string, Snapshot>;
  snapshots?: { phase: string; receivedAt: string; snapshot: Snapshot }[];
}
export function benchmarkSide(snap: Snapshot): BenchmarkSide {
  const m = snap.metrics;
  return { avgE2eUs: m.avg_e2e_us, p99E2eUs: m.p99_e2e_us, maxE2eUs: m.max_e2e_us,
    p99JitterUs: m.p99_jitter_us, prioBoosts: m.prio_boost_count,
    deadlineMisses: m.deadline_misses, samples: m.total_cycles };
}
export function validateSnapshot(value: unknown): asserts value is Snapshot {
  const s = value as Snapshot;
  if (!s || !['qnx-8.0-live', 'qnx-8.0-sim'].includes(s.source) || !s.host ||
      !s.metrics || !s.config || !Array.isArray(s.threads) || !Array.isArray(s.events) ||
      !Number.isFinite(s.snapshot_ns) || !(s.cycles_per_sec > 0)) throw new Error('Invalid telemetry snapshot');
  if (!['sysname','release','machine','nodename'].every(k => typeof s.host[k as keyof Snapshot['host']] === 'string') ||
      !['lab','all','pid'].includes(s.config.scope_mode) ||
      !['prio_inherit_enabled','fault_prio_inversion','fault_reply_stall','fault_cpu_hog'].every(k => typeof s.config[k as keyof Snapshot['config']] === 'boolean') ||
      ![s.config.tick_period_ms,s.config.stall_ms,s.config.scope_pid,s.config.generation].every(Number.isFinite)) throw new Error('Invalid host or configuration');
  for (const key of ['total_cycles','avg_e2e_us','p99_e2e_us','max_e2e_us','last_e2e_us',
    'p99_jitter_us','last_jitter_us','deadline_misses','prio_boost_count','total_ipc_msgs','total_pulses'] as const) {
    if (!Number.isFinite(s.metrics[key]) || s.metrics[key] < 0) throw new Error('Invalid metric: ' + key);
  }
  for (const th of s.threads) {
    if (!th || th.proc_name !== undefined && typeof th.proc_name !== 'string' || typeof th.name !== 'string' || typeof th.state !== 'string' || typeof th.policy !== 'string' ||
        ![th.pid, th.tid, th.priority, th.real_priority, th.cpu, th.blocked_on_pid].every(Number.isFinite)) throw new Error('Invalid thread');
  }
  for (const ev of s.events) {
    if (!ev || typeof ev.label !== 'string' || ![ev.seq,ev.ts_ns,ev.kind,ev.latency_us,ev.jitter_us,ev.flags].every(Number.isFinite)) throw new Error('Invalid event');
  }
}
export function parseTrace(value: unknown): TraceArchive {
  const a = value as TraceArchive;
  if (!a || a.schema !== 'qnx-pulse-studio-trace/v2' || !Array.isArray(a.points) ||
      a.points.length > 100000 || typeof a.exportedAt !== 'string') throw new Error('Expected a v2 Trace JSON file');
  validateSnapshot(a.lastSnapshot);
  for (const p of a.points) {
    if (!p || ![p.ts, p.ipcUs, p.jitterUs].every(Number.isFinite) || p.ipcUs < 0 || p.jitterUs < 0) throw new Error('Invalid trace point');
  }
  if (a.benchmark) {
    if (!['qnx-8.0-live','qnx-8.0-sim','verified-qnx-8.0-capture'].includes(a.benchmark.source) || typeof a.benchmark.hostLabel !== 'string' || typeof a.benchmark.capturedAt !== 'string') throw new Error('Invalid benchmark metadata');
    for (const side of [a.benchmark.piOff, a.benchmark.piOn]) {
      if (!side || !['avgE2eUs','p99E2eUs','maxE2eUs','p99JitterUs','prioBoosts','deadlineMisses','samples'].every(k => Number.isFinite(side[k as keyof BenchmarkSide]))) throw new Error('Invalid benchmark');
    }
  }
  return a;
}
export async function loadVerifiedCapture(): Promise<TraceArchive> {
  const ctrl = new AbortController(); const timer=setTimeout(()=>ctrl.abort(),5000);
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}captures/qnx8-qemu-verified-trace.json`,{signal:ctrl.signal});
    if (!res.ok) throw new Error('Capture HTTP ' + res.status);
    return parseTrace(await res.json());
  } finally {clearTimeout(timer);}
}

// Never infer a boost from the fault-injection switch: only measured priority/events.
export function observedBoost(s: Snapshot): boolean {
  return s.threads.some(th => th.priority > th.real_priority);
}
export function pointsFromSnapshot(s: Snapshot, afterSeq: number): OscPoint[] {
  return s.events.filter(e => e.kind === 6 && e.seq > afterSeq).map(e => ({
    seq: e.seq, ts: e.ts_ns / 1000000, ipcUs: e.latency_us, jitterUs: e.jitter_us,
    boosted: s.events.some(b => b.kind === 3 && b.ts_ns <= e.ts_ns && e.ts_ns - b.ts_ns < 50000000),
    anomaly: e.latency_us > 5000,
  }));
}
