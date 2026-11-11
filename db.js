// Dailies — IndexedDB storage (everything stays on the device)
const DB_NAME = 'dailies';
const DB_VER = 1;
let _db;

export function openDB() {
  if (_db) return Promise.resolve(_db);
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB_NAME, DB_VER);
    r.onupgradeneeded = () => {
      const db = r.result;
      if (!db.objectStoreNames.contains('projects')) db.createObjectStore('projects', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('clips')) {
        const s = db.createObjectStore('clips', { keyPath: 'id' });
        s.createIndex('project', 'projectId');
      }
      if (!db.objectStoreNames.contains('media')) db.createObjectStore('media', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('notes')) db.createObjectStore('notes', { keyPath: 'key' }); // `${projectId}|${day}`
      if (!db.objectStoreNames.contains('mashes')) db.createObjectStore('mashes', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv', { keyPath: 'k' });
    };
    r.onsuccess = () => { _db = r.result; res(_db); };
    r.onerror = () => rej(r.error);
  });
}

function tx(store, mode = 'readonly') {
  return _db.transaction(store, mode).objectStore(store);
}
function wrap(req) {
  return new Promise((res, rej) => { req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error); });
}

export const db = {
  get: (store, key) => wrap(tx(store).get(key)),
  all: (store) => wrap(tx(store).getAll()),
  put: (store, val) => wrap(tx(store, 'readwrite').put(val)),
  del: (store, key) => wrap(tx(store, 'readwrite').delete(key)),
  byIndex: (store, index, val) => wrap(tx(store).index(index).getAll(val)),
  async kvGet(k, d = null) { const r = await wrap(tx('kv').get(k)); return r ? r.v : d; },
  kvSet: (k, v) => wrap(tx('kv', 'readwrite').put({ k, v })),
};

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

// ---------- Backup / pack format ----------
// "DAILIES1\n" + 10-digit header length + header JSON + concatenated media blobs
const MAGIC = 'DAILIES1\n';

export async function buildPack({ projectIds = null, author = null } = {}) {
  const projects = (await db.all('projects')).filter(p => !projectIds || projectIds.includes(p.id));
  const pids = new Set(projects.map(p => p.id));
  const clips = (await db.all('clips')).filter(c => pids.has(c.projectId));
  const notes = (await db.all('notes')).filter(n => pids.has(n.key.split('|')[0]));
  const mediaIds = new Set();
  clips.forEach(c => { c.mediaId && mediaIds.add(c.mediaId); c.thumbId && mediaIds.add(c.thumbId); });
  const blobs = [];
  const index = [];
  let offset = 0;
  for (const id of mediaIds) {
    const m = await db.get('media', id);
    if (!m) continue;
    index.push({ id, type: m.blob.type, offset, size: m.blob.size });
    blobs.push(m.blob);
    offset += m.blob.size;
  }
  const header = JSON.stringify({ v: 1, created: new Date().toISOString(), author, projects, clips: clips.map(c => author && !c.author ? { ...c, author } : c), notes, media: index });
  const hb = new TextEncoder().encode(header);
  const len = String(hb.length).padStart(10, '0');
  return new Blob([MAGIC, len, hb, ...blobs], { type: 'application/octet-stream' });
}

export async function readPack(file) {
  const head = await file.slice(0, MAGIC.length + 10).text();
  if (!head.startsWith(MAGIC)) throw new Error('Not a Dailies backup or pack file');
  const len = parseInt(head.slice(MAGIC.length), 10);
  const start = MAGIC.length + 10;
  const header = JSON.parse(await file.slice(start, start + len).text());
  header._base = start + len;
  header._file = file;
  return header;
}

// Import: mode 'restore' keeps ids; mode 'merge-into' puts every clip into targetProjectId
export async function importPack(header, { targetProjectId = null } = {}) {
  const { _file: file, _base: base } = header;
  let added = 0;
  for (const m of header.media) {
    if (await db.get('media', m.id)) continue;
    const blob = file.slice(base + m.offset, base + m.offset + m.size, m.type);
    // materialise so the File handle can be released
    const buf = await blob.arrayBuffer();
    await db.put('media', { id: m.id, blob: new Blob([buf], { type: m.type }) });
  }
  if (!targetProjectId) {
    for (const p of header.projects) if (!(await db.get('projects', p.id))) await db.put('projects', p);
    for (const n of header.notes) if (!(await db.get('notes', n.key))) await db.put('notes', n);
  }
  for (const c of header.clips) {
    const clip = targetProjectId ? { ...c, id: (await db.get('clips', c.id)) && (await db.get('clips', c.id)).projectId !== targetProjectId ? uid() : c.id, projectId: targetProjectId } : c;
    if (await db.get('clips', clip.id)) continue;
    await db.put('clips', clip);
    added++;
  }
  if (targetProjectId) {
    for (const n of header.notes) {
      const day = n.key.split('|')[1];
      const key = `${targetProjectId}|${day}`;
      const existing = await db.get('notes', key);
      const text = existing ? existing.text + (existing.text.includes(n.text) ? '' : `\n— ${header.author || 'friend'}: ${n.text}`) : n.text;
      await db.put('notes', { key, text });
    }
  }
  return added;
}
