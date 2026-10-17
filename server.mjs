import http from 'node:http';
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, join, basename } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import sharp from 'sharp';
import { token, digest, verifyPassword, hashPassword } from './server/security.mjs';

const root=fileURLToPath(new URL('.',import.meta.url));
const dataDir=resolve(process.env.DATA_DIR || join(root,'.private'));
const mediaDir=resolve(process.env.MEDIA_DIR || join(root,'private-media'));
const port=Number(process.env.PORT || 4173), host=process.env.HOST || '127.0.0.1';
const production=process.env.NODE_ENV==='production';
if(production && !process.env.APP_ORIGIN?.startsWith('https://'))throw new Error('En producción configura APP_ORIGIN con una dirección HTTPS.');
const allowedOrigin=process.env.APP_ORIGIN || 'http://127.0.0.1:'+port;
const origins=new Set(production?[allowedOrigin]:[allowedOrigin,'http://localhost:'+port]);
await mkdir(dataDir,{recursive:true});await mkdir(mediaDir,{recursive:true});
let credentials;
try { credentials=JSON.parse(await readFile(join(dataDir,'credentials.json'),'utf8')); }
catch { throw new Error('Falta configurar el acceso. Ejecuta npm run setup antes de iniciar.'); }
const db=new DatabaseSync(join(dataDir,'archive.sqlite'));
db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
 CREATE TABLE IF NOT EXISTS archive (id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL, payload TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS sessions (hash TEXT PRIMARY KEY, role TEXT NOT NULL, csrf TEXT NOT NULL, expires INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS limits (key TEXT PRIMARY KEY, count INTEGER NOT NULL, started INTEGER NOT NULL, blocked INTEGER NOT NULL, strikes INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS audit (id INTEGER PRIMARY KEY, time INTEGER NOT NULL, action TEXT NOT NULL, detail TEXT NOT NULL);
`);
const originalLetters=[
 {id:'always',title:'Para un día cualquiera',note:'No hace falta esperar a una fecha especial para recordarte esto:\n\nEres mi lugar seguro y mi casualidad favorita. Contigo, hasta los días más sencillos tienen algo que quiero guardar.\n\nGracias por estar en mis días bonitos, por abrazarme en los difíciles y por convertir lo cotidiano en un recuerdo especial.\n\nTe elegiría una y mil veces más.',updated:0},
 {id:'miss-you',title:'Cuando me extrañes',note:'Si hoy me sientes un poquito lejos, vuelve a nuestras fotos.\n\nAhí seguimos: en esa sonrisa, en las luces, en el abrazo que se quedó guardado. Hay algo nuestro en cada recuerdo.\n\nEsta carta es mi manera de acercarme un poco.\n\nSiempre tú. Siempre nosotros.',updated:0}
];
if(!db.prepare('SELECT id FROM archive WHERE id=1').get())db.prepare('INSERT INTO archive VALUES(1,1,?)').run(JSON.stringify({memories:[],letters:originalLetters,favorites:[]}));
function getArchive(){const row=db.prepare('SELECT * FROM archive WHERE id=1').get();return {...JSON.parse(row.payload),startDate:'2026-02-14T00:00:00-05:00',revision:row.revision};}
function audit(action,detail=''){db.prepare('INSERT INTO audit(time,action,detail) VALUES(?,?,?)').run(Date.now(),action,detail);}
try {
 const catalog=JSON.parse(await readFile(join(dataDir,'import-catalog.json'),'utf8'));
 const current=getArchive(), ids=new Set(current.memories.map(m=>m.id));
 const added=catalog.memories.filter(m=>!ids.has(m.id));
 if(added.length){delete current.revision;current.memories.push(...added);db.prepare('UPDATE archive SET revision=revision+1,payload=? WHERE id=1').run(JSON.stringify(current));audit('import',String(added.length)+' recuerdos');}
}catch(error){if(error.code!=='ENOENT')throw error;}

const json=(res,status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(data));};
class HttpError extends Error {constructor(status,message,extra={}){super(message);this.status=status;this.extra=extra;}}
function securityHeaders(res){
 res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('X-Frame-Options','DENY');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('Cross-Origin-Resource-Policy','same-origin');
 res.setHeader('Permissions-Policy','camera=(), microphone=(), geolocation=()');
 res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
 if(production)res.setHeader('Strict-Transport-Security','max-age=31536000');
}
function clientKey(req){
 // X-Forwarded-For is deliberately ignored unless an exact trusted proxy IP is configured.
 let ip=req.socket.remoteAddress || 'unknown';
 if(process.env.TRUSTED_PROXY_IP && ip===process.env.TRUSTED_PROXY_IP){const forwarded=String(req.headers['x-forwarded-for'] || '').split(',').at(-1)?.trim();if(forwarded)ip=forwarded;}
 return digest(ip);
}
function session(req){const raw=String(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('nosotros_session='))?.slice(17);if(!raw || !/^[A-Za-z0-9_-]{40,50}$/.test(raw))return null;return db.prepare('SELECT * FROM sessions WHERE hash=? AND expires>?').get(digest(raw),Date.now()) || null;}
function requireSession(req,role){const current=session(req);if(!current)throw new HttpError(401,'Abre el candado para continuar.');if(role && current.role!==role)throw new HttpError(403,'Esta acción necesita acceso de administración.');return current;}
function originCheck(req){if(!origins.has(req.headers.origin))throw new HttpError(403,'Origen no permitido.');if(req.headers['sec-fetch-site']==='cross-site')throw new HttpError(403,'Solicitud externa no permitida.');}
function requireWrite(req,role='admin'){originCheck(req);const current=requireSession(req,role);if(req.headers['x-csrf-token']!==current.csrf)throw new HttpError(403,'Recarga la página para renovar la sesión.');return current;}
function cookie(res,value,seconds){res.setHeader('Set-Cookie','nosotros_session='+value+'; HttpOnly; SameSite=Strict; Path=/; Max-Age='+seconds+(production?'; Secure':''));}
function createSession(req,res,role){
 const old=session(req);if(old)db.prepare('DELETE FROM sessions WHERE hash=?').run(old.hash);
 const id=token(),csrf=token(),ttl=role==='admin'?3600:43200;
 db.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(digest(id),role,csrf,Date.now()+ttl*1000);cookie(res,id,ttl);return {authenticated:true,role,csrf};
}
function readLimit(key){return db.prepare('SELECT * FROM limits WHERE key=?').get(key);}
function setLimit(row){db.prepare('INSERT INTO limits VALUES(?,?,?,?,?) ON CONFLICT(key) DO UPDATE SET count=excluded.count,started=excluded.started,blocked=excluded.blocked,strikes=excluded.strikes').run(row.key,row.count,row.started,row.blocked,row.strikes);}
function cooldown(scope,ip){const now=Date.now();return Math.max(0,...[scope+':ip:'+ip,scope+':global'].map(key=>Math.ceil(((readLimit(key)?.blocked||0)-now)/1000)));}
function reserveAttempt(scope,ip){
 const now=Date.now(),wait=cooldown(scope,ip);
 if(wait)throw new HttpError(429,'Demasiados intentos. Espera antes de volver a probar.',{retryAfter:wait});
 for(const [key,maximum,windowMs] of [[scope+':ip:'+ip,5,15*60*1000],[scope+':global',30,15*60*1000]]){
  let row=readLimit(key)||{key,count:0,started:now,blocked:0,strikes:0};
  if(now-row.started>86400000)row.strikes=0;
  if(now-row.started>windowMs || (row.blocked && now>=row.blocked)){row.count=0;row.started=now;row.blocked=0;}
  row.count++;
  if(row.count>=maximum){row.strikes++;row.blocked=now+(key.endsWith(':global')?15*60*1000:Math.min(3600000,30000*4**Math.min(row.strikes-1,4)));}
  setLimit(row);
 }
}
async function body(req,max=80*1024*1024){
 if(!String(req.headers['content-type']||'').startsWith('application/json'))throw new HttpError(415,'Se requiere JSON.');
 if(Number(req.headers['content-length'])>max)throw new HttpError(413,'La carga supera el límite permitido.');
 const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>max)throw new HttpError(413,'La carga supera el límite permitido.');chunks.push(chunk);}
 try{const data=JSON.parse(Buffer.concat(chunks).toString());if(!data || typeof data!=='object' || Array.isArray(data))throw new Error();return data;}catch{throw new HttpError(400,'Datos no válidos.');}
}
const mediaPattern=/^\/media\/([a-f0-9]{24,64}(?:-thumb)?\.(?:jpg|webp|png|mp4))$/;
const clean=(value,max)=>typeof value==='string'?value.trim().slice(0,max):'';
function validDate(value){return typeof value==='string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0,10)===value;}
async function ingest(src,kind='photo',thumbnail){
 const match=typeof src==='string' && src.match(mediaPattern);
 if(match){await stat(join(mediaDir,match[1])).catch(()=>{throw new HttpError(400,'No se encontró una de las fotos.');});return {src,thumb:src.replace(/\.(jpg|webp|png|mp4)$/,'-thumb.jpg'),kind:match[1].endsWith('.mp4')?'video':'photo'};}
 const data=typeof src==='string' && src.match(/^data:(image\/(?:jpeg|png|webp)|video\/mp4);base64,([A-Za-z0-9+/=]+)$/);
 if(!data)throw new HttpError(400,'Formato de fotografía no admitido.');
 const buffer=Buffer.from(data[2],'base64');if(buffer.length>20*1024*1024)throw new HttpError(413,'Cada archivo debe pesar menos de 20 MB.');
 if(data[1]==='video/mp4'){
  if(buffer.length<16 || buffer.toString('ascii',4,8)!=='ftyp')throw new HttpError(400,'Vídeo MP4 no válido.');
  const thumb=typeof thumbnail==='string' && thumbnail.match(/^data:image\/(?:jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/);
  if(!thumb)throw new HttpError(400,'El respaldo del vídeo necesita una miniatura.');
  let image;try{image=await sharp(Buffer.from(thumb[1],'base64'),{limitInputPixels:60_000_000}).rotate().resize(480,480,{fit:'inside'}).jpeg({quality:82}).toBuffer();}catch{throw new HttpError(400,'Miniatura no válida.');}
  const id=digest(buffer).slice(0,24);await writeFile(join(mediaDir,id+'.mp4'),buffer);await writeFile(join(mediaDir,id+'-thumb.jpg'),image);
  return {src:'/media/'+id+'.mp4',thumb:'/media/'+id+'-thumb.jpg',kind:'video'};
 }
 let output;
 try{output=await sharp(buffer,{limitInputPixels:60_000_000}).rotate().resize(1800,1800,{fit:'inside',withoutEnlargement:true}).jpeg({quality:88}).toBuffer();}catch{throw new HttpError(400,'No se pudo leer una de las imágenes.');}
 const id=digest(output).slice(0,24);
 await writeFile(join(mediaDir,id+'.jpg'),output);
 await sharp(output).resize(480,480,{fit:'inside',withoutEnlargement:true}).jpeg({quality:82}).toFile(join(mediaDir,id+'-thumb.jpg'));
 return {src:'/media/'+id+'.jpg',thumb:'/media/'+id+'-thumb.jpg',kind:'photo'};
}
async function validateArchive(data){
 if(!data || !Array.isArray(data.memories) || !Array.isArray(data.letters) || data.memories.length>2000 || data.letters.length>200)throw new HttpError(400,'Archivo no válido.');
 const checkId=id=>typeof id==='string' && /^[\w-]{1,100}$/.test(id);
 const memories=[];
 for(const m of data.memories){
  if(!m || !checkId(m.id))throw new HttpError(400,'Identificador no válido.');
  const asset=await ingest(m.src,m.kind,m.thumb);
  memories.push({id:m.id,title:clean(m.title,100)||'Un instante contigo',album:clean(m.album,60)||'Nuestros momentos',note:clean(m.note,6000),date:validDate(m.date)?m.date:'',month:m.month===''?'':/^\d{4}-(0[1-9]|1[0-2])$/.test(m.month||'')?m.month:(validDate(m.date)?m.date.slice(0,7):''),...asset,originalName:clean(m.originalName,150),featured:Boolean(m.featured),hidden:Boolean(m.hidden),updated:Number(m.updated)||Date.now()});
 }
 const letters=data.letters.map(l=>{if(!l || !checkId(l.id))throw new HttpError(400,'Carta no válida.');return {id:l.id,title:clean(l.title,100)||'Para ti',note:clean(l.note,6000),updated:Number(l.updated)||Date.now()};});
 if(new Set(memories.map(m=>m.id)).size!==memories.length || new Set(letters.map(l=>l.id)).size!==letters.length)throw new HttpError(400,'Identificadores duplicados.');
 return {memories,letters,favorites:Array.isArray(data.favorites)?[...new Set(data.favorites.filter(id=>memories.some(m=>m.id===id)))]:[]};
}
function persist(next,revision){
 const result=db.prepare('UPDATE archive SET revision=revision+1,payload=? WHERE id=1 AND revision=?').run(JSON.stringify(next),revision);
 if(!result.changes)throw new HttpError(409,'El archivo cambió desde otra sesión. Actualiza antes de guardar.');
 return getArchive();
}
async function serveFile(req,res,path,type){
 let details;try{details=await stat(path);}catch{throw new HttpError(404,'Archivo no encontrado.');}
 const range=req.headers.range;
 if(range && type==='video/mp4'){
  const parts=/^bytes=(\d+)-(\d*)$/.exec(range);if(!parts)throw new HttpError(416,'Rango no válido.');
  const start=Number(parts[1]),end=parts[2]?Math.min(Number(parts[2]),details.size-1):details.size-1;
  if(start>end || start>=details.size)throw new HttpError(416,'Rango no válido.');
  res.writeHead(206,{'Content-Type':type,'Accept-Ranges':'bytes','Content-Range':'bytes '+start+'-'+end+'/'+details.size,'Content-Length':end-start+1});createReadStream(path,{start,end}).pipe(res);return;
 }
 res.writeHead(200,{'Content-Type':type,'Content-Length':details.size,...(type==='video/mp4'?{'Accept-Ranges':'bytes'}:{})});if(req.method==='HEAD'){res.end();return;}createReadStream(path).pipe(res);
}
const server=http.createServer(async(req,res)=>{
 securityHeaders(res);
 try{
  const pathname=new URL(req.url,'http://localhost').pathname;
  if(req.method==='GET' && pathname==='/api/session'){
   const current=session(req);json(res,200,current?{authenticated:true,role:current.role,csrf:current.csrf}:{authenticated:false,retryAfter:cooldown('entry',clientKey(req))});return;
  }
  if(req.method==='POST' && ['/api/login','/api/admin/login'].includes(pathname)){
   originCheck(req);const scope=pathname.includes('admin')?'admin':'entry';
   if(scope==='admin')requireWrite(req,null);
   const input=await body(req,2048),ip=clientKey(req);reserveAttempt(scope,ip);
   const valid=await verifyPassword(input.password,credentials[scope]);
   if(!valid){audit('login-failed',scope);const retryAfter=cooldown(scope,ip);throw new HttpError(retryAfter?429:401,'La clave no es correcta.',{retryAfter});}
   db.prepare('DELETE FROM limits WHERE key=?').run(scope+':ip:'+ip);
   audit('login',scope);json(res,200,createSession(req,res,scope==='admin'?'admin':'viewer'));return;
  }
  if(req.method==='POST' && pathname==='/api/logout'){
   const current=requireWrite(req,null);db.prepare('DELETE FROM sessions WHERE hash=?').run(current.hash);cookie(res,'',0);json(res,200,{ok:true});return;
  }
  if(req.method==='POST' && pathname==='/api/admin/logout'){
   requireWrite(req);json(res,200,createSession(req,res,'viewer'));return;
  }
  if(req.method==='GET' && pathname==='/api/archive'){
   const current=requireSession(req);const archive=getArchive();
   if(current.role!=='admin'){archive.memories=archive.memories.filter(m=>!m.hidden).map(({originalName,...m})=>m);archive.favorites=archive.favorites.filter(id=>archive.memories.some(m=>m.id===id));}
   json(res,200,archive);return;
  }
  if(req.method==='PUT' && pathname==='/api/archive'){
   requireWrite(req);const input=await body(req);if(input.revision!==getArchive().revision)throw new HttpError(409,'El archivo cambió. Recarga antes de editar.');
   const next=await validateArchive(input);json(res,200,persist(next,input.revision));audit('archive-save',String(next.memories.length)+' recuerdos');return;
  }
  if(req.method==='POST' && pathname==='/api/favorite'){
   const current=requireWrite(req,null);const input=await body(req,2048);const archive=getArchive();
   if(!archive.memories.some(m=>m.id===input.id && (!m.hidden || current.role==='admin')))throw new HttpError(404,'Recuerdo no encontrado.');
   const revision=archive.revision;delete archive.revision;
   archive.favorites=input.favorite?[...new Set([...archive.favorites,input.id])]:archive.favorites.filter(id=>id!==input.id);
   persist(archive,revision);json(res,200,{ok:true});return;
  }
  if(req.method==='POST' && pathname==='/api/admin/password'){
   requireWrite(req);const input=await body(req,4096);const ip=clientKey(req);reserveAttempt('password',ip);
   if(!await verifyPassword(input.current,credentials.admin))throw new HttpError(401,'La clave actual no es correcta.');
   if(typeof input.next!=='string' || input.next.length<14 || input.next.length>128)throw new HttpError(400,'Usa entre 14 y 128 caracteres.');
   credentials={...credentials,admin:await hashPassword(input.next)};
   await writeFile(join(dataDir,'credentials.json'),JSON.stringify(credentials),{mode:0o600});
   db.prepare("DELETE FROM sessions WHERE role='admin'").run();audit('admin-password-change');json(res,200,createSession(req,res,'admin'));return;
  }
  const mediaMatch=pathname.match(mediaPattern);
  if((req.method==='GET' || req.method==='HEAD') && mediaMatch){
   const current=requireSession(req);const data=getArchive();
   if(!data.memories.some(m=>(m.src===pathname || m.thumb===pathname) && (!m.hidden || current.role==='admin')))throw new HttpError(404,'Recuerdo no encontrado.');
   const type=pathname.endsWith('.mp4')?'video/mp4':pathname.endsWith('.png')?'image/png':pathname.endsWith('.webp')?'image/webp':'image/jpeg';
   await serveFile(req,res,join(mediaDir,mediaMatch[1]),type);return;
  }
  const staticFiles={'/':['index.html','text/html; charset=utf-8'],'/index.html':['index.html','text/html; charset=utf-8'],'/style.css':['style.css','text/css; charset=utf-8'],'/script.js':['script.js','text/javascript; charset=utf-8']};
  staticFiles['/favicon.svg']=['favicon.svg','image/svg+xml'];
  staticFiles['/photo-cache.mjs']=['photo-cache.mjs','text/javascript; charset=utf-8'];
  if((req.method==='GET' || req.method==='HEAD') && staticFiles[pathname]){await serveFile(req,res,join(root,staticFiles[pathname][0]),staticFiles[pathname][1]);return;}
  if(pathname==='/favicon.ico'){res.writeHead(204);res.end();return;}
  throw new HttpError(404,'No encontrado.');
 }catch(error){
  if(res.headersSent){res.destroy();return;}
  if(error.extra?.retryAfter)res.setHeader('Retry-After',String(error.extra.retryAfter));
  if(!error.status)console.error('Error del servidor:',error.message);
  json(res,error.status||500,{error:error.status?error.message:'No se pudo completar la operación.',...error.extra});
 }
});
server.requestTimeout=30000;server.headersTimeout=10000;
server.listen(port,host,()=>console.log('Nosotros listo en '+allowedOrigin+' · fotos y API protegidas.'));
const cleanup=setInterval(()=>{db.prepare('DELETE FROM sessions WHERE expires<?').run(Date.now());db.prepare('DELETE FROM audit WHERE time<?').run(Date.now()-90*86400000);db.prepare('DELETE FROM limits WHERE started<? AND blocked<?').run(Date.now()-86400000,Date.now());},3600000);cleanup.unref();
process.on('SIGINT',()=>server.close(()=>{db.close();process.exit(0);}));
