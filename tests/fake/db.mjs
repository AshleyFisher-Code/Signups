// In-memory stand-in for Firestore (admin side), enough for the functions and the test server.
import { randomBytes } from 'node:crypto';

export const store = new Map();          // path -> data
export const hooks = { onUpdate: [] };   // (path, before, after) => void
let version = 0;
export const getVersion = () => version;
const clone = (x) => (x === undefined ? undefined : JSON.parse(JSON.stringify(x)));
const newId = () => randomBytes(10).toString('base64url').replace(/[-_]/g, 'x').slice(0, 20);

function snap(path) {
  const data = store.get(path);
  return { id: path.split('/').pop(), exists: data !== undefined, data: () => clone(data), ref: docRef(path) };
}
function write(path, data) {
  const before = store.get(path);
  if (data === undefined) store.delete(path); else store.set(path, clone(data));
  version++;
  if (before !== undefined && data !== undefined) for (const h of hooks.onUpdate) h(path, clone(before), clone(data));
}
function applyUpdate(cur, upd) {
  const out = clone(cur);
  for (const [k, v] of Object.entries(upd)) out[k] = clone(v);
  return out;
}

export function docRef(path) {
  return {
    path, id: path.split('/').pop(),
    get: async () => snap(path),
    set: async (d) => write(path, d),
    update: async (d) => { if (!store.has(path)) throw new Error('not found ' + path); write(path, applyUpdate(store.get(path), d)); },
    delete: async () => write(path, undefined),
    collection: (c) => collRef(`${path}/${c}`),
  };
}

function matches(data, filters) {
  return filters.every(([f, op, v]) => {
    const x = data[f];
    if (op === '==') return x === v;
    if (op === '<=') return x != null && x <= v;
    if (op === '<') return x != null && x < v;
    if (op === '>=') return x != null && x >= v;
    if (op === '>') return x != null && x > v;
    throw new Error('op ' + op);
  });
}
export function runQuery(coll, filters = [], order = null, lim = null) {
  const depth = coll.split('/').length + 1;
  let docs = [...store.keys()].filter(k => k.startsWith(coll + '/') && k.split('/').length === depth).map(snap).filter(s => matches(s.data(), filters));
  if (order) docs.sort((a, b) => { const x = a.data()[order[0]], y = b.data()[order[0]]; return (x > y ? 1 : x < y ? -1 : 0) * (order[1] === 'desc' ? -1 : 1); });
  if (lim) docs = docs.slice(0, lim);
  return { docs, size: docs.length, empty: !docs.length };
}

export function collRef(path, filters = [], order = null, lim = null) {
  return {
    path, isQuery: true,
    doc: (id) => docRef(`${path}/${id || newId()}`),
    add: async (d) => { const r = docRef(`${path}/${newId()}`); await r.set(d); return r; },
    where: (f, op, v) => collRef(path, [...filters, [f, op, v]], order, lim),
    orderBy: (f, dir = 'asc') => collRef(path, filters, [f, dir], lim),
    limit: (n) => collRef(path, filters, order, n),
    get: async () => runQuery(path, filters, order, lim),
  };
}

export const db = {
  doc: docRef,
  collection: collRef,
  batch() {
    const ops = [];
    return { set: (r, d) => ops.push(() => write(r.path, d)), update: (r, d) => ops.push(() => write(r.path, applyUpdate(store.get(r.path), d))), delete: (r) => ops.push(() => write(r.path, undefined)), commit: async () => ops.forEach(f => f()) };
  },
  async runTransaction(fn) {
    const ops = [];
    const tx = {
      get: async (r) => (r.isQuery ? r.get() : snap(r.path)),
      set: (r, d) => ops.push(() => write(r.path, d)),
      update: (r, d) => ops.push(() => write(r.path, applyUpdate(store.get(r.path), d))),
      delete: (r) => ops.push(() => write(r.path, undefined)),
    };
    const res = await fn(tx);
    ops.forEach(f => f());
    return res;
  },
};
