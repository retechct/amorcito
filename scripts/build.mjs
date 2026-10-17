import { mkdir, copyFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
const output=resolve('dist');
const files=['index.html','style.css','script.js','favicon.svg'];
await mkdir(output,{recursive:true});
// Refuse a polluted output directory rather than publishing private leftovers.
for(const file of await readdir(output))if(!files.includes(file))throw new Error('dist contiene archivos inesperados; revísala antes de publicar.');
for(const file of files)await copyFile(resolve(file),resolve(output,file));
console.log('Build listo: solo HTML, CSS, JavaScript y favicon. Sin fotos ni secretos.');
