import { connectStore } from '../server/cloud-store.mjs';
import { createMedia } from '../server/cloud-media.mjs';
import { createHandler } from '../server/cloud-handler.mjs';

let handler;
export default async function route(req,res) {
  if(!handler) {
    try { handler=createHandler({store:connectStore(),media:createMedia()}); }
    catch {
      res.writeHead(503,{'Content-Type':'application/json','Cache-Control':'no-store'});
      res.end(JSON.stringify({error:'Faltan las variables privadas del servidor. Ejecuta npm run vercel:setup y vuelve a desplegar.'}));
      return;
    }
  }
  return handler(req,res);
}
