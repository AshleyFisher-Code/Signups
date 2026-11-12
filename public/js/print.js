// Printable sheet: names filled in, blank lines for open spots so people can write in at the event.
import { doc, getDoc, getDocs, collection } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
import { db } from './fb.js';
import { auth, onAuthStateChanged, loginView } from './auth.js';
import { el, mount, fmtWhen, fmtOption } from './ui.js';

const app = document.getElementById('app');
const id = new URLSearchParams(location.search).get('id');

onAuthStateChanged(auth, async (u) => {
  if (!u) return loginView(app, 'Sign in to print this sign-up.');
  const s = (await getDoc(doc(db, 'signups', id))).data();
  if (!s) { app.textContent = 'Not found.'; return; }
  const entries = (await getDocs(collection(db, 'signups', id, 'entries'))).docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => a.createdAt - b.createdAt);
  const priv = Object.fromEntries((await getDocs(collection(db, 'signups', id, 'private'))).docs.map(d => [d.id, d.data()]));
  const name = (e) => priv[e.id]?.name || e.name || 'Guest';
  const ans = (e) => (s.questions || []).filter(q => priv[e.id]?.answers?.[q.id]).map(q => `${q.label} ${priv[e.id].answers[q.id]}`).join(' · ');
  document.title = s.title;

  let table;
  if (s.type === 'items') {
    const rows = []; let sec = null;
    for (const it of s.items) {
      if (it.section !== sec) { sec = it.section; if (sec) rows.push(el('tr', { class: 'sec' }, el('td', { colspan: 3, text: sec }))); }
      const ppl = entries.filter(e => (e.picks || []).some(p => p.itemId === it.id && !p.waitlisted));
      const n = Math.max(it.qty || 1, ppl.length);
      for (let i = 0; i < n; i++) {
        const e = ppl[i];
        rows.push(el('tr', {},
          el('td', {}, i === 0 ? [it.start ? fmtWhen({ start: it.start, end: it.end }, s.tz, { timeOnly: true }) + '  ' : '', el('strong', { text: it.label }), it.note ? el('div', { class: 'muted', text: it.note }) : ''] : ''),
          el('td', { class: e ? '' : 'blank', text: e ? name(e) : '' }),
          el('td', { class: 'muted', text: e ? ans(e) : '' })));
      }
    }
    table = el('table', { class: 'p' }, el('thead', {}, el('tr', {}, el('th', { text: 'Item' }), el('th', { text: 'Name' }), el('th', { text: 'Notes' }))), el('tbody', {}, rows));
  } else if (s.type === 'rsvp') {
    const coming = entries.filter(e => !e.waitlisted);
    const total = coming.reduce((n, e) => n + e.partySize, 0);
    table = el('div', {}, el('p', { html: '' }, el('strong', { text: `${total} coming · ${coming.length} sign-ups` })),
      el('table', { class: 'p' }, el('thead', {}, el('tr', {}, el('th', { text: '' }), el('th', { text: s.nameLabel || 'Name' }), el('th', { class: 'c', text: '#' }), el('th', { text: 'Notes' }), el('th', { class: 'c', text: 'Here' }))),
        el('tbody', {}, coming.map((e, i) => el('tr', {}, el('td', { class: 'muted', text: String(i + 1) }), el('td', { text: name(e) }), el('td', { class: 'c', text: String(e.partySize) }), el('td', { class: 'muted', text: ans(e) }), el('td', { class: 'c', text: '☐' }))),
          Array.from({ length: 4 }, () => el('tr', {}, el('td', {}), el('td', { class: 'blank' }), el('td', {}), el('td', {}), el('td', { class: 'c', text: '☐' }))))));
  } else {
    const mark = { yes: '✓', maybe: '?', no: '–' };
    table = el('table', { class: 'p' }, el('thead', {}, el('tr', {}, el('th', { text: 'Name' }), s.options.map(o => el('th', { class: 'c', text: fmtOption(o) })))),
      el('tbody', {}, entries.map(e => el('tr', {}, el('td', { text: name(e) }), s.options.map(o => el('td', { class: 'c', text: mark[e.availability?.[o.id]] || '' })))),
        el('tr', {}, el('td', {}, el('strong', { text: 'Yes' })), s.options.map(o => el('td', { class: 'c' }, el('strong', { text: String(entries.filter(e => e.availability?.[o.id] === 'yes').length) }))))));
  }
  mount(app, 
    el('div', { class: 'noprint' }, el('button', { class: 'btn small', text: 'Print', onclick: () => print() }), el('button', { class: 'btn small quiet', text: 'Close', onclick: () => close() })),
    el('p', { class: 'eyebrow', text: s.hostName ? `Hosted by ${s.hostName}` : 'Sign-up' }),
    el('h1', { text: s.title }),
    el('p', { class: 'sub', text: [s.when?.start && fmtWhen(s.when, s.tz), s.location].filter(Boolean).join(' · ') }),
    table);
});
