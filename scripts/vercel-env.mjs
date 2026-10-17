// Exact allowlist: never upload VERCEL_TOKEN or local passwords as app variables.
export function environmentPayload(env) {
  const variables=['DATABASE_URL','CLOUDINARY_URL'].map(key=>{
    if(!env[key])throw new Error('Falta '+key+' en .env.local.');
    return {key,value:env[key],type:'sensitive',visibility:'secret',target:['production']};
  });
  if(env.APP_ORIGIN){
    const url=new URL(env.APP_ORIGIN);
    if(url.protocol!=='https:' || url.origin!==env.APP_ORIGIN)throw new Error('APP_ORIGIN debe ser un origen HTTPS sin ruta ni barra final.');
    variables.push({key:'APP_ORIGIN',value:url.origin,type:'plain',visibility:'config',target:['production']});
  }
  return variables;
}

export function vercelAPI(token,teamId='',fetcher=fetch) {
  return async (path,{method='GET',body,query={}}={})=>{
    const url=new URL(path,'https://api.vercel.com');
    if(url.origin!=='https://api.vercel.com')throw new Error('Destino no permitido para credenciales.');
    if(teamId)url.searchParams.set('teamId',teamId);
    for(const [key,value] of Object.entries(query))url.searchParams.set(key,value);
    const response=await fetcher(url,{method,redirect:'error',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(30000)});
    const data=await response.json().catch(()=>({}));
    if(!response.ok || data.failed?.length)throw new Error(`Vercel no completó la operación (HTTP ${response.status}). Revisa permisos del token, equipo y proyecto. No se muestran valores secretos.`);
    return data;
  };
}

export async function syncEnvironment(api,projectId,env) {
  const payload=environmentPayload(env);
  await api('/v10/projects/'+encodeURIComponent(projectId)+'/env',{method:'POST',query:{upsert:'true'},body:payload});
  return payload.map(({key})=>key);
}
