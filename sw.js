/* Vistorias em Campo · service worker (modo sem sinal)
   Este arquivo quase nunca muda. A versão do app fica no index.html; o próprio app avisa quando há versão nova.
   - App (index.html, manifesto, ícones): responde do cache na hora e atualiza o cache por trás quando há sinal.
   - Mapas (tiles Esri do app e OpenStreetMap do relatório): guarda cada tile visto; sem sinal, serve do cache.
   - Servidor da equipe (Supabase) e tudo o mais: passa direto, sem cache. */
const SHELL='vc-app-v1', TILES='vc-tiles-v1', MAX_TILES=2500;
const SHELL_FILES=['./','./index.html','./manifest.json','./icon-192.png','./icon-512.png'];
const ehTile=u=>/tile\.openstreetmap\.org|server\.arcgisonline\.com\/ArcGIS\/rest\/services\/World_Street_Map/.test(u);

self.addEventListener('install',e=>{
  e.waitUntil((async()=>{
    const c=await caches.open(SHELL);
    await Promise.all(SHELL_FILES.map(async u=>{ try{ const r=await fetch(u,{cache:'no-cache'}); if(r.ok)await c.put(u,r); }catch(err){} }));
    await self.skipWaiting();
  })());
});
self.addEventListener('activate',e=>{
  e.waitUntil((async()=>{
    const ks=await caches.keys();
    await Promise.all(ks.filter(k=>k.startsWith('vc-')&&k!==SHELL&&k!==TILES).map(k=>caches.delete(k)));
    await self.clients.claim();
  })());
});
self.addEventListener('message',e=>{
  const d=e.data||{};
  if(d.t==='skipWaiting')self.skipWaiting();
  if(d.t==='limparTiles')caches.delete(TILES);
});

let putsDesdeTrim=0;
async function guardarTile(c,req,res){
  try{ await c.put(req,res); }catch(err){ return; }
  if(++putsDesdeTrim<100)return; putsDesdeTrim=0;
  try{ const ks=await c.keys(); if(ks.length>MAX_TILES){ const sobra=ks.length-MAX_TILES+200; for(let i=0;i<sobra;i++)await c.delete(ks[i]); } }catch(err){}
}

self.addEventListener('fetch',e=>{
  const req=e.request; if(req.method!=='GET')return;
  const url=req.url;
  if(ehTile(url)){
    e.respondWith((async()=>{
      const c=await caches.open(TILES);
      const hit=await c.match(req,{ignoreVary:true}); if(hit)return hit;
      try{ const r=await fetch(req); if(r&&r.ok)guardarTile(c,req,r.clone()); return r; } // só respostas legíveis (CORS): as opacas inflam a cota do navegador
      catch(err){ return new Response('',{status:504,statusText:'sem sinal'}); }
    })());
    return;
  }
  const u=new URL(url);
  if(u.origin!==self.location.origin)return; // Supabase e outros: direto
  if(u.searchParams.has('nocache'))return; // conferência de versão nova feita pelo app: sempre da rede
  const navegacao=req.mode==='navigate';
  const doApp=navegacao||SHELL_FILES.some(f=>f!=='./'&&u.pathname.endsWith(f.slice(1)));
  if(!doApp)return;
  e.respondWith((async()=>{
    const c=await caches.open(SHELL);
    const chave=navegacao?'./index.html':req;
    const hit=await c.match(chave,{ignoreSearch:true});
    const rede=fetch(req).then(r=>{ if(r&&r.ok)c.put(chave,r.clone()).catch(()=>{}); return r; }).catch(()=>null);
    if(hit){ e.waitUntil(rede); return hit; } // cache na hora; rede atualiza por trás
    const r=await rede; if(r)return r;
    return new Response('<!DOCTYPE html><meta charset="utf-8"><p style="font:16px system-ui;padding:20px">Sem sinal e o app ainda não foi guardado neste aparelho. Abra com internet uma vez.</p>',{headers:{'Content-Type':'text/html; charset=utf-8'}});
  })());
});
