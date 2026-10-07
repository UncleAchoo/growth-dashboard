#!/usr/bin/env node
// Per-person Amplitude events for the ?beta channel table (Nick, Oct 7).
//
// The regular pull (pull-data.mjs) only gets DAILY TOTALS per "How did you
// hear about us?" answer, so the dashboard can't tell which signup gave which
// answer. This pulls the raw events (Amplitude Export API) for the two that
// matter, with the user id on each:
//   [Onboarding] Company Setup Complete  → user_id + referral_source (the answer)
//   User Invitation Completed            → user_id (accepted an invite)
// Amplitude user_id = Metabase users.id, so ingest-signups.mjs can attach the
// answer / invite to each signup row and the dashboard can show Sign up →
// activated per channel.
//
//   npm run pull-amp-events                  incremental (new days + last 2 days)
//   AMP_EVENTS_START=2026-02-16 npm run pull-amp-events   (first run backfills from here)
//
// Writes data/amplitude/signup_events.json (gitignored — user ids). Uses the
// same AMPLITUDE_API_KEY / AMPLITUDE_SECRET as pull-data.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import zlib from 'node:zlib';

if (existsSync('.env.local')) {
  for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq < 0) continue;
    const key = t.slice(0, eq).trim();
    const val = t.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
    if (!process.env[key]) process.env[key] = val;
  }
}

const KEY = process.env.AMPLITUDE_API_KEY;
const SECRET = process.env.AMPLITUDE_SECRET;
const START = process.env.AMP_EVENTS_START || '2026-02-16'; // signup counts start here
const OUT_DIR = 'data/amplitude';
const OUT = `${OUT_DIR}/signup_events.json`;
const REFETCH_DAYS = 2; // Amplitude can land events late; always re-pull the last N days
const EVENTS = {
  '[Onboarding] Company Setup Complete': 'csc',
  'User Invitation Completed': 'inv',
};

const ymd = (iso) => iso.replaceAll('-', '');
const addDays = (iso, n) => { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const today = new Date().toISOString().slice(0, 10);

// --- Minimal ZIP reader (central directory; stored or deflate entries) -------
export function unzipEntries(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('not a zip (no end-of-central-directory record)');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out = [];
  for (let e = 0; e < count; e++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('bad zip central directory');
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    p += 46 + nameLen + extraLen + commentLen;
    if (name.endsWith('/')) continue;
    const lNameLen = buf.readUInt16LE(local + 26);
    const lExtraLen = buf.readUInt16LE(local + 28);
    const start = local + 30 + lNameLen + lExtraLen;
    const raw = buf.subarray(start, start + csize);
    const data = method === 0 ? raw : method === 8 ? zlib.inflateRawSync(raw) : null;
    if (!data) throw new Error(`unsupported zip method ${method} for ${name}`);
    out.push({ name, data });
  }
  return out;
}

// Pull one UTC day of raw events and keep only the two we need.
export function parseExport(zipBuf) {
  const rows = { csc: [], inv: [] };
  for (const { name, data } of unzipEntries(zipBuf)) {
    const text = (name.endsWith('.gz') ? zlib.gunzipSync(data) : data).toString('utf8');
    for (const line of text.split('\n')) {
      if (!line) continue;
      // Cheap pre-filter before JSON.parse — most lines are other events.
      if (!line.includes('Company Setup Complete') && !line.includes('User Invitation Completed')) continue;
      let ev;
      try { ev = JSON.parse(line); } catch { continue; }
      const kind = EVENTS[ev.event_type];
      if (!kind || !ev.user_id) continue;
      const t = String(ev.event_time || ev.client_event_time || '').replace(' ', 'T').slice(0, 19) + 'Z';
      if (kind === 'csc') rows.csc.push({ uid: ev.user_id, t, ref: ev.event_properties?.referral_source ?? null });
      else rows.inv.push({ uid: ev.user_id, t });
    }
  }
  return rows;
}

async function fetchDay(day) {
  const url = `https://amplitude.com/api/2/export?start=${ymd(day)}T00&end=${ymd(day)}T23`;
  const res = await fetch(url, { headers: { Authorization: 'Basic ' + Buffer.from(`${KEY}:${SECRET}`).toString('base64') } });
  if (res.status === 404) return { csc: [], inv: [] }; // no data that day
  if (!res.ok) throw new Error(`Amplitude export ${day} HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return parseExport(Buffer.from(await res.arrayBuffer()));
}

async function main() {
  if (!KEY || !SECRET) throw new Error('AMPLITUDE_API_KEY / AMPLITUDE_SECRET not set (.env.local)');
  mkdirSync(OUT_DIR, { recursive: true });
  const cache = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : { days: {} };
  const refetchFrom = addDays(today, -REFETCH_DAYS);
  const todo = [];
  for (let d = START; d < today; d = addDays(d, 1)) if (!cache.days[d] || d >= refetchFrom) todo.push(d);
  console.log(`Amplitude export: ${todo.length} day(s) to pull (${todo[0] || '—'} → ${todo[todo.length - 1] || '—'}); ${Object.keys(cache.days).length} cached.`);
  let failed = 0;
  for (const d of todo) {
    try {
      const rows = await fetchDay(d);
      cache.days[d] = rows;
      console.log(`  ${d}: ${rows.csc.length} company setups (${rows.csc.filter((r) => r.ref).length} with an answer), ${rows.inv.length} accepted invites`);
    } catch (err) {
      failed += 1;
      console.log(`  ${d}: FAILED — ${err.message}`);
    }
    // Save as we go so a long backfill can resume.
    cache.pulledAt = new Date().toISOString();
    writeFileSync(OUT, JSON.stringify(cache));
  }
  const all = Object.values(cache.days);
  console.log(`Done. ${all.reduce((s, r) => s + r.csc.length, 0)} company setups, ${all.reduce((s, r) => s + r.inv.length, 0)} accepted invites cached in ${OUT}.${failed ? ` ${failed} day(s) failed — re-run to retry.` : ''}`);
  console.log('Next: npm run ingest-signups (attaches answers + invites to signups), then build.');
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((err) => { console.error(err); process.exit(1); });
