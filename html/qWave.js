// ─── STATE ────────────────────────────────────────────────────────────
var feeds = [], queue = [], curIdx = -1, selIdx = -1, activeFeedId = null;
var audio = document.getElementById('audio');
 
// ─── UTILS ───────────────────────────────────────────────────────────
function G(id) { return document.getElementById(id); }
function esc(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function gTagTxt(el) {
  var tags = Array.prototype.slice.call(arguments,1);
  for (var i=0;i<tags.length;i++) { var n=el.getElementsByTagName(tags[i])[0]; if(n) return n.textContent.trim(); }
  return '';
}
function gTagAttr(el, tag, attr) { var n=el.getElementsByTagName(tag)[0]; return n?(n.getAttribute(attr)||''):''; }
function stripHTML(h) { if(!h)return''; var d=document.createElement('div'); d.innerHTML=h; return (d.textContent||d.innerText||'').replace(/\s+/g,' ').trim(); }
function fmtTime(s) { if(!s||isNaN(s)||s<0)return'0:00'; var h=Math.floor(s/3600),m=Math.floor((s%3600)/60),sc=Math.floor(s%60); return h>0?h+':'+p2(m)+':'+p2(sc):m+':'+p2(sc); }
function p2(n) { return String(n).padStart(2,'0'); }
function fmtDur(r) { if(!r)return''; if(/^\d{1,2}:\d{2}/.test(r))return r; var n=parseInt(r); return(!isNaN(n)&&n>0)?fmtTime(n):r; }
function fmtDate(r) { if(!r)return''; try{return new Date(r).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'});}catch(e){return'';} }
var _tt; function toast(m) { var e=G('toast'); e.textContent=m; e.classList.add('on'); clearTimeout(_tt); _tt=setTimeout(function(){e.classList.remove('on');},3000); }
 
// ─── BLACKOUT ─────────────────────────────────────────────────────────
function enterBlackout() { G('blackout').classList.add('on'); }
function exitBlackout()  { G('blackout').classList.remove('on'); }
 
// ─── BUTTON WIRING (no inline onclick except blackout close) ──────────
G('addBtn').addEventListener('click', toggleForm);
G('loadUrlBtn').addEventListener('click', doURL);
G('cancelAddBtn').addEventListener('click', toggleForm);
G('xmlFile').addEventListener('change', doFile);
G('importFile').addEventListener('change', importJSON);
G('addAllBtn').addEventListener('click', addAll);
G('clearQBtn').addEventListener('click', clearQ);
G('shuffleBtn').addEventListener('click', shuffleQ);
G('moveUpBtn').addEventListener('click', moveUp);
G('moveDownBtn').addEventListener('click', moveDown);
G('playBtn').addEventListener('click', togglePlay);
G('prevBtn').addEventListener('click', prevTrack);
G('nextBtn').addEventListener('click', nextTrack);
G('skipBkBtn').addEventListener('click', function(){ skip(-15); });
G('skipFwBtn').addEventListener('click', function(){ skip(30); });
G('volSl').addEventListener('input', function(){ setVol(this.value); });
G('spd').addEventListener('change', function(){ setSpd(this.value); });
G('prog').addEventListener('click', seek);
 
// ─── ADD FORM ─────────────────────────────────────────────────────────
function toggleForm() {
  var f = G('addForm');
  f.classList.toggle('open');
  if (f.classList.contains('open')) G('urlInput').focus();
}
 
// ─── PROXIED FETCH ─────────────────────────────────────────────────────
var PROXIES = [
  function(u){ return u; },
  function(u){ return 'https://corsproxy.io/?url='+encodeURIComponent(u); },
  function(u){ return 'https://api.allorigins.win/raw?url='+encodeURIComponent(u); }
];
 
async function fetchXML(url) {
  var last;
  for (var i=0;i<PROXIES.length;i++) {
    try {
      var ctrl=new AbortController(), t=setTimeout(function(){ctrl.abort();},12000);
      var r=await fetch(PROXIES[i](url),{signal:ctrl.signal}); clearTimeout(t);
      if (!r.ok) continue;
      var txt=await r.text();
      if (txt.trim()[0]==='<') return txt;
    } catch(e){ last=e; }
  }
  throw new Error(last?last.message:'All proxies failed');
}
 
async function doURL() {
  var url = G('urlInput').value.trim();
  if (!url) { toast('Enter a URL first'); return; }
  G('urlInput').value = '';
  toggleForm();
  G('epList').innerHTML = '<div class="loading"><div class="spin"></div>FETCHING FEED…</div>';
  try { var txt=await fetchXML(url); parseFeed(txt, url, url); }
  catch(e) {
    toast('Failed: '+e.message);
    G('epList').innerHTML = '<div class="empty"><div class="empty-ico">⚠</div><div class="empty-ttl">Load Failed</div><div class="empty-sub">Check the URL and try again</div></div>';
  }
}
 
function doFile(evt) {
  var file=evt.target.files[0]; if(!file)return;
  evt.target.value='';
  var r=new FileReader();
  r.onload=function(e){ toggleForm(); parseFeed(e.target.result, file.name.replace(/\.[^.]+$/,''), '__local__:'+file.name); };
  r.readAsText(file);
}
 
// ─── PARSE FEED ───────────────────────────────────────────────────────
function parseFeed(xmlText, fallbackName, sourceUrl) {
  var parser=new DOMParser();
  var doc=parser.parseFromString(xmlText,'application/xml');
  if (doc.querySelector('parsererror')) doc=parser.parseFromString(xmlText,'text/xml');
  if (doc.querySelector('parsererror')) { toast('Invalid XML'); return; }
 
  var ch=doc.querySelector('channel')||doc.querySelector('feed');
  if (!ch) { toast('No RSS/Atom feed found'); return; }
  if (feeds.find(function(f){return f.url===sourceUrl;})) { toast('Station already added'); return; }
 
  var name = gTagTxt(ch,'title') || fallbackName;
  var chArt = gTagAttr(ch,'itunes:image','href');
  if (!chArt) { var imgEl=ch.getElementsByTagName('image')[0]; if(imgEl) chArt=gTagTxt(imgEl,'url'); }
  chArt = chArt || '';
 
  var nodes = Array.from(doc.querySelectorAll('item,entry'));
  var items = nodes.map(function(el,i) {
    var title = (el.getElementsByTagName('title')[0]||{}).textContent || ('Item '+(i+1));
    title = title.trim();
    var enc=el.getElementsByTagName('enclosure')[0];
    var encUrl=enc?(enc.getAttribute('url')||''):'';
    var encType=enc?(enc.getAttribute('type')||''):'';
    var linkEl=el.getElementsByTagName('link')[0];
    var linkUrl=linkEl?(linkEl.textContent.trim()||linkEl.getAttribute('href')||''):'';
    var audioUrl=encUrl||linkUrl;
    var isAudio=encType.indexOf('audio')===0||/\.(mp3|m4a|ogg|opus|wav|aac|flac)(\?|$)/i.test(audioUrl);
    var itemArt=gTagAttr(el,'itunes:image','href')||gTagAttr(el,'media:thumbnail','url')||chArt;
    var rawDesc=gTagTxt(el,'itunes:summary')||gTagTxt(el,'description')||gTagTxt(el,'summary')||gTagTxt(el,'content')||'';
    var desc=stripHTML(rawDesc); if(desc.length>280) desc=desc.slice(0,280)+'…';
    var dur=fmtDur(gTagTxt(el,'itunes:duration')||gTagTxt(el,'duration'));
    var date=fmtDate(gTagTxt(el,'pubDate')||gTagTxt(el,'published')||gTagTxt(el,'updated'));
    return {title:title,url:audioUrl,art:itemArt,desc:desc,dur:dur,date:date,isAudio:isAudio,feedName:name,feedId:null};
  });
 
  var feedId='f'+Date.now()+Math.random().toString(36).slice(2,5);
  items.forEach(function(it){it.feedId=feedId;});
  var feed={id:feedId,name:name,url:sourceUrl,art:chArt,items:items};
  feeds.push(feed);
  saveState(); renderFeeds(); selectFeed(feedId);
  toast('✓ "'+name+'" — '+items.length+' items');
}
 
function removeFeed(feedId) {
  var f=feeds.find(function(x){return x.id===feedId;});
  feeds=feeds.filter(function(x){return x.id!==feedId;});
  queue=queue.filter(function(q){return q.feedId!==feedId;});
  if(curIdx>=queue.length) curIdx=queue.length-1;
  if(activeFeedId===feedId){
    activeFeedId=null;
    G('epTitle').textContent='← Select a station';
    G('addAllBtn').style.display='none';
    G('epList').innerHTML='<div class="empty"><div class="empty-ico">🎙</div><div class="empty-ttl">No Episodes</div><div class="empty-sub">Select a station from the left</div></div>';
  }
  saveState(); renderFeeds(); renderQueue();
  toast('Removed "'+(f?f.name:'station')+'"');
}
 
// ─── RENDER: FEEDS ────────────────────────────────────────────────────
function renderFeeds() {
  var el=G('feedList');
  if (!feeds.length) { el.innerHTML='<div class="empty"><div class="empty-ico">📡</div><div class="empty-ttl">No Stations</div><div class="empty-sub">Add an RSS/XML URL<br>or drop a .xml file on the page</div></div>'; return; }
  el.innerHTML='';
  feeds.forEach(function(f) {
    var row=document.createElement('div');
    row.className='feed-row'+(f.id===activeFeedId?' active':'');
    row.innerHTML='<div class="feed-art">'+(f.art?'<img src="'+esc(f.art)+'" onerror="this.style.display=\'none\'" loading="lazy">':'')+'📻</div>'
      +'<div class="feed-meta"><div class="feed-name">'+esc(f.name)+'</div><div class="feed-ct">'+f.items.length+' items</div></div>'
      +'<button class="feed-del" title="Remove">✕</button>';
    row.querySelector('.feed-del').addEventListener('click', function(e){ e.stopPropagation(); removeFeed(f.id); });
    row.addEventListener('click', function(){ selectFeed(f.id); });
    el.appendChild(row);
  });
}
 
function selectFeed(feedId) {
  activeFeedId=feedId;
  var f=feeds.find(function(x){return x.id===feedId;});
  if (!f) return;
  G('epTitle').textContent=f.name;
  G('addAllBtn').style.display='';
  renderFeeds(); renderEpisodes(f.items);
}
 
// ─── RENDER: EPISODES ─────────────────────────────────────────────────
function inQ(item) { return queue.some(function(q){return q.url===item.url&&q.title===item.title;}); }
function isCur(item) { return curIdx>=0&&queue[curIdx]&&queue[curIdx].url===item.url&&queue[curIdx].title===item.title; }
 
function renderEpisodes(items) {
  var el=G('epList');
  if (!items||!items.length) { el.innerHTML='<div class="empty"><div class="empty-ico">📭</div><div class="empty-ttl">No Items</div></div>'; return; }
  el.innerHTML='';
  items.forEach(function(item,i) {
    var inQueue=inQ(item), playing=isCur(item);
    var row=document.createElement('div');
    row.className='ep-row'+(playing?' playing':'')+(inQueue&&!playing?' inq':'');
    row.setAttribute('draggable','true');
    row.innerHTML='<div class="ep-thumb">'+(item.art?'<img src="'+esc(item.art)+'" onerror="this.outerHTML=\'🎵\'" loading="lazy">':'🎵')+'</div>'
      +'<div class="ep-body"><div class="ep-title">'+esc(item.title)+'</div>'
      +'<div class="ep-meta">'+(item.date?'<span>'+esc(item.date)+'</span>':'')+(item.dur?'<span>'+esc(item.dur)+'</span>':'')
      +(!item.isAudio?'<span style="color:var(--amber-lo)">⚠ no audio</span>':'')+'</div>'
      +(item.desc?'<div class="ep-desc">'+esc(item.desc)+'</div>':'')
      +'</div><div class="ep-btns">'
      +'<button class="ep-add'+(inQueue?' done':'')">'+(inQueue?'✓ ADDED':'+ QUEUE')+'</button>'
      +'<button class="ep-play">▶ NOW</button></div>';
 
    row.querySelector('.ep-add').addEventListener('click', function(e){ e.stopPropagation(); addEpToQ(i); });
    row.querySelector('.ep-play').addEventListener('click', function(e){ e.stopPropagation(); playNow(i); });
 
    // Desktop drag
    row.addEventListener('dragstart', function(e){ dnd.type='episode'; dnd.index=i; e.dataTransfer.effectAllowed='copy'; e.dataTransfer.setData('text/plain',String(i)); row.classList.add('drag-src'); });
    row.addEventListener('dragend', function(){ row.classList.remove('drag-src'); });
 
    // Touch drag
    attachTouch(row,'episode',i);
    el.appendChild(row);
  });
}
 
function addEpToQ(i) {
  var f=feeds.find(function(x){return x.id===activeFeedId;}); if(!f)return;
  var item=f.items[i];
  if (inQ(item)) { toast('Already in queue'); return; }
  queue.push(Object.assign({},item));
  renderQueue(); renderEpisodes(f.items); saveState();
  toast('+ '+item.title.slice(0,50));
}
 
function addAll() {
  var f=feeds.find(function(x){return x.id===activeFeedId;}); if(!f)return;
  var added=0;
  f.items.forEach(function(item){ if(!inQ(item)){queue.push(Object.assign({},item));added++;} });
  renderQueue(); renderEpisodes(f.items); saveState();
  toast('Added '+added+' of '+f.items.length+' items');
}
 
function playNow(i) {
  var f=feeds.find(function(x){return x.id===activeFeedId;}); if(!f)return;
  var item=f.items[i];
  if (!item.isAudio||!item.url) { toast('No audio URL'); return; }
  var qi=queue.findIndex(function(q){return q.url===item.url&&q.title===item.title;});
  if (qi>=0) { playAt(qi); return; }
  var ins=curIdx>=0?curIdx+1:queue.length;
  queue.splice(ins,0,Object.assign({},item));
  renderEpisodes(f.items); saveState(); playAt(ins);
}
 
// ─── RENDER: QUEUE ────────────────────────────────────────────────────
function renderQueue() {
  var el=G('qList');
  G('qct').textContent=queue.length+' IN QUEUE';
  if (!queue.length) { el.innerHTML='<div class="empty"><div class="empty-ico">📋</div><div class="empty-ttl">Queue Empty</div><div class="empty-sub">Add episodes or drag them here</div></div>'; return; }
  el.innerHTML='';
  queue.forEach(function(item,i) {
    var row=document.createElement('div');
    row.className='q-row'+(i===curIdx?' cur':'')+(i===selIdx?' sel':'');
    row.setAttribute('draggable','true');
    row.innerHTML='<div class="q-num">'+(i===curIdx?'▶':p2(i+1))+'</div>'
      +'<div class="q-art">'+(item.art?'<img src="'+esc(item.art)+'" onerror="this.outerHTML=\'🎵\'" loading="lazy">':'🎵')+'</div>'
      +'<div class="q-info"><div class="q-title">'+esc(item.title)+'</div><div class="q-feed">'+esc(item.feedName||'')+'</div></div>'
      +'<button class="q-del">✕</button>';
 
    row.querySelector('.q-del').addEventListener('click', function(e){ e.stopPropagation(); removeQ(i); });
    row.addEventListener('click', function(e){ if(e.target.classList.contains('q-del'))return; selIdx=i; renderQueue(); });
    row.addEventListener('dblclick', function(e){ if(e.target.classList.contains('q-del'))return; playAt(i); });
 
    // Desktop drag reorder
    row.addEventListener('dragstart', function(e){ dnd.type='queue'; dnd.index=i; e.dataTransfer.effectAllowed='move'; e.dataTransfer.setData('text/plain',String(i)); row.classList.add('drag-src'); });
    row.addEventListener('dragend', function(){ row.classList.remove('drag-src'); clearDropHighlights(); });
 
    // Touch drag
    attachTouch(row,'queue',i);
    el.appendChild(row);
  });
 
  if (curIdx>=0) { var rows=el.querySelectorAll('.q-row'); if(rows[curIdx]) rows[curIdx].scrollIntoView({block:'nearest',behavior:'smooth'}); }
}
 
function removeQ(i) {
  if(i===curIdx){audio.pause();curIdx=-1;updatePlayerUI();}
  else if(i<curIdx) curIdx--;
  if(selIdx===i) selIdx=-1; else if(selIdx>i) selIdx--;
  queue.splice(i,1);
  renderQueue();
  var f=feeds.find(function(x){return x.id===activeFeedId;}); if(f) renderEpisodes(f.items);
  saveState();
}
 
function clearQ() { audio.pause(); queue=[]; curIdx=-1; selIdx=-1; renderQueue(); updatePlayerUI(); var f=feeds.find(function(x){return x.id===activeFeedId;}); if(f)renderEpisodes(f.items); saveState(); toast('Queue cleared'); }
function shuffleQ() {
  if(queue.length<2)return;
  var cur=curIdx>=0?queue[curIdx]:null, rest=queue.filter(function(_,i){return i!==curIdx;});
  for(var i=rest.length-1;i>0;i--){var j=Math.floor(Math.random()*(i+1));var t=rest[i];rest[i]=rest[j];rest[j]=t;}
  queue=cur?[cur].concat(rest):rest; curIdx=cur?0:-1; selIdx=-1;
  renderQueue(); saveState(); toast('Queue shuffled');
}
function moveUp() { if(selIdx<=0)return; var t=queue[selIdx];queue[selIdx]=queue[selIdx-1];queue[selIdx-1]=t; if(curIdx===selIdx)curIdx--;else if(curIdx===selIdx-1)curIdx++; selIdx--; renderQueue();saveState(); }
function moveDown() { if(selIdx<0||selIdx>=queue.length-1)return; var t=queue[selIdx];queue[selIdx]=queue[selIdx+1];queue[selIdx+1]=t; if(curIdx===selIdx)curIdx++;else if(curIdx===selIdx+1)curIdx--; selIdx++; renderQueue();saveState(); }
 
// ─── DRAG & DROP ──────────────────────────────────────────────────────
var dnd = { type:null, index:null };
var qEl = G('qList');
 
qEl.addEventListener('dragover', function(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = dnd.type==='queue'?'move':'copy';
  clearDropHighlights();
  var tgt=dropTargetAt(e.clientY);
  if (tgt) tgt.classList.add('drop-before'); else qEl.classList.add('drop-end');
  qEl.classList.add('drop-active');
});
qEl.addEventListener('dragleave', function(e){ if(!qEl.contains(e.relatedTarget)){ clearDropHighlights(); } });
qEl.addEventListener('drop', function(e){ e.preventDefault(); clearDropHighlights(); performDrop(dropIndexAt(e.clientY)); });
 
function dropTargetAt(y) { var rows=qEl.querySelectorAll('.q-row'); for(var i=0;i<rows.length;i++){var r=rows[i].getBoundingClientRect();if(y<r.top+r.height/2)return rows[i];} return null; }
function dropIndexAt(y) { var rows=qEl.querySelectorAll('.q-row'); for(var i=0;i<rows.length;i++){var r=rows[i].getBoundingClientRect();if(y<r.top+r.height/2)return i;} return queue.length; }
function clearDropHighlights() { document.querySelectorAll('.drop-before').forEach(function(e){e.classList.remove('drop-before');}); qEl.classList.remove('drop-active','drop-end'); }
 
function performDrop(toIdx) {
  if (dnd.type==='episode') {
    var f=feeds.find(function(x){return x.id===activeFeedId;}); if(!f||dnd.index===null)return;
    var item=f.items[dnd.index]; if(!item)return;
    if(inQ(item)){toast('Already in queue');return;}
    var ins=Math.min(toIdx,queue.length);
    queue.splice(ins,0,Object.assign({},item));
    if(curIdx>=ins) curIdx++;
  } else if (dnd.type==='queue') {
    var from=dnd.index, to=Math.min(toIdx,queue.length-1);
    if(from===to||from===null)return;
    var moved=queue.splice(from,1)[0]; queue.splice(to,0,moved);
    if(curIdx===from) curIdx=to;
    else if(from<curIdx&&to>=curIdx) curIdx--;
    else if(from>curIdx&&to<=curIdx) curIdx++;
  }
  dnd.type=null; dnd.index=null;
  renderQueue();
  var f2=feeds.find(function(x){return x.id===activeFeedId;}); if(f2) renderEpisodes(f2.items);
  saveState();
}
 
// ─── TOUCH DRAG ───────────────────────────────────────────────────────
var td = { active:false, type:null, index:null, ghost:null, holdTimer:null };
 
function attachTouch(el, type, index) {
  el.addEventListener('touchstart', function(e) {
    var t=e.touches[0];
    td.holdTimer=setTimeout(function(){
      td.active=true; td.type=type; td.index=index;
      var g=document.createElement('div'); g.className='dnd-ghost';
      var titleEl=el.querySelector('.ep-title,.q-title'); g.textContent=titleEl?titleEl.textContent:'…';
      document.body.appendChild(g); td.ghost=g;
      moveTouchGhost(t.clientX,t.clientY);
    },300);
  },{passive:true});
 
  el.addEventListener('touchmove', function(e) {
    clearTimeout(td.holdTimer);
    if(!td.active) return;
    e.preventDefault();
    var t=e.touches[0];
    moveTouchGhost(t.clientX,t.clientY);
    // highlight
    clearDropHighlights();
    var qr=qEl.getBoundingClientRect();
    if(t.clientX>=qr.left&&t.clientX<=qr.right&&t.clientY>=qr.top&&t.clientY<=qr.bottom){
      var tgt=dropTargetAt(t.clientY);
      if(tgt) tgt.classList.add('drop-before'); else qEl.classList.add('drop-end');
      qEl.classList.add('drop-active');
    }
  },{passive:false});
 
  el.addEventListener('touchend', function(e) {
    clearTimeout(td.holdTimer);
    if(!td.active){td.active=false;return;}
    if(td.ghost){td.ghost.remove();td.ghost=null;}
    clearDropHighlights();
    var t=e.changedTouches[0];
    var qr=qEl.getBoundingClientRect();
    if(t.clientX>=qr.left&&t.clientX<=qr.right&&t.clientY>=qr.top&&t.clientY<=qr.bottom){
      dnd.type=td.type; dnd.index=td.index;
      performDrop(dropIndexAt(t.clientY));
    }
    td.active=false; td.type=null; td.index=null;
  },{passive:true});
}
 
function moveTouchGhost(x,y) { if(!td.ghost)return; td.ghost.style.left=(x+14)+'px'; td.ghost.style.top=(y-28)+'px'; }
 
// ─── PLAYBACK ─────────────────────────────────────────────────────────
function playAt(i) {
  if(i<0||i>=queue.length)return;
  var item=queue[i];
  if(!item.url){toast('No audio URL — skipping');setTimeout(nextTrack,800);return;}
  curIdx=i; audio.src=item.url; audio.load();
  audio.play().catch(function(){toast('Tap ▶ to start');});
  updatePlayerUI(); renderQueue();
  var f=feeds.find(function(x){return x.id===activeFeedId;}); if(f)renderEpisodes(f.items);
  saveState();
}
 
function togglePlay() {
  if (audio.paused) {
    if (!audio.src||audio.src===window.location.href) { if(queue.length)playAt(0); return; }
    audio.play().catch(function(){toast('Tap ▶ to start');});
  } else { audio.pause(); }
}
function prevTrack() { if(audio.currentTime>4){audio.currentTime=0;return;} if(curIdx>0)playAt(curIdx-1); }
function nextTrack() { if(curIdx<queue.length-1)playAt(curIdx+1); else{audio.pause();toast('End of queue');} }
function skip(s) { audio.currentTime=Math.max(0,Math.min(audio.duration||0,audio.currentTime+s)); }
function seek(e) { if(!audio.duration)return; var pct=Math.max(0,Math.min(1,e.offsetX/e.currentTarget.clientWidth)); audio.currentTime=pct*audio.duration; }
function setVol(v) { audio.volume=v; G('volPct').textContent=Math.round(v*100)+'%'; }
function setSpd(v) { audio.playbackRate=parseFloat(v); }
 
function updatePlayerUI() {
  var item=(curIdx>=0&&curIdx<queue.length)?queue[curIdx]:null;
  G('npTitle').textContent=item?item.title:'Nothing playing';
  G('npFeed').textContent=item?(item.feedName||'—'):'—';
  var a=G('npArt');
  if(item&&item.art){a.innerHTML='<img src="'+esc(item.art)+'" onerror="this.outerHTML=\'🎵\'" loading="lazy">';}
  else{a.innerHTML='🎵';}
}
 
audio.addEventListener('timeupdate',function(){if(!audio.duration)return;G('progFill').style.width=(audio.currentTime/audio.duration*100)+'%';G('curT').textContent=fmtTime(audio.currentTime);});
audio.addEventListener('loadedmetadata',function(){G('totT').textContent=fmtTime(audio.duration);});
audio.addEventListener('play',function(){G('playBtn').textContent='⏸';G('npArt').classList.add('playing');G('sdot').className='dot live';G('stxt').textContent='PLAYING';});
audio.addEventListener('pause',function(){G('playBtn').textContent='▶';G('npArt').classList.remove('playing');G('sdot').className='dot';G('stxt').textContent='PAUSED';});
audio.addEventListener('ended',function(){G('sdot').className='dot';G('stxt').textContent='IDLE';if(G('autoAdv').checked)setTimeout(nextTrack,600);});
audio.addEventListener('error',function(){if(audio.src&&audio.src!==window.location.href){toast('Audio error — trying next');if(G('autoAdv').checked)setTimeout(nextTrack,1500);}});
 
// ─── SAVE / LOAD ──────────────────────────────────────────────────────
function saveState() { try{localStorage.setItem('qw_v3',JSON.stringify({feeds:feeds,queue:queue}));}catch(e){} }
 
function loadState() {
  try {
    var raw=localStorage.getItem('qw_v3'); if(!raw)return;
    var s=JSON.parse(raw); feeds=s.feeds||[]; queue=s.queue||[]; curIdx=-1;selIdx=-1;
    activeFeedId=feeds.length?feeds[0].id:null;
    renderFeeds(); renderQueue();
    if(activeFeedId){var f=feeds.find(function(x){return x.id===activeFeedId;});if(f){G('epTitle').textContent=f.name;G('addAllBtn').style.display='';renderEpisodes(f.items);}}
    if(feeds.length) toast('Restored '+feeds.length+' station'+(feeds.length>1?'s':''));
  } catch(e){ console.warn('State restore failed:',e); }
}
 
function exportJSON() {
  var blob=new Blob([JSON.stringify({version:3,savedAt:new Date().toISOString(),feeds:feeds,queue:queue},null,2)],{type:'application/json'});
  var a=document.createElement('a'); a.href=URL.createObjectURL(blob);
  a.download='queuewave-'+new Date().toISOString().slice(0,10)+'.json';
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(function(){URL.revokeObjectURL(a.href);},1000);
  toast('Saved!');
}
 
function importJSON(evt) {
  var file=evt.target.files[0]; if(!file)return; evt.target.value='';
  var r=new FileReader();
  r.onload=function(e){
    try {
      var data=JSON.parse(e.target.result);
      if(!Array.isArray(data.feeds)){toast('Invalid save file');return;}
      feeds=data.feeds; queue=data.queue||[]; curIdx=-1;selIdx=-1;
      activeFeedId=feeds.length?feeds[0].id:null;
      saveState(); renderFeeds(); renderQueue(); updatePlayerUI();
      if(activeFeedId){var f=feeds.find(function(x){return x.id===activeFeedId;});if(f){G('epTitle').textContent=f.name;G('addAllBtn').style.display='';renderEpisodes(f.items);}}
      toast('Loaded '+feeds.length+' stations, '+queue.length+' queued');
    } catch(err){toast('Error: '+err.message);}
  };
  r.readAsText(file);
}
 
// ─── KEYBOARD ─────────────────────────────────────────────────────────
document.addEventListener('keydown',function(e){
  var tag=e.target.tagName; if(tag==='INPUT'||tag==='SELECT'||tag==='TEXTAREA')return;
  if(e.code==='Space'){e.preventDefault();togglePlay();}
  if(e.code==='ArrowRight'&&!e.shiftKey) skip(30);
  if(e.code==='ArrowLeft' &&!e.shiftKey) skip(-15);
  if(e.code==='ArrowRight'&&e.shiftKey)  nextTrack();
  if(e.code==='ArrowLeft' &&e.shiftKey)  prevTrack();
  if(e.code==='KeyB')      enterBlackout();
  if(e.code==='Escape')    exitBlackout();
  if(e.code==='ArrowUp'  &&e.shiftKey){e.preventDefault();moveUp();}
  if(e.code==='ArrowDown'&&e.shiftKey){e.preventDefault();moveDown();}
});
 
// ─── FILE DROP ON PAGE ────────────────────────────────────────────────
document.addEventListener('dragover',function(e){if(!qEl.contains(e.target))e.preventDefault();});
document.addEventListener('drop',function(e){
  if(qEl.contains(e.target))return;
  e.preventDefault();
  var file=e.dataTransfer.files[0]; if(!file)return;
  var r=new FileReader();
  r.onload=function(ev){
    if(file.name.endsWith('.json')){
      try{
        var data=JSON.parse(ev.target.result);
        if(!Array.isArray(data.feeds)){toast('Invalid save file');return;}
        feeds=data.feeds;queue=data.queue||[];curIdx=-1;selIdx=-1;
        activeFeedId=feeds.length?feeds[0].id:null;
        saveState();renderFeeds();renderQueue();updatePlayerUI();
        if(activeFeedId){var f=feeds.find(function(x){return x.id===activeFeedId;});if(f){G('epTitle').textContent=f.name;G('addAllBtn').style.display='';renderEpisodes(f.items);}}
        toast('Loaded '+feeds.length+' stations');
      }catch(err){toast('Error: '+err.message);}
    } else {
      parseFeed(ev.target.result,file.name.replace(/\.[^.]+$/,''),'__local__:'+file.name);
    }
  };
  r.readAsText(file);
});
 
// ─── INIT ─────────────────────────────────────────────────────────────
loadState();