import type { Snapshot, DiagnosticReport } from './types';
import type { Lang } from './i18n';

export function analyzeSnapshotDeterministic(s: Snapshot, lang: Lang = 'en'): DiagnosticReport {
  const zh = lang === 'zh';
  const blocked = s.threads.filter(t => ['MUTEX','REPLY','SEND'].includes(t.state));
  const boosted = s.threads.filter(t => t.priority > t.real_priority);
  const inversion = s.threads.some(high => high.state === 'MUTEX' && s.threads.some(low =>
    low.pid === high.pid && low.cpu === high.cpu && low.state === 'READY' && low.priority < high.priority &&
    s.threads.some(mid => mid.cpu === high.cpu && mid.state === 'RUNNING' && mid.priority > low.priority && mid.priority < high.priority)));
  const breach = s.metrics.p99_e2e_us > 5000;
  const reply = blocked.some(t => ['REPLY','SEND'].includes(t.state));
  const title = inversion ? (zh ? '观测到优先级反转候选链' : 'Candidate priority inversion chain observed')
    : breach ? (zh ? `E2E 超期：P99 ${s.metrics.p99_e2e_us} µs > 5000 µs` : `E2E budget exceeded: P99 ${s.metrics.p99_e2e_us} µs > 5000 µs`)
    : reply ? (zh ? '观测到同步 IPC 等待' : 'Synchronous IPC wait observed')
    : boosted.length ? (zh ? '观测到有效优先级提升' : 'Effective-priority elevation observed')
    : (zh ? '本次快照未定位到异常链' : 'No anomalous chain identified in this snapshot');
  return {
    severity: inversion || breach ? 'critical' : reply ? 'warning' : 'nominal', title,
    summary: zh ? '基于线程快照和实测指标的本地规则分析；不是内核事件追踪器，也不是大模型推理。采样可能错过短暂的阻塞或提权，候选关联不等于已证实根因。'
      : 'Local rule-based analysis of sampled thread states and measured metrics. Sampling can miss brief waits or boosts; candidate correlations do not prove mutex ownership or root cause.',
    rootCause: [
      ...blocked.map(t => `${t.name} PID ${t.pid}/TID ${t.tid}: ${t.state}, P${t.priority}, blocked_on_pid=${t.blocked_on_pid || 'unknown'}`),
      ...boosted.map(t => `${t.name}: base P${t.real_priority} → effective P${t.priority}`),
      ...(inversion ? [zh ? '同 CPU 上高优先级 MUTEX 等待、低优先级 READY 与中优先级 RUNNING 同时出现；需用原生 trace 确认锁持有者。' : 'High-priority MUTEX wait, lower READY and intermediate RUNNING share a CPU. Use native tracing to establish lock ownership.'] : []),
      ...(blocked.length || boosted.length ? [] : [zh ? '当前未捕获阻塞链；不能据此断言系统一直健康。' : 'No blocked chain captured; this does not establish continuous system health.']),
    ],
    qnxApiEvidence: [`DCMD_PROC_TIDSTATUS: ${s.threads.length} sampled threads`,
      `ClockCycles: P99 E2E=${s.metrics.p99_e2e_us} µs; wakeup interval jitter=${s.metrics.p99_jitter_us} µs`,
      `E2E cycles=${s.metrics.total_cycles}; misses=${s.metrics.deadline_misses}; boost events=${s.metrics.prio_boost_count}`],
    codeFixTitle: zh ? '建议核查（并非自动修复）' : 'Suggested investigation (not an automatic fix)',
    codeFixDiff: inversion ? '/* Verify the actual shared mutex and its owner first. */\npthread_mutexattr_setprotocol(&attr, PTHREAD_PRIO_INHERIT);\n/* Measure on target again; QEMU measurements do not guarantee WCET. */'
      : reply ? '/* Inspect the receiving process and MsgReply() paths. */\n/* Every successful MsgReceive() request needs a reply or explicit error. */'
      : '/* Capture a longer native tracelogger session if a deadline breach persists. */\n/* Correlate thread IDs, CPU scheduling and IPC replies before changing code. */',
    generatedBy: 'deterministic-kernel-engine', timestamp: new Date().toLocaleTimeString(),
  };
}

/**
 * Optional BYOK LLM analysis over real QNX 8.0 telemetry JSON.
 */
export async function analyzeSnapshotWithLlm(
  snap: Snapshot,
  endpoint: string,
  apiKey: string,
  model: string,
  lang: Lang = 'en'
): Promise<DiagnosticReport> {
  const baseline = analyzeSnapshotDeterministic(snap, lang);
  if (!apiKey.trim()) return baseline;

  const langHint = lang === 'zh' ? 'Write all prose fields in concise Simplified Chinese.' : 'Write all prose fields in concise technical English.';
  const prompt = `You are a Principal QNX 8.0 Microkernel Engineer. Analyze this telemetry JSON (source may be live, recorded or simulated; do not assume live) captured from /dev/pulse_scope and /proc/<pid>/as (DCMD_PROC_TIDSTATUS). ${langHint}
Return strictly JSON with keys: severity ("nominal"|"warning"|"critical"), title, summary, rootCause (array of 3 concise strings), qnxApiEvidence (array of 2-3 strings), codeFixTitle, codeFixDiff (short QNX C API diff).

Snapshot:
${JSON.stringify({ source: snap.source, host: snap.host, metrics: snap.metrics, threads: snap.threads.slice(0, 8) })}`;

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey.trim()}`,
    },
    body: JSON.stringify({
      model: model || 'gpt-4o-mini',
      temperature: 0.2,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: 'You output strictly valid JSON for QNX 8.0 RTOS trace diagnostics.' },
        { role: 'user', content: prompt },
      ],
    }),
  });

  if (!res.ok) {
    throw new Error(`LLM HTTP ${res.status}`);
  }
  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content;
  if (!content) throw new Error('Empty LLM response');
  const parsed = JSON.parse(content);
  if (!parsed || !['nominal','warning','critical'].includes(parsed.severity) ||
      !['title','summary','codeFixTitle','codeFixDiff'].every(k => typeof parsed[k] === 'string') ||
      !['rootCause','qnxApiEvidence'].every(k => Array.isArray(parsed[k]) && parsed[k].every((x:unknown) => typeof x === 'string'))) throw new Error('Invalid LLM analysis schema');
  return {
    severity: parsed.severity || baseline.severity,
    title: parsed.title || baseline.title,
    summary: parsed.summary || baseline.summary,
    rootCause: Array.isArray(parsed.rootCause) ? parsed.rootCause : baseline.rootCause,
    qnxApiEvidence: Array.isArray(parsed.qnxApiEvidence) ? parsed.qnxApiEvidence : baseline.qnxApiEvidence,
    codeFixTitle: parsed.codeFixTitle || baseline.codeFixTitle,
    codeFixDiff: parsed.codeFixDiff || baseline.codeFixDiff,
    generatedBy: 'llm-copilot',
    timestamp: new Date().toLocaleTimeString(),
  };
}
