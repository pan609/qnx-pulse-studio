#!/usr/bin/env python3
"""Focused host regressions for the R2 protocol and sparse-TID findings; no target writes."""
import ctypes,json,pathlib,subprocess,tempfile
root=pathlib.Path(__file__).resolve().parent.parent
work=pathlib.Path(tempfile.mkdtemp(prefix='qnx-p2-focused-'))
lib=work/'control.dylib'
subprocess.run(['clang','-std=c11','-Wall','-Wextra','-Werror','-shared','-fPIC',str(root/'qnx-target/src/control_json.c'),'-o',str(lib)],check=True)
library=ctypes.CDLL(str(lib))
class Patch(ctypes.Structure):_fields_=[('present',ctypes.c_uint32),('value',ctypes.c_int32*9)]
library.ps_parse_control_json.argtypes=[ctypes.c_char_p,ctypes.POINTER(Patch)]
library.ps_http_content_length.argtypes=[ctypes.c_char_p,ctypes.c_size_t,ctypes.POINTER(ctypes.c_size_t)]
results=[]
def parse(s,valid,mask=None):
    p=Patch();rc=library.ps_parse_control_json(s.encode(),ctypes.byref(p))
    assert (rc==0)==valid,(s,rc)
    if mask is not None:assert p.present==mask,(s,p.present,mask)
    results.append({'json':s,'accepted':rc==0,'present':p.present if rc==0 else None})
parse('{}',True,0)
parse('{"message":"scope_mode","unrelated":"all"}',True,0)
parse('{"scope_mode":"all"}',True,1<<6)
parse('{"scop\\u0065_mode":"all"}',True,1<<6)
parse('{"scope_mode":"la\\u0062"}',True,1<<6)
parse('{"scope_mode\\u0000":"all"}',True,0)
parse('{"prio_inherit_enabled":true,"tick_period_ms":50,"scope_pid":45063}',True,(1<<0)|(1<<4)|(1<<7))
parse('{"message":"escaped \\\"scope_mode\\\" and \\u4e2d\\u6587"}',True,0)
parse('{"reset":true}',True,1<<8)
for s in ['{"scope_mode":"all"','{"scope_mode":true}','{"fault_cpu_hog":1}','{"scope_mode":"all\\u0000"}',
          '{"scope_mode":"all","scope_mode":"lab"}','{"scope_pid":1.5}','{"scope_pid":2147483648}',
          '{"tick_period_ms":-1}','{"scope_mode":"all",}','{"x":null} trailing','[]','true',
          '{"x":"bad\\x"}','{"x":"\\uD800"}','{"scope_pid":01}','{"x":{}}','{"reset":true,"scope_mode":"lab"}']:
    parse(s,False)
headers=[]
def header(extra,valid,expected=0):
    s=('POST /api/control HTTP/1.1\r\nHost: localhost'+extra).encode();n=ctypes.c_size_t()
    rc=library.ps_http_content_length(s,len(s),ctypes.byref(n));assert (rc==0)==valid,(extra,rc)
    if valid:assert n.value==expected
    headers.append({'extra':extra,'accepted':rc==0,'length':n.value})
header('',True)
header('\r\ncOnTeNt-LeNgTh: 17',True,17)
for h in ['\r\nContent-Length: 2\r\nContent-Length: 4','\r\nContent-Length: 2\r\nContent-Length: 2',
          '\r\ntRaNsFeR-EnCoDiNg: chunked','\r\nContent-Length: 2\r\ntRaNsFeR-EnCoDiNg: identity',
          '\r\nContent-Length: +2','\r\nContent-Length: -2','\r\nContent-Length: 2x',
          '\r\nContent-Length: 99999999999999999999999','\r\nBad Header: x','\r\nHost: x\nTransfer-Encoding: chunked']:
    header(h,False)
# Exercise the production scanner function itself with the next-higher-TID API stub.
s=(root/'qnx-target/src/pulse_scope_resmgr.c').read_text();start=s.index('static void scan_single_pid(');end=s.index('\n/*',start);function=s[start:end]
prelude='''#include <stdio.h>
#include <stdint.h>
#include <stddef.h>
#include <string.h>
#define EOK 0
#define O_RDONLY 0
#define DCMD_PROC_TIDSTATUS 101
#define STATE_SEND 5
#define STATE_REPLY 6
typedef struct {int32_t pid,tid,priority,real_priority;uint32_t state,policy,blocked_on_pid,last_cpu;char proc_name[24],thread_name[24];} ps_thread_snap_t;
typedef struct {uint32_t tid;int priority,real_priority;uint32_t state,policy,last_cpu;struct{struct{int pid;}connect;}blocked;} procfs_status;
static int open(const char*p,int f){(void)p;(void)f;return 9;}
static int close(int f){(void)f;return 0;}
static int devctl(int f,int c,void*v,size_t n,void*i){(void)f;(void)c;(void)n;(void)i;procfs_status*s=v;unsigned ids[]={1,129,130};for(int j=0;j<3;j++)if(ids[j]>=s->tid){s->tid=ids[j];return 0;}return 3;}
static void query_qnx_thread_name(int f,uint32_t t,const char*s,char*out,size_t cap){(void)f;(void)t;snprintf(out,cap,"%s",s);}
'''
code=prelude+function+'''\nint main(void){ps_thread_snap_t out[48];uint32_t n=0;scan_single_pid(42,"external",out,48,&n);if(n!=3||out[0].tid!=1||out[1].tid!=129||out[2].tid!=130)return 1;puts("sparse TID 1/129/130: PASS");return 0;}'''
(work/'scanner.c').write_text(code);subprocess.run(['clang','-Wall','-Wextra','-Werror',str(work/'scanner.c'),'-o',str(work/'scanner')],check=True)
r=subprocess.run([str(work/'scanner')],text=True,capture_output=True,check=True)
output={'result':'PASS','jsonCases':results,'headerCases':headers,'sparseTid':r.stdout.strip()}
(root/'docs/p2-host-regression.json').write_text(json.dumps(output,indent=2)+'\n')
print('PASS:',len(results),'JSON cases,',len(headers),'HTTP framing cases;',r.stdout.strip())
