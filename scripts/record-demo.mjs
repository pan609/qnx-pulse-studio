import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {spawn,execFileSync} from 'node:child_process';
const root=fileURLToPath(new URL('../',import.meta.url));
const require=createRequire(new URL('../studio-ui/package.json',import.meta.url));
const {chromium}=require('@playwright/test');
const out=path.join(root,'deliverables/demo');
const timeline=JSON.parse(fs.readFileSync(path.join(out,'timeline.json'),'utf8'));
const base='http://127.0.0.1:5193';const api='http://127.0.0.1:8080';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const json=async(p,body)=>{const r=await fetch(api+p,{method:body?'POST':'GET',headers:{'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(5000)});if(!r.ok)throw Error('Target HTTP '+r.status);return r.json();};
const original=(await json('/api/snapshot')).config;
const proof=execFileSync('ssh',['-i',path.join(process.env.HOME,'qnx-env/qnx_id_ed25519'),'-o','BatchMode=yes','-o','ConnectTimeout=5','-o','StrictHostKeyChecking=no','-o','UserKnownHostsFile=/dev/null','-p','8022','root@127.0.0.1','uname -a; pidin info; ls -l /dev/pulse_scope'],{encoding:'utf8',timeout:12000,stdio:['ignore','pipe','ignore']});
fs.writeFileSync(path.join(out,'qnx-proof-stdout.txt'),proof);
const escape=s=>s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
const shell=(title,inner)=>`<!doctype html><meta charset="utf-8"><style>body{margin:0;background:#070e19;color:#dce8fa;font:24px -apple-system,BlinkMacSystemFont,sans-serif}main{max-width:1500px;margin:95px auto;padding:55px;background:#0c1524;border:1px solid #263954;border-radius:20px}h1{font-size:52px;letter-spacing:-1.5px;margin:12px 0 32px}small{color:#35d4e8;letter-spacing:3px;font-size:17px}pre{white-space:pre-wrap;font:23px/1.7 ui-monospace,SFMono-Regular,monospace;color:#bfdae9}p{color:#9aafc8;line-height:1.7}a{color:#53d2e5}code{color:#8ce6ba}</style><main><small>QNX PULSE STUDIO</small><h1>${title}</h1>${inner}</main>`;
const proofHtml=shell('A genuine QNX OS 8.0 guest',`<p>Captured command output · QEMU virt-7.2 / GICv2 / TCG · ${new Date().toISOString()}</p><pre>$ uname -a; pidin info; ls -l /dev/pulse_scope\n${escape(proof)}</pre><p>The full stdout and compiled QNX ELF evidence are saved with this project. This is a virtual QNX target, not a physical board.</p>`);
const outro=shell('Inspect. Reproduce. Learn.',`<p>Native QNX IPC and a user-space Resource Manager.<br>Original data, explicit source labels and a nine-step codelab.</p><p><a>github.com/pan609/qnx-pulse-studio</a><br><a>pan609.github.io/qnx-pulse-studio/</a><br><a>pan609.github.io/qnx-pulse-studio/codelab/</a></p><p><code>Recorded · Live QNX · Synthetic simulation</code><br>Measurements include outliers. No WCET or vehicle-safety guarantee.</p>`);
let browser,context,page,server;const logfd=fs.openSync(path.join(out,'preview.log'),'w');
let restored=false;const errors=[];const events=[];
try {
  await json('/api/control',{prio_inherit_enabled:true,fault_prio_inversion:false,fault_reply_stall:false,fault_cpu_hog:false,tick_period_ms:50,stall_ms:35,scope_mode:'lab',scope_pid:0});
  server=spawn('npm',['--prefix','studio-ui','run','preview','--','--host','127.0.0.1','--port','5193','--strictPort'],{cwd:root,detached:true,stdio:['ignore',logfd,logfd]});
  let ready=false;for(let i=0;i<50;i++){try{if((await fetch(base)).ok){ready=true;break;}}catch{}await sleep(200);}if(!ready)throw Error('Preview not ready');
  browser=await chromium.launch({headless:true});
  context=await browser.newContext({viewport:{width:1920,height:1080},deviceScaleFactor:1,recordVideo:{dir:path.join(out,'raw'),size:{width:1920,height:1080}},permissions:['clipboard-read','clipboard-write']});
  page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/demo-proof.html',r=>r.fulfill({contentType:'text/html',body:proofHtml}));
  await page.route('**/demo-outro.html',r=>r.fulfill({contentType:'text/html',body:outro}));
  await page.goto(base);await page.locator('.osc-panel .aeb-ruler').filter({hasText:'276 recorded cycles'}).waitFor();
  const started=performance.now();const video=page.video();
  const waitTo=async end=>{const remain=end*1000-(performance.now()-started);if(remain>0)await sleep(remain);};
  const acknowledge=async(expected)=>{
    const end=Date.now()+8000;
    while(Date.now()<end){const s=await json('/api/snapshot');if(Object.entries(expected).every(([k,v])=>s.config[k]===v)&&s.events.some(e=>e.kind===7&&e.flags===s.config.generation))return;await sleep(100);}throw Error('Config acknowledgement not captured');
  };
  for(const scene of timeline.scenes){
    const actual=(performance.now()-started)/1000;events.push({scene:scene.key,planned:scene.start,actual});console.log('Recording',scene.key,`${actual.toFixed(1)}s`);
    if(scene.key==='proof')await page.goto(base+'/demo-proof.html');
    if(scene.key==='connect'){
      await page.goto(base);await page.getByRole('button',{name:'Connect QNX',exact:true}).click();await page.locator('.status-pill.live').waitFor();
    }
    if(scene.key==='off'||scene.key==='on'){
      await page.getByRole('button',{name:scene.key==='off'?/Priority Inversion/:/QNX PI Rescue/}).click();await acknowledge({fault_prio_inversion:true,prio_inherit_enabled:scene.key==='on'});
      await page.getByRole('button',{name:'Reset',exact:true}).click();
    }
    if(scene.key==='benchmark'){
      await page.locator('.bench-panel').evaluate(e=>e.scrollIntoView({block:'start'}));
      await page.getByRole('button',{name:'Run A/B',exact:false}).click();
      const run=page.getByRole('button',{name:'Run A/B',exact:false});await run.waitFor();
      for(let i=0;i<100&&!await run.isEnabled();i++)await sleep(150);
      if(!await run.isEnabled())throw Error('A/B did not finish');
      if(await page.getByRole('alert').count())throw Error((await page.getByRole('alert').allTextContents()).join('; '));
      const d=page.waitForEvent('download');await page.getByRole('button',{name:'Export Trace',exact:true}).click();
      await (await d).saveAs(path.join(out,'live-demo-exported-trace.json'));
      const exported=JSON.parse(fs.readFileSync(path.join(out,'live-demo-exported-trace.json'),'utf8'));
      if(exported.benchmark?.source!=='qnx-8.0-live'||!exported.phaseSnapshots?.['pi-off'])throw Error('Live benchmark export is incomplete');
    }
    if(scene.key==='scope'){
      await page.getByLabel('Thread observation scope').selectOption('all');await sleep(1200);
      await page.locator('.thread-table').evaluate(e=>e.closest('section').scrollIntoView({block:'start'}));await sleep(3000);
      const s=await json('/api/snapshot');const other=s.threads.find(t=>t.proc_name?.includes('devb-virtio'))||s.threads.find(t=>t.pid!==s.threads[0]?.pid);
      if(!other)throw Error('No system PID found');
      await page.getByLabel('Scope PID').fill(String(other.pid));await page.getByRole('button',{name:'Inspect PID',exact:true}).click();await sleep(800);
      await page.locator('.thread-table').evaluate(e=>e.closest('section').scrollIntoView({block:'start'}));
    }
    if(scene.key==='analysis'){
      await page.locator('.copilot-panel').evaluate(e=>e.scrollIntoView({block:'start'}));
      await page.getByRole('button',{name:'Analyze Current Sample',exact:true}).click();
    }
    if(scene.key==='codelab'){
      await page.goto(base+'/codelab/index.html');await page.locator('.step-item').nth(5).click();await sleep(4500);
      await page.locator('.step-item').nth(7).click();await sleep(5500);
      await page.locator('.step-item').nth(8).click();await page.locator('#step-content .copy-btn').last().click();
    }
    if(scene.key==='outro')await page.goto(base+'/demo-outro.html');
    await waitTo(scene.start+scene.seconds);
  }
  if(errors.length)throw Error('Browser errors: '+errors.join('; '));
  await context.close();context=null;
  const raw=await video.path();fs.copyFileSync(raw,path.join(out,'screen-original.webm'));
  fs.writeFileSync(path.join(out,'recording-events.json'),JSON.stringify({source:'real-qnx-8.0-live plus labeled original capture',events,errors},null,2)+'\n');
  console.log('Recorded screen-original.webm; source transitions and original export saved.');
} finally {
  try{await json('/api/control',original);restored=true;}finally{
    if(context)await context.close();if(browser)await browser.close();
    if(server?.pid)try{process.kill(-server.pid,'SIGTERM');}catch{}
    fs.closeSync(logfd);fs.writeFileSync(path.join(out,'target-restore.json'),JSON.stringify({restored,original},null,2)+'\n');
  }
}
