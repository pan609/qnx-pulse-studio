#!/usr/bin/env python3
"""Real-target regression for split HTTP bodies, incomplete requests and POSIX JSON output."""
import datetime,json,pathlib,socket,time,urllib.request
ROOT=pathlib.Path(__file__).resolve().parent.parent
URL='http://127.0.0.1:8080'
def request(path,body=None):
    data=None if body is None else json.dumps(body).encode()
    with urllib.request.urlopen(urllib.request.Request(URL+path,data=data,headers={'Content-Type':'application/json'}),timeout=4) as r: return json.load(r)
def exchange(parts,halfclose=False):
    with socket.create_connection(('127.0.0.1',8080),timeout=4) as s:
        for p in parts:
            s.sendall(p);time.sleep(.05)
        if halfclose:s.shutdown(socket.SHUT_WR)
        out=b''
        while True:
            chunk=s.recv(65536)
            if not chunk:break
            out+=chunk
    head,body=out.split(b'\r\n\r\n',1)
    return int(head.split()[1]),json.loads(body)
original=request('/api/snapshot')['config']; checks=[]
try:
    payload=b'{"scope_mode":"all"}'
    header=f'POST /api/control HTTP/1.1\r\nHost: localhost\r\nContent-Length: {len(payload)}\r\n\r\n'.encode()
    status,body=exchange([header[:18],header[18:],payload[:8],payload[8:]])
    assert status==200 and request('/api/snapshot')['config']['scope_mode']=='all';checks.append('split headers/body applied only after complete Content-Length')
    status,body=exchange([b'POST /api/control HTTP/1.1\r\nContent-Length: 60\r\n\r\n{"scope_mode":"lab"}'],True)
    assert status==400 and request('/api/snapshot')['config']['scope_mode']=='all';checks.append('incomplete body rejected without mutation')
    status,body=exchange([b'POST /api/control HTTP/1.1\r\nContent-Length: 10000\r\n\r\n'],True)
    assert status==400;checks.append('oversized body rejected')
    raw=b'unknown="quoted"\n\\backslash\t'
    status,body=exchange([f'POST /api/devctl HTTP/1.1\r\nContent-Length: {len(raw)}\r\n\r\n'.encode(),raw])
    assert status==200 and isinstance(body,dict);checks.append('POSIX write with newline/quotes/backslash yields valid JSON')
    selected=request('/api/snapshot')
    assert selected['threads'] and all(isinstance(t['name'],str) for t in selected['threads']); checks.append('snapshot JSON remains parseable with real system thread names')
finally:request('/api/control',original)
result=dict(capturedAt=datetime.datetime.now(datetime.timezone.utc).isoformat(),host=selected['host'],checks=checks,result='PASS')
(ROOT/'docs/target-smoke.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps(result,indent=2))
