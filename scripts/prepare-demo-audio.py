#!/usr/bin/env python3
"""Create local English synthetic narration and editable subtitles. No external TTS service."""
import json,math,pathlib,subprocess,textwrap
root=pathlib.Path(__file__).resolve().parent.parent
out=root/'deliverables/demo';out.mkdir(parents=True,exist_ok=True)
scenes=json.loads((root/'docs/DEMO_SCENES.json').read_text());cursor=0;srt=[];concat=[]
def stamp(t):
    ms=round(t*1000);return f'{ms//3600000:02}:{ms//60000%60:02}:{ms//1000%60:02},{ms%1000:03}'
for i,s in enumerate(scenes):
    text=out/f'narration-{i:02}.txt';text.write_text(s['narration'])
    audio=out/f'narration-{i:02}.aiff'
    spoken=s['narration'].replace('QNX','Q N X')
    text.write_text(spoken)
    subprocess.run(['say','-v','Samantha','-r','175','-f',str(text),'-o',str(audio)],check=True)
    seconds=float(subprocess.check_output(['ffprobe','-v','error','-show_entries','format=duration','-of','default=nw=1:nk=1',str(audio)],text=True))
    duration=max(s['seconds'],math.ceil(seconds)+1);s.update(start=cursor,seconds=duration,audioSeconds=seconds)
    wav=out/f'narration-{i:02}.wav'
    subprocess.run(['ffmpeg','-y','-loglevel','error','-i',str(audio),'-af','apad','-t',str(duration),'-ar','48000','-ac','2',str(wav)],check=True)
    concat.append(f"file '{wav}'")
    srt.append(f'{i+1}\n{stamp(cursor+.25)} --> {stamp(cursor+min(duration-.5,seconds+.75))}\n'+ '\n'.join(textwrap.wrap(s['narration'],92))+'\n')
    cursor+=duration
assert cursor<178,cursor
(out/'audio-concat.txt').write_text('\n'.join(concat)+'\n')
subprocess.run(['ffmpeg','-y','-loglevel','error','-f','concat','-safe','0','-i',str(out/'audio-concat.txt'),'-c:a','pcm_s16le',str(out/'narration.wav')],check=True)
(out/'demo-en.srt').write_text('\n'.join(srt)+'\n')
(root/'docs/DEMO_SCRIPT.md').write_text('# Local review video storyboard\n\nEnglish narration uses local macOS Samantha synthetic speech. All measurement footage is captured from the actual QNX guest; the proof scene is a labeled excerpt of successful SSH command output. No source footage is claimed to be a physical board.\n\n'+ '\n\n'.join(f"## {s['start']}–{s['start']+s['seconds']} seconds · {s['key']}\n\n{s['narration']}" for s in scenes)+'\n')
(out/'timeline.json').write_text(json.dumps({'duration':cursor,'scenes':scenes},indent=2)+'\n')
print('Prepared',len(scenes),'scenes,',cursor,'seconds; local synthetic English narration and SRT.')
