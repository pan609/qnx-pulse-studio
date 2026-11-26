import React, { useState } from 'react';
import { Terminal, Play } from 'lucide-react';
import type { Dict } from '../i18n';

interface Props {
  onSendCommand: (cmd: string) => Promise<string>;
  t: Dict;
}

const PRESET_CMDS = [
  { label: 'cat /dev/pulse_scope', cmd: '' },
  { label: 'prio_inv=1', cmd: 'prio_inv=1' },
  { label: 'prio_inherit=0', cmd: 'prio_inherit=0' },
  { label: 'prio_inherit=1', cmd: 'prio_inherit=1' },
  { label: 'reply_stall=1', cmd: 'reply_stall=1' },
  { label: 'scope=all', cmd: 'scope=all' },
  { label: 'scope=lab', cmd: 'scope=lab' },
  { label: 'reset', cmd: 'reset' },
];

export const ResmgrConsole: React.FC<Props> = ({ onSendCommand, t }) => {
  const [input, setInput] = useState('prio_inherit=1');
  const [history, setHistory] = useState<{ cmd: string; out: string; ts: string }[]>([]);
  const [busy, setBusy] = useState(false);

  const runCmd = async (rawCmd: string, displayLabel?: string) => {
    setBusy(true);
    try {
      const out = await onSendCommand(rawCmd);
      const label =
        displayLabel ?? (rawCmd ? `echo "${rawCmd}" > /dev/pulse_scope && cat /dev/pulse_scope` : 'cat /dev/pulse_scope');
      setHistory((prev) => [{ cmd: label, out, ts: new Date().toLocaleTimeString() }, ...prev].slice(0, 8));
    } catch (e) {
      setHistory(prev => [{cmd:rawCmd, out:String(e), ts:new Date().toLocaleTimeString()}, ...prev].slice(0,8));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="panel console-panel">
      <div className="panel-header">
        <div>
          <span className="panel-kicker">{t.consoleKicker}</span>
          <h2 className="title-with-icon">
            <Terminal size={16} /> {t.consoleTitle}
          </h2>
        </div>
      </div>

      <div className="preset-chips">
        {PRESET_CMDS.map((p) => (
          <button
            key={p.label}
            className="chip-btn"
            disabled={busy}
            onClick={() => runCmd(p.cmd, p.cmd ? `echo "${p.cmd}" > /dev/pulse_scope` : 'cat /dev/pulse_scope')}
          >
            {p.label}
          </button>
        ))}
      </div>

      <form
        className="console-form"
        onSubmit={(e) => {
          e.preventDefault();
          runCmd(input);
        }}
      >
        <span className="console-prompt">qnx8# echo</span>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="prio_inv=1 prio_inherit=0"
          className="console-input"
        />
        <span className="console-prompt">&gt; /dev/pulse_scope</span>
        <button type="submit" className="btn-primary-sm" disabled={busy}>
          <Play size={13} /> {t.consoleRun}
        </button>
      </form>

      <div className="console-log">
        {history.length === 0 ? (
          <div className="console-entry">
            <div className="console-entry-head">
              <span className="cyan-text">$ cat /dev/pulse_scope</span>
            </div>
            <pre className="console-pre">{t.consoleReady}</pre>
          </div>
        ) : (
          history.map((item, idx) => (
            <div key={idx} className="console-entry">
              <div className="console-entry-head">
                <span className="cyan-text">$ {item.cmd}</span>
                <span className="muted-text">{item.ts}</span>
              </div>
              <pre className="console-pre">{item.out}</pre>
            </div>
          ))
        )}
      </div>
    </div>
  );
};
