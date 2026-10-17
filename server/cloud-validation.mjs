import { mediaPattern } from './cloud-media.mjs';
export class HttpError extends Error {
  constructor(status,message,extra={}) { super(message); this.status=status; this.extra=extra; }
}
const clean=(value,max)=>typeof value==='string'?value.trim().slice(0,max):'';
const validDate=value=>typeof value==='string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0,10)===value;

export async function validateArchive(store,data) {
  if (!data || !Array.isArray(data.memories) || !Array.isArray(data.letters) || data.memories.length>2000 || data.letters.length>200) throw new HttpError(400,'Archivo no válido.');
  const checkId=id=>typeof id==='string' && /^[\w-]{1,100}$/.test(id);
  const paths=[...new Set(data.memories.flatMap(m=>[m?.src,m?.thumb]))];
  if (paths.some(path=>typeof path!=='string' || !mediaPattern.test(path))) throw new HttpError(400,'Sube las fotos antes de guardar el archivo.');
  const rows=await store.query('SELECT path FROM nosotros.assets WHERE path=ANY($1::text[])',[paths]);
  if(rows.length!==paths.length) throw new HttpError(400,'Falta completar la carga de alguna fotografía.');
  const memories=data.memories.map(m=>{
    if(!m || !checkId(m.id) || m.thumb.endsWith('.mp4'))throw new HttpError(400,'Recuerdo no válido.');
    return {id:m.id,title:clean(m.title,100)||'Un instante contigo',album:clean(m.album,60)||'Nuestros momentos',note:clean(m.note,6000),date:validDate(m.date)?m.date:'',month:m.month===''?'':/^\d{4}-(0[1-9]|1[0-2])$/.test(m.month||'')?m.month:(validDate(m.date)?m.date.slice(0,7):''),src:m.src,thumb:m.thumb,kind:m.src.endsWith('.mp4')?'video':'photo',originalName:clean(m.originalName,150),featured:Boolean(m.featured),hidden:Boolean(m.hidden),updated:Number(m.updated)||Date.now()};
  });
  const letters=data.letters.map(l=>{
    if(!l || !checkId(l.id))throw new HttpError(400,'Carta no válida.');
    return {id:l.id,title:clean(l.title,100)||'Para ti',note:clean(l.note,6000),updated:Number(l.updated)||Date.now()};
  });
  if(new Set(memories.map(m=>m.id)).size!==memories.length || new Set(letters.map(l=>l.id)).size!==letters.length)throw new HttpError(400,'Identificadores duplicados.');
  return {memories,letters,favorites:Array.isArray(data.favorites)?[...new Set(data.favorites.filter(id=>memories.some(m=>m.id===id)))]:[]};
}
