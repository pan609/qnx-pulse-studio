import React from 'react';
import type { Dict } from '../i18n';
import type { Snapshot } from '../types';

interface Props {
  snapshot: Snapshot;
  t: Dict;
}

export const IpcTopology: React.FC<Props> = ({ snapshot, t }) => {
  const { config, metrics, threads } = snapshot;
  const isInversionCrisis = config.fault_prio_inversion && !config.prio_inherit_enabled;
  const isRescued = config.fault_prio_inversion && config.prio_inherit_enabled;
  const isReplyStall = config.fault_reply_stall;
  const isCpuHog = config.fault_cpu_hog || config.fault_prio_inversion;

  const findThread = (substr: string) =>
    threads.find((th) => th.name.toLowerCase().includes(substr));

  const sensorT = findThread('sensor');
  const ctrlT = findThread('controller');
  const actT = findThread('actuator');
  const lowT = findThread('low_calib');

  const ipcStroke = isReplyStall ? '#f59e0b' : isInversionCrisis ? '#ef4444' : '#22d3ee';
  const lowPrioLabel = isRescued ? 'P15 → P30 BOOST' : `P${lowT?.priority ?? 15}`;

  return (
    <div className="panel topology-panel">
      <div className="panel-header">
        <div>
          <span className="panel-kicker">{t.topoKicker}</span>
          <h2>{t.topoTitle}</h2>
        </div>
        <div className="legend-row">
          <span className="legend-pill cyan">{t.legendIpc}</span>
          <span className="legend-pill emerald">{t.legendBoost}</span>
          <span className="legend-pill amber">{t.legendReplyBlk}</span>
          <span className="legend-pill crimson">{t.legendInversion}</span>
        </div>
      </div>

      <svg
        viewBox="0 0 860 320"
        className="topology-svg"
        role="img"
        aria-label="QNX 8.0 Microkernel IPC Topology"
      >
        <defs>
          <marker id="arrow-cyan" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M 0 1 L 10 5 L 0 9 z" fill="#22d3ee" />
          </marker>
          <marker id="arrow-amber" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M 0 1 L 10 5 L 0 9 z" fill="#f59e0b" />
          </marker>
          <marker id="arrow-red" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M 0 1 L 10 5 L 0 9 z" fill="#ef4444" />
          </marker>
          <marker id="arrow-emerald" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M 0 1 L 10 5 L 0 9 z" fill="#10b981" />
          </marker>
        </defs>

        <pattern id="grid" width="24" height="24" patternUnits="userSpaceOnUse">
          <path d="M 24 0 L 0 0 0 24" fill="none" stroke="rgba(148,163,184,0.06)" strokeWidth="1" />
        </pattern>
        <rect x="0" y="0" width="860" height="320" fill="url(#grid)" rx="8" />

        <line
          x1="150"
          y1="78"
          x2="215"
          y2="78"
          stroke="#22d3ee"
          strokeWidth="2"
          strokeDasharray="6 4"
          className="flow-line"
          markerEnd="url(#arrow-cyan)"
        />
        <text x="182" y="66" textAnchor="middle" className="edge-label cyan-text">
          SIGEV_PULSE
        </text>
        <text x="182" y="96" textAnchor="middle" className="edge-sub">
          {Math.round(1000 / Math.max(10, config.tick_period_ms))} Hz
        </text>

        <line
          x1="395"
          y1="78"
          x2="455"
          y2="78"
          stroke={ipcStroke}
          strokeWidth="2.5"
          className={isReplyStall ? 'flow-line-slow' : 'flow-line'}
          strokeDasharray="8 5"
          markerEnd={isReplyStall ? 'url(#arrow-amber)' : isInversionCrisis ? 'url(#arrow-red)' : 'url(#arrow-cyan)'}
        />
        <text x="425" y="65" textAnchor="middle" className="edge-label">
          MsgSend()
        </text>
        <text x="425" y="96" textAnchor="middle" className="edge-sub">
          {isReplyStall ? 'REPLY-BLK' : 'sync IPC'}
        </text>

        <line
          x1="635"
          y1="78"
          x2="690"
          y2="78"
          stroke={isReplyStall ? '#f59e0b' : '#22d3ee'}
          strokeWidth="2.5"
          className={isReplyStall ? 'flow-line-slow' : 'flow-line'}
          strokeDasharray="8 5"
          markerEnd={isReplyStall ? 'url(#arrow-amber)' : 'url(#arrow-cyan)'}
        />
        <text x="662" y="65" textAnchor="middle" className="edge-label">
          MsgSend()
        </text>
        <text x="662" y="96" textAnchor="middle" className="edge-sub">
          {isReplyStall ? `${config.stall_ms}ms stall` : `${metrics.avg_ipc_us}µs`}
        </text>

        <path
          d="M 305 122 L 305 178"
          stroke={isInversionCrisis ? '#ef4444' : isRescued ? '#10b981' : '#334155'}
          strokeWidth={config.fault_prio_inversion ? '2.5' : '1.5'}
          strokeDasharray="5 4"
          markerEnd={isInversionCrisis ? 'url(#arrow-red)' : isRescued ? 'url(#arrow-emerald)' : undefined}
        />
        <rect
          x="232"
          y="138"
          width="146"
          height="22"
          rx="4"
          fill="#0b1220"
          stroke={isInversionCrisis ? '#ef4444' : isRescued ? '#10b981' : '#334155'}
        />
        <text x="305" y="153" textAnchor="middle" className="edge-sub-strong">
          {config.prio_inherit_enabled ? 'PTHREAD_PRIO_INHERIT' : 'PTHREAD_PRIO_NONE'}
        </text>

        <line
          x1="460"
          y1="212"
          x2="395"
          y2="212"
          stroke={isInversionCrisis ? '#ef4444' : isCpuHog ? '#f59e0b' : '#334155'}
          strokeWidth={isCpuHog ? '2' : '1.2'}
          strokeDasharray="4 4"
          markerEnd={isInversionCrisis ? 'url(#arrow-red)' : isCpuHog ? 'url(#arrow-amber)' : undefined}
        />
        <text x="428" y="203" textAnchor="middle" className="edge-sub">
          {isInversionCrisis ? t.topoPreempts : isRescued ? t.topoBlocked : t.topoIdle}
        </text>

        <path
          d="M 545 122 L 545 258 L 620 258"
          fill="none"
          stroke="rgba(34,211,238,0.45)"
          strokeWidth="1.5"
          strokeDasharray="4 4"
        />
        <path
          d="M 768 122 L 768 258 L 745 258"
          fill="none"
          stroke="rgba(34,211,238,0.45)"
          strokeWidth="1.5"
          strokeDasharray="4 4"
        />

        <g transform="translate(18, 36)">
          <rect width="132" height="84" rx="8" className="node-box" stroke="#1e3a5f" />
          <text x="12" y="22" className="node-kicker">QNX KERNEL TIMER</text>
          <text x="12" y="42" className="node-title">CLOCK_MONOTONIC</text>
          <text x="12" y="60" className="node-meta">CNTVCT_EL0</text>
          <text x="12" y="74" className="node-meta cyan-text">
            {(snapshot.cycles_per_sec / 1_000_000).toFixed(1)} MHz ClockCycles
          </text>
        </g>

        <g transform="translate(218, 36)">
          <rect
            width="176"
            height="84"
            rx="8"
            className="node-box"
            stroke={isInversionCrisis ? '#ef4444' : isReplyStall ? '#f59e0b' : '#22d3ee'}
            strokeWidth={isInversionCrisis ? 2 : 1.4}
          />
          <text x="12" y="21" className="node-kicker">STAGE 1 · SCHED_FIFO</text>
          <text x="12" y="41" className="node-title">sensor_rt_loop</text>
          <rect x="120" y="10" width="46" height="18" rx="4" fill="rgba(34,211,238,0.16)" />
          <text x="143" y="23" textAnchor="middle" className="prio-badge">P{sensorT?.priority ?? 30}</text>
          <text x="12" y="60" className="node-meta">
            {t.topoState}: <tspan fill={isInversionCrisis ? '#f87171' : '#38bdf8'}>{sensorT?.state ?? 'RUNNING'}</tspan>
          </text>
          <text x="12" y="74" className="node-meta">{t.topoJitter}: {metrics.last_jitter_us.toLocaleString()} µs</text>
        </g>

        <g transform="translate(458, 36)">
          <rect
            width="176"
            height="84"
            rx="8"
            className="node-box"
            stroke={isReplyStall ? '#f59e0b' : '#22d3ee'}
            strokeWidth={isReplyStall ? 2 : 1.4}
          />
          <text x="12" y="21" className="node-kicker">STAGE 2 · IPC SERVER</text>
          <text x="12" y="41" className="node-title">controller_srv</text>
          <rect x="112" y="10" width="54" height="18" rx="4" fill="rgba(16,185,129,0.18)" />
          <text x="139" y="23" textAnchor="middle" className="prio-badge emerald-text">
            {config.prio_inherit_enabled ? 'P25→30' : 'P25'}
          </text>
          <text x="12" y="60" className="node-meta">
            {t.topoState}: <tspan fill={isReplyStall ? '#fbbf24' : '#34d399'}>{ctrlT?.state ?? 'RECEIVE'}</tspan>
          </text>
          <text x="12" y="74" className="node-meta">ChannelCreate(0)</text>
        </g>

        <g transform="translate(692, 36)">
          <rect
            width="150"
            height="84"
            rx="8"
            className="node-box"
            stroke={isReplyStall ? '#f59e0b' : '#334155'}
            strokeWidth={isReplyStall ? 2 : 1.4}
          />
          <text x="12" y="21" className="node-kicker">STAGE 3 · ACTUATOR</text>
          <text x="12" y="41" className="node-title">actuator_srv</text>
          <rect x="94" y="10" width="46" height="18" rx="4" fill="rgba(16,185,129,0.16)" />
          <text x="117" y="23" textAnchor="middle" className="prio-badge">
            {config.prio_inherit_enabled ? 'P20→30' : 'P20'}
          </text>
          <text x="12" y="60" className="node-meta">
            {t.topoState}: <tspan fill={isReplyStall ? '#fbbf24' : '#94a3b8'}>{actT?.state ?? 'RECEIVE'}</tspan>
          </text>
          <text x="12" y="74" className="node-meta">MsgReply() sink</text>
        </g>

        <g transform="translate(218, 178)">
          <rect
            width="176"
            height="68"
            rx="8"
            className="node-box"
            stroke={isRescued ? '#10b981' : isInversionCrisis ? '#ef4444' : '#334155'}
            strokeWidth={isRescued || isInversionCrisis ? 2 : 1.2}
          />
          <text x="12" y="20" className="node-kicker">{t.topoMutexHolder}</text>
          <text x="12" y="39" className="node-title">low_calib_worker</text>
          <text x="12" y="56" className="node-meta">
            {t.topoEffPrio}:{' '}
            <tspan fill={isRescued ? '#10b981' : isInversionCrisis ? '#f87171' : '#94a3b8'}>
              {lowPrioLabel}
            </tspan>
          </text>
        </g>

        <g transform="translate(460, 178)">
          <rect
            width="148"
            height="68"
            rx="8"
            className="node-box"
            stroke={isCpuHog ? '#f59e0b' : '#334155'}
            strokeWidth={isCpuHog ? 1.8 : 1.2}
          />
          <text x="12" y="20" className="node-kicker">{t.topoInterference}</text>
          <text x="12" y="39" className="node-title">med_cpu_hog</text>
          <text x="12" y="56" className="node-meta">
            P24 · <tspan fill={isCpuHog ? '#fbbf24' : '#64748b'}>{isCpuHog ? t.topoBurning : t.topoSleeping}</tspan>
          </text>
        </g>

        <g transform="translate(622, 224)">
          <rect width="220" height="76" rx="8" fill="#0c1929" stroke="#22d3ee" strokeWidth="1.4" />
          <text x="12" y="20" className="node-kicker cyan-text">{t.topoResmgrKicker}</text>
          <text x="12" y="39" className="node-title">/dev/pulse_scope</text>
          <text x="12" y="56" className="node-meta">devctl() + /proc/&lt;pid&gt;/as</text>
          <text x="12" y="69" className="node-meta emerald-text">
            {t.topoMsgsBoosts(metrics.total_ipc_msgs.toLocaleString(), metrics.prio_boost_count)}
          </text>
        </g>
      </svg>
    </div>
  );
};
