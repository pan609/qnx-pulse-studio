import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Activity, BookOpen, Cpu, Globe, RotateCcw, ShieldAlert } from 'lucide-react';
import type { FaultConfig, OscPoint, Snapshot } from './types';
import { DICT, type Lang } from './i18n';
import { QnxSimEngine } from './simulator';
import { benchmarkSide, loadVerifiedCapture, parseTrace, pointsFromSnapshot, validateSnapshot, type BenchmarkComparison, type TraceArchive } from './benchmark';
import { IpcTopology } from './components/IpcTopology';
import { Oscilloscope } from './components/Oscilloscope';
import { ResmgrConsole } from './components/ResmgrConsole';
import { AiCopilot } from './components/AiCopilot';
import { BenchmarkDeck } from './components/BenchmarkDeck';

type Mode = 'replay' | 'live' | 'sim';
const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
const presets: Record<string, Partial<FaultConfig>> = {
  nominal: { prio_inherit_enabled: true, fault_prio_inversion: false, fault_reply_stall: false, fault_cpu_hog: false },
  inversion: { prio_inherit_enabled: false, fault_prio_inversion: true, fault_reply_stall: false, fault_cpu_hog: true },
  rescue: { prio_inherit_enabled: true, fault_prio_inversion: true, fault_reply_stall: false, fault_cpu_hog: true },
  stall: { prio_inherit_enabled: true, fault_prio_inversion: false, fault_reply_stall: true, fault_cpu_hog: false },
};
export const App: React.FC = () => {
  const sim = useRef(new QnxSimEngine());
  const params = useMemo(() => new URLSearchParams(location.search), []);
  const [lang, setLang] = useState<Lang>(() => params.get('lang') === 'zh' || localStorage.getItem('qnx-pulse-lang') === 'zh' && params.get('lang') !== 'en' ? 'zh' : 'en');
  const [hasData, setHasData] = useState(params.get('demo') === '1');
  const [mode, setMode] = useState<Mode>(params.get('demo') === '1' ? 'sim' : 'replay');
  const [showGuide, setShowGuide] = useState(false);
  const [targetUrl, setTargetUrl] = useState(import.meta.env.VITE_QNX_API_BASE || 'http://127.0.0.1:8080');
  const [target, setTarget] = useState('http://127.0.0.1:8080');
  const [liveConnected, setConnected] = useState(false);
  const [snapshot, setSnapshot] = useState<Snapshot>(() => sim.current.tick());
  const [oscPoints, setOscPoints] = useState<OscPoint[]>([]);
  const [benchmark, setBenchmark] = useState<BenchmarkComparison | null>(null);
  const [benchPhase, setBenchPhase] = useState<'idle'|'pi-off'|'pi-on'>('idle');
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const [scopePid, setScopePid] = useState('1');
  const [activePreset, setActivePreset] = useState('');
  const lastSeq = useRef(0);
  const running = useRef(false);
  const current = useRef(snapshot); current.current = snapshot;
  const archiveRef = useRef<TraceArchive | null>(null);
  const t = DICT[lang]; const zh = lang === 'zh'; const busy = benchPhase !== 'idle' || pending;

  const accept = useCallback((s: Snapshot) => {
    if (s.snapshot_ns < current.current.snapshot_ns) lastSeq.current = 0;
    const points = pointsFromSnapshot(s, lastSeq.current);
    lastSeq.current = Math.max(lastSeq.current, ...s.events.map(e => e.seq));
    setHasData(true); setSnapshot(s);
    if (points.length) setOscPoints(prev => [...prev, ...points].slice(-300));
  }, []);
  const api = useCallback(async (path: string, payload?: unknown, raw = false) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2500);
    try {
      const res = await fetch(`${target}${path}`, { signal: controller.signal,
        method: payload === undefined ? 'GET' : 'POST',
        headers: payload === undefined ? {} : { 'Content-Type': raw ? 'text/plain' : 'application/json' },
        body: payload === undefined ? undefined : raw ? String(payload) : JSON.stringify(payload) });
      if (!res.ok) throw new Error(`Target HTTP ${res.status}`);
      return raw ? res.text() : res.json();
    } finally { clearTimeout(timeout); }
  }, [target]);
  const readTarget = useCallback(async () => {
    const s: unknown = await api('/api/snapshot'); validateSnapshot(s);
    if (s.source !== 'qnx-8.0-live' || s.host.sysname !== 'QNX' || !s.host.release.startsWith('8.')) throw new Error('Target is not a QNX 8 telemetry service');
    return s;
  }, [api]);
  const importTrace = useCallback((value: TraceArchive) => {
    const a = parseTrace(value);
    archiveRef.current = a;
    setMode('replay'); setConnected(false); setError('');
    setHasData(true); setSnapshot(a.lastSnapshot); setOscPoints(a.points); setBenchmark(a.benchmark || null);
    lastSeq.current = 0;
  }, []);
  const loadCapture = useCallback(async () => {
    setPending(true);
    try { importTrace(await loadVerifiedCapture()); } catch (e) { setError(String(e)); }
    finally { setPending(false); }
  }, [importTrace]);
  useEffect(() => { if (params.get('demo') !== '1') void loadCapture(); }, [loadCapture, params]);
  useEffect(() => {
    if (mode === 'replay') return;
    let alive = true; let id: ReturnType<typeof setTimeout>;
    const poll = async () => {
      if (!running.current) {
        try {
          const s = mode === 'live' ? await readTarget() : sim.current.tick();
          if (alive) { accept(s); setConnected(mode === 'live'); }
        } catch (e) {
          if (alive) { setConnected(false); setError(`Connection stopped: ${String(e)}. No simulated data substituted.`); }
          return; // Failed targets require an explicit reconnect; no repeated 404 polling.
        }
      }
      if (alive) id = setTimeout(poll, 350);
    };
    void poll();
    return () => { alive = false; clearTimeout(id); };
  }, [mode, target, readTarget, accept]);

  const control = async (patch: Partial<FaultConfig>) => {
    if (mode === 'replay') throw new Error('Recorded trace is read-only. Connect a target or select Simulation.');
    if (mode === 'live') { if (!liveConnected) throw new Error('Reconnect the QNX target first'); const result = await api('/api/control', patch); return Number(result.generation); }
    else { sim.current.updateConfig(patch); return sim.current.config.generation; }
  };
  const apply = async (patch: Partial<FaultConfig>, key = '') => {
    setPending(true); setError('');
    try { await control(patch); setActivePreset(key); if (mode === 'sim') accept(sim.current.tick()); }
    catch (e) { setError(String(e)); } finally { setPending(false); }
  };
  const reset = async () => {
    try {
      if (mode === 'replay') { await loadCapture(); return; }
      if (mode === 'live') await api('/api/control', {reset:true}); else sim.current.reset();
      lastSeq.current = 0; setOscPoints([]);
    } catch (e) { setError(String(e)); }
  };
  const connect = () => {
    try {
      const url = new URL(targetUrl);
      if (!['http:','https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('Enter an HTTP(S) target origin, e.g. http://127.0.0.1:8080');
      setError(''); setConnected(false); setBenchmark(null); setOscPoints([]); lastSeq.current = 0;
      // Reconnecting to the same URL restarts the effect through a replay transition.
      setMode('replay'); setTarget(url.origin); setTimeout(() => setMode('live'), 0);
    } catch (e) { setError(String(e)); }
  };
  const runBenchmark = async () => {
    if (running.current || mode === 'replay' || mode === 'live' && !liveConnected) return;
    running.current = true; setError(''); setOscPoints([]); setBenchmark(null);
    const restore = {...current.current.config};
    const samples: {phase: string; receivedAt: string; snapshot: Snapshot}[] = [];
    const points: OscPoint[] = [];
    try {
      const phase = async (key: 'pi-off'|'pi-on') => {
        setBenchPhase(key);
        const cfg = {...(key === 'pi-off' ? presets.inversion : presets.rescue), scope_mode: 'lab' as const, tick_period_ms:50, stall_ms:35};
        const generation = await control(cfg);
        // Event 7 is emitted by the single sensor loop after finishing its previous E2E cycle.
        const limit = performance.now()+8000; let acknowledged=false;
        while (performance.now()<limit) {
          const s = mode === 'live' ? await readTarget() : sim.current.tick();
          if (s.config.generation === generation && s.events.some(e=>e.kind===7 && e.flags===generation)) {acknowledged=true;break;}
          await sleep(100);
        }
        if (!acknowledged) throw new Error('Workload did not acknowledge configuration generation');
        if (mode === 'live') await api('/api/control', {reset:true}); else sim.current.reset();
        lastSeq.current = 0;
        const end = performance.now() + 3000; let result: Snapshot = current.current;
        while (performance.now() < end) {
          await sleep(200);
          result = mode === 'live' ? await readTarget() : sim.current.tick();
          if (result.config.generation !== generation || Object.entries(cfg).some(([k,v]) => result.config[k as keyof FaultConfig] !== v)) throw new Error('Benchmark configuration changed during sampling');
          points.push(...pointsFromSnapshot(result, lastSeq.current).map(p => ({...p, phase:key})));
          samples.push({phase:key, receivedAt:new Date().toISOString(), snapshot:result}); accept(result);
        }
        if (!result.metrics.total_cycles) throw new Error('No E2E cycles recorded');
        return result;
      };
      const off = await phase('pi-off'); const on = await phase('pi-on');
      const comparison: BenchmarkComparison = { capturedAt:new Date().toISOString(), source:on.source,
        hostLabel:`${on.host.sysname} ${on.host.release} ${on.host.machine}`, piOff:benchmarkSide(off), piOn:benchmarkSide(on) };
      setBenchmark(comparison);
      archiveRef.current = { schema:'qnx-pulse-studio-trace/v2', exportedAt:new Date().toISOString(), source:on.source,
        host:on.host, cycles_per_sec:on.cycles_per_sec, points, lastSnapshot:on, benchmark:comparison,
        phaseSnapshots:{'pi-off':off,'pi-on':on}, snapshots:samples };
    } catch (e) { setError('Benchmark aborted: ' + String(e)); }
    finally {
      try { await control(restore); } catch (e) { setError('Target restore failed: ' + String(e)); }
      running.current = false; setBenchPhase('idle');
    }
  };
  const exportTrace = () => {
    const a: TraceArchive = mode === 'replay' && archiveRef.current ? archiveRef.current :
      archiveRef.current && benchmark ? archiveRef.current : {schema:'qnx-pulse-studio-trace/v2', exportedAt:new Date().toISOString(),
        source:snapshot.source, host:snapshot.host, cycles_per_sec:snapshot.cycles_per_sec, points:oscPoints, lastSnapshot:snapshot};
    const url = URL.createObjectURL(new Blob([JSON.stringify(a,null,2)], {type:'application/json'}));
    const el = document.createElement('a'); el.href = url; el.download = `qnx-pulse-trace-${Date.now()}.json`; el.click(); URL.revokeObjectURL(url);
  };
  const command = async (cmd: string): Promise<string> => {
    if (busy) throw new Error('Benchmark in progress');
    if (mode === 'replay') return 'READ-ONLY RECORDED TRACE: connect a QNX target or choose Simulation.';
    return mode === 'live' ? api('/api/devctl', cmd, true) : sim.current.execResmgrCommand(cmd);
  };
  if (!hasData) return <div className="app-shell"><h1>QNX Pulse Studio</h1>
    <p role="status">{error ? 'No recorded data loaded.' : 'Loading recorded QNX capture…'}</p>
    {error && <div role="alert" className="err-banner">{error}</div>}
    <div className="connection-bar"><button className="btn-primary-sm" disabled={pending} onClick={loadCapture}>Retry capture</button>
    <button className="btn-ghost-sm" disabled={pending} onClick={()=>{setError('');setMode('sim');}}>Simulation</button>
    <label>Target URL <input aria-label="Target URL" value={targetUrl} onChange={e=>setTargetUrl(e.target.value)}/></label>
    <button className="btn-ghost-sm" disabled={pending} onClick={connect}>Connect QNX</button></div></div>;
  const m = snapshot.metrics;
  return <div className="app-shell">
    <header className="topbar">
      <div className="brand"><div className="brand-mark"><Activity size={20}/></div><div><h1>QNX Pulse Studio</h1><div className="brand-sub">{zh ? '微内核调度观测台' : 'Microkernel scheduling observatory'}</div></div></div>
      <div className="topbar-right">
        <span className={`status-pill ${mode === 'replay' ? 'replay' : liveConnected ? 'live' : 'sim'}`}><span className="dot"/>{mode === 'replay' ? (zh ? '离线 Trace · 非实时' : 'RECORDED TRACE · OFFLINE') : liveConnected ? 'LIVE QNX 8.0' : mode === 'sim' ? 'SIMULATION · SYNTHETIC' : 'TARGET DISCONNECTED'}</span>
        <a className="btn-codelab" href="./codelab/"><BookOpen size={13}/> Codelab</a>
        <button className="btn-lang" onClick={() => { const l = zh ? 'en':'zh'; setLang(l); localStorage.setItem('qnx-pulse-lang',l); }}><Globe size={13}/>{zh ? 'EN':'中文'}</button>
        <button className="btn-ghost-sm" onClick={() => setShowGuide(v=>!v)}>{zh ? '使用指南':'Guide'}</button>
      </div>
    </header>
    <div className="connection-bar">
      <label>{zh ? '目标地址':'Target URL'} <input aria-label="Target URL" value={targetUrl} onChange={e=>setTargetUrl(e.target.value)} disabled={busy}/></label>
      <button className="btn-primary-sm" onClick={connect} disabled={busy}>{zh ? '连接 QNX':'Connect QNX'}</button>
      <button className="btn-ghost-sm" onClick={loadCapture} disabled={busy}>{zh ? '实测回放':'Recorded capture'}</button>
      <button className="btn-ghost-sm" disabled={busy} onClick={() => {archiveRef.current=null; setMode('sim'); setConnected(false); setBenchmark(null); setOscPoints([]); lastSeq.current=0; setError('');}}>{zh ? '模拟实验':'Simulation'}</button>
      <button className="btn-ghost-sm" disabled={busy} onClick={reset}><RotateCcw size={13}/>{zh ? '重置':'Reset'}</button>
    </div>
    {error && <div role="alert" className="err-banner">{error}</div>}
    {showGuide && <section className="guide-strip"><strong>{zh ? '实测回放默认只读。连接目标后可注入故障；模拟实验的数据为合成。':'Recorded capture is read-only. Connect your target for fault injection, or select explicitly synthetic Simulation.'}</strong><p>{zh ? 'HTTPS 页面连接本地 HTTP 目标可能被浏览器拦截；可按教程在本地启动 Studio。':'A hosted HTTPS page may block an HTTP target. Run Studio locally as described in the Codelab.'}</p></section>}
    <section className="kpi-grid">
      {[
        [zh?'平均 E2E 响应':'Mean E2E response',`${m.avg_e2e_us.toLocaleString()} µs`, `Max ${m.max_e2e_us} µs`],
        [zh?'P99 E2E 响应':'P99 E2E response',`${m.p99_e2e_us.toLocaleString()} µs`,zh?'5,000 µs 实验预算':'5,000 µs lab budget'],
        [zh?'P99 唤醒间隔抖动':'P99 wakeup interval jitter',`${m.p99_jitter_us.toLocaleString()} µs`,zh?'独立统计桶':'Separate sample bucket'],
        [zh?'超期周期 / 总周期':'Missed / total cycles',`${m.deadline_misses} / ${m.total_cycles}`,zh?'每个 E2E 周期至多计一次':'At most once per E2E cycle'],
        [zh?'记录的提权事件':'Recorded boost events',m.prio_boost_count.toLocaleString(),`${m.total_ipc_msgs} IPC messages`],
      ].map(([label,value,foot],i)=><div className={`kpi-card ${i===1&&m.p99_e2e_us>5000?'alert':''}`} key={label}><span className="kpi-label">{label}</span><span className="kpi-value">{value}</span><span className="kpi-foot">{foot}</span></div>)}
    </section>
    <section className="main-grid workspace-grid">
      <div className="workspace-signals"><IpcTopology snapshot={snapshot} t={t}/><Oscilloscope points={oscPoints} t={t}/></div>
      <div className="panel lab-panel"><div className="panel-header"><div><span className="panel-kicker">{zh?'受控故障实验':'CONTROLLED FAULT LAB'}</span><h2 className="title-with-icon"><ShieldAlert size={16}/>{t.labTitle}</h2></div></div>
        {mode === 'replay' && <p className="muted-text">{zh?'此处为离线实测。请选择“连接 QNX”或“模拟实验”以操作。':'Offline recording. Connect QNX or choose Simulation to operate.'}</p>}
        <fieldset disabled={busy || mode === 'replay' || mode === 'live' && !liveConnected}>
          <div className="scenario-grid">{t.scenarios.map(sc=><button key={sc.key} className={`scenario-btn ${activePreset===sc.key?'active':''}`} onClick={()=>apply(presets[sc.key],sc.key)}><strong>{sc.title}</strong><span>{sc.desc}</span></button>)}</div>
          <div className="toggle-row"><strong>{zh?'互斥锁优先级继承':'Mutex priority inheritance'}</strong><button className={`switch-btn ${snapshot.config.prio_inherit_enabled?'on-good':'on-danger'}`} onClick={()=>apply({prio_inherit_enabled:!snapshot.config.prio_inherit_enabled})}>{snapshot.config.prio_inherit_enabled?'PI ON':'PI OFF'}</button></div>
          <label className="scope-control">{zh?'线程观测范围':'Thread observation scope'}<select aria-label="Thread observation scope" value={snapshot.config.scope_mode} onChange={e=>apply({scope_mode:e.target.value as FaultConfig['scope_mode'],scope_pid:Number(scopePid)})}><option value="lab">lab</option><option value="all">all (bounded scan)</option><option value="pid">pid</option></select></label>
          <label className="scope-control">PID<input aria-label="Scope PID" type="number" min="1" value={scopePid} onChange={e=>setScopePid(e.target.value)}/><button className="btn-ghost-sm" disabled={!Number.isSafeInteger(Number(scopePid))||Number(scopePid)<1} onClick={()=>apply({scope_mode:'pid',scope_pid:Number(scopePid)})}>{zh?'观测 PID':'Inspect PID'}</button></label>
        </fieldset>
        <p className="muted-text">{zh?'范围过滤仅影响线程表；E2E 计时始终来自内置实验。最多 48 个线程、每进程 16 个，非原子快照；采样可能漏掉短暂状态。':'Scope filters threads only; E2E metrics always describe the built-in lab. Up to 48 threads, 16 per process; scans are non-atomic and can miss short states.'}</p>
      </div>
    </section>
    <BenchmarkDeck lang={lang} benchmark={benchmark} runningPhase={benchPhase} replayMode={mode==='replay'} canRun={mode!=='replay' && (mode==='sim'||liveConnected) && !pending} onRunAutoBenchmark={runBenchmark} onExportTrace={exportTrace} onImportTrace={importTrace} onLoadVerifiedCapture={loadCapture} onExitReplay={()=>{setMode('sim');setConnected(false);setBenchmark(null);setOscPoints([]);lastSeq.current=0;}}/>
    <section className="panel"><div className="panel-header"><div><span className="panel-kicker">/proc · DCMD_PROC_TIDSTATUS</span><h2 className="title-with-icon"><Cpu size={16}/>{t.threadsTitle}</h2></div><span className="muted-text">{snapshot.host.sysname} {snapshot.host.release} · {snapshot.host.machine} · {(snapshot.cycles_per_sec/1000000).toFixed(1)} MHz</span></div>
      <div className="table-scroll"><table className="thread-table"><thead><tr><th>PID/TID · {t.thThread}</th><th>{t.thPolicy}</th><th>{t.thEffPrio}</th><th>{t.thState}</th><th>{t.thCpu}</th><th>Blocked PID</th></tr></thead><tbody>{snapshot.threads.map(th=><tr key={`${th.pid}:${th.tid}`}><td><span className="muted-text">{th.pid}/{th.tid} </span>{th.name}<small> {th.proc_name}</small></td><td>{th.policy.replace('SCHED_','')}</td><td>P{th.real_priority} → <strong>P{th.priority}</strong></td><td><span className={`state-pill state-${th.state}`}>{th.state}</span></td><td>{th.cpu}</td><td>{th.blocked_on_pid||'—'}</td></tr>)}</tbody></table></div>
    </section>
    <section className="bottom-grid"><AiCopilot snapshot={snapshot} lang={lang} t={t}/><ResmgrConsole onSendCommand={command} t={t}/></section>
  </div>;
};
