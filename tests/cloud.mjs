import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { mkdtemp, mkdir, writeFile, rm, realpath, readdir, readFile } from 'node:fs/promises';
import { resolve, dirname, basename } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { chromium } from 'playwright';
import sharp from 'sharp';
import { hashPassword, verifyPassword } from '../server/security.mjs';
import { migrate, attempt, cooldown, getArchive } from '../server/cloud-store.mjs';
import { createHandler, csp } from '../server/cloud-handler.mjs';
import { seedCloud } from '../scripts/cloud-prepare.mjs';
import { environmentPayload, syncEnvironment, vercelAPI } from '../scripts/vercel-env.mjs';

const db=new PGlite();
let queryCount=0,upstreamCount=0;
const store={query:async(text,params=[]) => {queryCount++;return (await db.query(text,params)).rows;},
  transaction:statements=>db.transaction(async tx=>{const results=[];for(const [text,params=[]] of statements)results.push((await tx.query(text,params)).rows);return results;})};
let server,upstream,temporary,browser;
try {
  await migrate(store); await migrate(store);
  const now=1_800_000_000_000;
  const attempts=await Promise.all(Array.from({length:12},()=>attempt(store,'concurrent','client',now)));
  assert.equal(attempts.filter(x=>x.allowed).length,5);
  assert.equal(await cooldown(store,'concurrent','client',now),30);
  assert.equal((await attempt(store,'concurrent','client',now+29999)).allowed,false);
  for(let i=0;i<5;i++)await attempt(store,'concurrent','client',now+30001);
  assert.equal(await cooldown(store,'concurrent','client',now+30001),120);
  const distributed=await Promise.all(Array.from({length:40},(_,i)=>attempt(store,'global','ip'+i,now)));
  assert.equal(distributed.filter(x=>x.allowed).length,30);
  assert.equal(await cooldown(store,'global','new-ip',now),900);
  await migrate(store);
  assert.equal(await cooldown(store,'global','new-ip',now),900,'migration must not reset limits');
  console.log('Cloud SQL: límites atómicos, globales, progresivos y persistentes OK.');

  await mkdir('.qa',{recursive:true});temporary=await mkdtemp(resolve('.qa/cloud-test-'));
  const photo='/media/'+'a'.repeat(24)+'.jpg',thumb='/media/'+'a'.repeat(24)+'-thumb.jpg';
  const fixtureImage=await sharp({create:{width:320,height:240,channels:3,background:'#681c32'}}).jpeg().toBuffer();
  for(const path of [photo,thumb])await writeFile(resolve(temporary,basename(path)),fixtureImage);
  const initial={memories:[{id:'visible',src:photo,thumb,title:'Nosotros',month:'2026-02',originalName:'private-name.jpg'},{id:'hidden',src:'/media/'+'b'.repeat(24)+'.jpg',thumb,hidden:true}],letters:[],favorites:[]};
  await writeFile(resolve(temporary,basename(initial.memories[1].src)),Buffer.from('test-only-hidden'));
  const credentials={entry:await hashPassword('230499'),admin:await hashPassword('test-admin-secret-long')};
  let uploads=0;
  const media={
    importFile:async path=>{uploads++;return {path,public_id:path.slice(7),resource_type:'image',format:'jpg',bytes:15};},
    sign:(id,type)=>({url:'https://api.cloudinary.com/v1_1/test/'+type+'/upload',fields:{public_id:'nosotros-private/'+id,type:'authenticated',signature:'test-signature'}}),
    inspect:async(id,type)=>({public_id:'nosotros-private/'+id,resource_type:type,format:type==='video'?'mp4':'jpg',bytes:15}),
    download:()=>upstreamURL,
  };
  const seeded=await seedCloud({store,media,archive:initial,credentials,mediaDir:temporary});
  assert.equal(seeded.uploaded,3);assert.equal(uploads,3);
  assert.equal((await seedCloud({store,media,archive:initial,credentials,mediaDir:temporary})).alreadyInitialized,true);
  assert.equal(uploads,3);
  upstream=http.createServer((req,res)=>{upstreamCount++;res.setHeader('Content-Type','image/jpeg');res.setHeader('Content-Length',fixtureImage.length);res.end(fixtureImage);});
  upstream.listen(0,'127.0.0.1');await once(upstream,'listening');
  const upstreamURL='http://127.0.0.1:'+upstream.address().port;
  let handler;
  server=http.createServer(async(req,res)=>{
    const files={'/':['index.html','text/html'],'/script.js':['script.js','text/javascript'],'/photo-cache.mjs':['photo-cache.mjs','text/javascript'],'/style.css':['style.css','text/css'],'/favicon.svg':['favicon.svg','image/svg+xml']};
    const pathname=new URL(req.url,'http://localhost').pathname;
    if(req.method==='GET' && files[pathname]){const [file,type]=files[pathname];res.writeHead(200,{'Content-Type':type,'Content-Security-Policy':csp});res.end(await readFile(file));return;}
    return handler(req,res);
  });server.listen(0,'127.0.0.1');await once(server,'listening');
  const base='http://127.0.0.1:'+server.address().port;
  handler=createHandler({store,media,env:{APP_ORIGIN:base},secure:true});
  const call=async(path,{method='GET',data,cookie,csrf,origin=base,headers={}}={})=>{
    const response=await fetch(base+path,{method,headers:{Origin:origin,...(data===undefined?{}:{'Content-Type':'application/json'}),...(cookie?{Cookie:cookie}:{}),...(csrf?{'X-CSRF-Token':csrf}:{}),...headers},...(data===undefined?{}:{body:JSON.stringify(data)})});
    const text=await response.text();let body;try{body=JSON.parse(text);}catch{body=text;}
    return {status:response.status,body,headers:response.headers,cookie:response.headers.get('set-cookie')?.split(';')[0]};
  };
  assert.equal((await call('/api/session')).body.authenticated,false);
  assert.equal((await call('/api/archive')).status,401);
  assert.equal((await call(photo)).status,401);
  assert.equal((await call('/.env.local')).status,404);
  assert.equal((await call('/api/login',{method:'POST',data:{password:'230499'},origin:'https://evil.example'})).status,403);
  assert.equal((await call('/api/login',{method:'POST',data:{password:'000000'}})).status,401);
  const viewer=await call('/api/login',{method:'POST',data:{password:'230499'}});
  assert.equal(viewer.status,200);assert.equal(viewer.body.uploadMode,'cloudinary');assert.match(viewer.headers.get('set-cookie'),/HttpOnly.*SameSite=Strict.*Secure/);
  const v={cookie:viewer.cookie,csrf:viewer.body.csrf};
  const publicArchive=(await call('/api/archive',v)).body;
  assert.equal(publicArchive.memories.length,1);assert.equal(publicArchive.memories[0].originalName,undefined);
  assert.equal((await call(initial.memories[1].src,v)).status,404);
  const image=await call(photo,v);assert.equal(image.status,200);assert.equal(image.headers.get('content-length'),String(fixtureImage.length));assert.match(image.headers.get('cache-control'),/no-store/);
  const queriesBefore=queryCount,upstreamBefore=upstreamCount;
  const smaller=await call(photo+'?size=960',v);
  assert.equal(smaller.status,200);assert.equal(smaller.headers.get('content-type'),'image/webp');
  assert.equal(queryCount-queriesBefore,1,'one live permission query per photo');
  assert.equal(upstreamCount-upstreamBefore,1);
  assert.match(smaller.headers.get('cache-control'),/private, no-store/);
  const warm=await call(photo+'?size=960',v);assert.equal(warm.status,200);
  assert.equal(upstreamCount-upstreamBefore,1,'warm private variants avoid provider roundtrip');
  assert.equal(queryCount-queriesBefore,2,'a warm variant still rechecks authorization');
  assert.equal((await call(photo+'?size=960')).status,401);
  const concurrentBefore=upstreamCount;
  const simultaneous=await Promise.all([call(photo+'?size=480',v),call(photo+'?size=480',v)]);
  assert(simultaneous.every(r=>r.status===200));assert.equal(upstreamCount-concurrentBefore,1,'variant generation is deduplicated');
  assert.equal((await call('/api/uploads/sign',{...v,method:'POST',data:{resourceType:'image'}})).status,403);
  assert.equal((await call('/api/favorite',{cookie:v.cookie,method:'POST',data:{id:'visible',favorite:true}})).status,403);
  assert.equal((await call('/api/favorite',{...v,method:'POST',data:{id:'visible',favorite:true}})).status,200);
  const admin=await call('/api/admin/login',{...v,method:'POST',data:{password:'test-admin-secret-long'}});
  assert.equal(admin.status,200);const a={cookie:admin.cookie,csrf:admin.body.csrf};
  assert.equal((await call(initial.memories[1].src+'?size=960',a)).status,200,'admin may warm a hidden photo');
  assert.equal((await call('/api/archive',v)).status,401,'privilege elevation revokes old cookie');
  assert.equal((await call('/api/uploads/sign',{...a,method:'POST',data:{resourceType:'raw'}})).status,400);
  const ticket=await call('/api/uploads/sign',{...a,method:'POST',data:{resourceType:'image'}});
  assert.equal(ticket.status,200);assert.equal(ticket.body.fields.type,'authenticated');
  const complete=await call('/api/uploads/complete',{...a,method:'POST',data:{id:ticket.body.id}});
  assert.equal(complete.status,200);
  assert.deepEqual((await call('/api/uploads/complete',{...a,method:'POST',data:{id:ticket.body.id}})).body,complete.body);
  let data=(await call('/api/archive',a)).body;
  data.memories.push({id:'new',title:'Una foto',src:complete.body.path,thumb:complete.body.path});
  const saved=await call('/api/archive',{...a,method:'PUT',data});assert.equal(saved.status,200);
  assert.equal((await call('/api/archive',{...a,method:'PUT',data})).status,409);
  assert.equal((await call('/api/archive',{...a,method:'PUT',data:{...saved.body,memories:[{id:'bad',src:'https://other.example/photo.jpg',thumb}]}})).status,400);
  const changed=await call('/api/admin/password',{...a,method:'POST',data:{current:'test-admin-secret-long',next:'new-test-secret-long'}});
  assert.equal(changed.status,200);assert.equal((await call('/api/archive',a)).status,401);
  await seedCloud({store,media,archive:initial,credentials,mediaDir:temporary});
  const [keys]=await store.query("SELECT value FROM nosotros.settings WHERE key='credentials'");
  assert(await verifyPassword('new-test-secret-long',keys.value.admin));assert.equal((await getArchive(store)).memories.length,3);
  const a2={cookie:changed.cookie,csrf:changed.body.csrf};
  const downgraded=await call('/api/admin/logout',{...a2,method:'POST',data:{}});
  assert.equal(downgraded.body.role,'viewer');assert.equal(downgraded.body.uploadMode,'cloudinary');
  assert.equal((await call(initial.memories[1].src+'?size=960',{cookie:downgraded.cookie})).status,404,'viewer cannot access cached admin-only photo');
  await call('/api/logout',{cookie:downgraded.cookie,csrf:downgraded.body.csrf,method:'POST',data:{}});
  assert.equal((await call(photo,{cookie:downgraded.cookie})).status,401);
  assert.equal((await call(photo+'?size=960',{cookie:downgraded.cookie})).status,401,'logout also revokes access to cached variants');
  const failed=await Promise.all(Array.from({length:9},()=>call('/api/login',{method:'POST',data:{password:'000000'},headers:{'X-Forwarded-For':Math.random().toString()}})));
  assert.equal(failed.filter(result=>result.status===401).length,4);
  assert.equal(failed.filter(result=>result.status===429).length,5);
  handler=createHandler({store,media,env:{APP_ORIGIN:base},secure:true});
  assert.equal((await call('/api/login',{method:'POST',data:{password:'230499'}})).status,429,'new function instance cannot bypass cooldown');
  assert((await call('/api/router?route=session')).body.retryAfter>0);
  console.log('Cloud HTTP: candado, CSRF, permisos, medios privados, cargas, revisiones y cambio de clave OK.');

  // Full browser path through the cloud adapter, with only the external upload
  // transport mocked. SQL, sessions, CSRF, finalize and archive save stay real.
  await store.query('DELETE FROM nosotros.limits');
  handler=createHandler({store,media,env:{APP_ORIGIN:base},secure:false});
  browser=await chromium.launch({headless:true});
  const context=await browser.newContext({viewport:{width:390,height:844},reducedMotion:'reduce'});
  const page=await context.newPage();page.setDefaultTimeout(15000);
  const errors=[],directUploads=[];
  page.on('pageerror',error=>{errors.push(error.message);console.error('Cloud page error:',error.message);});
  page.on('response',async response=>{if(response.url().startsWith(base+'/api/') && response.status()>=400)console.error('Cloud browser API:',response.status(),new URL(response.url()).pathname,await response.text());});
  await page.route('https://api.cloudinary.com/**',async route=>{
    directUploads.push(route.request().postData());
    await route.fulfill({status:200,headers:{'Access-Control-Allow-Origin':base,'Content-Type':'application/json'},body:'{"ok":true}'});
  });
  const boot=page.waitForResponse(response=>response.url()===base+'/api/session');
  await page.goto(base);await boot;
  assert.equal(await page.locator('img[src]').count(),0);
  for(const [selector,value] of [['#lock-day','23'],['#lock-month','04'],['#lock-year','99']])await page.locator(selector).fill(value);
  await page.locator('#unlock-button').click();
  try { await page.locator('#app').waitFor({state:'visible'}); }
  catch(error) {console.error('Gate diagnostic:',await page.locator('#gate-message').textContent(),await page.locator('#secret-form input').evaluateAll(inputs=>inputs.map(x=>({id:x.id,value:x.value,validation:x.validationMessage}))));throw error;}
  await page.locator('#open-admin').click();await page.locator('#admin-password').fill('new-test-secret-long');await page.locator('#admin-login-form button[type=submit]').click();
  await page.locator('#admin-dialog').waitFor({state:'visible'});
  await page.locator('#admin-dialog [data-add=memory]').click();
  await page.locator('#photo-files').setInputFiles({name:'cloud-test.jpg',mimeType:'image/jpeg',buffer:fixtureImage});
  await page.locator('#entry-title').fill('Recuerdo en la nube');await page.locator('#entry-month').fill('2026-07');
  await page.locator('#save-entry').click();await page.locator('#editor-dialog').waitFor({state:'hidden'});
  assert.equal(directUploads.length,2,'photo and thumbnail upload separately, outside Vercel');
  assert(directUploads.every(body=>body.includes('authenticated')));
  assert((await getArchive(store)).memories.some(m=>m.title==='Recuerdo en la nube' && m.src.startsWith('/media/') && !m.src.includes('data:')));
  await page.reload();await page.locator('#app').waitFor({state:'visible'});await page.locator('#open-admin').click();
  await page.locator('#admin-search').fill('Recuerdo en la nube');assert.equal(await page.locator('#admin-grid .admin-card').count(),1);
  await page.locator('#admin-dialog [data-close]').click();
  const downloadPromise=page.waitForEvent('download');await page.locator('#export-archive').click();
  const download=await downloadPromise;const backupPath=resolve(temporary,'backup.json');await download.saveAs(backupPath);
  const backup=JSON.parse(await readFile(backupPath,'utf8'));assert.equal(backup.memories.length,4);assert(backup.memories.every(m=>m.src.startsWith('data:image/')));
  const video={id:'restored-video',title:'Video restaurado',src:'data:video/mp4;base64,'+Buffer.from('0000ftyp0000test-video').toString('base64'),thumb:'data:image/jpeg;base64,'+fixtureImage.toString('base64'),kind:'video',updated:Date.now()};
  await page.locator('#import-file').setInputFiles({name:'restore.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({...backup,memories:[{...backup.memories[0],id:'restored-photo',updated:Date.now()},video],letters:[],favorites:[]}))});
  await page.waitForFunction(()=>document.querySelector('#toast').textContent==='Respaldo importado. Tus recuerdos anteriores siguen aquí.');
  assert.equal((await getArchive(store)).memories.length,6);
  assert.equal(directUploads.length,6);assert((await getArchive(store)).memories.find(m=>m.id==='restored-video').src.endsWith('.mp4'));
  assert.deepEqual(errors,[]);
  await context.close();await browser.close();browser=null;
  console.log('Cloud navegador: candado, admin móvil, carga directa, persistencia, respaldo e importación foto/vídeo OK.');

  const env={DATABASE_URL:'test-db-secret',CLOUDINARY_URL:'test-cloud-secret',VERCEL_TOKEN:'never-publish',ADMIN_PASSWORD:'never-publish-either'};
  const payload=environmentPayload(env);assert.equal(payload.length,2);assert(payload.every(x=>x.type==='sensitive' && x.visibility==='secret' && x.target.join()==='production'));
  const requests=[];
  const api=vercelAPI('token-local','team_test',async(url,options)=>{requests.push({url,options});return {ok:true,json:async()=>({created:[],failed:[]})};});
  assert.deepEqual(await syncEnvironment(api,'prj_test',env),['DATABASE_URL','CLOUDINARY_URL']);
  assert.equal(requests[0].url.pathname,'/v10/projects/prj_test/env');assert.equal(requests[0].url.searchParams.get('upsert'),'true');
  assert(!requests[0].options.body.includes('never-publish'));assert.equal(requests[0].options.redirect,'error');
  await assert.rejects(()=>api('https://untrusted.example'),/no permitido/);
  await assert.rejects(()=>syncEnvironment(vercelAPI('token','',async()=>({ok:true,status:201,json:async()=>({failed:[{key:'DATABASE_URL',value:'not-to-log'}]})})),'prj',env),/HTTP 201/);
  const config=JSON.parse(await readFile('vercel.json','utf8'));
  assert.equal(config.headers[0].headers.find(x=>x.key==='Content-Security-Policy').value,csp);
  await import('../scripts/build.mjs');
  assert.deepEqual((await readdir('dist')).sort(),['favicon.svg','index.html','photo-cache.mjs','script.js','style.css']);
  console.log('Deployment: build público mínimo, sincronización solo de variables permitidas y errores seguros OK.');
} finally {
  if(browser)await browser.close();
  for(const instance of [server,upstream])if(instance){instance.closeAllConnections();await new Promise(resolve=>instance.close(resolve));}
  await db.close();
  if(temporary){const actual=await realpath(temporary),parent=await realpath('.qa');if(dirname(actual)!==parent || !basename(actual).startsWith('cloud-test-'))throw new Error('Unsafe QA cleanup');await rm(actual,{recursive:true});}
}
