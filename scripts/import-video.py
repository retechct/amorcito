from pathlib import Path
import json, subprocess, re
import imageio_ffmpeg

root=Path(__file__).resolve().parent.parent
catalog_path=root/'.private/import-catalog.json'
catalog=json.loads(catalog_path.read_text(encoding='utf-8'))
ffmpeg=imageio_ffmpeg.get_ffmpeg_exe()
for video in catalog.get('videoSources',[]):
    source=root/'private-media'/video['file']
    stem=source.stem
    output=source.with_suffix('.mp4')
    probe=subprocess.run([ffmpeg,'-i',str(source)],capture_output=True,text=True,encoding='utf-8',errors='replace')
    found=re.search(r'creation_time\s*:\s*(\d{4}-\d{2}-\d{2})',probe.stderr)
    date=found.group(1) if found else ''
    subprocess.run([ffmpeg,'-y','-i',str(source),'-map_metadata','-1','-vf',"scale='min(1280,iw)':-2",'-c:v','libx264','-preset','fast','-crf','24','-c:a','aac','-b:a','128k','-movflags','+faststart',str(output)],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
    subprocess.run([ffmpeg,'-y','-i',str(output),'-frames:v','1','-vf','scale=480:-2',str(source.with_name(stem+'-thumb.jpg'))],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
    entry=dict(id='video-'+stem,title='Un recuerdo en movimiento',album='Instantes en movimiento',date=date,month=date[:7],src='/media/'+output.name,thumb='/media/'+stem+'-thumb.jpg',kind='video',originalName=video['originalName'],note='',featured=False,updated=0)
    catalog['memories']=[item for item in catalog['memories'] if item['id']!=entry['id']]+[entry]
catalog_path.write_text(json.dumps(catalog,ensure_ascii=False,indent=2),encoding='utf-8')
print('Vídeos preparados:',len(catalog.get('videoSources',[])))
