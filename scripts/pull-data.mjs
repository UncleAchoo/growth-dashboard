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

// --logos-only refreshes ONLY hubspot.logos in src/data.json (revenue repo →
// HubSpot proxy), leaving GA4 / Amplitude / HubSpot meetings / Peec untouched.
// Used by the scheduled "refresh logos" workflow so CI doesn't need every
// source's API keys.
const logosOnly = process.argv.includes('--logos-only');

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

  // Email filter — excludes internal users. Mirrors the Amplitude charts:
  // `email does not contain "mutinyhq" or "mutiny"`. "mutinyhq" is redundant
  // with "mutiny" as a substring match, but listing both keeps our pull a
  // literal mirror of the chart's filter config.
  const emailFilter = { group_type: 'User', subprop_op: 'does not contain', subprop_key: 'email', subprop_type: 'event', subprop_value: ['mutinyhq', 'mutiny'] };

  // 1) Daily SIGNUPS — COMPLETED signups. A "signup" = a unique user who
  // finished onboarding by firing [Onboarding] User Setup Complete (the step
  // both onboarding paths — create-an-org and accept-an-invite — converge on,
  // i.e. they actually made it into the app). Single event, metric=uniques.
  // NOTE: this event only began firing ~Feb 16, 2026; earlier dates are zero.
  const eventSpec = {
    event_type: '[Onboarding] User Setup Complete',
    filters: [emailFilter],
  };

  // Covers the Signups KPI + weekly/monthly trend everywhere on the dashboard.
  const daily = await ampSegmentation({ event: eventSpec, start: WINDOW_START, end: WINDOW_END });

  // Parse Amplitude response. Daily uniques live in data.series[0] aligned
  // with data.xValues (dates).
  const series = daily?.data?.series?.[0] ?? [];
  const xValues = daily?.data?.xValues ?? [];
  if (xValues.length === 0) {
    throw new Error('Amplitude daily signups (User Setup Complete) returned no data — preserving last-known-good dailySignups.');
  }
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
      { subprop_op: 'does not contain', subprop_key: 'email',           subprop_type: 'event', subprop_value: ['mutinyhq', 'mutiny'] },
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

  // ---- Deduplicated totals (amplitude.dedup) ----------------------------
  // The deduped headline KPI, per-bar totals, and cumulative-signups line read
  // from `amplitude.dedup` (true unique-user counts of the 4-event union at
  // period + window granularity, plus a cumulative-unique daily series).
  // These canNOT be reproduced through the Dashboard REST API: deduped uniques
  // over an arbitrary multi-day range (a calendar month, the 30/60-day KPI
  // windows, the running cumulative line) require single-bucket / cumulative
  // unique queries that REST's fixed 1 / 7 / 30-day intervals can't express.
  // They are generated out-of-band via the Amplitude analytics query API
  // (eventsSegmentation, metric=uniques, isCumulative, on the inline 4-event
  // custom event — see HANDOFF.md "Deduped signups"). We carry forward
  // whatever dedup block already exists in src/data.json so a routine pull
  // doesn't wipe it.
  // NOTE: the period keys are date-anchored ("<firstDate>_<lastDate>"). Once
  // the window rolls to a new day, the dashboard falls back to summed-daily
  // for any bar/window whose range no longer matches — regenerate dedup to
  // restore the deduplicated view.
  let dedup;
  try {
    if (existsSync(OUT_PATH)) {
      const prevData = JSON.parse(readFileSync(OUT_PATH, 'utf8'));
      if (prevData.amplitude?.dedup) {
        dedup = { ...prevData.amplitude.dedup, _staleFromPrevRun: true };
        log('  Amplitude: carried forward existing amplitude.dedup (regenerate via the query API for fresh dedup).');
      }
    }
  } catch { /* no prior dedup to preserve */ }

  log(`  Amplitude ok: ${Object.values(dailySignups).reduce((a,b)=>a+b,0)} daily-signups across ${Object.keys(dailySignups).length} days, ${referralSources.length} unique referral_source values.`);
  return { dailySignups, referralSources, ...(dedup ? { dedup } : {}), pulledAt: new Date().toISOString() };
}

// ===========================================================================
// HubSpot — Active-logos series (powers the "Cumulative active logos" chart).
//
// OFF by default. The methodologically-correct series is baked into
// src/data.json (built once from the HubSpot revenue connector) and preserved
// across refreshes. Computing it LIVE here needs `crm.objects.companies.read`
// + `crm.objects.deals.read` scopes on the private-app token AND enterprise
// closedate anchoring via each company's associated closed-won deals. Once the
// token has those scopes and you've validated the output against the revenue
// dashboard's `total_active_logos`, set PULL_LOGOS=1 to enable.
//
// Segmentation reconciles to the revenue dashboard's `total_active_logos`
// (currently 116 = 107 PLG + 9 Enterprise):
//   • PLG paying = HubSpot proxy for the canonical Stripe MRR>0 count —
//       mutiny_app_plan in (business, free) AND monthly_payment_amount > 0 AND
//       active_mutiny_account=true AND seats_purchased set AND domain != niche.com,
//       anchored by subscription_start_date. (This dashboard has no Stripe
//       connector; the proxy currently equals the canonical 107 exactly.)
//   • Enterprise = HubSpot List 5010 "Current Enterprise Customers" —
//       active_mutiny_account=true AND mutiny_app_plan=enterprise AND
//       monthly_payment set AND start_date > 2026-02-01 AND domain != niche.com,
//       anchored by the most-recent closed-won deal closedate.
// Disjoint populations (enterprise excluded from PLG via the plan filter), so
// no double counting. Grid = Sunday-ending weeks from the week-ending on/before
// STRIPE_HISTORY_START through now (final partial week instant = now). Each
// week = count of logos whose anchor <= that instant. Last point = total.
// ===========================================================================
const STRIPE_HISTORY_START = process.env.STRIPE_HISTORY_START || '2026-03-26';
// week-ending Sunday on or before an ISO date (UTC)
function logosSundayOnOrBefore(iso) {
  const d = new Date(iso.slice(0, 10) + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() - d.getUTCDay()); // 0=Sun
  return d.toISOString().slice(0, 10);
}
function logosAddDaysISO(iso, n) {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
async function hsCompanySearchAll(filterGroups, properties) {
  const out = [];
  let after;
  do {
    const body = { filterGroups, properties, limit: 100 };
    if (after) body.after = after;
    const res = await fetch('https://api.hubapi.com/crm/v3/objects/companies/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${HUBSPOT_TOKEN}` },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const t = await res.text();
      throw new Error(`HubSpot companies search HTTP ${res.status}: ${t.slice(0, 200)}`);
    }
    const j = await res.json();
    out.push(...(j.results || []));
    after = j.paging?.next?.after;
  } while (after);
  return out;
}
async function hsMostRecentClosedWon(companyId) {
  const r = await fetch(`https://api.hubapi.com/crm/v4/objects/companies/${companyId}/associations/deals`, {
    headers: { 'Authorization': `Bearer ${HUBSPOT_TOKEN}` },
  });
  if (!r.ok) return null;
  const ids = ((await r.json()).results || []).map((x) => x.toObjectId).filter(Boolean);
  if (!ids.length) return null;
  const br = await fetch('https://api.hubapi.com/crm/v3/objects/deals/batch/read', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${HUBSPOT_TOKEN}` },
    body: JSON.stringify({ properties: ['closedate', 'hs_is_closed_won'], inputs: ids.map((id) => ({ id })) }),
  });
  if (!br.ok) return null;
  let max = null;
  for (const d of ((await br.json()).results || [])) {
    const p = d.properties || {};
    if (p.hs_is_closed_won === 'true' && p.closedate && (!max || p.closedate > max)) max = p.closedate;
  }
  return max;
}
// ---------------------------------------------------------------------------
// PREFERRED SOURCE — single source of truth. When LOGOS_SOURCE=revenue-repo,
// read the already-computed logos series straight from the private revenue
// dashboard repo (it commits dashboard_data.json on each refresh) via the
// GitHub Contents API. This guarantees the growth dashboard shows the exact
// same Total active logos the revenue dashboard does, with zero duplicated
// Stripe/HubSpot logic. Falls through to the HubSpot proxy (fetchHubspotLogos)
// and then to the baked/prior series if the token is absent or the fetch fails.
//
// Required env (set as CI secrets / .env.local):
//   LOGOS_SOURCE=revenue-repo         ← opt in
//   REVENUE_REPO_TOKEN=<fine-grained PAT, read-only Contents on the repo>
// Optional overrides (defaults shown):
//   REVENUE_REPO=UncleAchoo/hubspot-revenue-dashboard
//   REVENUE_LOGOS_PATH=dashboard_data.json
//   REVENUE_REPO_REF=main
// ---------------------------------------------------------------------------
async function fetchLogosFromRevenueRepo() {
  if (process.env.LOGOS_SOURCE !== 'revenue-repo') return null;

  const repo = process.env.REVENUE_REPO || 'UncleAchoo/revenue-dashboard-official';
  const path = process.env.REVENUE_LOGOS_PATH || 'stripe_data.json';
  const ref  = process.env.REVENUE_REPO_REF || 'main';

  // Local-test escape hatch: point REVENUE_LOGOS_FIXTURE at a downloaded copy
  // of stripe_data.json to exercise this path with no token / no network.
  const fixture = process.env.REVENUE_LOGOS_FIXTURE;
  let d;
  if (fixture) {
    log(`Reading revenue logos from local fixture ${fixture}...`);
    d = JSON.parse(readFileSync(fixture, 'utf8'));
  } else {
    const token = process.env.REVENUE_REPO_TOKEN;
    if (!token) {
      err('  LOGOS_SOURCE=revenue-repo but REVENUE_REPO_TOKEN is not set — falling back.');
      return null;
    }
    log(`Fetching logos from revenue repo ${repo}/${path}@${ref}...`);

    const res = await fetch(`https://api.github.com/repos/${repo}/contents/${path}?ref=${ref}`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/vnd.github.raw+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'mutiny-growth-dashboard-pull',
      },
    });
    if (!res.ok) {
      const t = await res.text();
      throw new Error(`GitHub contents HTTP ${res.status}: ${t.slice(0, 200)}`);
    }
    d = JSON.parse(await res.text());
  }

  // Expected shape (revenue dashboard): totals.series.{labels,logos,partial}
  // parallel arrays, with totals.kpis.total_active_logos as the headline.
  const s = d?.totals?.series;
  const labels = s?.labels;
  let logosArr = s?.logos;
  if (!Array.isArray(logosArr) || !logosArr.length) {
    // stripe_data.json predates the persisted `logos` field — recompute it the
    // same way the revenue dashboard's own template fallback does:
    //   logos[i] = series.weekly[i].paying_logos + enterprise.series.logos[i]
    const plgWk = d?.series?.weekly;
    const entLogos = d?.enterprise?.series?.logos;
    if (Array.isArray(labels) && Array.isArray(plgWk)) {
      logosArr = labels.map((_, i) => ((plgWk[i]?.paying_logos) || 0) + ((entLogos && entLogos[i]) || 0));
      log('  revenue series has no totals.series.logos — recomputed from PLG paying_logos + enterprise logos.');
    }
  }
  if (!Array.isArray(labels) || !Array.isArray(logosArr) || !logosArr.length) {
    throw new Error('revenue stripe_data.json has no totals.series.logos and no recomputable PLG/enterprise series — check REVENUE_LOGOS_PATH / shape.');
  }
  const partialArr = Array.isArray(s.partial) ? s.partial : [];
  const weekly = labels.map((l, i) => ({
    week_ending: String(l),
    count: Number(logosArr[i]) || 0,
    partial: !!partialArr[i],
  }));
  const lastCount = weekly[weekly.length - 1].count;
  const kpiTotal = Number(d?.totals?.kpis?.total_active_logos);

  // Reconciliation guard (revenue-side spec, verify #1): the series MUST end at
  // the headline KPI. A mismatch means the revenue export is malformed or our
  // parse drifted from its shape — fail loudly (non-zero exit) so CI goes red
  // and we never patch data.json / deploy a wrong number.
  if (Number.isFinite(kpiTotal) && lastCount !== kpiTotal) {
    err(`  RECONCILIATION FAILED: logos series ends at ${lastCount} but totals.kpis.total_active_logos=${kpiTotal}. Aborting — data.json left untouched.`);
    process.exit(1);
  }
  log(`  Revenue-repo logos ok: total=${lastCount}, weeks=${weekly.length} (reconciles to KPI ${Number.isFinite(kpiTotal) ? kpiTotal : 'n/a'}).`);
  return { total: lastCount, source: 'revenue-repo', repo, path, pulledAt: new Date().toISOString(), weekly };
}

async function fetchHubspotLogos() {
  if (process.env.PULL_LOGOS !== '1') {
    log('Skipping live logos pull (set PULL_LOGOS=1 to enable) — preserving baked active-logos series.');
    return null;
  }
  log('Fetching HubSpot active logos (PLG proxy + Enterprise List 5010)...');
  // PLG paying (Stripe-proxy). Anchor by subscription_start_date.
  const plg = await hsCompanySearchAll(
    [{ filters: [
      { propertyName: 'monthly_payment_amount', operator: 'GT', value: '0' },
      { propertyName: 'active_mutiny_account', operator: 'EQ', value: 'true' },
      { propertyName: 'mutiny_app_plan', operator: 'IN', values: ['business', 'free'] },
      { propertyName: 'seats_purchased', operator: 'HAS_PROPERTY' },
      { propertyName: 'domain', operator: 'NEQ', value: 'niche.com' },
    ] }],
    ['subscription_start_date'],
  );
  // Enterprise = List 5010 definition. Anchor by most-recent closed-won closedate
  // (fallback to start_date when a company has no closed-won deal).
  const ent = await hsCompanySearchAll(
    [{ filters: [
      { propertyName: 'mutiny_app_plan', operator: 'EQ', value: 'enterprise' },
      { propertyName: 'active_mutiny_account', operator: 'EQ', value: 'true' },
      { propertyName: 'monthly_payment', operator: 'HAS_PROPERTY' },
      { propertyName: 'start_date', operator: 'GT', value: '2026-02-01' },
      { propertyName: 'domain', operator: 'NEQ', value: 'niche.com' },
    ] }],
    ['name', 'start_date'],
  );

  const plgAnchors = [];
  for (const c of plg) {
    const s = c.properties?.subscription_start_date;
    if (s) plgAnchors.push(s.slice(0, 10));
  }
  const entAnchors = [];
  for (const c of ent) {
    const cd = await hsMostRecentClosedWon(c.id);
    entAnchors.push((cd || c.properties?.start_date || '').slice(0, 10));
  }
  const plgCount = plgAnchors.length;
  const entCount = entAnchors.filter(Boolean).length;
  if (!plgCount && !entCount) return null;

  // Sunday-ending grid from week-ending on/before STRIPE_HISTORY_START → now.
  const asOf = new Date().toISOString().slice(0, 10);
  const firstSun = logosSundayOnOrBefore(STRIPE_HISTORY_START);
  const lastFullSun = logosSundayOnOrBefore(asOf);
  const countAtOrBefore = (arr, t) => arr.filter((a) => a && a <= t).length;
  const weekly = [];
  for (let s = firstSun; s <= lastFullSun; s = logosAddDaysISO(s, 7)) {
    const p = countAtOrBefore(plgAnchors, s);
    const e = countAtOrBefore(entAnchors, s);
    weekly.push({ week_ending: s, count: p + e, plg_logos: p, enterprise_logos: e, partial: false });
  }
  if (asOf > lastFullSun) {
    const p = countAtOrBefore(plgAnchors, asOf);
    const e = countAtOrBefore(entAnchors, asOf);
    weekly.push({ week_ending: asOf, count: p + e, plg_logos: p, enterprise_logos: e, partial: true });
  }
  const total = weekly[weekly.length - 1]?.count ?? 0;
  log(`  HubSpot logos ok: PLG=${plgCount}, Enterprise=${entCount}, total=${total}, weeks=${weekly.length}.`);
  return {
    total, plg: plgCount, enterprise: entCount,
    method: 'live HubSpot pull (PLG proxy + List 5010 enterprise, closedate-anchored)',
    pulledAt: new Date().toISOString(), weekly,
  };
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

  // Active-logos series. Preference order:
  //   1. revenue repo (single source of truth)  — LOGOS_SOURCE=revenue-repo
  //   2. HubSpot proxy                           — PULL_LOGOS=1
  //   3. baked/prior series                      — carried forward by orchestrator
  // A failure in any of these must not sink the meetings pull.
  let logos = null;
  try {
    logos = await fetchLogosFromRevenueRepo();
  } catch (e) {
    err(`  Revenue-repo logos fetch failed (trying proxy): ${e.message}`);
  }
  if (!logos) {
    try {
      logos = await fetchHubspotLogos();
    } catch (e) {
      err(`  HubSpot logos pull failed (keeping prior series): ${e.message}`);
      logos = null;
    }
  }

  return { meetings, logos, pulledAt: new Date().toISOString() };
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
//     competitorRank, competitorTotal, topCompetitor, topics: [...], daily: [...],
//     sources?: { topDomains: [...], daily: [...] } }  ← optional, feeds the
//   Source Retrievals chart in the AEO Visibility section.
// ===========================================================================
const PEEC_JSON_PATH = process.env.PEEC_JSON_PATH || 'data/peec.json';

async function fetchPeec() {
  if (!existsSync(PEEC_JSON_PATH)) {
    log(`Skipping Peec — ${PEEC_JSON_PATH} not found. Refresh it via the Peec MCP.`);
    return { error: 'no peec snapshot', pulledAt: null };
  }
  log(`Reading Peec snapshot from ${PEEC_JSON_PATH}...`);
  const raw = JSON.parse(readFileSync(PEEC_JSON_PATH, 'utf8'));
  const sourceDomCount = raw.sources?.topDomains?.length || 0;
  log(`  Peec ok (snapshot): visibility=${raw.visibility}, rank=${raw.competitorRank}/${raw.competitorTotal}, topics=${(raw.topics || []).length}, daily=${(raw.daily || []).length} days, sources=${sourceDomCount} domains, pulledAt=${raw.pulledAt}.`);
  return raw;
}


// ===========================================================================
// Orchestrate
// ===========================================================================
let payload;
if (logosOnly) {
  // Logos-only refresh: patch src/data.json's hubspot.logos in place.
  if (!existsSync(OUT_PATH)) {
    err(`--logos-only needs an existing ${OUT_PATH} to patch. Run a full pull-data first.`);
    process.exit(1);
  }
  const data = JSON.parse(readFileSync(OUT_PATH, 'utf8'));
  let logos = null;
  try {
    logos = await fetchLogosFromRevenueRepo();
  } catch (e) {
    err(`  Revenue-repo logos fetch failed (trying proxy): ${e.message}`);
  }
  if (!logos) {
    try { logos = await fetchHubspotLogos(); }
    catch (e) { err(`  HubSpot logos pull failed: ${e.message}`); }
  }
  if (!logos) {
    err('  No fresh logos series produced — leaving existing series untouched.');
    process.exit(0);
  }
  data.hubspot = data.hubspot || {};
  data.hubspot.logos = logos;
  writeFileSync(OUT_PATH, JSON.stringify(data, null, 2));
  log(`Patched ${OUT_PATH} hubspot.logos — source=${logos.source || logos.method}, total=${logos.total}, weeks=${logos.weekly.length}.`);
  process.exit(0);
} else if (inputPath) {
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

  // Carry the baked/prior active-logos series forward whenever this run didn't
  // produce a fresh one (PULL_LOGOS off, scope error, or partial HubSpot fail).
  // The series is methodologically built from the revenue connector and lives
  // under hubspot.logos; never clobber it with an empty value.
  if (payload.hubspot && !payload.hubspot.logos && prev.hubspot?.logos) {
    payload.hubspot.logos = { ...prev.hubspot.logos, _staleFromPrevRun: true };
  }

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
