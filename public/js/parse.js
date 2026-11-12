// Turns a pasted list (one item per line) into sign-up items. Works in the browser and in Node tests.
// Understands:  "Quiche x2", "Quiche (2)", "Quiche ×2", "Bacon, 2"     → how many people can take it
//               "Quiche — serves 8", "Quiche | serves 8", "Quiche - serves 8" → note
//               "Savory:" or "# Savory"                                 → section heading
//               "10:00-11:00 Coffee setup", "9:30am - 10am Set up"     → time slot

const TIME = String.raw`(\d{1,2})(?::(\d{2}))?\s*(am|pm|a|p)?`;
const RANGE = new RegExp(String.raw`^${TIME}\s*(?:-|–|—|to)\s*${TIME}\s+`, 'i');

function hm(h, m, ap, otherAp) {
  let H = Number(h);
  const M = Number(m || 0);
  const mer = (ap || otherAp || '').toLowerCase();
  if (mer.startsWith('p') && H < 12) H += 12;
  else if (mer.startsWith('a') && H === 12) H = 0;
  else if (!mer && H >= 1 && H <= 6) H += 12; // "2-3" at an event means afternoon
  return `${String(H).padStart(2, '0')}:${String(M).padStart(2, '0')}`;
}

export function parseItems(text) {
  const out = [];
  let section = '';
  for (let raw of String(text || '').split(/\r?\n/)) {
    let line = raw.trim().replace(/^[-•*·]\s+/, '').replace(/^\d+[.)]\s+/, '');
    if (!line) continue;
    if (/^#/.test(line)) { section = line.replace(/^#+\s*/, '').replace(/:$/, '').trim(); continue; }
    if (/:$/.test(line) && !/\d:$/.test(line)) { section = line.slice(0, -1).trim(); continue; }

    const item = { label: '', qty: 1, note: '', section, startHM: '', endHM: '' };
    const r = line.match(RANGE);
    if (r) {
      item.startHM = hm(r[1], r[2], r[3], r[6]);
      item.endHM = hm(r[4], r[5], r[6], r[3]);
      line = line.slice(r[0].length).trim();
    }
    const noteSplit = line.split(/\s+(?:—|–|-|\|)\s+|\s*\|\s*/);
    line = noteSplit.shift().trim();
    item.note = noteSplit.join(' — ').trim();

    let q = line.match(/\s*(?:[x×]\s*(\d+)|\((\d+)\)|,\s*(\d+))$/i);
    if (q) {
      item.qty = Math.min(99, Math.max(1, Number(q[1] || q[2] || q[3])));
      line = line.slice(0, q.index).trim();
    }
    item.label = line.slice(0, 120);
    if (item.label) out.push(item);
  }
  return out;
}
