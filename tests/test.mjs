// Rules and invites: node tests/test.mjs
import assert from 'node:assert/strict';
import { cleanSubmission, allocate, promotions, eventsFor, describe, slugify, fmtOption, UserError } from '../functions/lib/logic.js';
import { buildIcs, fold } from '../functions/lib/ics.js';
import { parseItems } from '../public/js/parse.js';

let n = 0;
const t = (name, fn) => { fn(); n++; };

const brunch = {
  type: 'items', title: 'Potluck Brunch', slug: 'brunch', location: '1 Main St', tz: 'America/New_York',
  when: { allDay: false, start: '2026-11-22T15:30:00.000Z', end: '2026-11-22T18:00:00.000Z' },
  items: [
    { id: 'a', label: 'Quiche', qty: 2 },
    { id: 'b', label: 'Fruit salad', qty: 1 },
    { id: 'c', label: 'Coffee setup', qty: 1, start: '2026-11-22T15:00:00.000Z', end: '2026-11-22T15:30:00.000Z' },
  ],
  questions: [{ id: 'q1', label: 'Allergies?', required: false }],
};

t('requires a name and valid email', () => {
  assert.throws(() => cleanSubmission(brunch, { picks: ['a'] }), UserError);
  assert.throws(() => cleanSubmission(brunch, { name: 'Jo', email: 'nope', picks: ['a'] }), /email/);
  const ok = cleanSubmission(brunch, { name: '  Jo   Smith ', email: 'JO@X.COM', picks: ['a', 'a'], answers: { q1: 'nuts', zz: 'x' } });
  assert.equal(ok.name, 'Jo Smith'); assert.equal(ok.email, 'jo@x.com');
  assert.deepEqual(ok.picks, ['a']); assert.deepEqual(ok.answers, { q1: 'nuts' });
});

t('rejects unknown items and empty picks', () => {
  assert.throws(() => cleanSubmission(brunch, { name: 'Jo', picks: [] }), /at least one/);
  assert.throws(() => cleanSubmission(brunch, { name: 'Jo', picks: ['zzz'] }), /removed/);
});

t('fills to quantity, then waitlists', () => {
  const entries = [{ id: 'e1', picks: [{ itemId: 'a', waitlisted: false }] }, { id: 'e2', picks: [{ itemId: 'b', waitlisted: false }] }];
  const r = allocate(brunch, entries, 'new', { picks: ['a', 'b'] });
  assert.deepEqual(r.picks, [{ itemId: 'a', waitlisted: false }, { itemId: 'b', waitlisted: true }]);
  const noWl = allocate({ ...brunch, waitlist: false }, entries, 'new', { picks: ['b'] });
  assert.deepEqual(noWl.full, ['b']);
});

t('editing keeps spots you already hold', () => {
  const prev = { id: 'e2', picks: [{ itemId: 'b', waitlisted: false }] };
  const entries = [prev, { id: 'e3', picks: [{ itemId: 'b', waitlisted: true }] }];
  const r = allocate(brunch, entries, 'e2', { picks: ['b'] }, prev);
  assert.deepEqual(r.picks, [{ itemId: 'b', waitlisted: false }]);
});

t('waitlist promotes first come first served', () => {
  const entries = [
    { id: 'late', createdAt: 3, picks: [{ itemId: 'b', waitlisted: true }] },
    { id: 'early', createdAt: 2, picks: [{ itemId: 'b', waitlisted: true }] },
  ];
  const ch = promotions(brunch, entries);
  assert.equal(ch.length, 1); assert.equal(ch[0].id, 'early'); assert.deepEqual(ch[0].promoted, ['b']);
});

const dinner = { type: 'rsvp', title: 'Team dinner', capacity: 10, maxParty: 6, when: { start: '2026-11-15T23:00:00.000Z' }, tz: 'America/New_York' };
t('rsvp headcount and capacity', () => {
  assert.throws(() => cleanSubmission(dinner, { name: 'Leo', partySize: 0 }), /how many/);
  assert.throws(() => cleanSubmission(dinner, { name: 'Leo', partySize: 7 }), /most/);
  const entries = [{ id: 'x', partySize: 8, waitlisted: false }];
  assert.equal(allocate(dinner, entries, 'n', { partySize: 2 }).waitlisted, false);
  assert.equal(allocate(dinner, entries, 'n', { partySize: 3 }).waitlisted, true);
  assert.equal(allocate({ ...dinner, capacity: 0 }, entries, 'n', { partySize: 6 }).waitlisted, false);
  const ch = promotions(dinner, [{ id: 'x', partySize: 7, createdAt: 1 }, { id: 'w', partySize: 3, waitlisted: true, createdAt: 2 }]);
  assert.deepEqual(ch.map(c => c.id), ['w']);
});

const poll = { type: 'poll', title: 'Holiday party', options: [{ id: 'o1', date: '2026-12-05', start: '18:30' }, { id: 'o2', date: '2026-12-12' }] };
t('poll keeps only real dates and answers', () => {
  const r = cleanSubmission(poll, { name: 'Ann', availability: { o1: 'yes', o2: 'banana', o9: 'yes' } });
  assert.deepEqual(r.availability, { o1: 'yes' });
  assert.throws(() => cleanSubmission(poll, { name: 'Ann', availability: {} }), /at least one/);
  assert.equal(fmtOption(poll.options[0]), 'Sat, Dec 5 · 6:30pm');
  assert.deepEqual(describe(poll, { availability: { o1: 'yes', o2: 'no' } }), ['Sat, Dec 5 · 6:30pm: Yes', 'Sat, Dec 12: No']);
});

t('invites: slots get their own event, items share the main one, waitlist gets none', () => {
  const entry = { picks: [{ itemId: 'a', waitlisted: false }, { itemId: 'c', waitlisted: false }, { itemId: 'b', waitlisted: true }] };
  const ev = eventsFor(brunch, 'E1', entry, { domain: 'd.com', url: 'https://u', tz: 'America/New_York' });
  assert.equal(ev.length, 2);
  assert.equal(ev[0].uid, 'E1.c@d.com'); assert.equal(ev[0].start, brunch.items[2].start);
  assert.equal(ev[1].uid, 'E1@d.com'); assert.match(ev[1].description, /bringing: Quiche/);
  assert.doesNotMatch(ev[1].description, /Fruit/);
  assert.equal(eventsFor(dinner, 'W', { waitlisted: true, partySize: 2 }, { domain: 'd', url: '', tz: '' }).length, 0);
  assert.equal(eventsFor(poll, 'P', { availability: { o1: 'yes' } }, { domain: 'd', url: '', tz: '' }).length, 0);
});

t('ics is well-formed with CRLF, folding, escaping, all-day', () => {
  const ics = buildIcs({ method: 'REQUEST', now: new Date('2026-11-01T00:00:00Z'), organizer: { name: 'Ashley', email: 'a@x.com' }, attendee: { name: 'Jo, Jr.', email: 'j@x.com' },
    events: [
      { uid: 'u1@d', sequence: 2, start: '2026-11-22T15:30:00.000Z', end: '2026-11-22T18:00:00.000Z', summary: 'Brunch; bring food', description: 'Line one\nLine two '.repeat(10), location: 'A, B' },
      { uid: 'u2@d', allDay: true, start: '2026-12-12', summary: 'Party' },
    ] });
  assert.ok(ics.includes('\r\nDTSTART:20261122T153000Z\r\n'));
  assert.ok(ics.includes('SEQUENCE:2'));
  assert.ok(ics.includes('SUMMARY:Brunch\\; bring food'));
  assert.ok(ics.includes('LOCATION:A\\, B'));
  assert.ok(ics.includes('CN=Jo\\, Jr.'));
  assert.ok(ics.includes('DTSTART;VALUE=DATE:20261212\r\nDTEND;VALUE=DATE:20261213'));
  for (const line of ics.split('\r\n')) assert.ok(Buffer.byteLength(line) <= 75, 'line too long: ' + line);
  assert.equal(fold('é'.repeat(60)).split('\r\n ').join(''), 'é'.repeat(60));
  const cancel = buildIcs({ method: 'CANCEL', events: [{ uid: 'u', start: '2026-11-22T15:30:00Z', summary: 'x' }] });
  assert.ok(cancel.includes('METHOD:CANCEL') && cancel.includes('STATUS:CANCELLED'));
});

t('paste import understands quantities, notes, sections, times', () => {
  const r = parseItems(`Savory:
Quiche x2 — serves 8
Bagels & cream cheese (3)
- Bacon, 2
Sweet:
#Drinks
Mimosa bar ×1 | bring champagne
10:00-11:00 Coffee setup
9:30am - 10am  Set up tables x2
`, '2026-11-22');
  assert.equal(r.length, 6);
  assert.deepEqual([r[0].label, r[0].qty, r[0].note, r[0].section], ['Quiche', 2, 'serves 8', 'Savory']);
  assert.deepEqual([r[1].label, r[1].qty], ['Bagels & cream cheese', 3]);
  assert.deepEqual([r[2].label, r[2].qty], ['Bacon', 2]);
  assert.deepEqual([r[3].label, r[3].note, r[3].section], ['Mimosa bar', 'bring champagne', 'Drinks']);
  assert.equal(r[4].label, 'Coffee setup'); assert.equal(r[4].startHM, '10:00'); assert.equal(r[4].endHM, '11:00');
  assert.equal(r[5].startHM, '09:30'); assert.equal(r[5].endHM, '10:00'); assert.equal(r[5].qty, 2);
});

t('slugs', () => { assert.equal(slugify('Stars Dinner — Sat 11/15!'), 'stars-dinner-sat-11-15'); });

console.log(`${n} checks passed`);
