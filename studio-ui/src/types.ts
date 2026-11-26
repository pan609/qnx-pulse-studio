export interface HostInfo {
  sysname: string;
  release: string;
  machine: string;
  nodename: string;
}

export interface TelemetryMetrics {
  total_ipc_msgs: number;
  total_cycles: number;
  avg_e2e_us: number;
  p99_e2e_us: number;
  max_e2e_us: number;
  last_e2e_us: number;
  avg_jitter_us: number;
  max_jitter_us: number;
  total_pulses: number;
  prio_boost_count: number;
  deadline_misses: number;
  avg_ipc_us: number;
  max_ipc_us: number;
  p99_jitter_us: number;
  last_jitter_us: number;
}

export interface FaultConfig {
  prio_inherit_enabled: boolean;
  fault_prio_inversion: boolean;
  fault_reply_stall: boolean;
  fault_cpu_hog: boolean;
  tick_period_ms: number;
  stall_ms: number;
  scope_mode: 'lab' | 'all' | 'pid';
  scope_pid: number;
  generation: number;
}

export interface ThreadSnap {
  pid: number;
  tid: number;
  name: string;
  proc_name?: string;
  priority: number;
  real_priority: number;
  state: string;
  policy: string;
  blocked_on_pid: number;
  cpu: number;
}

export interface TelemetryEvent {
  seq: number;
  ts_ns: number;
  kind: number; // 1=IPC_HOP, 2=PULSE_TICK, 3=PRIO_BOOST, 4=FAULT_TOGGLE, 5=DEVCTL, 6=E2E_CYCLE, 7=CONFIG_APPLIED
  src_pid: number;
  dst_pid: number;
  src_prio: number;
  dst_prio: number;
  latency_us: number;
  jitter_us: number;
  flags: number; // kind 7: config generation; other kinds: bit0=prio_inherit, bit1=anomaly
  label: string;
}

export interface Snapshot {
  source: 'qnx-8.0-live' | 'qnx-8.0-sim';
  host: HostInfo;
  snapshot_ns: number;
  cycles_per_sec: number;
  metrics: TelemetryMetrics;
  config: FaultConfig;
  threads: ThreadSnap[];
  events: TelemetryEvent[];
}

export interface OscPoint {
  seq?: number;
  phase?: string;
  ts: number;
  ipcUs: number;
  jitterUs: number;
  boosted: boolean;
  anomaly: boolean;
}

export interface DiagnosticReport {
  severity: 'nominal' | 'warning' | 'critical';
  title: string;
  summary: string;
  rootCause: string[];
  qnxApiEvidence: string[];
  codeFixTitle: string;
  codeFixDiff: string;
  generatedBy: 'deterministic-kernel-engine' | 'llm-copilot';
  timestamp: string;
}
