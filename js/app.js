
import { db as localDb, store } from './store.js';
import { drive } from './sync.js';
import { ai, makeSample, DEFAULT_MODEL } from './ai.js';
import * as IN from './inbox.js';
import { norm, parseBom, matchPart } from './bom.js';
// ------------------------------------------------------------------ state
const S = {
  db: null, user: null, sample: null, assets: null, downloads: null,
  canWrite: true, uid: null,
  bins: new Map(), parts: new Map(), projects: new Map(),
  q: '', route: parseHash(), loaded: false, imgOk: false,
};
const ICONS = {
  bins: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 7h18v13H3z"/><path d="M3 7l2-4h14l2 4"/><path d="M9 12h6"/></svg>',
  parts: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="4" width="16" height="16" rx="2"/><path d="M9 4v16M15 4v16M4 9h16M4 15h16"/></svg>',
  bom: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 6h11M9 12h11M9 18h11"/><path d="M4 6l1 1 2-2M4 12l1 1 2-2M4 18l1 1 2-2"/></svg>',
  scan: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 8V5a1 1 0 011-1h3M16 4h3a1 1 0 011 1v3M20 16v3a1 1 0 01-1 1h-3M8 20H5a1 1 0 01-1-1v-3"/><circle cx="12" cy="12" r="3.5"/></svg>',
  search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>',
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M12 5v14M5 12h14"/></svg>',
  back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 6l-6 6 6 6"/></svg>',
  nfc: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 8.5a8 8 0 010 7M9.5 6.5a12 12 0 010 11M13 4.5a16 16 0 010 15"/><circle cx="3" cy="12" r="1" fill="currentColor"/></svg>',
  box: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M3 7l9-4 9 4v10l-9 4-9-4z"/><path d="M3 7l9 4 9-4M12 11v10"/></svg>',
  gear: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
  settings: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/></svg>',
  camera: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>',
  inbox: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 13l2.5-8h11L20 13v6H4z"/><path d="M4 13h5a3 3 0 006 0h5"/></svg>',
};
const NAV = [['bins','Bins'],['parts','Parts'],['bom','BOM check'],['scan','Pack'],['settings','Settings']];

// ------------------------------------------------------------------ utils
function parseHash(){ const h=location.hash.replace(/^#\/?/,''); const [view,...rest]=h.split('/'); return {view:view||'bins', arg:rest.join('/')||''}; }
function go(view,arg){ location.hash = arg ? `#${view}/${arg}` : `#${view}`; }
function esc(s){ return String(s ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function id(){ return Math.random().toString(36).slice(2,10)+Date.now().toString(36).slice(-4); }
function toast(msg,ms=1800){ const t=document.getElementById('toast'), say=document.getElementById('say'); t.textContent=say.textContent=msg; t.hidden=false; clearTimeout(t._t); t._t=setTimeout(()=>{ t.hidden=true; say.textContent=''; },ms); }
function h(html){ const t=document.createElement('template'); t.innerHTML=html.trim(); return t.content.firstElementChild; }
function fmtQty(p){ return (p.qty ?? 0) + (p.unit && p.unit!=='pcs' ? ' '+p.unit : ''); }
function binOf(p){ return p.binId ? S.bins.get(p.binId) : null; }
function partsInBin(binId){ return [...S.parts.values()].filter(p=>p.binId===binId).sort((a,b)=>a.name.localeCompare(b.name)); }
function binCodeSort(a,b){ return a.code.localeCompare(b.code, undefined, {numeric:true}); }
function assetUrl(idv){ return idv ? '/_blob/'+idv : ''; }
function isBox(b){ return !!b && b.kind==='box'; }
function nextBag(){ let m=0; for(const p of S.parts.values()) if(Number(p.bag)>m) m=Number(p.bag); return m+1; }
function bagStr(n){ return n ? '#'+String(n).padStart(3,'0') : ''; }
const APP_URL = location.protocol==='file:' ? 'https://parts-bin.junkdrawer.works/' : location.origin+location.pathname;
const NFC_OK = ('NDEFReader' in window);
const FRAMED = (()=>{ try{ return window.self!==window.top; }catch{ return true; } })();
function partUrl(p){ return APP_URL+(p.bag?'#bag/'+String(p.bag).padStart(3,'0'):'#part/'+p.id); }
function binUrl(b){ return APP_URL+'#bin/'+b.id; }
function isLow(p){ return p.minQty != null && p.minQty !== '' && Number(p.qty||0) <= Number(p.minQty); }
function localGet(k,d){ try{ const v=localStorage.getItem(k); return v==null?d:JSON.parse(v);}catch{ return d; } }
function localSet(k,v){ try{ localStorage.setItem(k,JSON.stringify(v)); }catch{} }

// ------------------------------------------------------------------ search
function searchParts(q){
  const bm=String(q||'').trim().match(/^#?0*(\d{1,4})$/); if(bm){ const hit=[...S.parts.values()].filter(p=>Number(p.bag)===Number(bm[1])); if(hit.length) return hit; }
  const t=norm(q).split(' ').filter(Boolean); if(!t.length) return [...S.parts.values()];
  return [...S.parts.values()].map(p=>{
    const hay = norm([p.name,p.mpn,p.category,(p.tags||[]).join(' '),p.notes,(p.iface||[]).join(' '),p.addr,p.volts,p.logic,binOf(p)?.code,binOf(p)?.name, p.bag?('bag '+p.bag+' '+String(p.bag).padStart(3,'0')):''].join(' '));
    let score=0; for(const w of t){ if(!hay.includes(w)) return null; score += norm(p.name).includes(w)?2:1; if(norm(p.name).startsWith(w)) score+=2; }
    return {p,score};
  }).filter(Boolean).sort((a,b)=>b.score-a.score||a.p.name.localeCompare(b.p.name)).map(x=>x.p);
}
function searchBins(q){
  const t=norm(q); if(!t) return [...S.bins.values()].sort(binCodeSort);
  return [...S.bins.values()].filter(b=>norm([b.code,b.name,b.location,b.notes].join(' ')).includes(t)).sort(binCodeSort);
}

// ------------------------------------------------------------------ render
// The screen last drawn: drawing the same one again (after a save, a sync or a change in another tab) keeps the place
// on the page, and a new screen starts at the top.
let shown='';
function render(){
  S.route = parseHash();
  renderNav();
  const key=S.route.view+'/'+S.route.arg, y=key===shown?window.scrollY:0;
  const m=document.getElementById('main'); m.innerHTML='';
  if(!S.loaded){ m.append(h('<div class="empty"><p>Loading inventory…</p></div>')); return; }
  const v=S.route.view;
  if(linkCode()){ m.append(h('<div class="empty"><p class="think" style="justify-content:center">Opening the batch…</p></div>')); return; }
  shown=key;
  if(v==='inbox') renderInbox(m);
  else if(v==='bag'){ const n=Number(S.route.arg); const hit=[...S.parts.values()].find(p=>Number(p.bag)===n); if(hit) renderPartPage(m, hit.id); else m.append(h(`<div class="empty"><h3>No bag ${esc(bagStr(n))}</h3><p>Nothing in the inventory has that bag number yet.</p></div>`)); }
  else if(v==='settings') renderSettings(m);
  else if(v==='bin') renderBin(m, S.route.arg);
  else if(v==='part') renderPartPage(m, S.route.arg);
  else if(v==='parts') renderParts(m);
  else if(v==='bom') renderBom(m);
  else if(v==='scan') renderScan(m);
  else renderBins(m);
  window.scrollTo(0,y);
}
function renderNav(){
  const cur = {bin:'bins',part:'parts',inbox:'scan'}[S.route.view] || S.route.view;
  const waiting = inboxCount();
  const mk = (cls)=>NAV.map(([k,l])=>`<button type="button" data-go="${k}" ${cur===k?'aria-current="page"':''}>${ICONS[k]}<span>${l}</span>${k==='scan'&&waiting?`<span class="badge" aria-label="${waiting} waiting in the inbox">${waiting}</span>`:''}</button>`).join('');
  document.getElementById('nav').innerHTML = mk(); document.getElementById('tabbar').innerHTML = mk();
  document.querySelectorAll('[data-go]').forEach(b=>b.onclick=()=>go(b.dataset.go));
  const n=S.parts.size, b=S.bins.size, low=[...S.parts.values()].filter(isLow).length;
  document.getElementById('sidefoot').innerHTML = `${b} bins · ${n} parts${low?` · <span style="color:var(--warn)">${low} low</span>`:''}<br>${S.canWrite?'':'read-only view'}`;
}
function topbar(m, title, extra=''){
  const el=h(`<div class="topbar"><h2>${esc(title)}</h2><div class="search">${ICONS.search}<input id="q" type="search" aria-label="Search" placeholder="Search parts, bins, bag numbers…" value="${esc(S.q)}" autocomplete="off"></div>${NFC_OK&&!FRAMED?`<button class="btn icon${reading?' on':''}" id="readtag" aria-label="Tap a tag to open it" title="Tap a tag to open it">${ICONS.nfc}</button>`:''}${extra}</div>`);
  m.append(el);
  el.querySelector('#readtag')?.addEventListener('click', readTag);
  const q=el.querySelector('#q'); let t; q.oninput=()=>{ clearTimeout(t); t=setTimeout(()=>{ S.q=q.value; render(); const nq=document.getElementById('q'); if(nq){ nq.focus(); nq.setSelectionRange(nq.value.length,nq.value.length);} },160); };
  return el;
}

// ---- Bins
function renderBins(m){
  const tb=topbar(m,'Bins', S.canWrite?`<button class="btn primary" id="addbin">${ICONS.plus} Bin</button>`:'');
  tb.querySelector('#addbin')?.addEventListener('click',()=>editBin(null));
  if(S.q){ renderSearchResults(m); return; }
  const bins=searchBins('');
  if(!bins.length){ m.append(h(`<div class="empty"><h3>No bins yet</h3><p>A bin is any container with a label: a Gridfinity bin, a drawer, a shelf box. Add one, then put parts in it. Coming from the Stockroom artifact? Load its export file, or turn on Google Drive in Settings if another device already has your inventory.</p><div class="row" style="justify-content:center"><button class="btn primary" id="first">Add the first bin</button><button class="btn" id="imp">Load an export file</button></div></div>`)); m.querySelector('#first').addEventListener('click',()=>editBin(null)); m.querySelector('#imp').addEventListener('click',importJson); return; }
  // moving boxes first, then bins grouped by location
  const boxes=bins.filter(isBox);
  if(boxes.length){
    const packed=[...S.parts.values()].filter(p=>isBox(binOf(p))).length;
    m.append(h(`<div class="section-h"><h3>Moving boxes</h3><span class="tiny">${boxes.length} box${boxes.length===1?'':'es'} · ${packed} bag${packed===1?'':'s'} packed</span></div>`));
    const g=h('<div class="bins"></div>');
    for(const b of boxes){ const ps=partsInBin(b.id);
      const c=h(`<button type="button" class="bin"><div class="photo">${b.photo?`<img src="${assetUrl(b.photo)}" alt="">`:ICONS.box}</div><div class="body"><div><span class="label box">${esc(b.code)}</span></div><div class="name">${esc(b.name||'')}</div><div class="meta"><span>${ps.length} bag${ps.length===1?'':'s'}</span>${b.sealed?'<span>sealed</span>':''}</div></div></button>`);
      c.onclick=()=>go('bin',b.id); g.append(c); }
    m.append(g);
  }
  const groups = new Map(); for(const b of bins.filter(x=>!isBox(x))){ const k=b.location||'Unsorted'; if(!groups.has(k)) groups.set(k,[]); groups.get(k).push(b); }
  for(const [loc,list] of [...groups.entries()].sort((a,b)=>a[0].localeCompare(b[0]))){
    m.append(h(`<div class="section-h"><h3>${esc(loc)}</h3><span class="tiny">${list.length} bin${list.length===1?'':'s'}</span></div>`));
    const g=h('<div class="bins"></div>');
    for(const b of list){
      const ps=partsInBin(b.id); const low=ps.filter(isLow).length;
      const c=h(`<button type="button" class="bin"><div class="photo">${b.photo?`<img src="${assetUrl(b.photo)}" alt="">`:ICONS.box}</div><div class="body"><div><span class="label">${esc(b.code)}</span></div><div class="name">${esc(b.name||'')}</div><div class="meta"><span>${ps.length} part${ps.length===1?'':'s'}</span>${low?`<span style="color:var(--warn)">${low} low</span>`:''}</div></div></button>`);
      c.onclick=()=>go('bin',b.id); g.append(c);
    }
    m.append(g);
  }
}
function renderSearchResults(m){
  const bins=searchBins(S.q), parts=searchParts(S.q);
  if(bins.length){ m.append(h(`<div class="section-h"><h3>Bins</h3><span class="tiny">${bins.length}</span></div>`)); const l=h('<div class="list"></div>'); for(const b of bins) l.append(binRow(b)); m.append(l); }
  m.append(h(`<div class="section-h"><h3>Parts</h3><span class="tiny">${parts.length}</span></div>`));
  if(!parts.length) m.append(h('<div class="empty"><p>No parts match.</p></div>'));
  else { const l=h('<div class="list"></div>'); for(const p of parts) l.append(partRow(p,true)); m.append(l); }
}
function binRow(b){
  const ps=partsInBin(b.id);
  const r=h(`<button type="button" class="item"><div><div class="t"><span class="label">${esc(b.code)}</span> &nbsp;${esc(b.name||'')}</div><div class="s">${esc(b.location||'')}</div></div><div class="q">${ps.length}<small>parts</small></div></button>`);
  r.onclick=()=>go('bin',b.id); return r;
}
function partRow(p, showBin){
  const b=binOf(p);
  const r=h(`<button type="button" class="item ${isLow(p)?'low':''}"><div><div class="t">${esc(p.name)}</div><div class="s">${p.bag?`<span class="bagno">${bagStr(p.bag)}</span>`:''}${showBin&&b?`<span class="label ${isBox(b)?'box':''}">${esc(b.code)}</span>`:''}${p.category?`<span>${esc(p.category)}</span>`:''}${p.mpn?`<span class="mono">${esc(p.mpn)}</span>`:''}${(p.tags||[]).slice(0,3).map(t=>`<span class="chip">${esc(t)}</span>`).join('')}${p.check?'<span class="chip warn">check</span>':''}</div></div><div class="q">${esc(fmtQty(p))}${isLow(p)?'<small>low</small>':''}</div></button>`);
  r.onclick=()=>go('part',p.id); return r;
}

// ---- Bin page
let unpackTo=''; // the bin picked under a box's Unpack into, for this visit
function renderBin(m, binId){
  const b=S.bins.get(binId);
  if(!b){ m.append(h(`<div class="empty"><h3>Bin not found</h3><p>This tag or link points at a bin that no longer exists.</p><button class="btn" id="bk">All bins</button></div>`)); m.querySelector('#bk').onclick=()=>go('bins'); return; }
  const ps=partsInBin(binId);
  const head=h(`<div class="row pagehead" style="margin-bottom:10px"><button class="btn icon" id="back" aria-label="Back to bins">${ICONS.back}</button><span class="grow"></span>
    <button class="btn sm" id="print">Print list</button><button class="btn sm" id="copy">Copy list</button>
    ${S.canWrite?`<button class="btn sm" id="tag">${ICONS.nfc} Tag</button><button class="btn sm" id="edit">Edit</button>${isBox(b)?`<button class="btn primary sm" id="pack">${ICONS.scan} Pack into this box</button>`:`<button class="btn primary sm" id="add">${ICONS.plus} Part</button>`}`:''}</div>`);
  m.append(head);
  head.querySelector('#back').onclick=()=>go('bins');
  head.querySelector('#tag')?.addEventListener('click',()=>tagSheet(b));
  head.querySelector('#edit')?.addEventListener('click',()=>editBin(b));
  head.querySelector('#add')?.addEventListener('click',()=>editPart({binId}));
  head.querySelector('#pack')?.addEventListener('click',()=>{ localSet('sr.packbox',b.id); go('scan'); });
  head.querySelector('#print').onclick=()=>printList(b,ps);
  head.querySelector('#copy').onclick=()=>{ const txt=ps.map(p=>`${p.bag?bagStr(p.bag)+' ':''}${p.name}${p.qty!=null?' ×'+p.qty:''}`).join('\n'); navigator.clipboard?.writeText(txt).then(()=>toast('List copied — paste into Manifest')); };
  m.append(h(`<div class="binhead"><div class="photo">${b.photo?`<img src="${assetUrl(b.photo)}" alt="">`:ICONS.box}</div><div><span class="label lg ${isBox(b)?'box':''}">${esc(b.code)}</span><h2>${esc(b.name||'')}</h2><div class="muted">${esc(b.location||'')}${b.notes?` · ${esc(b.notes)}`:''}</div><div class="tiny" style="margin-top:6px">${ps.length} ${isBox(b)?'bag':'part'}${ps.length===1?'':'s'}${b.tagWritten?' · NFC tag written':''}${b.sealed?' · sealed':''}</div></div></div>`));
  if(!ps.length){ m.append(h(`<div class="empty"><p>${isBox(b)?'Nothing packed in this box yet.':'Nothing in this bin yet.'}</p></div>`)); return; }
  if(isBox(b)&&S.canWrite){
    // unpack helper: move bags out of the box into a bin. The bin picked stays picked while the page redraws after each move.
    const bins=[...S.bins.values()].filter(x=>!isBox(x)).sort(binCodeSort);
    const bar=h(`<div class="row" style="margin-bottom:10px"><label class="muted" for="unpack-to">Unpack into</label><select id="unpack-to" style="width:auto"><option value="">choose a bin…</option>${bins.map(x=>`<option value="${x.id}" ${x.id===unpackTo?'selected':''}>${esc(x.code)} · ${esc(x.name||'')}</option>`).join('')}</select><span class="tiny">then tap a bag's ⇢</span></div>`);
    bar.querySelector('#unpack-to').onchange=e=>{ unpackTo=e.target.value; };
    m.append(bar);
    const l=h('<div class="list"></div>');
    for(const p of ps){ const row=h('<div class="unpack"></div>'), mv=h(`<button type="button" class="btn sm" aria-label="Move ${esc(bagStr(p.bag)||p.name)} to the chosen bin">⇢</button>`); mv.onclick=async()=>{ const to=bar.querySelector('#unpack-to').value; if(!to){ toast('Choose a bin first'); return; } await writePart({...p, binId:to, box:''}); toast(`${bagStr(p.bag)||p.name} → ${S.bins.get(to)?.code}`); }; row.append(partRow(p,false), mv); l.append(row); } // the ⇢ beside the row's button, not inside it
    m.append(l); return;
  }
  const l=h('<div class="list"></div>'); for(const p of ps) l.append(partRow(p,false)); m.append(l);
}
function printList(b, ps){
  const root=document.getElementById('print-root');
  root.innerHTML=`<h1>${esc(b.code)} — ${esc(b.name||'')}</h1><div class="sub">${esc(b.location||'')} · ${ps.length} item${ps.length===1?'':'s'} · Stockroom, ${new Date().toLocaleDateString()}</div>
    <table><thead><tr><th>Bag</th><th>Item</th><th>Qty</th><th>From</th><th>Notes</th></tr></thead><tbody>${ps.slice().sort((a,c)=>(a.bag||9999)-(c.bag||9999)).map(p=>`<tr><td class="n">${esc(bagStr(p.bag))}</td><td>${esc(p.name)}${p.mpn?` <small>${esc(p.mpn)}</small>`:''}</td><td class="n">${esc(fmtQty(p))}</td><td>${esc(p.from||'')}</td><td>${esc((p.notes||'').split(' · ')[0])}</td></tr>`).join('')}</tbody></table>`;
  window.print();
}

// ---- Parts
function renderParts(m){
  const cats=[...new Set([...S.parts.values()].map(p=>p.category).filter(Boolean))].sort();
  const cur=localGet('sr.cat','');
  const tb=topbar(m,'Parts', `<select id="cat" aria-label="Category" style="width:auto"><option value="">All categories</option>${cats.map(c=>`<option ${c===cur?'selected':''}>${esc(c)}</option>`).join('')}<option value="__low" ${cur==='__low'?'selected':''}>Low stock</option><option value="__unbagged" ${cur==='__unbagged'?'selected':''}>Not yet bagged</option><option value="__bagged" ${cur==='__bagged'?'selected':''}>Bagged</option><option value="__check" ${cur==='__check'?'selected':''}>To check</option></select>${S.canWrite?`<button class="btn primary" id="addp">${ICONS.plus} Part</button>`:''}`);
  tb.querySelector('#cat').onchange=e=>{ localSet('sr.cat',e.target.value); render(); };
  tb.querySelector('#addp')?.addEventListener('click',()=>editPart({}));
  let parts=searchParts(S.q);
  if(cur==='__low') parts=parts.filter(isLow); else if(cur==='__unbagged') parts=parts.filter(p=>!p.bag); else if(cur==='__bagged') parts=parts.filter(p=>p.bag); else if(cur==='__check') parts=parts.filter(p=>p.check); else if(cur) parts=parts.filter(p=>p.category===cur);
  if(cur==='__bagged') parts.sort((a,b)=>Number(a.bag)-Number(b.bag));
  else if(!S.q) parts.sort((a,b)=>a.name.localeCompare(b.name));
  if(!parts.length){ m.append(h('<div class="empty"><p>No parts here yet. Add one, or use Scan in to photograph a part and let it be identified.</p></div>')); return; }
  const l=h('<div class="list"></div>'); for(const p of parts) l.append(partRow(p,true)); m.append(l);
}
function renderPartPage(m, pid){
  const p=S.parts.get(pid); if(!p){ m.append(h('<div class="empty"><p>Part not found.</p></div>')); return; }
  const b=binOf(p);
  const head=h(`<div class="row pagehead" style="margin-bottom:10px"><button class="btn icon" id="back" aria-label="Back">${ICONS.back}</button><span class="grow"></span>${S.canWrite?`<button class="btn sm" id="edit">Edit</button>`:''}</div>`);
  m.append(head); head.querySelector('#back').onclick=()=>history.length>1?history.back():go('parts');
  head.querySelector('#edit')?.addEventListener('click',()=>editPart(p));
  if(S.canWrite){ const tg=h(`<button class="btn sm">${ICONS.nfc} Bag tag</button>`); tg.onclick=()=>tagSheet(p,'part'); head.querySelector('#edit').before(tg); }
  const ref=!p.photo&&p.img;
  m.append(h(`<div class="binhead"><div class="photo${ref?' refphoto':''}"${ref?' role="button" tabindex="0" aria-label="Reference photo, tap to enlarge"':''}>${p.photo?`<img src="${assetUrl(p.photo)}" alt="">`:ICONS.parts+refImg(p)}</div><div>
    <h2>${esc(p.name)}</h2>
    <div class="row" style="gap:6px;margin:4px 0 8px">${p.category?`<span class="chip">${esc(p.category)}</span>`:''}${specChips(p)}${(p.tags||[]).map(t=>`<span class="chip">${esc(t)}</span>`).join('')}${isLow(p)?'<span class="chip warn">low stock</span>':''}</div>
    <div class="muted">${p.bag?`<span class="bagno">${bagStr(p.bag)}</span> `:''}${b?`In <a href="#bin/${b.id}"><span class="label ${isBox(b)?'box':''}">${esc(b.code)}</span></a> ${esc(b.name||'')}${b.location?` · ${esc(b.location)}`:''}`:'Not in a bin'}${p.from?` <span class="tiny">· was in ${esc(p.from)}</span>`:''}</div>
    ${p.mpn?`<div class="tiny mono" style="margin-top:4px">${esc(p.mpn)}</div>`:''}
    ${/^https?:\/\//i.test(p.link||'')?`<div class="tiny" style="margin-top:4px"><a href="${esc(p.link)}" target="_blank" rel="noopener">Product link</a></div>`:''}
  </div></div>`));
  if(S.canWrite){
    const q=h(`<div class="row" style="margin:6px 0 14px"><label class="muted" for="qv">Quantity</label><div class="qty"><button class="btn icon" id="dec" aria-label="Use one">−</button><input id="qv" type="number" min="0" step="any" value="${esc(p.qty??0)}"><button class="btn icon" id="inc" aria-label="Add one">+</button></div><span class="tiny">${esc(p.unit||'pcs')}${p.minQty!=null&&p.minQty!==''?` · reorder at ${esc(p.minQty)}`:''}</span></div>`);
    m.append(q);
    const inp=q.querySelector('#qv'); const save=async(v)=>{ v=Math.max(0,Number(v)); if(!isFinite(v)) return; inp.value=v; if(v!==Number(p.qty||0)) await writePart({...p, qty:v}); }; // a count stops at zero
    q.querySelector('#dec').onclick=()=>save(Number(inp.value)-1); q.querySelector('#inc').onclick=()=>save(Number(inp.value)+1);
    inp.onchange=()=>save(inp.value);
  } else m.append(h(`<div class="muted" style="margin-bottom:12px">Quantity: ${esc(fmtQty(p))}</div>`));
  if(p.check){
    const c=h(`<div class="checknote"><div><b>Check before trusting it.</b> ${esc(p.check)}</div>${S.canWrite?'<button class="btn sm" id="checked">Checked, it’s right</button>':''}</div>`);
    c.querySelector('#checked')?.addEventListener('click',async()=>{ try{ await S.db.doc('parts/'+p.id).update({check:''}); toast('Marked as checked'); }catch(e){ writeFail(e); } });
    m.append(c);
  }
  if(p.notes) m.append(h(`<div class="note">${esc(p.notes)}</div>`));
  if(S.canWrite && lacksDetails(p)){ const ask=h(`<div class="row" style="margin-top:14px"><button class="btn sm" id="ask">Ask Claude for details</button><span class="tiny">Interface, voltages, a part number, a reference photo</span></div>`); ask.querySelector('#ask').onclick=()=>sendToClaude([p]); m.append(ask); }
  const rp=m.querySelector('.refphoto'); if(rp){ rp.onclick=()=>zoomRef(p); rp.onkeydown=e=>{ if(e.key==='Enter'||e.key===' '){ e.preventDefault(); zoomRef(p); } }; }
  wireRefs(m);
}

// ---- BOM check (reading the list and matching it: bom.js)
function renderBom(m){
  m.append(h('<div class="topbar"><h2>BOM check</h2></div>'));
  const saved=[...S.projects.values()].sort((a,b)=>(b.updatedAt||'').localeCompare(a.updatedAt||''));
  const last=localGet('sr.bom','');
  const ui=h(`<div>
    <div class="row" style="margin-bottom:8px"><select id="proj" aria-label="Saved BOMs" style="width:auto"><option value="">Saved BOMs…</option>${saved.map(p=>`<option value="${p.id}">${esc(p.name)}</option>`).join('')}</select><span class="grow"></span></div>
    <div class="field"><label for="bom">Parts list — one per line, quantity first or last (<code>2x XIAO ESP32-S3</code>, <code>SCD41 ×1</code>)</label><textarea id="bom" placeholder="2x XIAO ESP32-S3&#10;1 SCD41 breakout&#10;3 WS2812 strip segment&#10;M3 heat-set inserts x8">${esc(last)}</textarea></div>
    <div class="row"><button class="btn primary" id="check">Check against inventory</button>${S.sample?'<button class="btn" id="smart">Smarter matching</button>':''}<span class="grow"></span>${S.canWrite?'<button class="btn" id="save">Save as project</button>':''}</div>
    <div id="out" style="margin-top:14px"></div></div>`);
  m.append(ui);
  const ta=ui.querySelector('#bom'), out=ui.querySelector('#out');
  ta.oninput=()=>localSet('sr.bom',ta.value); // kept as it's typed, so another screen, a reload or a redraw doesn't lose it
  ui.querySelector('#proj').onchange=e=>{ const p=S.projects.get(e.target.value); if(p){ ta.value=p.text; localSet('sr.bom',p.text); run(); } };
  function run(rows){
    localSet('sr.bom',ta.value);
    const items=rows||parseBom(ta.value).map(r=>({...r, m:matchPart(r.name,S.parts.values())}));
    if(!items.length){ out.innerHTML='<div class="empty"><p>Paste a parts list first.</p></div>'; return; }
    let have=0, short=0, missing=0;
    const trs=items.map(r=>{
      let st, cls, where='';
      if(!r.m){ st='missing'; cls='bad'; missing++; }
      else { const b=binOf(r.m.p); where=b?`<span class="label">${esc(b.code)}</span> ${esc(b.name||'')}`:'<span class="tiny">no bin</span>';
        if(Number(r.m.p.qty||0)>=r.qty){ st='have'; cls='ok'; have++; } else { st=`short ${r.qty-Number(r.m.p.qty||0)}`; cls='warn'; short++; } }
      return `<tr><td class="n">${r.qty}</td><td>${esc(r.name)}${r.m?`<div class="tiny">→ ${esc(r.m.p.name)}${r.m.conf<0.8?' <span class="chip">fuzzy</span>':''}</div>`:''}</td><td class="n">${r.m?esc(fmtQty(r.m.p)):'—'}</td><td>${where}</td><td><span class="chip ${cls}">${st}</span></td></tr>`;
    }).join('');
    out.innerHTML=`<div class="bom-summary"><span class="chip ok">${have} have</span><span class="chip warn">${short} short</span><span class="chip bad">${missing} missing</span></div><div class="tablewrap"><table class="bom-table"><thead><tr><th>Need</th><th>Item</th><th>Stock</th><th>Where</th><th>Status</th></tr></thead><tbody>${trs}</tbody></table></div>
      ${missing+short?`<div class="row" style="margin-top:10px"><button class="btn sm" id="copy">Copy shopping list</button></div>`:''}`;
    out.querySelector('#copy')?.addEventListener('click',()=>{ const txt=items.filter(r=>!r.m||Number(r.m.p.qty||0)<r.qty).map(r=>`${r.m?r.qty-Number(r.m.p.qty||0):r.qty} × ${r.name}`).join('\n'); navigator.clipboard?.writeText(txt).then(()=>toast('Shopping list copied')); });
  }
  ui.querySelector('#check').onclick=()=>run();
  ui.querySelector('#smart')?.addEventListener('click', async()=>{
    const rows=parseBom(ta.value); if(!rows.length) return run();
    out.innerHTML='<div class="think">Matching against your inventory…</div>';
    const inv=[...S.parts.values()].map(p=>({id:p.id,name:p.name,mpn:p.mpn||'',tags:p.tags||[],category:p.category||''}));
    try{
      const res=await S.sample.json(`You match a maker's bill of materials against their parts inventory. Electronics/hardware knowledge applies: "XIAO S3" matches "Seeed XIAO ESP32-S3"; "M3x8 SHCS" matches "M3 x 8mm socket head cap screw"; a generic name matches a specific compatible part. Do NOT match different parts that merely share a word (a BME280 is not a BMP390; a 1.8" TFT is not a 2.0" TFT).
INVENTORY (JSON): ${JSON.stringify(inv)}
BOM lines (JSON): ${JSON.stringify(rows)}
Reply with only a JSON array, same order and length as the BOM lines: [{"id": "<inventory id or null>", "confidence": 0-1}]`, {modelTier:'quick'});
      const items=rows.map((r,i)=>{ const hit=Array.isArray(res)&&res[i]&&res[i].id&&S.parts.get(res[i].id); return {...r, m: hit?{p:hit, conf:Number(res[i].confidence||0.7)}:matchPart(r.name,S.parts.values())}; });
      run(items);
    }catch(e){ if(e.code==='not_granted') toast(e.message+' Used plain matching.',4000); else toast('Smart matching unavailable, used plain matching'); run(); }
  });
  ui.querySelector('#save')?.addEventListener('click', async()=>{
    const name=prompt('Project name for this BOM:', ''); if(!name) return;
    const pid=id(); await S.db.doc('projects/'+pid).set({name, text:ta.value, updatedAt:new Date().toISOString()}); toast('Saved');
  });
  if(last) run();
}

// ---- Pack (scan-in with a sticky destination container)
function renderScan(m){
  const tb=h(`<div class="topbar"><h2>Pack</h2>${S.canWrite?`<button class="btn" id="toinbox">${ICONS.inbox} Inbox${inboxCount()?` <span class="count">${inboxCount()}</span>`:''}</button>`:''}</div>`);
  m.append(tb); tb.querySelector('#toinbox')?.addEventListener('click',()=>go('inbox'));
  if(!S.canWrite){ m.append(h('<div class="empty"><p>This view is read-only.</p></div>')); return; }
  const conts=[...S.bins.values()].sort((x,y)=>(isBox(y)-isBox(x))||binCodeSort(x,y));
  let dest=localGet('sr.packbox',''); if(!S.bins.has(dest)) dest='';
  const nb=nextBag();
  const head=h(`<div class="packhead">
    <div><label class="lbl" for="dest">Packing into</label><div class="row" style="margin-top:4px"><select id="dest" style="flex:1 1 170px;min-width:0;width:auto"><option value="">— pick a box or bin —</option>${conts.map(c=>`<option value="${c.id}" ${c.id===dest?'selected':''}>${esc(c.code)} · ${esc(c.name||'')}</option>`).join('')}</select><button class="btn sm" id="newbox">${ICONS.plus} Box</button></div></div>
    <div style="text-align:right"><div class="lbl">Next bag</div><div class="big">${bagStr(nb)}</div></div></div>`);
  m.append(head);
  head.querySelector('#dest').onchange=e=>{ localSet('sr.packbox',e.target.value); };
  head.querySelector('#newbox').onclick=()=>{ localSet('sr.newkind','box'); editBin(null); };
  const ui=h(`<div>
    <div class="note" style="margin-bottom:12px">Bag it and ${S.imgOk?'photograph it, or ':''}type what it is. Pick the matching part (or a new one), check the count, save, then hold the bag's sticker to the top of the phone. ${S.imgOk?'':'To skip the typing, send Claude a photo of the bags and open the link it replies with: they land in the Inbox, filled in.'}</div>
    ${S.imgOk?`<div class="drop" id="drop">${ICONS.camera}<div class="row" style="justify-content:center;margin-top:8px"><label class="btn primary" for="file">Take photo<input id="file" type="file" accept="image/*" capture="environment" class="sr"></label><label class="btn" for="file2">Choose photo<input id="file2" type="file" accept="image/*" class="sr"></label></div><div class="tiny" style="margin-top:6px">Bag contents, label, or silkscreen</div></div>`:''}
    <div class="field" style="margin-top:12px"><label for="desc">${S.imgOk?'Or type it':'What is it?'}</label><input id="desc" placeholder="e.g. BME280, or 'soldering iron'" autocomplete="off"></div>
    <div class="row">${S.sample?'<button class="btn" id="identify">Identify</button>':''}<span id="status" class="tiny"></span></div>
    <div id="result" style="margin-top:14px"></div></div>`);
  m.append(ui);
  let file=null; const st=ui.querySelector('#status'), res=ui.querySelector('#result');
  const drop=ui.querySelector('#drop'); const fi=ui.querySelector('#file');
  if(drop){
    fi.onchange=()=>{ file=fi.files[0]||null; showPreview(); if(file) identify(); };
    const fi2=ui.querySelector('#file2'); fi2.onchange=()=>{ file=fi2.files[0]||null; showPreview(); if(file) identify(); };
    drop.ondragover=e=>{e.preventDefault();drop.classList.add('over');}; drop.ondragleave=()=>drop.classList.remove('over');
    drop.ondrop=e=>{e.preventDefault();drop.classList.remove('over'); file=e.dataTransfer.files[0]||null; showPreview();};
  }
  function showPreview(){ res.innerHTML=''; if(!file) return; const img=new Image(); img.className='preview'; img.src=URL.createObjectURL(file); res.append(img); }
  function reset(){ file=null; if(fi) fi.value=''; ui.querySelector('#desc').value=''; res.innerHTML=''; st.textContent=''; }
  function openEditor(seed, matched){
    const destId=head.querySelector('#dest').value;
    const base = matched ? {...matched} : {name:seed.name||'', category:seed.category||'', mpn:seed.mpn||'', unit:seed.unit||'pcs', tags:Array.isArray(seed.tags)?seed.tags.map(String):[], notes:seed.notes||''};
    if(matched){ base.qty = Number(seed.qty)||matched.qty||1; if(seed.notes && !(matched.notes||'').includes(seed.notes)) base.notes=[matched.notes,seed.notes].filter(Boolean).join(' · '); }
    else base.qty=Number(seed.qty)||1;
    base.bag = nextBag(); if(destId) base.binId=destId;
    editPart(base, {photoFile:null, stay:true, tag:true, afterSave:()=>{ reset(); render(); }});
  }
  async function identify(){
    const desc=ui.querySelector('#desc').value.trim(); if(!file&&!desc){ toast('Add a photo or a description'); return; }
    st.innerHTML='<span class="think">Identifying…</span>';
    const inv=[...S.parts.values()].map(p=>({id:p.id,name:p.name,cat:p.category||'',qty:p.qty??0}));
    const cats=[...new Set(inv.map(p=>p.cat).filter(Boolean))];
    const prompt=`You are helping pack a maker's workroom into bags. Identify the item for an inventory entry, and say whether it is ALREADY in the inventory list below (same physical part, e.g. a photo of three BME280 breakouts matches "BME280 (Adafruit)"). ${file?'The image shows the bagged item, its label, packaging, or silkscreen. ':''}${desc?`Description from the user: "${desc}". `:''}
INVENTORY (JSON, id + name + category + current qty): ${JSON.stringify(inv)}
Categories in use (reuse one if it fits, else a short new one; tools go in "Tools", spools in "Filament", partial builds in "Projects"): ${JSON.stringify(cats)}.
Reply with only a JSON object: {"matchId": "<inventory id if this is the same part, else null>", "matchConfidence": 0-1, "name": "<short specific name, brand + part>", "category": "<category>", "mpn": "<manufacturer part number or ''>", "qty": <count visible/stated, else 1>, "unit": "pcs", "tags": ["<up to 4 lowercase tags>"], "notes": "<one line: key specs or what it's for>"}`;
    try{
      const j=await S.sample.json(prompt, file?{images:file}:{});
      const matched = j.matchId && S.parts.get(j.matchId) ? S.parts.get(j.matchId) : null;
      st.textContent = matched ? `Looks like: ${matched.name}` : (j.name ? `New: ${j.name}` : '');
      // candidates list: model's match first, then local text matches on the name
      const local=searchParts(j.name||desc).slice(0,4).filter(p=>!matched||p.id!==matched.id);
      const box=h(`<div><div class="matchlist">${matched?`<button type="button" class="pick" data-id="${matched.id}"><span><b>${esc(matched.name)}</b><div class="s">${esc(matched.category||'')} · in stock ${esc(fmtQty(matched))}${binOf(matched)?' · '+esc(binOf(matched).code):''}</div></span><span class="chip ok">match ${Math.round((j.matchConfidence||0.8)*100)}%</span></button>`:''}
        ${local.map(p=>`<button type="button" data-id="${p.id}"><span><b>${esc(p.name)}</b><div class="s">${esc(p.category||'')} · in stock ${esc(fmtQty(p))}${binOf(p)?' · '+esc(binOf(p).code):''}</div></span><span class="chip">existing</span></button>`).join('')}
        <button type="button" data-id=""><span><b>${esc(j.name||desc||'New item')}</b><div class="s">${esc(j.category||'')}${j.mpn?' · '+esc(j.mpn):''} · qty ${esc(j.qty??1)}</div></span><span class="chip warn">new entry</span></button></div>
        <div class="tiny">Pick the row that is what's in the bag. Existing rows keep their record and get this bag number; the count you enter next replaces the old count.</div></div>`);
      res.querySelector('.matchlist')?.parentElement?.remove(); res.append(box);
      box.querySelectorAll('[data-id]').forEach(btn=>btn.onclick=()=>openEditor(j, btn.dataset.id?S.parts.get(btn.dataset.id):null));
    }catch(e){ st.textContent = e.code==='not_granted' ? e.message : e.code==='rate_limited' ? 'Too many requests — wait a moment.' : 'Could not identify — fill it in by hand.'; if(e.code==='not_granted') toast(e.message,4000); openEditor({name:desc}, null); }
  }
  ui.querySelector('#identify')?.addEventListener('click', identify);
  // type-ahead over the inventory, no AI needed
  const desc=ui.querySelector('#desc'); let tt;
  desc.oninput=()=>{ clearTimeout(tt); tt=setTimeout(()=>localList(desc.value.trim()),120); };
  desc.onkeydown=e=>{ if(e.key==='Enter'){ e.preventDefault(); const first=res.querySelector('[data-id]'); first?.click(); } };
  function localList(q){
    res.querySelector('.matchlist')?.parentElement?.remove();
    if(!q) return;
    const hits=searchParts(q).slice(0,6);
    const box=h(`<div><div class="matchlist">${hits.map(p=>`<button type="button" data-id="${p.id}"><span><b>${esc(p.name)}</b><div class="s">${p.bag?esc(bagStr(p.bag))+' · ':''}${esc(p.category||'')} · in stock ${esc(fmtQty(p))}${binOf(p)?' · '+esc(binOf(p).code):''}</div></span><span class="chip">existing</span></button>`).join('')}
      <button type="button" data-id=""><span><b>${esc(q)}</b><div class="s">Not in the inventory yet</div></span><span class="chip warn">new part</span></button></div></div>`);
    res.append(box);
    box.querySelectorAll('[data-id]').forEach(btn=>btn.onclick=()=>openEditor({name:q}, btn.dataset.id?S.parts.get(btn.dataset.id):null));
  }
}

// ------------------------------------------------------------------ sheets
function picked(el,pid){ return el.querySelector('#'+pid+'-cam')?.files?.[0] || el.querySelector('#'+pid+'-pick')?.files?.[0] || null; }
function wirePhoto(el){ for(const pid of ['f','p']) for(const k of ['cam','pick']){ const inp=el.querySelector('#'+pid+'-'+k); if(!inp) continue; inp.onchange=()=>{ const f=inp.files[0]; const other=el.querySelector('#'+pid+'-'+(k==='cam'?'pick':'cam')); if(other) other.value=''; const pv=el.querySelector('#'+pid+'-prev'); if(f&&pv){ pv.src=URL.createObjectURL(f); pv.hidden=false; } }; } }
// While a sheet is open the page behind it is inert, so the keyboard stays in the sheet. Closing it hands the keyboard back
// to whatever opened it.
const BEHIND='.app,.mobile-cloud,#tabbar,.jd-foot';
function sheet(html){
  const root=document.getElementById('sheet-root'); root.innerHTML='';
  const opener=document.activeElement;
  const bg=h(`<div class="sheet-bg"><div class="sheet" role="dialog" aria-modal="true">${html}</div></div>`);
  bg.addEventListener('click',e=>{ if(e.target===bg) close(); });
  const onKey=e=>{ if(e.key==='Escape') close(); };
  document.addEventListener('keydown',onKey);
  function close(){ root.innerHTML=''; document.removeEventListener('keydown',onKey); document.querySelectorAll(BEHIND).forEach(e=>e.inert=false); if(opener!==document.body && opener?.isConnected) opener.focus({preventScroll:true}); }
  const title=bg.querySelector('.sheet h3'); if(title){ title.id='sheet-title'; bg.firstElementChild.setAttribute('aria-labelledby','sheet-title'); }
  root.append(bg); document.querySelectorAll(BEHIND).forEach(e=>e.inert=true); wirePhoto(bg); const f=bg.querySelector('input:not([type=file]),textarea,select'); f&&f.focus();
  return {el:bg.querySelector('.sheet'), close};
}
function editBin(b){
  const isNew=!b; const wantBox = b===null && localGet('sr.newkind','bin')==='box';
  b=b||{id:id(), kind:wantBox?'box':'bin', code:wantBox?nextBoxCode():nextBinCode(), name:'', location:wantBox?'Moving boxes':localGet('sr.lastloc',''), notes:''};
  const locs=[...new Set([...S.bins.values()].map(x=>x.location).filter(Boolean))].sort();
  const {el,close}=sheet(`<h3>${isNew?'New bin':'Edit bin'}</h3>
    <div class="grid2"><div class="field"><label for="f-code">Label code</label><input id="f-code" class="mono" value="${esc(b.code)}" placeholder="B07"></div>
    <div class="field"><label for="f-loc">Location</label><input id="f-loc" list="locs" value="${esc(b.location||'')}" placeholder="Rack A, shelf 2"><datalist id="locs">${locs.map(l=>`<option value="${esc(l)}">`).join('')}</datalist></div></div>
    <div class="grid2"><div class="field"><label for="f-kind">Type</label><select id="f-kind"><option value="bin" ${b.kind!=='box'?'selected':''}>Bin (permanent storage)</option><option value="box" ${b.kind==='box'?'selected':''}>Moving box</option></select></div>
    <div class="field"><label for="f-sealed">Sealed</label><select id="f-sealed"><option value="" ${!b.sealed?'selected':''}>No</option><option value="1" ${b.sealed?'selected':''}>Yes — taped shut</option></select></div></div>
    <div class="field"><label for="f-name">What's in it</label><input id="f-name" value="${esc(b.name||'')}" placeholder="${b.kind==='box'?'Workroom — sensors & boards':'Sensors — I2C breakouts'}"></div>
    <div class="field"><label for="f-notes">Notes</label><input id="f-notes" value="${esc(b.notes||'')}"></div>
    ${S.assets?`<div class="field"><label>Photo</label><div class="row"><label class="btn sm" for="f-cam">${ICONS.camera} Take photo<input id="f-cam" type="file" accept="image/*" capture="environment" class="sr"></label><label class="btn sm" for="f-pick">Choose photo<input id="f-pick" type="file" accept="image/*" class="sr"></label><img id="f-prev" alt="" style="height:40px;border-radius:4px" hidden></div></div>`:''}
    <div class="actions">${!isNew?'<button class="btn danger left" id="del">Delete bin</button>':''}<button class="btn" id="cancel">Cancel</button><button class="btn primary" id="save">Save</button></div>`);
  el.querySelector('#cancel').onclick=close;
  el.querySelector('#del')?.addEventListener('click', async()=>{ const n=partsInBin(b.id).length; if(!confirm(n?`Delete this bin? Its ${n} part(s) will be left without a bin.`:'Delete this bin?')) return; await S.db.doc('bins/'+b.id).delete(); for(const p of partsInBin(b.id)) await S.db.doc('parts/'+p.id).update({binId:''}); close(); go('bins'); });
  el.querySelector('#save').onclick=async()=>{
    const code=el.querySelector('#f-code').value.trim(); if(!code){ toast('Label code is required'); return; }
    const dup=[...S.bins.values()].find(x=>x.code.toLowerCase()===code.toLowerCase()&&x.id!==b.id); if(dup){ toast(`Code ${code} already used`); return; }
    const doc={code, kind:el.querySelector('#f-kind').value, sealed:!!el.querySelector('#f-sealed').value, name:el.querySelector('#f-name').value.trim(), location:el.querySelector('#f-loc').value.trim(), notes:el.querySelector('#f-notes').value.trim(), photo:b.photo||'', tagWritten:!!b.tagWritten, updatedAt:new Date().toISOString()};
    const pf=picked(el,'f'); if(pf && S.assets){ try{ const up=await S.assets.upload(await shrink(pf),{type:'image/jpeg'}); doc.photo=up.id; }catch(e){ toast('Photo not saved: '+(e&&e.code||e&&e.message||'upload failed'),4000); } }
    localSet('sr.lastloc',doc.location); localSet('sr.newkind',doc.kind);
    try{ await S.db.doc('bins/'+b.id).set(doc); close(); toast(isNew?'Bin added':'Saved'); if(isNew) go('bin',b.id); }catch(e){ writeFail(e); }
  };
}
function nextBoxCode(){ const nums=[...S.bins.values()].filter(isBox).map(b=>Number((b.code.match(/(\d+)/)||[])[1])).filter(n=>!isNaN(n)); return 'BOX '+String((nums.length?Math.max(...nums):0)+1).padStart(2,'0'); }
function nextBinCode(){
  const nums=[...S.bins.values()].map(b=>b.code.match(/^([A-Za-z]*)(\d+)$/)).filter(Boolean);
  if(!nums.length) return 'B01';
  const pre=nums[nums.length-1][1]||'B'; const max=Math.max(...nums.map(m=>Number(m[2]))); const w=Math.max(2, nums[0][2].length);
  return pre+String(max+1).padStart(w,'0');
}
function editPart(p, opts={}){
  const isNew=!p.id; p={id:id(), name:'', category:'', mpn:'', qty:1, unit:'pcs', minQty:'', binId:'', tags:[], notes:'', link:'', bag:'', from:'', ...p};
  if(isNew && !p.binId){ const last=localGet('pb.lastbin',''); if(S.bins.has(last)) p.binId=last; }
  const bins=[...S.bins.values()].sort(binCodeSort);
  const cats=[...new Set([...S.parts.values()].map(x=>x.category).filter(Boolean))].sort();
  const {el,close}=sheet(`<h3>${isNew?'New part':'Edit part'}</h3>
    <div class="field"><label for="p-name">Name</label><input id="p-name" value="${esc(p.name)}" placeholder="Seeed XIAO ESP32-S3"></div>
    <label class="bagtag" for="p-dotag"><input type="checkbox" id="p-dotag" ${!p.bag||opts.tag?'checked':''}>
      <span class="bt-num" id="p-bagshow">${esc(bagStr(p.bag||nextBag()))}</span>
      <span class="bt-text">${p.bag?'Rewrite this bag’s tag when I save':'Put it in a new bag and tag it when I save'}<small>${NFC_OK&&!FRAMED?'Have a blank sticker ready; hold it to the top of the phone after you tap Save.':'Tags need Chrome on Android; the bag number is still saved.'}</small></span></label>
    <div class="grid2">
      <div class="field"><label for="p-bin">Bin</label><select id="p-bin"><option value="">— no bin —</option>${bins.map(b=>`<option value="${b.id}" ${b.id===p.binId?'selected':''}>${esc(b.code)} · ${esc(b.name||'')}</option>`).join('')}</select></div>
      <div class="field"><label for="p-cat">Category</label><input id="p-cat" list="cats" value="${esc(p.category)}" placeholder="MCU boards"><datalist id="cats">${cats.map(c=>`<option value="${esc(c)}">`).join('')}</datalist></div>
      <div class="field"><label for="p-qty">Quantity</label><div class="qty"><input id="p-qty" type="number" min="0" step="any" value="${esc(p.qty)}"><input id="p-unit" value="${esc(p.unit||'pcs')}" style="width:70px" aria-label="Unit"></div></div>
      <div class="field"><label for="p-min">Reorder at (optional)</label><input id="p-min" type="number" step="any" value="${esc(p.minQty??'')}"></div>
      <div class="field"><label for="p-mpn">Part number</label><input id="p-mpn" class="mono" value="${esc(p.mpn)}"></div>
      <div class="field"><label for="p-bag">Bag number</label><input id="p-bag" type="number" min="1" step="1" class="mono" value="${esc(p.bag??'')}" placeholder="${nextBag()}"></div>
      <div class="field"><label for="p-tags">Tags (comma separated)</label><input id="p-tags" value="${esc((p.tags||[]).join(', '))}"></div>
    </div>
    <div class="field"><label for="p-link">Link</label><input id="p-link" type="url" value="${esc(p.link||'')}" placeholder="https://"></div>
    <div class="field"><label for="p-notes">Notes</label><textarea id="p-notes" style="min-height:70px">${esc(p.notes)}</textarea></div>
    <details class="more" ${(p.iface||[]).length||p.addr||p.volts||p.logic||p.img||p.check?'open':''}><summary>Specs and reference photo</summary>
      <div class="grid2">
        <div class="field"><label for="p-iface">Interface</label><input id="p-iface" value="${esc((p.iface||[]).join(', '))}" placeholder="I2C, SPI, UART, analog…"></div>
        <div class="field"><label for="p-addr">I2C address</label><input id="p-addr" class="mono" value="${esc(p.addr||'')}" placeholder="0x76"></div>
        <div class="field"><label for="p-volts">Supply voltage</label><input id="p-volts" value="${esc(p.volts||'')}" placeholder="3.3–5 V"></div>
        <div class="field"><label for="p-logic">Logic level</label><input id="p-logic" value="${esc(p.logic||'')}" placeholder="3.3 V"></div>
      </div>
      <div class="field"><label for="p-img">Reference photo link</label><input id="p-img" type="url" value="${esc(p.img||'')}" placeholder="https://"></div>
      <div class="field"><label for="p-check">To check (leave empty once you have)</label><input id="p-check" value="${esc(p.check||'')}"></div>
    </details>
    ${S.assets&&!opts.photoFile?`<div class="field"><label>Photo</label><div class="row"><label class="btn sm" for="p-cam">${ICONS.camera} Take photo<input id="p-cam" type="file" accept="image/*" capture="environment" class="sr"></label><label class="btn sm" for="p-pick">Choose photo<input id="p-pick" type="file" accept="image/*" class="sr"></label><img id="p-prev" alt="" style="height:40px;border-radius:4px" hidden></div></div>`:''}
    ${opts.photoFile?'<div class="tiny" style="margin-bottom:10px">The scanned photo will be attached.</div>':''}
    <div class="actions">${!isNew?'<button class="btn danger left" id="del">Delete</button>':''}<button class="btn" id="cancel">Cancel</button><button class="btn primary" id="save">Save</button></div>`);
  el.querySelector('#cancel').onclick=close;
  const dotag=el.querySelector('#p-dotag'), bagIn=el.querySelector('#p-bag'), saveBtn=el.querySelector('#save'), show=el.querySelector('#p-bagshow');
  // Ticking the box fills in the next bag number; unticking it takes back a number it filled in, so the part is saved
  // without a bag. A number typed in, or the part's own bag, stays.
  let filled='';
  const syncTag=()=>{ if(dotag.checked && bagIn.value==='') bagIn.value=filled=String(p.bag||nextBag()); else if(!dotag.checked && !p.bag && filled && bagIn.value===filled){ bagIn.value=''; filled=''; } show.textContent=bagStr(Number(bagIn.value)||nextBag()); saveBtn.textContent=dotag.checked&&NFC_OK&&!FRAMED?'Save & tag':'Save'; el.querySelector('.bagtag').classList.toggle('on',dotag.checked); };
  dotag.onchange=syncTag; bagIn.oninput=syncTag; syncTag();
  el.querySelector('#del')?.addEventListener('click', async()=>{ if(!confirm('Delete this part?')) return; await S.db.doc('parts/'+p.id).delete(); close(); go('parts'); });
  el.querySelector('#save').onclick=async()=>{
    const name=el.querySelector('#p-name').value.trim(); if(!name){ toast('Name is required'); return; }
    const newBin=el.querySelector('#p-bin').value; const oldB=binOf(p), nb=S.bins.get(newBin);
    const from = (oldB && !isBox(oldB) && isBox(nb)) ? oldB.code : (p.from||'');
    const bagv=el.querySelector('#p-bag').value; const bag = bagv===''?'':Number(bagv);
    if(bag!=='' && !(Number.isSafeInteger(bag) && bag>=1)){ toast('Bag numbers are whole numbers from 1 up',3000); return; } // a tag for bag -5 or 2.5 couldn't open it
    if(bag!=='' && [...S.parts.values()].some(x=>x.id!==p.id && Number(x.bag)===bag)){ toast(`Bag ${bagStr(bag)} is already used`); return; }
    const imgv=el.querySelector('#p-img').value.trim(), img=IN.httpsUrl(imgv);
    if(imgv && !img){ toast('The photo link needs to start with https://',3000); return; }
    const doc={...p, name, bag, from, binId:newBin, category:el.querySelector('#p-cat').value.trim(), qty:Math.max(0,Number(el.querySelector('#p-qty').value)||0), unit:el.querySelector('#p-unit').value.trim()||'pcs',
      minQty:el.querySelector('#p-min').value===''?'':Number(el.querySelector('#p-min').value), mpn:el.querySelector('#p-mpn').value.trim(), tags:el.querySelector('#p-tags').value.split(',').map(s=>s.trim().toLowerCase()).filter(Boolean),
      link:el.querySelector('#p-link').value.trim(), notes:el.querySelector('#p-notes').value.trim(), updatedAt:new Date().toISOString(),
      iface:IN.ifaces(el.querySelector('#p-iface').value), addr:el.querySelector('#p-addr').value.trim(), volts:el.querySelector('#p-volts').value.trim(), logic:el.querySelector('#p-logic').value.trim(), img, check:el.querySelector('#p-check').value.trim()};
    const pf=opts.photoFile||picked(el,'p'); if(pf && S.assets){ try{ const up=await S.assets.upload(await shrink(pf),{type:'image/jpeg'}); doc.photo=up.id; }catch(e){ toast('Photo not saved: '+(e&&e.code||e&&e.message||'upload failed'),4000); } }
    delete doc.id;
    const tagNow = dotag.checked && bag!=='';
    if(isNew) localSet('pb.lastbin', newBin);
    try{ await S.db.doc('parts/'+p.id).set(doc); close(); if(!tagNow) toast(isNew?'Part added':'Saved'); opts.afterSave?.({...doc,id:p.id}); if(tagNow) tagSheet({...doc,id:p.id},'part',{auto:true}); }catch(e){ writeFail(e); }
  };
}
async function writePart(p){ const d={...p}; delete d.id; d.updatedAt=new Date().toISOString(); try{ await S.db.doc('parts/'+p.id).set(d); }catch(e){ writeFail(e); } }
function writeFail(e){ if(e&&e.code==='invalid_argument'){ S.canWrite=false; toast('This view is read-only'); render(); } else if(e&&e.code==='quota_exceeded') toast('Storage is full — delete something first',3000); else toast('Save failed — try again'); }
async function shrink(file){
  try{ const bmp=await createImageBitmap(file); const max=1280; const s=Math.min(1,max/Math.max(bmp.width,bmp.height)); const c=document.createElement('canvas'); c.width=Math.round(bmp.width*s); c.height=Math.round(bmp.height*s); c.getContext('2d').drawImage(bmp,0,0,c.width,c.height); return await new Promise(r=>c.toBlob(b=>r(b||file),'image/jpeg',.82)); }catch{ return file; }
}
function tagSheet(b, kind='bin', opts={}){
  // A part tagged from its own page may not be in a numbered bag yet. It gets the next number here, so the tag
  // carries the bag link; the number is saved with the part once the tag is written or its link is handed out.
  const newBag = kind==='part' && !b.bag ? nextBag() : 0;
  if(newBag) b={...b, bag:newBag};
  const url = kind==='part' ? partUrl(b) : binUrl(b);
  const label = kind==='part' ? (bagStr(b.bag)||b.name) : b.code;
  const native = NFC_OK && !FRAMED;
  const along = 'https://junkdrawer.works/tag-along/?url='+encodeURIComponent(url)+'&label='+encodeURIComponent(String(label).slice(0,12));
  const title = kind==='part' ? `Tag bag <span class="label lg">${esc(bagStr(b.bag)||b.name)}</span>` : `Tag <span class="label lg ${isBox(b)?'box':''}">${esc(b.code)}</span>`;
  const {el,close}=sheet(`<h3>${title}</h3>
    ${kind==='part'&&b.bag?`<p class="muted">${newBag?`This will be bag <b>${esc(bagStr(b.bag))}</b>. The number is saved once the tag is written; write it on the bag then.`:`Write <b>${esc(bagStr(b.bag))}</b> on the bag too, so it can be found without a phone.`}</p>`:''}
    <div class="tagzone" id="tz"><div class="tz-icon">${ICONS.nfc}</div><div id="t-status">${native?'Stick a blank sticker on, then hold it to the <b>top edge of the phone</b>.':'This browser can’t write NFC tags. Use Tag Along, or open Parts Bin in Chrome on an Android phone.'}</div></div>
    <div class="row" style="margin-top:12px">${native?`<button class="btn primary" id="write">${ICONS.nfc} Write tag</button>`:`<a class="btn primary" href="${esc(along)}" target="_blank" rel="noopener" style="text-decoration:none">${ICONS.nfc} Write with Tag Along</a>`}<button class="btn" id="copy">Copy link</button></div>
    <div class="actions"><button class="btn" id="done">${newBag?'Cancel':kind==='part'?'Skip the tag':'Close'}</button></div>`);
  let ctl=null;
  const finish=()=>{ ctl?.abort(); close(); };
  el.querySelector('#done').onclick=finish;
  // The number was free when the sheet opened. If another part has taken it since (another tab, a sync), stop here
  // rather than put two bags on one number.
  const taken=()=>{ if(!newBag || ![...S.parts.values()].some(x=>x.id!==b.id && Number(x.bag)===newBag)) return false; finish(); toast(`Bag ${bagStr(newBag)} has just been used. Tap Bag tag again for the next number.`,4000); return true; };
  const claim=()=>{ if(taken()) return false; if(newBag) S.db.doc('parts/'+b.id).update({bag:newBag}).catch(()=>{}); return true; };
  el.querySelector('#copy').onclick=()=>{ if(!claim()) return; navigator.clipboard?.writeText(url).then(()=>toast('Link copied'),()=>toast(url,4000)); };
  const st=el.querySelector('#t-status'), tz=el.querySelector('#tz');
  async function write(overwrite=false){
    if(taken()) return;
    ctl?.abort(); ctl=new AbortController();
    tz.className='tagzone wait'; st.innerHTML='Hold the sticker to the <b>top edge of the phone</b>…';
    try{
      await new NDEFReader().write({records:[{recordType:'url', data:url}]}, {overwrite, signal:ctl.signal});
      lastWrite=Date.now();
      try{ navigator.vibrate?.(70); }catch{}
      tz.className='tagzone ok'; st.textContent=`${label} tag written.`;
      await S.db.doc((kind==='part'?'parts/':'bins/')+b.id).update(newBag?{tagWritten:true, bag:newBag}:{tagWritten:true}).catch(()=>{});
      el.querySelector('#done').textContent = kind==='part' ? 'Next bag' : 'Done';
      setTimeout(()=>{ if(el.isConnected) close(); if(newBag) toast(`${label} tagged. Write ${label} on the bag.`,3500); else toast(`${label} tagged`); }, 900);
    }catch(e){
      if(e.name==='AbortError') return;
      try{ navigator.vibrate?.([40,60,40]); }catch{}
      tz.className='tagzone bad';
      if(e.name==='NotAllowedError' && !overwrite && !/permission|activation|gesture/i.test(e.message||'')){
        st.textContent='That sticker already holds something.'; const w=el.querySelector('#write'); w.textContent='Write over it'; w.onclick=()=>write(true);
      } else if(/activation|gesture/i.test(e.message||'')) st.textContent='Tap Write tag to start.';
      else if(e.name==='NotAllowedError') st.textContent='NFC is blocked for this site: tap the icon left of the address → Permissions → NFC.';
      else if(e.name==='NotReadableError') st.textContent='NFC looks switched off. Turn it on in the phone’s settings.';
      else st.textContent='Couldn’t write it ('+(e.message||e.name)+'). Hold it flat and still, then tap Write tag.';
    }
  }
  if(!native) el.querySelector('a.btn.primary').addEventListener('click', e=>{ if(!claim()) e.preventDefault(); });
  if(native){
    el.querySelector('#write').onclick=()=>write(false);
    // When NFC is already allowed, start listening straight away: no extra tap between saving and tagging.
    if(opts.overwrite){ const w=el.querySelector('#write'); w.textContent='Write over it'; w.onclick=()=>write(true); }
    if(opts.auto) navigator.permissions?.query({name:'nfc'}).then(p=>{ if(p.state==='granted') write(!!opts.overwrite); }).catch(()=>{});
  }
}

// While Parts Bin is open, it listens for tags the whole time, so a bag's or bin's tag opens here
// instead of Android offering another app (old tags point at the Stockroom artifact on claude.ai).
// Chrome pauses the listener when the tab is hidden and resumes it when it comes back.
// Once NFC is allowed for the site it starts by itself; the first time, the NFC button asks.
let reading=null, lastWrite=0;
const OLD_HOSTS=/(^|\.)claude\.ai$/;
function tagTarget(u){
  let url; try{ url=new URL(u); }catch{ return null; }
  const m=/^#(bag|bin|part)\/(.+)$/.exec(url.hash); if(!m) return null;
  const old=OLD_HOSTS.test(url.hostname);
  if(!old && !(url.origin+url.pathname===APP_URL || /junkdrawer\.works$|github\.io$/.test(url.hostname))) return null;
  return { view:m[1], arg:decodeURIComponent(m[2]), old, url:u };
}
function findTarget(t){
  if(t.view==='bin') { const b=S.bins.get(t.arg); return b&&{kind:'bin',item:b}; }
  if(t.view==='part'){ const p=S.parts.get(t.arg); return p&&{kind:'part',item:p}; }
  const n=Number(t.arg); const p=[...S.parts.values()].find(x=>Number(x.bag)===n); return p&&{kind:'part',item:p};
}
function onTag(ev){
  if(document.querySelector('#sheet-root .sheet') || Date.now()-lastWrite<3000) return; // writing, or the tag just written
  const recs=ev.message?.records||[];
  if(!recs.length) return; // a blank sticker
  for(const rec of recs){
    if(rec.recordType!=='url' && rec.recordType!=='absolute-url') continue;
    const t=tagTarget(new TextDecoder().decode(rec.data)); if(!t) continue;
    try{ navigator.vibrate?.(40); }catch{}
    location.hash='#'+t.view+'/'+t.arg;
    if(t.old){ const hit=findTarget(t); if(hit && S.canWrite) setTimeout(()=>offerRewrite(hit),150); }
    return;
  }
  toast('That tag isn’t one of yours');
}
function offerRewrite({kind,item}){
  const label=kind==='part'?(bagStr(item.bag)||item.name):item.code;
  const {el,close}=sheet(`<h3>Update this tag?</h3>
    <p class="muted">${esc(label)}’s tag still points at the old Stockroom artifact on claude.ai, so with Parts Bin closed your phone offers the Claude app. Rewrite it to open Parts Bin instead. Keep it at the top of the phone.</p>
    <div class="actions"><button class="btn" id="later">Not now</button><button class="btn primary" id="go">${ICONS.nfc} Rewrite tag</button></div>`);
  el.querySelector('#later').onclick=close;
  el.querySelector('#go').onclick=()=>{ close(); tagSheet(item,kind,{auto:true,overwrite:true}); };
}
async function listen(gesture=false){
  if(!NFC_OK||FRAMED||reading) return !!reading;
  if(!gesture){ const st=await navigator.permissions?.query({name:'nfc'}).then(p=>p.state).catch(()=>''); if(st!=='granted') return false; }
  const ctl=new AbortController(); reading=ctl;
  try{
    const r=new NDEFReader(); await r.scan({signal:ctl.signal});
    r.onreading=onTag; r.onreadingerror=()=>{};
    document.getElementById('readtag')?.classList.add('on');
    return true;
  }catch(e){
    if(reading===ctl) reading=null;
    if(gesture) toast(e.name==='NotAllowedError'?'NFC is blocked for this site: tap the icon left of the address → Permissions → NFC.':e.name==='NotReadableError'?'NFC looks switched off. Turn it on in the phone’s settings.':'Couldn’t start NFC: '+(e.message||e.name),4500);
    return false;
  }
}
async function readTag(){
  const was=!!reading;
  if(await listen(true)) toast(was?'Listening: hold any tag to the top of the phone':'Listening while Parts Bin is open: hold a tag to the top of the phone',3000);
}

// ------------------------------------------------------------------ specs and reference photos
function specChips(p){
  return [...(p.iface||[]).map(x=>`<span class="chip spec">${esc(x)}</span>`), p.addr?`<span class="chip spec mono">${esc(p.addr)}</span>`:'',
    p.volts?`<span class="chip spec">${esc(p.volts)} supply</span>`:'', p.logic?`<span class="chip spec">${esc(p.logic)} logic</span>`:''].join('');
}
// A reference photo is a typical one from the maker's or a shop's site, loaded from there. It never replaces the
// part icon in the page: if the picture is gone, the icon underneath shows again.
function refImg(p){ return p.img ? `<img class="ref" src="${esc(p.img)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : ''; }
function wireRefs(el){ el.querySelectorAll('img.ref').forEach(i=>{ i.onerror=()=>{ i.parentElement?.classList.remove('refphoto'); i.remove(); }; }); }
function zoomRef(p){
  const {el,close}=sheet(`<h3>${esc(p.name)}</h3><div class="refbig">${ICONS.parts}${refImg(p)}</div>
    <p class="tiny" style="margin-top:8px">A typical one, for comparison. It isn’t a photo of yours, and it loads from ${esc(host(p.img))}.</p>
    <div class="actions">${/^https?:\/\//i.test(p.link||'')?`<a class="btn left" href="${esc(p.link)}" target="_blank" rel="noopener" style="text-decoration:none">Product page</a>`:''}<button class="btn" id="done">Close</button></div>`);
  el.querySelector('#done').onclick=close; wireRefs(el);
}
function host(u){ try{ return new URL(u).hostname.replace(/^www\./,''); }catch{ return ''; } }
function shortUrl(u){ try{ const x=new URL(u), tail=x.pathname.replace(/\/$/,'').split('/').pop(); return x.hostname.replace(/^www\./,'')+(tail?'/…/'+tail.slice(-28):''); }catch{ return String(u).slice(0,40); } }
function lacksDetails(p){ return !(p.iface||[]).length && !p.volts && !p.img && !p.link && !p.mpn; }

// ------------------------------------------------------------------ inbox: batches from Claude
// Claude reads a photo, a receipt or a product page and replies with a link. Opening it puts the parts here to check;
// each one is saved (and its bag tagged) from its card. Suggested details for parts already listed arrive the same way.
let INBOX = IN.loadInbox(), usedAgain = null;
function inboxCount(){ return IN.count(INBOX); }
function keepInbox(){ if(!IN.saveInbox(INBOX)) toast('This browser’s storage is full',4000); }
function linkCode(){ const m=new RegExp('^#('+IN.PREFIX+'.{8,})$').exec(location.hash); return m && m[1]; }
async function takeLink(){
  const c=linkCode(); if(!c) return false;
  history.replaceState(null,'',location.pathname+location.search+'#inbox'); // the code is long, and reloading shouldn't read it twice
  await takeBatch(c); render(); return true;
}
async function takeBatch(text, {again=false}={}){
  let b=null; try{ b=IN.cleanBatch(await IN.read(text)); }catch{}
  if(!b){ toast('That isn’t a batch Parts Bin can read. Ask Claude for the link again, or load the file.',4500); return false; }
  const r=IN.addBatch(INBOX,b,{again}); keepInbox(); usedAgain=null;
  if(r==='used'){ usedAgain={text, name:b.name||'that batch'}; toast('You’ve been through that batch already',3000); }
  else if(r==='open') toast('That batch is already waiting here');
  else if(r==='full'){ toast('The inbox is full. Finish or dismiss a batch, then open the link again.',4500); return false; }
  else toast(`${b.items.length} from Claude to check`);
  return true;
}
const isUpdate = x => !!x.id && S.parts.has(x.id);
// A suggestion that matches what the part already says isn't worth showing.
function pruneInbox(){
  if(!S.loaded) return; let changed=false;
  for(const b of [...INBOX.batches]){
    const done=b.items.filter(x=>isUpdate(x) && !IN.diff(S.parts.get(x.id),x).length).map(x=>x.k);
    if(done.length){ IN.resolve(INBOX,b.id,done); changed=true; }
  }
  if(changed) keepInbox();
}
const SOURCES = {photo:'From a photo', receipt:'From a receipt', link:'From a link', list:'From a list', details:'Suggested details'};
function renderInbox(m){
  pruneInbox();
  const n=inboxCount();
  m.append(h(`<div class="topbar"><h2>Inbox</h2>${n?`<span class="tiny">${n} to check</span>`:''}</div>`));
  if(!S.canWrite){ m.append(h('<div class="empty"><p>This view is read-only.</p></div>')); return; }
  for(const b of INBOX.batches) m.append(batchSection(b));
  if(usedAgain){ const u=usedAgain; const c=h(`<div class="note row" style="margin-bottom:14px"><span class="grow">You’ve already been through “${esc(u.name)}”.</span><button class="btn sm" id="again">Load it again</button></div>`); c.querySelector('#again').onclick=async()=>{ await takeBatch(u.text,{again:true}); render(); }; m.append(c); }
  if(!n) m.append(h(`<div class="empty"><h3>Nothing waiting</h3><p>Parts Claude reads off a photo, a receipt or a product page land here to check before they’re saved.</p></div>`));
  const intake=h(`<section class="card" style="margin-top:18px"><h3>Add parts from a photo, a receipt or a link</h3>
    <p class="muted">Send Claude a photo of the bags, a receipt or order email, or a product link, and ask it to add them to Parts Bin. It replies with a link that opens here with each part filled in, ready to check, save and tag.</p>
    <div class="field" style="margin-top:10px"><label for="inb-paste">Or paste the link or code</label><input id="inb-paste" class="mono" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="${esc(APP_URL)}#${IN.PREFIX}…"></div>
    <div class="row"><button class="btn" id="inb-go">Open it</button><button class="btn" id="inb-file">Load a file</button></div></section>`);
  const paste=intake.querySelector('#inb-paste');
  const open=async()=>{ const t=paste.value.trim(); if(!t){ toast('Paste the link first'); return; } if(await takeBatch(t)) render(); };
  intake.querySelector('#inb-go').onclick=open; paste.onkeydown=e=>{ if(e.key==='Enter'){ e.preventDefault(); open(); } };
  intake.querySelector('#inb-file').onclick=importJson;
  m.append(intake);
  const bare=[...S.parts.values()].filter(lacksDetails);
  const det=h(`<section class="card"><h3>Fill in details</h3>
    <p class="muted">Claude can suggest a category, interface, I2C address, voltages, a part number, a link and a reference photo for parts you already have, and flag the ones worth testing. Ask it to fill in details for your Parts Bin parts, or send it the list from here. The suggestions come back to this inbox, and nothing changes until you apply it.</p>
    <div class="row">${bare.length?`<button class="btn" id="inb-share">Send Claude ${bare.length} part${bare.length===1?'':'s'} with no details</button>`:'<span class="tiny">Every part has some details already.</span>'}</div></section>`);
  det.querySelector('#inb-share')?.addEventListener('click',()=>sendToClaude(bare));
  m.append(det);
  wireRefs(m);
}
function batchSection(b){
  const ups=b.items.filter(isUpdate), news=b.items.filter(x=>!isUpdate(x)&&x.name);
  const sec=h(`<section class="batch" data-batch="${esc(b.id)}"><div class="section-h"><h3>${esc(b.name||SOURCES[b.source])}</h3><span class="tiny">${b.name?esc(SOURCES[b.source])+' · ':''}${b.items.length} left</span></div>
    <div class="row batchbar">${ups.length>1?`<button class="btn primary" data-a="all">Apply all ${ups.length}</button>`:''}<span class="grow"></span><button class="btn sm" data-a="drop">Dismiss the rest</button></div></section>`);
  sec.querySelector('[data-a="all"]')?.addEventListener('click',()=>applyUpdates(b, ups.map(x=>({x,keys:null}))));
  sec.querySelector('[data-a="drop"]').onclick=()=>{ if(!confirm(`Dismiss the ${b.items.length} left in this batch? Nothing already saved changes.`)) return; IN.resolve(INBOX,b.id,null); keepInbox(); render(); };
  for(const x of news) sec.append(newCard(b,x));
  for(const x of ups) sec.append(updateCard(b,x));
  // Suggestions for parts this browser doesn't have. They stay until dismissed: the parts may be on another device
  // that hasn't synced here yet.
  const lost=b.items.filter(x=>!isUpdate(x)&&!x.name).length;
  if(lost) sec.append(h(`<div class="note" style="margin-bottom:14px">${lost} suggestion${lost===1?' is':'s are'} for ${lost===1?'a part that isn’t':'parts that aren’t'} in this browser’s inventory. If another device has ${lost===1?'it':'them'}, sync here first and ${lost===1?'it':'they'}’ll show up; otherwise dismiss.</div>`));
  return sec;
}
// Parts already listed that this could be: the one Claude named first, then near matches on the name or part number.
function candidates(x){
  const out=[]; const add=(p,why)=>{ if(p && !out.some(c=>c.p.id===p.id)) out.push({p,why}); };
  add(x.match && S.parts.get(x.match),'match');
  for(const p of nearParts(x.name)) add(p,'near');
  if(x.mpn && x.mpn.length>2) for(const p of searchParts(x.mpn).slice(0,2)) add(p,'near');
  return out.slice(0,3);
}
function nearParts(name){
  // "HW-611" and "HW611" are one word; what's in brackets may be the chip (GY302 (BH1750)) or just the brand, so try both.
  const toks=(s,brackets)=>norm(String(s||'').replace(/([a-z])-(?=\d)/gi,'$1').replace(/\([^)]*\)/g,m=>brackets?' '+m+' ':' ')).split(' ').filter(w=>w.length>1);
  const score=(a,b)=>{ const al=a.join('').length, bl=b.join('').length; if(!al||!bl) return 0;
    const shared=a.filter(w=>b.includes(w)), s=shared.join('').length/Math.min(al,bl);
    const model=shared.some(w=>w.length>=6&&/\d/.test(w)&&/[a-z]/.test(w)); // a shared part number
    return model ? Math.max(s,0.6) : (s>=0.6&&shared.some(w=>/\d/.test(w)))||s>=0.85 ? s : 0; };
  return [...S.parts.values()].map(p=>({p, s:Math.max(score(toks(name,false),toks(p.name,false)), score(toks(name,true),toks(p.name,true)))}))
    .filter(x=>x.s).sort((x,y)=>y.s-x.s).slice(0,2).map(x=>x.p);
}
function itemHead(x, title, sub=''){
  return `<div class="inb-head"><div class="thumb${x.img?' refphoto':''}">${ICONS.parts}${refImg(x)}</div><div class="grow"><div class="t">${title}</div>
    <div class="row chips">${x.category?`<span class="chip">${esc(x.category)}</span>`:''}${specChips(x)}${x.mpn?`<span class="tiny mono">${esc(x.mpn)}</span>`:''}</div>${sub}</div></div>`;
}
function newCard(b,x){
  const cands=candidates(x);
  const row=c=>`<button type="button" class="${c.why==='match'?'pick':''}" data-id="${esc(c.p.id)}"><span><b>${esc(c.p.name)}</b><div class="s">${c.p.bag?esc(bagStr(c.p.bag))+' · ':''}in stock ${esc(fmtQty(c.p))}${binOf(c.p)?' · '+esc(binOf(c.p).code):''}</div></span><span class="chip ${c.why==='match'?'ok':''}">${c.why==='match'?'same part':'existing'}</span></button>`;
  const el=h(`<div class="card inb" data-k="${esc(x.k)}">
    ${itemHead(x, `${esc(x.name)}${x.qty!=null?` <span class="mono q">×${esc(x.qty)}</span>`:''}`, x.notes?`<div class="tiny">${esc(x.notes)}</div>`:'')}
    ${x.check?`<div class="checknote"><div><b>Check.</b> ${esc(x.check)}</div></div>`:''}
    <div class="matchlist">${cands.map(row).join('')}
      <button type="button" data-id=""><span><b>${cands.length?'It’s a different part':'Add it'}</b>${cands.length?'<div class="s">Not one of these</div>':''}</span><span class="chip warn">new part</span></button></div>
    <div class="row"><span class="tiny grow">${cands.length?'Pick the row that’s in the bag.':'Opens filled in, to check and save.'}</span><button class="btn sm" data-a="skip">Skip</button></div></div>`);
  el.querySelectorAll('[data-id]').forEach(btn=>btn.onclick=()=>openFromInbox(b,x,btn.dataset.id?S.parts.get(btn.dataset.id):null));
  el.querySelector('[data-a="skip"]').onclick=()=>{ IN.resolve(INBOX,b.id,[x.k]); keepInbox(); render(); };
  return el;
}
// Opens the usual part sheet, filled in. A part that's already listed keeps its record: blanks are filled, nothing it
// says is overwritten, and a receipt adds to its count where a photo of the bag replaces it.
function openFromInbox(b,x,matched){
  const empty=v=>v==null||v===''||(Array.isArray(v)&&!v.length);
  let base;
  if(matched){
    base={...matched};
    for(const k of ['category','mpn','link','iface','addr','volts','logic','img']) if(!empty(x[k]) && empty(base[k])) base[k]=x[k];
    if(x.check) base.check = !matched.check ? x.check : matched.check.includes(x.check) ? matched.check : (matched.check+' · '+x.check).slice(0,300);
    if(x.notes) base.notes=IN.proposed(matched,x,'notes');
    if(x.tags) base.tags=IN.proposed(matched,x,'tags');
    if(x.qty!=null) base.qty = (x.add ?? b.source==='receipt') ? Number(matched.qty||0)+x.qty : x.qty;
  } else {
    base={name:x.name, category:x.category||'', mpn:x.mpn||'', qty:x.qty??1, unit:x.unit||'pcs', tags:x.tags||[], notes:x.notes||'', link:x.link||''};
    for(const k of ['iface','addr','volts','logic','img','check']) if(!empty(x[k])) base[k]=x[k];
    const bin=b.bin && [...S.bins.values()].find(z=>z.code.toLowerCase()===b.bin.toLowerCase()), dest=localGet('sr.packbox','');
    if(bin) base.binId=bin.id; else if(S.bins.has(dest)) base.binId=dest;
  }
  editPart(base,{tag:!matched||!matched.bag, afterSave:()=>{ IN.resolve(INBOX,b.id,[x.k]); keepInbox(); render(); }});
}
function updateCard(b,x){
  const p=S.parts.get(x.id), d=IN.diff(p,x), bin=binOf(p);
  const to=r=>{
    if(r.k==='notes' && r.from) return '+ '+esc(x.notes);
    if(r.k==='tags'){ const add=x.tags.filter(t=>!(p.tags||[]).includes(t)); return '+ '+esc(add.join(', ')); }
    if(r.k==='img'||r.k==='link') return `${r.from?'<s>'+esc(shortUrl(r.from))+'</s> ':''}${esc(shortUrl(r.to))}`;
    return `${IN.show(r.from)?'<s>'+esc(IN.show(r.from))+'</s> ':''}${esc(IN.show(r.to))}`;
  };
  const el=h(`<div class="card inb" data-k="${esc(x.k)}">
    ${itemHead({img:x.img||p.img}, `<a href="#part/${esc(p.id)}">${esc(p.name)}</a>`, `<div class="tiny">${p.bag?esc(bagStr(p.bag))+' · ':''}${bin?esc(bin.code):'no bin'}</div>`)}
    <div class="diff">${d.map(r=>`<label><input type="checkbox" data-k="${r.k}" checked><span class="k">${esc(r.label)}</span><span class="v${r.k==='check'?' warn':''}">${to(r)}</span></label>`).join('')}</div>
    <div class="row"><span class="grow"></span><button class="btn sm" data-a="skip">Skip</button><button class="btn primary sm" data-a="apply">Apply</button></div></div>`);
  el.querySelector('[data-a="skip"]').onclick=()=>{ IN.resolve(INBOX,b.id,[x.k]); keepInbox(); render(); };
  el.querySelector('[data-a="apply"]').onclick=()=>applyUpdates(b,[{x, keys:new Set([...el.querySelectorAll('.diff input:checked')].map(i=>i.dataset.k))}]);
  return el;
}
// keys: which fields to take from a suggestion; null takes them all. Two suggestions for one part build on each
// other, and each part is written once.
function applyUpdates(b, list){
  const now=new Map(), changes=new Map();
  for(const {x,keys} of list){
    const p=now.get(x.id)||S.parts.get(x.id); if(!p) continue;
    const data={}; for(const r of IN.diff(p,x)) if(!keys||keys.has(r.k)) data[r.k]=r.to;
    if(!Object.keys(data).length) continue;
    now.set(x.id,{...p,...data}); changes.set(x.id,{...changes.get(x.id),...data});
  }
  const writes=[...changes].map(([pid,data])=>S.db.doc('parts/'+pid).update(data)), parts=writes.length;
  IN.resolve(INBOX,b.id,list.map(q=>q.x.k)); keepInbox();
  Promise.all(writes).then(()=>toast(parts?`Updated ${parts} part${parts===1?'':'s'}`:'Nothing applied'), writeFail);
  render();
}
// Hands Claude the parts to look up. On a phone this opens the share sheet (pick Claude); elsewhere it copies.
function claudeText(parts){
  const rows=parts.map(p=>{ const r={id:p.id, name:p.name}; for(const k of ['category','mpn','addr','volts','logic','link']) if(p[k]) r[k]=p[k]; if((p.iface||[]).length) r.iface=p.iface; if(p.notes) r.notes=String(p.notes).slice(0,140); return r; });
  return `Parts Bin: fill in details for ${rows.length===1?'this part':`these ${rows.length} parts`} (category, interface, I2C address, supply and logic voltage, part number, link, reference photo), flag anything I should test before trusting it, and give me the Inbox link.\n\n${JSON.stringify({partsbin:1, ask:'details', parts:rows})}`;
}
async function sendToClaude(parts){
  const text=claudeText(parts);
  if(navigator.share && matchMedia('(pointer:coarse)').matches){ try{ await navigator.share({text}); return; }catch(e){ if(e.name==='AbortError') return; } }
  try{ await navigator.clipboard.writeText(text); toast('Copied. Paste it into a chat with Claude.',3500); }
  catch{ const {el,close}=sheet(`<h3>Copy this to Claude</h3><textarea readonly style="min-height:180px" class="mono">${esc(text)}</textarea><div class="actions"><button class="btn" id="done">Close</button></div>`); el.querySelector('#done').onclick=close; el.querySelector('textarea').select(); }
}

// ------------------------------------------------------------------ settings
function renderSettings(m){
  m.append(h('<div class="topbar"><h2>Settings</h2></div>'));
  const dc=h('<section class="card" id="drivecard"></section>'); m.append(dc);
  if(drive.ready) drive.card(dc); else dc.innerHTML='<h3>Save across devices</h3><p class="muted">Google Drive saving works at parts-bin.junkdrawer.works. Here the inventory stays in this browser.</p>';
  const aic=h(`<section class="card"><h3>Photo identification <span class="tiny">optional</span></h3>
    <p class="muted">With your own Anthropic API key, the camera button in Pack identifies a part from a photo and BOM check can match loosely worded lists. The key is kept in this browser only and sent only to Anthropic; calls are billed to your API account, not a Claude plan. Each device needs it entered once.</p>
    <div class="grid2"><div class="field"><label for="ai-key">API key</label><input id="ai-key" type="password" autocomplete="off" spellcheck="false" placeholder="sk-ant-…" value="${esc(ai.key)}"></div>
    <div class="field"><label for="ai-model">Model</label><input id="ai-model" class="mono" spellcheck="false" value="${esc(ai.model)}"></div></div>
    <div class="row"><button class="btn primary" id="ai-save">Save</button>${ai.key?'<button class="btn" id="ai-clear">Remove key</button>':''}</div></section>`);
  m.append(aic);
  aic.querySelector('#ai-save').onclick=()=>{ ai.save({key:aic.querySelector('#ai-key').value, model:aic.querySelector('#ai-model').value}); S.sample=makeSample(); S.imgOk=!!S.sample; toast(ai.key?'Saved':'No key saved'); render(); };
  aic.querySelector('#ai-clear')?.addEventListener('click',()=>{ ai.save({key:'',model:ai.model}); S.sample=null; S.imgOk=false; toast('Key removed'); render(); });
  const bk=h(`<section class="card"><h3>Backup</h3><p class="muted">A file with every bin, part and saved BOM. Loading a file merges it with what’s here, item by item, so nothing is lost. This is also how the Stockroom artifact’s export comes in.</p>
    <div class="row"><button class="btn" id="exp">Save a backup file</button><button class="btn" id="imp">Load a file</button></div></section>`);
  m.append(bk);
  bk.querySelector('#exp').onclick=exportJson; bk.querySelector('#imp').onclick=importJson;
  m.append(h(`<p class="tiny" style="margin-top:18px">Tags written here open <span class="mono">${esc(APP_URL)}#bag/…</span>. ${NFC_OK&&!FRAMED?'This browser can read and write NFC tags.':'This browser can’t use NFC; Chrome on Android can.'}</p>`));
}

// ------------------------------------------------------------------ export
function exportJson(){
  const blob=new Blob([store.backup()],{type:'application/json'});
  const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=`parts-bin-${new Date().toISOString().slice(0,10)}.json`;
  document.body.append(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(a.href),2000);
}
function importJson(){
  const inp=document.createElement('input'); inp.type='file'; inp.accept='application/json,.json';
  inp.onchange=async()=>{ const f=inp.files[0]; if(!f) return;
    const text=await f.text();
    if(/^\s*\{\s*"partsbin"/.test(text)){ if(await takeBatch(text)){ if(S.route.view==='inbox') render(); else go('inbox'); } return; }
    try{ const n=store.importText(text); toast(n?`Loaded: ${n} item${n===1?'':'s'} added or updated`:'Nothing new in that file',3000); go('bins'); }
    catch(e){ toast(e.message||'Couldn’t read that file',4000); } };
  inp.click();
}

// ------------------------------------------------------------------ boot
window.addEventListener('hashchange',()=>{ if(linkCode()) takeLink(); else render(); });
S.db=localDb; S.user=null; S.canWrite=true;
S.sample=makeSample(); S.imgOk=!!S.sample; S.assets=null; S.downloads=null;
let got=0;
localDb.collection('bins').onSnapshot(snap=>{ S.bins=new Map(snap.docs.map(d=>[d.id,{id:d.id,...d.data()}])); if(S.loaded) render(); else if(++got>=2){ S.loaded=true; render(); } });
localDb.collection('parts').onSnapshot(snap=>{ S.parts=new Map(snap.docs.map(d=>[d.id,{id:d.id,...d.data()}])); if(S.loaded) render(); else if(++got>=2){ S.loaded=true; render(); } });
localDb.collection('projects').onSnapshot(snap=>{ S.projects=new Map(snap.docs.map(d=>[d.id,{id:d.id,...d.data()}])); if(S.loaded&&S.route.view==='bom') render(); });
render();
store.onSave(r=>{ if(r==='full') toast('This browser’s storage is full',4000); else drive.changed(); });
drive.onUpdate(()=>store.reload());
drive.chip(document.getElementById('cloud')); drive.chip(document.getElementById('cloud-m'));
window.addEventListener('storage',e=>{ if(e.key==='parts-bin') store.reload(); if(e.key===IN.KEY){ INBOX=IN.loadInbox(); render(); } });
takeLink(); // a link from Claude carries a batch for the inbox
listen(); // starts on its own once NFC has been allowed for the site
document.addEventListener('visibilitychange',()=>{ if(document.visibilityState==='visible') listen(); });
if('serviceWorker' in navigator && !FRAMED && location.protocol==='https:') navigator.serviceWorker.register('sw.js').catch(()=>{});
