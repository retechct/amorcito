import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { hashPassword } from '../server/security.mjs';
const directory=resolve(process.env.DATA_DIR || '.private');
await mkdir(directory,{recursive:true});
try { await readFile(resolve(directory,'credentials.json')); console.log('Las claves ya están configuradas. No se han cambiado.'); process.exit(0); } catch(error) { if(error.code!=='ENOENT')throw error; }
console.log('Introduce un JSON con la clave de entrada por stdin. No se mostrará la clave.');
if(process.stdin.isTTY)process.stdin.setRawMode(true);
let raw='';
for await (const part of process.stdin) {
  if(part.includes(3)){if(process.stdin.isTTY)process.stdin.setRawMode(false);process.exit(130);}
  raw+=part.toString();
  if(raw.includes('\n') || raw.includes('\r'))break;
  if(raw.length>2000)throw new Error('Entrada demasiado larga.');
}
if(process.stdin.isTTY)process.stdin.setRawMode(false);
const input=JSON.parse(raw.trim());
if(!/^\d{6}$/.test(input.entry))throw new Error('La entrada debe tener seis dígitos.');
const admin=input.admin || randomBytes(18).toString('base64url');
if(admin.length<14)throw new Error('La clave de administración necesita al menos 14 caracteres.');
await writeFile(resolve(directory,'credentials.json'),JSON.stringify({entry:await hashPassword(input.entry),admin:await hashPassword(admin)},null,2),{mode:0o600,flag:'wx'});
if(!input.admin)await writeFile(resolve(directory,'admin-access.txt'),'Acceso de administración de Nosotros\n\nContraseña: '+admin+'\n\nAbre la web, entra al rincón y pulsa Cuidar lo nuestro.\nEsta clave es distinta del candado. Guárdala en tu gestor de contraseñas.\n',{mode:0o600,flag:'wx'});
console.log('Configuración guardada. La clave de administración está en .private/admin-access.txt si se generó automáticamente.');
process.exit(0);
