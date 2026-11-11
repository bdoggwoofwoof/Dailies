// Dailies — media helpers: audio unlock, snippet baking, thumbnails, capture dates
let _ac;
export function audioCtx() {
  if (!_ac) _ac = new (window.AudioContext || window.webkitAudioContext)();
  return _ac;
}
// Call inside a tap handler. Unlocks audio + primes media elements for later play() calls (iOS).
export function unlock(...els) {
  const ac = audioCtx();
  if (ac.state !== 'running') ac.resume();
  for (const el of els) {
    if (!el) continue;
    const p = el.play();
    if (p && p.catch) p.catch(() => {});
    el.pause();
  }
}

export function pickMime() {
  const opts = ['video/mp4;codecs=avc1.640028,mp4a.40.2', 'video/mp4;codecs=avc1,mp4a', 'video/mp4;codecs=avc1,opus', 'video/mp4;codecs=avc3,opus', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
  if (!window.MediaRecorder) return null;
  for (const m of opts) if (MediaRecorder.isTypeSupported(m)) return m;
  return '';
}
export const extFor = (mime) => (mime || '').includes('mp4') ? 'mp4' : 'webm';

export function loadVideo(url, el = document.createElement('video')) {
  el.playsInline = true; el.setAttribute('playsinline', ''); el.preload = 'auto'; el.crossOrigin = 'anonymous';
  return new Promise((res, rej) => {
    const ok = () => { cleanup(); res(el); };
    const bad = () => { cleanup(); rej(new Error('Could not read this video')); };
    const cleanup = () => { el.removeEventListener('loadeddata', ok); el.removeEventListener('error', bad); };
    el.addEventListener('loadeddata', ok); el.addEventListener('error', bad);
    el.src = url; el.load();
  });
}
export function seek(el, t) {
  return new Promise(res => {
    if (Math.abs(el.currentTime - t) < 0.01 && el.readyState >= 2) return res();
    const done = () => { el.removeEventListener('seeked', done); res(); };
    el.addEventListener('seeked', done);
    el.currentTime = t;
    setTimeout(done, 1500);
  });
}
export function loadImage(url) {
  return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
}

// Re-record [start, start+len] of a video at native orientation (long side capped) → small clip blob.
export async function bakeSnippet(file, start, len, { maxSide = 1920, el } = {}) {
  const mime = pickMime();
  if (mime === null) throw new Error('Recording not supported');
  const url = URL.createObjectURL(file);
  const v = await loadVideo(url, el || document.createElement('video'));
  try {
    const vw = v.videoWidth, vh = v.videoHeight;
    const k = Math.min(1, maxSide / Math.max(vw, vh));
    const cw = Math.round(vw * k / 2) * 2, ch = Math.round(vh * k / 2) * 2;
    const c = document.createElement('canvas'); c.width = cw; c.height = ch;
    const ctx = c.getContext('2d');
    const ac = audioCtx(); if (ac.state !== 'running') await ac.resume();
    if (!v._src) v._src = ac.createMediaElementSource(v);
    const src = v._src;
    const dest = ac.createMediaStreamDestination();
    src.disconnect(); src.connect(dest);
    await seek(v, start);
    ctx.drawImage(v, 0, 0, cw, ch);
    const stream = new MediaStream([...c.captureStream(30).getVideoTracks(), ...dest.stream.getAudioTracks()]);
    const rec = new MediaRecorder(stream, { mimeType: mime || undefined, videoBitsPerSecond: 8_000_000 });
    const chunks = [];
    rec.ondataavailable = e => e.data.size && chunks.push(e.data);
    const stopped = new Promise(r => rec.onstop = r);
    let raf;
    const draw = () => { ctx.drawImage(v, 0, 0, cw, ch); if (v.currentTime >= start + len || v.ended) { finish(); return; } raf = requestAnimationFrame(draw); };
    let finished = false;
    const finish = () => { if (finished) return; finished = true; cancelAnimationFrame(raf); v.pause(); setTimeout(() => rec.state !== 'inactive' && rec.stop(), 60); };
    rec.start(100);
    await v.play();
    draw();
    setTimeout(finish, (len + 2) * 1000); // safety
    await stopped;
    src.disconnect();
    const out = new Blob(chunks, { type: (mime || 'video/webm').split(';')[0] });
    if (out.size < 1000) throw new Error('Empty recording');
    return { blob: out, width: cw, height: ch };
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function thumbFromVideo(url, t) {
  const v = await loadVideo(url);
  await seek(v, Math.min(t, Math.max(0, (v.duration || 1) - 0.05)));
  const blob = await frameToJpeg(v, v.videoWidth, v.videoHeight, 360);
  v.removeAttribute('src'); v.load();
  return blob;
}
export async function frameToJpeg(src, w, h, max, q = 0.8) {
  const k = Math.min(1, max / Math.max(w, h));
  const c = document.createElement('canvas'); c.width = Math.round(w * k); c.height = Math.round(h * k);
  c.getContext('2d').drawImage(src, 0, 0, c.width, c.height);
  return new Promise(r => c.toBlob(r, 'image/jpeg', q));
}
export async function downscalePhoto(file, max = 2160) {
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    return { blob: await frameToJpeg(img, img.naturalWidth, img.naturalHeight, max, 0.9), width: img.naturalWidth, height: img.naturalHeight, thumb: await frameToJpeg(img, img.naturalWidth, img.naturalHeight, 360) };
  } finally { URL.revokeObjectURL(url); }
}

// ---------- Capture date detection (for Smart-Fill) ----------
const pad = n => String(n).padStart(2, '0');
export const dayKey = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

async function latin1(blob) { const b = new Uint8Array(await blob.arrayBuffer()); let s = ''; for (let i = 0; i < b.length; i += 8192) s += String.fromCharCode.apply(null, b.subarray(i, i + 8192)); return s; }

export async function captureDate(file) {
  try {
    if (file.type.startsWith('image/')) {
      const s = await latin1(file.slice(0, 262144));
      const m = s.match(/(\d{4}):(\d{2}):(\d{2}) \d{2}:\d{2}:\d{2}/);
      if (m) return { day: `${m[1]}-${m[2]}-${m[3]}`, source: 'photo metadata' };
    } else {
      // walk top-level MP4/MOV atoms to find moov
      let off = 0; const size = file.size;
      for (let i = 0; i < 64 && off < size; i++) {
        const h = new DataView(await file.slice(off, off + 16).arrayBuffer());
        let len = h.getUint32(0); const type = String.fromCharCode(h.getUint8(4), h.getUint8(5), h.getUint8(6), h.getUint8(7));
        if (len === 1) len = Number(h.getBigUint64(8)); else if (len === 0) len = size - off;
        if (type === 'moov') {
          const moov = file.slice(off, off + Math.min(len, 8_000_000));
          const s = await latin1(moov);
          // Apple's local capture date (keeps your timezone)
          const a = s.match(/(\d{4})-(\d{2})-(\d{2})T\d{2}:\d{2}:\d{2}[+-]\d{2}:?\d{2}/);
          if (a) return { day: `${a[1]}-${a[2]}-${a[3]}`, source: 'video metadata' };
          const i2 = s.indexOf('mvhd');
          if (i2 > 0) {
            const buf = new DataView(await moov.slice(i2 + 4, i2 + 24).arrayBuffer());
            const ver = buf.getUint8(0);
            const secs = ver === 1 ? Number(buf.getBigUint64(4)) : buf.getUint32(4);
            if (secs > 3_000_000_000) { // after ~1999
              const d = new Date((secs - 2082844800) * 1000);
              return { day: dayKey(d), source: 'video metadata' };
            }
          }
          break;
        }
        if (len < 8) break;
        off += len;
      }
    }
  } catch (e) { /* fall through */ }
  if (file.lastModified) return { day: dayKey(new Date(file.lastModified)), source: 'file date (check it)' };
  return { day: dayKey(new Date()), source: 'unknown (check it)' };
}

export function videoDuration(file) {
  const url = URL.createObjectURL(file);
  const v = document.createElement('video'); v.preload = 'metadata'; v.muted = true; v.playsInline = true;
  return new Promise(res => {
    v.onloadedmetadata = () => { const d = v.duration; URL.revokeObjectURL(url); res(isFinite(d) ? d : 1); };
    v.onerror = () => { URL.revokeObjectURL(url); res(0); };
    v.src = url;
  });
}
