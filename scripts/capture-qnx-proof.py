#!/usr/bin/env python3
"""Capture successful SSH kernel/process/device evidence without copying keys or credentials."""
import datetime,pathlib,subprocess
root=pathlib.Path(__file__).resolve().parent.parent
ssh=['ssh','-i',str(pathlib.Path.home()/'qnx-env/qnx_id_ed25519'),'-o','BatchMode=yes','-o','ConnectTimeout=5','-o','StrictHostKeyChecking=no','-o','UserKnownHostsFile=/dev/null','-p','8022','root@127.0.0.1']
commands=[('Target identity','uname -a; pidin info'),('User-space Resource Manager','ls -l /dev/pulse_scope; cat /dev/pulse_scope'),('Sampled threads',"pidin -F '%a %b %N %h %p %J %c' | head -n 28")]
text=['# QNX OS 8.0 inside QEMU virt-7.2 / TCG (not a physical board)',datetime.datetime.now(datetime.timezone.utc).isoformat(),'']
for title,cmd in commands:
    r=subprocess.run(ssh+[cmd],text=True,capture_output=True,timeout=12,check=True)
    text+=['## '+title,'$ '+cmd,r.stdout]
r=subprocess.run(['file',*map(str,(root/'qnx-target/build/aarch64le').iterdir())],cwd=root,text=True,capture_output=True,timeout=5,check=True)
text+=['## Cross-compiled ELF binaries',r.stdout.replace(str(root)+'/', ''),'## Source/binary/trace SHA-256 manifest','See capture-sha256.json. Hashes were generated at capture time.']
(root/'docs/qnx8-verified-capture-proof.txt').write_text('\n'.join(text)+'\n')
print('Proof log complete; all SSH and file exit codes zero.')
