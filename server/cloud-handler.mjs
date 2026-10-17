import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { token, digest, verifyPassword, hashPassword } from './security.mjs';
import { getArchive, cooldown, attempt, putAsset } from './cloud-store.mjs';
import { HttpError, validateArchive } from './cloud-validation.mjs';
import { mediaPattern } from './cloud-media.mjs';
import { createPhotoVariants, variantSize } from './photo-variants.mjs';

const json=(res,status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(data));};
export const csp="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self' https://api.cloudinary.com; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'";
function headers(res,secure) {
  for(const [key,value] of Object.entries({'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY','Referrer-Policy':'no-referrer','Cross-Origin-Resource-Policy':'same-origin','Content-Security-Policy':csp,'Permissions-Policy':'camera=(), microphone=(), geolocation=()'}))res.setHeader(key,value);
  if(secure)res.setHeader('Strict-Transport-Security','max-age=31536000');
}
async function body(req,max=3_800_000) {
  if(!String(req.headers['content-type']||'').startsWith('application/json'))throw new HttpError(415,'Se requiere JSON.');
  if(Number(req.headers['content-length'])>max)throw new HttpError(413,'Los textos del archivo superan el límite de una petición.');
  let value;
  if(req.body!==undefined) {
    const raw=typeof req.body==='object' && !Buffer.isBuffer(req.body)?JSON.stringify(req.body):String(req.body);
    if(Buffer.byteLength(raw)>max)throw new HttpError(413,'Carga demasiado grande.');
    try{value=JSON.parse(raw);}catch{throw new HttpError(400,'Datos no válidos.');}
  } else {
    const chunks=[];let size=0;
    for await(const chunk of req){size+=chunk.length;if(size>max)throw new HttpError(413,'Carga demasiado grande.');chunks.push(chunk);}
    try{value=JSON.parse(Buffer.concat(chunks).toString());}catch{throw new HttpError(400,'Datos no válidos.');}
  }
  if(!value || typeof value!=='object' || Array.isArray(value))throw new HttpError(400,'Datos no válidos.');
  return value;
}

export function createHandler({store,media,env=process.env,secure=true}) {
  const photoVariant=createPhotoVariants();
  const origins=new Set([env.APP_ORIGIN,...[env.VERCEL_URL,env.VERCEL_PROJECT_PRODUCTION_URL].filter(Boolean).map(host=>'https://'+host)].filter(Boolean));
  const clientKey=req=>digest(env.VERCEL==='1'?String(req.headers['x-vercel-forwarded-for']||req.headers['x-forwarded-for']||'unknown').split(',')[0].trim():(req.socket.remoteAddress||'unknown'));
  function originCheck(req){if(!origins.has(req.headers.origin) || req.headers['sec-fetch-site']==='cross-site')throw new HttpError(403,'Origen no permitido. Comprueba APP_ORIGIN si usas un dominio propio.');}
  function sessionHash(req){
    const raw=String(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('nosotros_session='))?.slice(17);
    if(!raw || !/^[A-Za-z0-9_-]{40,50}$/.test(raw))return null;
    return digest(raw);
  }
  async function session(req){
    const hash=sessionHash(req);if(!hash)return null;
    return (await store.query('SELECT * FROM nosotros.sessions WHERE hash=$1 AND expires>$2',[hash,Date.now()]))[0] || null;
  }
  async function requireSession(req,role){const current=await session(req);if(!current)throw new HttpError(401,'Abre el candado para continuar.');if(role && current.role!==role)throw new HttpError(403,'Esta acción necesita acceso de administración.');return current;}
  async function requireWrite(req,role='admin'){originCheck(req);const current=await requireSession(req,role);if(req.headers['x-csrf-token']!==current.csrf)throw new HttpError(403,'Recarga la página para renovar la sesión.');return current;}
  const cookie=(res,value,seconds)=>res.setHeader('Set-Cookie','nosotros_session='+value+'; HttpOnly; SameSite=Strict; Path=/; Max-Age='+seconds+(secure?'; Secure':''));
  const authView=current=>({authenticated:true,role:current.role,csrf:current.csrf,uploadMode:'cloudinary'});
  async function createSession(req,res,role){
    const old=await session(req),id=token(),csrf=token(),ttl=role==='admin'?3600:43200;
    await store.transaction([
      ['DELETE FROM nosotros.sessions WHERE hash=$1 OR expires<$2',[old?.hash||'',Date.now()]],
      ['DELETE FROM nosotros.limits WHERE started<$1 AND blocked<$2',[Date.now()-86400000,Date.now()]],
      ['INSERT INTO nosotros.sessions(hash,role,csrf,expires) VALUES($1,$2,$3,$4)',[digest(id),role,csrf,Date.now()+ttl*1000]],
    ]);
    cookie(res,id,ttl);return authView({role,csrf});
  }
  async function credentials(){const [row]=await store.query("SELECT value FROM nosotros.settings WHERE key='credentials'");if(!row)throw new HttpError(503,'Falta preparar el archivo privado. Ejecuta npm run vercel:setup.');return row.value;}
  async function reserve(scope,req,upload=false){const result=await attempt(store,scope,clientKey(req),Date.now(),upload?300:5,upload?1000:30);if(!result.allowed)throw new HttpError(429,'Demasiados intentos. Espera antes de volver a probar.',{retryAfter:result.retryAfter});return result;}
  async function persist(next,revision){const [row]=await store.query('UPDATE nosotros.archive SET revision=revision+1,payload=$1::jsonb WHERE id=1 AND revision=$2 RETURNING revision,payload',[JSON.stringify(next),revision]);if(!row)throw new HttpError(409,'El archivo cambió desde otra sesión. Actualiza antes de guardar.');return {...row.payload,startDate:'2026-02-14T00:00:00-05:00',revision:row.revision};}
  async function archive(){const result=await getArchive(store);if(!result)throw new HttpError(503,'Falta importar el archivo privado. Ejecuta npm run vercel:setup.');return result;}

  return async function handler(req,res){
    headers(res,secure);
    try {
      const url=new URL(req.url,'http://localhost');
      // Rewrites preserve the original path; the explicit route parameter also
      // supports platforms that expose the destination URL to the function.
      let path=url.pathname;
      if(path==='/api/router'){
        if(url.searchParams.has('route'))path='/api/'+url.searchParams.get('route');
        else if(url.searchParams.has('media'))path='/media/'+url.searchParams.get('media');
      }
      if(req.method==='GET' && path==='/api/session'){
        await credentials();
        const current=await session(req);
        return json(res,200,current?authView(current):{authenticated:false,retryAfter:await cooldown(store,'entry',clientKey(req))});
      }
      if(req.method==='POST' && ['/api/login','/api/admin/login'].includes(path)){
        originCheck(req);const scope=path.includes('admin')?'admin':'entry';if(scope==='admin')await requireWrite(req,null);
        const input=await body(req,2048),keys=await credentials(),reserved=await reserve(scope,req);
        if(!await verifyPassword(input.password,keys[scope]))throw new HttpError(reserved.retryAfter?429:401,'La clave no es correcta.',{retryAfter:reserved.retryAfter});
        await store.query('DELETE FROM nosotros.limits WHERE key=$1',[scope+':ip:'+clientKey(req)]);
        return json(res,200,await createSession(req,res,scope==='admin'?'admin':'viewer'));
      }
      if(req.method==='POST' && path==='/api/logout'){
        const current=await requireWrite(req,null);await store.query('DELETE FROM nosotros.sessions WHERE hash=$1',[current.hash]);cookie(res,'',0);return json(res,200,{ok:true});
      }
      if(req.method==='POST' && path==='/api/admin/logout'){await requireWrite(req);return json(res,200,await createSession(req,res,'viewer'));}
      if(req.method==='GET' && path==='/api/archive'){
        const current=await requireSession(req),data=await archive();
        if(current.role!=='admin'){data.memories=data.memories.filter(m=>!m.hidden).map(({originalName,...m})=>m);data.favorites=data.favorites.filter(id=>data.memories.some(m=>m.id===id));}
        return json(res,200,data);
      }
      if(req.method==='PUT' && path==='/api/archive'){
        await requireWrite(req);const input=await body(req);
        if(!Number.isInteger(input.revision))throw new HttpError(400,'Revisión no válida.');
        return json(res,200,await persist(await validateArchive(store,input),input.revision));
      }
      if(req.method==='POST' && path==='/api/favorite'){
        const current=await requireWrite(req,null),input=await body(req,2048),data=await archive();
        if(!data.memories.some(m=>m.id===input.id && (!m.hidden || current.role==='admin')))throw new HttpError(404,'Recuerdo no encontrado.');
        const revision=data.revision;delete data.revision;data.favorites=input.favorite?[...new Set([...data.favorites,input.id])]:data.favorites.filter(id=>id!==input.id);
        await persist(data,revision);return json(res,200,{ok:true});
      }
      if(req.method==='POST' && path==='/api/admin/password'){
        await requireWrite(req);const input=await body(req,4096),keys=await credentials(),reserved=await reserve('password',req);
        if(!await verifyPassword(input.current,keys.admin))throw new HttpError(reserved.retryAfter?429:401,'La clave actual no es correcta.',{retryAfter:reserved.retryAfter});
        if(typeof input.next!=='string' || input.next.length<14 || input.next.length>128)throw new HttpError(400,'Usa entre 14 y 128 caracteres.');
        const changed=await store.query("UPDATE nosotros.settings SET value=$1::jsonb WHERE key='credentials' AND value=$2::jsonb RETURNING key",[JSON.stringify({...keys,admin:await hashPassword(input.next)}),JSON.stringify(keys)]);
        if(!changed.length)throw new HttpError(409,'La clave cambió desde otra sesión.');
        await store.query("DELETE FROM nosotros.sessions WHERE role='admin'");return json(res,200,await createSession(req,res,'admin'));
      }
      if(req.method==='POST' && path==='/api/uploads/sign'){
        const current=await requireWrite(req),input=await body(req,2048);await reserve('upload',req,true);
        if(!['image','video'].includes(input.resourceType))throw new HttpError(400,'Tipo de archivo no válido.');
        const id=digest(token()).slice(0,32);
        await store.query('DELETE FROM nosotros.uploads WHERE expires<$1',[Date.now()]);
        await store.query('INSERT INTO nosotros.uploads(id,session_hash,resource_type,expires) VALUES($1,$2,$3,$4)',[id,current.hash,input.resourceType,Date.now()+3600000]);
        return json(res,200,{id,...media.sign(id,input.resourceType)});
      }
      if(req.method==='POST' && path==='/api/uploads/complete'){
        const current=await requireWrite(req),input=await body(req,2048);
        const [pending]=await store.query('SELECT * FROM nosotros.uploads WHERE id=$1 AND session_hash=$2 AND expires>$3',[String(input.id||''),current.hash,Date.now()]);
        if(!pending)throw new HttpError(400,'La autorización de carga venció. Vuelve a subir la foto.');
        if(pending.path)return json(res,200,{path:pending.path});
        let asset;try{asset=await media.inspect(pending.id,pending.resource_type);}catch{throw new HttpError(400,'No se pudo verificar la carga privada. El máximo por archivo es 20 MB.');}
        asset.path='/media/'+pending.id+'.'+asset.format;
        await putAsset(store,asset);await store.query('UPDATE nosotros.uploads SET path=$1 WHERE id=$2',[asset.path,pending.id]);
        return json(res,200,{path:asset.path});
      }
      if(['GET','HEAD'].includes(req.method) && mediaPattern.test(path)){
        const hash=sessionHash(req);if(!hash)throw new HttpError(401,'Abre el candado para continuar.');
        // One round trip, with live session + visibility checks EVEN for a warm
        // variant. Never cache authorization or send the full archive per photo.
        const [asset]=await store.query(`SELECT s.role,a.path,a.public_id,a.resource_type,a.format,a.bytes
          FROM nosotros.sessions s LEFT JOIN nosotros.assets a ON a.path=$2 AND EXISTS (
            SELECT 1 FROM nosotros.archive ar CROSS JOIN LATERAL jsonb_array_elements(ar.payload->'memories') m
            WHERE ar.id=1 AND (m->>'src'=$2 OR m->>'thumb'=$2) AND (s.role='admin' OR m->>'hidden' IS DISTINCT FROM 'true')
          ) WHERE s.hash=$1 AND s.expires>$3`,[hash,path,Date.now()]);
        if(!asset)throw new HttpError(401,'Abre el candado para continuar.');
        if(!asset.path)throw new HttpError(404,'Recuerdo no encontrado.');
        const size=asset.resource_type==='image'?variantSize(url.searchParams.get('size')):0;
        if(size){
          const output=await photoVariant(asset.public_id,size,async()=>{
            const response=await fetch(media.download(asset),{signal:AbortSignal.timeout(25000)});
            if(!response.ok){await response.body?.cancel();throw new HttpError(502,'No se pudo recuperar este recuerdo.');}
            if(Number(response.headers.get('content-length'))>20*1024*1024){await response.body?.cancel();throw new HttpError(413,'Imagen demasiado grande.');}
            return Buffer.from(await response.arrayBuffer());
          });
          res.setHeader('Content-Type','image/webp');res.setHeader('Content-Length',String(output.length));
          res.statusCode=200;res.end(req.method==='HEAD'?undefined:output);return;
        }
        const range=req.headers.range;
        if(range && !/^bytes=\d+-\d*$/.test(range))throw new HttpError(416,'Rango no válido.');
        const upstream=await fetch(media.download(asset),{method:req.method,headers:range?{Range:range}:{},signal:AbortSignal.timeout(25000)});
        if(!upstream.ok){await upstream.body?.cancel();throw new HttpError(upstream.status===416?416:502,'No se pudo recuperar este recuerdo.');}
        res.statusCode=upstream.status;
        res.setHeader('Content-Type',asset.resource_type==='video'?'video/mp4':asset.format==='jpg'?'image/jpeg':'image/'+asset.format);
        for(const key of ['content-length','content-range','accept-ranges'])if(upstream.headers.has(key))res.setHeader(key,upstream.headers.get(key));
        if(req.method==='HEAD' || !upstream.body){res.end();return;}
        await pipeline(Readable.fromWeb(upstream.body),res);return;
      }
      throw new HttpError(404,'No encontrado.');
    } catch(error) {
      if(res.headersSent){res.destroy();return;}
      if(error.extra?.retryAfter)res.setHeader('Retry-After',String(error.extra.retryAfter));
      // Provider errors may contain credentials: never return/log their message.
      if(!error.status)console.error('Servicio privado no disponible:',error.code || error.name || 'Error');
      json(res,error.status||503,{error:error.status?error.message:'El servicio privado no está disponible. Comprueba la configuración de Neon y Cloudinary.',...error.extra});
    }
  };
}
