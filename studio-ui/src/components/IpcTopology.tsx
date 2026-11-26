import React from 'react';
import type { Dict } from '../i18n';
import type { Snapshot } from '../types';
export const IpcTopology: React.FC<{snapshot:Snapshot;t:Dict}> = ({snapshot,t}) => {
  const threads = snapshot.threads.slice(0,9);
  const waits = snapshot.threads.filter(th=>['SEND','REPLY'].includes(th.state) && th.blocked_on_pid>0);
  return <div className="panel topology-panel"><div className="panel-header"><div><span className="panel-kicker">OBSERVED THREAD STATES · SAMPLED /proc</span><h2>{t.topoTitle}</h2></div></div>
    <div className="observed-nodes">{threads.map(th=><div className={`observed-node ${th.priority>th.real_priority?'boosted':''}`} key={`${th.pid}:${th.tid}`}><strong>{th.name}</strong><span>{th.pid}/{th.tid} · CPU {th.cpu}</span><div><b>P{th.real_priority} → P{th.priority}</b><span className={`state-pill state-${th.state}`}>{th.state}</span></div></div>)}</div>
    <div className="wait-links">{waits.length ? waits.map(th=><code key={`${th.pid}:${th.tid}`}>{th.pid}/{th.tid} ({th.state}) → PID {th.blocked_on_pid}</code>) : <span className="muted-text">No SEND/REPLY destination observed in this sample.</span>}</div>
    <p className="muted-text topology-note">Effective priority comes from /proc, including native IPC inheritance independently of the lab mutex switch. Wait arrows identify a process, not an inferred receiving thread or mutex owner.</p>
  </div>;
};
