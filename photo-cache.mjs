// Private, bounded, tab-memory cache. No localStorage, Cache API or disk cache.
export function createPhotoCache({fetcher=fetch,createURL=blob=>URL.createObjectURL(blob),revokeURL=url=>URL.revokeObjectURL(url),maxBytes=32*1024*1024,maxEntries=220,concurrency=4}={}) {
  const entries=new Map();
  let bytes=0,running=0,generation=0,scheduled=false;
  const cancelled=()=>new DOMException('Carga cancelada','AbortError');
  function touch(key,entry){entries.delete(key);entries.set(key,entry);}
  function trim(){
    for(const [key,entry] of entries){
      if(bytes<=maxBytes && entries.size<=maxEntries)break;
      if(!entry.url)continue;
      revokeURL(entry.url);bytes-=entry.bytes;entries.delete(key);
    }
  }
  function schedule(){if(!scheduled){scheduled=true;queueMicrotask(()=>{scheduled=false;pump();});}}
  function pump(){
    while(running<concurrency){
      // Reserve two slots for visible images so prefetch cannot block the viewer.
      const next=[...entries.values()].filter(e=>e.state==='queued' && (e.priority>=100 || running<Math.max(1,concurrency-2))).sort((a,b)=>b.priority-a.priority)[0];
      if(!next)break;
      next.state='loading';running++;
      const currentGeneration=generation;
      const timeout=setTimeout(()=>next.controller.abort(),25000);
      (async()=>{
        const response=await fetcher(next.key,{credentials:'same-origin',cache:'no-store',signal:next.controller.signal,priority:next.priority>=50?'high':'low'});
        if(!response.ok)throw Object.assign(new Error('No se pudo cargar el recuerdo.'),{status:response.status});
        const blob=await response.blob();
        if(!blob.type.startsWith('image/') || blob.size>10*1024*1024)throw new Error('Imagen no válida.');
        if(currentGeneration!==generation)throw cancelled();
        next.url=createURL(blob);next.bytes=blob.size;next.state='ready';bytes+=blob.size;
        touch(next.key,next);trim();next.resolve(next.url);
      })().catch(error=>{
        if(entries.get(next.key)===next)entries.delete(next.key);
        next.reject(error);
      }).finally(()=>{clearTimeout(timeout);running--;schedule();});
    }
  }
  return {
    peek(key){const entry=entries.get(key);if(!entry?.url)return null;touch(key,entry);return entry.url;},
    load(key,priority=100){
      if(!/^\/media\/[a-f0-9]{24,64}(?:-thumb)?\.(?:jpg|webp|png)(?:\?size=(?:480|960|1600))?$/.test(key))return Promise.reject(new Error('Ruta de foto no válida.'));
      let entry=entries.get(key);
      if(entry){entry.priority=Math.max(entry.priority,priority);touch(key,entry);schedule();return entry.promise;}
      entry={key,priority,state:'queued',controller:new AbortController(),url:null,bytes:0};
      entry.promise=new Promise((resolve,reject)=>{entry.resolve=resolve;entry.reject=reject;});
      entries.set(key,entry);schedule();return entry.promise;
    },
    clear(){
      generation++;
      for(const entry of entries.values()){
        entry.controller.abort();
        if(entry.url)revokeURL(entry.url);
        else entry.reject(cancelled());
      }
      entries.clear();bytes=0;
    },
  };
}
