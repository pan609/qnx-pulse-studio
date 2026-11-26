#!/usr/bin/env python3
import json,pathlib,subprocess
root=pathlib.Path(__file__).resolve().parent.parent
out=root/'deliverables/demo';timeline=json.loads((out/'timeline.json').read_text());duration=timeline['duration']
raw=out/'screen-original.webm'
raw_duration=float(subprocess.check_output(['ffprobe','-v','error','-show_entries','format=duration','-of','default=nw=1:nk=1',str(raw)],text=True))
def reference_window(start,length,reference):
    data=subprocess.check_output(['ffmpeg','-v','error','-ss',str(start),'-i',str(raw),'-t',str(length),'-vf','crop=1500:800:210:80,scale=150:80,fps=5','-pix_fmt','rgb24','-f','rawvideo','-'])
    frame_size=150*80*3
    frames=[data[i:i+frame_size] for i in range(0,len(data),frame_size) if len(data[i:i+frame_size])==frame_size]
    ref=frames[round((reference-start)*5)]
    distances=[sum(abs(a-b) for a,b in zip(f,ref))/frame_size for f in frames]
    threshold=max(.7,min(distances[0]*.28,2.0))
    hits=[i/5+start for i,d in enumerate(distances) if d<threshold]
    if not hits: raise RuntimeError('No stable scene anchor found')
    return hits[0],hits[-1]
proof=next(s for s in timeline['scenes'] if s['key']=='proof')
outro=next(s for s in timeline['scenes'] if s['key']=='outro')
proof_match=reference_window(0,proof['start']+proof['seconds']+10,proof['start']+proof['seconds']/2+1)
outro_start=max(0,outro['start']-5)
outro_match=reference_window(outro_start,duration-outro_start+5,outro['start']+outro['seconds']/2+2)
lead=max(0,proof_match[0]-proof['start'])
outro_lead=outro_match[0]-outro['start']
assert abs(lead-outro_lead)<.4,(lead,outro_lead)
alignment={'proofStartInRaw':proof_match[0],'proofExpected':proof['start'],'outroStartInRaw':outro_match[0],'outroExpected':outro['start'],'trimLeadSeconds':lead,'crossAnchorErrorSeconds':abs(lead-outro_lead)}
(out/'scene-alignment.json').write_text(json.dumps(alignment,indent=2)+'\n')
final=out/'QNX-Pulse-Studio-demo-review.mp4'
subprocess.run(['ffmpeg','-y','-loglevel','error','-ss',str(lead),'-i',str(raw),'-i',str(out/'narration.wav'),'-t',str(duration),'-vf',f"subtitles={out/'demo-en.srt'}:force_style='FontName=Arial,FontSize=9,PrimaryColour=&H00FFFFFF,OutlineColour=&H90000000,BorderStyle=3,Outline=2,Shadow=0,MarginV=8'",'-c:v','libx264','-preset','fast','-crf','21','-pix_fmt','yuv420p','-af','loudnorm=I=-16:TP=-1.5:LRA=11','-c:a','aac','-ar','48000','-b:a','160k','-movflags','+faststart','-metadata','title=QNX Pulse Studio - local review cut',str(final)],check=True)
r=json.loads(subprocess.check_output(['ffprobe','-v','error','-show_format','-show_streams','-of','json',str(final)],text=True))
assert 0<float(r['format']['duration'])<180
assert any(s['codec_type']=='audio' for s in r['streams'])
assert any(s.get('width')==1920 and s.get('height')==1080 for s in r['streams'])
(out/'video-validation.json').write_text(json.dumps({'result':'PASS','durationSeconds':float(r['format']['duration']),'bytes':final.stat().st_size,'sourceVideo':str(raw),'output':str(final),'narration':'local macOS Samantha synthetic English speech','uploadedToYouTube':False,'sceneAlignment':alignment,'subtitleFontSizeAt1080p':'approximately 34 px (ASS 9/288 PlayRes)'},indent=2)+'\n')
subprocess.run(['ffmpeg','-y','-loglevel','error','-i',str(final),'-vf','fps=1/20,scale=480:270,tile=4x2','-frames:v','1',str(out/'video-contact-sheet.png')],check=True)
print('Validated local MP4:',final,'duration',r['format']['duration'],'seconds')
