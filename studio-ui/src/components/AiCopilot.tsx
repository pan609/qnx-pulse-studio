import React, { useEffect, useState } from 'react';
import { Sparkles, Copy, Check, SlidersHorizontal } from 'lucide-react';
import type { Dict, Lang } from '../i18n';
import type { DiagnosticReport, Snapshot } from '../types';
import { analyzeSnapshotDeterministic, analyzeSnapshotWithLlm } from '../diagnostics';

interface Props {
  snapshot: Snapshot;
  lang: Lang;
  t: Dict;
}

export const AiCopilot: React.FC<Props> = ({ snapshot, lang, t }) => {
  const [report, setReport] = useState<DiagnosticReport>(() =>
    analyzeSnapshotDeterministic(snapshot, lang)
  );
  const [analyzing, setAnalyzing] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showLlmConfig, setShowLlmConfig] = useState(false);
  const [llmEndpoint, setLlmEndpoint] = useState('https://api.openai.com/v1/chat/completions');
  const [llmModel, setLlmModel] = useState('gpt-4o-mini');
  const [llmKey, setLlmKey] = useState('');
  const [llmErr, setLlmErr] = useState<string | null>(null);

  // Immediately re-translate built-in report when user toggles EN / 中文
  useEffect(() => {
    setReport(analyzeSnapshotDeterministic(snapshot, lang));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lang]);

  const handleAnalyze = async () => {
    setAnalyzing(true);
    setLlmErr(null);
    try {
      if (llmKey.trim()) {
        const res = await analyzeSnapshotWithLlm(snapshot, llmEndpoint, llmKey, llmModel, lang);
        setReport(res);
      } else {
        setReport(analyzeSnapshotDeterministic(snapshot, lang));
      }
    } catch (err) {
      setLlmErr(`LLM call failed (${String(err)}); fell back to local QNX kernel analyzer.`);
      setReport(analyzeSnapshotDeterministic(snapshot, lang));
    } finally {
      setAnalyzing(false);
    }
  };

  const copyDiff = () => {
    navigator.clipboard?.writeText(report.codeFixDiff);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  return (
    <div className="panel copilot-panel">
      <div className="panel-header">
        <div>
          <span className="panel-kicker">{t.copilotKicker}</span>
          <h2 className="title-with-icon">
            <Sparkles size={16} /> {t.copilotTitle}
          </h2>
        </div>
        <div className="btn-row">
          <button
            className="btn-ghost-sm"
            onClick={() => setShowLlmConfig((v) => !v)}
            title="Optional BYOK OpenAI-compatible LLM endpoint"
          >
            <SlidersHorizontal size={13} /> {llmKey ? t.byokActive : t.byokBtn}
          </button>
          <button className="btn-primary-sm" onClick={handleAnalyze} disabled={analyzing}>
            <Sparkles size={13} /> {analyzing ? t.analyzingBtn : t.analyzeBtn}
          </button>
        </div>
      </div>

      {showLlmConfig && (
        <div className="byok-box">
          <p className="muted-text">{t.byokHint}</p>
          <div className="byok-grid">
            <input
              value={llmEndpoint}
              onChange={(e) => setLlmEndpoint(e.target.value)}
              placeholder="https://api.openai.com/v1/chat/completions"
            />
            <input
              value={llmModel}
              onChange={(e) => setLlmModel(e.target.value)}
              placeholder="gpt-4o-mini"
            />
            <input
              type="password"
              value={llmKey}
              onChange={(e) => setLlmKey(e.target.value)}
              placeholder="sk-... (browser memory only)"
            />
          </div>
        </div>
      )}

      {llmErr && <div className="err-banner">{llmErr}</div>}

      <div className={`diag-banner severity-${report.severity}`}>
        <div className="diag-head">
          <span className={`sev-pill ${report.severity}`}>{t.sevLabels[report.severity]}</span>
          <strong>{report.title}</strong>
          <span className="muted-text diag-ts">
            {report.generatedBy === 'llm-copilot' ? t.engineLlm : t.engineKernel} · {report.timestamp}
          </span>
        </div>
        <p className="diag-summary">{report.summary}</p>
      </div>

      <div className="diag-columns">
        <div>
          <h3 className="subhead">{t.rootCauseHead}</h3>
          <ul className="diag-list">
            {report.rootCause.map((item, i) => (
              <li key={i}>{item}</li>
            ))}
          </ul>
        </div>
        <div>
          <h3 className="subhead">{t.evidenceHead}</h3>
          <ul className="diag-list mono-list">
            {report.qnxApiEvidence.map((item, i) => (
              <li key={i}>{item}</li>
            ))}
          </ul>
        </div>
      </div>

      <div className="code-fix-box">
        <div className="code-fix-head">
          <span>{report.codeFixTitle}</span>
          <button className="btn-ghost-sm" onClick={copyDiff}>
            {copied ? <Check size={13} /> : <Copy size={13} />} {copied ? t.copied : t.copyPatch}
          </button>
        </div>
        <pre className="code-fix-pre">{report.codeFixDiff}</pre>
      </div>
    </div>
  );
};
