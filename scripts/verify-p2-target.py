#!/usr/bin/env python3
"""Focused R2 protocol probes against the actual local QNX bridge; restore config in finally."""
import datetime,json,pathlib,socket,urllib.request
root=pathlib.Path(__file__).resolve().parent.parent
base='http://127.0.0.1:8080'
def request(path,data=None):
    body=None if data is None else json.dumps(data).encode()
    with urllib.request.urlopen(urllib.request.Request(base+path,data=body,headers={'Content-Type':'application/json'}),timeout=4) as r:return json.load(r)
def exchange(body,headers=''):
    raw=(f'POST /api/control HTTP/1.1\r\nHost: localhost\r\nContent-Length: {len(body)}'+headers+'\r\n\r\n').encode()+body
    with socket.create_connection(('127.0.0.1',8080),timeout=4) as s:
        s.sendall(raw);s.shutdown(socket.SHUT_WR);out=b''
        while True:
            chunk=s.recv(8192)
            if not chunk:break
            out+=chunk
    return int(out.split()[1])
original=request('/api/snapshot')['config'];checks=[]
try:
    cases=[(b'{"message":"scope_mode","unrelated":"all"}','',200),
      (b'{"scope_mode":"all"','',400),(b'{"scope_mode":true}','',400),
      (b'{"scope_pid":"45063"}','',400),(b'{"reset":true,"scope_mode":"all"}','',400),
      (b'{"scope_mode":"all","scope_mode":"lab"}','',400),
      (b'{"scope_mode":"all"}\x00trailing','',400),
      (b'{}','\r\nContent-Length: 2',400),(b'{}','\r\ncontent-length: 100',400),
      (b'{}','\r\ntRaNsFeR-EnCoDiNg: chunked',400),(b'{}','\r\nTRANSFER-ENCODING: identity',400)]
    for body,headers,expected in cases:
        before=request('/api/snapshot')['config'];status=exchange(body,headers);after=request('/api/snapshot')['config']
        assert status==expected,(body,headers,status)
        assert before==after,('unexpected mutation',body,headers,before,after)
        checks.append({'body':body.decode(errors='replace'),'headers':headers,'status':status,'configAndGenerationUnchanged':True})
    status=exchange(b'{"scop\\u0065_mode":"all"}')
    assert status==200 and request('/api/snapshot')['config']['scope_mode']=='all'
    checks.append({'escapedRealMember':'scope_mode','status':status,'applied':True})
finally:request('/api/control',original)
restored=request('/api/snapshot')['config']
assert all(restored[k]==v for k,v in original.items() if k!='generation')
output={'result':'PASS','capturedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'checks':checks,'restoredConfig':True}
(root/'docs/p2-target-regression.json').write_text(json.dumps(output,indent=2)+'\n');print('PASS:',len(checks),'actual QNX protocol probes; original configuration restored.')
