import { v2 as cloudinary } from 'cloudinary';
import { createHash } from 'node:crypto';

export const mediaPattern = /^\/media\/([a-f0-9]{24,64}(?:-thumb)?\.(?:jpg|webp|png|mp4))$/;
export const folder = 'nosotros-private';
export function configureMedia(url = process.env.CLOUDINARY_URL) {
  if (!url) throw new Error('CLOUDINARY_URL no está configurada.');
  const parsed = new URL(url);
  if (parsed.protocol !== 'cloudinary:' || !parsed.username || !parsed.password || !parsed.hostname) throw new Error('CLOUDINARY_URL no válida.');
  cloudinary.config({cloud_name:parsed.hostname,api_key:decodeURIComponent(parsed.username),api_secret:decodeURIComponent(parsed.password),secure:true});
  return cloudinary;
}

export function createMedia(url) {
  const client = configureMedia(url);
  return {
    async ping() { await client.api.ping(); },
    sign(id, resourceType) {
      const params = {timestamp:Math.floor(Date.now()/1000), public_id:folder+'/'+id, type:'authenticated', overwrite:false,
        allowed_formats:resourceType==='video'?'mp4':'jpg,png,webp',
        ...(resourceType==='image'?{transformation:'a_auto,c_limit,h_1800,w_1800/fl_strip_profile'}:{})};
      return {url:'https://api.cloudinary.com/v1_1/'+client.config().cloud_name+'/'+resourceType+'/upload',
        fields:{...params,api_key:client.config().api_key,signature:client.utils.api_sign_request(params,client.config().api_secret)}};
    },
    async inspect(id, resourceType) {
      const result = await client.api.resource(folder+'/'+id,{resource_type:resourceType,type:'authenticated'});
      if (result.type!=='authenticated' || result.public_id!==folder+'/'+id || result.resource_type!==resourceType ||
          !['jpg','png','webp','mp4'].includes(result.format) || result.bytes>20*1024*1024 || !result.bytes) {
        throw new Error('Archivo subido no válido o superior a 20 MB.');
      }
      return {public_id:result.public_id,resource_type:result.resource_type,format:result.format,bytes:result.bytes};
    },
    download(asset) {
      return client.utils.private_download_url(asset.public_id,asset.format,{type:'authenticated',resource_type:asset.resource_type,attachment:false,expires_at:Math.floor(Date.now()/1000)+60});
    },
    async importFile(path, localPath) {
      if (!mediaPattern.test(path)) throw new Error('Ruta de medio no válida.');
      // Stable IDs make an interrupted migration resumable without duplicates.
      const id=createHash('sha256').update(path).digest('hex');
      const resourceType=path.endsWith('.mp4')?'video':'image';
      const result=await client.uploader.upload(localPath,{public_id:folder+'/import-'+id,resource_type:resourceType,type:'authenticated',overwrite:false});
      if (result.type!=='authenticated') throw new Error('La carga no quedó privada.');
      return {path,public_id:result.public_id,resource_type:resourceType,format:result.format,bytes:result.bytes};
    },
  };
}
