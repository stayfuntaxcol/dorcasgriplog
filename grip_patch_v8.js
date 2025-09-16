
// grip_patch_v8.js (no inline code; CSP-friendly)
(function(){
  if(window.__GRIP_V8__) return;
  window.__GRIP_V8__ = true;

  const $ = (s,d=document)=>d.querySelector(s);
  const $$ = (s,d=document)=>Array.from(d.querySelectorAll(s));

  // --- Debug logger
  function mountDebug(){
    if($('#gripDebug')) return;
    const box = document.createElement('div');
    box.id='gripDebug';
    box.innerHTML = `<header><strong>GRIP Debug</strong>
      <div>
        <button id="dbgToggle" class="btn">hide</button>
        <button id="dbgClear" class="btn">clear</button>
      </div></header><pre id="dbgOut"></pre>`;
    document.body.appendChild(box);
    $('#dbgToggle').onclick = ()=>{
      const pre = $('#gripDebug pre'); pre.style.display = pre.style.display==='none'?'block':'none';
    };
    $('#dbgClear').onclick = ()=>{ $('#dbgOut').textContent=''; };
  }
  function log(...args){
    console.log('[GRIP]', ...args);
    const pre = $('#dbgOut');
    if(!pre) return;
    pre.textContent += args.map(a=> (typeof a==='string'? a : JSON.stringify(a))).join(' ') + '\n';
    pre.scrollTop = pre.scrollHeight;
  }

  function showDebug(v=true){ const el=$('#gripDebug'); if(!el) return; el.style.display = v?'block':'none'; }

  // Toggle panel with Ctrl+Alt+D
  window.addEventListener('keydown', (e)=>{
    if(e.ctrlKey && e.altKey && e.key.toLowerCase()==='d'){
      showDebug( $('#gripDebug').style.display!=='block' );
    }
  });

  // --- Normalization and parsing
  function normalizeId(s){
    s = String(s||'').trim().toUpperCase();
    const m = s.match(/^([GRIPQS])\s*[-_ ]*\s*(\d+)\s*$/i);
    if(m){ return m[1].toUpperCase()+parseInt(m[2],10); }
    const m2 = s.match(/^([GRIPQS])\s*[-_ ]*\s*(\d+)/i);
    if(m2){ return m2[1].toUpperCase()+parseInt(m2[2],10); }
    return s.replace(/\s+/g,'');
  }
  const MAP = {G:'goals',R:'risks',I:'issues',P:'plans',Q:'questions',S:'suggestions'};
  function detectCollFromId(id){ const n=normalizeId(id); return n? MAP[n[0]] : null; }

  function extractIdFromTr(tr){
    if(!tr) return null;
    const attrKeys = ['data-id','data-item-id','data-key','data-doc-id'];
    for(const k of attrKeys){
      const v = tr.getAttribute(k);
      if(v) return normalizeId(v);
    }
    let json = tr.getAttribute('data-row');
    if(!json){
      const cellWithData = tr.querySelector('[data-row]');
      if(cellWithData) json = cellWithData.getAttribute('data-row');
    }
    if(json){
      try{
        const obj = JSON.parse(json);
        if(obj && obj.id) return normalizeId(obj.id);
      }catch(_){}
    }
    const cell = Array.from(tr.cells).find(td=>/^[GRIPQS]\s*[-_ ]*\s*\d+/.test((td.innerText||'').trim()));
    if(cell) return normalizeId(cell.innerText.trim());
    const m = (tr.innerText||'').match(/([GRIPQS])\s*[-_ ]*\s*(\d+)/i);
    if(m) return normalizeId(m[0]);
    return null;
  }

  // --- Data helpers
  function idNum(id){ const m = String(id||'').match(/(\d+)/); return m?parseInt(m[1],10):0; }
  function sortAll(){
    const cache = window.cache || (window.cache={goals:[],risks:[],issues:[],plans:[],questions:[],suggestions:[]});
    Object.keys(cache).forEach(c => Array.isArray(cache[c]) && cache[c].sort((a,b)=>idNum(a.id)-idNum(b.id)));
  }
  async function getRowSmart(coll, id, pushIfMissing=false){
    const nid = normalizeId(id);
    const cache = window.cache || (window.cache={goals:[],risks:[],issues:[],plans:[],questions:[],suggestions:[]});
    const list = cache[coll] || (cache[coll]=[]);
    let row = list.find(x=> normalizeId(x.id)===nid);
    if(row) return row;
    try{
      if(window.getDoc && window.doc && window.db){
        const snap = await getDoc(doc(db, coll, nid));
        if(snap && snap.exists && snap.exists()){
          row = snap.data(); if(!row.id) row.id = nid;
          list.push(row);
          return row;
        }
      }
    }catch(err){ log('getDoc failed', err && err.message); }
    const defaults = {
      goals:       (id)=>({id,goal:'',owner:'',start:'',end:'',status:'Open',notes:''}),
      risks:       (id)=>({id,description:'',owner:'',likelihood:'Medium',impact:'Medium',status:'Open',mitigation:''}),
      issues:      (id)=>({id,description:'',owner:'',severity:'Medium',status:'Open',resolution:''}),
      plans:       (id)=>({id,description:'',owner:'',goalId:'',start:'',end:'',status:'Open'}),
      questions:   (id)=>({id,description:'',subject:'New Goal',owner:window.CURRENT_ROLE||'Viewer',submitted:new Date().toISOString().slice(0,10),status:'',reviewerRole:'',reviewed:'',comments:'',stars:0,starredBy:{}}),
      suggestions: (id)=>({id,description:'',subject:'New Goal',owner:window.CURRENT_ROLE||'Viewer',submitted:new Date().toISOString().slice(0,10),status:'',reviewerRole:'',reviewed:'',comments:'',stars:0,starredBy:{}}),
    };
    row = defaults[coll] ? defaults[coll](nid) : {id:nid};
    if(pushIfMissing) list.push(row);
    return row;
  }

  // --- Overlay
  function ensureOverlay(){
    if($('#overlay')) return;
    const shell = document.createElement('div');
    shell.id='overlay';
    shell.innerHTML = `<div class="ov-backdrop"></div>
      <div class="ov-panel">
        <div class="ov-header">
          <div>
            <div id="ovTitle" class="ov-title">Item</div>
            <div id="ovSub" class="ov-sub"></div>
          </div>
          <div class="ov-actions">
            <button id="ovAddGoal" class="btn">+ New Goal</button>
            <button id="ovAddRisk" class="btn">+ New Risk</button>
            <button id="ovAddIssue" class="btn">+ New Issue</button>
            <button id="ovAddPlan" class="btn">+ New Plan</button>
            <button id="ovAddQuestion" class="btn">+ New Question</button>
            <button id="ovAddSuggestion" class="btn">+ New Suggestion</button>
            <button id="ovClose" class="btn">Close</button>
          </div>
        </div>
        <div class="ov-body">
          <div class="ov-left"><div id="ovBody"></div></div>
          <aside class="ov-right">
            <div class="chain-title">Gekoppelde items</div>
            <div id="chainGrid" class="chain-grid"></div>
          </aside>
        </div>
        <div class="ov-footer">
          <div class="ov-actions">
            <button id="ovEdit" class="btn">Edit</button>
            <button id="ovSave" class="btn primary" disabled>Save</button>
            <button id="ovDelete" class="btn danger">Delete</button>
          </div>
          <span class="badge" id="ovMeta"></span>
        </div>
      </div>`;
    document.body.appendChild(shell);
  }

  let OV = { coll:null, id:null, row:null, edit:false, autosaveTimer:null, chainId:null };
  const AUTOSAVE_MS = 120000;

  function setOverlayEdit(on){
    OV.edit=!!on;
    $$('#ovBody [name]').forEach(el=> el.disabled=!OV.edit);
    $('#ovSave').disabled=!OV.edit;
  }

  function renderForm(coll,row){
    const sets = {
      goals:[['goal','textarea','Goal'],['notes','textarea','Notes'],['owner','text','Owner'],['status','text','Status'],['start','date','Start'],['end','date','End']],
      risks:[['description','textarea','Description'],['mitigation','textarea','Mitigation'],['owner','text','Owner'],['likelihood','text','Likelihood'],['impact','text','Impact'],['status','text','Status']],
      issues:[['description','textarea','Description'],['resolution','textarea','Resolution'],['owner','text','Owner'],['severity','text','Severity'],['status','text','Status']],
      plans:[['description','textarea','Description'],['goalId','text','Goal Link (G#)'],['owner','text','Owner'],['status','text','Status'],['start','date','Start'],['end','date','End']],
      suggestions:[['description','textarea','Description'],['comments','textarea','Comments'],['subject','text','Subject'],['owner','text','Owner'],['status','text','Status'],['reviewerRole','text','Reviewer Role'],['submitted','date','Submitted'],['reviewed','date','Reviewed']],
      questions:[['description','textarea','Description'],['comments','textarea','Comments'],['subject','text','Subject'],['owner','text','Owner'],['status','text','Status'],['reviewerRole','text','Reviewer Role'],['submitted','date','Submitted'],['reviewed','date','Reviewed']],
    };
    const fields = sets[coll] || Object.keys(row).map(k=>[k,'text',k]);
    const html = fields.map(([name,type,label])=>{
      const dis = OV.edit? '' : 'disabled';
      if(type==='textarea'){
        return `<div class="form-row"><label>${label}</label><textarea name="${name}" ${dis}>${row[name]||''}</textarea></div>`;
      }
      return `<div class="form-row"><label>${label}</label><input name="${name}" type="${type}" value="${row[name]||''}" ${dis} /></div>`;
    }).join('');
    const meta = `<div class="form-row"><label>Item ID</label><input disabled value="${row.id||''}" /></div>
                 <div class="form-row"><label>Chain ID</label><input disabled value="${row.chainId||row.id||''}" /></div>`;
    $('#ovBody').innerHTML = `<div class="ov-grid"><div class="block"><details open><summary>Content</summary>${html}</details></div><div class="block"><details open><summary>Meta</summary>${meta}</details></div></div>`;
  }

  function buildChainGrid(rootChainId, coll, id){
    const cache = window.cache || (window.cache={goals:[],risks:[],issues:[],plans:[],questions:[],suggestions:[]});
    const nodes = [];
    Object.keys(cache).forEach(c=> (cache[c]||[]).forEach(x=>{
      const cid = x.chainId || x.linkedTo || null;
      const belongs = (x.chainId && x.chainId===rootChainId) || (!x.chainId && x.id===rootChainId) || (cid===rootChainId);
      if(belongs) nodes.push({coll:c,id:x.id,isRoot:x.id===rootChainId});
    }));
    if(nodes.length===0) nodes.push({coll,id,isRoot:true});
    nodes.sort((a,b)=> a.coll===b.coll ? idNum(a.id)-idNum(b.id) : a.coll.localeCompare(b.coll));
    $('#chainGrid').innerHTML = nodes.map(n=>`<div class="chain-card ${n.coll===coll && n.id===id?'active':''}" data-coll="${n.coll}" data-id="${n.id}">
      <div>${n.coll.slice(0,1).toUpperCase()+n.coll.slice(1,-1)} ${n.isRoot?'<span class="chain-root">root</span>':''}</div>
      <div style="font-weight:700;margin-top:6px">${n.id}</div>
    </div>`).join('');
  }

  async function openOverlay(coll, id){
    try{
      ensureOverlay();
      const nid = normalizeId(id);
      const c = coll || detectCollFromId(nid);
      if(!c || !nid){ log('openOverlay: invalid', coll, id); alert('Item not found'); return; }
      sortAll();
      const row = await getRowSmart(c, nid, true);
      if(!row){ alert('Item not found'); return; }
      if(!row.chainId) row.chainId = row.id;
      OV = { coll:c, id:nid, row: JSON.parse(JSON.stringify(row)), edit:false, autosaveTimer:null, chainId: row.chainId };
      $('#ovTitle').textContent = `${c.slice(0,1).toUpperCase()+c.slice(1,-1)} – ${nid}`;
      $('#ovSub').textContent = `Type: ${c} • ID: ${nid}`;
      $('#ovMeta').textContent = 'viewer';
      renderForm(c,row);
      buildChainGrid(OV.chainId, c, nid);
      $('#overlay').classList.add('show');
      setOverlayEdit(false);
    }catch(err){
      log('openOverlay error', err && err.message);
      alert('Kon overlay niet openen: '+(err && err.message));
    }
  }

  // Menu buttons: ensure present
  function hideLegacyButtons(){
    $$('button,a').forEach(el=>{
      const t=(el.textContent||'').trim().toLowerCase();
      if(/^(del|delete|verwijder|bewerk|edit|wijzig)$/.test(t)){
        el.style.display='none';
      }
    });
  }
  function detectCollFromTr(tr){
    let coll = tr.closest('[data-tab]')?.getAttribute('data-tab') || tr.closest('table')?.getAttribute('data-coll');
    if(!coll){
      const id = extractIdFromTr(tr);
      coll = detectCollFromId(id);
    }
    return coll;
  }
  function ensureMenuButtons(root=document){
    $$('table tbody tr', root).forEach(tr=>{
      if(tr.querySelector('[data-menu]')) return;
      const lastTd = tr.querySelector('td:last-child') || tr.appendChild(document.createElement('td'));
      const btn = document.createElement('button');
      btn.className='btn'; btn.dataset.menu = detectCollFromTr(tr) || 'goals';
      btn.textContent='Menu';
      lastTd.appendChild(btn);
    });
  }

  // Single handlers with stopPropagation
  function onMenuClick(e){
    const btn = e.target.closest('[data-menu]');
    if(!btn) return;
    const tr = btn.closest('tr');
    const id = extractIdFromTr(tr);
    const coll = btn.dataset.menu || detectCollFromTr(tr);
    if(coll && id){
      e.preventDefault(); e.stopPropagation(); if(e.stopImmediatePropagation) e.stopImmediatePropagation();
      log('Menu click', {coll,id});
      openOverlay(coll, id);
    }else{
      alert('Item not found');
    }
  }
  function onRowClick(e){
    if(e.target.closest('[data-menu]')) return;
    const tr = e.target.closest('table tbody tr');
    if(!tr) return;
    const id = extractIdFromTr(tr);
    const coll = detectCollFromTr(tr);
    if(coll && id){
      e.preventDefault(); e.stopPropagation(); if(e.stopImmediatePropagation) e.stopImmediatePropagation();
      log('Row click', {coll,id});
      openOverlay(coll, id);
    }
  }

  // Observe DOM changes (framework rerenders)
  const mo = new MutationObserver(()=>{
    hideLegacyButtons();
    ensureMenuButtons(document);
  });

  function init(){
    mountDebug(); // panel hidden by default; Ctrl+Alt+D toggles
    ensureOverlay();
    hideLegacyButtons();
    ensureMenuButtons();
    document.addEventListener('click', onMenuClick, true);
    document.addEventListener('click', onRowClick, true);
    mo.observe(document.documentElement, {childList:true,subtree:true});
    log('v8 init done');
  }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded', init);
  else init();

})();
