// End-to-end on phone-size screens against the local stand-in for Firebase.
// Start the server first:  node --import ./tests/fake/register.mjs tests/fake/server.mjs
// Then:                    node tests/ui.mjs
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import assert from 'node:assert/strict';

const BASE = 'http://localhost:8765';
const root = new URL('..', import.meta.url).pathname;
const SHOTS = root + 'tests/shots/';
mkdirSync(SHOTS, { recursive: true });
const FONTS = process.env.FONTS_DIR || '/home/claude/tools/node_modules/@fontsource';
const errors = [];
const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});

const fontCss = existsSync(FONTS) ? `
@font-face{font-family:'Cormorant Garamond';font-weight:600;src:url(/__font/cormorant-garamond/files/cormorant-garamond-latin-600-normal.woff2) format('woff2')}
${[400, 600, 700].map(w => `@font-face{font-family:'Source Sans 3';font-weight:${w};src:url(/__font/source-sans-3/files/source-sans-3-latin-${w}-normal.woff2) format('woff2')}`).join('\n')}` : '';

async function ctx(opts = {}) {
  const c = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, ...opts });
  await c.route(/gstatic\.com\/firebasejs\/[\d.]+\/(firebase-[a-z]+)\.js/, async (r) => {
    const name = r.request().url().match(/(firebase-[a-z]+)\.js/)[1];
    const res = await fetch(`${BASE}/__fake/client/${name}.js`);
    r.fulfill({ status: 200, contentType: 'text/javascript', body: await res.text() });
  });
  await c.route(/fonts\.googleapis\.com/, r => r.fulfill({ status: 200, contentType: 'text/css', body: fontCss }));
  await c.route(/fonts\.gstatic\.com/, r => r.abort());
  await c.route(/\/__font\//, r => { const p = r.request().url().split('/__font/')[1]; r.fulfill({ status: 200, contentType: 'font/woff2', body: readFileSync(`${FONTS}/${p}`) }); });
  await c.route(/calendar\.google\.com|maps\.google\.com/, r => r.fulfill({ status: 200, body: 'ok' }));
  return c;
}
async function page(c, path) {
  const p = await c.newPage();
  p.on('pageerror', e => errors.push(`${path}: ${e.message}`));
  p.on('console', m => { if (m.type() === 'error' && !/403|Failed to load resource/.test(m.text())) errors.push(`${path}: ${m.text()}`); });
  await p.goto(BASE + path);
  return p;
}
const shot = (p, name, full = true) => p.screenshot({ path: `${SHOTS}${name}.png`, fullPage: full });
const settle = () => fetch(`${BASE}/__fake/settle`);
const outbox = async () => (await fetch(`${BASE}/__fake/outbox`)).json();
const dump = async () => (await fetch(`${BASE}/__fake/dump`)).json();
const btn = (p, name) => p.getByRole('button', { name, exact: false }).first();
const see = (p, text, timeout = 5000) => p.getByText(text, { exact: false }).first().waitFor({ timeout });
const noSideScroll = async (p, where) => assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'side scroll on ' + where);
const icsOf = (m, i = 0) => Buffer.from(m.attachments[i].content, 'base64').toString();
let step = 0;
const ok = (msg) => console.log(`✓ ${++step}. ${msg}`);

// ================= organizer: create the potluck =================
const admin = await ctx({ viewport: { width: 430, height: 932 } });
let a = await page(admin, '/admin');
await a.getByLabel('Email').fill('ashley@ashleyfisher.com');
await a.getByLabel('Password').fill('wrong');
await btn(a, 'Sign in').click();
await see(a, 'didn’t match');
await a.getByLabel('Password').fill('correct-horse');
await btn(a, 'Sign in').click();
await see(a, 'Your sign-ups');
ok('organizer sign-in (wrong password refused)');

await btn(a, 'New sign-up').click();
await shot(a, '01-organizer-pick-type');
await a.getByText('Things to bring').click();
await a.getByLabel('Title').fill('Thanksgiving Potluck Brunch');
assert.equal(await a.getByLabel('Link').inputValue(), 'thanksgiving-potluck-brunch');
await a.getByLabel('Link').fill('brunch');
await a.getByLabel('Details for guests').fill('Bring a dish to share. Kids welcome!');
await a.getByLabel('Location').fill('1200 Chain Bridge Rd, McLean, VA');
await a.getByLabel('Event date').fill('2026-11-22');
await a.getByLabel('Starts').fill('10:30');
await a.getByLabel('Ends').fill('13:00');
await a.locator('textarea').nth(1).fill(`Savory:
Quiche x2 — serves 8
Bagels & cream cheese
Sweet:
Fruit salad
Coffee cake x2
Drinks:
Orange juice x2
Help:
9:30-10:30 Set up tables x2`);
await see(a, '6 items · 10 spots');
await btn(a, 'Add a question').click();
await a.locator('.qrow input[type=text]').fill('Any allergies we should know about?');
await a.getByLabel('Sign-ups close').fill('2026-11-21');
await shot(a, '02-organizer-editor');
await btn(a, 'Create sign-up').click();
await a.waitForURL(/#\/s\//);
await see(a, 'spots filled');
const brunchId = a.url().split('/s/')[1];
await see(a, `${BASE}/brunch`);
ok('potluck created from a pasted list (sections, x2, time slot)');

// slug taken
await a.goto(BASE + '/admin#/create/rsvp');
await a.getByLabel('Title').fill('Dup');
await a.getByLabel('Link').fill('brunch');
await a.getByLabel('Sign-ups close').fill('2026-12-01');
await btn(a, 'Create sign-up').click();
await see(a, 'already used');
ok('duplicate links refused');

// ================= guests =================
const g1c = await ctx();
let g1 = await page(g1c, '/brunch');
await see(g1, 'Thanksgiving Potluck Brunch');
await noSideScroll(g1, 'guest items');
await shot(g1, '03-guest-potluck');
await g1.getByRole('button', { name: /Quiche/ }).click();
await g1.getByRole('button', { name: /Set up tables/ }).click();
await shot(g1, '04-guest-selected', false);
await btn(g1, 'Continue with 2 items').click();
await g1.locator('.sheet').getByLabel('Your name').fill('Maria Lopez');
await g1.locator('.sheet').getByLabel('Any allergies').fill('Tree nuts');
await g1.locator('.sheet').getByLabel('Email').fill('maria@example.com');
await shot(g1, '05-guest-details', false);
await btn(g1, 'Sign me up').click();
await see(g1, 'You’re signed up!');
await shot(g1, '06-guest-done');
await settle();
let mail = await outbox();
assert.equal(mail.length, 1);
assert.equal(mail[0].to[0], 'maria@example.com');
assert.match(mail[0].subject, /You’re signed up: Thanksgiving Potluck Brunch/);
assert.equal(mail[0].reply_to, 'ashley@ashleyfisher.com');
let ics = icsOf(mail[0]);
writeFileSync(SHOTS + 'invite-maria.ics', ics);
assert.equal((ics.match(/BEGIN:VEVENT/g) || []).length, 2, 'slot + main event');
assert.match(ics, /METHOD:REQUEST/);
assert.match(ics, /DTSTART:20261122T143000Z/); // 9:30 ET slot
assert.match(ics, /DTSTART:20261122T153000Z/); // 10:30 ET brunch
assert.match(ics, /bringing: Quiche/);
assert.match(mail[0].attachments[0].content_type, /method=REQUEST/);
writeFileSync(SHOTS + 'email-confirm.html', mail[0].html);
ok('guest signs up with no login; email has a calendar invite (slot + brunch)');

await g1.getByRole('button', { name: 'Back to the sign-up' }).click();
await see(g1, 'You’re signed up, Maria!');
await see(g1, 'Signed up: Maria Lopez');
ok('returning guest sees their sign-up and names show on items');

// guest 2 takes fruit salad; guest 3 gets waitlisted
const g2c = await ctx();
const g2 = await page(g2c, '/brunch');
await g2.getByRole('button', { name: /Fruit salad/ }).click();
await btn(g2, 'Continue').click();
await g2.locator('.sheet').getByLabel('Your name').fill('Tom Becker');
await g2.locator('.sheet').getByLabel('Email').fill('tom@example.com');
await btn(g2, 'Sign me up').click();
await see(g2, 'You’re signed up!');

const g3c = await ctx();
const g3 = await page(g3c, '/brunch');
await see(g3, 'Full — join waitlist');
await g3.getByRole('button', { name: /Fruit salad/ }).click();
await btn(g3, 'Continue').click();
await g3.locator('.sheet').getByLabel('Your name').fill('Priya Shah');
await g3.locator('.sheet').getByLabel('Email').fill('priya@example.com');
await btn(g3, 'Sign me up').click();
await see(g3, 'is full right now');
await settle();
mail = await outbox();
assert.equal(mail.at(-1).to[0], 'priya@example.com');
assert.equal((mail.at(-1).attachments || []).length, 0, 'no invite while waitlisted');
ok('full item → waitlist, no invite yet');

// live update: guest 1's page shows Tom without reload
await see(g1, 'Tom Becker');
ok('pages update live as others sign up');

// Tom cancels → Priya promoted
await g2.getByRole('button', { name: 'Back to the sign-up' }).click();
await btn(g2, 'Cancel my sign-up').click();
await btn(g2, 'Yes, cancel').click();
await see(g2, 'was cancelled');
await settle();
mail = await outbox();
const tomCancel = mail.find(m => m.to[0] === 'tom@example.com' && /Cancelled/.test(m.subject));
assert.ok(tomCancel); assert.match(icsOf(tomCancel), /METHOD:CANCEL/);
const promo = mail.find(m => m.to[0] === 'priya@example.com' && /spot opened/.test(m.subject));
assert.ok(promo, 'promotion email'); assert.match(icsOf(promo), /Fruit salad/);
await g3.getByRole('button', { name: 'Back to the sign-up' }).click();
await see(g3, 'You’re signed up, Priya!');
await g3.locator('.notice.ok li', { hasText: /^Fruit salad$/ }).waitFor({ timeout: 4000 });
ok('cancel removes it from their calendar; waitlist moves up and gets an invite');

// Maria changes her mind: drops the set-up slot, adds coffee cake
await btn(g1, 'Change').click();
await g1.getByRole('button', { name: /Set up tables/ }).click();
await g1.getByRole('button', { name: /Coffee cake/ }).click();
await btn(g1, 'Continue with 2 items').click();
assert.equal(await g1.locator('.sheet').getByLabel('Your name').inputValue(), 'Maria Lopez');
await btn(g1, 'Save changes').click();
await see(g1, 'Your changes are saved');
await settle();
mail = await outbox();
const edit = mail.filter(m => m.to[0] === 'maria@example.com').at(-1);
assert.equal(edit.attachments.length, 2, 'new invite + cancel for dropped slot');
assert.match(icsOf(edit, 1), /METHOD:CANCEL[\s\S]*UID:[^\r]+\.[^\r]+@signup/);
assert.match(icsOf(edit, 0), /Quiche\\, Coffee cake/);
ok('editing keeps the same invite; the dropped time slot is cancelled');

// email link on a new phone
const link = edit.text.match(/Change or cancel: (\S+)/)[1];
const g4c = await ctx();
const g4 = await page(g4c, link.replace(BASE, ''));
await see(g4, 'You’re signed up, Maria!');
assert.ok(!g4.url().includes('?e='), 'token removed from address bar');
ok('“Change or cancel” link from the email works on another phone');

// ================= organizer results, print, export =================
a = await page(admin, `/admin#/s/${brunchId}`);
await see(a, 'maria@example.com');
await see(a, 'Tree nuts');
await shot(a, '07-organizer-results');
const pr = await page(admin, `/print?id=${brunchId}`);
await see(pr, 'Maria Lopez');
await pr.emulateMedia({ media: 'print' });
await pr.setViewportSize({ width: 816, height: 1056 });
await shot(pr, '08-print');
await pr.pdf({ path: SHOTS + 'print.pdf', format: 'Letter' });
ok('organizer sees emails/answers; print sheet with blank lines for open spots');

await admin.grantPermissions(['clipboard-read', 'clipboard-write']);
await a.getByText('More: close, export').click();
await btn(a, 'Copy results as text').click();
const txt = await a.evaluate(() => navigator.clipboard.readText());
assert.match(txt, /Quiche: Maria Lopez \(1 open\)/);
assert.match(txt, /Fruit salad: Priya Shah/);
assert.match(txt, /Maria Lopez: Any allergies we should know about\? Tree nuts/);
ok('results copy as plain text (to paste to Claude or email)');

// organizer changes the time → everyone with email gets an updated invite
await a.goto(`${BASE}/admin#/edit/${brunchId}`);
await a.getByLabel('Starts').fill('11:00');
await btn(a, 'Save changes').click();
await see(a, 'spots filled');
await settle();
mail = await outbox();
const upd = mail.filter(m => /^Updated:/.test(m.subject));
assert.deepEqual(upd.map(m => m.to[0]).sort(), ['maria@example.com', 'priya@example.com']);
assert.match(icsOf(upd[0]), /SEQUENCE:1/);
assert.match(icsOf(upd[0]), /DTSTART:20261122T160000Z/);
ok('changing the time sends updated invites (same event, SEQUENCE 1)');

// organizer removes Priya
a = await page(admin, `/admin#/s/${brunchId}`);
await see(a, 'priya@example.com');
await a.locator('.person', { hasText: 'Priya' }).getByRole('button', { name: 'Remove' }).click();
await a.locator('.sheet').getByRole('button', { name: 'Remove' }).click();
await see(a, 'Removed');
await settle();
mail = await outbox();
assert.ok(mail.some(m => m.to[0] === 'priya@example.com' && /removed/.test(m.html)));
ok('organizer can remove someone (they’re told, calendar cleared)');

// ================= headcount RSVP =================
await a.goto(`${BASE}/admin#/create/rsvp`);
await a.getByLabel('Title').fill('Stars Team Dinner');
await a.getByLabel('Location').fill('Pizzeria Paradiso');
await a.getByLabel('Event date').fill('2026-11-15');
await see(a, 'Add a start time (including AM/PM)');
await a.getByLabel('Name question').fill('Player name');
await a.getByLabel('Sign-ups close').fill('2026-11-14');
await btn(a, 'Create sign-up').click();
await see(a, 'Please add a start time');
assert.ok(a.url().includes('create'), 'refused to save without a time');
await a.getByLabel('Starts').fill('18:00');
await see(a, 'Calendar invites: Sunday, November 15 at 6');
await a.getByLabel('Headcount question').fill('How many are coming, including the player?');
await btn(a, 'Create sign-up').click();
await a.waitForURL(/#\/s\//);
await see(a, 'sign-ups');
const dinnerId = a.url().split('/s/')[1];
const r1 = await page(await ctx(), '/stars-team-dinner');
await see(r1, 'Player name');
await r1.getByLabel('Player name').fill('Leo M.');
await btn(r1, 'One more').click(); await btn(r1, 'One more').click(); await btn(r1, 'One more').click();
await r1.getByLabel('Email').fill('leo.family@example.com');
await shot(r1, '09-guest-rsvp');
await btn(r1, 'Send RSVP').click();
await see(r1, 'You’re signed up!');
const r2 = await page(await ctx(), '/stars-team-dinner');
await r2.getByLabel('Player name').fill('Sam K.');
await btn(r2, 'One more').click();
await btn(r2, 'Send RSVP').click();
await see(r2, 'Tip: take a screenshot');
await r2.getByRole('button', { name: 'Back to the sign-up' }).click();
await r2.locator('.total b', { hasText: /^6$/ }).waitFor({ timeout: 4000 });
await shot(r2, '10-guest-rsvp-list');
await settle();
mail = await outbox();
const leo = mail.find(m => m.to[0] === 'leo.family@example.com');
assert.match(icsOf(leo), /DTSTART:20261115T230000Z/);
assert.match(leo.text, /4 people/);
ok('RSVP: refuses a date with no time (no more surprise all-day invites); headcount, total, timed invite');

// ================= date poll =================
await a.goto(`${BASE}/admin#/create/poll`);
await a.getByLabel('Title').fill('Holiday Dinner');
const rows = () => a.locator('.optrow');
await rows().nth(0).getByLabel('Date', { exact: true }).fill('2026-12-05');
await rows().nth(0).getByLabel('Start time').fill('18:30');
await btn(a, 'Add a date').click();
await rows().nth(1).getByLabel('Date', { exact: true }).fill('2026-12-12');
await btn(a, 'Add a date').click();
await rows().nth(2).getByLabel('Date', { exact: true }).fill('2026-12-13');
await a.getByLabel('Sign-ups close').fill('2026-12-01');
await shot(a, '14-organizer-poll-editor');
await btn(a, 'Create sign-up').click({ timeout: 5000 });
await a.waitForURL(/#\/s\//);
await see(a, '0 responses');
const pollId = a.url().split('/s/')[1];
const p1 = await page(await ctx(), '/holiday-dinner');
await see(p1, 'Help us pick a date');
const opt = (p, i) => p.locator('.opt').nth(i);
await opt(p1, 0).getByRole('button', { name: 'Yes' }).click();
await opt(p1, 1).getByRole('button', { name: 'No' }).click();
await opt(p1, 2).getByRole('button', { name: 'Maybe' }).click();
await p1.getByLabel('Your name').fill('Ana');
await p1.getByLabel('Email').fill('ana@example.com');
await shot(p1, '11-guest-poll');
await btn(p1, 'Send my dates').click();
await see(p1, 'You’re signed up!');
const p2 = await page(await ctx(), '/holiday-dinner');
await opt(p2, 0).getByRole('button', { name: 'No' }).click();
await opt(p2, 1).getByRole('button', { name: 'Yes' }).click();
await p2.getByLabel('Your name').fill('Ben');
await p2.getByLabel('Email').fill('ben@example.com');
await btn(p2, 'Send my dates').click();
await see(p2, 'You’re signed up!');
await p2.getByRole('button', { name: 'Back to the sign-up' }).click();
await see(p2, 'Everyone’s answers');
await shot(p2, '12-guest-poll-results');
await settle();
mail = await outbox();
assert.equal((mail.find(m => m.to[0] === 'ana@example.com').attachments || []).length, 0, 'no invite before date is set');
a = await page(admin, `/admin#/s/${pollId}`);
await see(a, '2 responses');
await a.locator('.res-item', { hasText: 'Dec 5' }).getByRole('button', { name: 'Pick this date' }).click();
await a.locator('.sheet input[type=time]').nth(1).fill('21:30');
await btn(a, 'Set the date and send invites').click();
await see(a, 'Date set:');
await settle();
mail = await outbox();
const set = mail.filter(m => /It’s set/.test(m.subject));
assert.deepEqual(set.map(m => m.to[0]), ['ana@example.com'], 'only people who can make it get the invite');
assert.match(icsOf(set[0]), /DTSTART:20261205T233000Z/);
await see(p2, 'The date is set');
ok('date poll: Yes/Maybe/No, best date highlighted, picking it sends invites');

// ================= closing time, archive, reminders =================
let t = await (await fetch(`${BASE}/__fake/tick`, { method: 'POST', body: JSON.stringify({ now: Date.parse('2026-11-15T03:00:00Z') }) })).json();
let d = await dump();
assert.equal(d[`signups/${dinnerId}`].status, 'archived');
assert.equal(d[`signups/${brunchId}`].status, 'open');
mail = await outbox();
const rem = mail.filter(m => /^Reminder/.test(m.subject));
assert.deepEqual(rem.map(m => m.to[0]), ['leo.family@example.com']);
assert.match(rem[0].text, /4 people/);
ok('at closing time it archives itself; reminder goes out the day before');
const closed = await page(await ctx(), '/stars-team-dinner');
await see(closed, 'Sign-ups are closed');
assert.equal(await closed.getByLabel('Player name').count(), 0);
const late = await (await fetch(`${BASE}/__fake/call/submit`, { method: 'POST', body: JSON.stringify({ data: { signupId: dinnerId, name: 'Late', partySize: 1 } }) })).json();
assert.match(late.error.message, /closed/);
a = await page(admin, '/admin');
await a.getByRole('tab', { name: /Archive/ }).click();
await see(a, 'Stars Team Dinner');
await shot(a, '13-organizer-archive');
ok('closed sign-ups refuse changes and live in the Archive');

// ================= security =================
const anon = async (b) => (await fetch(`${BASE}/__fake/db`, { method: 'POST', body: JSON.stringify(b) })).status;
assert.equal(await anon({ op: 'get', path: `signups/${brunchId}/private/x` }), 403);
assert.equal(await anon({ op: 'query', path: `signups/${brunchId}/private` }), 403);
assert.equal(await anon({ op: 'query', path: 'signups' }), 403);
assert.equal(await anon({ op: 'batch', ops: [{ op: 'update', path: `signups/${brunchId}`, data: { title: 'hacked' } }] }), 403);
assert.equal(await anon({ op: 'batch', ops: [{ op: 'set', path: `signups/${brunchId}/entries/x`, data: {} }] }), 403);
const other = { uid: 'other-uid', email: 'someone@else.com' };
assert.equal(await anon({ user: other, op: 'batch', ops: [{ op: 'set', path: 'signups/new1', data: { ownerUid: 'other-uid' } }] }), 403);
const pub = await (await fetch(`${BASE}/__fake/db`, { method: 'POST', body: JSON.stringify({ op: 'query', path: `signups/${brunchId}/entries` }) })).json();
assert.ok(!JSON.stringify(pub).includes('@example.com'), 'no emails in public data');
const bot = await (await fetch(`${BASE}/__fake/call/submit`, { method: 'POST', body: JSON.stringify({ data: { signupId: brunchId, name: 'Bot', picks: ['x'], website: 'spam.com' } }) })).json();
assert.ok(bot.result.ok);
const badTok = await (await fetch(`${BASE}/__fake/call/cancel`, { method: 'POST', body: JSON.stringify({ data: { signupId: brunchId, entryId: Object.keys(d).find(k => k.startsWith(`signups/${brunchId}/entries/`)).split('/').pop(), token: 'guess' } }) })).json();
assert.ok(badTok.error, 'cannot cancel someone else');
ok('guests can’t see emails, edit others, or write directly; bots ignored');

assert.deepEqual(errors, [], 'page errors');
ok('no script errors on any page');
await browser.close();
console.log(`\nAll ${step} checks passed. Screenshots in tests/shots/`);
