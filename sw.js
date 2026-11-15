// Lift Log offline shell, scoped to the directory where the worker is registered.
const BASE=new URL(self.registration.scope);
const PREFIX='liftlog-'+encodeURIComponent(BASE.pathname)+'-';
const CACHE=PREFIX+'v8';
const INDEX=new URL('index.html',BASE).href;
const MANIFEST=new URL('manifest.json',BASE).href;
const ASSETS=new Set([MANIFEST,...['icon-180.png','icon-192.png','icon-512.png'].map(name=>new URL(name,BASE).href)]);
function validResponse(url,response){
  if(!response.ok)return false;
  const type=response.headers.get('content-type')||'';
  return url===INDEX?type.includes('text/html'):url===MANIFEST?type.includes('json'):type.startsWith('image/');
}
async function fetchTimed(request,options={}){
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),5000);
  try{return await fetch(request,{...options,signal:controller.signal});}
  finally{clearTimeout(timer);}
}
self.addEventListener('install',event=>{
  event.waitUntil((async()=>{
    const c=await caches.open(CACHE),shell=await fetchTimed(INDEX,{cache:'reload'});
    if(!validResponse(INDEX,shell))throw new Error('Offline shell is unavailable');
    await c.put(INDEX,shell);
    await Promise.allSettled([...ASSETS].map(async url=>{
      const r=await fetchTimed(url,{cache:'reload'});
      if(validResponse(url,r))await c.put(url,r);
    }));
  })());
});
self.addEventListener('activate',event=>{
  event.waitUntil((async()=>{
    const keys=await caches.keys();
    await Promise.all(keys.filter(k=>k.startsWith(PREFIX)&&k!==CACHE).map(k=>caches.delete(k)));
    await self.clients.claim();
  })());
});
self.addEventListener('message',event=>{
  if(event.data==='SKIP_WAITING')event.waitUntil(self.skipWaiting());
});
self.addEventListener('fetch',event=>{
  const req=event.request,url=new URL(req.url);
  if(req.method!=='GET'||url.origin!==BASE.origin||!url.pathname.startsWith(BASE.pathname))return;
  const nav=req.mode==='navigate',asset=ASSETS.has(url.href);
  if(!nav&&!asset)return;
  const result=(async()=>{
    let response;
    try{
      response=await fetchTimed(req);
      const key=nav&&(url.pathname===BASE.pathname||url.pathname===new URL(INDEX).pathname)?INDEX:asset?url.href:null;
      if(key&&validResponse(key,response)){
        const copy=response.clone();
        return {response,write:caches.open(CACHE).then(c=>c.put(key,copy)).catch(()=>{})};
      }
      if(response.status<500)return {response};
    }catch(_){}
    const c=await caches.open(CACHE).catch(()=>null),key=nav?INDEX:url.href;
    const hit=c&&await c.match(key).catch(()=>null);
    return {response:(hit&&validResponse(key,hit)?hit:response)||Response.error()};
  })();
  event.respondWith(result.then(x=>x.response));
  event.waitUntil(result.then(x=>x.write).catch(()=>{}));
});
