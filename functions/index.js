// Server side of the sign-up app. Guests never sign in: every guest change goes through these
// functions, which check that the sign-up is open, hand out spots fairly, and send the emails.
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { onDocumentUpdated } from 'firebase-functions/v2/firestore';
import { setGlobalOptions } from 'firebase-functions/v2';
import { defineSecret } from 'firebase-functions/params';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { CONFIG } from './config.js';
import { UserError, cleanSubmission, allocate, promotions, eventsFor, describe } from './lib/logic.js';
import { buildMessage, send } from './lib/email.js';

initializeApp();
const db = getFirestore();
const RESEND_API_KEY = defineSecret('RESEND_API_KEY');
setGlobalOptions({ region: 'us-east4', maxInstances: 5 });
if (process.env.FUNCTIONS_EMULATOR === 'true') CONFIG.siteUrl = process.env.SITE_URL || 'http://127.0.0.1:5002';

const guestOpts = { secrets: [RESEND_API_KEY], cors: true };
const key = () => { try { return RESEND_API_KEY.value(); } catch { return ''; } };
const sRef = (id) => db.doc(`signups/${id}`);
const entriesCol = (id) => db.collection(`signups/${id}/entries`);
const privRef = (id, e) => db.doc(`signups/${id}/private/${e}`);

function fail(e) {
  if (e instanceof HttpsError) throw e;
  if (e instanceof UserError) throw new HttpsError('invalid-argument', e.message);
  console.error(e);
  throw new HttpsError('internal', 'Something went wrong. Please try again.');
}
const isOpen = (s) => s.status === 'open' && !s.cancelled && (!s.closesAt || Date.parse(s.closesAt) > Date.now());
const sameToken = (a, b) => typeof a === 'string' && typeof b === 'string' && a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const ids = (v) => (typeof v === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(v) ? v : null);

async function rateLimit(req, signupId) {
  const ip = req.rawRequest?.ip || 'unknown';
  const hour = Math.floor(Date.now() / 3600000);
  const ref = db.doc(`ratelimits/${createHash('sha256').update(`${ip}|${signupId}|${hour}`).digest('hex').slice(0, 32)}`);
  const n = await db.runTransaction(async tx => {
    const d = await tx.get(ref);
    const c = (d.exists ? d.data().n : 0) + 1;
    tx.set(ref, { n: c, expires: (hour + 2) * 3600000 });
    return c;
  });
  if (n > 30) throw new HttpsError('resource-exhausted', 'Too many tries. Please wait a bit and try again.');
}

const publicEntry = (s, name, alloc, sub, createdAt) => ({
  name: s.showNames === false ? '' : name,
  picks: alloc.picks,
  partySize: sub.partySize || 0,
  waitlisted: alloc.waitlisted,
  availability: sub.availability || {},
  createdAt,
  updatedAt: Date.now(),
});

// ---------- guest: sign up or change a sign-up ----------
export const submit = onCall(guestOpts, async (req) => {
  try {
    const d = req.data || {};
    const signupId = ids(d.signupId);
    if (!signupId) throw new UserError('This sign-up link isn’t valid.');
    if (d.website) return { ok: true, entryId: 'x', token: 'x' }; // bots fill hidden fields
    await rateLimit(req, signupId);
    const editing = ids(d.entryId);

    const result = await db.runTransaction(async tx => {
      const snap = await tx.get(sRef(signupId));
      if (!snap.exists) throw new UserError('This sign-up no longer exists.');
      const s = snap.data();
      if (!isOpen(s)) throw new UserError('Sorry — this sign-up has closed.');
      const sub = cleanSubmission(s, d);
      const all = (await tx.get(entriesCol(signupId))).docs.map(x => ({ id: x.id, ...x.data() }));

      let previous = null, priv = null, entryId, token, createdAt = Date.now();
      if (editing) {
        const p = await tx.get(privRef(signupId, editing));
        if (!p.exists || !sameToken(p.data().token, d.token)) throw new UserError('That sign-up link has expired. Please sign up again.');
        priv = p.data();
        previous = all.find(e => e.id === editing) || null;
        entryId = editing; token = priv.token; createdAt = previous?.createdAt || createdAt;
      } else {
        entryId = entriesCol(signupId).doc().id;
        token = randomBytes(18).toString('base64url');
      }

      const alloc = allocate(s, all, entryId, sub, previous);
      if (alloc.full.length) {
        if (alloc.full[0] === '__capacity__') throw new UserError('Sorry — this is full.');
        const names = alloc.full.map(id => s.items.find(i => i.id === id)?.label).join(', ');
        throw new UserError(`Someone just took ${names}. Please choose something else.`);
      }
      const entry = publicEntry(s, sub.name, alloc, sub, createdAt);
      const newPriv = { name: sub.name, email: sub.email, answers: sub.answers, token, createdAt: priv?.createdAt || Date.now() };
      tx.set(entriesCol(signupId).doc(entryId), entry);
      tx.set(privRef(signupId, entryId), newPriv);
      return { s, entryId, token, entry, priv: newPriv, previous, oldEmail: priv?.email };
    });

    const { s, entryId, token, entry, priv, previous } = result;
    // Slots this person dropped on an edit come off their calendar.
    let removedEvents = [];
    if (previous && priv.email) {
      const before = eventsFor(s, entryId, previous, { domain: CONFIG.domain, url: '', tz: s.tz });
      const after = new Set(eventsFor(s, entryId, entry, { domain: CONFIG.domain, url: '', tz: s.tz }).map(e => e.uid));
      removedEvents = before.filter(e => !after.has(e.uid));
    }
    if (priv.email) await send(db, key(), buildMessage('confirm', { s, entryId, entry, priv, extra: { removedEvents } }));
    if (previous) await promote(signupId);
    return { ok: true, entryId, token, entry };
  } catch (e) { fail(e); }
});

// ---------- guest: look up own sign-up from the email link ----------
export const lookup = onCall(guestOpts, async (req) => {
  try {
    const signupId = ids(req.data?.signupId), entryId = ids(req.data?.entryId);
    if (!signupId || !entryId) throw new UserError('That link isn’t valid.');
    const [p, e] = await Promise.all([privRef(signupId, entryId).get(), entriesCol(signupId).doc(entryId).get()]);
    if (!p.exists || !e.exists || !sameToken(p.data().token, req.data?.token)) throw new UserError('That sign-up was cancelled or the link has expired.');
    const { name, email, answers } = p.data();
    return { entry: e.data(), name, email, answers };
  } catch (err) { fail(err); }
});

async function removeEntry(signupId, entryId, byHost) {
  const res = await db.runTransaction(async tx => {
    const [sn, p, e] = await Promise.all([tx.get(sRef(signupId)), tx.get(privRef(signupId, entryId)), tx.get(entriesCol(signupId).doc(entryId))]);
    if (!sn.exists || !e.exists) return null;
    tx.delete(entriesCol(signupId).doc(entryId));
    tx.delete(privRef(signupId, entryId));
    return { s: sn.data(), priv: p.exists ? p.data() : null, entry: e.data() };
  });
  if (!res) return;
  const { s, priv, entry } = res;
  if (priv?.email) {
    const cancelEvents = eventsFor(s, entryId, entry, { domain: CONFIG.domain, url: '', tz: s.tz });
    await send(db, key(), buildMessage('cancelled', { s, entryId, entry, priv, extra: { byHost, cancelEvents, lines: describe(s, entry, s.tz) } }));
  }
  await promote(signupId);
}

// ---------- guest: cancel ----------
export const cancel = onCall(guestOpts, async (req) => {
  try {
    const signupId = ids(req.data?.signupId), entryId = ids(req.data?.entryId);
    if (!signupId || !entryId) throw new UserError('That link isn’t valid.');
    const p = await privRef(signupId, entryId).get();
    if (!p.exists || !sameToken(p.data().token, req.data?.token)) throw new UserError('That sign-up was already cancelled.');
    const s = (await sRef(signupId).get()).data();
    if (!s || !isOpen(s)) throw new UserError('This sign-up has closed. Please contact the host to make changes.');
    await removeEntry(signupId, entryId, false);
    return { ok: true };
  } catch (e) { fail(e); }
});

// ---------- host: remove someone ----------
const isAdmin = (req) => !!req.auth?.token?.email && CONFIG.adminEmails.includes(req.auth.token.email.toLowerCase());
export const adminRemove = onCall(guestOpts, async (req) => {
  try {
    if (!isAdmin(req)) throw new HttpsError('permission-denied', 'Please sign in.');
    const signupId = ids(req.data?.signupId), entryId = ids(req.data?.entryId);
    const s = (await sRef(signupId).get()).data();
    if (!s || s.ownerUid !== req.auth.uid) throw new HttpsError('permission-denied', 'Not your sign-up.');
    await removeEntry(signupId, entryId, true);
    return { ok: true };
  } catch (e) { fail(e); }
});

// ---------- waitlist ----------
async function promote(signupId) {
  const res = await db.runTransaction(async tx => {
    const sn = await tx.get(sRef(signupId));
    if (!sn.exists) return null;
    const s = sn.data();
    const all = (await tx.get(entriesCol(signupId))).docs.map(x => ({ id: x.id, ...x.data() }));
    const changes = promotions(s, all);
    for (const c of changes) {
      const upd = c.picks ? { picks: c.picks } : { waitlisted: false };
      tx.update(entriesCol(signupId).doc(c.id), upd);
    }
    return { s, changes, all };
  });
  if (!res?.changes.length) return;
  for (const c of res.changes) {
    const p = (await privRef(signupId, c.id).get()).data();
    if (!p?.email) continue;
    const before = res.all.find(e => e.id === c.id);
    const entry = { ...before, ...(c.picks ? { picks: c.picks } : { waitlisted: false }) };
    await send(db, key(), buildMessage('promoted', { s: res.s, entryId: c.id, entry, priv: p }));
  }
}

// ---------- host edits: send updated invites, promote from waitlist ----------
const eventKey = (s) => JSON.stringify([s.title, s.location, s.when || null, (s.items || []).map(i => [i.id, i.label, i.start || '', i.end || ''])]);

export const onSignupUpdated = onDocumentUpdated({ document: 'signups/{id}', secrets: [RESEND_API_KEY] }, async (event) => {
  const b = event.data.before.data(), a = event.data.after.data(), id = event.params.id;
  const all = async () => (await entriesCol(id).get()).docs.map(x => ({ id: x.id, ...x.data() }));

  if (a.cancelled && !b.cancelled) {
    for (const e of await all()) {
      const p = (await privRef(id, e.id).get()).data();
      if (p?.email) await send(db, key(), buildMessage('eventCancelled', { s: a, entryId: e.id, entry: e, priv: p }));
    }
    return;
  }
  if (a.cancelled) return;

  const changed = eventKey(a) !== eventKey(b);
  const bumped = (a.sequence || 0) > (b.sequence || 0);
  if (a.when?.start && (changed || bumped)) {
    if (changed && !bumped) {
      // Calendars only accept an update with a higher SEQUENCE. Bump it; the next run sends the emails.
      await event.data.after.ref.update({ sequence: (b.sequence || 0) + 1, firstInvite: a.type === 'poll' && !b.when?.start });
      return;
    }
    const firstTime = a.type === 'poll' && (!b.when?.start || a.firstInvite === true);
    for (const e of await all()) {
      if (a.type === 'poll' && a.finalOptionId && e.availability?.[a.finalOptionId] === 'no') continue;
      const p = (await privRef(id, e.id).get()).data();
      if (p?.email) await send(db, key(), buildMessage('update', { s: a, entryId: e.id, entry: e, priv: p, extra: { firstTime } }));
    }
    if (a.firstInvite) await event.data.after.ref.update({ firstInvite: false });
  }
  const capChanged = JSON.stringify((a.items || []).map(i => i.qty)) !== JSON.stringify((b.items || []).map(i => i.qty)) || a.capacity !== b.capacity;
  if (capChanged) await promote(id);
});

// ---------- every 15 minutes: close and archive, send reminders ----------
export async function runTick(now = Date.now()) {
  const iso = new Date(now).toISOString();
  const closing = await db.collection('signups').where('status', '==', 'open').where('closesAt', '<=', iso).get();
  for (const d of closing.docs) await d.ref.update({ status: 'archived', archivedAt: iso });

  const due = await db.collection('signups').where('reminderSent', '==', false).where('reminderAt', '<=', iso).get();
  for (const d of due.docs) {
    const s = d.data();
    await d.ref.update({ reminderSent: true });
    if (s.cancelled || !s.when?.start || Date.parse(s.when.allDay ? s.when.start + 'T23:59:00-05:00' : s.when.start) < now) continue;
    const entries = (await entriesCol(d.id).get()).docs.map(x => ({ id: x.id, ...x.data() }));
    for (const e of entries) {
      if (e.waitlisted || (s.type === 'items' && !(e.picks || []).some(p => !p.waitlisted))) continue;
      if (s.type === 'poll' && s.finalOptionId && e.availability?.[s.finalOptionId] === 'no') continue;
      const p = (await privRef(d.id, e.id).get()).data();
      if (p?.email) await send(db, key(), buildMessage('reminder', { s, entryId: e.id, entry: e, priv: p }));
    }
  }
  const old = await db.collection('ratelimits').where('expires', '<', now).limit(400).get();
  const batch = db.batch();
  old.docs.forEach(x => batch.delete(x.ref));
  if (!old.empty) await batch.commit();
  return { archived: closing.size, reminded: due.size };
}

export const tick = onSchedule({ schedule: 'every 15 minutes', timeZone: 'America/New_York', secrets: [RESEND_API_KEY] }, async () => { await runTick(); });

// Lets the local test suite run the clock without waiting 15 minutes. Does nothing in production.
export const testTick = onCall(guestOpts, async (req) => {
  if (process.env.FUNCTIONS_EMULATOR !== 'true') throw new HttpsError('not-found', 'Not here.');
  return runTick(req.data?.now || Date.now());
});
