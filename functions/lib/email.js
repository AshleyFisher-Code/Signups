// Email text and sending. With no Resend key (local testing) mail is written to the `outbox` collection instead.
import { buildIcs } from './ics.js';
import { describe, eventsFor, fmtWhen } from './logic.js';
import { CONFIG } from '../config.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function manageUrl(s, entryId, token) {
  return `${CONFIG.siteUrl}/${s.slug}?e=${encodeURIComponent(entryId)}&t=${encodeURIComponent(token)}`;
}

function layout({ heading, intro, lines, s, url, button = 'Change or cancel', note }) {
  const when = fmtWhen(s.when, s.tz);
  const rows = (lines || []).map(l => `<tr><td style="padding:10px 0;border-bottom:1px solid #E6DFD0;font-size:18px;color:#1C2620">${esc(l)}</td></tr>`).join('');
  const html = `<!doctype html><html><body style="margin:0;background:#F7F3EA;font-family:Georgia,'Times New Roman',serif;color:#1C2620">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F7F3EA;padding:28px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#FFFDF8;border:1px solid #E6DFD0;border-radius:14px;padding:32px 28px">
<tr><td style="font-size:13px;letter-spacing:2px;text-transform:uppercase;color:#9A7B4F;padding-bottom:8px">${esc(s.title)}</td></tr>
<tr><td style="font-size:28px;line-height:1.25;color:#1F3B2D;padding-bottom:14px">${esc(heading)}</td></tr>
${intro ? `<tr><td style="font-size:18px;line-height:1.5;padding-bottom:14px">${esc(intro)}</td></tr>` : ''}
${rows ? `<tr><td><table role="presentation" width="100%">${rows}</table></td></tr>` : ''}
${when || s.location ? `<tr><td style="font-size:17px;line-height:1.6;padding-top:18px;color:#3B4A40">${when ? esc(when) + '<br>' : ''}${esc(s.location || '')}</td></tr>` : ''}
${note ? `<tr><td style="font-size:16px;line-height:1.5;padding-top:14px;color:#3B4A40">${esc(note)}</td></tr>` : ''}
${url ? `<tr><td style="padding-top:26px"><a href="${esc(url)}" style="display:inline-block;background:#1F3B2D;color:#FFFDF8;text-decoration:none;font-family:Helvetica,Arial,sans-serif;font-size:17px;padding:14px 24px;border-radius:999px">${esc(button)}</a></td></tr>` : ''}
<tr><td style="font-size:14px;color:#7A8279;padding-top:26px;font-family:Helvetica,Arial,sans-serif">Questions? Just reply to this email.</td></tr>
</table></td></tr></table></body></html>`;
  const text = [heading, intro, ...(lines || []).map(l => '• ' + l), when, s.location, note, url ? `${button}: ${url}` : ''].filter(Boolean).join('\n\n');
  return { html, text };
}

function inviteAttachment(method, s, entryId, entry, priv, url, events) {
  const evs = events || eventsFor(s, entryId, entry, { domain: CONFIG.domain, url, tz: s.tz });
  if (!evs.length) return null;
  const ics = buildIcs({ method, events: evs, organizer: { name: CONFIG.fromName, email: CONFIG.fromEmail }, attendee: { name: priv.name, email: priv.email } });
  return { filename: method === 'CANCEL' ? 'cancel.ics' : 'invite.ics', content: Buffer.from(ics).toString('base64'), content_type: `text/calendar; charset=utf-8; method=${method}` };
}

export function buildMessage(kind, { s, entryId, entry, priv, extra = {} }) {
  const url = manageUrl(s, entryId, priv.token);
  const lines = describe(s, entry, s.tz);
  const first = priv.name.split(' ')[0];
  let subject, body, attachments = [];
  const wl = entry.waitlisted || (entry.picks || []).some(p => p.waitlisted);

  if (kind === 'confirm') {
    subject = `You’re signed up: ${s.title}`;
    body = layout({ heading: `Thank you, ${first}!`, intro: s.type === 'poll' ? 'Here are the dates you marked. You’ll get a calendar invite once the date is set.' : 'Here’s what you signed up for:', lines, s, url,
      note: wl ? 'Anything marked “waitlist” is full right now. If a spot opens, you’ll move up automatically and we’ll email you.' : (s.type !== 'poll' ? 'A calendar invite is attached.' : '') });
    const a = inviteAttachment('REQUEST', s, entryId, entry, priv, url);
    if (a) attachments.push(a);
  } else if (kind === 'update') {
    subject = extra.firstTime ? `It’s set: ${s.title} — ${fmtWhen(s.when, s.tz)}` : `Updated: ${s.title}`;
    body = layout({ heading: extra.firstTime ? 'We have a date!' : 'The details have changed', intro: extra.firstTime ? `${s.title} will be ${fmtWhen(s.when, s.tz)}.` : 'Your calendar invite has been updated with the new details.', lines: s.type === 'poll' ? [] : lines, s, url });
    const a = inviteAttachment('REQUEST', s, entryId, entry, priv, url);
    if (a) attachments.push(a);
  } else if (kind === 'promoted') {
    subject = `A spot opened up: ${s.title}`;
    body = layout({ heading: `Good news, ${first}!`, intro: 'A spot opened up and you’re off the waitlist:', lines, s, url, note: 'Your calendar invite is attached.' });
    const a = inviteAttachment('REQUEST', s, entryId, entry, priv, url);
    if (a) attachments.push(a);
  } else if (kind === 'reminder') {
    subject = `Reminder: ${s.title} — ${fmtWhen(s.when, s.tz)}`;
    body = layout({ heading: `See you soon, ${first}!`, intro: 'A quick reminder of what you signed up for:', lines, s, url });
  } else if (kind === 'cancelled') {
    subject = `Cancelled: ${s.title}`;
    body = layout({ heading: 'You’ve been removed', intro: extra.byHost ? 'The host removed your sign-up. Reply to this email with any questions.' : 'Your sign-up has been cancelled. Changed your mind? You can sign up again any time before it closes.', lines: extra.lines || lines, s, url: `${CONFIG.siteUrl}/${s.slug}`, button: 'Open the sign-up' });
    if (extra.cancelEvents?.length) attachments.push(inviteAttachment('CANCEL', s, entryId, entry, priv, url, extra.cancelEvents));
  } else if (kind === 'eventCancelled') {
    subject = `Cancelled: ${s.title}`;
    body = layout({ heading: `${s.title} has been cancelled`, intro: 'The host has cancelled this event. It has been removed from your calendar.', lines: [], s, url: null });
    const evs = eventsFor({ ...s, sequence: (s.sequence || 0) }, entryId, entry, { domain: CONFIG.domain, url, tz: s.tz });
    if (evs.length) attachments.push(inviteAttachment('CANCEL', s, entryId, entry, priv, url, evs));
  }
  if (extra.removedEvents?.length) attachments.push(inviteAttachment('CANCEL', s, entryId, entry, priv, url, extra.removedEvents));
  return { to: priv.email, subject, ...body, attachments: attachments.filter(Boolean) };
}

export async function send(db, apiKey, msg) {
  if (!msg.to) return;
  const payload = {
    from: `${CONFIG.fromName} <${CONFIG.fromEmail}>`,
    to: [msg.to],
    reply_to: CONFIG.replyTo,
    subject: msg.subject,
    html: msg.html,
    text: msg.text,
    attachments: msg.attachments?.length ? msg.attachments : undefined,
  };
  if (!apiKey || apiKey === 'test') {
    await db.collection('outbox').add({ ...payload, at: Date.now() });
    return;
  }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) console.error('Resend failed', res.status, await res.text());
}
