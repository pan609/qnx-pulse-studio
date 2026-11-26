import React, { useEffect, useRef } from 'react';
import type { Dict } from '../i18n';
import type { OscPoint } from '../types';

interface Props {
  points: OscPoint[];
  deadlineUs?: number;
  t: Dict;
}

export const Oscilloscope: React.FC<Props> = ({ points, deadlineUs = 5000, t }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const width = canvas.clientWidth || 720;
    const height = canvas.clientHeight || 220;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    ctx.fillStyle = '#070c15';
    ctx.fillRect(0, 0, width, height);

    const padL = 58;
    const padR = 16;
    const padT = 18;
    const padB = 26;
    const plotW = width - padL - padR;
    const plotH = height - padT - padB;

    const maxVal = Math.max(
      deadlineUs * 1.4,
      ...points.map((p) => Math.max(p.ipcUs, p.jitterUs)),
      6500
    );
    const yScale = (val: number) => padT + plotH - Math.min(1, val / maxVal) * plotH;

    ctx.strokeStyle = 'rgba(148, 163, 184, 0.1)';
    ctx.lineWidth = 1;
    ctx.font = '11px "JetBrains Mono", monospace';
    ctx.fillStyle = '#64748b';

    const steps = 4;
    for (let i = 0; i <= steps; i++) {
      const v = (maxVal / steps) * i;
      const y = yScale(v);
      ctx.beginPath();
      ctx.moveTo(padL, y);
      ctx.lineTo(width - padR, y);
      ctx.stroke();
      const lbl = v >= 1000 ? `${(v / 1000).toFixed(1)}ms` : `${Math.round(v)}µs`;
      ctx.fillText(lbl, 8, y + 4);
    }

    const yDeadline = yScale(deadlineUs);
    ctx.save();
    ctx.strokeStyle = 'rgba(239, 68, 68, 0.78)';
    ctx.setLineDash([6, 4]);
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(padL, yDeadline);
    ctx.lineTo(width - padR, yDeadline);
    ctx.stroke();
    ctx.fillStyle = '#f87171';
    ctx.fillText(t.oscDeadlineLine((deadlineUs / 1000).toFixed(0)), padL + 8, yDeadline - 6);
    ctx.restore();

    if (points.length < 2) return;

    const xAt = (idx: number) => padL + (idx / Math.max(1, points.length - 1)) * plotW;

    points.forEach((p, idx) => {
      if (p.anomaly) {
        const x = xAt(idx);
        ctx.fillStyle = 'rgba(239, 68, 68, 0.12)';
        ctx.fillRect(x - 3, padT, 6, plotH);
      } else if (p.boosted) {
        const x = xAt(idx);
        ctx.fillStyle = 'rgba(16, 185, 129, 0.09)';
        ctx.fillRect(x - 2, padT, 4, plotH);
      }
    });

    ctx.beginPath();
    ctx.strokeStyle = '#22d3ee';
    ctx.lineWidth = 2;
    points.forEach((p, idx) => {
      const x = xAt(idx);
      const y = yScale(p.ipcUs);
      if (idx === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();

    ctx.lineTo(xAt(points.length - 1), padT + plotH);
    ctx.lineTo(xAt(0), padT + plotH);
    ctx.closePath();
    const grad = ctx.createLinearGradient(0, padT, 0, padT + plotH);
    grad.addColorStop(0, 'rgba(34, 211, 238, 0.22)');
    grad.addColorStop(1, 'rgba(34, 211, 238, 0.0)');
    ctx.fillStyle = grad;
    ctx.fill();

    ctx.beginPath();
    ctx.strokeStyle = '#f59e0b';
    ctx.lineWidth = 1.8;
    points.forEach((p, idx) => {
      const x = xAt(idx);
      const y = yScale(p.jitterUs);
      if (idx === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();

    const last = points[points.length - 1];
    ctx.fillStyle = last.anomaly ? '#ef4444' : '#22d3ee';
    ctx.beginPath();
    ctx.arc(xAt(points.length - 1), yScale(last.ipcUs), 4, 0, Math.PI * 2);
    ctx.fill();
  }, [points, deadlineUs, t]);

  return (
    <div className="panel osc-panel">
      <div className="panel-header">
        <div>
          <span className="panel-kicker">{t.oscKicker}</span>
          <h2>{t.oscTitle}</h2>
        </div>
        <div className="legend-row">
          <span className="legend-pill cyan">{t.oscE2e}</span>
          <span className="legend-pill amber">{t.oscJitter}</span>
          <span className="legend-pill emerald">{t.oscBoostWin}</span>
        </div>
      </div>
      <canvas ref={canvasRef} className="osc-canvas" />
    </div>
  );
};
