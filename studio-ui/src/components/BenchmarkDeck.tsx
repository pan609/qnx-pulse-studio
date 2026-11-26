import React, { useRef } from 'react';
import { BarChart3, Download, Play, Upload, History, RotateCcw } from 'lucide-react';
import type { BenchmarkComparison, TraceArchive } from '../benchmark';
import type { Lang } from '../i18n';

interface Props {
  lang: Lang;
  benchmark: BenchmarkComparison;
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
  benchmark,
  runningPhase,
  replayMode,
  onRunAutoBenchmark,
  onExportTrace,
  onImportTrace,
  onLoadVerifiedCapture,
  onExitReplay,
}) => {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const zh = lang === 'zh';

  const jitterRatio =
    benchmark.piOn.p99JitterUs > 0
      ? (benchmark.piOff.p99JitterUs / benchmark.piOn.p99JitterUs).toFixed(1)
      : '—';
  const ipcRatio =
    benchmark.piOn.avgIpcUs > 0
      ? (benchmark.piOff.avgIpcUs / benchmark.piOn.avgIpcUs).toFixed(1)
      : '—';

  const maxJ = Math.max(benchmark.piOff.p99JitterUs, benchmark.piOn.p99JitterUs, 5000);
  const offPct = Math.max(6, Math.round((benchmark.piOff.p99JitterUs / maxJ) * 100));
  const onPct = Math.max(6, Math.round((benchmark.piOn.p99JitterUs / maxJ) * 100));

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result)) as TraceArchive;
        if (parsed && Array.isArray(parsed.points) && parsed.lastSnapshot) {
          onImportTrace(parsed);
        }
      } catch {
        // Ignore malformed files cleanly
      }
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
            disabled={runningPhase !== 'idle'}
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
                  ? '运行 6 秒一键 A/B 对比'
                  : 'Run 6s Auto A/B Benchmark'}
          </button>

          <button className="btn-ghost-sm" onClick={onExportTrace}>
            <Download size={13} /> {zh ? '导出 Trace JSON' : 'Export Trace'}
          </button>

          <button className="btn-ghost-sm" onClick={() => fileRef.current?.click()}>
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
            <button className="btn-lang" onClick={onExitReplay}>
              <RotateCcw size={13} /> {zh ? '退出回放 · 恢复实时' : 'Exit Replay'}
            </button>
          ) : (
            <button className="btn-ghost-sm" onClick={onLoadVerifiedCapture}>
              <History size={13} /> {zh ? '载入真机实测轨迹' : 'Replay Verified QNX 8.0 Capture'}
            </button>
          )}
        </div>
      </div>

      <div className="bench-meta">
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

      <div className="bench-grid">
        <div className="bench-card bench-off">
          <div className="bench-card-head">
            <span className="sev-pill critical">PI OFF · PTHREAD_PRIO_NONE</span>
            <span className="muted-text">{benchmark.piOff.samples} IPC msgs</span>
          </div>
          <div className="bench-stat-row">
            <div>
              <span className="kpi-label">{zh ? 'P99 唤醒抖动' : 'P99 Wakeup Jitter'}</span>
              <div className="bench-big crimson-text">
                {benchmark.piOff.p99JitterUs.toLocaleString()} µs
              </div>
            </div>
            <div>
              <span className="kpi-label">{zh ? '平均 IPC 延迟' : 'Avg E2E IPC'}</span>
              <div className="bench-med">{benchmark.piOff.avgIpcUs.toLocaleString()} µs</div>
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
          <span className="kpi-label">{zh ? 'QNX PI 抖动压降' : 'JITTER REDUCTION'}</span>
          <div className="delta-hero">{jitterRatio}×</div>
          <span className="delta-sub">
            {zh ? `平均 IPC 提速 ${ipcRatio}×` : `${ipcRatio}× faster Avg IPC`}
          </span>
          <span className="legend-pill emerald">
            +{benchmark.piOn.prioBoosts} {zh ? '次内核提权' : 'Kernel Boosts'}
          </span>
        </div>

        <div className="bench-card bench-on">
          <div className="bench-card-head">
            <span className="sev-pill nominal">PI ON · PTHREAD_PRIO_INHERIT</span>
            <span className="muted-text">{benchmark.piOn.samples} IPC msgs</span>
          </div>
          <div className="bench-stat-row">
            <div>
              <span className="kpi-label">{zh ? 'P99 唤醒抖动' : 'P99 Wakeup Jitter'}</span>
              <div className="bench-big emerald-text">
                {benchmark.piOn.p99JitterUs.toLocaleString()} µs
              </div>
            </div>
            <div>
              <span className="kpi-label">{zh ? '平均 IPC 延迟' : 'Avg E2E IPC'}</span>
              <div className="bench-med">{benchmark.piOn.avgIpcUs.toLocaleString()} µs</div>
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
    </section>
  );
};
