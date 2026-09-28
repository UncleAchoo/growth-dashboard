// Beta dashboard (?beta): turns the signups CSV export into src/beta-signups.json.
//
//   npm run ingest-signups            (reads data/signups.csv)
//   npm run ingest-signups -- path/to/file.csv
//
// Only the fields the charts need are kept — names, emails and user ids are
// dropped so no PII ends up in the committed JSON or the public bundle.
// Every CSV row counts as one signup (one row per user + company signup;
// no internal/test filtering, no dedupe). created_at = that signup's time.
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const src = path.resolve(root, process.argv[2] || 'data/signups.csv');
const out = path.join(root, 'src/beta-signups.json');

// Minimal RFC-4180 parser (handles quoted fields with commas / newlines).
function parseCsv(text) {
  const rows = [];
  let row = [], field = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') q = false;
      else field += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((v) => v !== ''));
}

const text = fs.readFileSync(src, 'utf8').replace(/^﻿/, '');
const [header, ...rows] = parseCsv(text);
const col = Object.fromEntries(header.map((h, i) => [h.trim(), i]));
for (const k of ['created_at', 'self_selected_role', 'recorder_first_installed_at', 'calendar_first_connected_at', 'email_first_connected_at', 'first_meeting_recorded_at', 'first_email_or_asset_sent_at']) {
  if (!(k in col)) throw new Error(`CSV missing column: ${k}`);
}

const day = (v) => (v ? v.trim().slice(0, 10) : null); // YYYY-MM-DD (timestamps are UTC)
const signups = rows.map((r) => ({
  d: day(r[col.created_at]),
  role: (r[col.self_selected_role] || '').trim() || null,
  co: 'company_id' in col ? (r[col.company_id] || '').trim() || null : null, // opaque id, for per-company metrics later
  rec: day(r[col.recorder_first_installed_at]),
  cal: day(r[col.calendar_first_connected_at]),
  em: day(r[col.email_first_connected_at]),
  mt: day(r[col.first_meeting_recorded_at]),
  snd: day(r[col.first_email_or_asset_sent_at]),
})).filter((s) => s.d).sort((a, b) => a.d.localeCompare(b.d));

const json = {
  pulledAt: new Date().toISOString(),
  source: path.basename(src),
  firstDate: signups[0]?.d,
  lastDate: signups[signups.length - 1]?.d,
  signups,
};
fs.writeFileSync(out, JSON.stringify(json));
console.log(`beta-signups: ${signups.length} signups ${json.firstDate} → ${json.lastDate} → ${path.relative(root, out)}`);
