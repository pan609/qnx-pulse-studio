import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  BookOpen,
  Cpu,
  ExternalLink,
  Globe,
  RotateCcw,
  Radio,
  ShieldAlert,
  Zap,
} from 'lucide-react';
import type { FaultConfig, OscPoint, Snapshot } from './types';
import { DICT, type Lang } from './i18n';
import { QnxSimEngine } from './simulator';
import {
  VERIFIED_QNX8_BENCHMARK,
  createVerifiedTraceArchive,
  type BenchmarkComparison,
  type TraceArchive,
} from './benchmark';
import { IpcTopology } from './components/IpcTopology';
import { Oscilloscope } from './components/Oscilloscope';
import { ResmgrConsole } from './components/ResmgrConsole';
import { AiCopilot } from './components/AiCopilot';
import { BenchmarkDeck } from './components/BenchmarkDeck';

const API_BASE = import.meta.env.VITE_QNX_API_BASE || '';

export const App: React.FC = () => {
  const simRef = useRef<QnxSimEngine>(new QnxSimEngine());
  const { forceDemo, initialLang } = useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    const paramLang = params.get('lang');
    const saved = window.localStorage.getItem('qnx-pulse-lang');
    const lang: Lang =
      paramLang === 'zh' || paramLang === 'en'
        ? paramLang
        : saved === 'zh' || saved === 'en'
          ? saved
          : 'en';
    return { forceDemo: params.get('demo') === '1', initialLang: lang };
  }, []);

  const [lang, setLang] = useState<Lang>(initialLang);
  const [showGuide, setShowGuide] = useState<boolean>(true);
  const [mode, setMode] = useState<'auto' | 'sim'>(forceDemo ? 'sim' : 'auto');
  const [liveConnected, setLiveConnected] = useState(false);
  const [snapshot, setSnapshot] = useState<Snapshot>(() => simRef.current.tick());
  const [oscPoints, setOscPoints] = useState<OscPoint[]>([]);
  const [activePreset, setActivePreset] = useState<string>('nominal');
  const [benchmark, setBenchmark] = useState<BenchmarkComparison>(VERIFIED_QNX8_BENCHMARK);
  const [benchPhase, setBenchPhase] = useState<'idle' | 'pi-off' | 'pi-on'>('idle');
  const [replayMode, setReplayMode] = useState(false);

  const snapshotRef = useRef<Snapshot>(snapshot);
  snapshotRef.current = snapshot;

  const t = DICT[lang];

  const toggleLang = () => {
    setLang((prev) => {
      const next: Lang = prev === 'en' ? 'zh' : 'en';
      window.localStorage.setItem('qnx-pulse-lang', next);
      return next;
    });
  };

  const appendOsc = useCallback((snap: Snapshot) => {
    const lastEvt = snap.events[snap.events.length - 1];
    const pt: OscPoint = {
      ts: Date.now(),
      ipcUs: lastEvt?.latency_us || snap.metrics.avg_ipc_us,
      jitterUs: snap.metrics.last_jitter_us,
      boosted: snap.config.fault_prio_inversion && snap.config.prio_inherit_enabled,
      anomaly:
        snap.metrics.last_jitter_us > 5000 ||
        (snap.config.fault_prio_inversion && !snap.config.prio_inherit_enabled) ||
        snap.config.fault_reply_stall,
    };
    setOscPoints((prev) => [...prev.slice(-79), pt]);
  }, []);

  useEffect(() => {
    if (replayMode) return;
    let alive = true;
    const poll = async () => {
      if (mode === 'auto') {
        try {
          const ctrl = new AbortController();
          const timer = setTimeout(() => ctrl.abort(), 650);
          const res = await fetch(`${API_BASE}/api/snapshot`, { signal: ctrl.signal });
          clearTimeout(timer);
          if (res.ok) {
            const data: Snapshot = await res.json();
            if (alive) {
              setLiveConnected(true);
              setSnapshot(data);
              appendOsc(data);
              return;
            }
          }
        } catch {
          // Fall through cleanly to simulated QNX 8.0 trace engine
        }
      }

      if (alive) {
        setLiveConnected(false);
        const simSnap = simRef.current.tick();
        setSnapshot(simSnap);
        appendOsc(simSnap);
      }
    };

    poll();
    const id = setInterval(poll, 350);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [mode, replayMode, appendOsc]);

  const applyConfig = async (patch: Partial<FaultConfig>, presetKey?: string) => {
    if (replayMode) setReplayMode(false);
    if (presetKey) setActivePreset(presetKey);
    const nextCfg: FaultConfig = { ...snapshotRef.current.config, ...patch };

    if (liveConnected && mode === 'auto') {
      try {
        await fetch(`${API_BASE}/api/control`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(nextCfg),
        });
        return;
      } catch {
        // Fallback to simulator
      }
    }
    simRef.current.updateConfig(nextCfg);
    setSnapshot(simRef.current.tick());
  };

  const handleReset = async () => {
    setOscPoints([]);
    if (liveConnected && mode === 'auto') {
      try {
        await fetch(`${API_BASE}/api/control`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reset: true }),
        });
        return;
      } catch {
        // Fallback
      }
    }
    simRef.current.reset();
    setSnapshot(simRef.current.tick());
  };

  const handleResmgrCommand = async (cmd: string): Promise<string> => {
    if (liveConnected && mode === 'auto') {
      try {
        const res = await fetch(`${API_BASE}/api/devctl`, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain' },
          body: cmd,
        });
        if (res.ok) return await res.text();
      } catch {
        // Fallback
      }
    }
    return simRef.current.execResmgrCommand(cmd);
  };

  const triggerScenario = (key: 'nominal' | 'inversion' | 'rescue' | 'stall') => {
    if (key === 'nominal') {
      applyConfig(
        {
          prio_inherit_enabled: true,
          fault_prio_inversion: false,
          fault_reply_stall: false,
          fault_cpu_hog: false,
        },
        'nominal'
      );
    } else if (key === 'inversion') {
      applyConfig(
        {
          prio_inherit_enabled: false,
          fault_prio_inversion: true,
          fault_reply_stall: false,
          fault_cpu_hog: true,
        },
        'inversion'
      );
    } else if (key === 'rescue') {
      applyConfig(
        {
          prio_inherit_enabled: true,
          fault_prio_inversion: true,
          fault_reply_stall: false,
          fault_cpu_hog: true,
        },
        'rescue'
      );
    } else {
      applyConfig(
        {
          prio_inherit_enabled: true,
          fault_prio_inversion: false,
          fault_reply_stall: true,
          fault_cpu_hog: false,
        },
        'stall'
      );
    }
  };

  const handleRunAutoBenchmark = async () => {
    if (benchPhase !== 'idle') return;
    setReplayMode(false);

    // Phase 1: 3s PI OFF Priority Inversion
    setBenchPhase('pi-off');
    await handleReset();
    await applyConfig(
      {
        prio_inherit_enabled: false,
        fault_prio_inversion: true,
        fault_reply_stall: false,
        fault_cpu_hog: true,
      },
      'inversion'
    );
    await new Promise((r) => setTimeout(r, 3000));
    const snapOff = snapshotRef.current;

    // Phase 2: 3s PI ON QNX Priority Inheritance Rescue
    setBenchPhase('pi-on');
    await handleReset();
    await applyConfig(
      {
        prio_inherit_enabled: true,
        fault_prio_inversion: true,
        fault_reply_stall: false,
        fault_cpu_hog: true,
      },
      'rescue'
    );
    await new Promise((r) => setTimeout(r, 3000));
    const snapOn = snapshotRef.current;

    setBenchmark({
      capturedAt: new Date().toLocaleTimeString(),
      source: liveConnected ? 'qnx-8.0-live' : 'qnx-8.0-sim',
      hostLabel: `${snapOn.host.sysname} ${snapOn.host.release} ${snapOn.host.machine} · ${(snapOn.cycles_per_sec / 1_000_000).toFixed(1)} MHz`,
      piOff: {
        avgIpcUs: snapOff.metrics.avg_ipc_us,
        maxIpcUs: snapOff.metrics.max_ipc_us,
        p99JitterUs: snapOff.metrics.p99_jitter_us,
        prioBoosts: snapOff.metrics.prio_boost_count,
        deadlineMisses: snapOff.metrics.deadline_misses,
        samples: snapOff.metrics.total_ipc_msgs,
      },
      piOn: {
        avgIpcUs: snapOn.metrics.avg_ipc_us,
        maxIpcUs: snapOn.metrics.max_ipc_us,
        p99JitterUs: snapOn.metrics.p99_jitter_us,
        prioBoosts: snapOn.metrics.prio_boost_count,
        deadlineMisses: snapOn.metrics.deadline_misses,
        samples: snapOn.metrics.total_ipc_msgs,
      },
    });
    setBenchPhase('idle');
  };

  const handleExportTrace = () => {
    const archive: TraceArchive = {
      schema: 'qnx-pulse-studio-trace/v1',
      exportedAt: new Date().toISOString(),
      source: snapshot.source,
      host: snapshot.host,
      cycles_per_sec: snapshot.cycles_per_sec,
      points: oscPoints,
      lastSnapshot: snapshot,
    };
    const blob = new Blob([JSON.stringify(archive, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `qnx-pulse-trace-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImportTrace = (archive: TraceArchive) => {
    setReplayMode(true);
    setLiveConnected(archive.lastSnapshot.source === 'qnx-8.0-live');
    setSnapshot(archive.lastSnapshot);
    setOscPoints(archive.points.slice(-80));
  };

  const handleLoadVerifiedCapture = () => {
    handleImportTrace(createVerifiedTraceArchive());
    setBenchmark(VERIFIED_QNX8_BENCHMARK);
  };

  const isCritical =
    (snapshot.config.fault_prio_inversion && !snapshot.config.prio_inherit_enabled) ||
    snapshot.metrics.p99_jitter_us > 5000;

  return (
    <div className="app-shell">
      {/* Top Bar */}
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">
            <Activity size={20} />
          </div>
          <div>
            <h1>QNX Pulse Studio</h1>
            <div className="brand-sub">{t.brandSub}</div>
          </div>
        </div>

        <div className="topbar-right">
          <span className={`status-pill ${liveConnected ? 'live' : 'sim'}`}>
            <span className="dot" />
            {replayMode
              ? lang === 'zh'
                ? '已载入真机实测 Trace'
                : 'REPLAYING QNX 8.0 TRACE'
              : liveConnected
                ? t.livePill
                : t.simPill}
          </span>
          <span className="target-chip">
            {snapshot.host.sysname} {snapshot.host.release} · {snapshot.host.machine} ·{' '}
            {(snapshot.cycles_per_sec / 1_000_000).toFixed(1)} MHz
          </span>
          <a
            href="./codelab/"
            className="btn-codelab"
            target="_blank"
            rel="noreferrer"
          >
            <BookOpen size={13} /> {lang === 'zh' ? '交互式 Codelab 教程' : 'Codelab Tutorial'}{' '}
            <ExternalLink size={11} />
          </a>
          <button
            className="btn-lang"
            onClick={toggleLang}
            title="Switch between English and 中文"
          >
            <Globe size={13} /> {lang === 'en' ? '中文' : 'EN'}
          </button>
          <button className="btn-ghost-sm" onClick={() => setShowGuide((v) => !v)}>
            <BookOpen size={13} /> {t.guideToggle}
          </button>
          <button
            className="btn-ghost-sm"
            onClick={() => {
              setReplayMode(false);
              setMode((m) => (m === 'auto' ? 'sim' : 'auto'));
            }}
          >
            <Radio size={13} /> {mode === 'auto' ? t.autoProbe : t.demoLocked}
          </button>
          <button className="btn-ghost-sm" onClick={handleReset}>
            <RotateCcw size={13} /> {t.resetRing}
          </button>
        </div>
      </header>

      {/* Collapsible 4-Step Interactive Walkthrough */}
      {showGuide && (
        <section className="guide-strip">
          <div className="guide-strip-head">
            <span className="panel-kicker">{t.guideTitle}</span>
          </div>
          <div className="guide-grid">
            {t.guideSteps.map((g, idx) => (
              <div key={g.step} className="guide-card">
                <span className="guide-step">{g.step}</span>
                <strong>{g.title}</strong>
                <p>{g.desc}</p>
                {idx < 3 && (
                  <button
                    className="chip-btn guide-cta"
                    onClick={() =>
                      triggerScenario(idx === 0 ? 'nominal' : idx === 1 ? 'inversion' : 'rescue')
                    }
                  >
                    {lang === 'zh' ? '立即执行此步' : 'Run This Step'}
                  </button>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Precision KPI Strip */}
      <section className="kpi-grid">
        <div className={`kpi-card ${snapshot.metrics.avg_ipc_us > 5000 ? 'alert' : ''}`}>
          <span className="kpi-label">{t.kpiAvgIpc}</span>
          <span className="kpi-value">{snapshot.metrics.avg_ipc_us.toLocaleString()} µs</span>
          <span className="kpi-foot">
            {t.kpiMax}: {snapshot.metrics.max_ipc_us.toLocaleString()} µs
          </span>
        </div>

        <div className={`kpi-card ${isCritical ? 'alert' : 'good'}`}>
          <span className="kpi-label">{t.kpiP99Jitter}</span>
          <span className="kpi-value">{snapshot.metrics.p99_jitter_us.toLocaleString()} µs</span>
          <span className="kpi-foot">{t.kpiDeadline}</span>
        </div>

        <div className="kpi-card good">
          <span className="kpi-label">{t.kpiBoosts}</span>
          <span className="kpi-value">{snapshot.metrics.prio_boost_count.toLocaleString()}</span>
          <span className="kpi-foot">
            {snapshot.config.prio_inherit_enabled ? t.kpiPiEnabled : t.kpiPiDisabled}
          </span>
        </div>

        <div className={`kpi-card ${snapshot.metrics.deadline_misses > 0 ? 'alert' : ''}`}>
          <span className="kpi-label">{t.kpiMisses}</span>
          <span className="kpi-value">{snapshot.metrics.deadline_misses.toLocaleString()}</span>
          <span className="kpi-foot">{t.kpiMissFoot}</span>
        </div>

        <div className="kpi-card">
          <span className="kpi-label">{t.kpiMsgCount}</span>
          <span className="kpi-value">{snapshot.metrics.total_ipc_msgs.toLocaleString()}</span>
          <span className="kpi-foot">
            {snapshot.metrics.total_pulses.toLocaleString()} {t.kpiTimerPulses}
          </span>
        </div>
      </section>

      {/* Row 1: IPC Topology + Fault Lab Deck */}
      <section className="main-grid">
        <IpcTopology snapshot={snapshot} t={t} />

        <div className="panel">
          <div className="panel-header">
            <div>
              <span className="panel-kicker">{t.labKicker}</span>
              <h2 className="title-with-icon">
                <ShieldAlert size={16} /> {t.labTitle}
              </h2>
            </div>
          </div>

          <div className="scenario-grid">
            {t.scenarios.map((sc) => (
              <button
                key={sc.key}
                className={`scenario-btn ${activePreset === sc.key ? 'active' : ''}`}
                onClick={() => triggerScenario(sc.key)}
              >
                <strong>{sc.title}</strong>
                <span>{sc.desc}</span>
              </button>
            ))}
          </div>

          <div className="toggle-list">
            <div className="toggle-row">
              <div className="toggle-info">
                <strong>{t.toggles.piTitle}</strong>
                <span>{t.toggles.piDesc}</span>
              </div>
              <button
                className={`switch-btn ${snapshot.config.prio_inherit_enabled ? 'on-good' : 'on-danger'}`}
                onClick={() =>
                  applyConfig({ prio_inherit_enabled: !snapshot.config.prio_inherit_enabled }, 'custom')
                }
              >
                {snapshot.config.prio_inherit_enabled ? t.toggles.onPi : t.toggles.off}
              </button>
            </div>

            <div className="toggle-row">
              <div className="toggle-info">
                <strong>{t.toggles.invTitle}</strong>
                <span>{t.toggles.invDesc}</span>
              </div>
              <button
                className={`switch-btn ${snapshot.config.fault_prio_inversion ? 'on-danger' : ''}`}
                onClick={() =>
                  applyConfig({ fault_prio_inversion: !snapshot.config.fault_prio_inversion }, 'custom')
                }
              >
                {snapshot.config.fault_prio_inversion ? t.toggles.active : t.toggles.off}
              </button>
            </div>

            <div className="toggle-row">
              <div className="toggle-info">
                <strong>{t.toggles.stallTitle}</strong>
                <span>{t.toggles.stallDesc(snapshot.config.stall_ms)}</span>
              </div>
              <button
                className={`switch-btn ${snapshot.config.fault_reply_stall ? 'on-warn' : ''}`}
                onClick={() =>
                  applyConfig({ fault_reply_stall: !snapshot.config.fault_reply_stall }, 'custom')
                }
              >
                {snapshot.config.fault_reply_stall ? t.toggles.stalled : t.toggles.off}
              </button>
            </div>

            <div className="toggle-row">
              <div className="toggle-info">
                <strong>{t.toggles.hogTitle}</strong>
                <span>{t.toggles.hogDesc}</span>
              </div>
              <button
                className={`switch-btn ${snapshot.config.fault_cpu_hog ? 'on-warn' : ''}`}
                onClick={() =>
                  applyConfig({ fault_cpu_hog: !snapshot.config.fault_cpu_hog }, 'custom')
                }
              >
                {snapshot.config.fault_cpu_hog ? t.toggles.running : t.toggles.off}
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* Row 2: Real-Time Oscilloscope + /proc Thread State Matrix */}
      <section className="main-grid">
        <Oscilloscope points={oscPoints} deadlineUs={5000} t={t} />

        <div className="panel">
          <div className="panel-header">
            <div>
              <span className="panel-kicker">{t.threadsKicker}</span>
              <h2 className="title-with-icon">
                <Cpu size={16} /> {t.threadsTitle}
              </h2>
            </div>
          </div>
          <table className="thread-table">
            <thead>
              <tr>
                <th>{t.thThread}</th>
                <th>{t.thPolicy}</th>
                <th>{t.thEffPrio}</th>
                <th>{t.thState}</th>
                <th>{t.thCpu}</th>
              </tr>
            </thead>
            <tbody>
              {snapshot.threads.map((th) => (
                <tr key={`${th.pid}-${th.tid}-${th.name}`}>
                  <td>
                    {th.name}
                    <span className="muted-text"> #{th.tid}</span>
                  </td>
                  <td>{th.policy.replace('SCHED_', '')}</td>
                  <td>
                    P{th.priority}
                    {th.priority > th.real_priority && (
                      <span className="boost-tag">
                        <Zap size={9} /> +{th.priority - th.real_priority}
                      </span>
                    )}
                  </td>
                  <td>
                    <span className={`state-pill state-${th.state}`}>{th.state}</span>
                  </td>
                  <td>cpu{th.cpu}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Row 3: A/B Determinism Benchmark & Trace Export/Replay */}
      <BenchmarkDeck
        lang={lang}
        benchmark={benchmark}
        runningPhase={benchPhase}
        replayMode={replayMode}
        onRunAutoBenchmark={handleRunAutoBenchmark}
        onExportTrace={handleExportTrace}
        onImportTrace={handleImportTrace}
        onLoadVerifiedCapture={handleLoadVerifiedCapture}
        onExitReplay={() => setReplayMode(false)}
      />

      {/* Row 4: AI Microkernel Co-Pilot + /dev/pulse_scope POSIX Console */}
      <section className="bottom-grid">
        <AiCopilot snapshot={snapshot} lang={lang} t={t} />
        <ResmgrConsole onSendCommand={handleResmgrCommand} t={t} />
      </section>
    </div>
  );
};
