import React, { useRef } from 'react';
import { BarChart3, Download, Play, Upload, History, RotateCcw } from 'lucide-react';
import { parseTrace, type BenchmarkComparison, type TraceArchive } from '../benchmark';
import type { Lang } from '../i18n';

interface Props {
  lang: Lang;
  benchmark: BenchmarkComparison | null;
  canRun: boolean;
  runningPhase: 'idle' | 'pi-off' | 'pi-on';
  replayMode: boolean;
  onRunAutoBenchmark: () => void;
  onExportTrace: () => void;
  onImportTrace: (archive: TraceArchive) => void;
  onLoadVerifiedCapture: () => void;
  onExitReplay: () => void;
}

export const BenchmarkDeck: React.FC<Props> = ({
  lang,
  canRun,
  benchmark,
  runningPhase,
  replayMode,
  onRunAutoBenchmark,
  onExportTrace,
  onImportTrace,
  onLoadVerifiedCapture,
  onExitReplay,
}) => {
  const [importError, setImportError] = React.useState('');
  const fileRef = useRef<HTMLInputElement | null>(null);
  const zh = lang === 'zh';

  const empty = {avgE2eUs:0,p99E2eUs:0,maxE2eUs:0,p99JitterUs:0,prioBoosts:0,deadlineMisses:0,samples:0};
  const measured = benchmark;
  benchmark = benchmark || {capturedAt:'—',source:'qnx-8.0-sim',hostLabel:'No A/B measurement loaded',piOff:empty,piOn:empty};
  const jitterRatio =
    benchmark.piOn.p99E2eUs > 0
      ? (benchmark.piOff.p99E2eUs / benchmark.piOn.p99E2eUs).toFixed(1)
      : '—';
  const ipcRatio =
    benchmark.piOn.avgE2eUs > 0
      ? (benchmark.piOff.avgE2eUs / benchmark.piOn.avgE2eUs).toFixed(1)
      : '—';

  const maxJ = Math.max(benchmark.piOff.p99E2eUs, benchmark.piOn.p99E2eUs, 5000);
  const offPct = Math.max(6, Math.round((benchmark.piOff.p99E2eUs / maxJ) * 100));
  const onPct = Math.max(6, Math.round((benchmark.piOn.p99E2eUs / maxJ) * 100));

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 12 * 1024 * 1024) {setImportError('Trace exceeds 12 MB'); return;}
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = parseTrace(JSON.parse(String(reader.result)));
        if (parsed && Array.isArray(parsed.points) && parsed.lastSnapshot) {
          onImportTrace(parsed);
        }
        setImportError('');
      } catch (e) { setImportError(String(e)); }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  return (
    <section className="panel bench-panel">
      <div className="panel-header">
        <div>
          <span className="panel-kicker">
            {zh
              ? 'PI OFF vs PI ON 一键对比基准 & 轨迹回放'
              : 'SIDE-BY-SIDE A/B DETERMINISM BENCHMARK & TRACE REPLAY'}
          </span>
          <h2 className="title-with-icon">
            <BarChart3 size={16} />{' '}
            {zh
              ? 'QNX 8.0 优先级继承前后实测对比（可导出/导入 Trace JSON）'
              : 'QNX 8.0 Priority Inheritance Proof (Export / Replay Trace JSON)'}
          </h2>
        </div>

        <div className="btn-row flex-wrap">
          <button
            className="btn-primary-sm"
            onClick={onRunAutoBenchmark}
            disabled={runningPhase !== 'idle' || !canRun}
          >
            <Play size={13} />{' '}
            {runningPhase === 'pi-off'
              ? zh
                ? '采样 PI OFF (3s)...'
                : 'Sampling PI OFF (3s)...'
              : runningPhase === 'pi-on'
                ? zh
                  ? '采样 PI ON (3s)...'
                  : 'Sampling PI ON (3s)...'
                : zh
                  ? '运行 A/B · 两阶段各 3 秒'
                  : 'Run A/B · 3s per phase + settle'}
          </button>

          <button className="btn-ghost-sm" disabled={runningPhase !== 'idle'} onClick={onExportTrace}>
            <Download size={13} /> {zh ? '导出 Trace JSON' : 'Export Trace'}
          </button>

          <button className="btn-ghost-sm" disabled={runningPhase !== 'idle'} onClick={() => fileRef.current?.click()}>
            <Upload size={13} /> {zh ? '导入回放' : 'Import Trace'}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            style={{ display: 'none' }}
            onChange={handleFile}
          />

          {replayMode ? (
            <button className="btn-lang" disabled={runningPhase !== 'idle'} onClick={onExitReplay}>
              <RotateCcw size={13} /> {zh ? '退出回放 · 模拟实验' : 'Exit Replay → Simulation'}
            </button>
          ) : (
            <button className="btn-ghost-sm" disabled={runningPhase !== 'idle'} onClick={onLoadVerifiedCapture}>
              <History size={13} /> {zh ? '载入真机实测轨迹' : 'Replay Verified QNX 8.0 Capture'}
            </button>
          )}
        </div>
      </div>

      {importError && <div role="alert" className="err-banner">{importError}</div>}
      <div className="bench-meta">
        <span className="legend-pill amber">{measured ? benchmark.source : 'NO A/B DATA'}</span>
        <span className="target-chip">{benchmark.hostLabel}</span>
        <span className="muted-text">
          {zh ? '采样来源' : 'Captured'}: {benchmark.capturedAt}
        </span>
        {replayMode && (
          <span className="legend-pill amber">
            {zh ? '当前处于静态 Trace 回放模式' : 'REPLAY MODE ACTIVE (SNAPSHOT FROZEN)'}
          </span>
        )}
      </div>

      <div className="bench-grid" style={{opacity:measured?1:0.45}}>
        <div className="bench-card bench-off">
          <div className="bench-card-head">
            <span className="sev-pill critical">PI OFF · PTHREAD_PRIO_NONE</span>
            <span className="muted-text">{benchmark.piOff.samples} E2E cycles</span>
          </div>
          <div className="bench-stat-row">
            <div>
              <span className="kpi-label">{zh ? 'P99 E2E 响应' : 'P99 E2E response'}</span>
              <div className="bench-big crimson-text">
                {benchmark.piOff.p99E2eUs.toLocaleString()} µs
              </div>
            </div>
            <div>
              <span className="kpi-label">{zh ? '平均 E2E 响应' : 'Mean E2E response'}</span>
              <div className="bench-med">{benchmark.piOff.avgE2eUs.toLocaleString()} µs</div>
            </div>
            <div>
              <span className="kpi-label">{zh ? '提权 / 超时' : 'Boosts / Misses'}</span>
              <div className="bench-med">
                {benchmark.piOff.prioBoosts} / <span className="crimson-text">{benchmark.piOff.deadlineMisses}</span>
              </div>
            </div>
          </div>
          <div className="bar-track">
            <div className="bar-fill bar-red" style={{ width: `${offPct}%` }} />
          </div>
        </div>

        <div className="bench-delta-card">
          <span className="kpi-label">{zh ? 'P99 E2E 比值' : 'P99 E2E RATIO'}</span>
          <div className="delta-hero">{jitterRatio}×</div>
          <span className="delta-sub">
            {zh ? `平均 E2E 比值 ${ipcRatio}×` : `${ipcRatio}× mean E2E ratio`}
          </span>
          <span className="legend-pill emerald">
            +{benchmark.piOn.prioBoosts} {zh ? '次内核提权' : 'Kernel Boosts'}
          </span>
        </div>

        <div className="bench-card bench-on">
          <div className="bench-card-head">
            <span className="sev-pill nominal">PI ON · PTHREAD_PRIO_INHERIT</span>
            <span className="muted-text">{benchmark.piOn.samples} E2E cycles</span>
          </div>
          <div className="bench-stat-row">
            <div>
              <span className="kpi-label">{zh ? 'P99 E2E 响应' : 'P99 E2E response'}</span>
              <div className="bench-big emerald-text">
                {benchmark.piOn.p99E2eUs.toLocaleString()} µs
              </div>
            </div>
            <div>
              <span className="kpi-label">{zh ? '平均 E2E 响应' : 'Mean E2E response'}</span>
              <div className="bench-med">{benchmark.piOn.avgE2eUs.toLocaleString()} µs</div>
            </div>
            <div>
              <span className="kpi-label">{zh ? '提权 / 超时' : 'Boosts / Misses'}</span>
              <div className="bench-med">
                <span className="emerald-text">{benchmark.piOn.prioBoosts}</span> / {benchmark.piOn.deadlineMisses}
              </div>
            </div>
          </div>
          <div className="bar-track">
            <div className="bar-fill bar-green" style={{ width: `${onPct}%` }} />
          </div>
        </div>
      </div>
      {measured && <p className="aeb-ruler">{zh ? '100 km/h 额外滑行距离（P99 E2E × 27.78 m/s）' : 'At 100 km/h: additional travel during P99 E2E latency'}: PI OFF <strong>{(benchmark.piOff.p99E2eUs / 1000000 * (100/3.6)).toFixed(3)} m</strong> → PI ON <strong>{(benchmark.piOn.p99E2eUs / 1000000 * (100/3.6)).toFixed(3)} m</strong>. {zh?'仅作延迟换算，不代表制动距离或安全保证。':'Latency illustration only; not braking distance or a safety guarantee.'}</p>}
    </section>
  );
};
