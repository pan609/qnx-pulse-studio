#!/usr/bin/env python3
"""Record genuine QNX telemetry; preserve all phase snapshots and E2E events, never synthesize."""
import argparse, collections, datetime, hashlib, json, pathlib, time, urllib.request

ROOT = pathlib.Path(__file__).resolve().parent.parent

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--url', default='http://127.0.0.1:8080')
    parser.add_argument('--seconds', type=float, default=4.5)
    args = parser.parse_args()
    def request(path, data=None):
        req = urllib.request.Request(args.url+path, data=None if data is None else json.dumps(data).encode(),
                                     headers={'Content-Type':'application/json'})
        with urllib.request.urlopen(req, timeout=3) as r:
            return json.load(r)
    original = request('/api/snapshot')
    assert original['source'] == 'qnx-8.0-live' and original['host']['sysname'] == 'QNX'
    assert original['host']['release'].startswith('8.')
    records, points, final, seen = [], [], {}, set()
    utc = lambda: datetime.datetime.now(datetime.timezone.utc).isoformat().replace('+00:00','Z')
    try:
        for phase, enabled, inversion, hog in [('nominal',True,False,False),('pi-off',False,True,True),('pi-on',True,True,True)]:
            cfg = dict(scope_mode='lab', prio_inherit_enabled=enabled, fault_prio_inversion=inversion,
                       fault_reply_stall=False, fault_cpu_hog=hog, tick_period_ms=50, stall_ms=35)
            generation=request('/api/control', cfg)['generation']
            deadline=time.monotonic()+8
            while True:
                ack=request('/api/snapshot')
                if ack['config']['generation']==generation and any(e['kind']==7 and e['flags']==generation for e in ack['events']): break
                if time.monotonic()>deadline: raise RuntimeError('No workload acknowledgement for config generation')
                time.sleep(.1)
            request('/api/control', {'reset':True})
            end = time.monotonic()+args.seconds
            while time.monotonic()<end:
                time.sleep(.15)
                s = request('/api/snapshot')
                assert s['config']['generation']==generation and all(s['config'][k] == v for k,v in cfg.items()), 'Config drift during recording'
                records.append(dict(phase=phase, receivedAt=utc(), snapshot=s))
                for e in s['events']:
                    if e['kind'] != 6 or e['seq'] in seen: continue
                    seen.add(e['seq'])
                    boost = any(b['kind']==3 and 0<=e['ts_ns']-b['ts_ns']<50_000_000 for b in s['events'])
                    points.append(dict(ts=e['ts_ns']/1e6, ipcUs=e['latency_us'], jitterUs=e['jitter_us'],
                                       boosted=boost, anomaly=e['latency_us']>5000, phase=phase, seq=e['seq']))
                final[phase]=s
            print(phase, s['metrics'])
        request('/api/control',{'scope_mode':'all'})
        system = request('/api/snapshot')
        other = [t for t in system['threads'] if not any(x in t.get('proc_name','') for x in ['pulse_scope','ipc_lab','telemetry_agent','slogger'])]
        assert other, 'No non-lab system process observed'
        target_pid=other[0]['pid']
        request('/api/control',{'scope_mode':'pid','scope_pid':target_pid})
        selected=request('/api/snapshot')
        assert selected['threads'] and all(t['pid']==target_pid for t in selected['threads'])
    finally:
        request('/api/control',original['config'])
    def side(s):
        m=s['metrics']
        return dict(avgE2eUs=m['avg_e2e_us'],p99E2eUs=m['p99_e2e_us'],maxE2eUs=m['max_e2e_us'],
                    p99JitterUs=m['p99_jitter_us'],prioBoosts=m['prio_boost_count'],deadlineMisses=m['deadline_misses'],samples=m['total_cycles'])
    on=final['pi-on']
    archive=dict(schema='qnx-pulse-studio-trace/v2',exportedAt=utc(),source='qnx-8.0-live',
                 host=on['host'],cycles_per_sec=on['cycles_per_sec'],points=points,lastSnapshot=on,
                 benchmark=dict(capturedAt=utc(), source='verified-qnx-8.0-capture', hostLabel='QNX 8.0.0 · QEMU virt-7.2 · aarch64le · TCG',
                                piOff=side(final['pi-off']),piOn=side(on)),
                 phaseSnapshots=final,snapshots=records,systemThreadsSnapshot=system,pidScopeSnapshot=selected,
                 notes=['QEMU TCG measurements on one host; no WCET or hardware safety guarantee.',
                        'Thread scans are non-atomic. Temporal correlation is not mutex ownership proof.',
                        'E2E statistics and pulse interval jitter use separate 128-sample windows; max/misses are since reset.'])
    for phase,s in final.items():
        unique=[p for p in points if p['phase']==phase]
        assert len(unique)==s['metrics']['total_cycles'], (phase,len(unique),s['metrics']['total_cycles'])
        assert sum(p['ipcUs']>5000 for p in unique)==s['metrics']['deadline_misses']
        vals=sorted(p['ipcUs'] for p in unique[-128:])
        assert vals[(len(vals)*99+99)//100-1]==s['metrics']['p99_e2e_us']
    out=ROOT/'studio-ui/public/captures/qnx8-qemu-verified-trace.json'
    out.parent.mkdir(exist_ok=True,parents=True)
    out.write_text(json.dumps(archive,indent=2)+'\n')
    files=list((ROOT/'qnx-target/src').glob('*.c'))+list((ROOT/'qnx-target/include').glob('*.h'))+list((ROOT/'qnx-target/build/aarch64le').glob('*'))
    manifest={str(p.relative_to(ROOT)):hashlib.sha256(p.read_bytes()).hexdigest() for p in files if p.is_file()}
    manifest[str(out.relative_to(ROOT))]=hashlib.sha256(out.read_bytes()).hexdigest()
    (ROOT/'docs/capture-sha256.json').write_text(json.dumps(manifest,indent=2)+'\n')
    print('Saved',out,'phases',dict(collections.Counter(p['phase'] for p in points)))

if __name__=='__main__': main()
