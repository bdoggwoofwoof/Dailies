// Dailies — one second a day, every Pro feature, nothing leaves your phone.
import { openDB, db, uid, buildPack, readPack, importPack } from './db.js';
import { unlock, audioCtx, bakeSnippet, thumbFromVideo, frameToJpeg, downscalePhoto, captureDate, dayKey, videoDuration, loadVideo, seek, pickMime, extFor } from './media.js';
import { Mash, drawClip, drawOverlays, FILTERS, TRACKS, DATE_FORMATS, fmtDate, playTrack, canFilter } from './render.js';

// ---------- tiny helpers ----------
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const today = () => dayKey(new Date());
const parseDay = d => { const [y, m, dd] = d.split('-').map(Number); return new Date(y, m - 1, dd); };
const addDays = (d, n) => { const x = parseDay(d); x.setDate(x.getDate() + n); return dayKey(x); };
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const fmtDur = s => { s = Math.round(s); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const fmtSize = b => b > 1e9 ? (b / 1e9).toFixed(1) + ' GB' : b > 1e6 ? (b / 1e6).toFixed(0) + ' MB' : Math.max(1, Math.round(b / 1e3)) + ' KB';
const sleep = ms => new Promise(r => setTimeout(r, ms));
let toastT;
function toast(msg, ms = 2200) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), ms); }
const ICON = {
  left: '<svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg>', right: '<svg viewBox="0 0 24 24"><path d="M9 5l7 7-7 7"/></svg>',
  close: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>', rotate: '<svg viewBox="0 0 24 24"><path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7"/></svg>',
  flip: '<svg viewBox="0 0 24 24"><path d="M12 3v18M8 7l-5 5 5 5V7zM16 7l5 5-5 5V7z"/></svg>', fill: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M8 9H6v2M16 9h2v2M8 15H6v-2M16 15h2v-2"/></svg>',
  star: '<svg viewBox="0 0 24 24"><path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z"/></svg>', eye: '<svg viewBox="0 0 24 24"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>',
  play: '<svg viewBox="0 0 24 24"><path d="M7 4.5v15l12.5-7.5z"/></svg>', pin: '<svg viewBox="0 0 24 24"><path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/></svg>',
};

const PROMPTS = ['Film something you touched today.', 'The first thing that made you smile.', 'Whatever is in front of you right now.', 'Someone you love, mid-sentence.', 'The light coming through a window.', 'Your hands doing your work.', 'Something you ate.', 'The view from where you’re sitting.', 'A sound worth keeping.', 'Something you’d never normally film.', 'The sky, wherever you are.', 'A place you pass every day.', 'Something small that’s beautiful.', 'Your walk, at ground level.', 'What you’re reading or studying.', 'A moment of rest.', 'Steam, smoke, water — something moving.', 'Someone laughing.', 'The last ten seconds of your commute.', 'A door you walked through today.', 'Your shadow.', 'Something that took effort.', 'The quietest moment of your day.', 'Somewhere you felt at home.', 'A friend’s face.', 'Something new to you.', 'The thing you’re grateful for tonight.', 'A texture up close.', 'Your favorite cup.', 'What the weather is doing.', 'A word, a sign, a page.', 'Wind in something.', 'A kindness — given or received.', 'An ordinary chore, made cinematic.', 'Something you want to remember in ten years.'];
const promptFor = d => PROMPTS[(parseDay(d) - new Date(2020, 0, 1)) / 864e5 % PROMPTS.length | 0];

const MASH_DEFAULTS = { range: 'month', from: '', to: '', favOnly: false, allPerDay: false, photos: true, forceLen: 0, aspect: '9:16', res: 1080, filter: 'none', transition: 'cut', stamp: true, stampStyle: 'clean', dateFormat: 'long', stampPos: 'bl', stampColor: '#ffffff', stampSize: 'm', showCaption: true, showLocation: false, title: '', subtitle: '', endText: '', music: 'none', musicVolume: 0.8, clipVolume: 1, musicOffset: 0, kenBurns: true };
const COLORS = ['#d4702a', '#3f7d4e', '#3a6ea5', '#a24a7a', '#c9a227', '#6d5bb5', '#2f8f8a', '#7a6f62'];
const ASPECTS = { '9:16': [9, 16], '4:5': [4, 5], '1:1': [1, 1], '16:9': [16, 9] };
const LENGTHS = [0.5, 1, 2, 3, 5, 10];

// ---------- state ----------
const S = { projects: [], project: null, clips: [], byDay: new Map(), notes: new Map(), tab: 'days', calMonth: today().slice(0, 7), calMode: 'month', settings: {}, thumbs: new Map(), primer: null };
const pool = [];

async function boot() {
  await openDB();
  for (let i = 0; i < 4; i++) { const v = document.createElement('video'); v.playsInline = true; v.setAttribute('playsinline', ''); v.preload = 'auto'; $('#pool').appendChild(v); pool.push(v); }
  S.settings = Object.assign({ name: '', theme: 'auto', defaultLen: 1, reminderTime: '20:00', toured: false, activePid: null }, await db.kvGet('settings', {}));
  applyTheme();
  S.projects = (await db.all('projects')).sort((a, b) => a.created - b.created);
  if (!S.projects.length) {
    const p = newProjectObj('My Year', 'journal', COLORS[0]); p.auto = true;
    await db.put('projects', p); S.projects = [p];
  }
  await switchProject(S.settings.activePid && S.projects.find(p => p.id === S.settings.activePid) ? S.settings.activePid : S.projects[0].id, false);
  $('#tabs').onclick = e => { const b = e.target.closest('button'); if (b) go(b.dataset.tab); };
  $('#projBtn').onclick = projectSwitcher;
  $('#fab').onclick = addSheet;
  render();
  if (!S.settings.toured) tour();
  if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});
}

function newProjectObj(name, type, color) {
  return { id: uid(), name, type, color, created: Date.now(), snippetLen: S.settings.defaultLen || 1, mash: { ...MASH_DEFAULTS, range: type === 'freestyle' ? 'all' : 'month' } };
}
async function saveSettings() { await db.kvSet('settings', S.settings); }
function applyTheme() { const t = S.settings.theme; if (t === 'auto') document.documentElement.removeAttribute('data-theme'); else document.documentElement.dataset.theme = t; }

async function switchProject(pid, rerender = true) {
  S.project = S.projects.find(p => p.id === pid);
  S.project.mash = { ...MASH_DEFAULTS, ...S.project.mash };
  S.settings.activePid = pid; saveSettings();
  await loadClips();
  if (rerender) render();
}
async function loadClips() {
  S.clips = await db.byIndex('clips', 'project', S.project.id);
  const notes = await db.all('notes');
  S.notes = new Map(notes.filter(n => n.key.startsWith(S.project.id + '|')).map(n => [n.key.split('|')[1], n.text]));
  indexClips();
  await Promise.all(S.clips.map(c => thumb(c.thumbId)));
  const v = S.clips.find(c => c.kind === 'video');
  if (v && !S.primer) { const m = await db.get('media', v.mediaId); if (m) S.primer = URL.createObjectURL(m.blob); }
}
function indexClips() {
  S.byDay = new Map();
  for (const c of S.clips) { if (!c.day) continue; if (!S.byDay.has(c.day)) S.byDay.set(c.day, []); S.byDay.get(c.day).push(c); }
  for (const arr of S.byDay.values()) arr.sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.created - b.created);
}
async function thumb(id) {
  if (!id) return '';
  if (S.thumbs.has(id)) return S.thumbs.get(id);
  const m = await db.get('media', id); if (!m) return '';
  const u = URL.createObjectURL(m.blob); S.thumbs.set(id, u); return u;
}
const thumbSync = id => S.thumbs.get(id) || '';
const firstClip = day => { const a = S.byDay.get(day); if (!a) return null; return a.find(c => !c.hidden) || a[0]; };

function streakInfo() {
  const filled = new Set([...S.byDay.entries()].filter(([, a]) => a.some(c => !c.hidden)).map(([d]) => d));
  let d = today(); if (!filled.has(d)) d = addDays(d, -1);
  let cur = 0; while (filled.has(d)) { cur++; d = addDays(d, -1); }
  const sorted = [...filled].sort(); let best = 0, run = 0, prev = null;
  for (const x of sorted) { run = prev && addDays(prev, 1) === x ? run + 1 : 1; best = Math.max(best, run); prev = x; }
  return { cur, best, filled };
}

// unlock audio + bless the hidden <video> pool inside a tap (iOS needs this for sound)
function unlockPool(url) {
  const src = url || S.primer;
  pool.forEach(el => { if (src && !el.getAttribute('src')) el.src = src; el.muted = false; });
  unlock(...pool);
}

// ---------- navigation ----------
function go(tab) { S.tab = tab; render(); window.scrollTo(0, 0); }
function render() {
  $$('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === S.tab));
  $('#projName').textContent = S.project.name;
  const st = streakInfo();
  $('#streak').textContent = S.project.type === 'journal' && st.cur ? `${st.cur} day${st.cur > 1 ? 's' : ''}` : '';
  $('#fab').classList.toggle('hide', !(S.tab === 'days'));
  const v = $('#view'); v.onclick = null; v.oninput = null; v.onchange = null;
  ({ days: S.project.type === 'freestyle' ? renderFreestyle : renderDays, mash: renderMash, projects: renderProjects, settings: renderSettings })[S.tab](v);
}

// ---------- sheets ----------
function sheet(inner, { onClose } = {}) {
  const w = document.createElement('div'); w.className = 'sheet-wrap';
  w.innerHTML = `<div class="sheet"><div class="grab"></div>${inner}</div>`;
  const close = () => { w.remove(); onClose && onClose(); };
  w.addEventListener('click', e => { if (e.target === w) close(); });
  $('#sheets').appendChild(w);
  return { el: w.firstElementChild, close };
}
function full(inner, cls = '') {
  const w = document.createElement('div'); w.className = 'full ' + cls; w.innerHTML = inner;
  $('#sheets').appendChild(w); return w;
}
function confirmSheet(msg, okLabel = 'Delete') {
  return new Promise(res => {
    const s = sheet(`<h2>${esc(msg)}</h2><div class="btns"><button class="btn" data-x>Cancel</button><button class="btn rec" data-ok>${esc(okLabel)}</button></div>`, { onClose: () => res(false) });
    $('[data-x]', s.el).onclick = () => s.close(); $('[data-ok]', s.el).onclick = () => { res(true); s.el.parentElement.remove(); };
  });
}
function busy(msg) {
  const w = document.createElement('div'); w.className = 'busy';
  w.innerHTML = `<div class="box"><b class="msg">${esc(msg)}</b><div class="small" style="opacity:.7;margin-top:4px" data-sub></div><div class="progress"><i></i></div></div>`;
  document.body.appendChild(w);
  return { set(p, sub) { $('i', w).style.width = Math.round(p * 100) + '%'; if (sub != null) $('[data-sub]', w).textContent = sub; }, done() { w.remove(); } };
}
function pickFile(input, multiple = false) {
  return new Promise(res => {
    const el = $(input); el.value = '';
    el.onchange = () => res(multiple ? [...el.files] : el.files[0]);
    el.click();
  });
}
function download(blob, name) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
async function shareOrSave(blob, name) {
  const file = new File([blob], name, { type: blob.type });
  if (navigator.canShare && navigator.canShare({ files: [file] })) { try { await navigator.share({ files: [file] }); return; } catch (e) { if (e.name === 'AbortError') return; } }
  download(blob, name);
}

// ---------- DAYS ----------
function renderDays(v) {
  const t = today(), tc = S.byDay.get(t), st = streakInfo();
  const y = t.slice(0, 4);
  const yearFilled = [...st.filled].filter(d => d.startsWith(y)).length;
  const dayOfYear = Math.round((parseDay(t) - new Date(+y, 0, 1)) / 864e5) + 1;
  const otd = [...S.byDay.keys()].filter(d => d.slice(5) === t.slice(5) && d < t).sort().reverse();
  const tthumb = tc ? thumbSync(firstClip(t).thumbId) : '';
  v.innerHTML = `
    <section class="card today">
      <button class="shot ${tc ? 'has' : ''}" data-act="${tc ? 'day' : 'record'}" data-day="${t}" style="${tthumb ? `background-image:url(${tthumb})` : ''}">${tc ? '' : 'TODAY'}</button>
      <div>
        <div class="small mono muted">${fmtDate(t, 'weekday').toUpperCase()}</div>
        <div class="prompt">${tc ? `<b>Today’s in.</b> ${tc.length > 1 ? tc.length + ' snippets.' : ''} Add another or keep it.` : esc(promptFor(t))}</div>
        <div class="btns"><button class="btn rec sm" data-act="record" data-day="${t}">Record</button><button class="btn sm" data-act="choose" data-day="${t}">Choose</button></div>
      </div>
    </section>
    <div class="stats">
      <div class="stat"><b>${st.cur}</b><span>day streak · best ${st.best}</span></div>
      <div class="stat"><b>${yearFilled}<small class="muted">/${dayOfYear}</small></b><span>days in ${y}</span></div>
      <div class="stat"><b>${fmtDur(S.clips.filter(c => !c.hidden).reduce((a, c) => a + (c.dur || 1), 0))}</b><span>of footage</span></div>
    </div>
    ${otd.length ? `<div class="label">On this day</div><div class="otd">${otd.map(d => `<button data-act="playday" data-day="${d}"><div class="th" style="background-image:url(${thumbSync(firstClip(d).thumbId)})"></div><div class="small mono muted">${d.slice(0, 4)}</div></button>`).join('')}</div>` : ''}
    <div class="row between" style="margin-top:14px">
      <div class="chips"><button class="chip ${S.calMode === 'month' ? 'on' : ''}" data-act="mode" data-m="month">Month</button><button class="chip ${S.calMode === 'year' ? 'on' : ''}" data-act="mode" data-m="year">Year</button></div>
      <button class="link small" data-act="smartfill">Fill missed days</button>
    </div>
    <div id="calwrap" style="margin-top:10px"></div>`;
  const cw = $('#calwrap', v);
  if (S.calMode === 'month') renderMonth(cw); else renderYear(cw);
  v.onclick = e => {
    const b = e.target.closest('[data-act]'); if (!b) return;
    const a = b.dataset.act, d = b.dataset.day;
    if (a === 'record') openCamera(d);
    else if (a === 'choose') chooseAndEdit(d);
    else if (a === 'day') openDay(d);
    else if (a === 'playday') { unlockPool(); playClips(S.byDay.get(d).filter(c => !c.hidden)); }
    else if (a === 'mode') { S.calMode = b.dataset.m; render(); }
    else if (a === 'smartfill') smartFill();
    else if (a === 'prev' || a === 'next') { const [yy, mm] = S.calMonth.split('-').map(Number); const dt = new Date(yy, mm - 1 + (a === 'next' ? 1 : -1), 1); S.calMonth = dayKey(dt).slice(0, 7); renderMonth(cw); }
    else if (a === 'month') { S.calMonth = b.dataset.m; S.calMode = 'month'; render(); }
    else if (a === 'yprev' || a === 'ynext') { S.calYear = (S.calYear || +today().slice(0, 4)) + (a === 'ynext' ? 1 : -1); renderYear(cw); }
  };
}
function renderMonth(el) {
  const [y, m] = S.calMonth.split('-').map(Number);
  const first = new Date(y, m - 1, 1), n = new Date(y, m, 0).getDate(), t = today();
  let cells = '';
  for (let i = 0; i < first.getDay(); i++) cells += '<div class="day blank"></div>';
  for (let d = 1; d <= n; d++) {
    const k = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const arr = S.byDay.get(k); const c = firstClip(k);
    const th = c ? thumbSync(c.thumbId) : '';
    const allHidden = arr && arr.every(x => x.hidden);
    cells += `<button class="day ${c ? 'has' : ''} ${k === t ? 'today' : ''} ${k > t ? 'future' : ''} ${allHidden ? 'hidden-clip' : ''}" data-act="day" data-day="${k}" style="${th ? `background-image:url(${th})` : ''}">${d}${arr && arr.length > 1 ? `<span class="badge">${arr.length}</span>` : ''}${S.notes.get(k) ? '<span class="note-dot"></span>' : ''}</button>`;
  }
  const count = [...S.byDay.keys()].filter(k => k.startsWith(S.calMonth)).length;
  el.innerHTML = `<div class="cal-head"><button class="icon-btn" data-act="prev">${ICON.left}</button><div style="text-align:center"><h2>${MONTHS[m - 1]} ${y}</h2><div class="small mono muted">${count} of ${n} days</div></div><button class="icon-btn" data-act="next">${ICON.right}</button></div>
    <div class="dow">${'SMTWTFS'.split('').map(x => `<span>${x}</span>`).join('')}</div><div class="cal">${cells}</div>`;
}
function renderYear(el) {
  const y = S.calYear || +today().slice(0, 4), t = today();
  let html = '';
  for (let m = 0; m < 12; m++) {
    const first = new Date(y, m, 1).getDay(), n = new Date(y, m + 1, 0).getDate();
    let cells = '<i class="b"></i>'.repeat(first);
    for (let d = 1; d <= n; d++) { const k = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`; cells += `<i class="${S.byDay.has(k) ? 'f' : ''} ${k === t ? 't' : ''}"></i>`; }
    html += `<button data-act="month" data-m="${y}-${String(m + 1).padStart(2, '0')}" style="text-align:left"><h3>${MONTHS[m].slice(0, 3)}</h3><div class="mini">${cells}</div></button>`;
  }
  el.innerHTML = `<div class="cal-head"><button class="icon-btn" data-act="yprev">${ICON.left}</button><h2>${y}</h2><button class="icon-btn" data-act="ynext">${ICON.right}</button></div><div class="year">${html}</div>`;
}

function renderFreestyle(v) {
  const clips = [...S.clips].sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.created - b.created);
  v.innerHTML = `
    <section class="card"><div class="row between"><div><b>${clips.length} snippet${clips.length === 1 ? '' : 's'}</b> <span class="muted small mono">· ${fmtDur(clips.reduce((a, c) => a + (c.hidden ? 0 : c.dur || 1), 0))}</span><div class="small muted">Freestyle — any moments, in the order you set.</div></div></div>
    <div class="btns" style="margin-top:10px"><button class="btn rec sm" data-act="record">Record</button><button class="btn sm" data-act="choose">Choose</button><button class="btn sm" data-act="multi">Add many</button></div></section>
    ${clips.length ? `<div class="grid">${clips.map((c, i) => `<button class="tile" data-act="clip" data-id="${c.id}" style="background-image:url(${thumbSync(c.thumbId)});${c.hidden ? 'opacity:.4' : ''}"><span class="cap">${i + 1}${c.day ? ' · ' + fmtDate(c.day, 'short') : ''}${c.favorite ? ' ★' : ''}</span></button>`).join('')}</div>` : `<div class="empty">No snippets yet. Record one or add a batch from your library.</div>`}`;
  v.onclick = e => {
    const b = e.target.closest('[data-act]'); if (!b) return;
    const a = b.dataset.act;
    if (a === 'record') openCamera(today());
    else if (a === 'choose') chooseAndEdit(today());
    else if (a === 'multi') smartFill();
    else if (a === 'clip') clipSheet(S.clips.find(c => c.id === b.dataset.id));
  };
}

function addSheet() {
  const t = today();
  const s = sheet(`<h2>Add a second</h2>
    <div class="list">
      <button class="item" data-a="rec"><span class="sw" style="background:var(--rec);border-radius:6px"></span><div><div class="t">Record now</div><div class="s">Camera with ghost overlay of your last clip</div></div></button>
      <button class="item" data-a="pick"><span class="sw" style="background:var(--accent)"></span><div><div class="t">Choose from library</div><div class="s">A video or photo — trim it to your second</div></div></button>
      <button class="item" data-a="fill"><span class="sw" style="background:var(--good)"></span><div><div class="t">Fill missed days</div><div class="s">Pick many at once — dates are read from the files</div></div></button>
    </div>`);
  s.el.onclick = e => { const b = e.target.closest('[data-a]'); if (!b) return; s.close(); ({ rec: () => openCamera(t), pick: () => chooseAndEdit(t), fill: smartFill })[b.dataset.a](); };
}

// ---------- day sheet ----------
function openDay(day) {
  const arr = S.byDay.get(day) || [];
  const s = sheet(`
    <div class="row between"><h2>${fmtDate(day, 'weekday')}, ${day.slice(0, 4)}</h2>${arr.length ? `<button class="btn sm" data-a="play">${'Play'}</button>` : ''}</div>
    ${arr.length ? `<div class="list">${arr.map((c, i) => `
      <div class="item">
        <button class="th" data-a="edit" data-id="${c.id}" style="background-image:url(${thumbSync(c.thumbId)});${c.hidden ? 'opacity:.4' : ''}"></button>
        <div class="grow"><div class="t">${i === 0 ? 'Main' : 'Extra'} · ${(c.dur || 1).toFixed(1)}s ${c.kind === 'photo' ? 'photo' : ''}${c.favorite ? ' ★' : ''}</div><div class="s">${esc(c.caption || (c.hidden ? 'Hidden from mashes' : c.author ? 'by ' + c.author : 'Tap to edit'))}</div></div>
        ${i > 0 ? `<button class="btn sm ghost" data-a="main" data-id="${c.id}">Make main</button>` : ''}
        <button class="btn sm ghost" data-a="hide" data-id="${c.id}">${c.hidden ? 'Show' : 'Hide'}</button>
      </div>`).join('')}</div>` : `<div class="empty">Nothing yet for this day.</div>`}
    <div class="btns" style="margin:12px 0"><button class="btn rec" data-a="rec">Record</button><button class="btn" data-a="pick">${arr.length ? 'Add another' : 'Choose'}</button></div>
    <label class="field"><span>Note to yourself</span><textarea class="input" data-a="note" placeholder="What happened today?">${esc(S.notes.get(day) || '')}</textarea></label>`, { onClose: () => render() });
  let nt;
  s.el.oninput = e => { if (e.target.dataset.a !== 'note') return; clearTimeout(nt); const val = e.target.value; nt = setTimeout(async () => { const key = `${S.project.id}|${day}`; if (val.trim()) { await db.put('notes', { key, text: val }); S.notes.set(day, val); } else { await db.del('notes', key); S.notes.delete(day); } }, 400); };
  s.el.onclick = async e => {
    const b = e.target.closest('[data-a]'); if (!b || b.dataset.a === 'note') return;
    const c = S.clips.find(x => x.id === b.dataset.id);
    switch (b.dataset.a) {
      case 'play': unlockPool(); playClips(arr.filter(x => !x.hidden).length ? arr.filter(x => !x.hidden) : arr); break;
      case 'rec': s.close(); openCamera(day); break;
      case 'pick': s.close(); chooseAndEdit(day); break;
      case 'edit': s.close(); editClip(c); break;
      case 'hide': c.hidden = !c.hidden; await db.put('clips', c); s.close(); openDay(day); break;
      case 'main': { const min = Math.min(...arr.map(x => x.order ?? 0)); c.order = min - 1; await db.put('clips', c); indexClips(); s.close(); openDay(day); break; }
    }
  };
}
function clipSheet(c) {
  const s = sheet(`<div class="row" style="gap:14px"><div class="th" style="width:72px;height:96px;border-radius:10px;background:#000 center/cover url(${thumbSync(c.thumbId)})"></div><div><h2 style="margin:0">${c.day ? fmtDate(c.day, 'weekday') + ', ' + c.day.slice(0, 4) : 'Snippet'}</h2><div class="small muted">${(c.dur || 1).toFixed(1)}s ${c.kind}${c.author ? ' · by ' + esc(c.author) : ''}</div></div></div>
    <div class="btns" style="margin-top:14px"><button class="btn" data-a="play">Play</button><button class="btn" data-a="edit">Edit</button><button class="btn" data-a="hide">${c.hidden ? 'Show' : 'Hide'}</button></div>
    <div class="btns" style="margin-top:8px"><button class="btn" data-a="up">Move earlier</button><button class="btn" data-a="down">Move later</button></div>`, { onClose: () => render() });
  s.el.onclick = async e => {
    const b = e.target.closest('[data-a]'); if (!b) return;
    const sorted = [...S.clips].sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.created - b.created);
    sorted.forEach((x, i) => x.order = i);
    const i = sorted.indexOf(c);
    if (b.dataset.a === 'play') { unlockPool(); playClips([c]); }
    else if (b.dataset.a === 'edit') { s.close(); editClip(c); }
    else if (b.dataset.a === 'hide') { c.hidden = !c.hidden; await db.put('clips', c); s.close(); }
    else { const j = b.dataset.a === 'up' ? i - 1 : i + 1; if (j < 0 || j >= sorted.length) return; [sorted[i].order, sorted[j].order] = [sorted[j].order, sorted[i].order]; for (const x of sorted) await db.put('clips', x); toast(b.dataset.a === 'up' ? 'Moved earlier' : 'Moved later'); render(); }
  };
}

// ---------- camera ----------
async function openCamera(day) {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { toast('Camera not available here — choose from library instead'); return chooseAndEdit(day); }
  let facing = 'environment', stream, len = S.project.snippetLen || 1, ghostOn = true, ghostOp = 0.3, grid = false, face = false, recording = false;
  const prev = [...S.byDay.keys()].filter(d => d < day).sort().pop();
  const ghostSrc = prev ? thumbSync(firstClip(prev).thumbId) : (S.clips.length ? thumbSync(S.clips[S.clips.length - 1].thumbId) : '');
  const w = full(`
    <div class="bar"><button class="dark-btn" data-a="x">Cancel</button><div class="mono small">${fmtDate(day, 'weekday').toUpperCase()}</div><button class="dark-btn" data-a="flipcam">Flip</button></div>
    <div class="cam"><video autoplay playsinline muted></video>${ghostSrc ? `<img class="ghost" src="${ghostSrc}" style="opacity:${ghostOp}">` : ''}<div class="gridlines" hidden></div><div class="face" hidden></div></div>
    <div class="cam-ctrl">
      <div class="chips" style="justify-content:center">${LENGTHS.map(l => `<button class="chip ${l === len ? 'on' : ''}" data-len="${l}">${l}s</button>`).join('')}</div>
      <div class="row between">
        <div class="row" style="gap:6px">${ghostSrc ? '<button class="dark-btn" data-a="ghost">Ghost on</button>' : ''}<button class="dark-btn" data-a="grid">Grid</button><button class="dark-btn" data-a="face">Face</button></div>
        <button class="shutter" data-a="shoot"><span></span><svg viewBox="0 0 76 76"><circle cx="38" cy="38" r="35" fill="none" stroke="var(--rec)" stroke-width="4" stroke-dasharray="220" stroke-dashoffset="220" class="ring"/></svg></button>
        <div style="width:150px">${ghostSrc ? `<input type="range" min="0" max="70" value="${ghostOp * 100}" data-a="op" aria-label="Ghost opacity">` : ''}</div>
      </div>
    </div>`);
  const vid = $('video', w), ghost = $('img.ghost', w);
  const start = async () => {
    stream && stream.getTracks().forEach(t => t.stop());
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: facing, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: true });
    } catch (e) {
      try { stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: facing }, audio: false }); } catch (e2) { toast('Camera permission needed'); close(); return; }
    }
    vid.srcObject = stream; vid.classList.toggle('mirror', facing === 'user'); ghost && ghost.classList.toggle('mirror', false);
  };
  const close = () => { stream && stream.getTracks().forEach(t => t.stop()); w.remove(); };
  await start();
  w.oninput = e => { if (e.target.dataset.a === 'op') { ghostOp = e.target.value / 100; ghost.style.opacity = ghostOn ? ghostOp : 0; } };
  w.onclick = async e => {
    const L = e.target.closest('[data-len]'); if (L && !recording) { len = +L.dataset.len; $$('[data-len]', w).forEach(x => x.classList.toggle('on', x === L)); return; }
    const b = e.target.closest('[data-a]'); if (!b) return;
    const a = b.dataset.a;
    if (a === 'x') close();
    else if (a === 'flipcam' && !recording) { facing = facing === 'user' ? 'environment' : 'user'; start(); }
    else if (a === 'ghost') { ghostOn = !ghostOn; ghost.style.opacity = ghostOn ? ghostOp : 0; b.textContent = ghostOn ? 'Ghost on' : 'Ghost off'; }
    else if (a === 'grid') { grid = !grid; $('.gridlines', w).hidden = !grid; }
    else if (a === 'face') { face = !face; $('.face', w).hidden = !face; }
    else if (a === 'shoot' && !recording) {
      if (!window.MediaRecorder) { toast('Recording not supported in this browser'); return; }
      recording = true; b.classList.add('going'); unlock();
      const mime = pickMime();
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      const chunks = []; rec.ondataavailable = ev => ev.data.size && chunks.push(ev.data);
      const done = new Promise(r => rec.onstop = r);
      const ring = $('.ring', w); ring.style.transition = `stroke-dashoffset ${len + 0.35}s linear`; requestAnimationFrame(() => ring.style.strokeDashoffset = 0);
      rec.start(); await sleep((len + 0.35) * 1000); rec.stop(); await done;
      const blob = new Blob(chunks, { type: (rec.mimeType || mime || 'video/mp4').split(';')[0] });
      close();
      openEditor({ file: blob, day, len, fromCamera: true });
    }
  };
}

async function chooseAndEdit(day) {
  const f = await pickFile('#filePick');
  if (f) openEditor({ file: f, day, len: S.project.snippetLen || 1 });
}
async function editClip(c) {
  const m = await db.get('media', c.mediaId);
  if (!m) return toast('Media missing for this clip');
  openEditor({ file: m.blob, day: c.day, clip: c });
}

// ---------- editor ----------
async function openEditor({ file, day, clip, len = 1, fromCamera = false }) {
  const kind = file.type.startsWith('image') ? 'photo' : 'video';
  const editing = !!clip;
  const e = clip ? { ...clip } : { rotate: 0, flip: false, fill: true, brightness: 0, volume: 100, filter: 'none', caption: '', location: '', favorite: false, hidden: false, start: 0, dur: len, day };
  const [aw, ah] = ASPECTS[S.project.mash.aspect] || [9, 16];
  const PW = aw < ah ? 360 : Math.round(360 * aw / ah), PH = aw < ah ? Math.round(360 * ah / aw) : 360;
  const url = URL.createObjectURL(file);
  let srcDur = kind === 'video' ? (editing ? (clip.srcDur || clip.dur) : await videoDuration(file)) : 10;
  if (!isFinite(srcDur) || srcDur <= 0) srcDur = len;
  if (kind === 'video' && !editing) { e.dur = Math.min(e.dur, srcDur); e.start = fromCamera ? Math.max(0, Math.min(0.15, srcDur - e.dur)) : Math.max(0, srcDur / 2 - e.dur / 2); }
  const lens = kind === 'video' ? LENGTHS.filter(l => l <= srcDur + 0.05) : LENGTHS;
  const w = full(`
    <div class="bar"><button class="btn sm" data-a="x">Cancel</button><b>${editing ? 'Edit snippet' : 'New snippet'}</b><button class="btn primary sm" data-a="save">Save</button></div>
    <div class="scroll">
      <div class="stage"><canvas width="${PW}" height="${PH}" style="aspect-ratio:${PW}/${PH};height:min(46dvh, calc((100vw - 32px) * ${PH / PW}))"></canvas></div>
      ${kind === 'video' ? `<div class="scrub"><div class="strip">${'<div></div>'.repeat(8)}</div><div class="win"></div><div class="playhead"></div><input type="range" min="0" max="${Math.max(0, srcDur - e.dur).toFixed(2)}" step="0.01" value="${e.start}" data-a="start" aria-label="Snippet start"></div>
        <div class="row between small mono muted"><span data-t>${e.start.toFixed(2)}s</span><span>of ${srcDur.toFixed(1)}s</span></div>` : ''}
      <div class="ed-sec"><div class="label">Length</div><div class="chips">${lens.map(l => `<button class="chip ${Math.abs(l - e.dur) < 0.01 ? 'on' : ''}" data-len="${l}">${l}s</button>`).join('')}${kind === 'video' && srcDur < 10 && !lens.includes(+srcDur.toFixed(1)) ? `<button class="chip" data-len="${srcDur.toFixed(2)}">All ${srcDur.toFixed(1)}s</button>` : ''}</div></div>
      <div class="ed-sec"><div class="tools">
        <button class="tool" data-a="rot">${ICON.rotate}Rotate</button>
        <button class="tool ${e.flip ? 'on' : ''}" data-a="flip">${ICON.flip}Flip</button>
        <button class="tool ${e.fill !== false ? 'on' : ''}" data-a="fill">${ICON.fill}<span>${e.fill !== false ? 'Fill' : 'Fit'}</span></button>
        <button class="tool ${e.favorite ? 'on' : ''}" data-a="fav">${ICON.star}Favorite</button>
      </div></div>
      <div class="ed-sec card" style="margin-top:14px">
        <div class="slider-row"><span>Brightness</span><input type="range" min="-50" max="50" value="${e.brightness}" data-a="bright"><output>${e.brightness > 0 ? '+' : ''}${e.brightness}</output></div>
        ${kind === 'video' ? `<div class="slider-row" style="margin-top:8px"><span>Volume</span><input type="range" min="0" max="200" step="5" value="${e.volume}" data-a="vol"><output>${e.volume}%</output></div>` : ''}
      </div>
      <div class="ed-sec"><div class="label">Filter${canFilter ? '' : ' (not supported in this browser)'}</div><div class="chips scroll">${Object.entries(FILTERS).map(([k, f]) => `<button class="chip ${e.filter === k ? 'on' : ''}" data-filter="${k}">${f.name}</button>`).join('')}</div></div>
      <div class="ed-sec">
        ${S.project.type === 'journal' || e.day ? `<label class="field"><span>Day</span><input class="input" type="date" value="${e.day || ''}" max="${today()}" data-a="day"></label>` : ''}
        <label class="field"><span>Caption (shows in mashes)</span><input class="input" maxlength="90" value="${esc(e.caption)}" data-a="cap" placeholder="Optional"></label>
        <label class="field"><span>Location</span><div class="row"><input class="input" value="${esc(e.location)}" data-a="loc" placeholder="Optional"><button class="btn sm" data-a="here">${ICON.pin.replace('<svg', '<svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"')}Here</button></div></label>
        <div class="list"><label class="switch"><span>Hide from mashes</span><input type="checkbox" data-a="hidden" ${e.hidden ? 'checked' : ''}></label></div>
        ${editing ? `<button class="btn block" style="margin-top:14px;color:var(--rec)" data-a="del">Delete snippet</button>` : ''}
      </div>
    </div>`, 'light');
  const cv = $('canvas', w), ctx = cv.getContext('2d');
  let src, sw, sh, raf, alive = true;
  if (kind === 'video') { src = await loadVideo(url); src.muted = true; src.loop = false; sw = src.videoWidth; sh = src.videoHeight; await seek(src, e.start); src.play().catch(() => {}); }
  else { src = new Image(); await new Promise(r => { src.onload = r; src.onerror = r; src.src = url; }); sw = src.naturalWidth; sh = src.naturalHeight; }
  const winEl = $('.win', w), ph = $('.playhead', w);
  const layoutWin = () => { if (!winEl) return; winEl.style.left = (e.start / srcDur * 100) + '%'; winEl.style.width = (e.dur / srcDur * 100) + '%'; const r = $('[data-a=start]', w); r.max = Math.max(0, srcDur - e.dur).toFixed(2); $('[data-t]', w).textContent = e.start.toFixed(2) + 's'; };
  layoutWin();
  const t0 = performance.now();
  const loop = () => {
    if (!alive) return;
    if (kind === 'video') {
      if (src.currentTime >= e.start + e.dur || src.currentTime < e.start - 0.25 || src.ended) { src.currentTime = e.start; if (src.paused) src.play().catch(() => {}); }
      if (ph) ph.style.left = (src.currentTime / srcDur * 100) + '%';
    }
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, PW, PH);
    const prog = kind === 'photo' ? ((performance.now() - t0) / 1000 % e.dur) / e.dur : 0;
    drawClip(ctx, src, sw, sh, PW, PH, e, { mashFilter: '', zoom: kind === 'photo' ? 1 + 0.06 * prog : 1 });
    drawOverlays(ctx, PW, PH, { clip: e, day: e.day }, S.project.mash);
    raf = requestAnimationFrame(loop);
  };
  loop();
  // filmstrip
  if (kind === 'video') (async () => {
    const tv = await loadVideo(url).catch(() => null); if (!tv) return;
    const cells = $$('.strip div', w);
    for (let i = 0; i < cells.length && alive; i++) { await seek(tv, srcDur * (i + 0.5) / cells.length); const b = await frameToJpeg(tv, tv.videoWidth, tv.videoHeight, 120, 0.6); if (b) cells[i].style.backgroundImage = `url(${URL.createObjectURL(b)})`; }
    tv.removeAttribute('src'); tv.load();
  })();
  const close = () => { alive = false; cancelAnimationFrame(raf); if (kind === 'video') { src.pause(); } w.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000); };
  w.oninput = ev => {
    const a = ev.target.dataset.a, val = ev.target.value;
    if (a === 'start') { e.start = +val; src.currentTime = e.start; layoutWin(); }
    else if (a === 'bright') { e.brightness = +val; ev.target.nextElementSibling.textContent = (e.brightness > 0 ? '+' : '') + e.brightness; }
    else if (a === 'vol') { e.volume = +val; ev.target.nextElementSibling.textContent = e.volume + '%'; src.volume = Math.min(1, e.volume / 100); }
    else if (a === 'cap') e.caption = val;
    else if (a === 'loc') e.location = val;
    else if (a === 'day') e.day = val;
    else if (a === 'hidden') e.hidden = ev.target.checked;
  };
  w.onclick = async ev => {
    const L = ev.target.closest('[data-len]');
    if (L) { e.dur = +L.dataset.len; if (kind === 'video') e.start = Math.min(e.start, Math.max(0, srcDur - e.dur)); $$('[data-len]', w).forEach(x => x.classList.toggle('on', x === L)); layoutWin(); return; }
    const F = ev.target.closest('[data-filter]');
    if (F) { e.filter = F.dataset.filter; $$('[data-filter]', w).forEach(x => x.classList.toggle('on', x === F)); return; }
    if (ev.target.closest('canvas') && kind === 'video') { src.muted = !src.muted; toast(src.muted ? 'Preview muted' : 'Preview sound on', 1000); return; }
    const b = ev.target.closest('[data-a]'); if (!b) return;
    switch (b.dataset.a) {
      case 'x': close(); break;
      case 'rot': e.rotate = ((e.rotate || 0) + 90) % 360; break;
      case 'flip': e.flip = !e.flip; b.classList.toggle('on', e.flip); break;
      case 'fill': e.fill = e.fill === false; b.classList.toggle('on', e.fill); $('span', b).textContent = e.fill ? 'Fill' : 'Fit'; break;
      case 'fav': e.favorite = !e.favorite; b.classList.toggle('on', e.favorite); break;
      case 'here': here(b, e, w); break;
      case 'del': if (await confirmSheet('Delete this snippet?')) { await deleteClip(clip); close(); render(); toast('Deleted'); } break;
      case 'save': {
        if (S.project.type === 'journal' && !e.day) return toast('Pick a day first');
        // bless the preview element for unmuted capture (iOS) while we're still in the tap
        unlock(); if (kind === 'video') { src.muted = false; src.play().catch(() => {}); }
        alive = false; cancelAnimationFrame(raf);
        await saveSnippet({ file, kind, e, clip, srcEl: kind === 'video' ? src : null, srcDur });
        close(); render();
      }
    }
  };
}

async function here(btn, e, w) {
  if (!navigator.geolocation) return toast('Location not available');
  btn.disabled = true;
  navigator.geolocation.getCurrentPosition(async pos => {
    const { latitude: la, longitude: lo } = pos.coords;
    let name = `${la.toFixed(3)}, ${lo.toFixed(3)}`;
    try {
      const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&zoom=14&lat=${la}&lon=${lo}`);
      const j = await r.json(); const a = j.address || {};
      const place = a.city || a.town || a.village || a.hamlet || a.suburb || a.county; const reg = a.state || a.country;
      if (place) name = reg ? `${place}, ${reg}` : place;
    } catch (err) { /* keep coords */ }
    e.location = name; $('[data-a=loc]', w).value = name; btn.disabled = false;
  }, () => { btn.disabled = false; toast('Couldn’t get your location'); }, { timeout: 10000 });
}

async function saveSnippet({ file, kind, e, clip, srcEl, srcDur }) {
  const fields = ['rotate', 'flip', 'fill', 'brightness', 'volume', 'filter', 'caption', 'location', 'favorite', 'hidden', 'day', 'start', 'dur'];
  if (clip) { // editing: non-destructive
    fields.forEach(f => clip[f] = e[f]);
    if (clip.kind === 'video' && (Math.abs(clip.start - (clip._thumbAt ?? -1)) > 0.01)) {
      const m = await db.get('media', clip.mediaId); const u = URL.createObjectURL(m.blob);
      try { const tb = await thumbFromVideo(u, clip.start + clip.dur / 2); await db.put('media', { id: clip.thumbId, blob: tb }); S.thumbs.delete(clip.thumbId); await thumb(clip.thumbId); } catch (err) {} URL.revokeObjectURL(u);
    }
    await db.put('clips', clip); indexClips(); toast('Saved'); return;
  }
  const b = busy(kind === 'video' ? 'Saving your second…' : 'Saving…');
  try {
    const c = { id: uid(), projectId: S.project.id, kind, created: Date.now(), author: S.settings.name || null };
    fields.forEach(f => c[f] = e[f]);
    const sameDay = c.day ? (S.byDay.get(c.day) || []) : S.clips;
    c.order = sameDay.length ? Math.max(...sameDay.map(x => x.order ?? 0)) + 1 : 0;
    let media, tb;
    if (kind === 'photo') {
      const p = await downscalePhoto(file); media = p.blob; tb = p.thumb; c.width = p.width; c.height = p.height; c.start = 0;
    } else {
      b.set(0.2, 'Trimming');
      try {
        const r = await bakeSnippet(file, e.start, e.dur, { el: srcEl });
        media = r.blob; c.start = 0; c.srcDur = e.dur; c.width = r.width; c.height = r.height; c.baked = true;
      } catch (err) {
        console.warn('bake failed, keeping original', err);
        if (file.size > 250e6) throw new Error('This video is too large to keep whole — try a shorter clip');
        media = file; c.srcDur = srcDur;
      }
      b.set(0.8, 'Thumbnail');
      const u = URL.createObjectURL(media);
      tb = await thumbFromVideo(u, c.start + c.dur / 2).catch(() => null); URL.revokeObjectURL(u);
      if (!S.primer) S.primer = URL.createObjectURL(media);
    }
    c.mediaId = uid(); await db.put('media', { id: c.mediaId, blob: media });
    if (tb) { c.thumbId = uid(); await db.put('media', { id: c.thumbId, blob: tb }); await thumb(c.thumbId); }
    c._thumbAt = c.start;
    await db.put('clips', c); S.clips.push(c); indexClips();
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist();
    b.done(); toast(c.day === today() ? 'Today’s second is in' : 'Saved');
  } catch (err) { b.done(); toast(err.message || 'Couldn’t save that one', 3500); }
}
async function deleteClip(c) {
  await db.del('clips', c.id); await db.del('media', c.mediaId); if (c.thumbId) await db.del('media', c.thumbId);
  S.clips = S.clips.filter(x => x.id !== c.id); indexClips();
}

// ---------- Smart-Fill ----------
async function smartFill() {
  const files = await pickFile('#multiPick', true);
  if (!files || !files.length) return;
  const b = busy('Reading dates…');
  const items = [];
  for (let i = 0; i < files.length; i++) {
    const f = files[i]; b.set(i / files.length, f.name);
    const cd = await captureDate(f);
    const dur = f.type.startsWith('image') ? 0 : await videoDuration(f);
    items.push({ f, day: cd.day, source: cd.source, dur, kind: f.type.startsWith('image') ? 'photo' : 'video', on: true });
  }
  b.done();
  items.sort((a, z) => a.day.localeCompare(z.day));
  const journal = S.project.type === 'journal';
  let len = S.project.snippetLen || 1, onlyEmpty = journal;
  const w = full(`<div class="bar"><button class="btn sm" data-a="x">Cancel</button><b>Fill missed days</b><button class="btn primary sm" data-a="go">Add</button></div>
    <div class="scroll">
      <p class="small muted">Dates come from each file’s metadata when it’s there. Check the ones marked “check it” and fix the day if needed. Each video’s middle ${'<span data-len-l>' + len + '</span>'}s is used — you can re-trim any of them later.</p>
      <div class="chips" style="margin-bottom:10px">${LENGTHS.map(l => `<button class="chip ${l === len ? 'on' : ''}" data-len="${l}">${l}s</button>`).join('')}</div>
      ${journal ? `<div class="list" style="margin-bottom:12px"><label class="switch"><span>Skip days that already have a second</span><input type="checkbox" data-a="only" checked></label></div>` : ''}
      <div class="list" data-list></div>
    </div>`, 'light');
  const draw = () => {
    $('[data-list]', w).innerHTML = items.map((it, i) => {
      const taken = journal && S.byDay.has(it.day);
      return `<div class="item"><input type="checkbox" data-i="${i}" ${it.on && !(onlyEmpty && taken) ? 'checked' : ''} ${onlyEmpty && taken ? 'disabled' : ''}><div class="grow"><div class="t" style="font-size:14px;word-break:break-all">${esc(it.f.name)}</div><div class="s">${it.kind}${it.dur ? ' · ' + it.dur.toFixed(1) + 's' : ''} · ${esc(it.source)}${taken ? ' · day has one' : ''}</div></div><input type="date" class="input" style="width:150px" value="${it.day}" data-d="${i}"></div>`;
    }).join('');
  };
  draw();
  w.onchange = e => {
    if (e.target.dataset.i) items[e.target.dataset.i].on = e.target.checked;
    if (e.target.dataset.d) { items[e.target.dataset.d].day = e.target.value; draw(); }
    if (e.target.dataset.a === 'only') { onlyEmpty = e.target.checked; draw(); }
  };
  w.onclick = async e => {
    const L = e.target.closest('[data-len]'); if (L) { len = +L.dataset.len; $$('[data-len]', w).forEach(x => x.classList.toggle('on', x === L)); $('[data-len-l]', w).textContent = len; return; }
    const a = e.target.closest('[data-a]'); if (!a) return;
    if (a.dataset.a === 'x') return w.remove();
    if (a.dataset.a !== 'go') return;
    const todo = items.filter(it => it.on && !(onlyEmpty && journal && S.byDay.has(it.day)));
    if (!todo.length) return toast('Nothing selected');
    const firstVid = todo.find(t => t.kind === 'video');
    const el = pool[0];
    if (firstVid) { el.src = URL.createObjectURL(firstVid.f); el.muted = false; }
    unlock(el);
    w.remove();
    const bb = busy(`Adding ${todo.length}…`);
    const seen = new Set();
    for (let i = 0; i < todo.length; i++) {
      const it = todo[i]; bb.set(i / todo.length, `${i + 1} of ${todo.length} · ${fmtDate(it.day)}`);
      const d = Math.min(len, it.dur || len);
      const e2 = { rotate: 0, flip: false, fill: true, brightness: 0, volume: 100, filter: 'none', caption: '', location: '', favorite: false, hidden: false, day: it.day, start: it.kind === 'video' ? Math.max(0, it.dur / 2 - d / 2) : 0, dur: it.kind === 'video' ? d : len };
      // second clip on the same day (from this batch) becomes an extra
      seen.add(it.day);
      await saveSnippetQuiet({ file: it.f, kind: it.kind, e: e2, el, srcDur: it.dur });
    }
    bb.done(); render(); toast(`Added ${todo.length} second${todo.length > 1 ? 's' : ''}`);
  };
}
async function saveSnippetQuiet({ file, kind, e, el, srcDur }) {
  const c = { id: uid(), projectId: S.project.id, kind, created: Date.now(), author: S.settings.name || null, ...e };
  const sameDay = c.day && S.project.type === 'journal' ? (S.byDay.get(c.day) || []) : S.clips;
  c.order = sameDay.length ? Math.max(...sameDay.map(x => x.order ?? 0)) + 1 : 0;
  let media, tb;
  try {
    if (kind === 'photo') { const p = await downscalePhoto(file); media = p.blob; tb = p.thumb; c.width = p.width; c.height = p.height; }
    else {
      try { const r = await bakeSnippet(file, e.start, e.dur, { el }); media = r.blob; c.start = 0; c.srcDur = e.dur; c.width = r.width; c.height = r.height; c.baked = true; }
      catch (err) { if (file.size > 250e6) return; media = file; c.srcDur = srcDur; }
      const u = URL.createObjectURL(media); tb = await thumbFromVideo(u, c.start + c.dur / 2).catch(() => null); URL.revokeObjectURL(u);
      if (!S.primer) S.primer = URL.createObjectURL(media);
    }
    c.mediaId = uid(); await db.put('media', { id: c.mediaId, blob: media });
    if (tb) { c.thumbId = uid(); await db.put('media', { id: c.thumbId, blob: tb }); await thumb(c.thumbId); }
    c._thumbAt = c.start;
    await db.put('clips', c); S.clips.push(c); indexClips();
  } catch (err) { console.warn('skip', file.name, err); }
}

// ---------- playback ----------
async function playClips(clips) {
  if (!clips.length) return;
  const m = S.project.mash; const [aw, ah] = ASPECTS[m.aspect] || [9, 16];
  const W = aw < ah ? 540 : Math.round(540 * aw / ah), H = aw < ah ? Math.round(540 * ah / aw) : 540;
  const w = full(`<div class="bar"><button class="dark-btn" data-a="x">Close</button><span class="mono small" data-t></span><span style="width:60px"></span></div><div class="preview-stage"><canvas width="${W}" height="${H}"></canvas></div>`);
  const segs = await segmentsFor(clips, { ...m, forceLen: 0 });
  const mash = new Mash($('canvas', w), segs, { ...m, music: 'none', title: '', endText: '', pool });
  w.onclick = e => { if (e.target.closest('[data-a=x]')) { mash.stop(); w.remove(); } };
  await mash.run({ record: false, onProgress: p => { const t = $('[data-t]', w); if (t) t.textContent = fmtDur(p * mash.total) + ' / ' + fmtDur(mash.total); } });
  await sleep(300); w.remove();
}
async function segmentsFor(clips, m) {
  return clips.map(c => ({ clip: c, kind: c.kind, start: c.start || 0, dur: m.forceLen ? (c.kind === 'video' ? Math.min(m.forceLen, c.dur || 1) : m.forceLen) : (c.dur || 1), day: c.day, load: async () => (await db.get('media', c.mediaId)).blob }));
}

// ---------- MASH ----------
function rangeFor(m) {
  const t = today(), y = t.slice(0, 4), mo = t.slice(0, 7);
  const lm = dayKey(new Date(+y, +t.slice(5, 7) - 2, 1)).slice(0, 7);
  switch (m.range) {
    case 'week': return [addDays(t, -6), t];
    case 'month': return [mo + '-01', mo + '-31'];
    case 'lastmonth': return [lm + '-01', lm + '-31'];
    case 'year': return [y + '-01-01', y + '-12-31'];
    case 'lastyear': return [(+y - 1) + '-01-01', (+y - 1) + '-12-31'];
    case 'custom': return [m.from || '0000', m.to || '9999'];
    default: return ['0000', '9999'];
  }
}
function selectClips(m) {
  const [a, z] = rangeFor(m);
  let list = S.clips.filter(c => !c.hidden && (S.project.type === 'freestyle' && m.range === 'all' ? true : (c.day && c.day >= a && c.day <= z)));
  if (m.favOnly) list = list.filter(c => c.favorite);
  if (!m.photos) list = list.filter(c => c.kind !== 'photo');
  if (S.project.type === 'journal') {
    list.sort((x, y) => x.day.localeCompare(y.day) || (x.order ?? 0) - (y.order ?? 0) || x.created - y.created);
    if (!m.allPerDay) { const seen = new Set(); list = list.filter(c => !seen.has(c.day) && seen.add(c.day)); }
  } else list.sort((x, y) => (x.order ?? 0) - (y.order ?? 0) || x.created - y.created);
  return list;
}
const sel = (key, opts, val) => `<select data-k="${key}">${Object.entries(opts).map(([k, l]) => `<option value="${k}" ${String(k) === String(val) ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
const sw = (key, label, val) => `<label class="switch"><span>${label}</span><input type="checkbox" data-k="${key}" ${val ? 'checked' : ''}></label>`;

async function renderMash(v) {
  const m = S.project.mash, P = S.project;
  const music = await db.kvGet('music', []);
  const mashes = (await db.all('mashes')).filter(x => x.projectId === P.id).sort((a, b) => b.created - a.created);
  const ranges = P.type === 'journal' ? { week: 'Last 7 days', month: 'This month', lastmonth: 'Last month', year: 'This year', lastyear: 'Last year', all: 'All time', custom: 'Custom' } : { all: 'Everything', custom: 'By date' };
  v.innerHTML = `
    <div class="label" style="margin-top:4px">What to include</div>
    <div class="chips scroll">${Object.entries(ranges).map(([k, l]) => `<button class="chip ${m.range === k ? 'on' : ''}" data-range="${k}">${l}</button>`).join('')}</div>
    ${m.range === 'custom' ? `<div class="row" style="margin-top:10px"><input class="input" type="date" data-k="from" value="${m.from}"><span class="muted">to</span><input class="input" type="date" data-k="to" value="${m.to}"></div>` : ''}
    <div class="list" style="margin-top:12px">
      ${sw('favOnly', 'Favorites only', m.favOnly)}
      ${P.type === 'journal' ? sw('allPerDay', 'Every snippet per day (not just the main one)', m.allPerDay) : ''}
      ${sw('photos', 'Include photos', m.photos)}
      <label class="switch"><span>Snippet length</span>${sel('forceLen', { 0: 'As recorded', 0.2: '0.2s (flipbook)', 0.5: '0.5s', 1: '1s', 2: '2s', 3: '3s', 5: '5s', 10: '10s' }, m.forceLen)}</label>
    </div>

    <div class="label">Look</div>
    <div class="list">
      <label class="switch"><span>Shape</span>${sel('aspect', { '9:16': 'Vertical 9:16', '4:5': 'Portrait 4:5', '1:1': 'Square', '16:9': 'Wide 16:9' }, m.aspect)}</label>
      <label class="switch"><span>Quality</span>${sel('res', { 720: '720p', 1080: '1080p HD', 2160: '4K' }, m.res)}</label>
      <label class="switch"><span>Filter</span>${sel('filter', Object.fromEntries(Object.entries(FILTERS).map(([k, f]) => [k, f.name])), m.filter)}</label>
      <label class="switch"><span>Transitions</span>${sel('transition', { cut: 'Hard cut', crossfade: 'Crossfade', dip: 'Dip to black' }, m.transition)}</label>
      ${sw('kenBurns', 'Slow zoom on photos', m.kenBurns)}
    </div>

    <div class="label">Text</div>
    <div class="list">
      ${sw('stamp', 'Date stamp', m.stamp)}
      ${m.stamp ? `<label class="switch"><span>Style</span>${sel('stampStyle', { clean: 'Clean', retro: 'Camcorder' }, m.stampStyle)}</label>
      ${m.stampStyle !== 'retro' ? `<label class="switch"><span>Format</span>${sel('dateFormat', Object.fromEntries(Object.entries(DATE_FORMATS).filter(([k]) => k !== 'retro')), m.dateFormat)}</label>` : ''}
      <label class="switch"><span>Corner</span>${sel('stampPos', { bl: 'Bottom left', br: 'Bottom right', tl: 'Top left', tr: 'Top right' }, m.stampPos)}</label>
      <label class="switch"><span>Size</span>${sel('stampSize', { s: 'Small', m: 'Medium', l: 'Large' }, m.stampSize)}</label>
      <div class="switch"><span>Color</span><div class="swatches">${['#ffffff', '#ffb347', '#f5d76e', '#9fe0c0', '#111111'].map(c => `<button data-color="${c}" class="${m.stampColor === c ? 'on' : ''}" style="background:${c}" aria-label="${c}"></button>`).join('')}</div></div>` : ''}
      ${sw('showCaption', 'Captions', m.showCaption)}
      ${sw('showLocation', 'Location under date', m.showLocation)}
    </div>
    <div class="card" style="margin-top:10px">
      <label class="field"><span>Title card</span><input class="input" data-k="title" value="${esc(m.title)}" placeholder="e.g. My 2026"></label>
      <label class="field"><span>Subtitle</span><input class="input" data-k="subtitle" value="${esc(m.subtitle)}" placeholder="e.g. one second a day"></label>
      <label class="field" style="margin:0"><span>End card</span><input class="input" data-k="endText" value="${esc(m.endText)}" placeholder="Optional — no branding unless you add it"></label>
    </div>

    <div class="label">Music</div>
    <div class="list">
      <button class="item" data-music="none"><span class="sw" style="background:${m.music === 'none' ? 'var(--accent)' : 'var(--line)'}"></span><div class="grow t">No music</div></button>
      ${Object.entries(TRACKS).map(([k, t]) => `<div class="item"><button class="row grow" data-music="${k}" style="text-align:left"><span class="sw" style="background:${m.music === k ? 'var(--accent)' : 'var(--line)'}"></span><div><div class="t">${t.name}</div><div class="s">${t.mood} · made in the app, royalty-free</div></div></button><button class="btn sm ghost" data-listen="${k}">Listen</button></div>`).join('')}
      ${music.map(t => `<div class="item"><button class="row grow" data-music="${t.id}" style="text-align:left"><span class="sw" style="background:${m.music === t.id ? 'var(--accent)' : 'var(--line)'}"></span><div><div class="t">${esc(t.name)}</div><div class="s">Your music · ${fmtDur(t.duration || 0)}</div></div></button><button class="btn sm ghost" data-delmusic="${t.id}">Remove</button></div>`).join('')}
      <button class="item" data-a="addmusic"><span class="sw" style="background:var(--line)"></span><div class="t link">+ Add your own song</div></button>
    </div>
    <div class="card" style="margin-top:10px">
      <div class="slider-row"><span>Music</span><input type="range" min="0" max="1" step="0.05" value="${m.musicVolume}" data-k="musicVolume"><output>${Math.round(m.musicVolume * 100)}%</output></div>
      <div class="slider-row" style="margin-top:8px"><span>Clip sound</span><input type="range" min="0" max="1.5" step="0.05" value="${m.clipVolume}" data-k="clipVolume"><output>${Math.round(m.clipVolume * 100)}%</output></div>
      ${music.find(t => t.id === m.music) ? `<div class="slider-row" style="margin-top:8px"><span>Song starts</span><input type="range" min="0" max="${Math.max(1, (music.find(t => t.id === m.music).duration || 60) - 5)}" step="1" value="${m.musicOffset}" data-k="musicOffset"><output>${fmtDur(m.musicOffset)}</output></div>` : ''}
    </div>

    <div class="sticky-actions">
      <div class="summary"><span data-sum></span><span>${m.res === 2160 ? '4K' : m.res + 'p'} · ${m.aspect}</span></div>
      <div class="btns"><button class="btn" data-a="preview">Preview</button><button class="btn primary" data-a="export">Make the movie</button></div>
    </div>
    ${mashes.length ? `<div class="label">Your movies</div><div class="list">${mashes.map(x => `<div class="item"><div class="grow"><div class="t">${esc(x.name)}</div><div class="s mono">${fmtDur(x.duration)} · ${fmtSize(x.blob.size)} · ${new Date(x.created).toLocaleDateString()}</div></div><button class="btn sm" data-play="${x.id}">Play</button><button class="btn sm" data-share="${x.id}">Save</button><button class="btn sm ghost" data-del="${x.id}">✕</button></div>`).join('')}</div>` : ''}
    <div style="height:20px"></div>`;
  const summary = () => { const list = selectClips(m); const segs = list.map(c => ({ dur: m.forceLen ? (c.kind === 'video' ? Math.min(m.forceLen, c.dur || 1) : m.forceLen) : (c.dur || 1) })); const t = Mash.estimate(segs, m); $('[data-sum]', v).textContent = `${list.length} snippet${list.length === 1 ? '' : 's'} · ${fmtDur(list.length ? t : 0)}`; return list; };
  summary();
  const save = async (rerender) => { await db.put('projects', P); if (rerender) renderMash(v); else summary(); };
  v.oninput = e => { const k = e.target.dataset.k; if (!k || e.target.type !== 'range') return; m[k] = +e.target.value; const o = e.target.nextElementSibling; if (o) o.textContent = k === 'musicOffset' ? fmtDur(m[k]) : Math.round(m[k] * 100) + '%'; save(false); };
  v.onchange = e => {
    const k = e.target.dataset.k; if (!k || e.target.type === 'range') return;
    const el = e.target; m[k] = el.type === 'checkbox' ? el.checked : (['res', 'forceLen'].includes(k) ? +el.value : el.value);
    save(['stamp', 'stampStyle', 'aspect'].includes(k));
  };
  v.onclick = async e => {
    const t = e.target;
    const r = t.closest('[data-range]'); if (r) { m.range = r.dataset.range; return save(true); }
    const c = t.closest('[data-color]'); if (c) { m.stampColor = c.dataset.color; return save(true); }
    const mu = t.closest('[data-music]'); if (mu) { m.music = mu.dataset.music; m.musicOffset = 0; return save(true); }
    const li = t.closest('[data-listen]'); if (li) { unlock(); const ac = audioCtx(); const g = ac.createGain(); g.gain.value = 1.2; g.connect(ac.destination); g.gain.setValueAtTime(1.2, ac.currentTime + 7); g.gain.linearRampToValueAtTime(0, ac.currentTime + 8); playTrack(ac, g, li.dataset.listen, ac.currentTime + 0.05, 8); setTimeout(() => g.disconnect(), 9000); toast(`Playing ${TRACKS[li.dataset.listen].name}`, 1500); return; }
    const dm = t.closest('[data-delmusic]'); if (dm) { const list = (await db.kvGet('music', [])).filter(x => x.id !== dm.dataset.delmusic); await db.kvSet('music', list); await db.del('media', dm.dataset.delmusic); if (m.music === dm.dataset.delmusic) m.music = 'none'; return save(true); }
    const pl = t.closest('[data-play]'); if (pl) { const x = await db.get('mashes', pl.dataset.play); return showMovie(x.blob, x.name, false); }
    const sh = t.closest('[data-share]'); if (sh) { const x = await db.get('mashes', sh.dataset.share); return shareOrSave(x.blob, x.file); }
    const dl = t.closest('[data-del]'); if (dl) { if (await confirmSheet('Delete this movie? Your snippets stay.')) { await db.del('mashes', dl.dataset.del); renderMash(v); } return; }
    const b = t.closest('[data-a]'); if (!b) return;
    if (b.dataset.a === 'addmusic') {
      const f = await pickFile('#musicPick'); if (!f) return;
      const bb = busy('Adding song…');
      try {
        const ac = audioCtx(); const buf = await ac.decodeAudioData(await f.arrayBuffer());
        const id = uid(); await db.put('media', { id, blob: f });
        const list = await db.kvGet('music', []); list.push({ id, name: f.name.replace(/\.[^.]+$/, ''), duration: buf.duration }); await db.kvSet('music', list);
        m.music = id; m.musicOffset = 0; bb.done(); save(true);
      } catch (err) { bb.done(); toast('Couldn’t read that audio file'); }
      return;
    }
    if (b.dataset.a === 'preview' || b.dataset.a === 'export') {
      const list = summary(); if (!list.length) return toast('No snippets in that range');
      unlockPool();
      runMash(list, b.dataset.a === 'export');
    }
  };
}

async function runMash(list, record) {
  const P = S.project, m = P.mash;
  const [aw, ah] = ASPECTS[m.aspect] || [9, 16];
  const short = record ? m.res : 540;
  const W = aw < ah ? short : Math.round(short * aw / ah), H = aw < ah ? Math.round(short * ah / aw) : short;
  const even = n => Math.round(n / 2) * 2;
  if (record && !window.MediaRecorder) return toast('This browser can’t record video. Try Safari on iPhone or Chrome.');
  const w = full(`<div class="bar"><button class="dark-btn" data-a="x">${record ? 'Cancel' : 'Close'}</button><span class="mono small" data-t>${record ? 'Rendering…' : ''}</span><span style="width:64px"></span></div>
    <div class="preview-stage"><canvas width="${even(W)}" height="${even(H)}" style="${record ? 'max-height:56dvh' : ''}"></canvas></div>
    ${record ? `<div style="padding:14px 16px calc(18px + var(--safe-b))"><div class="progress" style="background:#333"><i></i></div><p class="small" style="opacity:.7;text-align:center;margin:10px 0 0">Movies render in real time. Keep this screen open and awake.</p></div>` : ''}`);
  let musicBuffer = null;
  if (m.music && !TRACKS[m.music] && m.music !== 'none') {
    try { const md = await db.get('media', m.music); musicBuffer = await audioCtx().decodeAudioData(await md.blob.arrayBuffer()); } catch (e) { toast('Couldn’t load your song — continuing without it'); }
  }
  const segs = await segmentsFor(list, m);
  const r0 = rangeFor(m);
  const mash = new Mash($('canvas', w), segs, { ...m, musicBuffer, music: musicBuffer || TRACKS[m.music] ? m.music : 'none', pool });
  let lock = null; try { lock = await navigator.wakeLock?.request('screen'); } catch (e) {}
  let cancelled = false;
  w.onclick = e => { if (e.target.closest('[data-a=x]')) { cancelled = true; mash.stop(); } };
  const blob = await mash.run({ record, monitor: !record || true, onProgress: p => { const t = $('[data-t]', w); if (t) t.textContent = `${fmtDur(p * mash.total)} / ${fmtDur(mash.total)}`; const i = $('.progress i', w); if (i) i.style.width = (p * 100) + '%'; } });
  lock && lock.release().catch(() => {});
  w.remove();
  if (!record || cancelled || !blob) return;
  const label = m.title || (m.range === 'custom' ? `${fmtDate(r0[0])} – ${fmtDate(r0[1])}` : { week: 'Last 7 days', month: MONTHS[+today().slice(5, 7) - 1] + ' ' + today().slice(0, 4), lastmonth: 'Last month', year: today().slice(0, 4), lastyear: String(+today().slice(0, 4) - 1), all: 'All time' }[m.range] || 'Movie');
  const name = `${P.name} — ${label}`;
  const file = `${(P.name + '-' + label).replace(/[^\w-]+/g, '-').replace(/-+/g, '-').toLowerCase()}.${extFor(blob.type)}`;
  const rec = { id: uid(), projectId: P.id, name, file, created: Date.now(), duration: mash.total, blob };
  try { await db.put('mashes', rec); } catch (e) { toast('Phone storage is full — save the movie now'); }
  showMovie(blob, name, true, file);
  if (S.tab === 'mash') render();
}
function showMovie(blob, name, fresh, file = name.replace(/[^\w-]+/g, '-') + '.' + extFor(blob.type)) {
  const u = URL.createObjectURL(blob);
  const w = full(`<div class="bar"><button class="dark-btn" data-a="x">Done</button><b class="small">${esc(name)}</b><span style="width:50px"></span></div>
    <div class="preview-stage"><video src="${u}" controls playsinline autoplay style="max-width:100%;max-height:70dvh"></video></div>
    <div style="padding:14px 16px calc(18px + var(--safe-b))" class="btns"><button class="btn primary" data-a="share">Save / Share</button><button class="btn" data-a="dl">Download</button></div>`);
  w.onclick = e => { const b = e.target.closest('[data-a]'); if (!b) return; if (b.dataset.a === 'x') { w.remove(); URL.revokeObjectURL(u); } else if (b.dataset.a === 'share') shareOrSave(blob, file); else download(blob, file); };
  if (fresh) toast(`Done — ${fmtSize(blob.size)}`);
}

// ---------- PROJECTS ----------
async function renderProjects(v) {
  const counts = new Map();
  (await db.all('clips')).forEach(c => counts.set(c.projectId, (counts.get(c.projectId) || 0) + 1));
  v.innerHTML = `
    <div class="list">${S.projects.map(p => `<button class="item" data-p="${p.id}"><span class="sw" style="background:${p.color}"></span><div class="grow"><div class="t">${esc(p.name)} ${p.id === S.project.id ? '<span class="small mono muted">· open</span>' : ''}</div><div class="s">${p.type === 'journal' ? 'Journal · one day at a time' : 'Freestyle · any moments'} · ${counts.get(p.id) || 0} snippets</div></div>${ICON.right.replace('<svg', '<svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"')}</button>`).join('')}</div>
    <button class="btn block" style="margin-top:12px" data-a="new">+ New project</button>
    <div class="label">Collaborate</div>
    <div class="card small">Make a movie together: each person exports a <b>pack</b> from their project and sends it (AirDrop, Messages, Drive). Importing a pack adds their snippets — tagged with their name — into whichever project you choose.
      <div class="btns" style="margin-top:10px"><button class="btn sm" data-a="import">Import a pack</button></div></div>`;
  v.onclick = e => { const p = e.target.closest('[data-p]'); if (p) return projectSheet(S.projects.find(x => x.id === p.dataset.p)); const b = e.target.closest('[data-a]'); if (!b) return; if (b.dataset.a === 'new') newProjectSheet(); if (b.dataset.a === 'import') importPackFlow(); };
}
function newProjectSheet() {
  let type = 'journal', color = COLORS[S.projects.length % COLORS.length];
  const s = sheet(`<h2>New project</h2>
    <label class="field"><span>Name</span><input class="input" data-n placeholder="e.g. Seminary year, Jordan trip, Baby’s first year"></label>
    <div class="field"><span>Type</span><div class="chips"><button class="chip on" data-t="journal">Journal</button><button class="chip" data-t="freestyle">Freestyle</button></div><div class="small muted" data-desc>One snippet (or more) per calendar day, with streaks and a calendar.</div></div>
    <div class="field"><span>Color</span><div class="swatches">${COLORS.map(c => `<button data-c="${c}" class="${c === color ? 'on' : ''}" style="background:${c}"></button>`).join('')}</div></div>
    <button class="btn primary block" data-a="make">Create</button>`);
  s.el.onclick = async e => {
    const t = e.target.closest('[data-t]'); if (t) { type = t.dataset.t; $$('[data-t]', s.el).forEach(x => x.classList.toggle('on', x === t)); $('[data-desc]', s.el).textContent = type === 'journal' ? 'One snippet (or more) per calendar day, with streaks and a calendar.' : 'Any moments in any order — trips, events, a wedding, a move.'; return; }
    const c = e.target.closest('[data-c]'); if (c) { color = c.dataset.c; $$('[data-c]', s.el).forEach(x => x.classList.toggle('on', x === c)); return; }
    if (e.target.closest('[data-a=make]')) {
      const name = $('[data-n]', s.el).value.trim() || (type === 'journal' ? 'New journal' : 'New freestyle');
      const p = newProjectObj(name, type, color); await db.put('projects', p); S.projects.push(p); s.close(); await switchProject(p.id); go('days');
    }
  };
}
function projectSheet(p) {
  const s = sheet(`<h2>${esc(p.name)}</h2>
    <label class="field"><span>Name</span><input class="input" data-n value="${esc(p.name)}"></label>
    <label class="field"><span>Default snippet length</span><select class="input" data-len>${LENGTHS.map(l => `<option value="${l}" ${l === p.snippetLen ? 'selected' : ''}>${l} second${l === 1 ? '' : 's'}</option>`).join('')}</select></label>
    <div class="btns"><button class="btn primary" data-a="open">Open</button><button class="btn" data-a="pack">Export pack</button><button class="btn" data-a="import">Import into this</button></div>
    ${S.projects.length > 1 ? '<button class="btn block ghost" style="margin-top:10px;color:var(--rec)" data-a="del">Delete project</button>' : ''}`, { onClose: () => render() });
  s.el.onchange = async e => { if (e.target.matches('[data-n]')) p.name = e.target.value.trim() || p.name; if (e.target.matches('[data-len]')) p.snippetLen = +e.target.value; await db.put('projects', p); };
  s.el.onclick = async e => {
    const b = e.target.closest('[data-a]'); if (!b) return;
    if (b.dataset.a === 'open') { s.close(); await switchProject(p.id); go('days'); }
    if (b.dataset.a === 'pack') {
      if (!S.settings.name) { toast('Add your name in Settings first, so friends see who made each snippet', 3200); return; }
      const bb = busy('Packing…'); const blob = await buildPack({ projectIds: [p.id], author: S.settings.name }); bb.done();
      shareOrSave(blob, `${p.name.replace(/[^\w-]+/g, '-')}-${S.settings.name.replace(/\W+/g, '')}.dailies`);
    }
    if (b.dataset.a === 'import') { s.close(); importPackFlow(p.id); }
    if (b.dataset.a === 'del') {
      if (!(await confirmSheet(`Delete “${p.name}” and all its snippets?`))) return;
      const clips = await db.byIndex('clips', 'project', p.id);
      for (const c of clips) { await db.del('clips', c.id); await db.del('media', c.mediaId); if (c.thumbId) await db.del('media', c.thumbId); }
      await db.del('projects', p.id); S.projects = S.projects.filter(x => x.id !== p.id);
      s.el.parentElement && s.el.parentElement.remove();
      if (S.project.id === p.id) await switchProject(S.projects[0].id, false);
      render(); toast('Project deleted');
    }
  };
}
async function importPackFlow(targetId) {
  const f = await pickFile('#packPick'); if (!f) return;
  try {
    const h = await readPack(f);
    if (!targetId) {
      const s = sheet(`<h2>Import ${h.clips.length} snippets${h.author ? ' from ' + esc(h.author) : ''}</h2><p class="small muted">Choose where they go.</p><div class="list">${S.projects.map(p => `<button class="item" data-p="${p.id}"><span class="sw" style="background:${p.color}"></span><div class="t">${esc(p.name)}</div></button>`).join('')}<button class="item" data-p="__new"><span class="sw" style="background:var(--line)"></span><div class="t">As its own project${h.projects[0] ? ` (“${esc(h.projects[0].name)}”)` : ''}</div></button></div>`);
      s.el.onclick = async e => { const b = e.target.closest('[data-p]'); if (!b) return; s.close(); await doImport(h, b.dataset.p === '__new' ? null : b.dataset.p); };
    } else await doImport(h, targetId);
  } catch (e) { toast(e.message, 3000); }
}
async function doImport(h, targetId) {
  const bb = busy('Importing…');
  const n = await importPack(h, { targetProjectId: targetId });
  S.projects = (await db.all('projects')).sort((a, b) => a.created - b.created);
  if (targetId) await switchProject(targetId, false);
  else {
    // a restore into a fresh install: drop the untouched starter project and open what came in
    const starter = S.projects.find(p => p.auto && p.id !== (h.projects[0] || {}).id);
    if (starter && !(await db.byIndex('clips', 'project', starter.id)).length && h.projects.length) { await db.del('projects', starter.id); S.projects = S.projects.filter(p => p !== starter); }
    await switchProject((h.projects[0] || S.project).id, false);
  }
  bb.done(); render(); toast(`Added ${n} snippet${n === 1 ? '' : 's'}`);
}

// ---------- SETTINGS ----------
async function renderSettings(v) {
  const st = S.settings;
  let est = null; try { est = await navigator.storage?.estimate(); } catch (e) {}
  const persisted = await navigator.storage?.persisted?.().catch(() => false);
  v.innerHTML = `
    <div class="label" style="margin-top:4px">You</div>
    <div class="list">
      <label class="switch"><span>Your name</span><input type="text" data-s="name" value="${esc(st.name)}" placeholder="Shown on shared snippets"></label>
      <label class="switch"><span>Appearance</span>${sel('theme', { auto: 'Match phone', light: 'Light', dark: 'Dark' }, st.theme).replace('data-k', 'data-s')}</label>
      <label class="switch"><span>Default snippet length</span>${sel('defaultLen', Object.fromEntries(LENGTHS.map(l => [l, l + 's'])), st.defaultLen).replace('data-k', 'data-s')}</label>
    </div>
    <div class="label">Reminder</div>
    <div class="card"><div class="row between"><span>Daily at</span><input type="time" class="input" style="width:130px" data-s="reminderTime" value="${st.reminderTime}"></div>
      <p class="small muted" style="margin:10px 0">Adds a repeating event with an alert to your phone’s calendar, so the nudge works even when this app is closed.</p>
      <button class="btn block" data-a="ics">Add reminder to calendar</button></div>
    <div class="label">Backup</div>
    <div class="card">
      <p class="small" style="margin-top:0">Everything lives on this phone${est ? ` — using <b>${fmtSize(est.usage || 0)}</b>` : ''}. ${persisted ? 'Storage is marked <b>persistent</b>.' : 'Storage isn’t marked persistent yet.'} Back up to Files or Drive now and then — clearing Safari data would erase it.</p>
      <div class="btns"><button class="btn primary" data-a="backup">Back up everything</button><button class="btn" data-a="restore">Restore</button></div>
      ${persisted ? '' : '<button class="btn block ghost small" style="margin-top:8px" data-a="persist">Ask to keep storage</button>'}
    </div>
    <div class="label">About</div>
    <div class="list">
      <button class="item" data-a="tour"><div class="t">Show the tour again</div></button>
      <button class="item" data-a="features"><div class="grow"><div class="t">Everything that’s in here</div><div class="s">1SE Pro features + extras from other apps</div></div></button>
    </div>
    <p class="small muted mono" style="text-align:center;margin:18px 0">Dailies · no account · no ads · no watermark</p>`;
  v.onchange = async e => { const k = e.target.dataset.s; if (!k) return; st[k] = k === 'defaultLen' ? +e.target.value : e.target.value; await saveSettings(); if (k === 'theme') applyTheme(); };
  v.onclick = async e => {
    const b = e.target.closest('[data-a]'); if (!b) return;
    switch (b.dataset.a) {
      case 'ics': download(reminderICS(st.reminderTime), 'dailies-reminder.ics'); break;
      case 'backup': { const bb = busy('Packing everything…'); const blob = await buildPack(); bb.done(); shareOrSave(blob, `dailies-backup-${today()}.dailies`); break; }
      case 'restore': importPackFlow().catch(() => {}); break;
      case 'persist': { const ok = await navigator.storage?.persist?.(); toast(ok ? 'Storage will be kept' : 'Your browser decides — add Dailies to your Home Screen to help'); renderSettings(v); break; }
      case 'tour': tour(); break;
      case 'features': featuresSheet(); break;
    }
  };
}
function reminderICS(time) {
  const [hh, mm] = time.split(':');
  const d = new Date(); d.setDate(d.getDate() + (d.getHours() * 60 + d.getMinutes() >= +hh * 60 + +mm ? 1 : 0));
  const ds = dayKey(d).replace(/-/g, '');
  const stamp = new Date().toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
  const body = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Dailies//EN', 'BEGIN:VEVENT', `UID:dailies-${Date.now()}@dailies`, `DTSTAMP:${stamp}`, `DTSTART:${ds}T${hh}${mm}00`, `DTEND:${ds}T${hh}${String(+mm + 5).padStart(2, '0').slice(0, 2)}00`, 'RRULE:FREQ=DAILY', 'SUMMARY:Record today’s second', 'DESCRIPTION:Open Dailies and catch one second of today.', 'BEGIN:VALARM', 'TRIGGER:PT0M', 'ACTION:DISPLAY', 'DESCRIPTION:Record today’s second', 'END:VALARM', 'END:VEVENT', 'END:VCALENDAR'];
  return new Blob([body.join('\r\n')], { type: 'text/calendar' });
}
function featuresSheet() {
  const rows = [
    ['Unlimited projects (Journal + Freestyle)', '1SE Pro'], ['Snippets up to 10 seconds', '1SE Pro'], ['Multiple snippets per day, pick the main one', '1SE Pro · Leap Second'], ['Brightness + volume per snippet', '1SE Pro'], ['Filters per snippet and per movie', '1SE Pro · Clip'], ['Your own music + built-in royalty-free tracks', '1SE Pro'], ['Date stamps optional, no logo ever', '1SE Pro'], ['720p / 1080p / 4K export', '1SE Pro · Leap Second'], ['Backup & restore', '1SE Pro'], ['Shared projects via packs', '1SE Pro · Leap Second · Clip'], ['No ads', '1SE Pro'],
    ['Smart-Fill from your library by capture date', '1SE · Clip Auto-Fill'], ['Rotate, flip, fill or fit', '1SE'], ['Daily notes, hide clips, reminders', '1SE · Clip'],
    ['Streaks, year grid, On This Day', 'Clip'], ['Captions + location on video', 'One Second Diary'], ['Date format, color, corner, camcorder style', 'One Second Diary'], ['Ghost overlay of your last shot, grid, face guide', 'TimeShutter · FaceLapse · Everyday'], ['0.2s flipbook mode (selfie time-lapse)', 'Daily-selfie apps'], ['Title + end cards, crossfade / dip transitions', 'extra'], ['Vertical, 4:5, square or wide movies', 'extra'],
  ];
  sheet(`<h2>What’s in Dailies</h2><div class="list">${rows.map(([a, b]) => `<div class="item"><div class="grow"><div class="t" style="font-size:15px">${a}</div><div class="s">${b}</div></div></div>`).join('')}</div>
  <p class="small muted">Not possible in a web app: Live Photos, scanning your whole camera roll automatically, and push notifications without a server. Supabase sync can come later for real-time shared projects.</p>`);
}

// ---------- switcher + tour ----------
function projectSwitcher() {
  const s = sheet(`<h2>Projects</h2><div class="list">${S.projects.map(p => `<button class="item" data-p="${p.id}"><span class="sw" style="background:${p.color}"></span><div class="grow t">${esc(p.name)}</div>${p.id === S.project.id ? '<span class="small mono muted">open</span>' : ''}</button>`).join('')}</div><button class="btn block" style="margin-top:12px" data-a="new">+ New project</button>`);
  s.el.onclick = async e => { const p = e.target.closest('[data-p]'); if (p) { s.close(); await switchProject(p.dataset.p); } else if (e.target.closest('[data-a=new]')) { s.close(); newProjectSheet(); } };
}
function tour() {
  const slides = [
    ['1s', 'One second a day', 'Catch a second of every day. Over months it becomes the movie of your life — the ordinary days included.'],
    ['●', 'Record or choose', 'Tap the red button to film with a ghost of yesterday’s shot to line up, or pick any video or photo and slide the window to the second you want.'],
    ['±', 'Make it yours', 'Up to 10 seconds, several per day, brightness, volume, filters, rotate, captions, location and a note just for you.'],
    ['▶', 'Mash it', 'Pick a week, month, year or custom range, add a song or a built-in track, and export in up to 4K — no watermark.'],
    ['⤓', 'It stays on your phone', 'No account, no cloud. Add Dailies to your Home Screen, and back up from Settings every so often.'],
  ];
  let i = 0;
  const s = sheet('<div data-body></div>', { onClose: () => { S.settings.toured = true; saveSettings(); } });
  const draw = () => {
    const [ill, t, p] = slides[i];
    $('[data-body]', s.el).innerHTML = `<div class="tour"><div class="ill">${ill}</div><h2>${t}</h2><p>${p}</p><div class="dots">${slides.map((_, k) => `<i class="${k === i ? 'on' : ''}"></i>`).join('')}</div><div class="btns">${i ? '<button class="btn" data-a="back">Back</button>' : '<button class="btn" data-a="skip">Skip</button>'}<button class="btn primary" data-a="next">${i === slides.length - 1 ? 'Start' : 'Next'}</button></div></div>`;
  };
  draw();
  s.el.onclick = e => { const b = e.target.closest('[data-a]'); if (!b) return; if (b.dataset.a === 'next') { if (i === slides.length - 1) s.close(); else { i++; draw(); } } else if (b.dataset.a === 'back') { i--; draw(); } else s.close(); };
}

boot().catch(e => { console.error(e); document.body.insertAdjacentHTML('beforeend', `<p style="padding:20px">Couldn’t start: ${esc(e.message)}</p>`); });
window.__dailies = { S, db };
