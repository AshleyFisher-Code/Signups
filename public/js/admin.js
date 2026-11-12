// Organizer screens: list, create/edit, results, print, archive, export.
import { doc, getDoc, getDocs, collection, query, where, orderBy, onSnapshot, writeBatch, updateDoc, deleteDoc } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
import { db, call, errText, siteUrl } from './fb.js';
import { auth, onAuthStateChanged, signOut, loginView } from './auth.js';
import { el, mount, iconEl, fmtWhen, fmtDay, fmtOption, toast, sheet, copyText } from './ui.js';
import { parseItems } from './parse.js';
import { HOST_NAME } from './config.js';

const app = document.getElementById('app');
const adminRemove = call('adminRemove');
let user = null, unsub = [];
const stopLive = () => { unsub.forEach(f => f()); unsub = []; };
const go = (h) => { location.hash = h; };
const TYPES = {
  items: ['Things to bring & time slots', 'Potluck dishes, supplies, volunteer shifts, snack schedules'],
  rsvp: ['Headcount RSVP', 'Name and how many are coming — team dinners, parties'],
  poll: ['Find a date', 'Guests mark which dates work for them'],
};
const newId = () => Math.random().toString(36).slice(2, 10);
const linkFor = (s) => `${siteUrl()}/${s.slug}`;

onAuthStateChanged(auth, (u) => { user = u; route(); });
addEventListener('hashchange', route);

function route() {
  stopLive();
  if (!user) return loginView(app, 'Sign in to create and manage your sign-ups.');
  const [, a, b] = location.hash.replace(/^#\/?/, '/').split('/');
  if (a === 'new') return typePicker();
  if (a === 'edit' && b) return editor(b);
  if (a === 'create' && b) return editor(null, b);
  if (a === 's' && b) return detail(b);
  return dashboard();
}

const top = (backTo) => el('div', { class: 'topbar' },
  backTo ? el('a', { class: 'back', href: backTo, text: '‹ Back' }) : el('span', { class: 'eyebrow', style: 'margin:0', text: 'Organizer' }),
  el('button', { class: 'link', text: 'Sign out', onclick: () => signOut(auth) }));

// ---------------- dashboard ----------------
let tab = 'live';
async function dashboard() {
  mount(app, top(), el('h1', { text: 'Your sign-ups' }), el('div', { class: 'loading' }, el('div', { class: 'spinner' })));
  const qs = await getDocs(query(collection(db, 'signups'), where('ownerUid', '==', user.uid), orderBy('createdAt', 'desc')));
  const all = qs.docs.map(d => ({ id: d.id, ...d.data() }));
  const counts = Object.fromEntries(await Promise.all(all.map(async s => [s.id, (await getDocs(collection(db, 'signups', s.id, 'entries'))).size])));
  const live = all.filter(s => s.status === 'open' && !s.cancelled);
  const arch = all.filter(s => !(s.status === 'open' && !s.cancelled));
  const render = () => {
    const list = tab === 'live' ? live : arch;
    mount(app, top(), el('h1', { text: 'Your sign-ups' }),
      el('button', { class: 'btn block', onclick: () => go('#/new'), text: '+ New sign-up' }),
      el('div', { class: 'tabs', role: 'tablist' },
        el('button', { role: 'tab', 'aria-selected': String(tab === 'live'), onclick: () => { tab = 'live'; render(); }, text: `Live (${live.length})` }),
        el('button', { role: 'tab', 'aria-selected': String(tab === 'arch'), onclick: () => { tab = 'arch'; render(); }, text: `Archive (${arch.length})` })),
      list.length ? list.map(s => el('a', { class: 'su', href: `#/s/${s.id}` },
        el('span', { class: 'tag green', text: TYPES[s.type][0] }),
        el('div', { class: 't', text: s.title }),
        el('div', { class: 'meta', text: [s.when?.start ? fmtWhen(s.when, s.tz) : s.type === 'poll' ? 'Date not set yet' : '', `${counts[s.id]} response${counts[s.id] === 1 ? '' : 's'}`,
          s.cancelled ? 'Cancelled' : s.status === 'open' ? (s.closesAt ? `closes ${fmtDay(s.closesAt, s.tz)}` : 'open') : `closed ${s.archivedAt ? fmtDay(s.archivedAt, s.tz) : ''}`].filter(Boolean).join(' · ') })))
        : el('p', { class: 'muted center', style: 'padding:30px 0', text: tab === 'live' ? 'Nothing live right now.' : 'Closed sign-ups will appear here.' }));
  };
  render();
}

function typePicker() {
  mount(app, top('#/'), el('h1', { text: 'What kind of sign-up?' }),
    el('div', { class: 'types' }, Object.entries(TYPES).map(([k, [t, d]]) =>
      el('button', { class: 'type', onclick: () => go(`#/create/${k}`) }, el('b', { text: t }), el('span', { text: d })))));
}

// ---------------- create / edit ----------------
const pad = (n) => String(n).padStart(2, '0');
const localParts = (iso) => { if (!iso) return { date: '', time: '' }; const d = new Date(iso); return { date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`, time: `${pad(d.getHours())}:${pad(d.getMinutes())}` }; };
const toIso = (date, time) => new Date(`${date}T${time || '00:00'}`).toISOString();
const slugify = (t) => String(t || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
const RESERVED = new Set(['admin', 'print', 'css', 'js', 'icon', 'api', '__']);

function serializeItems(items) {
  const out = []; let sec = '';
  for (const it of items) {
    if ((it.section || '') !== sec) { sec = it.section || ''; if (sec) out.push(`${sec}:`); }
    let l = '';
    if (it.start) { const a = localParts(it.start).time, b = it.end ? localParts(it.end).time : ''; l += `${a}${b ? '-' + b : ''} `; }
    l += it.label;
    if ((it.qty || 1) > 1) l += ` x${it.qty}`;
    if (it.note) l += ` — ${it.note}`;
    out.push(l);
  }
  return out.join('\n');
}

function mergeItems(parsed, old, eventDate) {
  const pool = [...(old || [])];
  return parsed.map(p => {
    const i = pool.findIndex(o => o.label.toLowerCase() === p.label.toLowerCase() && (o.section || '') === (p.section || ''));
    const j = i >= 0 ? i : pool.findIndex(o => o.label.toLowerCase() === p.label.toLowerCase());
    const id = j >= 0 ? pool.splice(j, 1)[0].id : newId();
    const it = { id, label: p.label, qty: p.qty, note: p.note || '', section: p.section || '' };
    if (p.startHM && eventDate) { it.start = toIso(eventDate, p.startHM); if (p.endHM) it.end = toIso(eventDate, p.endHM); }
    return it;
  });
}

async function editor(id, newType) {
  mount(app, el('div', { class: 'loading' }, el('div', { class: 'spinner' })));
  let orig = null, takers = {};
  if (id) {
    const d = await getDoc(doc(db, 'signups', id));
    if (!d.exists()) return go('#/');
    orig = d.data();
    for (const e of (await getDocs(collection(db, 'signups', id, 'entries'))).docs) for (const p of e.data().picks || []) takers[p.itemId] = (takers[p.itemId] || 0) + 1;
  }
  const type = orig?.type || newType;
  if (!TYPES[type]) return go('#/new');
  const ev = orig?.when || {};
  const evStart = ev.allDay ? { date: ev.start, time: '' } : localParts(ev.start);
  const evEnd = ev.allDay ? { time: '' } : localParts(ev.end);
  const f = {
    title: orig?.title || '', slug: orig?.slug || '', slugTouched: !!orig, description: orig?.description || '', location: orig?.location || '',
    hostName: orig?.hostName || HOST_NAME, date: evStart.date, start: evStart.time, end: evEnd.time,
    closeDate: localParts(orig?.closesAt).date, closeTime: localParts(orig?.closesAt).time || '20:00',
    remindDays: orig?.remindDays ?? (type === 'poll' ? 0 : 1), showNames: orig?.showNames !== false, waitlist: orig?.waitlist !== false,
    itemsText: orig ? serializeItems(orig.items || []) : '',
    nameLabel: orig?.nameLabel || (type === 'rsvp' ? 'Your name' : ''), countLabel: orig?.countLabel || 'How many people are coming?',
    maxParty: orig?.maxParty || 10, capacity: orig?.capacity || '',
    options: (orig?.options || []).map(o => ({ ...o })), questions: (orig?.questions || []).map(q => ({ ...q })),
  };
  if (type === 'poll' && !f.options.length) f.options = [{ id: newId(), date: '', start: '', end: '' }];
  const err = el('div', { role: 'alert' });

  const inp = (key, attrs = {}) => el('input', { type: 'text', value: f[key], ...attrs, oninput: (e) => { f[key] = e.target.type === 'checkbox' ? e.target.checked : e.target.value; attrs.after?.(); } });
  const fld = (label, input, hint) => el('label', { class: 'field' }, el('span', { text: label }), input, hint && el('small', { text: hint }));
  const sw = (label, key, hint) => el('label', { class: 'switch' }, el('span', {}, label, hint && el('small', { class: 'muted', style: 'display:block;font-size:15px', text: hint })),
    el('input', { type: 'checkbox', checked: f[key], onchange: (e) => { f[key] = e.target.checked; } }));

  const slugInput = inp('slug', { autocapitalize: 'off', spellcheck: 'false', after: () => { f.slugTouched = true; slugHint.textContent = `${siteUrl()}/${slugify(f.slug) || '…'}`; } });
  const slugHint = el('small', { text: `${siteUrl()}/${f.slug || '…'}` });
  const titleInput = inp('title', { after: () => { if (!f.slugTouched) { f.slug = slugify(f.title); slugInput.value = f.slug; slugHint.textContent = `${siteUrl()}/${f.slug || '…'}`; } } });

  // items preview
  const preview = el('div', { class: 'preview' });
  const drawPreview = () => {
    const parsed = parseItems(f.itemsText);
    const merged = mergeItems(parsed, orig?.items, f.date);
    const keep = new Set(merged.map(m => m.id));
    const dropped = (orig?.items || []).filter(o => !keep.has(o.id) && takers[o.id]);
    let sec = null;
    preview.replaceChildren(parsed.length ? el('div', { class: 'muted', style: 'font-size:15px', text: `${parsed.length} item${parsed.length === 1 ? '' : 's'} · ${parsed.reduce((n, p) => n + p.qty, 0)} spots` }) : el('span', { class: 'muted', text: 'Your list will preview here.' }),
      ...parsed.flatMap(p => {
        const rows = [];
        if (p.section !== sec) { sec = p.section; if (sec) rows.push(el('div', { class: 'sec', text: sec })); }
        rows.push(el('div', { class: 'it' }, el('span', {}, p.startHM ? `${p.startHM}${p.endHM ? '–' + p.endHM : ''}  ` : '', el('strong', { text: p.label }), p.note ? el('span', { class: 'muted', text: ` — ${p.note}` }) : ''), el('span', { class: 'muted', text: `×${p.qty}` })));
        return rows;
      }),
      parsed.some(p => p.startHM) && !f.date ? el('div', { class: 'warn', text: 'Add the event date below so the time slots know which day they’re on.' }) : '',
      ...dropped.map(o => el('div', { class: 'warn', text: `⚠ “${o.label}” is gone from the list but ${takers[o.id]} ${takers[o.id] === 1 ? 'person has' : 'people have'} signed up for it. Remove them on the results page first, or keep the item.` })));
  };
  const itemsBox = el('textarea', { rows: 10, value: f.itemsText, placeholder: 'Savory:\nQuiche x2 — serves 8\nBagels & cream cheese\nSweet:\nFruit salad\nCoffee cake\nDrinks:\nOrange juice x2\n9:30-10:00 Help set up x2', oninput: (e) => { f.itemsText = e.target.value; drawPreview(); } });
  if (type === 'items') drawPreview();

  // poll options
  const optsBox = el('div');
  const drawOpts = () => mount(optsBox,
    ...f.options.map((o, i) => el('div', { class: 'optrow' },
      el('label', { class: 'd' }, 'Date', el('input', { type: 'date', value: o.date, 'aria-label': 'Date', oninput: (e) => { o.date = e.target.value; } })),
      el('button', { type: 'button', class: 'x', 'aria-label': 'Remove date', text: '×', onclick: () => { f.options.splice(i, 1); drawOpts(); } }),
      el('label', {}, 'Start (optional)', el('input', { type: 'time', value: o.start || '', 'aria-label': 'Start time', oninput: (e) => { o.start = e.target.value; } })),
      el('label', {}, 'End', el('input', { type: 'time', value: o.end || '', 'aria-label': 'End time', oninput: (e) => { o.end = e.target.value; } })))),
    el('button', { type: 'button', class: 'btn small quiet', text: '+ Add a date', onclick: () => { const last = f.options[f.options.length - 1]; f.options.push({ id: newId(), date: '', start: last?.start || '', end: last?.end || '' }); drawOpts(); } }));
  if (type === 'poll') drawOpts();

  // questions
  const qBox = el('div');
  const drawQs = () => mount(qBox, ...f.questions.map((q, i) => el('div', { class: 'qrow' },
    el('input', { type: 'text', value: q.label, placeholder: 'e.g. Any allergies?', oninput: (e) => { q.label = e.target.value; } }),
    el('label', {}, el('input', { type: 'checkbox', checked: q.required, onchange: (e) => { q.required = e.target.checked; } }), 'Required'),
    el('button', { type: 'button', class: 'x', 'aria-label': 'Remove question', text: '×', onclick: () => { f.questions.splice(i, 1); drawQs(); } }))),
    el('button', { type: 'button', class: 'btn small quiet', text: '+ Add a question', onclick: () => { f.questions.push({ id: newId(), label: '', required: false }); drawQs(); } }));
  drawQs();

  const saveBtn = el('button', { class: 'btn block', text: id ? 'Save changes' : 'Create sign-up', onclick: () => save() });
  mount(app, top(id ? `#/s/${id}` : '#/new'),
    el('p', { class: 'eyebrow', text: TYPES[type][0] }), el('h1', { text: id ? 'Edit sign-up' : 'New sign-up' }),
    fld('Title', titleInput),
    fld('Link', slugInput, null), el('div', { style: 'margin:-14px 0 20px' }, slugHint),
    fld('Details for guests (optional)', el('textarea', { rows: 3, value: f.description, oninput: (e) => { f.description = e.target.value; } })),
    fld('Location (optional)', inp('location', { autocomplete: 'street-address' })),
    type !== 'poll' && el('div', {},
      fld('Event date', inp('date', { type: 'date', after: () => type === 'items' && drawPreview() })),
      el('div', { class: 'row' }, fld('Starts', inp('start', { type: 'time' })), fld('Ends', inp('end', { type: 'time' })))),
    type === 'items' && el('div', {}, el('h2', { text: 'The list' }),
      el('p', { class: 'muted small', text: 'One per line. “x2” means two people can take it. Lines ending in a colon become headings. Start a line with a time (9:30-10:00) to make it a time slot.' }),
      itemsBox, preview),
    type === 'rsvp' && el('div', {}, el('h2', { text: 'RSVP questions' }),
      fld('Name question', inp('nameLabel'), 'e.g. “Player name” for a team dinner'),
      fld('Headcount question', inp('countLabel'), 'e.g. “How many are coming, including the player?”'),
      el('div', { class: 'row' }, fld('Most per sign-up', inp('maxParty', { type: 'number', min: 1, max: 50, inputmode: 'numeric' })), fld('Total limit (optional)', inp('capacity', { type: 'number', min: 1, inputmode: 'numeric', placeholder: 'No limit' })))),
    type === 'poll' && el('div', {}, el('h2', { text: 'Dates to choose from' }), optsBox),
    el('h2', { text: 'Extra questions (optional)' }), qBox,
    el('h2', { text: 'Settings' }),
    el('div', { class: 'row' }, fld('Sign-ups close', inp('closeDate', { type: 'date' })), fld('at', inp('closeTime', { type: 'time' }))),
    el('small', { class: 'muted', style: 'display:block;margin:-12px 0 16px', text: 'After this it moves to your Archive and guests can no longer change it.' }),
    type !== 'poll' && fld('Reminder email', el('select', { onchange: (e) => { f.remindDays = Number(e.target.value); } },
      [[0, 'No reminder'], [1, '1 day before'], [2, '2 days before'], [3, '3 days before'], [7, '1 week before']].map(([v, t]) => el('option', { value: v, selected: f.remindDays === v, text: t })))),
    fld('Your name as host', inp('hostName')),
    sw('Show names on the sign-up', 'showNames', 'Guests see who signed up for what'),
    type !== 'poll' && sw('Waitlist when full', 'waitlist', 'Otherwise full items can’t be chosen'),
    err, el('div', { class: 'btns' }, saveBtn));

  async function save() {
    const bad = (m) => { err.replaceChildren(el('div', { class: 'notice err', text: m })); err.scrollIntoView({ block: 'center', behavior: 'smooth' }); };
    err.replaceChildren();
    const slug = slugify(f.slug || f.title);
    if (!f.title.trim()) return bad('Please add a title.');
    if (!slug || RESERVED.has(slug)) return bad('Please choose a different link.');
    if (!f.closeDate) return bad('Please choose when sign-ups close.');
    const closesAt = toIso(f.closeDate, f.closeTime || '20:00');
    if (!id && Date.parse(closesAt) < Date.now()) return bad('The closing time is in the past.');
    let when = null;
    if (type !== 'poll' && f.date) when = f.start ? { allDay: false, start: toIso(f.date, f.start), ...(f.end ? { end: toIso(f.date, f.end) } : {}) } : { allDay: true, start: f.date };
    if (type === 'poll' && orig?.when) when = orig.when;
    const data = {
      type, title: f.title.trim(), slug, description: f.description.trim(), location: f.location.trim(), hostName: f.hostName.trim(), when,
      closesAt, tz: Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/New_York',
      remindDays: type === 'poll' ? (orig?.remindDays || 0) : f.remindDays, showNames: f.showNames, waitlist: f.waitlist,
      questions: f.questions.filter(q => q.label.trim()).map(q => ({ id: q.id, label: q.label.trim(), required: !!q.required })),
      updatedAt: Date.now(),
    };
    if (type === 'items') {
      data.items = mergeItems(parseItems(f.itemsText), orig?.items, f.date);
      if (!data.items.length) return bad('Please add at least one item to the list.');
      if (data.items.some(i => !i.start) && data.items.some(i => i.start) && !f.date) return bad('Add the event date so the time slots know which day they’re on.');
      if (parseItems(f.itemsText).some(p => p.startHM) && !f.date) return bad('Add the event date so the time slots know which day they’re on.');
    }
    if (type === 'rsvp') Object.assign(data, { nameLabel: f.nameLabel.trim() || 'Your name', countLabel: f.countLabel.trim() || 'How many people are coming?', maxParty: Math.max(1, Number(f.maxParty) || 10), capacity: Number(f.capacity) || 0 });
    if (type === 'poll') {
      const opts = f.options.filter(o => o.date).map(o => ({ id: o.id, date: o.date, start: o.start || '', end: o.end || '' })).sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));
      if (opts.length < 2) return bad('Add at least two dates to choose from.');
      data.options = opts;
    }
    // reminder timing
    if (data.remindDays && when?.start) {
      const base = when.allDay ? Date.parse(`${when.start}T09:00`) : Date.parse(when.start);
      const at = new Date(base - data.remindDays * 86400000).toISOString();
      if (at !== orig?.reminderAt) { data.reminderAt = at; data.reminderSent = false; }
    } else { data.reminderAt = null; data.reminderSent = true; }

    saveBtn.disabled = true; saveBtn.textContent = 'Saving…';
    try {
      const batch = writeBatch(db);
      if (!id) {
        const ref = doc(collection(db, 'signups'));
        const taken = await getDoc(doc(db, 'slugs', slug));
        if (taken.exists()) { saveBtn.disabled = false; saveBtn.textContent = 'Create sign-up'; return bad('That link is already used. Try another.'); }
        batch.set(ref, { ...data, ownerUid: user.uid, status: 'open', sequence: 0, createdAt: Date.now() });
        batch.set(doc(db, 'slugs', slug), { signupId: ref.id, ownerUid: user.uid });
        await batch.commit();
        toast('Created!');
        return go(`#/s/${ref.id}`);
      }
      if (slug !== orig.slug) {
        const taken = await getDoc(doc(db, 'slugs', slug));
        if (taken.exists()) { saveBtn.disabled = false; saveBtn.textContent = 'Save changes'; return bad('That link is already used. Try another.'); }
        batch.set(doc(db, 'slugs', slug), { signupId: id, ownerUid: user.uid });
        batch.delete(doc(db, 'slugs', orig.slug));
      }
      if (orig.status !== 'open' && Date.parse(closesAt) > Date.now() && orig.closesAt !== closesAt) data.status = 'open';
      batch.update(doc(db, 'signups', id), data);
      await batch.commit();
      toast('Saved');
      go(`#/s/${id}`);
    } catch (e) { saveBtn.disabled = false; saveBtn.textContent = id ? 'Save changes' : 'Create sign-up'; bad(errText(e)); }
  }
}

// ---------------- results ----------------
function detail(id) {
  let s = null, entries = [], priv = {};
  const draw = () => {
    if (!s || location.hash !== `#/s/${id}`) return;
    const link = linkFor(s);
    const isOpen = s.status === 'open' && !s.cancelled;
    const share = async () => { if (navigator.share) { try { await navigator.share({ title: s.title, url: link }); } catch {} } else if (await copyText(link)) toast('Link copied'); };
    const head = [top('#/'), el('span', { class: 'tag green', text: TYPES[s.type][0] }),
      el('h1', { style: 'margin-top:10px', text: s.title }),
      el('p', { class: 'muted', text: [s.when?.start && fmtWhen(s.when, s.tz), s.location].filter(Boolean).join(' · ') }),
      s.cancelled ? el('div', { class: 'notice err', text: 'This event is cancelled.' })
        : isOpen ? el('p', { class: 'closes', style: 'margin-top:0', text: `Open · closes ${fmtDay(s.closesAt, s.tz)}` }) : el('div', { class: 'notice warn', text: `Closed${s.archivedAt ? ' ' + fmtDay(s.archivedAt, s.tz) : ''} — in your Archive.` }),
      el('div', { class: 'linkbox', style: 'margin-top:16px' }, el('a', { href: link, target: '_blank', rel: 'noopener', text: link }),
        el('button', { class: 'btn small quiet', 'aria-label': 'Copy link', onclick: async () => { if (await copyText(link)) toast('Link copied'); } }, iconEl('copy'))),
      el('div', { class: 'actions' },
        el('button', { class: 'btn small', onclick: share }, iconEl('share'), 'Share link'),
        el('a', { class: 'btn small ghost', href: `/print?id=${id}`, target: '_blank' }, iconEl('print'), 'Print'),
        el('button', { class: 'btn small ghost', onclick: () => go(`#/edit/${id}`), text: 'Edit' }))];
    const body = s.type === 'items' ? itemsResults() : s.type === 'rsvp' ? rsvpResults() : pollResults();
    mount(app, ...head, ...body, moreActions(isOpen));
  };

  const person = (e, extra) => {
    const p = priv[e.id] || {};
    const answers = (s.questions || []).filter(q => p.answers?.[q.id]).map(q => `${q.label} ${p.answers[q.id]}`);
    return el('div', { class: 'person' },
      el('div', {}, el('strong', { text: p.name || e.name || 'Guest' }), extra ? el('span', { class: 'muted', text: ` · ${extra}` }) : ''),
      p.email ? el('a', { class: 'sub', href: `mailto:${p.email}`, text: p.email }) : el('span', { class: 'sub', text: 'no email' }),
      answers.length ? el('div', { class: 'sub', text: answers.join(' · ') }) : '',
      el('button', { class: 'btn small danger rm', text: 'Remove', onclick: () => removePerson(e, p) }));
  };

  function itemsResults() {
    const out = [];
    const filled = s.items.reduce((n, it) => n + Math.min(it.qty || 1, entries.filter(e => (e.picks || []).some(p => p.itemId === it.id && !p.waitlisted)).length), 0);
    const total = s.items.reduce((n, it) => n + (it.qty || 1), 0);
    out.push(el('h2', { text: `${filled} of ${total} spots filled` }));
    let sec = null;
    for (const it of s.items) {
      if (it.section !== sec) { sec = it.section; if (sec) out.push(el('h4', { class: 'section-title', text: sec })); }
      const people = entries.filter(e => (e.picks || []).some(p => p.itemId === it.id && !p.waitlisted));
      const wl = entries.filter(e => (e.picks || []).some(p => p.itemId === it.id && p.waitlisted));
      const open = Math.max(0, (it.qty || 1) - people.length);
      out.push(el('div', { class: 'res-item' },
        el('div', { class: 'head' }, el('span', {}, it.start ? `${fmtWhen({ start: it.start, end: it.end }, s.tz, { timeOnly: true })} · ` : '', it.label), el('span', { class: open ? 'tag' : 'tag green', text: open ? `${open} open` : 'Full' })),
        it.note && el('div', { class: 'muted small', text: it.note }),
        people.map(e => person(e)), wl.map(e => person(e, 'waitlist'))));
    }
    return out;
  }
  function rsvpResults() {
    const coming = entries.filter(e => !e.waitlisted), wl = entries.filter(e => e.waitlisted);
    const total = coming.reduce((n, e) => n + (e.partySize || 0), 0);
    return [el('div', { class: 'total' }, el('b', { text: String(total) }), el('span', { class: 'muted', text: `coming${s.capacity ? ` of ${s.capacity}` : ''} · ${coming.length} sign-ups` })),
      el('div', {}, coming.map(e => person(e, `${e.partySize}`))),
      wl.length ? [el('h2', { text: 'Waitlist' }), wl.map(e => person(e, `${e.partySize}`))] : []];
  }
  function pollResults() {
    const out = [];
    const score = (o) => entries.reduce((n, e) => n + (e.availability?.[o.id] === 'yes' ? 2 : e.availability?.[o.id] === 'maybe' ? 1 : 0), 0);
    const ranked = [...s.options].sort((a, b) => score(b) - score(a));
    out.push(el('h2', { text: `${entries.length} response${entries.length === 1 ? '' : 's'}` }));
    if (s.finalOptionId) out.push(el('div', { class: 'notice ok', text: `Date set: ${fmtWhen(s.when, s.tz)}. Everyone who left an email got an invite.` }));
    for (const o of ranked) {
      const by = (v) => entries.filter(e => e.availability?.[o.id] === v).map(e => priv[e.id]?.name || e.name || 'Guest');
      const yes = by('yes'), maybe = by('maybe'), no = by('no');
      out.push(el('div', { class: 'res-item' },
        el('div', { class: 'head' }, el('span', { text: fmtOption(o) }), el('span', { class: 'tag green', text: `${yes.length} yes · ${maybe.length} maybe` })),
        yes.length ? el('div', { class: 'small' }, el('strong', { text: 'Yes: ' }), yes.join(', ')) : '',
        maybe.length ? el('div', { class: 'small' }, el('strong', { text: 'Maybe: ' }), maybe.join(', ')) : '',
        no.length ? el('div', { class: 'small muted' }, 'No: ', no.join(', ')) : '',
        !s.finalOptionId && el('button', { class: 'btn small', style: 'margin-top:10px', text: 'Pick this date', onclick: () => pickDate(o) })));
    }
    if (entries.length) out.push(el('h2', { text: 'Everyone' }), el('div', {}, entries.map(e => person(e))));
    return out;
  }

  function moreActions(isOpen) {
    const exportText = () => toText(s, entries, priv);
    return el('details', { class: 'more', style: 'margin-top:30px' }, el('summary', { text: 'More: close, export, cancel, delete' }),
      el('div', { class: 'btns' },
        isOpen ? el('button', { class: 'btn quiet', text: 'Close sign-ups now', onclick: async () => { await updateDoc(doc(db, 'signups', id), { status: 'archived', archivedAt: new Date().toISOString() }); toast('Closed and archived'); } })
          : !s.cancelled && el('button', { class: 'btn quiet', text: 'Reopen…', onclick: reopen }),
        el('button', { class: 'btn quiet', text: 'Copy results as text (to paste to Claude or an email)', onclick: async () => { if (await copyText(exportText())) toast('Copied'); } }),
        el('button', { class: 'btn quiet', text: 'Download spreadsheet (CSV)', onclick: () => downloadCsv(s, entries, priv) }),
        !s.cancelled && el('button', { class: 'btn danger', text: 'Cancel the event…', onclick: cancelEvent }),
        el('button', { class: 'btn danger', text: 'Delete forever…', onclick: del })));
  }

  function removePerson(e, p) {
    sheet((close) => {
      const btn = el('button', { class: 'btn danger block', text: 'Remove' });
      btn.onclick = async () => { btn.disabled = true; try { await adminRemove({ signupId: id, entryId: e.id }); close(); toast('Removed'); } catch (x) { btn.disabled = false; btn.before(el('div', { class: 'notice err', text: errText(x) })); } };
      return [el('h2', { text: `Remove ${p.name || e.name || 'this guest'}?` }), el('p', { text: p.email ? 'They’ll get an email saying they were removed, and it comes off their calendar. The next person on the waitlist moves up.' : 'The next person on the waitlist moves up.' }), btn,
        el('button', { class: 'btn quiet block', style: 'margin-top:10px', text: 'Keep', onclick: close })];
    });
  }
  function pickDate(o) {
    sheet((close) => {
      const st = el('input', { type: 'time', value: o.start || '' }), en = el('input', { type: 'time', value: o.end || '' });
      const btn = el('button', { class: 'btn block', text: 'Set the date and send invites' });
      btn.onclick = async () => {
        btn.disabled = true;
        const when = st.value ? { allDay: false, start: toIso(o.date, st.value), ...(en.value ? { end: toIso(o.date, en.value) } : {}) } : { allDay: true, start: o.date };
        await updateDoc(doc(db, 'signups', id), { when, finalOptionId: o.id, status: 'archived', archivedAt: new Date().toISOString(), sequence: (s.sequence || 0) + 1, firstInvite: true });
        close(); toast('Date set — invites are on their way');
      };
      return [el('h2', { text: fmtOption(o) }), el('p', { class: 'muted', text: 'Everyone who answered Yes or Maybe and left an email gets a calendar invite. The poll closes.' }),
        el('div', { class: 'row' }, el('label', { class: 'field' }, el('span', { text: 'Starts' }), st), el('label', { class: 'field' }, el('span', { text: 'Ends' }), en)),
        el('small', { class: 'muted', style: 'display:block;margin:-10px 0 16px', text: 'Leave blank for an all-day event.' }), btn,
        el('button', { class: 'btn quiet block', style: 'margin-top:10px', text: 'Not yet', onclick: close })];
    });
  }
  function reopen() {
    sheet((close) => {
      const d = el('input', { type: 'date' }), t = el('input', { type: 'time', value: '20:00' });
      const btn = el('button', { class: 'btn block', text: 'Reopen' });
      btn.onclick = async () => { if (!d.value) return; const at = toIso(d.value, t.value); if (Date.parse(at) < Date.now()) return; await updateDoc(doc(db, 'signups', id), { status: 'open', closesAt: at }); close(); toast('Reopened'); };
      return [el('h2', { text: 'Reopen until…' }), el('div', { class: 'row' }, el('label', { class: 'field' }, el('span', { text: 'Date' }), d), el('label', { class: 'field' }, el('span', { text: 'Time' }), t)), btn];
    });
  }
  function cancelEvent() {
    sheet((close) => {
      const btn = el('button', { class: 'btn danger block', text: 'Cancel the event' });
      btn.onclick = async () => { btn.disabled = true; await updateDoc(doc(db, 'signups', id), { cancelled: true, status: 'archived', archivedAt: new Date().toISOString(), sequence: (s.sequence || 0) + 1 }); close(); toast('Cancelled — guests are being notified'); };
      return [el('h2', { text: 'Cancel this event?' }), el('p', { text: 'Everyone who left an email gets a cancellation, and it comes off their calendar. This can’t be undone.' }), btn,
        el('button', { class: 'btn quiet block', style: 'margin-top:10px', text: 'Keep it', onclick: close })];
    });
  }
  function del() {
    sheet((close) => {
      const btn = el('button', { class: 'btn danger block', text: 'Delete forever' });
      btn.onclick = async () => {
        btn.disabled = true;
        const b = writeBatch(db);
        b.delete(doc(db, 'slugs', s.slug)); b.delete(doc(db, 'signups', id));
        await b.commit(); close(); toast('Deleted'); go('#/');
      };
      return [el('h2', { text: 'Delete this sign-up?' }), el('p', { text: 'The link stops working and the results are gone. No one is emailed. To keep a record, close it instead — it stays in your Archive.' }), btn,
        el('button', { class: 'btn quiet block', style: 'margin-top:10px', text: 'Keep it', onclick: close })];
    });
  }

  unsub.push(onSnapshot(doc(db, 'signups', id), (d) => { if (!d.exists()) return go('#/'); s = d.data(); draw(); }));
  unsub.push(onSnapshot(collection(db, 'signups', id, 'entries'), (q) => { entries = q.docs.map(x => ({ id: x.id, ...x.data() })).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0)); draw(); }));
  unsub.push(onSnapshot(collection(db, 'signups', id, 'private'), (q) => { priv = Object.fromEntries(q.docs.map(x => [x.id, x.data()])); draw(); }));
}

// ---------------- export ----------------
export function toText(s, entries, priv) {
  const name = (e) => priv[e.id]?.name || e.name || 'Guest';
  const L = [s.title, [s.when?.start && fmtWhen(s.when, s.tz), s.location].filter(Boolean).join(' · '), ''];
  const ans = (e) => (s.questions || []).filter(q => priv[e.id]?.answers?.[q.id]).map(q => `${q.label} ${priv[e.id].answers[q.id]}`).join('; ');
  if (s.type === 'items') {
    let sec = null;
    for (const it of s.items) {
      if (it.section !== sec) { sec = it.section; if (sec) L.push('', sec.toUpperCase()); }
      const ppl = entries.filter(e => (e.picks || []).some(p => p.itemId === it.id && !p.waitlisted)).map(name);
      const wl = entries.filter(e => (e.picks || []).some(p => p.itemId === it.id && p.waitlisted)).map(name);
      const open = Math.max(0, (it.qty || 1) - ppl.length);
      L.push(`- ${it.start ? fmtWhen({ start: it.start, end: it.end }, s.tz, { timeOnly: true }) + ' ' : ''}${it.label}: ${ppl.join(', ') || '—'}${open ? ` (${open} open)` : ''}${wl.length ? ` [waitlist: ${wl.join(', ')}]` : ''}`);
    }
  } else if (s.type === 'rsvp') {
    const coming = entries.filter(e => !e.waitlisted);
    L.push(`Total coming: ${coming.reduce((n, e) => n + e.partySize, 0)}`);
    for (const e of coming) L.push(`- ${name(e)}: ${e.partySize}${ans(e) ? ` (${ans(e)})` : ''}`);
    const wl = entries.filter(e => e.waitlisted);
    if (wl.length) L.push('', 'Waitlist:', ...wl.map(e => `- ${name(e)}: ${e.partySize}`));
  } else {
    for (const o of s.options) {
      const by = (v) => entries.filter(e => e.availability?.[o.id] === v).map(name);
      L.push(`- ${fmtOption(o)}: yes ${by('yes').length} (${by('yes').join(', ')}); maybe ${by('maybe').length}${by('maybe').length ? ` (${by('maybe').join(', ')})` : ''}`);
    }
  }
  const qa = s.type !== 'rsvp' ? entries.filter(e => ans(e)).map(e => `- ${name(e)}: ${ans(e)}`) : [];
  if (qa.length) L.push('', 'Answers:', ...qa);
  return L.join('\n');
}

function downloadCsv(s, entries, priv) {
  const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const qs = s.questions || [];
  const head = ['Name', 'Email', s.type === 'items' ? 'Items' : s.type === 'rsvp' ? 'Count' : 'Dates', 'Waitlist', ...qs.map(x => x.label), 'Signed up'];
  const byId = Object.fromEntries((s.items || []).map(i => [i.id, i.label]));
  const rows = entries.map(e => {
    const p = priv[e.id] || {};
    const what = s.type === 'items' ? (e.picks || []).map(x => byId[x.itemId] + (x.waitlisted ? ' (waitlist)' : '')).join('; ')
      : s.type === 'rsvp' ? e.partySize : s.options.filter(o => e.availability?.[o.id]).map(o => `${fmtOption(o)}: ${e.availability[o.id]}`).join('; ');
    const wl = s.type === 'rsvp' ? (e.waitlisted ? 'yes' : '') : (e.picks || []).some(x => x.waitlisted) ? 'yes' : '';
    return [p.name || e.name, p.email || '', what, wl, ...qs.map(x => p.answers?.[x.id] || ''), new Date(e.createdAt).toLocaleString()];
  });
  const csv = [head, ...rows].map(r => r.map(q).join(',')).join('\r\n');
  const a = el('a', { href: URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv' })), download: `${s.slug}.csv` });
  document.body.append(a); a.click(); a.remove();
}
