// Local stand-in for Firebase: serves the real pages and runs the real Cloud Functions against an
// in-memory database, applying the same access rules as firestore.rules.
// Run: node --import ./tests/fake/register.mjs tests/fake/server.mjs
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { db, store, hooks, runQuery, getVersion } from './db.mjs';

const PORT = Number(process.env.PORT || 8765);
process.env.FUNCTIONS_EMULATOR = 'true';
process.env.SITE_URL = `http://localhost:${PORT}`;
process.env.RESEND_API_KEY = 'test';
const fns = await import('../../functions/index.js');
const ROOT = new URL('../../public/', import.meta.url).pathname;
const CLIENT = new URL('./client/', import.meta.url).pathname;
const ADMIN = 'ashley@ashleyfisher.com';

// Firestore trigger: run in order, like the real thing (eventually, after the write).
let chain = Promise.resolve();
export const idle = () => chain;
hooks.onUpdate.push((path, before, after) => {
  const m = path.match(/^signups\/([^/]+)$/);
  if (!m) return;
  const ref = db.doc(path);
  chain = chain.then(() => fns.onSignupUpdated({ params: { id: m[1] }, data: { before: { data: () => before }, after: { data: () => after, ref } } })).catch(e => console.error('trigger', e));
});

// ---- the access rules from firestore.rules ----
const isAdmin = (u) => !!u?.email && u.email.toLowerCase() === ADMIN;
function canRead(u, path, list) {
  const p = path.split('/');
  if (p[0] === 'signups' && p.length === 1) return isAdmin(u);                  // list
  if (p[0] === 'signups' && p.length === 2) return true;
  if (p[0] === 'signups' && p[2] === 'entries') return true;
  if (p[0] === 'signups' && p[2] === 'private') return isAdmin(u) && store.get(`signups/${p[1]}`)?.ownerUid === u.uid;
  if (p[0] === 'slugs' && p.length === 2 && !list) return true;
  return false;
}
function canWrite(u, op, path, data) {
  const p = path.split('/');
  const cur = store.get(path);
  if (p[0] === 'signups' && p.length === 2) {
    if (!isAdmin(u)) return false;
    if (!cur) return op !== 'delete' && data?.ownerUid === u.uid;
    if (cur.ownerUid !== u.uid) return false;
    if (op === 'delete') return true;
    const next = op === 'update' ? { ...cur, ...data } : data;
    return next.ownerUid === cur.ownerUid;
  }
  if (p[0] === 'slugs' && p.length === 2) {
    if (op === 'delete') return isAdmin(u) && cur?.ownerUid === u.uid;
    return !cur && isAdmin(u) && data?.ownerUid === u.uid;
  }
  return false;
}

const json = (res, code, body) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
const body = (req) => new Promise(r => { let s = ''; req.on('data', c => (s += c)); req.on('end', () => r(s ? JSON.parse(s) : {})); });
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.ics': 'text/calendar' };

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  try {
    if (url.pathname.startsWith('/__fake/')) {
      const what = url.pathname.slice(8);
      if (what === 'version') return json(res, 200, { v: getVersion() });
      if (what === 'outbox') { await chain; return json(res, 200, runQuery('outbox', [], ['at', 'asc']).docs.map(d => d.data())); }
      if (what === 'dump') { await chain; return json(res, 200, Object.fromEntries(store)); }
      if (what === 'settle') { await chain; return json(res, 200, { ok: true }); }
      if (what.startsWith('client/')) { res.writeHead(200, { 'content-type': 'text/javascript' }); return res.end(await readFile(join(CLIENT, what.slice(7)))); }
      const b = await body(req);
      const u = b.user || null;
      if (what.startsWith('call/')) {
        const fn = fns[what.slice(5)];
        if (!fn || fn.kind !== 'call') return json(res, 404, { error: { code: 'not-found', message: 'no fn' } });
        try {
          const auth = u ? { uid: u.uid, token: { email: u.email } } : null;
          const result = await fn({ data: b.data, auth, rawRequest: { ip: b.ip || '127.0.0.1' } });
          return json(res, 200, { result });
        } catch (e) { return json(res, 200, { error: { code: e.code || 'internal', message: e.message } }); }
      }
      if (what === 'db') {
        const { op, path } = b;
        if (op === 'get') { if (!canRead(u, path)) return json(res, 403, { error: 'permission-denied' }); return json(res, 200, { exists: store.has(path), data: store.get(path) ?? null }); }
        if (op === 'query') {
          if (!canRead(u, path, true)) return json(res, 403, { error: 'permission-denied' });
          return json(res, 200, { docs: runQuery(path, b.filters || [], b.order || null).docs.map(d => ({ id: d.id, data: d.data() })) });
        }
        if (op === 'batch') {
          for (const o of b.ops) if (!canWrite(u, o.op, o.path, o.data)) return json(res, 403, { error: `permission-denied: ${o.op} ${o.path}` });
          const batch = db.batch();
          for (const o of b.ops) { const r = db.doc(o.path); o.op === 'delete' ? batch.delete(r) : o.op === 'update' ? batch.update(r, o.data) : batch.set(r, o.data); }
          await batch.commit();
          return json(res, 200, { ok: true });
        }
      }
      if (what === 'tick') { await chain; const r = await fns.runTick(b.now || Date.now()); await chain; return json(res, 200, r); }
      return json(res, 404, { error: 'unknown' });
    }
    // hosting with the same rewrites as firebase.json
    let p = url.pathname;
    if (p === '/') p = '/index.html';
    else if (p === '/admin' || p.startsWith('/admin/')) p = '/admin.html';
    else if (p === '/print') p = '/print.html';
    let file = join(ROOT, p);
    try { if (!(await stat(file)).isFile()) throw 0; } catch { file = join(ROOT, 'guest.html'); }
    res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(await readFile(file));
  } catch (e) { console.error(e); json(res, 500, { error: String(e) }); }
});
server.listen(PORT, '127.0.0.1', () => console.log(`fake firebase on http://localhost:${PORT}`));
