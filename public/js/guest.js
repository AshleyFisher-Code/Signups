// The page guests see. No sign-in: they pick, type a name, and the server confirms.
import { doc, getDoc, onSnapshot, collection } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
import { db, call, errText } from './fb.js';
import { el, mount, iconEl, fmtWhen, fmtDay, fmtOption, toast, sheet, googleCalUrl, icsFile } from './ui.js';

const app = document.getElementById('app');
const slug = decodeURIComponent(location.pathname.replace(/^\/+|\/+$/g, '')).toLowerCase();
const submit = call('submit'), cancelFn = call('cancel'), lookup = call('lookup');

const st = {
  id: null, s: null, entries: [], loaded: { s: false, e: false },
  selected: new Set(), partySize: 1, availability: {},
  form: { name: '', email: '', answers: {} },
  mine: null,          // { entryId, token, name, email, answers }
  editing: false, busy: false, done: null, error: '',
};

const store = {
  key: () => `signup:${st.id}`,
  get() { try { return JSON.parse(localStorage.getItem(this.key())) || null; } catch { return null; } },
  set(v) { try { v ? localStorage.setItem(this.key(), JSON.stringify(v)) : localStorage.removeItem(this.key()); } catch {} },
};

function fatal(msg) {
  mount(app, el('div', { class: 'center', style: 'padding-top:60px' },
    el('p', { class: 'eyebrow', text: 'Sign-up' }), el('h1', { text: msg }),
    el('p', { class: 'muted', text: 'Please check the link you were sent, or ask the host for a new one.' })));
}

async function start() {
  if (!slug || slug.includes('/')) return fatal('We couldn’t find that sign-up.');
  let ref;
  try { ref = await getDoc(doc(db, 'slugs', slug)); } catch { return fatal('We couldn’t load this sign-up.'); }
  if (!ref.exists()) return fatal('We couldn’t find that sign-up.');
  st.id = ref.data().signupId;
  st.mine = store.get();

  const q = new URLSearchParams(location.search);
  if (q.get('e') && q.get('t')) {
    try {
      const r = await lookup({ signupId: st.id, entryId: q.get('e'), token: q.get('t') });
      st.mine = { entryId: q.get('e'), token: q.get('t'), name: r.name, email: r.email, answers: r.answers || {} };
      store.set(st.mine);
    } catch (e) { st.error = errText(e); }
    history.replaceState(null, '', location.pathname);
  }

  onSnapshot(doc(db, 'signups', st.id), (d) => {
    if (!d.exists()) return fatal('This sign-up was removed.');
    st.s = d.data(); st.loaded.s = true;
    document.title = st.s.title;
    render();
  }, () => fatal('We couldn’t load this sign-up.'));
  onSnapshot(collection(db, 'signups', st.id, 'entries'), (qs) => {
    st.entries = qs.docs.map(x => ({ id: x.id, ...x.data() })).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
    st.loaded.e = true;
    if (st.mine && !st.entries.find(e => e.id === st.mine.entryId) && !st.busy) { st.mine = null; store.set(null); }
    render();
  });
}

const open = () => st.s.status === 'open' && !st.s.cancelled && (!st.s.closesAt || Date.parse(st.s.closesAt) > Date.now());
const myEntry = () => st.mine && st.entries.find(e => e.id === st.mine.entryId);

// ---------------- rendering ----------------
function render() {
  if (!st.loaded.s || !st.loaded.e) return;
  const y = scrollY;
  const s = st.s;
  const kids = [header(s)];
  if (st.error) kids.push(el('div', { class: 'notice err', role: 'alert', text: st.error }));

  if (st.done) kids.push(...doneView());
  else {
    if (s.cancelled) kids.push(el('div', { class: 'notice err' }, el('strong', { text: 'This event has been cancelled.' })));
    else if (!open()) kids.push(el('div', { class: 'notice warn' }, el('strong', { text: 'Sign-ups are closed.' }), ' ', 'Contact the host if you need to make a change.'));
    const mine = myEntry();
    if (mine && !st.editing) kids.push(mineCard(mine));
    if (s.type === 'items') kids.push(...itemsView());
    if (s.type === 'rsvp') kids.push(...rsvpView());
    if (s.type === 'poll') kids.push(...pollView());
  }
  kids.push(el('p', { class: 'footer', text: `Hosted by ${s.hostName || 'the host'}` }));
  // Live updates re-draw the page; keep the cursor where the guest is typing.
  const inputs = () => [...app.querySelectorAll('input,textarea')];
  const a = document.activeElement, fi = inputs().indexOf(a), sel = fi >= 0 ? [a.selectionStart, a.selectionEnd] : null;
  mount(app, ...kids);
  if (fi >= 0) { const n = inputs()[fi]; if (n) { n.focus({ preventScroll: true }); try { n.setSelectionRange(...sel); } catch {} } }
  document.querySelector('.bar')?.remove();
  if (!st.done && open() && (!myEntry() || st.editing)) {
    if (s.type === 'items') document.body.append(itemsBar());
  }
  scrollTo(0, y);
}

function header(s) {
  const facts = [];
  if (s.when?.start) facts.push(el('div', { class: 'fact' }, iconEl('cal'), el('div', { text: fmtWhen(s.when, s.tz) })));
  if (s.type === 'poll' && !s.when?.start) facts.push(el('div', { class: 'fact' }, iconEl('cal'), el('div', { text: 'Help us pick a date' })));
  if (s.location) facts.push(el('div', { class: 'fact' }, iconEl('pin'),
    el('a', { href: `https://maps.google.com/?q=${encodeURIComponent(s.location)}`, target: '_blank', rel: 'noopener', text: s.location })));
  return el('header', {},
    el('p', { class: 'eyebrow', text: { items: 'Sign-up', rsvp: 'RSVP', poll: 'Find a date' }[s.type] }),
    el('h1', { text: s.title }),
    facts.length && el('div', { class: 'facts' }, facts),
    s.description && el('p', { class: 'desc', text: s.description }),
    open() && s.closesAt && el('span', { class: 'closes', text: `Sign-ups close ${fmtDay(s.closesAt, s.tz)}` }),
    el('hr', { class: 'rule' }));
}

function mineCard(mine) {
  const s = st.s;
  const lines = describe(mine);
  return el('section', { class: 'notice ok' },
    el('h3', { text: `You’re signed up${st.mine.name ? ', ' + st.mine.name.split(' ')[0] : ''}!` }),
    el('ul', { class: 'list-plain' }, lines.map(l => el('li', { text: l }))),
    el('div', { class: 'btns inline' },
      calendarButtons(mine),
      open() && el('button', { class: 'btn small ghost', onclick: startEdit, text: 'Change' }),
      open() && el('button', { class: 'btn small danger', onclick: confirmCancel, text: 'Cancel my sign-up' })));
}

function describe(e) {
  const s = st.s;
  if (s.type === 'items') {
    const byId = Object.fromEntries(s.items.map(i => [i.id, i]));
    return (e.picks || []).filter(p => byId[p.itemId]).map(p => {
      const it = byId[p.itemId];
      return it.label + (it.start ? ` — ${fmtWhen({ start: it.start, end: it.end }, s.tz, { timeOnly: true })}` : '') + (p.waitlisted ? ' (waitlist)' : '');
    });
  }
  if (s.type === 'rsvp') return [`${e.partySize} ${e.partySize === 1 ? 'person' : 'people'} coming${e.waitlisted ? ' (waitlist)' : ''}`];
  const word = { yes: 'Yes', maybe: 'Maybe', no: 'No' };
  return (s.options || []).filter(o => e.availability?.[o.id]).map(o => `${fmtOption(o)}: ${word[e.availability[o.id]]}`);
}

function calendarButtons(entry) {
  const s = st.s;
  if (!s.when?.start || entry.waitlisted) return null;
  const details = describe(entry).join('\n');
  const ev = { title: s.title, start: s.when.start, end: s.when.end, allDay: s.when.allDay, details, location: s.location, uid: `${entry.id}@signup` };
  return [
    el('a', { class: 'btn small quiet', href: googleCalUrl(ev), target: '_blank', rel: 'noopener' }, iconEl('cal'), 'Google Calendar'),
    el('a', { class: 'btn small quiet', href: icsFile(ev), download: `${slug}.ics` }, iconEl('cal'), 'Apple / Outlook'),
  ];
}

// ---------------- items ----------------
function itemsView() {
  const s = st.s;
  const mine = myEntry();
  const myIds = new Set((mine?.picks || []).map(p => p.itemId));
  const taken = {}, names = {};
  for (const e of st.entries) for (const p of e.picks || []) {
    if (p.waitlisted) continue;
    taken[p.itemId] = (taken[p.itemId] || 0) + 1;
    if (e.name) (names[p.itemId] ||= []).push(e.name);
  }
  const canPick = open() && (!mine || st.editing);
  const out = [];
  let section = null, list = null;
  const totalOpen = s.items.reduce((n, i) => n + Math.max(0, (i.qty || 1) - (taken[i.id] || 0)), 0);
  out.push(el('p', { class: 'muted', text: canPick ? `Tap what you’d like to bring. ${totalOpen} spot${totalOpen === 1 ? '' : 's'} still open.` : `${totalOpen} spot${totalOpen === 1 ? '' : 's'} still open.` }));
  for (const it of s.items) {
    if (it.section !== section || !list) {
      section = it.section;
      if (section) out.push(el('h4', { class: 'section-title', text: section }));
      list = el('div', { class: 'items' });
      out.push(list);
    }
    const cap = Math.max(1, it.qty || 1), n = taken[it.id] || 0;
    const full = n >= cap && !myIds.has(it.id);
    const pressed = st.selected.has(it.id);
    const who = names[it.id]?.length ? el('div', { class: 'who' }, 'Signed up: ', el('b', { text: names[it.id].join(', ') })) : null;
    const dots = cap > 1 || full ? el('div', { class: 'spots' },
      el('span', { class: 'dots', 'aria-hidden': 'true' }, Array.from({ length: Math.min(cap, 12) }, (_, i) => el('i', { class: i < n ? '' : 'open' }))),
      full ? el('span', { class: 'tag', text: s.waitlist === false ? 'Full' : 'Full — join waitlist' }) : el('span', { text: `${cap - n} of ${cap} still needed` })) : null;
    const body = [
      el('div', {},
        it.start && el('div', { class: 'time', text: fmtWhen({ start: it.start, end: it.end }, s.tz, { timeOnly: true }) }),
        el('div', { class: 'label', text: it.label }),
        it.note && el('div', { class: 'note', text: it.note })),
      canPick && !(full && s.waitlist === false) ? el('span', { class: 'check', html: '' }, iconEl('check')) : el('span'),
      dots, who,
    ];
    if (canPick && !(full && s.waitlist === false)) {
      list.append(el('button', { type: 'button', class: `item${full ? ' full' : ''}`, 'aria-pressed': String(pressed),
        onclick: () => { pressed ? st.selected.delete(it.id) : st.selected.add(it.id); render(); } }, body));
    } else {
      list.append(el('div', { class: `item${full ? ' full' : ''}${myIds.has(it.id) ? ' mine' : ''}`, style: 'cursor:default' }, body));
    }
  }
  return out;
}

function itemsBar() {
  const n = st.selected.size;
  return el('div', { class: 'bar' }, el('div', { class: 'inner' },
    st.editing && el('button', { class: 'btn quiet', style: 'flex:0 0 auto', onclick: () => { st.editing = false; st.selected.clear(); render(); }, text: 'Back' }),
    el('button', { class: 'btn', disabled: !n, onclick: () => detailsSheet(), text: n ? `Continue with ${n} item${n === 1 ? '' : 's'}` : 'Choose an item above' })));
}

// ---------------- RSVP ----------------
function rsvpView() {
  const s = st.s;
  const coming = st.entries.filter(e => !e.waitlisted);
  const total = coming.reduce((n, e) => n + (e.partySize || 0), 0);
  const out = [el('div', { class: 'total' }, el('b', { text: String(total) }),
    el('span', { class: 'muted', text: `${total === 1 ? 'person' : 'people'} coming${s.capacity ? ` of ${s.capacity}` : ''} · ${coming.length} sign-up${coming.length === 1 ? '' : 's'}` }))];
  const mine = myEntry();
  if (open() && (!mine || st.editing)) {
    const max = s.maxParty || 12;
    const out2 = el('output', { text: String(st.partySize) });
    const minus = el('button', { type: 'button', 'aria-label': 'One fewer', text: '−', disabled: st.partySize <= 1 });
    const plus = el('button', { type: 'button', 'aria-label': 'One more', text: '+', disabled: st.partySize >= max });
    const upd = () => { out2.textContent = st.partySize; minus.disabled = st.partySize <= 1; plus.disabled = st.partySize >= max; };
    minus.onclick = () => { st.partySize = Math.max(1, st.partySize - 1); upd(); };
    plus.onclick = () => { st.partySize = Math.min(max, st.partySize + 1); upd(); };
    out.push(el('section', { class: 'card', style: 'margin-top:20px' },
      el('h2', { style: 'margin-top:0', text: st.editing ? 'Update your RSVP' : 'RSVP' }),
      field(s.nameLabel || 'Your name', 'name', { autocomplete: 'name' }),
      el('div', { class: 'field', style: 'margin-bottom:22px' }, el('span', { style: 'display:block;font-weight:600;margin-bottom:10px', text: s.countLabel || 'How many people are coming?' }),
        el('div', { class: 'stepper' }, minus, out2, plus)),
      ...detailFields(),
      submitButton(st.editing ? 'Save changes' : 'Send RSVP'),
      st.editing && el('button', { class: 'btn quiet block', style: 'margin-top:10px', onclick: () => { st.editing = false; render(); }, text: 'Never mind' })));
  }
  if (s.showNames !== false && coming.length) {
    out.push(el('h2', { text: 'Who’s coming' }), el('ul', { class: 'list-plain' },
      coming.map(e => el('li', {}, el('span', { text: e.name || 'Guest' }), el('span', { class: 'muted', text: ` · ${e.partySize}` })))));
  }
  const wl = st.entries.filter(e => e.waitlisted);
  if (wl.length && s.showNames !== false) out.push(el('p', { class: 'muted small', text: `Waitlist: ${wl.map(e => `${e.name || 'Guest'} (${e.partySize})`).join(', ')}` }));
  return out;
}

// ---------------- date poll ----------------
function pollView() {
  const s = st.s;
  const mine = myEntry();
  const canVote = open() && (!mine || st.editing);
  const score = (o) => st.entries.reduce((n, e) => n + (e.availability?.[o.id] === 'yes' ? 2 : e.availability?.[o.id] === 'maybe' ? 1 : 0), 0);
  const best = Math.max(0, ...s.options.map(score));
  const out = [];
  if (s.finalOptionId) {
    const o = s.options.find(x => x.id === s.finalOptionId);
    out.push(el('div', { class: 'notice ok' }, el('strong', { text: 'The date is set: ' }), o ? fmtOption(o) : fmtWhen(s.when, s.tz)));
  } else if (canVote) out.push(el('p', { class: 'muted', text: 'For each date, tap Yes, Maybe or No.' }));
  const list = el('div', { class: 'items' });
  for (const o of s.options) {
    const y = st.entries.filter(e => e.availability?.[o.id] === 'yes').length;
    const m = st.entries.filter(e => e.availability?.[o.id] === 'maybe').length;
    const tot = st.entries.length || 1;
    const isBest = best > 0 && score(o) === best;
    const seg = canVote ? el('div', { class: 'seg', role: 'group', 'aria-label': fmtOption(o) },
      ['yes', 'maybe', 'no'].map(v => el('button', { type: 'button', 'data-v': v, 'aria-pressed': String(st.availability[o.id] === v),
        onclick: () => { st.availability[o.id] = st.availability[o.id] === v ? undefined : v; render(); }, text: { yes: 'Yes', maybe: 'Maybe', no: 'No' }[v] }))) : null;
    list.append(el('div', { class: `opt${isBest ? ' best' : ''}` },
      el('div', { style: 'display:flex;justify-content:space-between;gap:10px;align-items:baseline' },
        el('span', { class: 'when', text: fmtOption(o) }), isBest && el('span', { class: 'tag', text: 'Most popular' })),
      o.label && el('div', { class: 'note muted small', text: o.label }),
      seg,
      el('div', { class: 'bars' }, el('span', { class: 'y', style: `width:${(y / tot) * 100}%` }), el('span', { class: 'm', style: `width:${(m / tot) * 100}%` })),
      el('div', { class: 'tally', text: `${y} yes · ${m} maybe` })));
  }
  out.push(list);
  if (canVote) {
    out.push(el('section', { class: 'card', style: 'margin-top:22px' },
      field('Your name', 'name', { autocomplete: 'name' }), ...detailFields(),
      submitButton(st.editing ? 'Save changes' : 'Send my dates'),
      st.editing && el('button', { class: 'btn quiet block', style: 'margin-top:10px', onclick: () => { st.editing = false; render(); }, text: 'Never mind' })));
  }
  if (s.showNames !== false && st.entries.length) {
    const mark = { yes: ['✓', 'y-mark'], maybe: ['?', 'm-mark'], no: ['–', 'n-mark'] };
    out.push(el('h2', { text: 'Everyone’s answers' }), el('div', { class: 'grid-wrap' }, el('table', { class: 'grid' },
      el('thead', {}, el('tr', {}, el('th', { text: '' }), s.options.map(o => el('th', { text: fmtOption(o).replace(' · ', ' ') })))),
      el('tbody', {}, st.entries.map(e => el('tr', {}, el('td', { text: e.name || 'Guest' }),
        s.options.map(o => { const v = e.availability?.[o.id]; return el('td', { class: v ? mark[v][1] : 'n-mark', text: v ? mark[v][0] : '' }); })))))));
  }
  return out;
}

// ---------------- shared form pieces ----------------
function field(label, key, attrs = {}, hint) {
  const input = el('input', { type: attrs.type || 'text', value: st.form[key] || '', ...attrs, oninput: (e) => { st.form[key] = e.target.value; } });
  return el('label', { class: 'field' }, el('span', { text: label }), input, hint && el('small', { text: hint }));
}
function detailFields() {
  const s = st.s;
  const qs = (s.questions || []).map(q => {
    const input = el('input', { type: 'text', value: st.form.answers[q.id] || '', oninput: (e) => { st.form.answers[q.id] = e.target.value; } });
    return el('label', { class: 'field' }, el('span', { text: q.label + (q.required ? '' : ' (optional)') }), input);
  });
  return [
    ...qs,
    field('Email (optional)', 'email', { type: 'email', autocomplete: 'email', inputmode: 'email' }, s.type === 'poll' ? 'We’ll send you a copy, and a calendar invite once the date is set.' : 'We’ll send you a copy and a calendar invite.'),
    el('label', { class: 'hp', 'aria-hidden': 'true' }, 'Website', el('input', { type: 'text', tabindex: '-1', autocomplete: 'off', oninput: (e) => { st.form.website = e.target.value; } })),
  ];
}
function submitButton(text) {
  return el('button', { class: 'btn block', type: 'button', disabled: st.busy, onclick: send, text: st.busy ? 'Saving…' : text });
}

function detailsSheet() {
  const s = st.s;
  const byId = Object.fromEntries(s.items.map(i => [i.id, i]));
  sheet((close) => {
    const err = el('div', { role: 'alert' });
    const btn = el('button', { class: 'btn block', type: 'button', text: st.editing ? 'Save changes' : 'Sign me up' });
    btn.onclick = async () => { btn.disabled = true; btn.textContent = 'Saving…'; const ok = await send(err); if (ok) close(); else { btn.disabled = false; btn.textContent = st.editing ? 'Save changes' : 'Sign me up'; } };
    return [
      el('h2', { text: 'Almost done' }),
      el('ul', { class: 'list-plain', style: 'margin-bottom:20px' }, [...st.selected].map(id => el('li', {}, el('strong', { text: byId[id]?.label || '' })))),
      field('Your name', 'name', { autocomplete: 'name' }),
      ...detailFields(), err, btn,
      el('button', { class: 'btn quiet block', style: 'margin-top:10px', onclick: close, text: 'Back' }),
    ];
  });
}

async function send(errBox) {
  const s = st.s;
  const showErr = (m) => { if (errBox?.nodeType) errBox.replaceChildren(el('div', { class: 'notice err', text: m })); else { st.error = m; render(); scrollTo(0, 0); } };
  if (!st.form.name.trim()) { showErr(s.type === 'rsvp' ? `Please enter the ${(s.nameLabel || 'name').toLowerCase()}.` : 'Please enter your name.'); return false; }
  st.busy = true; st.error = ''; if (!errBox?.nodeType) render();
  const payload = {
    signupId: st.id, name: st.form.name, email: st.form.email, answers: st.form.answers, website: st.form.website || '',
    picks: [...st.selected], partySize: st.partySize,
    availability: Object.fromEntries(Object.entries(st.availability).filter(([, v]) => v)),
  };
  if (st.editing && st.mine) Object.assign(payload, { entryId: st.mine.entryId, token: st.mine.token });
  try {
    const r = await submit(payload);
    st.mine = { entryId: r.entryId, token: r.token, name: st.form.name.trim(), email: st.form.email.trim(), answers: st.form.answers };
    store.set(st.mine);
    st.done = { entry: { id: r.entryId, ...r.entry }, emailed: !!st.form.email.trim(), edited: st.editing };
    st.editing = false; st.selected.clear();
    st.busy = false; render(); scrollTo(0, 0);
    return true;
  } catch (e) {
    st.busy = false;
    showErr(errText(e));
    if (errBox?.nodeType) render();
    return false;
  }
}

function doneView() {
  const s = st.s, e = st.done.entry;
  const wl = e.waitlisted || (e.picks || []).some(p => p.waitlisted);
  return [el('section', { class: 'center' },
    el('div', { class: 'done-mark', html: '' }, iconEl('check')),
    el('h2', { style: 'margin-top:0', text: st.done.edited ? 'Your changes are saved' : 'You’re signed up!' }),
    el('ul', { class: 'list-plain', style: 'text-align:left' }, describe(e).map(l => el('li', { text: l }))),
    wl && el('div', { class: 'notice warn', style: 'text-align:left', text: 'Anything marked “waitlist” is full right now. If a spot opens you’ll move up automatically' + (st.done.emailed ? ' and we’ll email you.' : '.') }),
    el('p', { class: 'muted', text: st.done.emailed ? 'We emailed you a copy' + (s.when?.start && !wl ? ' with a calendar invite.' : '.') : 'Tip: take a screenshot so you remember.' }),
    el('div', { class: 'btns' }, !st.done.emailed && calendarButtons(e),
      el('button', { class: 'btn ghost block', onclick: () => { st.done = null; render(); scrollTo(0, 0); }, text: 'Back to the sign-up' })))];
}

function startEdit() {
  const mine = myEntry();
  if (!mine) return;
  st.editing = true;
  st.selected = new Set((mine.picks || []).map(p => p.itemId));
  st.partySize = mine.partySize || 1;
  st.availability = { ...(mine.availability || {}) };
  st.form = { name: st.mine.name || mine.name || '', email: st.mine.email || '', answers: { ...(st.mine.answers || {}) } };
  render();
}

function confirmCancel() {
  sheet((close) => {
    const btn = el('button', { class: 'btn danger block', text: 'Yes, cancel my sign-up' });
    btn.onclick = async () => {
      btn.disabled = true; btn.textContent = 'Cancelling…';
      try {
        st.busy = true;
        await cancelFn({ signupId: st.id, entryId: st.mine.entryId, token: st.mine.token });
        st.mine = null; store.set(null); st.busy = false; close(); toast('Your sign-up was cancelled'); render();
      } catch (e) { st.busy = false; btn.disabled = false; btn.textContent = 'Yes, cancel my sign-up'; btn.before(el('div', { class: 'notice err', text: errText(e) })); }
    };
    return [el('h2', { text: 'Cancel your sign-up?' }), el('p', { text: 'Your spot will open up for someone else.' }), btn,
      el('button', { class: 'btn quiet block', style: 'margin-top:10px', onclick: close, text: 'Keep it' })];
  });
}

start();
