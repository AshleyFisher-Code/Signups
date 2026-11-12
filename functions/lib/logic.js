// Pure sign-up rules: validation, who gets a spot vs. the waitlist, and what goes in each invite.
// No Firestore here, so tests can cover every case.

export class UserError extends Error {}

const EMAIL_RE = /^[^\s@<>()",;:]+@[^\s@<>()",;:]+\.[a-z]{2,}$/i;
const clip = (s, n) => String(s ?? '').trim().replace(/\s+/g, ' ').slice(0, n);

export function cleanSubmission(s, data) {
  const name = clip(data?.name, 80);
  if (!name) throw new UserError(s.type === 'rsvp' ? `Please enter the ${(s.nameLabel || 'name').toLowerCase()}.` : 'Please enter your name.');
  const email = clip(data?.email, 120).toLowerCase();
  if (email && !EMAIL_RE.test(email)) throw new UserError('That email address doesn’t look right.');

  const answers = {};
  for (const q of s.questions || []) {
    const a = clip(data?.answers?.[q.id], 500);
    if (q.required && !a) throw new UserError(`Please answer: ${q.label}`);
    if (a) answers[q.id] = a;
  }

  const out = { name, email, answers, picks: [], partySize: 0, availability: {} };

  if (s.type === 'items') {
    const ids = new Set((s.items || []).map(i => i.id));
    const picks = [...new Set(Array.isArray(data?.picks) ? data.picks.map(String) : [])];
    if (!picks.length) throw new UserError('Please choose at least one item.');
    if (picks.length > 25) throw new UserError('That’s more items than one person can choose.');
    for (const p of picks) if (!ids.has(p)) throw new UserError('One of those items was removed. Please refresh and try again.');
    out.picks = picks;
  } else if (s.type === 'rsvp') {
    const n = Number(data?.partySize);
    const max = s.maxParty || 12;
    if (!Number.isInteger(n) || n < 1) throw new UserError('Please enter how many people are coming.');
    if (n > max) throw new UserError(`The most per sign-up is ${max}.`);
    out.partySize = n;
  } else if (s.type === 'poll') {
    const ids = new Set((s.options || []).map(o => o.id));
    const av = {};
    for (const [k, v] of Object.entries(data?.availability || {})) {
      if (ids.has(k) && ['yes', 'maybe', 'no'].includes(v)) av[k] = v;
    }
    if (!Object.keys(av).length) throw new UserError('Please mark at least one date.');
    out.availability = av;
  } else {
    throw new UserError('Unknown sign-up type.');
  }
  return out;
}

// How many confirmed spots each item has, ignoring one entry (the one being edited).
export function takenCounts(entries, exceptId) {
  const taken = {};
  for (const e of entries) {
    if (e.id === exceptId) continue;
    for (const p of e.picks || []) if (!p.waitlisted) taken[p.itemId] = (taken[p.itemId] || 0) + 1;
  }
  return taken;
}

export function headcount(entries, exceptId) {
  return entries.filter(e => e.id !== exceptId && !e.waitlisted).reduce((n, e) => n + (e.partySize || 0), 0);
}

/**
 * Decide spots for one submission. previous = this person's existing entry (on edit) so they keep
 * spots they already hold. Returns { picks, waitlisted, full } — full lists items with no room and no waitlist.
 */
export function allocate(s, entries, entryId, sub, previous) {
  if (s.type === 'items') {
    const taken = takenCounts(entries, entryId);
    const held = new Set((previous?.picks || []).filter(p => !p.waitlisted).map(p => p.itemId));
    const byId = Object.fromEntries((s.items || []).map(i => [i.id, i]));
    const picks = [];
    const full = [];
    for (const itemId of sub.picks) {
      const cap = Math.max(1, byId[itemId].qty || 1);
      const room = (taken[itemId] || 0) < cap;
      if (room || held.has(itemId)) picks.push({ itemId, waitlisted: false });
      else if (s.waitlist !== false) picks.push({ itemId, waitlisted: true });
      else full.push(itemId);
    }
    return { picks, waitlisted: false, full };
  }
  if (s.type === 'rsvp') {
    if (!s.capacity) return { picks: [], waitlisted: false, full: [] };
    const count = headcount(entries, entryId);
    const wasIn = previous && !previous.waitlisted;
    const fits = count + sub.partySize <= s.capacity;
    if (fits) return { picks: [], waitlisted: false, full: [] };
    if (wasIn && sub.partySize <= (previous.partySize || 0)) return { picks: [], waitlisted: false, full: [] };
    if (s.waitlist !== false) return { picks: [], waitlisted: true, full: [] };
    return { picks: [], waitlisted: false, full: ['__capacity__'] };
  }
  return { picks: [], waitlisted: false, full: [] };
}

/** After a cancellation or a capacity change: move waitlisted people up, first come first served. */
export function promotions(s, entries) {
  const sorted = [...entries].sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  const changes = [];
  if (s.type === 'items') {
    const taken = takenCounts(sorted);
    const byId = Object.fromEntries((s.items || []).map(i => [i.id, i]));
    for (const e of sorted) {
      let changed = false;
      const picks = (e.picks || []).map(p => {
        if (!p.waitlisted || !byId[p.itemId]) return p;
        const cap = Math.max(1, byId[p.itemId].qty || 1);
        if ((taken[p.itemId] || 0) < cap) {
          taken[p.itemId] = (taken[p.itemId] || 0) + 1;
          changed = true;
          return { itemId: p.itemId, waitlisted: false };
        }
        return p;
      });
      if (changed) {
        const promoted = picks.filter((p, i) => !p.waitlisted && e.picks[i].waitlisted).map(p => p.itemId);
        changes.push({ id: e.id, picks, promoted });
      }
    }
  } else if (s.type === 'rsvp' && s.capacity) {
    let count = headcount(sorted);
    for (const e of sorted) {
      if (!e.waitlisted) continue;
      if (count + (e.partySize || 0) <= s.capacity) {
        count += e.partySize || 0;
        changes.push({ id: e.id, waitlisted: false, promoted: true });
      }
    }
  } else if (s.type === 'rsvp' && !s.capacity) {
    for (const e of sorted) if (e.waitlisted) changes.push({ id: e.id, waitlisted: false, promoted: true });
  }
  return changes;
}

// ---------- formatting ----------

export function fmtWhen(when, tz = 'America/New_York', opts = {}) {
  if (!when?.start) return '';
  if (when.allDay) {
    const d = new Date(when.start + 'T12:00:00Z');
    return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' });
  }
  const s = new Date(when.start);
  const day = s.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: tz });
  const t = (d) => d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: tz }).replace(':00', '');
  if (opts.timeOnly) return when.end ? `${t(s)} – ${t(new Date(when.end))}` : t(s);
  return when.end ? `${day}, ${t(s)} – ${t(new Date(when.end))}` : `${day} at ${t(s)}`;
}

export function fmtOption(o) {
  const d = new Date(o.date + 'T12:00:00Z');
  let s = d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
  const t = (hm) => {
    const [h, m] = hm.split(':').map(Number);
    const ap = h >= 12 ? 'pm' : 'am';
    const hh = ((h + 11) % 12) + 1;
    return m ? `${hh}:${String(m).padStart(2, '0')}${ap}` : `${hh}${ap}`;
  };
  if (o.start) s += ` · ${t(o.start)}${o.end ? '–' + t(o.end) : ''}`;
  if (o.label) s += ` (${o.label})`;
  return s;
}

/** Plain-language lines describing what this person signed up for. */
export function describe(s, entry, tz) {
  const lines = [];
  if (s.type === 'items') {
    const byId = Object.fromEntries((s.items || []).map(i => [i.id, i]));
    for (const p of entry.picks || []) {
      const it = byId[p.itemId];
      if (!it) continue;
      let l = it.label;
      if (it.start) l += ` — ${fmtWhen({ start: it.start, end: it.end }, tz, { timeOnly: true })}`;
      if (p.waitlisted) l += ' (waitlist)';
      lines.push(l);
    }
  } else if (s.type === 'rsvp') {
    lines.push(`${entry.partySize} ${entry.partySize === 1 ? 'person' : 'people'}${entry.waitlisted ? ' (waitlist)' : ''}`);
  } else if (s.type === 'poll') {
    const mark = { yes: 'Yes', maybe: 'Maybe', no: 'No' };
    for (const o of s.options || []) if (entry.availability?.[o.id]) lines.push(`${fmtOption(o)}: ${mark[entry.availability[o.id]]}`);
  }
  return lines;
}

/** Calendar events for one guest. Slot items get their own event; everything else gets the main event. */
export function eventsFor(s, entryId, entry, { domain, url, tz }) {
  if (entry.waitlisted) return [];
  const base = { sequence: s.sequence || 0, location: s.location || '', url };
  const what = describe(s, { ...entry, picks: (entry.picks || []).filter(p => !p.waitlisted) }, tz);
  const events = [];
  if (s.type === 'items') {
    const byId = Object.fromEntries((s.items || []).map(i => [i.id, i]));
    const confirmed = (entry.picks || []).filter(p => !p.waitlisted && byId[p.itemId]);
    const slotted = confirmed.filter(p => byId[p.itemId].start);
    const plain = confirmed.filter(p => !byId[p.itemId].start);
    for (const p of slotted) {
      const it = byId[p.itemId];
      events.push({ ...base, uid: `${entryId}.${p.itemId}@${domain}`, allDay: false, start: it.start, end: it.end, summary: `${s.title}: ${it.label}`, description: `You signed up for: ${it.label}${it.note ? ` (${it.note})` : ''}\n\nChange or cancel: ${url}` });
    }
    if (plain.length && s.when?.start) {
      const items = plain.map(p => byId[p.itemId].label).join(', ');
      events.push({ ...base, uid: `${entryId}@${domain}`, allDay: !!s.when.allDay, start: s.when.start, end: s.when.end, summary: s.title, description: `You’re bringing: ${items}\n\nChange or cancel: ${url}` });
    }
  } else if (s.when?.start) {
    events.push({ ...base, uid: `${entryId}@${domain}`, allDay: !!s.when.allDay, start: s.when.start, end: s.when.end, summary: s.title, description: `${what.join('\n')}\n\nChange or cancel: ${url}` });
  }
  return events;
}

export function slugify(t) {
  return String(t || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
}
