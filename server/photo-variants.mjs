import sharp from 'sharp';

export const variantSize=value=>['480','960','1600'].includes(value)?Number(value):0;

// Instance-local byte cache only. Callers MUST authorize every request first.
// There are no public image URLs and no cached sessions or permissions here.
export function createPhotoVariants({maxBytes=32*1024*1024,ttl=5*60*1000,now=Date.now}={}) {
  const cache=new Map(),pending=new Map();
  let bytes=0;
  return async function variant(key,size,readOriginal){
    const cacheKey=key+':'+size;
    const existing=cache.get(cacheKey);
    if(existing && existing.expires>now()){cache.delete(cacheKey);cache.set(cacheKey,existing);return existing.data;}
    if(existing){bytes-=existing.data.length;cache.delete(cacheKey);}
    if(pending.has(cacheKey))return pending.get(cacheKey);
    const promise=(async()=>{
      const source=await readOriginal();
      const data=await sharp(source,{limitInputPixels:60_000_000}).rotate().resize(size,size,{fit:'inside',withoutEnlargement:true}).webp({quality:size===480?76:82,effort:3}).toBuffer();
      if(data.length<=maxBytes){
        for(const [id,entry] of cache){
          if(bytes+data.length<=maxBytes && cache.size<256)break;
          bytes-=entry.data.length;cache.delete(id);
        }
        cache.set(cacheKey,{data,expires:now()+ttl});bytes+=data.length;
      }
      return data;
    })();
    pending.set(cacheKey,promise);
    try{return await promise;}finally{pending.delete(cacheKey);}
  };
}
