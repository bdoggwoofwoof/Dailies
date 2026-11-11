// Dailies — mash engine: draws snippets to a canvas in real time, mixes audio, records the result.
import { audioCtx, loadVideo, seek, loadImage, pickMime } from './media.js';

export const FILTERS = {
  none: { name: 'None', css: '' },
  warm: { name: 'Warm', css: 'sepia(0.22) saturate(1.2) brightness(1.02)' },
  film: { name: 'Film', css: 'contrast(1.08) saturate(0.85) sepia(0.14)' },
  fade: { name: 'Faded', css: 'contrast(0.86) brightness(1.08) saturate(0.8)' },
  cool: { name: 'Cool', css: 'hue-rotate(-12deg) saturate(0.92) brightness(1.03)' },
  vivid: { name: 'Vivid', css: 'saturate(1.45) contrast(1.06)' },
  mono: { name: 'Mono', css: 'grayscale(1) contrast(1.1)' },
  noir: { name: 'Noir', css: 'grayscale(1) contrast(1.45) brightness(0.9)' },
};
export const canFilter = typeof CanvasRenderingContext2D !== 'undefined' && 'filter' in CanvasRenderingContext2D.prototype;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const DATE_FORMATS = {
  long: 'Mar 4, 2026', weekday: 'Wed, Mar 4', short: '3/4/26', iso: '2026-03-04', intl: '4 Mar 2026', retro: 'MAR 04 2026',
};
export function fmtDate(day, f = 'long') {
  if (!day) return '';
  const [y, m, d] = day.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  const p = n => String(n).padStart(2, '0');
  switch (f) {
    case 'weekday': return `${DAYS[dt.getDay()]}, ${MONTHS[m - 1]} ${d}`;
    case 'short': return `${m}/${d}/${String(y).slice(2)}`;
    case 'iso': return day;
    case 'intl': return `${d} ${MONTHS[m - 1]} ${y}`;
    case 'retro': return `${MONTHS[m - 1].toUpperCase()} ${p(d)} ${y}`;
    default: return `${MONTHS[m - 1]} ${d}, ${y}`;
  }
}

const _tiny = document.createElement('canvas');
_tiny.width = 24; _tiny.height = 24;

// Draw one snippet frame into the target (handles rotate/flip/fit/fill/brightness/filters/zoom)
export function drawClip(ctx, src, sw, sh, W, H, clip, { alpha = 1, mashFilter = '', zoom = 1 } = {}) {
  if (!src || !sw || !sh) return;
  const rot = ((clip.rotate || 0) % 360 + 360) % 360;
  const rw = rot % 180 ? sh : sw, rh = rot % 180 ? sw : sh;
  const cover = Math.max(W / rw, H / rh), contain = Math.min(W / rw, H / rh);
  const scale = (clip.fill === false ? contain : cover) * zoom;
  ctx.save();
  ctx.globalAlpha = alpha;
  const b = 1 + (clip.brightness || 0) / 100;
  const filt = [b !== 1 ? `brightness(${b.toFixed(2)})` : '', (FILTERS[clip.filter] || {}).css || '', mashFilter].filter(Boolean).join(' ');
  if (clip.fill === false) {
    // soft blurred backdrop instead of black bars
    const t = _tiny.getContext('2d');
    t.save(); t.translate(12, 12); t.rotate(rot * Math.PI / 180); if (clip.flip) t.scale(-1, 1);
    t.drawImage(src, -12 * (rot % 180 ? 1 : 1), -12, 24, 24); t.restore();
    ctx.imageSmoothingEnabled = true;
    if (canFilter) ctx.filter = 'brightness(0.6)';
    ctx.drawImage(_tiny, 0, 0, W, H);
  }
  if (canFilter) ctx.filter = filt || 'none';
  ctx.translate(W / 2, H / 2);
  ctx.rotate(rot * Math.PI / 180);
  if (clip.flip) ctx.scale(-1, 1);
  ctx.drawImage(src, -sw * scale / 2, -sh * scale / 2, sw * scale, sh * scale);
  ctx.restore();
  if (!canFilter && b !== 1) { // brightness fallback
    ctx.save(); ctx.globalAlpha = alpha * Math.min(0.6, Math.abs(b - 1)); ctx.fillStyle = b > 1 ? '#fff' : '#000'; ctx.fillRect(0, 0, W, H); ctx.restore();
  }
}

export function drawOverlays(ctx, W, H, seg, o, alpha = 1) {
  const u = Math.min(W, H) / 100; // 1% of short side
  const size = { s: 3.4, m: 4.4, l: 5.8 }[o.stampSize || 'm'] * u;
  const m = 4.5 * u;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.textBaseline = 'alphabetic';
  if (o.stamp && seg.day) {
    const retro = o.stampStyle === 'retro';
    const txt = fmtDate(seg.day, retro ? 'retro' : o.dateFormat);
    ctx.font = retro ? `600 ${size}px ui-monospace, "SF Mono", Menlo, monospace` : `650 ${size}px -apple-system, "Segoe UI", system-ui, sans-serif`;
    const pos = o.stampPos || 'bl';
    ctx.textAlign = pos.endsWith('r') ? 'right' : 'left';
    const x = pos.endsWith('r') ? W - m : m;
    let y = pos.startsWith('t') ? m + size : H - m;
    if (o.showCaption && seg.clip.caption && pos.startsWith('b')) y -= size * 1.9;
    ctx.fillStyle = o.stampColor || '#ffffff';
    ctx.shadowColor = retro ? (o.stampColor || '#ffb347') : 'rgba(0,0,0,.55)';
    ctx.shadowBlur = retro ? size * 0.5 : size * 0.35;
    ctx.fillText(txt, x, y);
    if (o.showLocation && seg.clip.location) {
      ctx.font = `500 ${size * 0.62}px -apple-system, system-ui, sans-serif`;
      ctx.fillText(seg.clip.location, x, pos.startsWith('t') ? y + size * 0.95 : y - size * 1.05);
    }
  }
  if (o.showCaption && seg.clip.caption) {
    ctx.font = `600 ${size * 0.95}px -apple-system, system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.shadowColor = 'rgba(0,0,0,.7)'; ctx.shadowBlur = size * 0.4;
    ctx.fillStyle = '#fff';
    wrapText(ctx, seg.clip.caption, W / 2, H - m - (o.stamp && (o.stampPos || 'bl').startsWith('b') ? 0 : 0), W * 0.8, size * 1.2);
  }
  ctx.restore();
}
function wrapText(ctx, text, x, yBottom, maxW, lh) {
  const words = text.split(/\s+/); const lines = []; let line = '';
  for (const w of words) { const t = line ? line + ' ' + w : w; if (ctx.measureText(t).width > maxW && line) { lines.push(line); line = w; } else line = t; }
  if (line) lines.push(line);
  lines.slice(-3).reverse().forEach((l, i) => ctx.fillText(l, x, yBottom - i * lh));
}

function drawCard(ctx, W, H, title, sub, alpha) {
  ctx.save(); ctx.fillStyle = '#0d0c0b'; ctx.fillRect(0, 0, W, H);
  ctx.globalAlpha = alpha; ctx.textAlign = 'center'; ctx.fillStyle = '#f3ece0';
  const u = Math.min(W, H) / 100;
  ctx.font = `700 ${8 * u}px -apple-system, system-ui, sans-serif`;
  wrapText(ctx, title || '', W / 2, H / 2 + (sub ? 0 : 3 * u), W * 0.82, 9 * u);
  if (sub) { ctx.font = `500 ${3.6 * u}px ui-monospace, Menlo, monospace`; ctx.fillStyle = '#e8a050'; ctx.fillText(sub, W / 2, H / 2 + 7 * u); }
  ctx.restore();
}

// ---------------- Music ----------------
export const TRACKS = {
  golden: { name: 'Golden Hour', mood: 'warm piano-pad, 72 bpm' },
  pocket: { name: 'Pocket', mood: 'lo-fi beat, 84 bpm' },
  drift: { name: 'Drift', mood: 'ambient, slow' },
  sunny: { name: 'Sunny Side', mood: 'bright pluck, 112 bpm' },
  hymn: { name: 'Vespers', mood: 'gentle organ chords, 60 bpm' },
};
const hz = n => 440 * Math.pow(2, (n - 69) / 12);
let _noise;
function noiseBuf(ac) { if (_noise) return _noise; const b = ac.createBuffer(1, ac.sampleRate, ac.sampleRate); const d = b.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; return (_noise = b); }

function tone(ac, out, f, t, dur, { type = 'sine', gain = 0.1, a = 0.01, r = 0.3, detune = 0, cutoff } = {}) {
  const o = ac.createOscillator(); o.type = type; o.frequency.value = f; o.detune.value = detune;
  const g = ac.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(gain, t + a);
  g.gain.setValueAtTime(gain, t + Math.max(a, dur - r)); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  let node = o;
  if (cutoff) { const f2 = ac.createBiquadFilter(); f2.type = 'lowpass'; f2.frequency.value = cutoff; o.connect(f2); node = f2; }
  node.connect(g); g.connect(out); o.start(t); o.stop(t + dur + 0.05);
}
function pluck(ac, out, f, t, { type = 'triangle', gain = 0.08, decay = 0.6 } = {}) {
  const o = ac.createOscillator(); o.type = type; o.frequency.value = f;
  const g = ac.createGain(); g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
  o.connect(g); g.connect(out); o.start(t); o.stop(t + decay + 0.05);
}
function kick(ac, out, t, gain = 0.5) {
  const o = ac.createOscillator(); const g = ac.createGain();
  o.frequency.setValueAtTime(130, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.14);
  g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
  o.connect(g); g.connect(out); o.start(t); o.stop(t + 0.4);
}
function noiseHit(ac, out, t, { type = 'highpass', freq = 7000, gain = 0.06, decay = 0.05 } = {}) {
  const s = ac.createBufferSource(); s.buffer = noiseBuf(ac);
  const f = ac.createBiquadFilter(); f.type = type; f.frequency.value = freq;
  const g = ac.createGain(); g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
  s.connect(f); f.connect(g); g.connect(out); s.start(t, Math.random() * 0.5); s.stop(t + decay + 0.02);
}

// chord tables (midi)
const PROG = {
  golden: [[48, 60, 64, 67, 71], [43, 59, 62, 67, 74], [45, 60, 64, 69, 72], [41, 60, 65, 69, 72]],
  pocket: [[43, 58, 62, 65, 69], [48, 58, 62, 64, 67], [41, 57, 60, 64, 67], [50, 57, 60, 65, 69]],
  sunny: [[48, 64, 67, 72], [43, 62, 67, 71], [45, 64, 69, 72], [41, 65, 69, 72]],
  hymn: [[48, 55, 64, 67], [41, 57, 65, 69], [43, 55, 62, 71], [48, 55, 64, 72], [45, 57, 64, 69], [41, 60, 65, 69], [43, 59, 62, 67], [48, 55, 60, 64]],
};
const PENTA = [60, 62, 64, 67, 69, 72, 74, 76, 79, 81];

// Returns a scheduler that fills `out` with the track from `start` (ac time) for `dur` seconds
export function playTrack(ac, out, id, start, dur) {
  const bpm = { golden: 72, pocket: 84, drift: 60, sunny: 112, hymn: 60 }[id] || 72;
  const beat = 60 / bpm;
  const end = start + dur;
  const delay = ac.createDelay(1.5); delay.delayTime.value = beat * 0.75;
  const fb = ac.createGain(); fb.gain.value = 0.32; const wet = ac.createGain(); wet.gain.value = 0.35;
  delay.connect(fb); fb.connect(delay); delay.connect(wet); wet.connect(out);
  let nextBeat = 0; // beat index
  const sched = () => {
    const horizon = ac.currentTime + 1.2;
    while (start + nextBeat * beat < Math.min(horizon, end)) {
      const t = start + nextBeat * beat; const i = nextBeat;
      const bar = Math.floor(i / 4), b = i % 4;
      if (id === 'golden') {
        const ch = PROG.golden[bar % 4];
        if (b === 0) { ch.slice(1).forEach(n => tone(ac, out, hz(n), t, beat * 4.1, { type: 'triangle', gain: 0.035, a: 0.6, r: 1.2, cutoff: 1800 })); tone(ac, out, hz(ch[0]), t, beat * 4, { gain: 0.09, a: 0.05, r: 0.8 }); }
        [0, 0.5].forEach((h, k) => { const n = ch[1 + ((i * 2 + k) % (ch.length - 1))] + 12; const tt = t + h * beat; pluck(ac, out, hz(n), tt, { type: 'sine', gain: 0.045, decay: 1.1 }); pluck(ac, delay, hz(n), tt, { type: 'sine', gain: 0.02, decay: 0.8 }); });
      } else if (id === 'pocket') {
        const ch = PROG.pocket[bar % 4];
        if (b === 0) ch.slice(1).forEach(n => tone(ac, out, hz(n), t + 0.02, beat * 2.6, { type: 'triangle', gain: 0.04, a: 0.02, r: 1, cutoff: 1400, detune: (Math.random() - 0.5) * 12 }));
        if (b === 2) ch.slice(1).forEach(n => tone(ac, out, hz(n), t + beat * 0.5, beat * 1.4, { type: 'triangle', gain: 0.03, a: 0.02, r: 0.6, cutoff: 1300 }));
        if (b === 0 || (b === 2 && bar % 2)) tone(ac, out, hz(ch[0] - 12), t, beat * 1.8, { gain: 0.12, a: 0.01, r: 0.4 });
        if (b === 0 || b === 2) kick(ac, out, t, 0.32); if (b === 2 && bar % 2 === 0) kick(ac, out, t + beat * 0.75, 0.2);
        if (b === 1 || b === 3) noiseHit(ac, out, t + 0.012, { type: 'bandpass', freq: 1800, gain: 0.12, decay: 0.18 });
        [0, 0.55].forEach(h => noiseHit(ac, out, t + h * beat, { gain: 0.03 }));
      } else if (id === 'drift') {
        if (i % 8 === 0) { const root = [45, 41, 48, 43][(i / 8) % 4]; [root, root + 7, root + 12 + 4, root + 19].forEach(n => tone(ac, out, hz(n), t, beat * 8.6, { gain: 0.03, a: 2.5, r: 3, cutoff: 1200 })); }
        if (Math.random() < 0.55) { const n = PENTA[Math.floor(Math.random() * PENTA.length)]; const tt = t + (Math.random() < 0.5 ? 0 : beat / 2); pluck(ac, out, hz(n), tt, { type: 'sine', gain: 0.035, decay: 2 }); pluck(ac, delay, hz(n), tt, { type: 'sine', gain: 0.03, decay: 1.5 }); }
      } else if (id === 'sunny') {
        const ch = PROG.sunny[bar % 4];
        for (let s = 0; s < 4; s++) { const n = ch[1 + ((i * 4 + s) % (ch.length - 1))] + (s === 3 ? 12 : 0); pluck(ac, out, hz(n), t + s * beat / 4, { type: 'square', gain: 0.018, decay: 0.22 }); }
        pluck(ac, out, hz(ch[0] - 12), t, { type: 'triangle', gain: 0.14, decay: beat * 0.9 });
        kick(ac, out, t, 0.25); if (b % 2) noiseHit(ac, out, t, { type: 'bandpass', freq: 2500, gain: 0.07, decay: 0.12 });
        noiseHit(ac, out, t + beat / 2, { gain: 0.025 });
      } else if (id === 'hymn') {
        if (b === 0 || b === 2) { const ch = PROG.hymn[Math.floor(i / 2) % 8]; ch.forEach((n, k) => { tone(ac, out, hz(n), t, beat * 2.05, { type: 'sine', gain: k ? 0.035 : 0.06, a: 0.25, r: 0.5 }); tone(ac, out, hz(n + 12), t, beat * 2.05, { type: 'sine', gain: 0.012, a: 0.3, r: 0.5 }); }); }
      }
      nextBeat++;
    }
  };
  sched();
  const iv = setInterval(() => { if (ac.currentTime > end) clearInterval(iv); else sched(); }, 250);
  return () => clearInterval(iv);
}

// ---------------- Mash engine ----------------
export class Mash {
  // segs: [{clip, blob, kind:'video'|'photo', start, dur, day}]
  constructor(canvas, segs, o) {
    this.c = canvas; this.ctx = canvas.getContext('2d'); this.segs = segs; this.o = o;
    this.W = canvas.width; this.H = canvas.height;
    this.xf = o.transition === 'crossfade' ? Math.min(0.4, ...segs.map(s => s.dur / 2.5)) : 0;
    this.titleDur = o.title ? 2.4 : 0; this.endDur = o.endText ? 2.4 : 0;
    let t = this.titleDur;
    segs.forEach((s, i) => { s.t0 = t; s.t1 = t + s.dur; t += s.dur - (i < segs.length - 1 ? this.xf : 0); });
    this.contentEnd = segs.length ? segs[segs.length - 1].t1 : this.titleDur;
    this.total = this.contentEnd + this.endDur;
    this.pool = o.pool; // 4 primed <video> elements
    this.stopped = false;
  }
  static estimate(segs, o) { const xf = o.transition === 'crossfade' ? 0.4 : 0; return segs.reduce((a, s) => a + s.dur, 0) - xf * Math.max(0, segs.length - 1) + (o.title ? 2.4 : 0) + (o.endText ? 2.4 : 0); }

  async prepare(i) {
    const s = this.segs[i]; if (!s || s.ready || s.loading) return; s.loading = true;
    if (!s.blob && s.load) s.blob = await s.load();
    s.url = URL.createObjectURL(s.blob);
    if (s.kind === 'photo') { s.img = await loadImage(s.url); s.sw = s.img.naturalWidth; s.sh = s.img.naturalHeight; }
    else {
      const el = this.pool[i % this.pool.length]; s.el = el;
      await loadVideo(s.url, el); await seek(el, s.start || 0); s.sw = el.videoWidth; s.sh = el.videoHeight;
    }
    s.ready = true;
  }
  release(i) { const s = this.segs[i]; if (!s || s.released) return; s.released = true; if (s.el) s.el.pause(); if (s.url) setTimeout(() => URL.revokeObjectURL(s.url), 500); s.img = null; s.blob = null; }

  async run({ record = false, monitor = true, onProgress } = {}) {
    const ac = audioCtx(); if (ac.state !== 'running') await ac.resume();
    const o = this.o;
    const master = ac.createGain(); master.gain.value = 1;
    const dest = record ? ac.createMediaStreamDestination() : null;
    if (dest) master.connect(dest); if (monitor) master.connect(ac.destination);
    const clipBus = ac.createGain(); clipBus.gain.value = o.clipVolume ?? 1; clipBus.connect(master);
    const musicBus = ac.createGain(); musicBus.gain.value = 0; musicBus.connect(master);
    // per-element sources (createMediaElementSource only once per element)
    this.pool.forEach(el => { if (!el._src) el._src = ac.createMediaElementSource(el); if (!el._gain) el._gain = ac.createGain(); el._src.disconnect(); el._src.connect(el._gain); el._gain.disconnect(); el._gain.connect(clipBus); el._gain.gain.value = 0; });

    for (let i = 0; i < Math.min(this.pool.length, this.segs.length); i++) await this.prepare(i);

    let rec, chunks = [], stopped, mime;
    if (record) {
      mime = pickMime();
      const vs = this.c.captureStream(30);
      const stream = new MediaStream([...vs.getVideoTracks(), ...dest.stream.getAudioTracks()]);
      const bps = { 720: 6e6, 1080: 12e6, 2160: 35e6 }[o.res] || 10e6;
      rec = new MediaRecorder(stream, { mimeType: mime || undefined, videoBitsPerSecond: bps, audioBitsPerSecond: 192000 });
      rec.ondataavailable = e => e.data.size && chunks.push(e.data);
      stopped = new Promise(r => rec.onstop = r);
    }
    // draw first frame before starting so the recording doesn't open on garbage
    this.drawAt(0);
    const t0 = ac.currentTime + 0.15;
    // music
    let stopMusic = () => {};
    const mv = o.musicVolume ?? 0.8;
    if (o.music && o.music !== 'none') {
      const mStart = t0, mEnd = t0 + this.total;
      musicBus.gain.setValueAtTime(0, mStart); musicBus.gain.linearRampToValueAtTime(mv, mStart + 0.8);
      musicBus.gain.setValueAtTime(mv, Math.max(mStart + 0.9, mEnd - 2.2)); musicBus.gain.linearRampToValueAtTime(0, mEnd);
      if (o.musicBuffer) {
        const src = ac.createBufferSource(); src.buffer = o.musicBuffer; src.loop = true;
        src.connect(musicBus); src.start(mStart, Math.min(o.musicOffset || 0, o.musicBuffer.duration - 0.1)); src.stop(mEnd + 0.1);
        stopMusic = () => { try { src.stop(); } catch (e) {} };
      } else if (TRACKS[o.music]) {
        const tGain = ac.createGain(); tGain.gain.value = 1.4; tGain.connect(musicBus);
        stopMusic = playTrack(ac, tGain, o.music, mStart, this.total + 0.2);
      }
    }
    if (rec) rec.start(250);
    this.startedAt = t0;
    const pf = (s) => (s.kind === 'video');
    await new Promise(resolve => {
      const tick = () => {
        if (this.stopped) return resolve();
        const t = ac.currentTime - t0;
        if (t >= this.total) { this.drawAt(this.total - 0.001); return resolve(); }
        this.segs.forEach((s, i) => {
          // prepare ahead once the element's previous user has finished
          const prev = this.segs[i - this.pool.length];
          if (!s.ready && !s.loading && (!prev || t >= prev.t1 + 0.05)) { if (prev) this.release(i - this.pool.length); this.prepare(i).catch(() => { s.failed = true; }); }
          if (pf(s) && s.ready && !s.released) {
            if (t >= s.t0 - 0.03 && t < s.t1 && s.el.paused && !s.played) { s.played = true; s.el._gain.gain.setTargetAtTime((s.clip.volume ?? 100) / 100, ac.currentTime, 0.02); s.el.play().catch(() => {}); }
            if (t >= s.t1 && !s.el.paused) { s.el._gain.gain.setTargetAtTime(0, ac.currentTime, 0.02); s.el.pause(); }
          }
        });
        this.drawAt(t);
        onProgress && onProgress(t / this.total);
        this.raf = requestAnimationFrame(tick);
      };
      if (t0 - ac.currentTime > 0) setTimeout(tick, (t0 - ac.currentTime) * 1000); else tick();
      // keep going while the tab is backgrounded for a moment (rAF pauses)
      this.iv = setInterval(() => { if (document.hidden) tick(); }, 50);
    });
    clearInterval(this.iv); cancelAnimationFrame(this.raf);
    stopMusic();
    this.segs.forEach((s, i) => this.release(i));
    this.pool.forEach(el => { el.pause(); el._gain && (el._gain.gain.value = 0); });
    let blob = null;
    if (rec) { await new Promise(r => setTimeout(r, 300)); rec.stop(); await stopped; blob = new Blob(chunks, { type: (mime || 'video/webm').split(';')[0] }); }
    setTimeout(() => { master.disconnect(); musicBus.disconnect(); clipBus.disconnect(); }, 400);
    return blob;
  }
  stop() { this.stopped = true; }

  drawAt(t) {
    const { ctx, W, H, o } = this;
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
    if (t < this.titleDur) { const a = Math.min(1, t / 0.5, (this.titleDur - t) / 0.5); drawCard(ctx, W, H, o.title, o.subtitle, Math.max(0, a)); if (t > this.titleDur - 0.5 && this.segs[0]) this.drawSeg(this.segs[0], 0, 1 - (this.titleDur - t) / 0.5, t); return; }
    if (t >= this.contentEnd) { const tt = t - this.contentEnd; drawCard(ctx, W, H, o.endText, '', Math.min(1, tt / 0.5)); return; }
    const mashFilter = (FILTERS[o.filter] || {}).css || '';
    this.segs.forEach((s, i) => {
      if (t < s.t0 || t >= s.t1) return;
      let a = 1;
      if (this.xf && i > 0 && t < s.t0 + this.xf) a = (t - s.t0) / this.xf;
      if (o.transition === 'dip') a = Math.min(1, (t - s.t0) / 0.12, (s.t1 - t) / 0.12);
      this.drawSeg(s, i, a, t, mashFilter);
    });
  }
  drawSeg(s, i, a, t, mashFilter = (FILTERS[this.o.filter] || {}).css || '') {
    if (!s.ready || s.failed) return;
    const src = s.kind === 'photo' ? s.img : s.el;
    const prog = Math.max(0, Math.min(1, (t - s.t0) / s.dur));
    const zoom = s.kind === 'photo' && this.o.kenBurns !== false ? 1 + 0.06 * prog : 1;
    drawClip(this.ctx, src, s.sw, s.sh, this.W, this.H, s.clip, { alpha: a, mashFilter, zoom });
    drawOverlays(this.ctx, this.W, this.H, s, this.o, a);
  }
}
