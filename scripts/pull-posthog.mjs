#!/usr/bin/env node
// New onboarding — org creator outcomes (Nick, Oct 21 2026).
//
// Recreates Kyle's PostHog dashboard "New onboarding — creator outcomes"
// (us.posthog.com/project/381053/dashboard/2240501) for the ?beta Activation
// tab. Same events, same criteria:
//   Cohort      people who fired [Activation] Organization Created on/after
//               2026-10-21 00:00 America/New_York (04:00 UTC) with an event
//               email NOT containing "mutiny" (= PostHog cohort 654200, inlined
//               here so new creators show up immediately instead of waiting for
//               PostHog's periodic cohort recalculation), minus Internal / Test
//               users (cohort 257060). Also drops @gomomentic.com (dashboard-wide
//               internal rule; no effect on PostHog's numbers so far).
//   Milestones  independent (no required order), each = the person fired the
//               event at least once since the rollout start:
//     org    [Activation] Organization Created
//     gmail  [Activation] Integration Connected, toolkit = gmail
//     cal    [Activation] Integration Connected, toolkit = google_calendar
//     rec    [Recorder] Signed In
//     perms  [Recorder] Permissions Granted   (all 3 recorder permissions)
//     a1     [Onboarding] First Action Completed          (EPD-9795 A1)
//     a2     [Onboarding] First Review Action Completed   (EPD-9795 A2)
//
// Also pulls org joins by join type (invite vs domain match) → data/posthog/org_joins.json
// for ingest-signups.mjs (see JOINS_QUERY below).
//
//   npm run pull-posthog                     query PostHog (needs POSTHOG_PERSONAL_API_KEY)
//   node scripts/pull-posthog.mjs --from-file rows.json        rebuild the onboarding card from saved rows
//   node scripts/pull-posthog.mjs --joins-from-file rows.csv   rebuild org joins from saved rows
//
// Writes src/beta-posthog.json (committed: one row per creator with email +
// user id for the click-to-list modal, like the other activation lists).
// Key: PostHog → Settings → Personal API keys, scope "Query: read" on project 381053.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

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

const HOST = (process.env.POSTHOG_HOST || 'https://us.posthog.com').replace(/\/$/, '');
const PROJECT = process.env.POSTHOG_PROJECT_ID || '381053';
const KEY = process.env.POSTHOG_PERSONAL_API_KEY;
const OUT = 'src/beta-posthog.json';
const ROLLOUT_UTC = '2026-10-21 04:00:00'; // = Oct 21 2026 00:00 America/New_York
const TZ = 'America/New_York';
const INTERNAL_EMAIL_RX = /@(mutinyhq\.com|gomomentic\.com)$/i;

const STEPS = [
  ['org', "event = '[Activation] Organization Created'"],
  ['gmail', "event = '[Activation] Integration Connected' AND properties.toolkit = 'gmail'"],
  ['cal', "event = '[Activation] Integration Connected' AND properties.toolkit = 'google_calendar'"],
  ['rec', "event = '[Recorder] Signed In'"],
  ['perms', "event = '[Recorder] Permissions Granted'"],
  ['a1', "event = '[Onboarding] First Action Completed'"],
  ['a2', "event = '[Onboarding] First Review Action Completed'"],
];
const EVENTS = [
  '[Activation] Organization Created',
  '[Activation] Integration Connected',
  '[Recorder] Signed In',
  '[Recorder] Permissions Granted',
  '[Onboarding] First Action Completed',
  '[Onboarding] First Review Action Completed',
];

export const QUERY = `SELECT
  person_id,
  argMaxIf(toString(properties.email), timestamp, event = '[Activation] Organization Created') AS email,
  argMinIf(distinct_id, timestamp, event = '[Activation] Organization Created') AS uid,
  arraySort(groupArrayIf(concat(toString(timestamp), '|', toString(properties.company_id)), event = '[Activation] Organization Created')) AS orgs,
${STEPS.map(([k, cond]) => `  if(countIf(${cond}) > 0, toString(minIf(timestamp, ${cond})), '') AS ${k}`).join(',\n')}
FROM events
WHERE timestamp >= toDateTime('${ROLLOUT_UTC}')
  AND timestamp < now()
  AND event IN (${EVENTS.map((e) => `'${e}'`).join(', ')})
  AND person_id IN (
    SELECT person_id FROM events
    WHERE event = '[Activation] Organization Created'
      AND timestamp >= toDateTime('${ROLLOUT_UTC}')
      AND NOT (toString(properties.email) ILIKE '%mutiny%')
      AND NOT (toString(properties.email) ILIKE '%@gomomentic.com')
  )
  AND person_id NOT IN COHORT 257060
GROUP BY person_id
ORDER BY org
LIMIT 10000`;

// '2026-10-21 05:52:23.933000' (UTC) → '2026-10-21T01:52' (Eastern wall clock)
const etParts = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const toET = (utc) => {
  if (!utc) return null;
  const d = new Date(`${utc.replace(' ', 'T').replace(/(\.\d{3})\d*$/, '$1')}Z`);
  if (Number.isNaN(d.getTime())) return null;
  const p = Object.fromEntries(etParts.formatToParts(d).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
};

export function build(columns, rows, pulledAt = new Date().toISOString()) {
  const idx = Object.fromEntries(columns.map((c, i) => [c, i]));
  const creators = rows
    .map((r) => {
      const email = r[idx.email] || '';
      const steps = {};
      for (const [k] of STEPS) { const t = toET(r[idx[k]]); if (t) steps[k] = t; }
      const orgUtc = r[idx.org] ? `${r[idx.org].replace(' ', 'T').replace(/(\.\d{3})\d*$/, '$1')}Z` : null;
      // Every org this person created (Nick, Oct 23): workspace id + UTC time.
      // ingest-signups.mjs adds a signup row for any of these missing from
      // Metabase's user_signups (the new onboarding doesn't always write one).
      const orgs = (idx.orgs == null ? [] : r[idx.orgs] || [])
        .map((s) => { const [t, co] = String(s).split('|'); return { co: co || null, utc: `${t.replace(' ', 'T').replace(/(\.\d{3})\d*$/, '$1')}Z` }; })
        .filter((o) => o.co);
      return { pid: r[idx.person_id], uid: r[idx.uid] || null, email, orgUtc, ...steps, ...(orgs.length ? { orgs } : {}) };
    })
    .filter((c) => !INTERNAL_EMAIL_RX.test(c.email))
    .sort((a, b) => ((a.org || '') < (b.org || '') ? -1 : 1));
  const counts = Object.fromEntries(STEPS.map(([k]) => [k, creators.filter((c) => c[k]).length]));
  return {
    source: `PostHog project ${PROJECT} (dashboard 2240501 logic)`,
    pulledAt,
    rolloutStart: '2026-10-21',
    rolloutStartUtc: `${ROLLOUT_UTC.replace(' ', 'T')}Z`,
    tz: TZ,
    counts,
    creators,
  };
}

// --- How joiners joined (Nick, Oct 21) -------------------------------------
// [Activation] Organization Joined carries join_type: 'invitation' (accepted
// an invite) or 'discovered_join' (found the org through their email domain,
// the "Your team beat you here" screen). Tracked from Aug 28, 2026. One row
// per user + company (first join). ingest-signups.mjs attaches it to the
// matching signup row (user_id + company_id) so the channel table can split
// joiners into "Joined via invite" / "Joined via domain match".
// Written to data/posthog/org_joins.json (gitignored — user ids).
const JOINS_OUT_DIR = 'data/posthog';
const JOINS_OUT = `${JOINS_OUT_DIR}/org_joins.json`;
// Organization Joined first fired 2026-08-28. A time bound is required: without
// it PostHog scans every event ever and the API times out (504, Oct 21).
const JOINS_FROM_UTC = '2026-08-28 00:00:00';
export const JOINS_QUERY = `SELECT
  distinct_id AS uid,
  toString(properties.company_id) AS co,
  toString(properties.join_type) AS join_type,
  toString(min(timestamp)) AS t
FROM events
WHERE timestamp >= toDateTime('${JOINS_FROM_UTC}')
  AND timestamp < now()
  AND event = '[Activation] Organization Joined'
  AND NOT (toString(properties.email) ILIKE '%mutiny%')
  AND NOT (toString(properties.email) ILIKE '%@gomomentic.com')
GROUP BY uid, co, join_type
ORDER BY t
LIMIT 100000`;
const JT = { invitation: 'i', discovered_join: 'd' };
export function buildJoins(rows, pulledAt = new Date().toISOString()) {
  // rows: [uid, co, join_type ('invitation' | 'discovered_join' | 'i' | 'd'), t]
  const byKey = new Map();
  for (const [uid, co, type, t] of rows) {
    if (!uid || !co) continue;
    const jt = JT[type] || (type === 'i' || type === 'd' ? type : null);
    if (!jt) continue;
    const k = `${uid}|${co}`;
    const cur = byKey.get(k);
    if (!cur || String(t) < cur.t) byKey.set(k, { uid, co, jt, t: String(t).replace(' ', 'T').slice(0, 19) });
  }
  const joins = [...byKey.values()].sort((a, b) => (a.t < b.t ? -1 : 1));
  return { source: `PostHog project ${PROJECT}, [Activation] Organization Joined`, pulledAt, firstDay: joins[0]?.t.slice(0, 10) || null, lastDay: joins[joins.length - 1]?.t.slice(0, 10) || null, joins };
}

// PostHog sometimes answers 503 "clickhouse_at_capacity" (or 429/504) when its
// query cluster is busy — transient, so retry a few times with backoff.
const RETRY_WAITS_MS = [15000, 45000, 90000];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function hogql(query, name) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${HOST}/api/projects/${PROJECT}/query/`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: { kind: 'HogQLQuery', query }, name }),
    });
    if (res.ok) return res.json();
    const body = (await res.text()).slice(0, 500);
    if ([429, 503, 504].includes(res.status) && attempt < RETRY_WAITS_MS.length) {
      const wait = RETRY_WAITS_MS[attempt];
      console.warn(`pull-posthog: "${name}" got ${res.status} (PostHog busy) — retrying in ${wait / 1000}s (${attempt + 1}/${RETRY_WAITS_MS.length})`);
      await sleep(wait);
      continue;
    }
    throw new Error(`PostHog query failed (${res.status}): ${body}`);
  }
}

function writeJoins(out) {
  mkdirSync(JOINS_OUT_DIR, { recursive: true });
  writeFileSync(JOINS_OUT, `${JSON.stringify(out)}\n`);
  const n = out.joins.reduce((m, j) => ({ ...m, [j.jt]: (m[j.jt] || 0) + 1 }), {});
  console.log(`pull-posthog: ${out.joins.length} org joins ${out.firstDay} → ${out.lastDay} (invite ${n.i || 0}, domain match ${n.d || 0}) → ${JOINS_OUT}`);
}

async function main() {
  // Seed / offline: --joins-from-file rows.csv (uid,co,i|d,timestamp per line)
  const joinsArg = process.argv.indexOf('--joins-from-file');
  if (joinsArg > -1) {
    const lines = readFileSync(process.argv[joinsArg + 1], 'utf8').split('\n').map((l) => l.trim()).filter(Boolean);
    writeJoins(buildJoins(lines.map((l) => l.split(',')), process.env.JOINS_PULLED_AT || undefined));
    return;
  }
  const fileArg = process.argv.indexOf('--from-file');
  let columns; let rows; let pulledAt;
  if (fileArg > -1) {
    const saved = JSON.parse(readFileSync(process.argv[fileArg + 1], 'utf8'));
    ({ columns, results: rows } = saved);
    pulledAt = saved.pulledAt;
  } else {
    if (!KEY) {
      console.error('pull-posthog: POSTHOG_PERSONAL_API_KEY is not set (.env.local) — keeping the previous src/beta-posthog.json and data/posthog/org_joins.json.');
      process.exit(1);
    }
    let failed = false;
    try {
      const j = await hogql(JOINS_QUERY, 'growth-dashboard: org joins by join type');
      writeJoins(buildJoins(j.results));
    } catch (e) {
      console.error(`pull-posthog: org joins — ${e.message} (keeping the previous ${JOINS_OUT})`);
      failed = true;
    }
    try {
      const json = await hogql(QUERY, 'growth-dashboard: new onboarding creator outcomes');
      columns = json.columns; rows = json.results;
    } catch (e) {
      console.error(`pull-posthog: ${e.message}`);
      process.exit(1);
    }
    if (failed) process.exitCode = 1;
  }
  const out = build(columns, rows, pulledAt);
  writeFileSync(OUT, `${JSON.stringify(out, null, 2)}\n`);
  console.log(`pull-posthog: ${out.creators.length} org creators since ${out.rolloutStart} → ${OUT}`, out.counts);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main();
