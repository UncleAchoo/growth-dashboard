#!/usr/bin/env node
// PostHog-sourced signups (Nick, Oct 23 2026) — the dashboard's ?posthog view.
//
// Builds src/beta-signups-ph.json: signup rows from Oct 21, 2026 (Pacific; the
// new-onboarding launch) in the SAME row format as src/beta-signups.json, but
// built from PostHog events (data/posthog/signup_events.json, written by
// npm run pull-posthog) instead of the Metabase user_signups export. With
// ?posthog the dashboard uses Metabase rows before Oct 21 and these rows from
// Oct 21. Everything else stays as it is (credits, inactive accounts, paying).
//
// Rows (one per user + workspace, like Metabase):
//   creator   [Activation] Organization Created (company_id)
//   joiner    [Activation] Organization Joined (company_id; jt = invitation 'i' / domain match 'd')
//   never completed  [Activation] User Created with no org created or joined
// Milestones attached to the row with the same workspace when the event has
// one, else to the user's latest row on/before the event (first row if none):
//   role  [Onboarding] Role Confirmed `role`
//   ref   [Onboarding] Company Setup Complete `referral_source` (+ csc) → the user's creator row
//   inv   User Invitation Completed → the user's joiner row
//   ints / em / cal  [Activation] Integration Connected + Pipedream Connection Failed, by toolkit
//                    (failed attempts count, same rule as Metabase; PostHog has no
//                    shared/company-wide flag, so shared connections are not spread)
//   rec   [Recorder] Signed In (Metabase: recorder install)
//   mt    Recording Completed
//   snd   Gmail Email Sent / Gmail Email Sent Directly / Email Draft Sent to Gmail / [Activation] Email Sent
//   pub   Asset Published
//   a2    [Onboarding] A2 Activated = Activated (Nick, Oct 26)
//   ret   first day after activation (a2) with an asset created/published,
//         an email sent, or credits used (credits from the Metabase credit export)
// Only FULL Pacific days: rows and milestones stop at the start of the day the
// PostHog pull ran (today's partial day is left out).

import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const FROM = '2026-10-21';
const EVENTS = path.join(root, 'data/posthog/signup_events.json');
const OUT = path.join(root, 'src/beta-signups-ph.json');
const QDIR = path.join(root, 'data/data-queries');

if (!fs.existsSync(EVENTS)) { console.error(`build-posthog-signups: no ${path.relative(root, EVENTS)} — run npm run pull-posthog first`); process.exit(1); }
const src = JSON.parse(fs.readFileSync(EVENTS, 'utf8'));

const ptFmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
const toPT = (iso) => { const p = Object.fromEntries(ptFmt.formatToParts(new Date(iso)).map((x) => [x.type, x.value])); return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}`; };
const minDay = (a, b) => (!a ? b : !b ? a : a < b ? a : b);
const today = toPT(src.pulledAt).slice(0, 10); // pull day (partial) — excluded
const ev = src.events.map((e) => ({ ...e, at: toPT(e.t), d: toPT(e.t).slice(0, 10) })).filter((e) => e.d >= FROM && e.d < today).sort((a, b) => (a.at < b.at ? -1 : 1));

// --- Signup rows.
const rows = []; const byKey = new Map(); const byUid = new Map(); const emailOf = new Map();
for (const e of ev) if (e.em && !emailOf.has(e.uid)) emailOf.set(e.uid, e.em);
const addRow = (uid, co, at, kind, jt) => {
  const k = `${uid}|${co || ''}`;
  if (byKey.has(k)) return byKey.get(k);
  const r = { uid, co, at, d: at.slice(0, 10), kind, jt, ints: {} };
  rows.push(r); byKey.set(k, r);
  (byUid.get(uid) || byUid.set(uid, []).get(uid)).push(r);
  return r;
};
for (const e of ev) {
  if (e.k === 'oc' && e.co) addRow(e.uid, e.co, e.at, 'creator');
  if (e.k === 'oj' && e.co) addRow(e.uid, e.co, e.at, 'joiner', e.v === 'invitation' ? 'i' : e.v === 'discovered_join' ? 'd' : null);
}
for (const e of ev) if (e.k === 'u' && !byUid.has(e.uid)) addRow(e.uid, null, e.at, 'nc');

// Row an event belongs to: same workspace, else the user's latest row on/before it.
const rowFor = (e, prefer) => {
  if (e.co && byKey.has(`${e.uid}|${e.co}`)) return byKey.get(`${e.uid}|${e.co}`);
  const list = (byUid.get(e.uid) || []).slice().sort((a, b) => (a.at < b.at ? -1 : 1));
  if (!list.length) return null;
  const pool = prefer ? list.filter((r) => r.kind === prefer) : [];
  const from = pool.length ? pool : list;
  const before = from.filter((r) => r.at <= e.at);
  return before.length ? before[before.length - 1] : from[0];
};

const activity = new Map(); // row -> Map(day -> Set(c|a|e))
const act = (r, d, t) => { if (!r) return; const m = activity.get(r) || activity.set(r, new Map()).get(r); (m.get(d) || m.set(d, new Set()).get(d)).add(t); };
let unattached = 0;
for (const e of ev) {
  if (['u', 'oc', 'oj'].includes(e.k)) continue;
  const r = rowFor(e, e.k === 'csc' ? 'creator' : e.k === 'inv' ? 'joiner' : null);
  if (!r) { unattached += 1; continue; }
  if (e.k === 'role' && e.v && !r.role) r.role = e.v;
  if (e.k === 'csc') { r.csc = 1; if (e.v && !r.ref) r.ref = e.v; }
  if (e.k === 'inv') r.inv = 1;
  if (e.k === 'int' || e.k === 'intf') {
    const tk = e.v || 'custom_integration';
    r.ints[tk] = minDay(r.ints[tk], e.d);
    if (tk === 'gmail') r.em = minDay(r.em, e.d);
    if (tk === 'google_calendar') r.cal = minDay(r.cal, e.d);
  }
  if (e.k === 'rec') { r.rec = minDay(r.rec, e.d); r.phRec = minDay(r.phRec, e.d); }
  if (e.k === 'perms') r.phPerms = minDay(r.phPerms, e.d);
  // Completed onboarding steps (Nick, Oct 26): confirmed connections only, like the New onboarding card.
  if (e.k === 'int' && e.v === 'gmail') r.phEm = minDay(r.phEm, e.d);
  if (e.k === 'int' && e.v === 'google_calendar') r.phCal = minDay(r.phCal, e.d);
  if (e.k === 'mt') r.mt = minDay(r.mt, e.d);
  if (e.k === 'snd') { r.snd = minDay(r.snd, e.d); act(r, e.d, 'e'); }
  if (e.k === 'pub') { r.pub = minDay(r.pub, e.d); act(r, e.d, 'a'); }
  if (e.k === 'a2') r.a2 = minDay(r.a2, e.d);
  if (e.k === 'a1') r.a1 = minDay(r.a1, e.d); // A1 activation (Nick, Oct 26) // Activated = PostHog [Onboarding] A2 Activated (Nick, Oct 26)
  if (e.k === 'ac') act(r, e.d, 'a');
}

// Credits used (return activity only) from the Metabase credit export, by email + workspace.
const creditFile = fs.existsSync(QDIR) ? fs.readdirSync(QDIR).filter((f) => f.startsWith('_customer_health__all_credit_usage')).sort().pop() : null;
if (creditFile) {
  // Quote-aware CSV split (company names can contain commas).
  const splitCsv = (l) => { const o = []; let f = ''; let q = false; for (let i = 0; i < l.length; i++) { const c = l[i]; if (q) { if (c === '"' && l[i + 1] === '"') { f += '"'; i++; } else if (c === '"') q = false; else f += c; } else if (c === '"') q = true; else if (c === ',') { o.push(f); f = ''; } else f += c; } o.push(f); return o; };
  const [header, ...lines] = fs.readFileSync(path.join(QDIR, creditFile), 'utf8').replace(/^﻿/, '').split(/\r?\n/).filter(Boolean).map(splitCsv);
  const ix = Object.fromEntries(header.map((h, i) => [h.trim(), i]));
  const rowByEmailCo = new Map(); const rowsByEmail = new Map();
  for (const r of rows) {
    const em = (emailOf.get(r.uid) || '').toLowerCase();
    if (!em) continue;
    rowByEmailCo.set(`${em}|${r.co}`, r);
    (rowsByEmail.get(em) || rowsByEmail.set(em, []).get(em)).push(r);
  }
  for (const l of lines) {
    const em = (l[ix.email] || '').toLowerCase(); const d = (l[ix.usage_date] || '').slice(0, 10);
    if (!(Number(l[ix.credits_used]) > 0) || !d || d < FROM || d >= today) continue;
    const r = rowByEmailCo.get(`${em}|${l[ix.company_id]}`) || (rowsByEmail.get(em) || []).filter((x) => x.d <= d).pop();
    if (r) act(r, d, 'c');
  }
}

// --- Same row format as beta-signups.json.
const signups = rows.map((r) => {
  const s = { d: r.d, role: r.role || null, co: r.co || null, rec: r.rec || null, cal: r.cal || null, em: r.em || null, mt: r.mt || null, snd: r.snd || null, pub: r.pub || null };
  if (r.a2) s.a2 = r.a2;
  if (r.a1) s.a1 = r.a1;
  if (r.phEm) s.phEm = r.phEm;
  if (r.phCal) s.phCal = r.phCal;
  if (r.phRec) s.phRec = r.phRec;
  if (r.phPerms) s.phPerms = r.phPerms;
  if (Object.keys(r.ints).length) s.ints = r.ints;
  if (r.kind === 'nc') s.nc = 1;
  if (r.kind === 'joiner') { s.jx = 1; if (r.jt) s.jt = r.jt; }
  if (r.ref) s.ref = r.ref;
  if (r.csc) s.csc = 1;
  if (r.inv) s.inv = 1;
  const a = s.a2; // activation day = A2 (Nick, Oct 26)
  if (a && activity.has(r)) {
    let best = null;
    for (const d of activity.get(r).keys()) if (d > a && (!best || d < best)) best = d;
    if (best) { s.ret = best; s.retVia = [...activity.get(r).get(best)].sort().join(''); }
  }
  s.uid = r.uid;
  if (emailOf.get(r.uid)) s.email = emailOf.get(r.uid);
  s.src = 'ph';
  return s;
}).sort((a, b) => (a.d < b.d ? -1 : 1));

const lastFull = new Date(`${today}T12:00:00Z`); lastFull.setUTCDate(lastFull.getUTCDate() - 1);
const out = {
  source: src.source,
  pulledAt: src.pulledAt,
  fromDay: FROM,
  lastDate: lastFull.toISOString().slice(0, 10),
  internalExcluded: src.internalExcluded || 0,
  creditsFile: creditFile || null,
  signups,
};
fs.writeFileSync(OUT, JSON.stringify(out));
const n = (f) => signups.filter(f).length;
console.log(`build-posthog-signups: ${signups.length} rows ${FROM} → ${out.lastDate} (creators ${n((s) => !s.nc && !s.jx)}, joiners ${n((s) => s.jx)}, never completed ${n((s) => s.nc)}; gmail ${n((s) => s.em)}, calendar ${n((s) => s.cal)}, recorder ${n((s) => s.rec)}, published ${n((s) => s.pub)}${unattached ? `; ${unattached} events with no signup row` : ''}) → ${path.relative(root, OUT)}`);
