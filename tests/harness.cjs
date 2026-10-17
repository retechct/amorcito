const fs = require("node:fs/promises");
const path = require("node:path");
const { spawn } = require("node:child_process");
const net = require("node:net");
const root = path.resolve(__dirname, "..");
exports.root = root;
exports.entry = "230499";
exports.admin = "test-only-admin-long-secret";
exports.fixture = async function(full = false) {
  await fs.mkdir(path.join(root, ".qa"), {recursive:true});
  const dir = await fs.mkdtemp(path.join(root, ".qa", "secure-test-"));
  const media = path.join(dir, "media");
  await fs.mkdir(media);
  const {hashPassword} = await import("../server/security.mjs");
  await fs.writeFile(path.join(dir,"credentials.json"),JSON.stringify({entry:await hashPassword(exports.entry),admin:await hashPassword(exports.admin)}));
  let catalog;
  if(full){
    catalog = JSON.parse(await fs.readFile(path.join(root,".private","import-catalog.json"),"utf8"));
    const files = new Set(catalog.memories.flatMap(m => [path.basename(m.src),path.basename(m.thumb)]));
    await Promise.all([...files].map(f=>fs.copyFile(path.join(root,"private-media",f),path.join(media,f))));
  } else {
    const sharp = require("sharp");
    const name = "a".repeat(24);
    await sharp({create:{width:320,height:240,channels:3,background:"#681c32"}}).jpeg().toFile(path.join(media,name+".jpg"));
    await fs.copyFile(path.join(media,name+".jpg"),path.join(media,name+"-thumb.jpg"));
    catalog = {memories:[{id:"test-photo",title:"Prueba",album:"Nuestro álbum",date:"2026-03-01",month:"2026-03",src:"/media/"+name+".jpg",thumb:"/media/"+name+"-thumb.jpg",kind:"photo",updated:0}]};
  }
  await fs.writeFile(path.join(dir,"import-catalog.json"),JSON.stringify(catalog));
  const port = await new Promise(resolve=>{const s=net.createServer();s.listen(0,"127.0.0.1",()=>{const p=s.address().port;s.close(()=>resolve(p));});});
  const base = "http://127.0.0.1:"+port;
  let child;
  const start = async()=>{
    child = spawn(process.execPath,["server.mjs"],{cwd:root,windowsHide:true,env:{...process.env,NODE_ENV:"test",DATA_DIR:dir,MEDIA_DIR:media,PORT:String(port),HOST:"127.0.0.1",APP_ORIGIN:base,TRUSTED_PROXY_IP:""},stdio:["ignore","pipe","pipe"]});
    await new Promise((resolve,reject)=>{let log="";const timeout=setTimeout(()=>reject(new Error("Server startup timed out: "+log)),10000);child.stdout.on("data",data=>{log+=data;if(log.includes("Nosotros listo")){clearTimeout(timeout);resolve();}});child.stderr.on("data",data=>log+=data);child.on("exit",code=>{clearTimeout(timeout);reject(new Error("Server exited "+code+": "+log));});});
  };
  const stop=async()=>{if(child && child.exitCode===null)await new Promise(resolve=>{child.once("exit",resolve);child.kill();});};
  await start();
  return {base,dir,media,catalog,start,stop};
};
