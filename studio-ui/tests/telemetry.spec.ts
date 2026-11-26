import {test, expect} from '@playwright/test';
import {readFileSync, mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {analyzeSnapshotDeterministic} from '../src/diagnostics';
import {parseTrace, pointsFromSnapshot} from '../src/benchmark';
import type {Snapshot} from '../src/types';

const capture=JSON.parse(readFileSync(resolve('public/captures/qnx8-qemu-verified-trace.json'),'utf8'));
const assets=resolve('../docs/assets'); mkdirSync(assets,{recursive:true});
test('raw capture preserves every phase, E2E count, P99 and misses',()=>{
  const a=parseTrace(capture);
  for(const phase of ['nominal','pi-off','pi-on']) {
    const s=a.phaseSnapshots![phase];const points=a.points.filter(p=>p.phase===phase);
    expect(points.length).toBe(s.metrics.total_cycles);
    expect(points.filter(p=>p.ipcUs>5000).length).toBe(s.metrics.deadline_misses);
    const values=points.slice(-128).map(p=>p.ipcUs).sort((a,b)=>a-b);
    expect(values[Math.ceil(values.length*.99)-1]).toBe(s.metrics.p99_e2e_us);
  }
});
test('chart filters E2E and deduplicates controls and repeated events',()=>{
  const s:Snapshot=capture.lastSnapshot;
  const first=pointsFromSnapshot(s,0);
  expect(first.length).toBe(s.events.filter(e=>e.kind===6).length);
  expect(pointsFromSnapshot(s,Math.max(...s.events.map(e=>e.seq)))).toEqual([]);
  expect(()=>parseTrace({...capture,lastSnapshot:{metrics:{}}})).toThrow();
  const badSource=structuredClone(capture);badSource.benchmark.source={bad:true};expect(()=>parseTrace(badSource)).toThrow();
  const bad=structuredClone(capture);bad.lastSnapshot.threads[0].proc_name={bad:true};expect(()=>parseTrace(bad)).toThrow();
  expect(()=>parseTrace({...capture,points:[{ts:0,ipcUs:'bad',jitterUs:0}]})).toThrow();
});
test('diagnosis cannot read fault flags; claims require sampled evidence',()=>{
  const a:Snapshot=structuredClone(capture.lastSnapshot);
  const base=analyzeSnapshotDeterministic(a);
  a.config.fault_prio_inversion=!a.config.fault_prio_inversion;
  a.config.prio_inherit_enabled=!a.config.prio_inherit_enabled;
  a.config.fault_reply_stall=!a.config.fault_reply_stall;
  const changed=analyzeSnapshotDeterministic(a);
  expect(changed.title).toEqual(base.title);expect(changed.rootCause).toEqual(base.rootCause);
  const th=(tid:number,priority:number,state:string)=>({pid:123,tid,name:`t${tid}`,priority,real_priority:priority,state,policy:'SCHED_FIFO',blocked_on_pid:0,cpu:0});
  a.threads=[th(1,30,'MUTEX'),th(2,15,'READY'),th(3,24,'RUNNING')];
  expect(analyzeSnapshotDeterministic(a).title).toContain('Candidate priority inversion');
});
test('hosted default is offline replay, makes no API probes, accepts both languages',async({page})=>{
  const api:string[]=[];const errors:string[]=[];
  page.on('request',r=>{if(r.url().includes('/api/'))api.push(r.url());});page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/');await expect(page.locator('.osc-panel .aeb-ruler')).toContainText(`${capture.points.length} recorded cycles`);
  await expect(page.locator('.status-pill')).toContainText('OFFLINE');
  await page.waitForTimeout(900);expect(api).toEqual([]);expect(errors).toEqual([]);
  await expect(page.getByRole('button',{name:'Run A/B',exact:false})).toBeDisabled();
  expect(await page.locator('.osc-panel').evaluate(e=>e.getBoundingClientRect().bottom)).toBeLessThan(1000);
  await page.screenshot({path:resolve(assets,'recorded-studio.png'),fullPage:true});
  await page.getByRole('button',{name:'中文',exact:true}).click();await expect(page.locator('.status-pill')).toContainText('非实时');
  await page.getByRole('button',{name:'EN',exact:true}).click();
});
test('simulation is explicit; A/B phases stay synthetic; bad imports report errors',async({page})=>{
  await page.goto('/?demo=1');await expect(page.locator('.status-pill')).toContainText('SYNTHETIC');
  await page.getByRole('button',{name:'Run A/B',exact:false}).click();
  await expect(page.getByRole('button',{name:'Sampling PI OFF',exact:false})).toBeVisible();
  await expect(page.getByRole('button',{name:'Run A/B',exact:false})).toBeEnabled({timeout:15000});
  await expect(page.locator('.bench-meta')).toContainText('qnx-8.0-sim');
  await page.locator('input[type=file]').setInputFiles({name:'bad.json',mimeType:'application/json',buffer:Buffer.from('{"points":[]}')});
  await expect(page.getByRole('alert')).toContainText('Expected a v2');
  await page.setViewportSize({width:390,height:844});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
  await page.screenshot({path:resolve(assets,'mobile-simulation.png'),fullPage:true});
});
test('live QNX target: scenarios, PID scope, A/B, export and recorded transition',async({page,request})=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await request.post('http://127.0.0.1:8080/api/control',{data:{tick_period_ms:500,stall_ms:200,fault_reply_stall:true}});
  await page.goto('/');await expect(page.locator('.status-pill')).toContainText('OFFLINE');
  await page.getByRole('button',{name:'Connect QNX',exact:true}).click();await expect(page.locator('.status-pill')).toContainText('LIVE QNX');
  await page.getByRole('button',{name:'Run A/B',exact:false}).click();
  await expect.poll(async()=>({enabled:await page.getByRole('button',{name:'Run A/B',exact:false}).isEnabled(),alerts:await page.getByRole('alert').allTextContents(),status:await page.locator('.status-pill').innerText()}),{timeout:20000}).toEqual({enabled:true,alerts:[],status:'LIVE QNX 8.0'});
  await expect(page.locator('.bench-meta')).toContainText('qnx-8.0-live');
  const download=page.waitForEvent('download');await page.getByRole('button',{name:'Export Trace',exact:true}).click();
  const file=await download;const trace=JSON.parse(readFileSync((await file.path())!,'utf8'));expect(parseTrace(trace).source).toBe('qnx-8.0-live');
  for(const phase of ['pi-off','pi-on']) {
    const snapshots=trace.snapshots.filter((s:any)=>s.phase===phase);expect(snapshots.length).toBeGreaterThan(10);
    expect(new Set(snapshots.map((s:any)=>s.snapshot.config.generation)).size).toBe(1);
    expect(snapshots.every((s:any)=>s.snapshot.config.tick_period_ms===50 && s.snapshot.config.stall_ms===35)).toBeTruthy();
  }
  // Restore a short nominal period after the explicit long-period entry condition.
  await request.post('http://127.0.0.1:8080/api/control',{data:{tick_period_ms:50,stall_ms:35,fault_reply_stall:false}});
  await page.getByLabel('Thread observation scope').selectOption('all');
  await expect.poll(async()=>{const s=await (await request.get('http://127.0.0.1:8080/api/snapshot')).json();return s.config.scope_mode;}).toBe('all');
  await expect(page.locator('.thread-table')).toContainText('devb-virtio');
  await page.screenshot({path:resolve(assets,'live-system-threads.png'),fullPage:true});
  const s=await (await request.get('http://127.0.0.1:8080/api/snapshot')).json();const target=s.threads.find((t:any)=>t.proc_name.includes('devb-virtio')).pid;
  await page.getByLabel('Scope PID').fill(String(target));await page.getByRole('button',{name:'Inspect PID',exact:true}).click();
  await expect.poll(async()=>{const s=await (await request.get('http://127.0.0.1:8080/api/snapshot')).json();return s.config.scope_pid;}).toBe(target);
  await page.getByLabel('Thread observation scope').selectOption('lab');
  await page.getByRole('button',{name:/Priority Inversion/}).click();
  await page.getByRole('button',{name:'Reset',exact:true}).click();await page.waitForTimeout(1500);
  await page.screenshot({path:resolve(assets,'live-pi-off.png'),fullPage:true});
  mkdirSync(resolve(assets,'frames'),{recursive:true});
  for(let i=0;i<12;i++) {
    if(i===4)await page.getByRole('button',{name:/QNX PI Rescue/}).click();
    await page.waitForTimeout(220);await page.screenshot({path:resolve(assets,`frames/transition-${String(i).padStart(2,'0')}.png`)});
  }
  await page.getByRole('button',{name:'Reset',exact:true}).click();await page.waitForTimeout(1500);
  await page.screenshot({path:resolve(assets,'live-pi-on.png'),fullPage:true});
  await page.getByRole('button',{name:/Nominal/}).click();expect(errors).toEqual([]);
});
test('Codelab has nine checkpoints, real screenshots and working navigation',async({page})=>{
  await page.goto('/codelab/');await expect(page.locator('#prog-count')).toContainText('1 / 9');
  for(let i=0;i<9;i++) {
    await page.locator('.step-item').nth(i).click();await expect(page.locator('#step-content')).toContainText('Verify Checkpoint');
    for (const img of await page.locator('#step-content img').all()) await expect.poll(()=>img.evaluate((el:HTMLImageElement)=>el.naturalWidth)).toBeGreaterThan(0);
  }
  await expect(page.locator('#step-indicator')).toHaveText('9 / 9');
  await page.locator('#btn-lang').click();await expect(page.locator('#step-content')).toContainText('校验点');
});

test('missing archive never presents simulation as recorded data',async({page})=>{
  await page.route('**/captures/qnx8-qemu-verified-trace.json',r=>r.fulfill({status:503,body:'unavailable'}));
  await page.goto('/');await expect(page.getByRole('alert')).toContainText('Capture HTTP 503');
  await expect(page.locator('.kpi-grid')).toHaveCount(0);await expect(page.locator('.status-pill')).toHaveCount(0);
  await page.getByRole('button',{name:'Simulation',exact:true}).click();await expect(page.locator('.status-pill')).toContainText('SYNTHETIC');
});
test('explicit LLM result survives the following telemetry samples',async({page})=>{
  const report={severity:'nominal',title:'Captured model report',summary:'Sampled analysis',rootCause:['A'],qnxApiEvidence:['B'],codeFixTitle:'Inspect',codeFixDiff:'/* inspect */'};
  await page.route('https://example.test/analysis',r=>r.fulfill({json:{choices:[{message:{content:JSON.stringify(report)}}]}}));
  await page.goto('/?demo=1');await page.getByRole('button',{name:'BYOK LLM',exact:false}).click();
  await page.locator('.byok-grid input').nth(0).fill('https://example.test/analysis');await page.locator('.byok-grid input').nth(2).fill('test-only-placeholder');
  await page.getByRole('button',{name:'Analyze Current Sample',exact:false}).click();await expect(page.locator('.diag-head')).toContainText('Captured model report');
  await page.waitForTimeout(900);await expect(page.locator('.diag-head')).toContainText('Captured model report');
});
