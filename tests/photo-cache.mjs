import assert from 'node:assert/strict';
import { createPhotoCache } from '../photo-cache.mjs';
import { createPhotoVariants, variantSize } from '../server/photo-variants.mjs';
import sharp from 'sharp';

const path=n=>'/media/'+String(n).padStart(24,'a')+'.jpg';
let requests=0,created=0;
const revoked=[];
const cache=createPhotoCache({fetcher:async()=>{requests++;return new Response(new Blob(['image'],{type:'image/jpeg'}));},createURL:()=> 'blob:test-'+(++created),revokeURL:url=>revoked.push(url),maxEntries:2});
const [first,duplicate]=await Promise.all([cache.load(path(1)),cache.load(path(1))]);
assert.equal(first,duplicate);assert.equal(requests,1);
await cache.load(path(2));assert.equal(cache.peek(path(1)),first);
await cache.load(path(3));assert.equal(cache.peek(path(2)),null);assert.equal(revoked.length,1);
await cache.load(path(1));assert.equal(requests,3);
cache.clear();assert.equal(revoked.length,3);assert.equal(cache.peek(path(1)),null);
await assert.rejects(cache.load('https://untrusted.example/a.jpg'),/Ruta/);

let failed=0;
const recovering=createPhotoCache({fetcher:async()=>{if(!failed++)return new Response('',{status:503});return new Response(new Blob(['ok'],{type:'image/jpeg'}));},createURL:()=> 'blob:recovered',revokeURL:()=>{}});
await assert.rejects(recovering.load(path(1)),{status:503});assert.equal(await recovering.load(path(1)),'blob:recovered');recovering.clear();

const pending=[],starts=[];
const scheduled=createPhotoCache({concurrency:4,fetcher:async key=>{starts.push(key);return new Promise(resolve=>pending.push(resolve));},createURL:()=> 'blob:queued-'+(++created),revokeURL:()=>{}});
const background=[1,2,3,4].map(n=>scheduled.load(path(n),0).catch(error=>error.name));
await new Promise(resolve=>setTimeout(resolve,0));assert.equal(starts.length,2,'prefetch leaves slots for current photo');
const foreground=scheduled.load(path(5),120).catch(error=>error.name);
await new Promise(resolve=>setTimeout(resolve,0));assert.equal(starts.length,3);assert.equal(starts[2],path(5));
scheduled.clear();
for(const finish of pending)finish(new Response(new Blob(['late'],{type:'image/jpeg'})));
assert.deepEqual(await Promise.all([...background,foreground]),Array(5).fill('AbortError'));
await new Promise(resolve=>setTimeout(resolve,0));assert.equal(scheduled.peek(path(5)),null,'late response cannot repopulate cache after logout');

const original=await sharp({create:{width:1800,height:1200,channels:3,background:'#6e233b'}}).jpeg().toBuffer();
let downloads=0,time=1000;
const variants=createPhotoVariants({now:()=>time,ttl:5000});
const load=async()=>{downloads++;return original;};
const [mobile,other]=await Promise.all([variants('photo',960,load),variants('photo',960,load)]);
assert.equal(downloads,1);assert.strictEqual(mobile,other);
const info=await sharp(mobile).metadata();assert.equal(info.format,'webp');assert.equal(info.width,960);assert.equal(info.height,640);
await variants('photo',960,load);assert.equal(downloads,1);time+=6000;await variants('photo',960,load);assert.equal(downloads,2);
assert.equal(variantSize('100000'),0);assert.equal(variantSize('960'),960);
console.log('PASS: deduplicación, prioridad del visor, caché LRU, reintentos, limpieza al salir, WebP móvil y caducidad privada.');
