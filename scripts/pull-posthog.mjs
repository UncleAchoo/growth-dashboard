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
//     a1     [Onboarding] A1 Magic Moment  OR  [Onboarding] First Action Completed
//     a2     [Onboarding] A2 Activated  (only — Nick, Oct 26; this is also the
//            dashboard-wide Activated definition, see A2_QUERY)
//            (Nick, Oct 26): Kyle switched his dashboard to the new A1 Magic
//            Moment / A2 Activated events on Oct 23 (A1 Magic Moment first fired
//            Oct 23 14:38 UTC; A2 Activated not live yet). The old A1 event is
//            kept in an OR so Oct 21–23 completions aren't lost.
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
  ['a1', "event IN ('[Onboarding] A1 Magic Moment', '[Onboarding] First Action Completed')"],
  ['a2', "event = '[Onboarding] A2 Activated'"], // = Activated (Nick, Oct 26: exactly PostHog's, no older event)
];
const EVENTS = [
  '[Activation] Organization Created',
  '[Activation] Integration Connected',
  '[Recorder] Signed In',
  '[Recorder] Permissions Granted',
  '[Onboarding] A1 Magic Moment',
  '[Onboarding] First Action Completed',
  '[Onboarding] A2 Activated',
];

// Org creators PostHog misses (Nick, Oct 26): sign up export rows that are the
// first person on a company since the rollout but never fired [Activation]
// Organization Created (existing users creating another company, or the event
// just not firing). Their user ids come from the last ingest
// (src/beta-signups.json) and are added to the cohort so their milestones are
// pulled too; they're marked viaExport and listed on the card + in
// TRACKING_GAPS.md. Uses the previous ingest, so a brand-new one can lag a day
// (the dashboard fills that gap from the signup row itself).
const EXPORT_CREATORS = (() => {
  try {
    const j = JSON.parse(readFileSync('src/beta-signups.json', 'utf8'));
    return (j.signups || []).filter((r) => r.d >= ROLLOUT_UTC.slice(0, 10) && !r.nc && !r.jx && r.uid && !INTERNAL_EMAIL_RX.test(r.email || ''))
      .map((r) => ({ uid: r.uid, d: r.d, email: r.email || '', co: r.co || null }));
  } catch (e) { return []; }
})();
const EXPORT_UIDS = [...new Set(EXPORT_CREATORS.map((r) => r.uid))].filter((u) => /^[0-9a-f-]{36}$/i.test(u));
export const QUERY = `SELECT
  person_id,
  argMaxIf(toString(properties.email), timestamp, event = '[Activation] Organization Created') AS email,
  argMinIf(distinct_id, timestamp, event = '[Activation] Organization Created') AS uid,
  groupUniqArray(coalesce(nullIf(toString(properties.user_id), ''), distinct_id)) AS uids,
  any(toString(person.properties.email)) AS pemail,
  arraySort(groupArrayIf(concat(toString(timestamp), '|', toString(properties.company_id)), event = '[Activation] Organization Created')) AS orgs,
${STEPS.map(([k, cond]) => `  if(countIf(${cond}) > 0, toString(minIf(timestamp, ${cond})), '') AS ${k}`).join(',\n')}
FROM events
WHERE timestamp >= toDateTime('${ROLLOUT_UTC}')
  AND timestamp < now()
  AND event IN (${EVENTS.map((e) => `'${e}'`).join(', ')})
  AND (person_id IN (
    SELECT person_id FROM events
    WHERE event = '[Activation] Organization Created'
      AND timestamp >= toDateTime('${ROLLOUT_UTC}')
      AND NOT (toString(properties.email) ILIKE '%mutiny%')
      AND NOT (toString(properties.email) ILIKE '%@gomomentic.com')
  )${EXPORT_UIDS.length ? `
    OR coalesce(nullIf(toString(properties.user_id), ''), distinct_id) IN (${EXPORT_UIDS.map((u) => `'${u}'`).join(', ')})` : ''})
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
      return { pid: r[idx.person_id], uid: r[idx.uid] || null, email, orgUtc, ...steps, ...(orgs.length ? { orgs } : {}), _uids: r[idx.uids] || [], _pemail: (r[idx.pemail] || '').toLowerCase() };
    })
    // Export-only creators (no Organization Created): date them by their
    // export sign up day (noon Pacific ≈ 19:00 UTC) and flag them.
    .map((c) => {
      const pemail = c._pemail;
      delete c._pemail;
      if (c.org) { delete c._uids; return c; }
      const ids = new Set([c.uid, ...(c._uids || [])].filter(Boolean));
      const ex = EXPORT_CREATORS.find((x) => ids.has(x.uid));
      delete c._uids;
      if (!ex) return null;
      // Staff acting as the user (e.g. logged in as them) carry the user's id on
      // a different PostHog person: only keep the person whose own email is the
      // user's (Oct 26: carson.west's id also sat on kyle@ / nikhil@mutinyhq.com).
      if (!pemail || pemail !== (ex.email || '').toLowerCase()) return null;
      return { ...c, uid: c.uid || ex.uid, email: c.email || ex.email, orgUtc: `${ex.d}T19:00:00.000Z`, org: `${ex.d}T00:00`, viaExport: 1 };
    })
    .filter(Boolean)
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

// --- PostHog-sourced signups (Nick, Oct 23; dashboard ?posthog) ---------------
// Every signup + onboarding event since Oct 21 (Pacific) for people who signed
// up, created an org or joined one since then. One row per event kind + user +
// workspace + value + Pacific day (first time that day), so return activity
// can still be dated. build-posthog-signups.mjs turns this into
// src/beta-signups-ph.json. Written to data/posthog/signup_events.json
// (gitignored: user ids + emails).
const SIGNUPS_OUT = `${JOINS_OUT_DIR}/signup_events.json`;
export const SIGNUPS_FROM_UTC = '2026-10-21 07:00:00'; // = Oct 21 2026 00:00 America/Los_Angeles
const SIGNUP_EVENT_CODES = [
  ['u', '[Activation] User Created'],
  ['oc', '[Activation] Organization Created'],
  ['oj', '[Activation] Organization Joined'],
  ['csc', '[Onboarding] Company Setup Complete'],
  ['role', '[Onboarding] Role Confirmed'],
  ['inv', 'User Invitation Completed'],
  ['int', '[Activation] Integration Connected'],
  ['intf', 'Pipedream Connection Failed'],
  ['rec', '[Recorder] Signed In'],
  ['perms', '[Recorder] Permissions Granted'], // all 3 recorder permissions (Nick, Oct 26)
  ['mt', 'Recording Completed'],
  ['pub', 'Asset Published'],
  ['ac', 'Asset Created'],
  ['snd', 'Gmail Email Sent'],
  ['snd', 'Gmail Email Sent Directly'],
  ['snd', 'Email Draft Sent to Gmail'],
  ['snd', '[Activation] Email Sent'],
  ['a2', '[Onboarding] A2 Activated'], // Activated (Nick, Oct 26)
  ['a1', '[Onboarding] A1 Magic Moment'], // A1 activation (Nick, Oct 26)
  ['a1', '[Onboarding] First Action Completed'],
];
const UID_EXPR = "coalesce(nullIf(toString(properties.user_id), ''), distinct_id)";
export const SIGNUP_EVENTS_QUERY = `SELECT
  multiIf(${SIGNUP_EVENT_CODES.map(([k, e]) => `event = '${e}', '${k}'`).join(', ')}, '?') AS k,
  ${UID_EXPR} AS uid,
  toString(properties.company_id) AS co,
  multiIf(k IN ('int', 'intf'), toString(properties.toolkit), k = 'role', toString(properties.role), k = 'csc', toString(properties.referral_source), k = 'oj', toString(properties.join_type), '') AS v,
  toString(min(timestamp)) AS t,
  if(k IN ('u', 'oc', 'oj'), any(toString(properties.email)), '') AS em
FROM events
WHERE timestamp >= toDateTime('${SIGNUPS_FROM_UTC}')
  AND timestamp < now()
  AND event IN (${[...new Set(SIGNUP_EVENT_CODES.map(([, e]) => e))].map((e) => `'${e}'`).join(', ')})
  AND person_id NOT IN COHORT 257060
  AND NOT (coalesce(toString(person.properties.email), '') ILIKE '%mutiny%')
  AND NOT (coalesce(toString(person.properties.email), '') ILIKE '%@gomomentic.com')
  AND ${UID_EXPR} IN (
    SELECT distinct_id FROM events
    WHERE timestamp >= toDateTime('${SIGNUPS_FROM_UTC}')
      AND event IN ('[Activation] User Created', '[Activation] Organization Created', '[Activation] Organization Joined')
  )
GROUP BY k, uid, co, v, toDate(toTimeZone(timestamp, 'America/Los_Angeles'))
ORDER BY t
LIMIT 100000`;
const iso = (t) => `${String(t).replace(' ', 'T').replace(/(\.\d{3})\d*$/, '$1')}${/Z$/.test(t) ? '' : 'Z'}`;
export function buildSignupEvents(rows, pulledAt = new Date().toISOString()) {
  // rows: [k, uid, co, v, t, em]
  const ev = rows
    .filter((r) => r[0] && r[0] !== '?' && r[1])
    .map(([k, uid, co, v, t, em]) => ({ k, uid, co: co && !/^(null|\(null\))$/.test(co) ? co : null, v: v && !/^(null|\(null\))$/.test(v) ? v : null, t: iso(t), ...(em && !/^(null|\(null\))$/.test(em) ? { em } : {}) }));
  // Internal / test users: drop every row of a user whose event email is
  // internal (the person-level filter misses people with no person email yet).
  const internal = new Set(ev.filter((e) => /mutiny/i.test(e.em || '') || INTERNAL_EMAIL_RX.test(e.em || '')).map((e) => e.uid));
  return { source: `PostHog project ${PROJECT}, signup + onboarding events`, pulledAt, fromUtc: `${SIGNUPS_FROM_UTC.replace(' ', 'T')}Z`, internalExcluded: internal.size, events: ev.filter((e) => !internal.has(e.uid)) };
}
function writeSignupEvents(out) {
  mkdirSync(JOINS_OUT_DIR, { recursive: true });
  writeFileSync(SIGNUPS_OUT, `${JSON.stringify(out)}\n`);
  const n = out.events.reduce((m, e) => ({ ...m, [e.k]: (m[e.k] || 0) + 1 }), {});
  console.log(`pull-posthog: ${out.events.length} signup event rows since ${out.fromUtc} → ${SIGNUPS_OUT}`, n);
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

// --- Activated = A2 (Nick, Oct 26) ---------------------------------------------
// The dashboard's Activated user = fired [Onboarding] A2 Activated in PostHog
// (Kyle's dashboard 2240501 definition; no older event in an OR). One row per
// user + workspace (first time). ingest-signups.mjs / build-posthog-signups.mjs
// put it on the matching signup row as s.a2 (Pacific day), and the dashboard's
// actDate() reads only that. Written to data/posthog/a2_events.json
// (gitignored: user ids). Not live in PostHog as of Oct 26, so 0 rows until
// engineering ships it.
export const A2_EVENT = '[Onboarding] A2 Activated';
const A2_OUT = `${JOINS_OUT_DIR}/a2_events.json`;
const A2_FROM_UTC = '2026-10-21 04:00:00'; // new onboarding rollout (Oct 21 00:00 ET); A2 doesn't exist before it
export const A2_QUERY = `SELECT
  ${UID_EXPR} AS uid,
  toString(properties.company_id) AS co,
  toString(min(timestamp)) AS t,
  any(toString(person.properties.email)) AS em
FROM events
WHERE timestamp >= toDateTime('${A2_FROM_UTC}')
  AND timestamp < now()
  AND event = '${A2_EVENT}'
  AND person_id NOT IN COHORT 257060
  AND NOT (coalesce(toString(person.properties.email), '') ILIKE '%mutiny%')
  AND NOT (coalesce(toString(person.properties.email), '') ILIKE '%@gomomentic.com')
GROUP BY uid, co
ORDER BY t
LIMIT 100000`;
export function buildA2(rows, pulledAt = new Date().toISOString()) {
  // rows: [uid, co, t, em]
  const a2 = rows
    .filter((r) => r[0] && !INTERNAL_EMAIL_RX.test(r[3] || '') && !/mutiny/i.test(r[3] || ''))
    .map(([uid, co, t]) => ({ uid, co: co && !/^(null|\(null\))$/.test(co) ? co : null, t: iso(t) }));
  return { source: `PostHog project ${PROJECT}, ${A2_EVENT}`, event: A2_EVENT, pulledAt, fromUtc: `${A2_FROM_UTC.replace(' ', 'T')}Z`, a2 };
}
function writeA2(out) {
  mkdirSync(JOINS_OUT_DIR, { recursive: true });
  writeFileSync(A2_OUT, `${JSON.stringify(out)}\n`);
  console.log(`pull-posthog: ${out.a2.length} ${A2_EVENT} rows since ${out.fromUtc} → ${A2_OUT}`);
}

// --- Completed onboarding = PostHog steps (Nick, Oct 26) ---------------------
// Completed onboarding = Gmail connected + Calendar connected + Recorder signed
// in, with the SAME events as the New onboarding card (PH_ONB_STEPS):
//   em   [Activation] Integration Connected, toolkit = gmail (confirmed)
//   cal  [Activation] Integration Connected, toolkit = google_calendar (confirmed)
//   rec  [Recorder] Signed In
// For every user (creators and joiners), first time per user + workspace.
// Integration Connected starts Aug 31, 2026; Recorder Signed In Oct 20, 2026.
// ingest-signups / build-posthog-signups put them on signup rows as
// phEm / phCal / phRec (Pacific days). → data/posthog/onb_events.json (gitignored).
const ONB_OUT = `${JOINS_OUT_DIR}/onb_events.json`;
const ONB_FROM_UTC = '2026-08-31 00:00:00'; // first Integration Connected
export const ONB_QUERY = `SELECT
  multiIf(event = '[Recorder] Signed In', 'rec', event = '[Recorder] Permissions Granted', 'perms', toString(properties.toolkit) = 'gmail', 'em', 'cal') AS k,
  ${UID_EXPR} AS uid,
  toString(properties.company_id) AS co,
  toString(min(timestamp)) AS t,
  any(toString(person.properties.email)) AS em
FROM events
WHERE timestamp >= toDateTime('${ONB_FROM_UTC}')
  AND timestamp < now()
  AND (event IN ('[Recorder] Signed In', '[Recorder] Permissions Granted')
    OR (event = '[Activation] Integration Connected' AND toString(properties.toolkit) IN ('gmail', 'google_calendar')))
  AND person_id NOT IN COHORT 257060
  AND NOT (coalesce(toString(person.properties.email), '') ILIKE '%mutiny%')
  AND NOT (coalesce(toString(person.properties.email), '') ILIKE '%@gomomentic.com')
GROUP BY k, uid, co
ORDER BY t
LIMIT 100000`;
export function buildOnb(rows, pulledAt = new Date().toISOString()) {
  // rows: [k, uid, co, t, em]
  const steps = rows
    .filter((r) => ['em', 'cal', 'rec', 'perms'].includes(r[0]) && r[1] && !INTERNAL_EMAIL_RX.test(r[4] || '') && !/mutiny/i.test(r[4] || ''))
    .map(([k, uid, co, t]) => ({ k, uid, co: co && !/^(null|\(null\))$/.test(co) ? co : null, t: iso(t) }));
  const firstOfK = (k) => steps.filter((x) => x.k === k).map((x) => x.t).sort()[0] || null;
  return { source: `PostHog project ${PROJECT}, onboarding steps`, pulledAt, fromUtc: `${ONB_FROM_UTC.replace(' ', 'T')}Z`, first: { em: firstOfK('em'), cal: firstOfK('cal'), rec: firstOfK('rec'), perms: firstOfK('perms') }, steps };
}
function writeOnb(out) {
  mkdirSync(JOINS_OUT_DIR, { recursive: true });
  writeFileSync(ONB_OUT, `${JSON.stringify(out)}\n`);
  const n = out.steps.reduce((m, x) => ({ ...m, [x.k]: (m[x.k] || 0) + 1 }), {});
  console.log(`pull-posthog: ${out.steps.length} onboarding step rows since ${out.fromUtc} → ${ONB_OUT}`, n);
}

// --- A1 activation (Nick, Oct 26) ---------------------------------------------
// A1 = [Onboarding] A1 Magic Moment (first asset published / exported / email
// saved to inbox; live Oct 23) OR the older [Onboarding] First Action Completed
// (so Oct 21–23 isn't lost) — same as the New onboarding card's A1. Fires for
// ANY user (existing ones too). ingest-signups / build-posthog-signups put it on
// the matching signup row as s.a1 (Pacific day). → data/posthog/a1_events.json.
const A1_EVENTS = ['[Onboarding] A1 Magic Moment', '[Onboarding] First Action Completed'];
const A1_OUT = `${JOINS_OUT_DIR}/a1_events.json`;
export const A1_QUERY = `SELECT
  ${UID_EXPR} AS uid,
  toString(properties.company_id) AS co,
  toString(min(timestamp)) AS t,
  any(toString(person.properties.email)) AS em
FROM events
WHERE timestamp >= toDateTime('${A2_FROM_UTC}')
  AND timestamp < now()
  AND event IN (${A1_EVENTS.map((e) => `'${e}'`).join(', ')})
  AND person_id NOT IN COHORT 257060
  AND NOT (coalesce(toString(person.properties.email), '') ILIKE '%mutiny%')
  AND NOT (coalesce(toString(person.properties.email), '') ILIKE '%@gomomentic.com')
GROUP BY uid, co
ORDER BY t
LIMIT 100000`;
export function buildA1(rows, pulledAt = new Date().toISOString()) {
  const a1 = rows
    .filter((r) => r[0] && !INTERNAL_EMAIL_RX.test(r[3] || '') && !/mutiny/i.test(r[3] || ''))
    .map(([uid, co, t]) => ({ uid, co: co && !/^(null|\(null\))$/.test(co) ? co : null, t: iso(t) }));
  return { source: `PostHog project ${PROJECT}, ${A1_EVENTS.join(' OR ')}`, events: A1_EVENTS, pulledAt, fromUtc: `${A2_FROM_UTC.replace(' ', 'T')}Z`, a1 };
}
function writeA1(out) {
  mkdirSync(JOINS_OUT_DIR, { recursive: true });
  writeFileSync(A1_OUT, `${JSON.stringify(out)}\n`);
  console.log(`pull-posthog: ${out.a1.length} A1 rows since ${out.fromUtc} → ${A1_OUT}`);
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
  // Seed / offline: --signups-from-file rows.json ({ results: [[k, uid, co, v, t, em], ...], pulledAt })
  const sigArg = process.argv.indexOf('--signups-from-file');
  if (sigArg > -1) {
    const saved = JSON.parse(readFileSync(process.argv[sigArg + 1], 'utf8'));
    writeSignupEvents(buildSignupEvents(saved.results, saved.pulledAt));
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
      const s = await hogql(SIGNUP_EVENTS_QUERY, 'growth-dashboard: signups from PostHog');
      writeSignupEvents(buildSignupEvents(s.results));
    } catch (e) {
      console.error(`pull-posthog: signup events — ${e.message} (keeping the previous ${SIGNUPS_OUT})`);
      failed = true;
    }
    try {
      const a1 = await hogql(A1_QUERY, 'growth-dashboard: A1 activation');
      writeA1(buildA1(a1.results));
    } catch (e) {
      console.error(`pull-posthog: A1 — ${e.message} (keeping the previous ${A1_OUT})`);
      failed = true;
    }
    try {
      const a = await hogql(A2_QUERY, 'growth-dashboard: activated (A2)');
      writeA2(buildA2(a.results));
    } catch (e) {
      console.error(`pull-posthog: A2 activated — ${e.message} (keeping the previous ${A2_OUT})`);
      failed = true;
    }
    try {
      const o = await hogql(ONB_QUERY, 'growth-dashboard: completed onboarding steps');
      writeOnb(buildOnb(o.results));
    } catch (e) {
      console.error(`pull-posthog: onboarding steps — ${e.message} (keeping the previous ${ONB_OUT})`);
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
