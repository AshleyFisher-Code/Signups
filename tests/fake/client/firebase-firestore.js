const user = () => { try { return JSON.parse(localStorage.getItem('fakeUser')); } catch { return null; } };
const api = async (b) => {
  const r = await fetch('/__fake/db', { method: 'POST', body: JSON.stringify({ ...b, user: user() }) });
  const j = await r.json();
  if (!r.ok) { const e = new Error('Missing or insufficient permissions. ' + (j.error || '')); e.code = 'permission-denied'; throw e; }
  return j;
};
const rid = () => Math.random().toString(36).slice(2, 12) + Math.random().toString(36).slice(2, 12);
export const getFirestore = () => ({});
export const connectFirestoreEmulator = () => {};
export const doc = (db, ...segs) => {
  if (db && db.isColl) return { path: `${db.path}/${segs[0] || rid()}`, get id() { return this.path.split('/').pop(); } };
  const path = segs.join('/');
  return { path, id: path.split('/').pop() };
};
export const collection = (db, ...segs) => ({ path: segs.join('/'), isColl: true, filters: [], order: null });
export const where = (f, op, v) => ({ where: [f, op, v] });
export const orderBy = (f, dir = 'asc') => ({ order: [f, dir] });
export const query = (c, ...cs) => ({ ...c, filters: cs.filter(x => x.where).map(x => x.where), order: cs.find(x => x.order)?.order || null });
const dsnap = (path, r) => ({ id: path.split('/').pop(), exists: () => r.exists, data: () => r.data ?? undefined });
const qsnap = (r) => { const docs = r.docs.map(d => ({ id: d.id, data: () => d.data, exists: () => true })); return { docs, size: docs.length, empty: !docs.length, forEach: (f) => docs.forEach(f) }; };
export async function getDoc(ref) { return dsnap(ref.path, await api({ op: 'get', path: ref.path })); }
export async function getDocs(q) { return qsnap(await api({ op: 'query', path: q.path, filters: q.filters || [], order: q.order })); }
export function onSnapshot(ref, cb, err) {
  let last = -1, stop = false;
  const tick = async () => {
    if (stop) return;
    try {
      const { v } = await (await fetch('/__fake/version')).json();
      if (v !== last) { last = v; const r = ref.isColl ? await getDocs(ref) : await getDoc(ref); if (!stop) cb(r); }
    } catch (e) { err?.(e); }
    if (!stop) setTimeout(tick, 200);
  };
  tick();
  return () => { stop = true; };
}
export function writeBatch() {
  const ops = [];
  return {
    set: (r, data) => ops.push({ op: 'set', path: r.path, data }),
    update: (r, data) => ops.push({ op: 'update', path: r.path, data }),
    delete: (r) => ops.push({ op: 'delete', path: r.path }),
    commit: () => api({ op: 'batch', ops }),
  };
}
export const updateDoc = (r, data) => api({ op: 'batch', ops: [{ op: 'update', path: r.path, data }] });
export const deleteDoc = (r) => api({ op: 'batch', ops: [{ op: 'delete', path: r.path }] });
export const setDoc = (r, data) => api({ op: 'batch', ops: [{ op: 'set', path: r.path, data }] });
