import { readFile, stat } from 'node:fs/promises';
import { resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { connectStore, migrate, getArchive, putAsset } from '../server/cloud-store.mjs';
import { createMedia, mediaPattern } from '../server/cloud-media.mjs';
import { validateArchive } from '../server/cloud-validation.mjs';

export async function checkServices(store,media) {
  try { await store.query('SELECT 1 AS ok'); }
  catch { throw new Error('Neon rechazó la conexión. Copia de nuevo la cadena completa en DATABASE_URL dentro de .env.local. No se han importado fotos.'); }
  console.log('Neon: conexión correcta.');
  try { await media.ping(); }
  catch { throw new Error('Cloudinary rechazó la conexión. Revisa CLOUDINARY_URL en .env.local.'); }
  console.log('Cloudinary: conexión correcta.');
}

export async function seedCloud({store,media,archive,credentials,mediaDir,progress=()=>{}}) {
  await migrate(store);
  if(await getArchive(store)) {
    const keys=await store.query("SELECT key FROM nosotros.settings WHERE key='credentials'");
    if(!keys.length)throw new Error('Existe un archivo remoto sin credenciales. Revisa la base de datos antes de continuar.');
    return {alreadyInitialized:true,uploaded:0};
  }
  for(const scope of ['entry','admin'])if(!/^[a-f0-9]{48}$/.test(credentials?.[scope]?.salt||'') || !/^[a-f0-9]{128}$/.test(credentials?.[scope]?.hash||''))throw new Error('No se encuentran las claves locales válidas.');
  const paths=[...new Set(archive.memories.flatMap(m=>[m.src,m.thumb]))];
  for(const path of paths){if(!mediaPattern.test(path))throw new Error('El archivo local contiene una ruta no válida.');await stat(resolve(mediaDir,basename(path)));}
  let uploaded=0;
  for(const path of paths){
    if(!(await store.query('SELECT path FROM nosotros.assets WHERE path=$1',[path])).length){
      const asset=await media.importFile(path,resolve(mediaDir,basename(path)));
      await putAsset(store,asset);uploaded++;
    }
    progress(paths.indexOf(path)+1,paths.length);
  }
  const clean=await validateArchive(store,archive);
  // Credentials and initial content become visible together. Subsequent runs
  // never replace edits/password changes made in the online administration.
  await store.transaction([
    ["INSERT INTO nosotros.settings(key,value) VALUES('credentials',$1::jsonb) ON CONFLICT DO NOTHING",[JSON.stringify(credentials)]],
    ['INSERT INTO nosotros.archive(id,revision,payload) VALUES(1,1,$1::jsonb) ON CONFLICT DO NOTHING',[JSON.stringify(clean)]],
  ]);
  return {alreadyInitialized:false,uploaded};
}

export async function prepareCloud(store=connectStore(),media=createMedia()) {
  const dbPath=resolve('.private/archive.sqlite');
  await stat(dbPath).catch(()=>{throw new Error('Falta .private/archive.sqlite. Abre primero la versión local con npm start.');});
  const local=new DatabaseSync(dbPath,{readOnly:true});
  let row;
  try{row=local.prepare('SELECT payload FROM archive WHERE id=1').get();}finally{local.close();}
  if(!row)throw new Error('No hay archivo local para importar.');
  const credentials=JSON.parse(await readFile(resolve('.private/credentials.json'),'utf8'));
  const result=await seedCloud({store,media,archive:JSON.parse(row.payload),credentials,mediaDir:resolve('private-media'),progress:(done,total)=>{if(done===total || done%10===0)console.log(`Archivos privados preparados: ${done}/${total}`);}});
  console.log(result.alreadyInitialized?'El archivo remoto ya existe: se conservan todos sus cambios y claves.':`Archivo inicial importado; ${result.uploaded} archivos privados preparados.`);
  return result;
}

if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{const store=connectStore(),media=createMedia();await checkServices(store,media);if(!process.argv.includes('--check'))await prepareCloud(store,media);}
  catch(error){console.error(error instanceof Error && !error.http_code && !error.code?error.message:'No se pudo completar la preparación. Comprueba los servicios y vuelve a ejecutar; no se borran los originales.');process.exitCode=1;}
}
