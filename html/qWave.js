'use strict';

// ══════════════════════════════════════════════════════════════
//  UTILS
// ══════════════════════════════════════════════════════════════

const id = s => document.getElementById(s);
const esc = s => String(s||'')
  .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

function gTag(el, ...tags) {
  for (const t of tags) {
    const found = el.getElementsByTagName(t)[0];
    if (found) return found;
  }
  return null;
}
function gTxt(el, ...tags) { return gTag(el,...tags)?.textContent?.trim() || ''; }
function gAttr(el, tag, attr) { return el.getElementsByTagName(tag)[0]?.getAttribute(attr) || ''; }

function stripHTML(html) {
  if (!html) return '';
  const d = document.createElement('div');
  d.innerHTML = html;
  return (d.textContent || d.innerText || '').replace(/\s+/g,' ').trim();
}
function fmtTime(s) {
  if (!s || isNaN(s) || s < 0) return '0:00';
  const h=Math.floor(s/3600), m=Math.floor((s%3600)/60), sc=Math.floor(s%60);
  return h > 0 ? `${h}:${p2(m)}:${p2(sc)}` : `${m}:${p2(sc)}`;
}
function p2(n) { return String(n).padStart(2,'0'); }
function fmtDur(raw) {
  if (!raw) return '';
  if (/^\d{1,2}:\d{2}/.test(raw)) return raw;
  const n = parseInt(raw);
  return (!isNaN(n) && n > 0) ? fmtTime(n) : raw;
}
function fmtDate(raw) {
  if (!raw) return '';
  try {
    return new Date(raw).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'});
  } catch { return ''; }
}

let toastTimer;
function toast(msg) {
  const el = id('toast');
  el.textContent = msg;
  el.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('on'), 3200);
}

// ══════════════════════════════════════════════════════════════
//  STATE
// ══════════════════════════════════════════════════════════════
let feeds = [];          // {id,name,url,art,items:[...]}
let queue = [];          // episode objects
let curIdx = -1;         // current playing index in queue
let selIdx = -1;         // selected queue item
let activeFeedId = null; // which feed panel is showing

const audio = id('audio');
// ── DYNAMICS COMPRESSOR (ad limiter) ─────────────────────────────────
let _audioCtx, _compressor, _gainNode, _srcNode;

function initCompressor() {
  if (_audioCtx) {
    // Already set up — just make sure context isn't suspended
    if (_audioCtx.state === 'suspended') _audioCtx.resume();
    return;
  }
  try {
    _audioCtx   = new (window.AudioContext || window.webkitAudioContext)();
    _srcNode    = _audioCtx.createMediaElementSource(audio);
    _compressor = _audioCtx.createDynamicsCompressor();
    _gainNode   = _audioCtx.createGain();

    _compressor.threshold.value = -24;
    _compressor.knee.value      =  6;
    _compressor.ratio.value     = 12;
    _compressor.attack.value    =  0.003;
    _compressor.release.value   =  0.5;
    _gainNode.gain.value        =  1.1;

    _srcNode.connect(_compressor);
    _compressor.connect(_gainNode);
    _gainNode.connect(_audioCtx.destination);

    if (_audioCtx.state === 'suspended') _audioCtx.resume();
  } catch(e) {
    console.warn('Web Audio init failed, falling back to direct playback:', e);
    _audioCtx = null; // flag so we don't retry broken state
  }
}

function resumeAndPlay() {
  const doPlay = () => audio.play().catch(() => toast('Tap ▶ to start'));
  if (_audioCtx && _audioCtx.state === 'suspended') {
    _audioCtx.resume().then(doPlay);
  } else {
    doPlay();
  }
}
// ══════════════════════════════════════════════════════════════
//  BLACKOUT
// ══════════════════════════════════════════════════════════════
function enterBlackout() {
  id('blackout').classList.add('on');
}
function exitBlackout() {
  id('blackout').classList.remove('on');
}

// ══════════════════════════════════════════════════════════════
//  FETCH + PROXY CHAIN
// ══════════════════════════════════════════════════════════════
const PROXIES = [
  u => u,
  u => `https://corsproxy.io/?url=${encodeURIComponent(u)}`,
  u => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
];

async function fetchFeed(url) {
  let lastErr;
  for (const proxy of PROXIES) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 12000);
      const r = await fetch(proxy(url), { signal: ctrl.signal });
      clearTimeout(timer);
      if (!r.ok) continue;
      const txt = await r.text();
      if (txt.trim().startsWith('<')) return txt;
    } catch(e) { lastErr = e; }
  }
  throw new Error(lastErr?.message || 'All proxies failed');
}

// ══════════════════════════════════════════════════════════════
//  XML PARSING
// ══════════════════════════════════════════════════════════════
function parseXML(xmlText) {
  const p = new DOMParser();
  let doc = p.parseFromString(xmlText, 'application/xml');
  if (doc.querySelector('parsererror')) {
    doc = p.parseFromString(xmlText, 'text/xml');
    if (doc.querySelector('parsererror')) return null;
  }
  return doc;
}

function parseFeed(xmlText, fallbackName, sourceUrl) {
  const doc = parseXML(xmlText);
  if (!doc) { toast('Invalid XML — cannot parse'); return; }

  const ch = doc.querySelector('channel') || doc.querySelector('feed');
  if (!ch) { toast('No RSS channel or Atom feed found'); return; }

  // Deduplicate
  if (feeds.find(f => f.url === sourceUrl)) { toast('Station already added'); return; }

  // Feed-level metadata
  const name = gTxt(ch,'title') || fallbackName;
  const channelArt =
    gAttr(ch,'itunes:image','href') ||
    gAttr(ch,'itunes:image','url') ||
    (() => { const img = gTag(ch,'image'); return img ? gTxt(img,'url') : ''; })() ||
    '';

  // Parse items / entries
  const nodes = [...doc.querySelectorAll('item, entry')];
  const items = nodes.map((el, i) => {
    const title = gTxt(el,'title') || `Item ${i+1}`;

    // Audio URL from enclosure, then link
    const enc = gTag(el,'enclosure');
    const encUrl = enc?.getAttribute('url') || '';
    const encType = enc?.getAttribute('type') || '';
    const linkUrl = gTxt(el,'link') || el.querySelector('link')?.getAttribute('href') || '';
    const audioUrl = encUrl || linkUrl;
    const isAudio = encType.startsWith('audio') ||
      /\.(mp3|m4a|ogg|opus|wav|aac|flac)(\?|$)/i.test(audioUrl);

    // Artwork: item-level first, then fall back to channel art
    const itemArt =
      gAttr(el,'itunes:image','href') ||
      gAttr(el,'itunes:image','url') ||
      gAttr(el,'media:thumbnail','url') ||
      (() => {
        const mc = gTag(el,'media:content');
        const mt = mc?.getAttribute('type') || '';
        return mt.startsWith('image') ? (mc?.getAttribute('url') || '') : '';
      })() ||
      channelArt;

    // Description — strip HTML
    const rawDesc =
      gTxt(el,'itunes:summary') ||
      gTxt(el,'description') ||
      gTxt(el,'summary') ||
      gTxt(el,'content') || '';
    const desc = stripHTML(rawDesc).slice(0, 280);

    const dur = fmtDur(gTxt(el,'itunes:duration','duration'));
    const date = fmtDate(gTxt(el,'pubDate','published','updated'));

    return { title, url: audioUrl, art: itemArt, desc, dur, date,
             isAudio, feedName: name, feedId: null };
  });

  const feedId = 'f' + Date.now() + Math.random().toString(36).slice(2,5);
  items.forEach(it => it.feedId = feedId);

  const feed = { id: feedId, name, url: sourceUrl, art: channelArt, items };
  feeds.push(feed);
  saveState();
  renderFeeds();
  selectFeed(feedId);
  toast(`✓ "${name}" — ${items.length} item${items.length!==1?'s':''}`);
}

// ══════════════════════════════════════════════════════════════
//  ADD FEED UI
// ══════════════════════════════════════════════════════════════
function toggleForm() {
  const f = id('addForm');
  f.classList.toggle('open');
  if (f.classList.contains('open')) id('urlInput').focus();
}

async function doURL() {
  const url = id('urlInput').value.trim();
  if (!url) { toast('Enter a URL'); return; }
  id('urlInput').value = '';
  toggleForm();
  id('epList').innerHTML = '<div class="loading"><div class="spin"></div>FETCHING FEED…</div>';
  try {
    const txt = await fetchFeed(url);
    parseFeed(txt, url, url);
  } catch(e) {
    toast('Failed: ' + e.message);
    id('epList').innerHTML = '<div class="empty"><div class="empty-ico">⚠</div><div class="empty-ttl">Load Failed</div><div class="empty-sub">Check the URL or try again</div></div>';
  }
}

async function doFile(evt) {
  const file = evt.target.files[0];
  if (!file) return;
  evt.target.value = '';
  const txt = await file.text();
  toggleForm();
  parseFeed(txt, file.name.replace(/\.[^.]+$/,''), '__local__:'+file.name);
}

function removeFeed(feedId, e) {
  e.stopPropagation();
  const f = feeds.find(x => x.id === feedId);
  feeds = feeds.filter(x => x.id !== feedId);
  queue = queue.filter(q => q.feedId !== feedId);
  if (curIdx >= queue.length) curIdx = queue.length - 1;
  if (activeFeedId === feedId) {
    activeFeedId = null;
    id('epTitle').textContent = '← Select a station';
    id('addAllBtn').style.display = 'none';
    id('epList').innerHTML = '<div class="empty"><div class="empty-ico">🎙</div><div class="empty-ttl">No Episodes</div><div class="empty-sub">Select a station from the left</div></div>';
  }
  saveState();
  renderFeeds();
  renderQueue();
  toast(`Removed "${f?.name||'station'}"`);
}

// ══════════════════════════════════════════════════════════════
//  RENDER: FEEDS
// ══════════════════════════════════════════════════════════════
function renderFeeds() {
  const el = id('feedList');
  if (!feeds.length) {
    el.innerHTML = '<div class="empty"><div class="empty-ico">📡</div><div class="empty-ttl">No Stations</div><div class="empty-sub">Add an RSS/XML URL<br>or drag a .xml file here</div></div>';
    return;
  }
  el.innerHTML = feeds.map(f => `
    <div class="feed-row${f.id===activeFeedId?' active':''}" onclick="selectFeed('${f.id}')">
      <div class="feed-art">
        ${f.art
          ? `<img src="${esc(f.art)}" onerror="this.style.display='none';this.nextElementSibling.style.display=''" loading="lazy"><span style="display:none">📻</span>`
          : '📻'}
      </div>
      <div class="feed-meta">
        <div class="feed-name">${esc(f.name)}</div>
        <div class="feed-ct">${f.items.length} items</div>
      </div>
      <button class="feed-del" onclick="removeFeed('${f.id}',event)" title="Remove station">✕</button>
    </div>`).join('');
}

function selectFeed(feedId) {
  activeFeedId = feedId;
  const f = feeds.find(x => x.id === feedId);
  if (!f) return;
  id('epTitle').textContent = f.name;
  id('addAllBtn').style.display = '';
  renderFeeds();
  renderEpisodes(f.items);
}

// ══════════════════════════════════════════════════════════════
//  RENDER: EPISODES
// ══════════════════════════════════════════════════════════════
function inQueue(item) {
  return queue.some(q => q.url === item.url && q.title === item.title);
}
function isPlaying(item) {
  if (curIdx < 0 || !queue[curIdx]) return false;
  return queue[curIdx].url === item.url && queue[curIdx].title === item.title;
}

function renderEpisodes(items) {
  const el = id('epList');
  if (!items.length) {
    el.innerHTML = '<div class="empty"><div class="empty-ico">📭</div><div class="empty-ttl">No Items</div></div>';
    return;
  }
  el.innerHTML = items.map((item, i) => {
    const inQ = inQueue(item), playing = isPlaying(item);
    const artHTML = item.art
      ? `<img src="${esc(item.art)}" onerror="this.outerHTML='🎵'" loading="lazy">`
      : '🎵';
    return `<div class="ep-row${playing?' playing':''}${inQ&&!playing?' inq':''}" data-i="${i}">
      <div class="ep-thumb">${artHTML}</div>
      <div class="ep-body">
        <div class="ep-title">${esc(item.title)}</div>
        <div class="ep-meta">
          ${item.date?`<span>${esc(item.date)}</span>`:''}
          ${item.dur?`<span>${esc(item.dur)}</span>`:''}
          ${!item.isAudio?`<span style="color:var(--amber-lo)">⚠ no audio</span>`:''}
        </div>
        ${item.desc?`<div class="ep-desc">${esc(item.desc)}</div>`:''}
      </div>
      <div class="ep-btns">
        <button class="ep-add${inQ?' done':''}" onclick="addEpToQ(event,${i})">${inQ?'✓ ADDED':'+ QUEUE'}</button>
        <button class="ep-play" onclick="playNow(event,${i})">▶ NOW</button>
      </div>
    </div>`;
  }).join('');
  el.innerHTML = items.map( ... ).join('');
  el.querySelectorAll('.ep-row').forEach((row, i) => attachEpisodeDrag(row, i)); // ← ADD
}

function addEpToQ(e, i) {
  e.stopPropagation();
  const f = feeds.find(x => x.id === activeFeedId);
  if (!f) return;
  const item = f.items[i];
  if (inQueue(item)) { toast('Already in queue'); return; }
  queue.push({...item});
  renderQueue();
  renderEpisodes(f.items);
  saveState();
  toast(`+ ${item.title.slice(0,48)}${item.title.length>48?'…':''}`);
}

function addAll() {
  const f = feeds.find(x => x.id === activeFeedId);
  if (!f) return;
  let added = 0;
  f.items.forEach(item => {
    if (!inQueue(item)) { queue.push({...item}); added++; }
  });
  renderQueue();
  renderEpisodes(f.items);
  saveState();
  toast(`Added ${added} of ${f.items.length} items`);
}

function playNow(e, i) {
  e.stopPropagation();
  const f = feeds.find(x => x.id === activeFeedId);
  if (!f) return;
  const item = f.items[i];
  if (!item.isAudio || !item.url) { toast('No audio URL for this item'); return; }
  const qi = queue.findIndex(q => q.url===item.url && q.title===item.title);
  if (qi >= 0) {
    playAt(qi);
  } else {
    const ins = curIdx >= 0 ? curIdx + 1 : queue.length;
    queue.splice(ins, 0, {...item});
    renderEpisodes(f.items);
    saveState();
    playAt(ins);
  }
}

// ══════════════════════════════════════════════════════════════
//  RENDER: QUEUE
// ══════════════════════════════════════════════════════════════
function renderQueue() {
  const el = id('qList');
  id('qct').textContent = queue.length + ' IN QUEUE';
  if (!queue.length) {
    el.innerHTML = '<div class="empty"><div class="empty-ico">📋</div><div class="empty-ttl">Queue Empty</div><div class="empty-sub">Add episodes to build<br>your custom queue</div></div>';
    return;
  }
  el.innerHTML = queue.map((item,i) => {
    const artHTML = item.art
      ? `<img src="${esc(item.art)}" onerror="this.outerHTML='🎵'" loading="lazy">`
      : '🎵';
    return `<div class="q-row${i===curIdx?' cur':''}${i===selIdx?' sel':''}" onclick="selectQ(${i})" ondblclick="playAt(${i})">
      <div class="q-num">${i===curIdx?'▶':p2(i+1)}</div>
      <div class="q-art">${artHTML}</div>
      <div class="q-info">
        <div class="q-title">${esc(item.title)}</div>
        <div class="q-feed">${esc(item.feedName||'')}</div>
      </div>
      <button class="q-del" onclick="removeQ(event,${i})">✕</button>
    </div>`;
  }).join('');
  el.innerHTML = queue.map( ... ).join('');
  el.querySelectorAll('.q-row').forEach((row, i) => attachQueueDrag(row, i)); // ← ADD
  // Scroll current into view
  if (curIdx >= 0) {
    const rows = el.querySelectorAll('.q-row');
    rows[curIdx]?.scrollIntoView({block:'nearest',behavior:'smooth'});
  }
}

function selectQ(i) { selIdx = i; renderQueue(); }

function removeQ(e, i) {
  e.stopPropagation();
  if (i === curIdx) {
    audio.pause();
    curIdx = -1;
    updatePlayerUI();
  } else if (i < curIdx) {
    curIdx--;
  }
  if (selIdx === i) selIdx = -1;
  else if (selIdx > i) selIdx--;
  queue.splice(i, 1);
  renderQueue();
  const f = feeds.find(x => x.id === activeFeedId);
  if (f) renderEpisodes(f.items);
  saveState();
}

function clearQ() {
  audio.pause();
  queue = []; curIdx = -1; selIdx = -1;
  renderQueue();
  updatePlayerUI();
  const f = feeds.find(x => x.id === activeFeedId);
  if (f) renderEpisodes(f.items);
  saveState();
  toast('Queue cleared');
}

function shuffleQ() {
  if (queue.length < 2) return;
  const cur = curIdx >= 0 ? queue[curIdx] : null;
  const rest = queue.filter((_,i) => i !== curIdx);
  for (let i = rest.length-1; i > 0; i--) {
    const j = Math.floor(Math.random()*(i+1));
    [rest[i],rest[j]] = [rest[j],rest[i]];
  }
  queue = cur ? [cur,...rest] : rest;
  curIdx = cur ? 0 : -1; selIdx = -1;
  renderQueue(); saveState(); toast('Queue shuffled');
}

function moveUp() {
  if (selIdx <= 0) return;
  [queue[selIdx], queue[selIdx-1]] = [queue[selIdx-1], queue[selIdx]];
  if (curIdx === selIdx) curIdx--;
  else if (curIdx === selIdx-1) curIdx++;
  selIdx--;
  renderQueue(); saveState();
}
function moveDown() {
  if (selIdx < 0 || selIdx >= queue.length-1) return;
  [queue[selIdx], queue[selIdx+1]] = [queue[selIdx+1], queue[selIdx]];
  if (curIdx === selIdx) curIdx++;
  else if (curIdx === selIdx+1) curIdx--;
  selIdx++;
  renderQueue(); saveState();
}

// ══════════════════════════════════════════════════════════════
//  PLAYBACK
// ══════════════════════════════════════════════════════════════
function playAt(i) {
  if (i < 0 || i >= queue.length) return;
  const item = queue[i];
  if (!item.url) { toast('No audio URL — skipping'); setTimeout(nextTrack, 800); return; }
  //initCompressor();
  curIdx = i;
  audio.src = item.url;
  audio.load();
  resumeAndPlay();
  updatePlayerUI();
  renderQueue();
  const f = feeds.find(x => x.id === activeFeedId);
  if (f) renderEpisodes(f.items);
  saveState();
}

function togglePlay() {
  if (audio.paused) {
    if (!audio.src) { if (queue.length) playAt(0); return; }
    audio.play().catch(() => toast('Playback error'));
  } else {
    audio.pause();
  }
}

function prevTrack() {
  if (audio.currentTime > 4) { audio.currentTime = 0; return; }
  if (curIdx > 0) playAt(curIdx - 1);
}
function nextTrack() {
  if (curIdx < queue.length - 1) playAt(curIdx + 1);
  else { audio.pause(); toast('End of queue'); }
}
function skip(sec) {
  audio.currentTime = Math.max(0, Math.min(audio.duration||0, audio.currentTime + sec));
}
function seek(e) {
  if (!audio.duration) return;
  const pct = Math.max(0, Math.min(1, e.offsetX / e.currentTarget.clientWidth));
  audio.currentTime = pct * audio.duration;
}
function setVol(v) {
  audio.volume = v;
  id('volPct').textContent = Math.round(v*100)+'%';
}
function setSpd(v) { audio.playbackRate = parseFloat(v); }

function updatePlayerUI() {
  const item = (curIdx >= 0 && curIdx < queue.length) ? queue[curIdx] : null;
  id('npTitle').textContent = item ? item.title : 'Nothing playing';
  id('npFeed').textContent = item ? (item.feedName || '—') : '—';
  const artEl = id('npArt');
  if (item?.art) {
    artEl.innerHTML = `<img src="${esc(item.art)}" onerror="this.outerHTML='🎵'" loading="lazy">`;
  } else {
    artEl.innerHTML = '🎵';
  }
}

// Audio event listeners
audio.addEventListener('timeupdate', () => {
  if (!audio.duration) return;
  const pct = (audio.currentTime / audio.duration) * 100;
  id('progFill').style.width = pct + '%';
  id('curT').textContent = fmtTime(audio.currentTime);
});
audio.addEventListener('loadedmetadata', () => {
  id('totT').textContent = fmtTime(audio.duration);
});
audio.addEventListener('play', () => {
  id('playBtn').textContent = '⏸';
  id('npArt').classList.add('playing');
  id('sdot').className = 'dot live';
  id('stxt').textContent = 'PLAYING';
});
audio.addEventListener('pause', () => {
  id('playBtn').textContent = '▶';
  id('npArt').classList.remove('playing');
  id('sdot').className = 'dot';
  id('stxt').textContent = 'PAUSED';
});
audio.addEventListener('ended', () => {
  id('sdot').className = 'dot';
  id('stxt').textContent = 'IDLE';
  if (id('autoAdv').checked) setTimeout(nextTrack, 600);
});
audio.addEventListener('error', (e) => {
  if (audio.src) { // Only if we actually tried to load something
    toast('Audio error — trying next item');
    if (id('autoAdv').checked) setTimeout(nextTrack, 1500);
  }
});

// ══════════════════════════════════════════════════════════════
//  SAVE / LOAD
// ══════════════════════════════════════════════════════════════
function saveState() {
  try {
    localStorage.setItem('qw2_state', JSON.stringify({ feeds, queue, curIdx }));
  } catch(e) {
    // localStorage quota exceeded — silently continue, user can still export
  }
}

function loadState() {
  try {
    const raw = localStorage.getItem('qw2_state');
    if (!raw) return false;
    const s = JSON.parse(raw);
    feeds = s.feeds || [];
    queue = s.queue || [];
    curIdx = -1; // Don't auto-resume (can't resume audio state from localStorage)
    selIdx = -1;
    // Restore active feed to first feed if any
    if (feeds.length) activeFeedId = feeds[0].id;
    renderFeeds();
    renderQueue();
    if (activeFeedId) {
      const f = feeds.find(x => x.id === activeFeedId);
      if (f) {
        id('epTitle').textContent = f.name;
        id('addAllBtn').style.display = '';
        renderEpisodes(f.items);
      }
    }
    if (feeds.length) toast(`Restored ${feeds.length} station${feeds.length>1?'s':''} from last session`);
    return true;
  } catch(e) {
    console.warn('Could not restore state:', e);
    return false;
  }
}

function exportJSON() {
  const data = { version: 2, savedAt: new Date().toISOString(), feeds, queue };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `queuewave-${new Date().toISOString().slice(0,10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  toast('Saved to queuewave-*.json');
}

async function importJSON(evt) {
  const file = evt.target.files[0];
  if (!file) return;
  evt.target.value = '';
  try {
    const data = JSON.parse(await file.text());
    if (!Array.isArray(data.feeds)) { toast('Invalid save file'); return; }
    feeds = data.feeds;
    queue = data.queue || [];
    curIdx = -1; selIdx = -1;
    activeFeedId = feeds[0]?.id || null;
    saveState();
    renderFeeds();
    renderQueue();
    updatePlayerUI();
    if (activeFeedId) {
      const f = feeds.find(x => x.id === activeFeedId);
      if (f) {
        id('epTitle').textContent = f.name;
        id('addAllBtn').style.display = '';
        renderEpisodes(f.items);
      }
    }
    toast(`Loaded ${feeds.length} station${feeds.length>1?'s':''}, ${queue.length} queued`);
  } catch(e) {
    toast('Error reading file: ' + e.message);
  }
}

// ══════════════════════════════════════════════════════════════
//  KEYBOARD SHORTCUTS
// ══════════════════════════════════════════════════════════════
document.addEventListener('keydown', e => {
  const tag = e.target.tagName;
  if (tag==='INPUT'||tag==='SELECT'||tag==='TEXTAREA') return;
  switch(e.code) {
    case 'Space':       e.preventDefault(); togglePlay(); break;
    case 'ArrowRight':  e.shiftKey ? nextTrack() : skip(30); break;
    case 'ArrowLeft':   e.shiftKey ? prevTrack() : skip(-15); break;
    case 'KeyB':        enterBlackout(); break;
    case 'Escape':      exitBlackout(); break;
    case 'ArrowUp':     if(e.shiftKey){e.preventDefault();moveUp();} break;
    case 'ArrowDown':   if(e.shiftKey){e.preventDefault();moveDown();} break;
  }
});

// ══════════════════════════════════════════════════════════════
//  DRAG & DROP (xml / json files anywhere on page)
// ══════════════════════════════════════════════════════════════
let dragCount = 0;
document.addEventListener('dragenter', e => { e.preventDefault(); dragCount++; document.body.classList.add('dragging'); });
document.addEventListener('dragleave', () => { dragCount--; if (!dragCount) document.body.classList.remove('dragging'); });
document.addEventListener('dragover', e => e.preventDefault());
document.addEventListener('drop', async e => {
  e.preventDefault(); dragCount = 0; document.body.classList.remove('dragging');
  const file = e.dataTransfer.files[0];
  if (!file) return;
  const txt = await file.text();
  if (file.name.endsWith('.json')) {
    const fakeEvt = { target: { files: [{ text: ()=>Promise.resolve(txt), name: file.name }], value:'' } };
    // Re-implement directly to avoid the fakeEvt complexity
    try {
      const data = JSON.parse(txt);
      if (!Array.isArray(data.feeds)) { toast('Invalid save file'); return; }
      feeds = data.feeds; queue = data.queue||[]; curIdx=-1; selIdx=-1;
      activeFeedId = feeds[0]?.id||null; saveState(); renderFeeds(); renderQueue(); updatePlayerUI();
      if(activeFeedId){const f=feeds.find(x=>x.id===activeFeedId);if(f){id('epTitle').textContent=f.name;id('addAllBtn').style.display='';renderEpisodes(f.items);}}
      toast(`Loaded ${feeds.length} station${feeds.length>1?'s':''}`);
    } catch(err){ toast('Error: '+err.message); }
  } else {
    parseFeed(txt, file.name.replace(/\.[^.]+$/,''), '__local__:'+file.name);
  }
});
// ══════════════════════════════════════════════════════════════
//  DRAG & DROP — Episodes → Queue  +  Queue reorder
//  Works with mouse (HTML5 DnD) AND touch (pointer events)
// ══════════════════════════════════════════════════════════════

// ── shared drag state ─────────────────────────────────────────
const drag = {
  type: null,      // 'episode' | 'queue'
  index: null,     // source index
  ghost: null,     // floating clone element
  overIdx: null,   // queue row we're hovering over
};

// ── ghost element for touch drag ──────────────────────────────
function createGhost(sourceEl, clientX, clientY) {
  const g = sourceEl.cloneNode(true);
  const r = sourceEl.getBoundingClientRect();
  Object.assign(g.style, {
    position: 'fixed',
    left: r.left + 'px',
    top:  r.top  + 'px',
    width: r.width + 'px',
    pointerEvents: 'none',
    opacity: '0.75',
    zIndex: '9998',
    background: 'var(--bg3)',
    border: '1px solid var(--amber)',
    transform: 'scale(1.03)',
    transition: 'none',
    boxShadow: '0 8px 24px rgba(0,0,0,.6)',
  });
  document.body.appendChild(g);
  drag.ghost = g;
  drag.offX  = clientX - r.left;
  drag.offY  = clientY - r.top;
}

function moveGhost(clientX, clientY) {
  if (!drag.ghost) return;
  drag.ghost.style.left = (clientX - drag.offX) + 'px';
  drag.ghost.style.top  = (clientY - drag.offY) + 'px';
}

function removeGhost() {
  drag.ghost?.remove();
  drag.ghost = null;
}

// ── highlight a queue drop target ────────────────────────────
function highlightQRow(idx) {
  document.querySelectorAll('.q-row').forEach((r, i) => {
    r.style.borderTop = i === idx ? '2px solid var(--amber)' : '';
  });
}
function clearQHighlight() {
  document.querySelectorAll('.q-row').forEach(r => r.style.borderTop = '');
}

// ── find queue row index from a y coordinate ──────────────────
function qRowAtY(y) {
  const rows = [...document.querySelectorAll('.q-row')];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i].getBoundingClientRect();
    if (y < r.bottom) return i;
  }
  return rows.length; // drop at end
}

// ── perform the drop ──────────────────────────────────────────
function finishDrop(targetIdx) {
  clearQHighlight();
  if (drag.type === 'episode') {
    // Add episode at position
    const f = feeds.find(x => x.id === activeFeedId);
    if (!f) return;
    const item = f.items[drag.index];
    if (!item) return;
    const alreadyAt = queue.findIndex(q => q.url === item.url && q.title === item.title);
    if (alreadyAt >= 0) { toast('Already in queue'); return; }
    const ins = Math.min(targetIdx, queue.length);
    queue.splice(ins, 0, { ...item });
    if (curIdx >= ins) curIdx++;
  } else if (drag.type === 'queue') {
    // Reorder within queue
    const from = drag.index;
    const to   = Math.min(targetIdx, queue.length - 1);
    if (from === to) return;
    const [moved] = queue.splice(from, 1);
    queue.splice(to, 0, moved);
    if (curIdx === from)      curIdx = to;
    else if (from < curIdx && to >= curIdx) curIdx--;
    else if (from > curIdx && to <= curIdx) curIdx++;
  }
  renderQueue();
  const f = feeds.find(x => x.id === activeFeedId);
  if (f) renderEpisodes(f.items);
  saveState();
}

// ══════════════════════════════════════════════════════════════
//  EPISODE LIST — drag out to queue (pointer events, works on touch)
// ══════════════════════════════════════════════════════════════
function attachEpisodeDrag(rowEl, epIndex) {
  // Desktop HTML5 drag
  rowEl.setAttribute('draggable', 'true');
  rowEl.addEventListener('dragstart', e => {
    drag.type  = 'episode';
    drag.index = epIndex;
    e.dataTransfer.effectAllowed = 'copy';
    e.dataTransfer.setData('text/plain', String(epIndex));
    rowEl.style.opacity = '0.5';
  });
  rowEl.addEventListener('dragend', () => { rowEl.style.opacity = ''; });

  // Touch / pointer drag
  rowEl.addEventListener('pointerdown', e => {
    if (e.pointerType === 'mouse') return; // let HTML5 DnD handle mouse
    drag.type  = 'episode';
    drag.index = epIndex;
    createGhost(rowEl, e.clientX, e.clientY);
    rowEl.setPointerCapture(e.pointerId);
  }, { passive: true });

  rowEl.addEventListener('pointermove', e => {
    if (drag.type !== 'episode' || !drag.ghost) return;
    moveGhost(e.clientX, e.clientY);
    const idx = qRowAtY(e.clientY);
    if (idx !== drag.overIdx) { drag.overIdx = idx; highlightQRow(idx); }
  }, { passive: true });

  rowEl.addEventListener('pointerup', e => {
    if (drag.type !== 'episode' || !drag.ghost) return;
    removeGhost();
    const idx = qRowAtY(e.clientY);
    finishDrop(idx);
    drag.type = null; drag.index = null; drag.overIdx = null;
  });
}

// ══════════════════════════════════════════════════════════════
//  QUEUE LIST — drag to reorder (pointer events)
// ══════════════════════════════════════════════════════════════
function attachQueueDrag(rowEl, qIndex) {
  // Desktop HTML5 drag
  rowEl.setAttribute('draggable', 'true');
  rowEl.addEventListener('dragstart', e => {
    drag.type  = 'queue';
    drag.index = qIndex;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(qIndex));
    rowEl.style.opacity = '0.4';
  });
  rowEl.addEventListener('dragend', () => { rowEl.style.opacity = ''; clearQHighlight(); });

  // Touch / pointer drag
  rowEl.addEventListener('pointerdown', e => {
    if (e.pointerType === 'mouse') return;
    drag.type  = 'queue';
    drag.index = qIndex;
    createGhost(rowEl, e.clientX, e.clientY);
    rowEl.setPointerCapture(e.pointerId);
  }, { passive: true });

  rowEl.addEventListener('pointermove', e => {
    if (drag.type !== 'queue' || !drag.ghost) return;
    moveGhost(e.clientX, e.clientY);
    const idx = qRowAtY(e.clientY);
    if (idx !== drag.overIdx) { drag.overIdx = idx; highlightQRow(idx); }
  }, { passive: true });

  rowEl.addEventListener('pointerup', e => {
    if (drag.type !== 'queue' || !drag.ghost) return;
    removeGhost();
    const idx = qRowAtY(e.clientY);
    finishDrop(idx);
    drag.type = null; drag.index = null; drag.overIdx = null;
  });
}

// ══════════════════════════════════════════════════════════════
//  QUEUE DROP ZONE — wire up the queue container to accept drops
// ══════════════════════════════════════════════════════════════
const qListEl = id('qList');

qListEl.addEventListener('dragover', e => {
  e.preventDefault();
  e.dataTransfer.dropEffect = drag.type === 'queue' ? 'move' : 'copy';
  const idx = qRowAtY(e.clientY);
  if (idx !== drag.overIdx) { drag.overIdx = idx; highlightQRow(idx); }
});

qListEl.addEventListener('dragleave', e => {
  if (!qListEl.contains(e.relatedTarget)) clearQHighlight();
});

qListEl.addEventListener('drop', e => {
  e.preventDefault();
  const idx = qRowAtY(e.clientY);
  finishDrop(idx);
  drag.type = null; drag.index = null; drag.overIdx = null;
});

// ══════════════════════════════════════════════════════════════
//  PATCH renderEpisodes & renderQueue to attach drag handlers
//  after each render — add one line at the end of each function
// ══════════════════════════════════════════════════════════════

// Inside renderEpisodes(), find this closing line:
//   el.innerHTML = items.map(...).join('');
// ADD this right after it:
//
//   el.querySelectorAll('.ep-row').forEach((row, i) => attachEpisodeDrag(row, i));
//
// Inside renderQueue(), find this closing line:
//   el.innerHTML = queue.map(...).join('');
// ADD this right after it:
//
//   el.querySelectorAll('.q-row').forEach((row, i) => attachQueueDrag(row, i));
// ══════════════════════════════════════════════════════════════
//  INIT
// ══════════════════════════════════════════════════════════════
loadState();