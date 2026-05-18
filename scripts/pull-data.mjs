#!/usr/bin/env node
// Pulls live GA4, Amplitude, and HubSpot data into src/data.json. The
// dashboard imports that JSON at build time — no runtime API calls.
//
// Local development:
//   cp .env.example .env.local && edit .env.local
//   npm run pull-data
//
// CI (GitHub Actions): set the same env vars as repo Secrets.
//
// Dry-run / offline: node scripts/pull-data.mjs --input data/sample.json

import { writeFileSync, readFileSync, mkdirSync, existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';

// --- Tiny inline dotenv loader (no extra dep) ------------------------------
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

// --- Config ----------------------------------------------------------------
const GA4_CSV_DIR    = process.env.GA4_CSV_DIR || 'data';
const HUBSPOT_TOKEN  = process.env.HUBSPOT_PRIVATE_APP_TOKEN;
const AMP_KEY        = process.env.AMPLITUDE_API_KEY;
const AMP_SECRET     = process.env.AMPLITUDE_SECRET;
const PEEC_API_KEY   = process.env.PEEC_API_KEY;
const PEEC_API_BASE  = process.env.PEEC_API_BASE || 'https://app.peec.ai/api/v1';
const PEEC_PROJECT_ID = process.env.PEEC_PROJECT_ID || 'or_0887d1ed-129a-4dcd-a14c-d5fd9905d06c';
const PEEC_MUTINY_BRAND_ID = process.env.PEEC_MUTINY_BRAND_ID || 'kw_7af93fc0-d981-4f63-86d5-0fc3348809b3';
// Window covers BOTH the YTD-view need (Jan 1 of the current year → today)
// AND the "vs prior 30d" delta need (60 days back, Monday-aligned). Pulls
// whichever is earlier so both views have data. In practice, after a couple
// months into the year, Jan 1 is always earlier than the 60-day floor.
//
// Override via WINDOW_START / WINDOW_END for backfill or QA.
// (Peec keeps its own window — its data doesn't go back as far.)
function isoMinus60() {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 60);
  return d.toISOString().slice(0, 10);
}
function isoYearStart() {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), 0, 1)).toISOString().slice(0, 10);
}
function mondayOfISO(isoDate) {
  // isoDate: 'YYYY-MM-DD'. Returns the Mon of the Mon-Sun week containing it.
  const d = new Date(isoDate + 'T00:00:00Z');
  const dow = d.getUTCDay(); // 0=Sun, 1=Mon, ..., 6=Sat
  const delta = dow === 0 ? -6 : 1 - dow;
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}
const PEEC_WINDOW_START = process.env.PEEC_WINDOW_START || '2026-04-23';
const _defaultWindowStart = (() => {
  const minus60Mon = mondayOfISO(isoMinus60());
  const yearStart  = isoYearStart();
  return minus60Mon < yearStart ? minus60Mon : yearStart;
})();
const WINDOW_START   = process.env.WINDOW_START || _defaultWindowStart;
const WINDOW_END     = process.env.WINDOW_END   || new Date().toISOString().slice(0, 10);
const OUT_PATH       = 'src/data.json';

// --input <file> reads from a local JSON instead of hitting the network.
const inputIdx  = process.argv.indexOf('--input');
const inputPath = inputIdx >= 0 ? process.argv[inputIdx + 1] : null;

const log = (...a) => console.log('[pull-data]', ...a);
const err = (...a) => console.error('[pull-data]', ...a);

// ===========================================================================
// GA4 — manual CSV ingest from data/. Workflow: export the three free-form
// reports from GA4, drop the CSVs into data/. Filenames don't matter —
// the script identifies each report by filename pattern OR by sniffing the
// header row, whichever matches first. The most recent file per report
// (by mtime) wins.
//
// Report identification:
//   File 1 — daily Date + metrics, no channel column
//   File 2 — Date + channel + source/medium, only "Event count" metric
//   File 3 — Date + channel + source/medium + Event count + Engaged sessions
//            + Sessions + Total users
// ===========================================================================
const DATE_RX = /^\d{8}$/;

const FILENAME_PATTERNS = {
  file1: /engaged_sessions_by_date/i,
  file2: /signup_events_by_channel/i,
  file3: /all_engaged_sessions_by_channel/i,
};

// Sniff a CSV's header row to classify which GA4 report it is. Returns
// 'file1' | 'file2' | 'file3' | null. Case-insensitive on column names so
// a future GA4 capitalization tweak doesn't break things.
//
// We accept either the stock "Session default channel group" or our custom
// "Session Mutiny - With AI Referrals" channel group dimension. The Mutiny
// custom group is the same as default but adds an "AI Referrals" bucket
// (chatgpt.com / claude.ai / perplexity.ai / gemini / etc).
function sniffGA4Report(filepath) {
  const lines = readFileSync(filepath, 'utf8').split('\n');
  let headerCells = null;
  for (const line of lines) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const cells = t.split(',').map((c) => c.trim().toLowerCase());
    if (cells[0] === 'date') { headerCells = cells; break; }
  }
  if (!headerCells) return null;

  const hasChannel =
    headerCells.includes('session default channel group') ||
    headerCells.includes('session mutiny - with ai referrals') ||
    headerCells.includes('sessionprimarychannelgroup');  // GA4 Data API field name (Apps Script export)
  const hasEngaged =
    headerCells.includes('engaged sessions') ||
    headerCells.includes('engagedsessions');

  if (!hasChannel) return 'file1';      // Date + metrics only, no channel
  if (!hasEngaged) return 'file2';      // Date + channel, eventCount only
  return 'file3';                        // Date + channel + full metric set
}

// Walk data/, classify each CSV by filename pattern first, content sniff
// second. Pick the most recent file (by mtime) per report category.
function findGA4Files() {
  const result = { file1: null, file2: null, file3: null, unknown: [], log: [] };
  if (!existsSync(GA4_CSV_DIR)) return result;

  const allCsvs = readdirSync(GA4_CSV_DIR)
    .filter((f) => f.toLowerCase().endsWith('.csv'))
    .map((name) => {
      const path = join(GA4_CSV_DIR, name);
      return { name, path, mtime: statSync(path).mtimeMs };
    });

  const byCategory = { file1: [], file2: [], file3: [] };

  for (const f of allCsvs) {
    let category = null;
    let how = '';

    // Try filename patterns first (cheap, predictable).
    for (const [cat, rx] of Object.entries(FILENAME_PATTERNS)) {
      if (rx.test(f.name)) { category = cat; how = 'filename'; break; }
    }

    // Fall back to content sniff for ambiguous / generic-named files.
    if (!category) {
      try {
        category = sniffGA4Report(f.path);
        if (category) how = 'sniffed';
      } catch { category = null; }
    }

    if (category) {
      byCategory[category].push(f);
      result.log.push(`  ${f.name} → ${category} (${how})`);
    } else if (/ga4/i.test(f.name)) {
      // Only warn about unclassified files that *look* like GA4 exports
      // (name contains "ga4"). Other CSVs in data/ are silently ignored.
      result.unknown.push(f);
    }
  }

  for (const cat of ['file1', 'file2', 'file3']) {
    if (byCategory[cat].length === 0) continue;
    byCategory[cat].sort((a, b) => b.mtime - a.mtime);
    result[cat] = byCategory[cat][0];
  }
  return result;
}

function parseGA4Csv(filepath, mapRow) {
  const lines = readFileSync(filepath, 'utf8').split('\n');
  const out = [];
  for (const line of lines) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const fields = t.split(',');
    if (!DATE_RX.test(fields[0])) continue;  // skips headers + Grand-total rows
    out.push(mapRow(fields));
  }
  return out;
}

async function fetchGA4() {
  log(`Reading GA4 CSVs from ${GA4_CSV_DIR}/...`);

  const found = findGA4Files();
  for (const line of found.log) log(line);
  for (const u of found.unknown) {
    err(`  WARN: ${u.name} didn't match any GA4 report shape — ignoring.`);
  }

  const missing = [];
  if (!found.file1) missing.push('engaged_sessions_by_date');
  if (!found.file2) missing.push('signup_events_by_channel');
  if (!found.file3) missing.push('all_engaged_sessions_by_channel');
  if (missing.length) {
    throw new Error(`Missing GA4 CSV(s) in ${GA4_CSV_DIR}/: ${missing.join(', ')}. Export the free-form reports from GA4 and drop them in.`);
  }

  const file1Csv = found.file1;
  const file2Csv = found.file2;
  const file3Csv = found.file3;

  // File 1: Date, Total users, Engaged sessions, Sessions (4 cols, stable).
  const file1 = parseGA4Csv(file1Csv.path, (f) => ({
    date:            f[0],
    totalUsers:      Number(f[1]) || 0,
    engagedSessions: Number(f[2]) || 0,
    sessions:        Number(f[3]) || 0,
  }));

  // File 2: Date, Channel, Source/Medium, [N week-bucket counts...], Total.
  // The last numeric column is the Total event count — works whether GA4
  // bucketed the export into 1 week, 2 weeks, or 12 weeks.
  const file2 = parseGA4Csv(file2Csv.path, (f) => ({
    date:         f[0],
    channelGroup: f[1],
    sourceMedium: f[2],
    eventCount:   Number(f[f.length - 1]) || 0,
  }));

  // File 3: Date, Channel, Source/Medium, Event count, Engaged sessions,
  // Sessions, Total users (7 cols, stable).
  const file3 = parseGA4Csv(file3Csv.path, (f) => ({
    date:            f[0],
    channelGroup:    f[1],
    sourceMedium:    f[2],
    eventCount:      Number(f[3]) || 0,
    engagedSessions: Number(f[4]) || 0,
    sessions:        Number(f[5]) || 0,
    totalUsers:      Number(f[6]) || 0,
  }));

  if (file1.length === 0) throw new Error(`GA4 file1 (${file1Csv.name}) had zero data rows.`);
  log(`  GA4 ok (CSVs): file1=${file1.length} rows (${file1Csv.name}), file2=${file2.length} (${file2Csv.name}), file3=${file3.length} (${file3Csv.name}).`);
  return { pulledAt: new Date().toISOString(), file1, file2, file3 };
}

// ===========================================================================
// Amplitude — Dashboard REST API event segmentation
// Docs: https://www.docs.developers.amplitude.com/analytics/apis/dashboard-rest-api/
// ===========================================================================
function ampBasicAuth() {
  return 'Basic ' + Buffer.from(`${AMP_KEY}:${AMP_SECRET}`).toString('base64');
}
function ymdCompact(s)  { return s.replaceAll('-', ''); } // 2026-04-27 → 20260427

async function ampSegmentation({ event, start, end, metric = 'uniques', interval = 1 }) {
  // The Dashboard REST API's top-level `g` param only accepts user properties.
  // For event-property group-by, the group_by descriptor goes INSIDE the
  // event spec's `group_by` array. Pass that via the `event` arg directly.
  const params = new URLSearchParams();
  params.append('e', JSON.stringify(event));
  params.append('start', ymdCompact(start));
  params.append('end', ymdCompact(end));
  params.append('m', metric);
  params.append('i', String(interval));
  const url = `https://amplitude.com/api/2/events/segmentation?${params.toString()}`;
  const res = await fetch(url, { headers: { Authorization: ampBasicAuth() } });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Amplitude HTTP ${res.status}: ${body.slice(0, 400)}`);
  }
  return res.json();
}

async function fetchAmplitude() {
  if (!AMP_KEY || !AMP_SECRET) {
    log('Skipping Amplitude — AMPLITUDE_API_KEY / AMPLITUDE_SECRET not set.');
    return { dailySignups: {}, referralSources: [], pulledAt: null };
  }
  log('Fetching Amplitude (daily signups + referral_source breakdown)...');

  // Both queries share the same event spec + email filter.
  const eventSpec = {
    event_type: '[Onboarding] Company Setup Complete',
    filters: [
      { group_type: 'User', subprop_op: 'does not contain', subprop_key: 'email', subprop_type: 'event', subprop_value: ['mutiny'] },
    ],
  };

  // 1) Daily uniques (no group_by) — covers the Signups KPI + weekly trend.
  const daily = await ampSegmentation({ event: eventSpec, start: WINDOW_START, end: WINDOW_END });

  // Parse Amplitude response. Daily uniques live in data.series[0] aligned
  // with data.xValues (dates).
  const series = daily?.data?.series?.[0] ?? [];
  const xValues = daily?.data?.xValues ?? [];
  const dailySignups = {};
  for (let i = 0; i < xValues.length; i++) {
    dailySignups[ymdCompact(xValues[i])] = Number(series[i]) || 0;
  }

  // 2) Per-referral_source breakdown — same window + filter, plus the
  // "referral_source is not (none)" filter, plus an event-level group_by.
  // The group_by descriptor for an event property lives INSIDE the event
  // spec (under `group_by`), not in the top-level `g` query param.
  const eventWithRefFilter = {
    event_type: '[Onboarding] Company Setup Complete',
    filters: [
      { subprop_op: 'does not contain', subprop_key: 'email',           subprop_type: 'event', subprop_value: ['mutiny'] },
      { subprop_op: 'is not',           subprop_key: 'referral_source', subprop_type: 'event', subprop_value: ['(none)'] },
    ],
    group_by: [{ type: 'event', value: 'referral_source' }],
  };
  const ref = await ampSegmentation({
    event: eventWithRefFilter,
    start: WINDOW_START,
    end:   WINDOW_END,
  });

  // Per-group totals live in data.seriesLabels (the referral_source values)
  // and data.series (parallel arrays of per-interval counts). data.xValues
  // is the date axis. We now keep the per-day breakdown so the JSX can slice
  // the pie by an arbitrary window (Last 30 days vs Last 4 complete weeks).
  //
  // Label shape from Amplitude's REST API: `[event_index, group_value]` —
  // e.g. [0, "google"]. The `event_index` is 0 for our single-event query.
  // We want the last STRING element of the label array; using the first
  // non-"referral_source" element wrongly catches the numeric 0.
  const refLabels = ref?.data?.seriesLabels ?? [];
  const refSeries = ref?.data?.series ?? [];
  const refXValues = ref?.data?.xValues ?? [];
  const extractLabel = (label) => {
    if (typeof label === 'string') return label;
    if (Array.isArray(label)) {
      const stringParts = label.flat().filter((x) => typeof x === 'string' && x !== 'referral_source');
      return stringParts[stringParts.length - 1] ?? String(label);
    }
    return String(label);
  };
  // Output shape: [{ source, count (total over window), daily: { 'YYYYMMDD': n } }]
  // The total `count` is kept for backward compatibility and convenience;
  // the JSX can use `daily` to recompute totals over any sub-window.
  const referralSources = refLabels.map((label, i) => {
    const src = extractLabel(label);
    const series = refSeries[i] || [];
    const daily = {};
    let count = 0;
    for (let j = 0; j < refXValues.length; j++) {
      const n = Number(series[j]) || 0;
      const dateKey = ymdCompact(refXValues[j]);
      daily[dateKey] = n;
      count += n;
    }
    return { source: src, count, daily };
  }).filter((r) => r.count > 0);

  log(`  Amplitude ok: ${Object.values(dailySignups).reduce((a,b)=>a+b,0)} daily-signups across ${Object.keys(dailySignups).length} days, ${referralSources.length} unique referral_source values.`);
  return { dailySignups, referralSources, pulledAt: new Date().toISOString() };
}

// ===========================================================================
// HubSpot — Talk to Sales form submissions, contact-property based
// Docs: https://developers.hubspot.com/docs/api/crm/contacts
// ===========================================================================
async function fetchHubspot() {
  if (!HUBSPOT_TOKEN) {
    log('Skipping HubSpot — HUBSPOT_PRIVATE_APP_TOKEN not set.');
    return { meetings: [], pulledAt: null };
  }
  log('Fetching HubSpot (Talk to Sales contacts)...');

  const body = {
    filterGroups: [
      { filters: [
        { propertyName: 'how_did_you_discover_mutiny',     operator: 'HAS_PROPERTY' },
        { propertyName: 'recent_conversion_event_name',    operator: 'CONTAINS_TOKEN', value: 'Talk to Sales' },
      ]},
      { filters: [
        { propertyName: 'how_did_you_discover_mutiny',     operator: 'HAS_PROPERTY' },
        { propertyName: 'first_conversion_event_name',     operator: 'CONTAINS_TOKEN', value: 'Talk to Sales' },
      ]},
    ],
    properties: [
      'email', 'company',
      'how_did_you_discover_mutiny',
      'first_conversion_event_name', 'first_conversion_date',
      'recent_conversion_event_name', 'recent_conversion_date',
      'createdate',
    ],
    limit: 100,
  };

  const res = await fetch('https://api.hubapi.com/crm/v3/objects/contacts/search', {
    method: 'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${HUBSPOT_TOKEN}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`HubSpot HTTP ${res.status}: ${t.slice(0, 200)}`);
  }
  const raw = await res.json();
  const contacts = raw.results || [];

  // Apply filtering: test exclusions, submission-date rule, window check.
  const startCompact = ymdCompact(WINDOW_START);
  const endCompact   = ymdCompact(WINDOW_END);
  const isoToCompact = (iso) => (iso || '').slice(0, 10).replaceAll('-', '');

  const TEST_EMAIL_RX = /mutiny|kedwardsfake/i;

  const meetings = [];
  for (const c of contacts) {
    const p = c.properties || {};
    if (TEST_EMAIL_RX.test(p.email || '')) continue;

    // Submission-date rule (corrected — see CONTEXT.md):
    //   recent contains "Talk to Sales" → use recent_conversion_date
    //   else                            → use first_conversion_date
    const recentIsTtS = String(p.recent_conversion_event_name || '').includes('Talk to Sales');
    const isoDate = recentIsTtS ? p.recent_conversion_date : p.first_conversion_date;
    if (!isoDate) continue;
    const compact = isoToCompact(isoDate);
    if (compact < startCompact || compact > endCompact) continue;

    meetings.push({
      date:           compact,
      email:          p.email || '',
      company:        p.company || '',
      referralSource: p.how_did_you_discover_mutiny || '',
    });
  }
  log(`  HubSpot ok: ${contacts.length} raw contacts → ${meetings.length} valid meetings in window.`);
  return { meetings, pulledAt: new Date().toISOString() };
}

// ===========================================================================
// Peec AI — manual JSON ingest from data/peec.json. Peec's REST API surface
// isn't designed for headless use (every guess at the public endpoint returns
// 404, and the only authenticated path is via the in-app session). Mirror
// of the GA4 pattern: refresh data/peec.json periodically via the Peec MCP
// (or hand-build it from the Peec UI), then `npm run pull-data` ingests it.
//
// Shape that data/peec.json must produce — same as the live fetcher returned:
//   { pulledAt, windowStart, windowEnd, visibility, mentionCount, avgPosition,
//     competitorRank, competitorTotal, topCompetitor, topics: [...], daily: [...] }
// ===========================================================================
const PEEC_JSON_PATH = process.env.PEEC_JSON_PATH || 'data/peec.json';

async function fetchPeec() {
  if (!existsSync(PEEC_JSON_PATH)) {
    log(`Skipping Peec — ${PEEC_JSON_PATH} not found. Refresh it via the Peec MCP.`);
    return { error: 'no peec snapshot', pulledAt: null };
  }
  log(`Reading Peec snapshot from ${PEEC_JSON_PATH}...`);
  const raw = JSON.parse(readFileSync(PEEC_JSON_PATH, 'utf8'));
  log(`  Peec ok (snapshot): visibility=${raw.visibility}, rank=${raw.competitorRank}/${raw.competitorTotal}, topics=${(raw.topics || []).length}, daily=${(raw.daily || []).length} days, pulledAt=${raw.pulledAt}.`);
  return raw;
}


// ===========================================================================
// Orchestrate
// ===========================================================================
let payload;
if (inputPath) {
  log(`Reading from local file: ${inputPath}`);
  payload = JSON.parse(readFileSync(inputPath, 'utf8'));
} else {
  // Run all four in parallel. If any single source fails, surface the error
  // but write what we got — partial data is better than a stale build that
  // silently masks a broken pipeline. The dashboard's "Last updated" line
  // will reflect the most recent successful pulledAt.
  const [ga4Result, amplitudeResult, hubspotResult, peecResult] = await Promise.allSettled([
    fetchGA4(),
    fetchAmplitude(),
    fetchHubspot(),
    fetchPeec(),
  ]);

  const fail = [];
  if (ga4Result.status       === 'rejected') fail.push(`GA4: ${ga4Result.reason.message}`);
  if (amplitudeResult.status === 'rejected') fail.push(`Amplitude: ${amplitudeResult.reason.message}`);
  if (hubspotResult.status   === 'rejected') fail.push(`HubSpot: ${hubspotResult.reason.message}`);
  if (peecResult.status      === 'rejected') fail.push(`Peec: ${peecResult.reason.message}`);

  // Preserve previous data on fetch failure (don't clobber good data with
  // empty fallbacks just because a single source had a transient error).
  // Read the existing src/data.json if it exists.
  let prev = {};
  if (existsSync(OUT_PATH)) {
    try { prev = JSON.parse(readFileSync(OUT_PATH, 'utf8')); }
    catch { prev = {}; }
  }
  const preserve = (name, fallbackEmpty) => {
    const prior = prev[name];
    if (prior && !prior.error) return { ...prior, _staleFromPrevRun: true };
    return fallbackEmpty;
  };

  payload = {
    pulledAt: new Date().toISOString(),
    window:   { start: WINDOW_START, end: WINDOW_END },
    ga4:       ga4Result.status       === 'fulfilled' ? ga4Result.value       : preserve('ga4',       { file1: [], file2: [], file3: [], error: ga4Result.reason?.message }),
    amplitude: amplitudeResult.status === 'fulfilled' ? amplitudeResult.value : preserve('amplitude', { dailySignups: {}, referralSources: [], error: amplitudeResult.reason?.message }),
    hubspot:   hubspotResult.status   === 'fulfilled' ? hubspotResult.value   : preserve('hubspot',   { meetings: [], error: hubspotResult.reason?.message }),
    peec:      peecResult.status      === 'fulfilled' ? peecResult.value      : preserve('peec',      { error: peecResult.reason?.message }),
  };

  if (fail.length) {
    err('Some sources failed:');
    for (const f of fail) err(`  - ${f}`);
    // Hard fail only if GA4 dies — that's the only one the dashboard fully
    // depends on right now. Amplitude/HubSpot have manual-snapshot fallbacks
    // baked into the JSX during the transition.
    if (ga4Result.status === 'rejected') {
      err('Aborting — GA4 is the only required source.');
      process.exit(1);
    }
  }
}

mkdirSync(dirname(OUT_PATH), { recursive: true });
writeFileSync(OUT_PATH, JSON.stringify(payload, null, 2));
log(`Wrote ${OUT_PATH} — window=${payload.window?.start}..${payload.window?.end}, pulledAt=${payload.pulledAt}`);
