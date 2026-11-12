// Calendar invites (RFC 5545). One VCALENDAR per attachment; METHOD is REQUEST (add/update) or CANCEL.
// Each guest gets a stable UID per event so later updates and cancellations replace the same calendar entry.

const CRLF = '\r\n';

export function escapeText(s) {
  return String(s ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

// Lines longer than 75 octets are folded: CRLF + one space. Never split a UTF-8 character.
export function fold(line) {
  const bytes = Buffer.from(line, 'utf8');
  if (bytes.length <= 75) return line;
  const parts = [];
  let cur = '';
  let curLen = 0;
  let limit = 75;
  for (const ch of line) {
    const n = Buffer.byteLength(ch, 'utf8');
    if (curLen + n > limit) {
      parts.push(cur);
      cur = '';
      curLen = 0;
      limit = 74; // continuation lines start with a space
    }
    cur += ch;
    curLen += n;
  }
  parts.push(cur);
  return parts.join(CRLF + ' ');
}

export function utcStamp(d) {
  const iso = new Date(d).toISOString(); // 2026-11-22T15:30:00.000Z
  return iso.replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

const dateOnly = (ymd) => String(ymd).replace(/-/g, '');

function nextDay(ymd) {
  const d = new Date(ymd + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/**
 * events: [{ uid, sequence, allDay, start, end, summary, description, location, url }]
 *   allDay: start/end are 'YYYY-MM-DD' (end optional). Otherwise ISO date-times.
 * organizer: { name, email }   attendee: { name, email } (optional)
 */
export function buildIcs({ method = 'REQUEST', events, organizer, attendee, now = new Date() }) {
  const L = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Ashley Fisher//Sign-ups//EN',
    'CALSCALE:GREGORIAN',
    `METHOD:${method}`,
  ];
  for (const ev of events) {
    L.push('BEGIN:VEVENT');
    L.push(`UID:${ev.uid}`);
    L.push(`SEQUENCE:${ev.sequence || 0}`);
    L.push(`DTSTAMP:${utcStamp(now)}`);
    if (ev.allDay) {
      L.push(`DTSTART;VALUE=DATE:${dateOnly(ev.start)}`);
      L.push(`DTEND;VALUE=DATE:${dateOnly(ev.end ? nextDay(ev.end) : nextDay(ev.start))}`);
    } else {
      const start = new Date(ev.start);
      const end = ev.end ? new Date(ev.end) : new Date(start.getTime() + 60 * 60 * 1000);
      L.push(`DTSTART:${utcStamp(start)}`);
      L.push(`DTEND:${utcStamp(end)}`);
    }
    L.push(`SUMMARY:${escapeText(ev.summary)}`);
    if (ev.description) L.push(`DESCRIPTION:${escapeText(ev.description)}`);
    if (ev.location) L.push(`LOCATION:${escapeText(ev.location)}`);
    if (ev.url) L.push(`URL:${ev.url}`);
    if (organizer?.email) L.push(`ORGANIZER;CN=${escapeText(organizer.name || organizer.email)}:mailto:${organizer.email}`);
    if (attendee?.email) {
      L.push(`ATTENDEE;CN=${escapeText(attendee.name || attendee.email)};ROLE=REQ-PARTICIPANT;PARTSTAT=ACCEPTED;RSVP=FALSE:mailto:${attendee.email}`);
    }
    L.push(`STATUS:${method === 'CANCEL' ? 'CANCELLED' : 'CONFIRMED'}`);
    L.push('TRANSP:OPAQUE');
    L.push('END:VEVENT');
  }
  L.push('END:VCALENDAR');
  return L.map(fold).join(CRLF) + CRLF;
}
