// Small helpers shared by every page. Text from guests is always set with textContent, never as HTML.

export function el(tag, attrs = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k === 'text') n.textContent = v;
    else if (k === 'html') n.innerHTML = v; // only ever used with our own icon markup
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else if (k === 'value') n.value = v;
    else if (v === true) n.setAttribute(k, '');
    else n.setAttribute(k, v);
  }
  for (const k of kids.flat(Infinity)) if (k != null && k !== false) n.append(k.nodeType ? k : document.createTextNode(String(k)));
  return n;
}

const svg = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
export const icons = {
  check: svg('<path d="M5 12.5l4.5 4.5L19 7.5"/>'),
  cal: svg('<rect x="3.5" y="5" width="17" height="15.5" rx="2.5" stroke="currentColor"/><path d="M3.5 10h17M8 3v4M16 3v4" stroke="currentColor"/>'),
  pin: svg('<path d="M12 21s-6.5-6-6.5-11a6.5 6.5 0 0113 0c0 5-6.5 11-6.5 11z" stroke="currentColor"/><circle cx="12" cy="10" r="2.3" stroke="currentColor"/>'),
  clock: svg('<circle cx="12" cy="12" r="8.5" stroke="currentColor"/><path d="M12 7.5V12l3 2" stroke="currentColor"/>'),
  user: svg('<circle cx="12" cy="8.5" r="3.8" stroke="currentColor"/><path d="M4.5 20c1.3-3.6 4.2-5.4 7.5-5.4s6.2 1.8 7.5 5.4" stroke="currentColor"/>'),
  print: svg('<path d="M7 9V3.5h10V9M7 17H4.5V10.5a1.5 1.5 0 011.5-1.5h12a1.5 1.5 0 011.5 1.5V17H17" stroke="currentColor"/><rect x="7" y="14" width="10" height="6.5" stroke="currentColor"/>'),
  share: svg('<path d="M12 3.5v11M7.5 8L12 3.5 16.5 8M5 12.5v6A1.5 1.5 0 006.5 20h11a1.5 1.5 0 001.5-1.5v-6" stroke="currentColor"/>'),
  copy: svg('<rect x="8.5" y="8.5" width="11" height="11" rx="2" stroke="currentColor"/><path d="M15.5 8.5V6a1.5 1.5 0 00-1.5-1.5H6A1.5 1.5 0 004.5 6v8A1.5 1.5 0 006 15.5h2.5" stroke="currentColor"/>'),
};
export const iconEl = (name, color) => { const s = el('span', { html: icons[name] }).firstChild; if (color) s.style.stroke = color; return s; };

export function fmtWhen(when, tz = 'America/New_York', opts = {}) {
  if (!when?.start) return '';
  if (when.allDay) {
    return new Date(when.start + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' });
  }
  const s = new Date(when.start);
  const day = s.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: tz });
  const t = (d) => d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: tz }).replace(':00', '').replace(/\s(AM|PM)/, '\u00a0$1');
  if (opts.timeOnly) return when.end ? `${t(s)} – ${t(new Date(when.end))}` : t(s);
  return when.end ? `${day}, ${t(s)} – ${t(new Date(when.end))}` : `${day} at ${t(s)}`;
}
export function fmtDay(iso, tz = 'America/New_York') {
  const d = new Date(iso);
  return d.toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: tz }).replace(':00', '').replace(/\s(AM|PM)/, '\u00a0$1');
}
export function fmtOption(o) {
  let s = new Date(o.date + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
  const t = (hm) => { const [h, m] = hm.split(':').map(Number); const ap = h >= 12 ? 'pm' : 'am'; const hh = ((h + 11) % 12) + 1; return m ? `${hh}:${String(m).padStart(2, '0')}${ap}` : `${hh}${ap}`; };
  if (o.start) s += ` · ${t(o.start)}${o.end ? '–' + t(o.end) : ''}`;
  return s;
}

// replaceChildren() prints `false` for skipped pieces; this drops them first.
export function mount(root, ...kids) { root.replaceChildren(...kids.flat(Infinity).filter(k => k != null && k !== false && k !== '')); }

export function toast(msg) {
  const t = el('div', { class: 'toast', role: 'status', text: msg });
  document.body.append(t);
  setTimeout(() => t.remove(), 2600);
}

export function sheet(build) {
  const bg = el('div', { class: 'sheet-bg' });
  const box = el('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true' });
  const close = () => { bg.remove(); document.body.style.overflow = ''; };
  bg.addEventListener('click', (e) => { if (e.target === bg) close(); });
  box.append(...[build(close)].flat());
  bg.append(box);
  document.body.append(bg);
  document.body.style.overflow = 'hidden';
  setTimeout(() => box.querySelector('input:not([type=checkbox]),textarea')?.focus(), 50);
  return close;
}

export async function copyText(t) {
  try { await navigator.clipboard.writeText(t); return true; } catch { return false; }
}

// ---------- add-to-calendar for guests who skip email ----------
const stamp = (d) => new Date(d).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const ymd = (s) => s.replace(/-/g, '');
const nextDay = (s) => { const d = new Date(s + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10); };
export function googleCalUrl({ title, start, end, allDay, details, location }) {
  const dates = allDay ? `${ymd(start)}/${ymd(nextDay(end || start))}` : `${stamp(start)}/${stamp(end || new Date(Date.parse(start) + 3600000))}`;
  const p = new URLSearchParams({ action: 'TEMPLATE', text: title, dates, details: details || '', location: location || '' });
  return `https://calendar.google.com/calendar/render?${p}`;
}
export function icsFile({ uid, title, start, end, allDay, details, location }) {
  const esc = (s) => String(s || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
  const L = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Ashley Fisher//Sign-ups//EN', 'BEGIN:VEVENT', `UID:${uid}`, `DTSTAMP:${stamp(new Date())}`,
    allDay ? `DTSTART;VALUE=DATE:${ymd(start)}` : `DTSTART:${stamp(start)}`,
    allDay ? `DTEND;VALUE=DATE:${ymd(nextDay(end || start))}` : `DTEND:${stamp(end || new Date(Date.parse(start) + 3600000))}`,
    `SUMMARY:${esc(title)}`, `DESCRIPTION:${esc(details)}`, `LOCATION:${esc(location)}`, 'END:VEVENT', 'END:VCALENDAR'];
  return URL.createObjectURL(new Blob([L.join('\r\n')], { type: 'text/calendar' }));
}
