// Optional real-provider check. Uploads one synthetic image, never your photos,
// and deletes only its own randomly named test asset in finally.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import sharp from 'sharp';
import { createMedia, configureMedia, folder } from '../server/cloud-media.mjs';
const id='qa-'+randomBytes(20).toString('hex');
let client;
try {
  const media=createMedia();client=configureMedia();
  const image=await sharp({create:{width:24,height:24,channels:3,background:'#681c32'}}).jpeg().toBuffer();
  const ticket=media.sign(id,'image'),form=new FormData();
  for(const [key,value] of Object.entries(ticket.fields))form.append(key,String(value));
  form.append('file',new Blob([image],{type:'image/jpeg'}));
  const uploaded=await fetch(ticket.url,{method:'POST',body:form,signal:AbortSignal.timeout(30000)});
  assert.equal(uploaded.status,200,'signed private upload failed');
  const asset=await media.inspect(id,'image');
  const privateResponse=await fetch(media.download(asset),{signal:AbortSignal.timeout(30000)});
  assert.equal(privateResponse.status,200,'temporary private download failed');
  assert((await privateResponse.arrayBuffer()).byteLength>0);
  const publicURL='https://res.cloudinary.com/'+client.config().cloud_name+'/image/authenticated/'+folder+'/'+id+'.jpg';
  const denied=await fetch(publicURL,{signal:AbortSignal.timeout(30000)});
  assert([401,403,404].includes(denied.status),'unauthenticated URL must not expose image');await denied.body?.cancel();
  console.log('Cloudinary real: carga firmada, archivo authenticated, descarga temporal y URL pública bloqueada OK.');
} catch(error) {
  console.error('Prueba real de Cloudinary falló:',error.code||error.name||'ProviderError');process.exitCode=1;
} finally {
  if(client){
    try{const result=await client.uploader.destroy(folder+'/'+id,{resource_type:'image',type:'authenticated',invalidate:true});assert(['ok','not found'].includes(result.result));console.log('Archivo sintético de prueba retirado; ninguna foto de la pareja se modificó.');}
    catch{console.error('No se pudo retirar el archivo sintético: '+folder+'/'+id);process.exitCode=1;}
  }
}
