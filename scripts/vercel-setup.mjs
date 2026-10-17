import { readFile } from 'node:fs/promises';
import { createInterface } from 'node:readline/promises';
import { execFileSync } from 'node:child_process';
import { connectStore } from '../server/cloud-store.mjs';
import { createMedia } from '../server/cloud-media.mjs';
import { checkServices, prepareCloud } from './cloud-prepare.mjs';
import { vercelAPI, syncEnvironment, environmentPayload } from './vercel-env.mjs';

async function ask(label,fallback='') {
  if(!process.stdin.isTTY)throw new Error('Ejecuta este asistente en tu terminal para autorizar Vercel.');
  const line=createInterface({input:process.stdin,output:process.stdout});
  try{return (await line.question(label+(fallback?' ['+fallback+']':'')+': ')).trim()||fallback;}finally{line.close();}
}
async function hiddenToken(){
  if(!process.stdin.isTTY)throw new Error('Falta VERCEL_TOKEN. Añádelo solo a .env.local o ejecuta el asistente en tu terminal.');
  process.stdout.write('Token de Vercel (entrada oculta; no se guarda): ');
  const input=process.stdin;input.setRawMode(true);input.resume();input.setEncoding('utf8');
  return new Promise((resolve,reject)=>{
    let value='';
    const finish=(error)=>{input.off('data',receive);input.setRawMode(false);input.pause();process.stdout.write('\n');error?reject(error):resolve(value.trim());};
    const receive=chunk=>{for(const character of chunk){if(character==='\u0003'){finish(new Error('Cancelado.'));return;}if(character==='\r' || character==='\n'){finish();return;}if(character==='\u007f' || character==='\b')value=value.slice(0,-1);else if(character>=' ')value+=character;}};
    input.on('data',receive);
  });
}

try {
  environmentPayload(process.env);
  const store=connectStore(),media=createMedia();
  // Check both credentials before asking for Vercel access or uploading files.
  await checkServices(store,media);
  let linked={};try{linked=JSON.parse(await readFile('.vercel/project.json','utf8'));}catch{}
  const projectName=process.env.VERCEL_PROJECT_ID || await ask('Nombre o ID del proyecto EXISTENTE en Vercel',linked.projectId||'');
  if(!projectName)throw new Error('Necesitas el nombre del proyecto de Vercel que ya está conectado a GitHub.');
  const team=process.env.VERCEL_TEAM_ID || (linked.orgId?.startsWith('team_')?linked.orgId:'') || await ask('ID del equipo Vercel (team_...; vacío si es personal)');
  console.log('Si necesitas un token: https://vercel.com/account/settings/tokens. Usa el equipo del proyecto y una caducidad corta.');
  const secret=process.env.VERCEL_TOKEN || await hiddenToken();
  if(!secret)throw new Error('No se recibió autorización de Vercel.');
  const api=vercelAPI(secret,team);
  const project=await api('/v9/projects/'+encodeURIComponent(projectName));
  if(!project.id || !project.name)throw new Error('Vercel no devolvió el proyecto esperado.');
  if(project.link?.type!=='github' || !project.link.repo)throw new Error('Conecta primero este proyecto a GitHub en Vercel → Settings → Git.');
  const remote=execFileSync('git',['remote','get-url','origin'],{encoding:'utf8',windowsHide:true}).trim();
  const repo=remote.match(/github\.com[:/]([^/]+)\/([^/]+?)(?:\.git)?$/);
  if(!repo || repo[1].toLowerCase()!==String(project.link.org).toLowerCase() || repo[2].toLowerCase()!==project.link.repo.toLowerCase())throw new Error('El repositorio conectado a Vercel no coincide con origin. No se modificó el proyecto.');
  console.log(`Destino: ${project.name} · GitHub ${project.link.org}/${project.link.repo} · rama de producción: ${project.link.productionBranch||'la configurada en Vercel'}`);
  console.log('Se importará el archivo local si la base está vacía y se actualizarán SOLO las variables de producción.');
  if((await ask('¿Continuar? Escribe SI')).toUpperCase()!=='SI')throw new Error('Cancelado. No se cambiaron variables ni se importaron fotos.');
  await prepareCloud(store,media);
  const keys=await syncEnvironment(api,project.id,process.env);
  console.log('Variables configuradas sin publicarlas: '+keys.join(', '));
  console.log('Preparación terminada. Haz commit y git push a la rama de producción. Los despliegues siguientes reutilizan los datos y las variables.');
  console.log('El token de Vercel no se subió al proyecto. Puedes revocarlo tras esta configuración.');
} catch(error) {
  // SDK/network failures can include URL credentials; print only controlled errors.
  console.error(error?.constructor===Error && !error.http_code && !error.code?error.message:'No se pudo terminar la preparación. Revisa los servicios y vuelve a intentarlo; los originales permanecen intactos.');
  process.exitCode=1;
}
