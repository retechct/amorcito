const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const path=require('node:path');
const sharp=require('sharp');
const {fixture,entry,root}=require('./harness.cjs');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
(async()=>{
 const env=await fixture(false),browser=await chromium.launch({headless:true});
 try{
  const memories=Array.from({length:6},(_,i)=>({id:'memory-'+i,title:'Recuerdo '+i,album:'La historia',date:'2026-02-14',month:'2026-02',src:'/media/'+String(i+1).padStart(24,'a')+'.jpg',thumb:'/media/'+String(i+1).padStart(24,'a')+'-thumb.jpg',kind:'photo'}));
  const pictures=await Promise.all(['#802237','#be9152','#526d62','#e4c9b2','#494367','#8c6356'].map(color=>sharp({create:{width:960,height:1280,channels:3,background:color}}).jpeg().toBuffer()));
  async function setup(saveData){
   const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,reducedMotion:'reduce'}),counts=new Map();
   await context.addInitScript(save=>{Object.defineProperty(navigator,'connection',{value:{saveData:save,effectiveType:'4g'},configurable:true});Math.random=()=>0.8;},saveData);
   const page=await context.newPage();page.setDefaultTimeout(12000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
   await page.route('**/api/archive',async route=>{
    const response=await route.fetch();
    if(response.status()!==200)return route.fulfill({response});
    const data=await response.json();return route.fulfill({response,json:{...data,memories}});
   });
   await page.route('**/media/**',async route=>{
    const url=new URL(route.request().url()),isThumb=url.pathname.includes('-thumb'),index=memories.findIndex(m=>(isThumb?m.thumb:m.src)===url.pathname);
    if(index<0)return route.continue();
    const key=url.pathname;counts.set(key,(counts.get(key)||0)+1);
    if(saveData && index===3 && !isThumb && counts.get(key)===1)return route.fulfill({status:503,body:'Intentional failure'});
    await sleep(isThumb?35:(saveData && index===4?1800:150));
    await route.fulfill({status:200,headers:{'Content-Type':'image/jpeg','Cache-Control':'private, no-store'},body:pictures[index]});
   });
   await page.goto(env.base);assert.equal(counts.size,0,'no media requests before gate');
   for(const [id,value] of [['day',entry.slice(0,2)],['month',entry.slice(2,4)],['year',entry.slice(4)]])await page.locator('#lock-'+id).fill(value);
   await page.locator('#unlock-button').click();await page.locator('#app').waitFor({state:'visible'});
   return {context,page,counts,errors};
  }
  const slow=await setup(true),page=slow.page;
  await page.locator('#random-memory').click();
  await page.waitForFunction(()=>document.querySelector('#viewer-photo').dataset.quality==='preview');
  assert.equal(await page.locator('#viewer-photo').getAttribute('data-memory-id'),'memory-4');
  const previous=await page.locator('#viewer-photo').getAttribute('src');
  await page.locator('#next-memory').click();
  assert.equal(await page.locator('#viewer-photo').getAttribute('data-memory-id'),'memory-5');
  assert.notEqual(await page.locator('#viewer-photo').getAttribute('src'),previous,'never retain previous photo under the new counter');
  await page.waitForFunction(()=>document.querySelector('#viewer-photo').dataset.quality==='full');
  const selected=await page.locator('#viewer-photo').getAttribute('src');
  await page.waitForTimeout(1900);
  assert.equal(await page.locator('#viewer-photo').getAttribute('src'),selected,'late response for memory 4 cannot replace memory 5');
  await page.screenshot({path:path.join(root,'.qa/viewer-fast-mobile.png')});
  // Fast keyboard changes, then a controlled failure with explicit retry.
  for(let i=0;i<4;i++)await page.keyboard.press('ArrowLeft');
  assert.equal(await page.locator('#viewer-photo').getAttribute('data-memory-id'),'memory-1');
  await page.keyboard.press('ArrowRight');await page.keyboard.press('ArrowRight');
  await page.locator('#viewer-retry').waitFor({state:'visible'});
  assert.equal(await page.locator('#viewer-photo').getAttribute('data-memory-id'),'memory-3');
  await page.locator('#viewer-retry').click();await page.waitForFunction(()=>document.querySelector('#viewer-photo').dataset.quality==='full');
  assert.equal(slow.counts.get(memories[3].src),2);
  await page.keyboard.press('Escape');await page.locator('#random-memory').click();
  assert.notEqual(await page.locator('#viewer-photo').getAttribute('data-memory-id'),'memory-3','Sorpresa avoids the previously selected memory');
  await page.keyboard.press('Escape');await page.locator('#lock-again').click();await page.locator('#secret-gate').waitFor({state:'visible'});
  assert.equal(await page.locator('img[src^="blob:"]').count(),0,'logout removes private photo URLs');
  assert.deepEqual(slow.errors,[]);await slow.context.close();

  const fast=await setup(false),p=fast.page;
  await p.locator('.polaroid').first().click();
  await p.waitForFunction(()=>document.querySelector('#viewer-photo').dataset.quality==='full');
  await p.waitForTimeout(900); // bounded neighbour prefetch (fixture network delay 150 ms)
  const before=fast.counts.get(memories[1].src);
  assert.equal(before,1,'next image is already prefetched');
  const start=Date.now();await p.locator('#next-memory').click();
  await p.waitForFunction(()=>document.querySelector('#viewer-photo').dataset.quality==='full');
  const elapsed=Date.now()-start;
  assert.equal(fast.counts.get(memories[1].src),before,'prefetched image is reused without another request');
  await p.locator('#prev-memory').click();await p.waitForFunction(()=>document.querySelector('#viewer-photo').dataset.quality==='full');
  assert.equal(fast.counts.get(memories[0].src),1,'going back reuses tab memory');
  await p.setViewportSize({width:320,height:740});
  assert(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  assert.deepEqual(fast.errors,[]);await fast.context.close();
  console.log('PASS: slower/reordered network, correct preview, no stale image, fast navigation, retry, private logout, neighbour reuse and 320 px layout. Cached navigation in test: '+elapsed+' ms.');
 }finally{await browser.close();await env.dispose();}
})().catch(error=>{console.error(error);process.exitCode=1;});
