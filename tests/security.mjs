import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fixture, entry, admin } from "./harness.cjs";
const env=await fixture();
let cookie="",csrf="";
async function request(url,method="GET",data,extra={}){
 const response=await fetch(env.base+url,{method,headers:{Origin:env.base,...(cookie?{Cookie:cookie}:{}),...(csrf?{"X-CSRF-Token":csrf}:{}),...(data!==undefined?{"Content-Type":"application/json"}:{}),...extra},...(data!==undefined?{body:JSON.stringify(data)}:{})});
 const body=response.headers.get("content-type")?.includes("application/json")?await response.json():await response.text();
 return {response,status:response.status,body};
}
async function login(route,password){
 const result=await request(route,"POST",{password});assert.equal(result.status,200);
 const set=result.response.headers.get("set-cookie");
 assert.match(set,/HttpOnly/);assert.match(set,/SameSite=Strict/);
 cookie=set.split(";")[0];csrf=result.body.csrf;return result;
}
try{
 assert.equal((await request("/api/archive")).status,401);
 assert.equal((await request(env.catalog.memories[0].src)).status,401);
 for(const file of ["/.private/credentials.json","/private-media/"+env.catalog.memories[0].src.split("/").pop(),"/server.mjs","/Photos-1-001.zip","/amorcito%201.jpg","/scripts/setup.mjs"]){
  assert.equal((await request(file)).status,404,file);
 }
 const publicJS=(await request("/script.js")).body;
 assert.ok(!publicJS.includes("SECRET_HASH")&&!publicJS.includes("140226")&&!publicJS.includes("2026-02-14"));
 assert.equal((await request("/api/login","POST",{password:entry},{Origin:"https://evil.test"})).status,403);
 await login("/api/login",entry);
 assert.equal((await request(env.catalog.memories[0].src)).status,200);
 let archive=(await request("/api/archive")).body;
 assert.equal(archive.memories.length,1);
 assert.equal((await request("/api/archive","PUT",archive)).status,403);
 assert.equal((await request("/api/favorite","POST",{id:"test-photo",favorite:true},{"X-CSRF-Token":""})).status,403);
 assert.equal((await request("/api/favorite","POST",{id:"test-photo",favorite:true})).status,200);
 const viewerCookie=cookie;
 await login("/api/admin/login",admin);
 assert.equal((await request("/api/archive","GET",undefined,{Cookie:viewerCookie})).status,401);
 archive=(await request("/api/archive")).body;
 archive.memories[0].hidden=true;archive.memories[0].month="2026-05";
 const saved=await request("/api/archive","PUT",archive);assert.equal(saved.status,200);
 assert.equal((await request("/api/archive","PUT",archive)).status,409);
 assert.equal((await request("/api/archive","PUT",{...saved.body,memories:[{...saved.body.memories[0],src:"file:///etc/passwd"}]})).status,400);
 const adminCookie=cookie;
 cookie="";csrf="";await login("/api/login",entry);
 assert.equal((await request("/api/archive")).body.memories.length,0);
 assert.equal((await request(env.catalog.memories[0].src)).status,404);
 assert.equal((await request("/api/logout","POST",{})).status,200);
 assert.equal((await request("/api/archive")).status,401);
 cookie=adminCookie;csrf=(await request("/api/session")).body.csrf;
 const changed=await request("/api/admin/password","POST",{current:admin,next:"another-test-only-long-secret"});
 assert.equal(changed.status,200);assert.equal((await request("/api/archive")).status,401);
 cookie="";csrf="";
 const attacks=await Promise.all(Array.from({length:12},(_,i)=>request("/api/login","POST",{password:"000000"},{"X-Forwarded-For":"203.0.113."+i})));
 assert.ok(attacks.filter(r=>r.status===401).length<=4);
 assert.ok(attacks.filter(r=>r.status===429).length>=8);
 assert.ok((await request("/api/session")).body.retryAfter>0);
 assert.equal((await request("/api/login","POST",{password:entry})).status,429);
 await env.stop();await env.start();
 assert.ok((await request("/api/session")).body.retryAfter>0,"Cooldown must survive restart");
 assert.equal((await request("/api/login","POST",{password:entry})).status,429);
 const credentials=await readFile(env.dir+"/credentials.json","utf8");
 assert.ok(!credentials.includes(entry)&&!credentials.includes(admin));
 console.log("PASS: protected media/API, allowlist, HttpOnly sessions, CSRF, role separation, hidden memories, optimistic writes, password rotation, concurrent brute force, spoofed IP and persistent cooldown.");
}finally{await env.stop();}
