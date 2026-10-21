// ---------------------------------------------------------------------------
// Beta growth dashboard — the default view since Oct 16 2026 (was ?beta; the
// previous dashboard now lives at ?original — see src/main.jsx). Rebuild of the dashboard following the Lovable blueprint's
// layout, in Mutiny brand styling (Fraunces / Manrope, purple · green · red ·
// blue, black 1px borders). The current dashboard is untouched.
//
// Layout: "PLG funnel at a glance" in one row (stacks to two below 1180px) —
//   users:     Website visitors → User sign ups → Activated (live data)
//   companies: Paid → Retained → Expanding companies (stripe-dash)
// Clicking a step switches which section's charts show below (also kept in
// the URL hash, e.g. ?beta#activation, so a view can be shared).
//
// Data:
//   Website visitors  ← Framer unique visitors (src/framer.json, npm run
//                       ingest-framer) since Oct 16: funnel, visitors, visitor →
//                       sign up, high-intent reach / pages / → sign up, channels.
//                       GA4 sessions (src/data.json → ga4.*) are still loaded and
//                       their cards kept in the file, just not rendered.
//   Signups           ← Metabase signups export → src/beta-signups.json
//                       (npm run ingest-signups). One row = one user+company
//                       signup; never deduped.
// ---------------------------------------------------------------------------
import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  ResponsiveContainer, ComposedChart, BarChart, LineChart, Bar, Line, Cell, LabelList,
  XAxis, YAxis, CartesianGrid, Tooltip, ReferenceArea,
} from 'recharts';
import { ArrowUpRight, ArrowDownRight, MousePointerClick, Info, Clock, ChevronDown, Calendar } from 'lucide-react';
import dataJson from './src/data.json';
import betaSignups from './src/beta-signups.json';
import betaPaying from './src/beta-paying.json';
import betaCredits from './src/beta-credits.json';
import framerJson from './src/framer.json';
import { categorizeReferralSource as categorizeReferralSourceShared } from './channel-categorization.js';
// ?beta combines Search and AEO into one self-reported bucket (Nick, Oct 8). The
// shared engine (also used by the live dashboard) is left untouched.
const categorizeReferralSource = (src) => { const b = categorizeReferralSourceShared(src); return b === 'Search' || b === 'AEO' ? 'Search + AEO' : b; };

// --- Mutiny brand tokens --------------------------------------------------------
const C = {
  purple: '#A73BF5',
  green: '#B2FF14',
  red: '#FB5A3D',
  blue: '#96ECFF',
  lightPurple: '#F2D1FC',
  lightBlue: '#BCEEFD',
  lightRed: '#FF9987',
  lightGreen: '#D2FD78',
  black: '#000000',
  lightGrey: '#EFEFEF',
  white: '#FFFFFF',
  paper: '#FAF8F4',
  muted: 'rgba(0,0,0,0.55)',
  grid: '#E6E6E6',
  up: '#1E8A3A',   // readable green for deltas (brand lime is too light for text)
  down: '#E0401F', // brand red, slightly deepened for text
};
const FONT_DISPLAY = "'Fraunces', 'Reckless Condensed S', Georgia, serif";
const FONT_BODY = "'Manrope', 'KMR Waldenburg', Arial, sans-serif";
const FONT_CAPTION = "'Fraunces', 'Affix', Georgia, serif";

// --- Dates (UTC, ISO YYYY-MM-DD) --------------------------------------------
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const toDate = (iso) => new Date(`${iso}T00:00:00Z`);
const toISO = (d) => d.toISOString().slice(0, 10);
const addDays = (iso, n) => { const d = toDate(iso); d.setUTCDate(d.getUTCDate() + n); return toISO(d); };
const monDay = (iso) => { const d = toDate(iso); return `${MON[d.getUTCMonth()]} ${d.getUTCDate()}`; };
const mondayOf = (iso) => { const d = toDate(iso); return addDays(iso, -((d.getUTCDay() + 6) % 7)); };
const rangeLabel = (a, b) => (a === b ? monDay(a) : `${monDay(a)} – ${monDay(b)}`);
const daysBetweenISO = (a, b) => Math.round((toDate(b) - toDate(a)) / 86400000);

// --- Source data --------------------------------------------------------------
// Never-completed signups (ingest `nc`: no workspace, or one never named) are
// left out of EVERY signup metric on this page (Nick, Oct 15). They never
// activate, so only signup counts / denominators change. They're kept in
// NEVER_COMPLETED for the "view never-completed sign ups" modal.
const ALL_SIGNUP_ROWS = betaSignups.signups;
const NEVER_COMPLETED = ALL_SIGNUP_ROWS.filter((s) => s.nc);
const SIGNUPS = ALL_SIGNUP_ROWS.filter((s) => !s.nc);

// All sessions per day (GA4 File 1). Since Oct 15 (Nick) the whole ?beta
// dashboard uses sessions, never engaged sessions: Website visitors, visitor →
// sign up, high-intent reach + pages, channel charts. The live dashboard
// (mutiny_growth_dashboard.jsx) still uses engaged sessions.
const SESSIONS_BY_DATE = Object.fromEntries(
  dataJson.ga4.file1.map((r) => [`${r.date.slice(0, 4)}-${r.date.slice(4, 6)}-${r.date.slice(6)}`, r.sessions]),
);
const sumSessions = (a, b) => {
  let s = 0;
  for (let d = a; d <= b; d = addDays(d, 1)) s += SESSIONS_BY_DATE[d] || 0;
  return s;
};

// High-intent sessions (GA4 File 4): ONE aggregated daily number from
// the high-intent page filter, so a session that hits several high-intent pages
// counts once. Never rebuild this from the per-page File 5 — that double-counts.
const gaISO4 = (d) => `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6)}`;
const HIGH_INTENT_BY_DATE = Object.fromEntries((dataJson.ga4.file4 || []).map((r) => [gaISO4(r.date), r.highIntentSessions]));
// First day File 4 has data; earlier days are "no data", not zero.
const HIGH_INTENT_START = Object.keys(HIGH_INTENT_BY_DATE).sort()[0] || null;
// Per-page high-intent views (GA4 File 5): sessions per pagePath per
// day. Page-level only: a session on several pages appears under each, so
// these rows must NEVER be summed for reach (use File 4 for that).
const HIGH_INTENT_PAGE_ROWS = (dataJson.ga4.file5 || []).map((r) => ({ d: gaISO4(r.date), path: r.pagePath, n: r.sessions || 0 }));
const HIGH_INTENT_PAGES = [...new Set(HIGH_INTENT_PAGE_ROWS.map((r) => r.path))].sort();

const DATA_START = betaSignups.firstDate;
const DATA_END = betaSignups.lastDate;
const inRange = (d, a, b) => d >= a && d <= b;

// Reporting period (Nick, Oct 20 — Amplitude-style): two dropdowns.
//   Date range  RANGES below. Each has a headline window START…END and a prior
//               window (same length, just before) for deltas.
//                 7d   last 7 days ending on the latest data day
//                 4w/8w last 4 / 8 COMPLETE Mon–Sun weeks; charts also show the
//                      week in progress (striped/dotted), which is in the
//                      funnel's "week to date" line, not the totals
//                 tm/lm this month to date / last calendar month
//                 tq/lq this fiscal quarter to date / last fiscal quarter
//                 ytd  fiscal year to date (no prior year → no deltas)
//   Granularity Daily / Weekly / Monthly: the buckets every time-series chart
//               plots (M.WEEKS — the name stayed, the grain is GRAINS[grain]).
// Charts span exactly the selected range; a chart whose data starts later
// starts at its first day with data (Card `from`), and the range it covers is
// printed under its title.
const RANGES = {
  '7d': { label: 'Last 7 Days', long: 'last 7 days', prior: 'prior 7 days', days: 7 },
  '30d': { label: 'Last 30 Days', long: 'last 30 days', prior: 'prior 30 days', days: 30 },
  '60d': { label: 'Last 60 Days', long: 'last 60 days', prior: 'prior 60 days', days: 60 },
  '90d': { label: 'Last 90 Days', long: 'last 90 days', prior: 'prior 90 days', days: 90 },
  '4w': { label: 'Last 4 Weeks', long: 'last 4 weeks', prior: 'prior 4 weeks', weeks: 4 },
  '8w': { label: 'Last 8 Weeks', long: 'last 8 weeks', prior: 'prior 8 weeks', weeks: 8 },
  '12w': { label: 'Last 12 Weeks', long: 'last 12 weeks', prior: 'prior 12 weeks', weeks: 12 },
  '24w': { label: 'Last 24 Weeks', long: 'last 24 weeks', prior: 'prior 24 weeks', weeks: 24 },
  '3m': { label: 'Last 3 Months', long: 'last 3 months', prior: 'same days 3 months earlier', months: 3 },
  '6m': { label: 'Last 6 Months', long: 'last 6 months', prior: 'same days 6 months earlier', months: 6 },
  '12m': { label: 'Last 12 Months', long: 'last 12 months', prior: 'same days 12 months earlier', months: 12 },
  tw: { label: 'This Week', long: 'week to date', prior: 'same days last week' },
  tm: { label: 'This Month', long: 'month to date', prior: 'same days last month' },
  tq: { label: 'This Quarter', long: 'fiscal quarter to date', prior: 'same days last quarter' },
  ytd: { label: 'This Year', long: 'fiscal year to date', prior: 'no prior year', noPrior: true },
  custom: { label: 'Custom range', long: 'selected dates', prior: 'same number of days before' },
};
// Custom date range (Nick, Oct 21): any from/to day; compared with the same
// number of days just before. Earliest selectable day = CUSTOM_MIN.
const CUSTOM_MIN = '2026-01-01';
// Amplitude's date-range presets per granularity (Nick, Oct 20). "Default"
// = GRAIN_DEFAULT. Switching granularity keeps the range when the new list
// has it, otherwise falls back to that granularity's default.
const GRAIN_PRESETS = {
  day: ['7d', '30d', '60d', '90d', 'tw', 'tm', 'tq', 'ytd', 'custom'],
  week: ['4w', '8w', '12w', '24w', 'tm', 'tq', 'ytd', 'custom'],
  month: ['3m', '6m', '12m', 'tq', 'ytd', 'custom'],
};
const GRAIN_DEFAULT = { day: '30d', week: '12w', month: '6m' };
const presetFor = (range, grain) => (GRAIN_PRESETS[grain].includes(range) ? range : GRAIN_DEFAULT[grain]);
const GRAINS = {
  day: { label: 'Daily', noun: 'day', adj: 'daily', each: 'day' },
  week: { label: 'Weekly', noun: 'week', adj: 'weekly', each: 'Mon–Sun week' },
  month: { label: 'Monthly', noun: 'month', adj: 'monthly', each: 'calendar month' },
};
const DEFAULT_RANGE = '12w';
const DEFAULT_GRAIN = 'week';
// Mutiny runs an off-calendar fiscal year (Nick, Oct 7): Q3 ends Oct 31, so
// quarters are Feb–Apr (Q1), May–Jul (Q2), Aug–Oct (Q3), Nov–Jan (Q4) and the
// fiscal year starts Feb 1. QTD / YTD use these.
const FISCAL_START_MONTH = 2; // February
const fiscalIdx = (iso) => (+iso.slice(5, 7) - FISCAL_START_MONTH + 12) % 12; // months into the fiscal year
const fiscalYearStart = (iso) => {
  const y = +iso.slice(0, 4) - (+iso.slice(5, 7) < FISCAL_START_MONTH ? 1 : 0);
  return `${y}-${String(FISCAL_START_MONTH).padStart(2, '0')}-01`;
};
const fiscalQuarter = (iso) => Math.floor(fiscalIdx(iso) / 3) + 1;
const quarterStart = (iso) => {
  const back = fiscalIdx(iso) % 3; // months since the quarter began
  return toISO(new Date(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1 - back, 1)));
};
const addMonthsISO = (iso, n) => toISO(new Date(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1 + n, +iso.slice(8, 10))));
// Longest chart = YTD (weeks since the Monday of Jan 1's week).
const CHART_WEEKS = Math.max(26, Math.ceil((daysBetweenISO(mondayOf(addMonthsISO(quarterStart(DATA_END), -3)), mondayOf(DATA_END)) + 7) / 7), Math.ceil((daysBetweenISO(mondayOf(fiscalYearStart(DATA_END)), mondayOf(DATA_END)) + 7) / 7));
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const monthEndOf = (iso) => addDays(addMonthsISO(`${iso.slice(0, 7)}-01`, 1), -1);
// Buckets for one grain over [from, to] (inclusive, to ≤ DATA_END). Each has
// start/end (clipped to the frame), `last` (= end), label (x-axis), title
// (tooltips), range, partial (the day/week/month is still in progress — its
// nominal end is after DATA_END) and clipped (cut by the frame).
function makeBuckets(grain, from, to) {
  const out = [];
  if (grain === 'day') {
    for (let d = from; d <= to; d = addDays(d, 1)) {
      out.push({ grain, start: d, end: d, last: d, label: monDay(d), partial: false, clipped: false, range: monDay(d), title: `${DOW[toDate(d).getUTCDay()]}, ${monDay(d)}, ${d.slice(0, 4)}` });
    }
    return out;
  }
  if (grain === 'month') {
    for (let m = `${from.slice(0, 7)}-01`; m <= to; m = addMonthsISO(m, 1)) {
      const nominal = monthEndOf(m);
      const start = m < from ? from : m;
      const end = nominal > to ? to : nominal;
      const partial = nominal > DATA_END;
      const clipped = start !== m || (end !== nominal && !partial);
      const name = `${MONTH_NAMES[+m.slice(5, 7) - 1]} ${m.slice(0, 4)}`;
      out.push({ grain, monthly: true, start, end, last: end, label: MON[+m.slice(5, 7) - 1], partial, clipped, range: rangeLabel(start, end), title: `${name}${partial ? ` (to ${monDay(end)}, in progress)` : clipped ? ` (${rangeLabel(start, end)} only)` : ''}` });
    }
    return out;
  }
  for (let w = mondayOf(from); w <= to; w = addDays(w, 7)) {
    const nominal = addDays(w, 6);
    const start = w < from ? from : w;
    const end = nominal > to ? to : nominal;
    const partial = nominal > DATA_END;
    const clipped = start !== w || (end !== nominal && !partial);
    out.push({ grain, start, end, last: end, label: monDay(start), partial, clipped, range: rangeLabel(start, end), title: `Week of ${rangeLabel(start, end)}${partial ? ' (in progress)' : clipped ? ' (part week)' : ''}` });
  }
  return out;
}
function makeWindow(range, grain, custom) {
  const cfg = RANGES[range];
  const mon = mondayOf(DATA_END);
  const qs = quarterStart(DATA_END);
  const ms = `${DATA_END.slice(0, 7)}-01`;
  let END = DATA_END;
  let START;
  let PRIOR_START;
  let PRIOR_END;
  let label = cfg.label;
  // To-date ranges compare with the same number of days at the start of the
  // previous month / quarter.
  const sameDaysBefore = (start, months) => {
    const ps = addMonthsISO(start, -months);
    const pe = addDays(ps, daysBetweenISO(start, END));
    return [ps, pe < start ? pe : addDays(start, -1)];
  };
  if (cfg.days) { // last N days, ending on the latest data day
    START = addDays(END, -(cfg.days - 1));
    PRIOR_END = addDays(START, -1);
    PRIOR_START = addDays(START, -cfg.days);
  } else if (cfg.months) { // last N calendar months, this one to date
    START = addMonthsISO(ms, -(cfg.months - 1));
    [PRIOR_START, PRIOR_END] = sameDaysBefore(START, cfg.months);
  } else if (range === 'tw') {
    START = mon;
    PRIOR_START = addDays(mon, -7);
    PRIOR_END = addDays(PRIOR_START, daysBetweenISO(START, END));
  } else if (cfg.weeks) {
    END = addDays(mon, 6) === DATA_END ? DATA_END : addDays(mon, -1); // last complete Sunday
    START = addDays(END, -(7 * cfg.weeks - 1));
    PRIOR_END = addDays(START, -1);
    PRIOR_START = addDays(START, -7 * cfg.weeks);
  } else if (range === 'tm') {
    START = ms;
    [PRIOR_START, PRIOR_END] = sameDaysBefore(START, 1);
    label = `This Month (${MON[+ms.slice(5, 7) - 1]})`;
  } else if (range === 'tq') {
    START = qs;
    [PRIOR_START, PRIOR_END] = sameDaysBefore(START, 3);
    label = `This Quarter (Q${fiscalQuarter(DATA_END)})`;
  } else if (range === 'custom') {
    const clampDay = (d, dflt) => (!d ? dflt : d < CUSTOM_MIN ? CUSTOM_MIN : d > DATA_END ? DATA_END : d);
    let a = clampDay(custom?.from, addDays(DATA_END, -29));
    let b = clampDay(custom?.to, DATA_END);
    if (a > b) [a, b] = [b, a];
    START = a;
    END = b;
    PRIOR_END = addDays(START, -1);
    PRIOR_START = addDays(START, -(daysBetweenISO(START, END) + 1));
    label = 'Custom range'; // dates are shown next to it everywhere
  } else { // ytd
    START = fiscalYearStart(DATA_END);
    PRIOR_END = addDays(START, -1); // no data there; deltas are hidden (noPrior)
    PRIOR_START = addDays(START, -(daysBetweenISO(START, END) + 1));
    label = 'This Year (fiscal)';
  }
  const eff = cfg;
  // No comparison when the prior window starts before sign up counts do
  // (Feb 16): a partly empty prior period would make every delta look huge.
  const effOut = !eff.noPrior && PRIOR_START < SIGNUP_COUNT_START ? { ...eff, noPrior: true, prior: 'no full prior period' } : eff;
  // Chart frame = the range; complete-week ranges also chart the week in progress.
  const FRAME_START = START < DATA_START ? DATA_START : START;
  const FRAME_END = cfg.weeks ? DATA_END : END;
  const WTD = cfg.weeks && END < DATA_END ? { start: addDays(END, 1), end: DATA_END } : null;
  const WEEKS = makeBuckets(grain, FRAME_START, FRAME_END);
  const SHOWS_CUR = WEEKS.some((w) => w.partial);
  const G = GRAINS[grain];
  return { range, mode: range, grain, ...effOut, label, grainLabel: G.label, grainNoun: G.noun, grainAdj: G.adj, grainEach: G.each, END, START, PRIOR_START, PRIOR_END, FRAME_START, FRAME_END, WTD, WEEKS, WEEKS_CUR: WEEKS, SHOWS_CUR };
}

// Footnote wording for the week in progress, which only Last 4 weeks charts.
const barWeekNote = (M) => (M.SHOWS_CUR ? `Faintly striped bar = ${M.grainNoun} in progress.` : `One bar per ${M.grainNoun}.`);
const lineWeekNote = (M) => (M.SHOWS_CUR ? `Last point is the ${M.grainNoun} in progress.` : `One point per ${M.grainNoun}.`);


// --- GA4 measurement periods → adjusted visitor → sign up (Nick, Oct 14) ------
// GA4 counted visitors three different ways in 2026:
//   before Jul 17   no consent gate: GA4 fired for everyone, incl. ~95% bot
//                   traffic (AWS Boardman, OR). Conversion is NOT comparable →
//                   no adjusted rate, raw shown greyed.
//   Jul 17–Sep 21   CookieYes opt-in everywhere: GA4 only counted visitors who
//                   clicked Accept. Sessions × CONSENT_ADJ.factor.
//                   2.5 = sessions Sep 22–Oct 5 ÷ Sep 8–21 (9,958 / 3,987), the
//                   jump when US auto opt-in went live, while signups stayed flat.
//                   (Was 1.5 on engaged sessions until Oct 15; Nick chose to
//                   recompute on sessions. Direct 3.0×, organic 1.57×, referral 1.34×.)
//   Sep 22 →        US auto opt-in (opt-in banner in Europe only): raw GA4.
// No data-center / city filtering (Nick: bots are part of the game).
const CONSENT_ADJ = { start: '2026-07-17', end: '2026-09-21', factor: 2.5 };
const MEASURE_BREAK = CONSENT_ADJ.start; // first day conversion is comparable
const US_AUTO_OPTIN = addDays(CONSENT_ADJ.end, 1);
const consentFactor = (d) => (d >= CONSENT_ADJ.start && d <= CONSENT_ADJ.end ? CONSENT_ADJ.factor : 1);
// Sessions scaled to full consent (only days in CONSENT_ADJ change).
const sumSessionsAdj = (a, b) => {
  let s = 0;
  for (let d = a; d <= b; d = addDays(d, 1)) s += (SESSIONS_BY_DATE[d] || 0) * consentFactor(d);
  return s;
};
// Adjusted conversion over a range. Days before MEASURE_BREAK are dropped
// (clamped start); null if the range ends before it. `from` = the day it
// actually starts on, so labels can say so.
const adjConvOf = (a, b, signupsFor) => {
  if (b < MEASURE_BREAK) return { rate: null, from: null };
  const from = a < MEASURE_BREAK ? MEASURE_BREAK : a;
  const visitors = sumSessionsAdj(from, b);
  return { rate: pct(signupsFor(from, b), visitors), from, visitors };
};
const overlapsConsentAdj = (a, b) => a <= CONSENT_ADJ.end && b >= CONSENT_ADJ.start;
// Sum high-intent sessions over a range. null if File 4 doesn't cover
// the whole range (missing or starts later), so the ratio shows "—", not 0.
const sumHighIntent = (a, b) => {
  if (!HIGH_INTENT_START || a < HIGH_INTENT_START) return null;
  let s = 0;
  for (let d = a; d <= b; d = addDays(d, 1)) s += HIGH_INTENT_BY_DATE[d] || 0;
  return s;
};
// Window version: if the period starts before File 4 does (Fiscal YTD starts
// Feb 1, File 4 on Feb 2), start BOTH numerator and denominator on File 4's
// first day instead of showing "—". null only if the period ends before it.
const hiWindowStart = (a, b) => (!HIGH_INTENT_START || b < HIGH_INTENT_START ? null : a < HIGH_INTENT_START ? HIGH_INTENT_START : a);
// Weekly / window high-intent reach: sum sessions first, then divide. Never
// average daily percentages.
const hiReachOf = (hi, engaged) => (hi == null ? null : pct(hi, engaged));
// Signup COUNTS start on SIGNUP_COUNT_START, same as the live dashboard (when
// [Onboarding] User Setup Complete began firing). Earlier signups are still
// kept in SIGNUPS: anything they do later (setup, meetings, sends, activation)
// still counts — only the signup metric itself ignores them.
const SIGNUP_COUNT_START = '2026-02-16';
// Date-sorted index → O(log n) range lookups (Oct 20: daily buckets over a
// whole fiscal year call these hundreds of times).
const lowerBound = (arr, key, x) => { let lo = 0, hi = arr.length; while (lo < hi) { const m = (lo + hi) >> 1; if (key(arr[m]) < x) lo = m + 1; else hi = m; } return lo; };
const sliceByDate = (arr, key, a, b) => arr.slice(lowerBound(arr, key, a), lowerBound(arr, key, addDays(b, 1)));
const COUNTED_SORTED = SIGNUPS.filter((s) => s.d >= SIGNUP_COUNT_START).sort((x, y) => (x.d < y.d ? -1 : x.d > y.d ? 1 : 0));
const signupsIn = (a, b) => sliceByDate(COUNTED_SORTED, (s) => s.d, a, b);
const neverCompletedIn = (a, b) => NEVER_COMPLETED.filter((s) => s.d >= SIGNUP_COUNT_START && inRange(s.d, a, b));
// Company creators: the signup created a new company — not joining an existing
// one (jx: accepted invite or teammate's company) and not left without a
// company (nc). Same rule as the channel table's "company creators".
const isCreator = (s) => !s.jx && !s.nc;
const COUNTED_SIGNUPS = SIGNUPS.filter((s) => s.d >= SIGNUP_COUNT_START).length;
const pctChange = (curr, prev) => (prev ? ((curr - prev) / prev) * 100 : null);
const pct = (n, d) => (d ? (n / d) * 100 : null);
const ptsDiff = (a, b) => (a != null && b != null ? a - b : null);

// --- Channels (GA4) -------------------------------------------------------------
// Same bucketing as the live dashboard (mutiny_growth_dashboard.jsx →
// SIGNUPS_BUCKETING_RULES / bucketSignupEntry): source/medium regexes first,
// then GA4's channel group as fallback. Keep the two in sync.
const CHANNEL_RULES = [
  { match: /^chatgpt\.com$|^claude\.com$|^claude\.ai$|^perplexity\.ai$|^gemini\.google\.com$|^bard\.google\.com$|^copilot\.microsoft\.com$|^poe\.com$|chatgpt|^claude$|perplexity/i, bucket: 'Search + AEO' },
  { match: /linkedin/i, bucket: 'LinkedIn' },
  { match: /twitter|^x\.com$|^t\.co$|reddit|facebook|^fb\.|instagram|^ig$/i, bucket: 'Social' },
  { match: /^google$|^bing$|^duckduckgo$|^yahoo$|^brave$|^ecosia$|^qwant$|^baidu$|^yandex$/i, bucket: 'Search + AEO' },
  { match: /^email$|newsletter|mailchimp|^hs_email$/i, bucket: 'Email' },
  { match: /^\(direct\)$/i, bucket: 'Direct' },
];
const CHANNEL_FALLBACK = {
  'Direct': 'Direct', 'Organic Search': 'Search + AEO', 'Organic Social': 'Social', 'Referral': 'Referral',
  'Paid Search': 'Search + AEO', 'Paid Social': 'Social', 'Email': 'Email', 'Unassigned': 'Unassigned', 'AI Referrals': 'Search + AEO',
};
function channelOf(row) {
  const [source = '', medium = ''] = String(row.sourceMedium || '').split('/').map((s) => s.trim());
  for (const r of CHANNEL_RULES) if (r.match.test(source) || r.match.test(medium)) return r.bucket;
  return CHANNEL_FALLBACK[row.channelGroup] || 'Unassigned';
}
// Bottom → top stack order and colors, as on the live dashboard.
const CHANNELS = [
  { key: 'Direct', color: C.lightGrey },
  { key: 'Search + AEO', color: C.blue }, // Nick (Oct 8): search + AI referrals as one bucket
  { key: 'Referral', color: C.purple },
  { key: 'Social', color: C.lightPurple },
  { key: 'LinkedIn', color: '#0A66C2' },
  { key: 'Email', color: C.red },
  { key: 'Unassigned', color: '#D5D5D5' },
];
const gaISO = (d) => `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6)}`;
const GA_SESSIONS = dataJson.ga4.file3.map((r) => ({ d: gaISO(r.date), ch: channelOf(r), n: r.sessions || 0 }));
function sumByChannel(rows, a, b) {
  const out = Object.fromEntries(CHANNELS.map((c) => [c.key, 0]));
  for (const r of rows) if (r.d >= a && r.d <= b) out[r.ch] = (out[r.ch] || 0) + r.n;
  return out;
}
const sumVals = (o) => Object.values(o).reduce((s, v) => s + v, 0);

// --- Framer visitors (Oct 16, Nick) -----------------------------------------------
// Framer Analytics export → src/framer.json (npm run ingest-framer). Shown
// ALONGSIDE the GA4 cards, not instead of them. Visitor = one Framer visitorId
// (Framer rotates ids daily, so ≈ one person per day), dated by its first
// pageview. Each visitor has exactly one channel (first pageview's referrer +
// utm), bucketed with the same channelOf() rules as GA4, so channels add up
// to the total. No consent banner or bot cliff here: Framer is cookieless.
const FRAMER_START = framerJson.firstDate;
const FRAMER_END = framerJson.lastDate;
const FRAMER_BY_DATE = Object.fromEntries(framerJson.daily.map((r) => [r.d, r.visitors]));
const sumFramer = (a, b) => {
  let s = 0;
  for (let d = a; d <= b; d = addDays(d, 1)) s += FRAMER_BY_DATE[d] || 0;
  return s;
};
// A range that starts before the export does is incomplete → no number (no delta).
const framerIn = (a, b) => (a < FRAMER_START ? null : sumFramer(a, b));
const FRAMER_CH = framerJson.channels.map((r) => ({ d: r.d, ch: channelOf(r), n: r.visitors }));
// High-intent visitors (Framer): a visitor with ≥1 pageview on /pricing,
// /customers…, /case-studies…, /use-cases… — counted once (ingest dedupes), so
// summing days is safe. Per-page rows are page-level: a visitor who saw several
// pages is under each, so they must NEVER be summed for reach.
const FRAMER_HI_BY_DATE = Object.fromEntries(framerJson.daily.map((r) => [r.d, r.highIntent || 0]));
const sumFramerHi = (a, b) => {
  let s = 0;
  for (let d = a; d <= b; d = addDays(d, 1)) s += FRAMER_HI_BY_DATE[d] || 0;
  return s;
};
const FRAMER_PAGE_ROWS = (framerJson.pages || []).map((r) => ({ d: r.d, path: r.path, n: r.visitors }));
const FRAMER_PAGES = [...new Set(FRAMER_PAGE_ROWS.map((r) => r.path))].sort();
const framerPagesIn = (a, b) => {
  const out = Object.fromEntries(FRAMER_PAGES.map((p) => [p, 0]));
  FRAMER_PAGE_ROWS.forEach((r) => { if (r.d >= a && r.d <= b) out[r.path] += r.n; });
  return out;
};

// --- Sessions by channel (GA4 master feed; activeUsers until Oct 15) -------------
// Oct 15: the Apps Script switched Files 6–9 + presets from activeUsers to
// sessions. Each session has exactly one channel group, so channels add up to
// the total. The structure below (presets for headlines) is kept as-is:
//   headline        ← ga4.periodTotals[preset]   (exact preset range)
//   channel table   ← ga4.periodChannels[preset] (exact range, per session channel)
//   weekly bars     ← ga4.file6 (ISO week × channel), line ← ga4.file8 (week total)
//   monthly (YTD)   ← ga4.file7 (month × channel),    line ← ga4.file9 (month total)
// Only GA4's channel GROUP is available here (no source/medium), so groups map
// onto the same categories as the chart above via its fallback table.
// Groups that share a category are added (Nick chose this, Oct 14).
const AU_GROUP_CATEGORY = {
  ...CHANNEL_FALLBACK,
  'Organic Social - LinkedIn': 'LinkedIn',
  'Organic Social - Twitter': 'Social',
  'Organic Social - Reddit': 'Social',
};
const auCategory = (group) => AU_GROUP_CATEGORY[group] || 'Unassigned';
function auByCategory(rows) { // rows: [{ group, n }]
  const out = {};
  for (const r of rows) { const k = auCategory(r.group); out[k] = (out[k] || 0) + r.n; }
  return out;
}
// ISO week key 'YYYYWW' (Monday-start weeks; the ISO year is the Thursday's year).
const isoWeekKey = (iso) => {
  const thu = addDays(mondayOf(iso), 3);
  const y = thu.slice(0, 4);
  return `${y}${String(Math.floor(daysBetweenISO(`${y}-01-01`, thu) / 7) + 1).padStart(2, '0')}`;
};
const GA4_AU = (() => {
  const g = dataJson.ga4 || {};
  const group = (rows, key) => {
    const raw = {};
    for (const r of rows || []) (raw[r[key]] || (raw[r[key]] = [])).push({ group: r.channelGroup, n: r.sessions || 0 });
    return Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, auByCategory(v)]));
  };
  const totals = (rows, key) => Object.fromEntries((rows || []).map((r) => [r[key], r.sessions || 0]));
  const presets = Object.fromEntries(Object.entries(g.periodTotals || {}).map(([k, t]) => {
    const ch = g.periodChannels?.[k];
    return [k, { ...t, channels: ch ? auByCategory(ch.channels.map((c) => ({ group: c.channel, n: c.sessions || 0 }))) : null }];
  }));
  // Last day GA4 Active Users cover (presets run to the Apps Script refresh day).
  const end = Object.values(presets).map((p) => p.endDate).filter(Boolean).sort().pop() || null;
  return {
    has: Boolean((g.file6 || []).length || Object.keys(presets).length),
    weekCh: group(g.file6, 'isoWeek'), weekTotal: totals(g.file8, 'isoWeek'),
    monthCh: group(g.file7, 'yearMonth'), monthTotal: totals(g.file9, 'yearMonth'),
    presets, end,
  };
})();
// Weekly channel charts run to the current week (Nick, Oct 14): the latest day
// any source covers. Missing weeks after `rows` are appended as placeholders
// (noData: no bars, tooltip says "no data yet") so the x-axis lines up with the
// Active Users chart even when the signups export stops at the prior Sunday.
const CURRENT_DAY = [DATA_END, GA4_AU.end].filter(Boolean).sort().pop();
function withCurrentWeek(rows) {
  if (!rows.length || rows[0].grain !== 'week') return rows;
  const out = [...rows];
  for (let w = addDays(mondayOf(out[out.length - 1].start), 7); w <= mondayOf(CURRENT_DAY); w = addDays(w, 7)) {
    const sun = addDays(w, 6);
    out.push({ start: w, end: sun, label: monDay(w), partial: true, clipped: false, noData: true, total: 0, range: rangeLabel(w, sun > CURRENT_DAY ? CURRENT_DAY : sun) });
  }
  return out;
}
// Dashboard period → Apps Script preset (exact range, deduplicated by GA4).
const AU_PRESET_FOR_MODE = { '4w': 'last4Weeks', tq: 'quarterToDate', ytd: 'fiscalYTD' };

// --- Roles (CSV self_selected_role, as-is) ----------------------------------
const ROLES = [
  { key: 'ae', label: 'Account executive', color: C.purple },
  { key: 'bdr_sdr', label: 'SDR / BDR', color: C.blue },
  { key: 'founder', label: 'Founder', color: C.green },
  { key: 'demand_gen', label: 'Demand gen', color: C.red },
  { key: 'product_marketing', label: 'Product marketing', color: C.lightPurple },
  { key: 'abm', label: 'ABM', color: C.lightRed },
  { key: 'other', label: 'Other', color: '#9A9A9A' },
  { key: '__none', label: 'No answer', color: C.lightGrey },
];
const roleKey = (s) => (ROLES.some((r) => r.key === s.role) ? s.role : s.role ? 'other' : '__none');

// --- Setup steps ------------------------------------------------------------
const STEPS = [
  { key: 'rec', label: 'Recorder installed', color: C.black },
  { key: 'cal', label: 'Calendar connected', color: C.red },
  { key: 'em', label: 'Email connected', color: '#3FB6D3' },
];
// Completed onboarding requirements: recorder + Gmail + Google Calendar.
// (Oct 20 Nick tried dropping the recorder — false — then reverted; flip to
// false to require only Gmail + Calendar.)
const ONB_REQUIRES_RECORDER = true;
const ONB_KEYS = ONB_REQUIRES_RECORDER ? ['rec', 'cal', 'em'] : ['cal', 'em'];
const ONB_DEF_TEXT = ONB_REQUIRES_RECORDER ? 'installed the call recorder, and connected email (Gmail) and Google Calendar' : 'connected email (Gmail) and Google Calendar';
const isSetUp = (s) => ONB_KEYS.every((k) => s[k]);
function setupStats(list) {
  const out = { n: list.length, all: list.filter(isSetUp).length };
  for (const st of STEPS) out[st.key] = list.filter((s) => s[st.key]).length;
  return out;
}





// --- Activation ----------------------------------------------------------------
// Each step is cohorted by the week the user ENTERED the previous step (not
// signup week), so a conversion lands in the week the user became eligible.
//   First meeting:   completed setup → first meeting recorded within 7 days of
//                    completing setup (setup date = last of the 3 steps; a
//                    meeting recorded before setup finished also counts).
//   First send (A2): first meeting → first email/asset sent (any time so far).
const daysBetween = (a, b) => (toDate(b) - toDate(a)) / 86400000;
const setupDate = (s) => (isSetUp(s) ? ONB_KEYS.map((k) => s[k]).sort()[ONB_KEYS.length - 1] : null);
const ACTIVATION = [
  { key: 'mt', enteredOn: setupDate, converted: (s) => Boolean(s.mt && daysBetween(setupDate(s), s.mt) <= 7) },
  { key: 'snd', enteredOn: (s) => s.mt, converted: (s) => Boolean(s.snd) },
];
function activationStats(step, a, b) {
  const cohort = SIGNUPS.filter((s) => { const d = step.enteredOn(s); return d && inRange(d, a, b); });
  const conv = cohort.filter(step.converted).length;
  return { n: cohort.length, conv, rate: pct(conv, cohort.length) };
}



// --- Activated users -------------------------------------------------------------
// Activated = sent an email (send or draft) OR published an asset, whichever
// came first (see ingest rules). Per signup (user + company), never deduped.
// Users who signed up before Feb 16 still count when they activate.
const actDate = (s) => (s.snd && s.pub ? (s.snd < s.pub ? s.snd : s.pub) : s.snd || s.pub || null);
const ACT_SORTED = SIGNUPS.filter(actDate).sort((x, y) => (actDate(x) < actDate(y) ? -1 : actDate(x) > actDate(y) ? 1 : 0));
const activatedIn = (a, b) => sliceByDate(ACT_SORTED, actDate, a, b);
const FIRST_ACT_TRACKED = SIGNUPS.reduce((m, s) => { const d = actDate(s); return d && (!m || d < m) ? d : m; }, null);

// --- Returned (after activation) -------------------------------------------------------
// Returned = an activated user who, in the RETURN_DAYS days after their
// activation day (day A+1 … A+7; the activation day itself doesn't count),
// used credits, created or published an asset, or sent/drafted an email.
// s.ret = first such day after activation (ingest); s.retVia = what they did.
// Cohorted by activation week/day; a cohort is "mature" once A+7 ≤ DATA_END.
const RETURN_DAYS = 7;
const returnedWithin = (s) => { const a = actDate(s); return Boolean(a && s.ret && daysBetweenISO(a, s.ret) <= RETURN_DAYS); };
const RET_VIA = { c: 'Used credits', a: 'Asset', e: 'Email' };
const returnedVia = (s) => (s.retVia || '').split('').map((x) => RET_VIA[x]).filter(Boolean).join(' + ') || '—';
const RET_LAST_MATURE = addDays(DATA_END, -RETURN_DAYS);
const RET_MODAL = { noun: 'returned user', dateLabel: 'Returned', dateOf: (s) => s.ret, viaOf: returnedVia };

// --- Completed onboarding (Lever 1) ------------------------------------------------
// Completed onboarding = every ONB_KEYS step (recorder + Gmail + Google
// Calendar, see ONB_REQUIRES_RECORDER); dated by the last one (setupDate).
// Like activation, users who signed up before Feb 16 count when they complete.
const onbDate = (s) => setupDate(s);
const ONB_SORTED = SIGNUPS.filter(onbDate).sort((x, y) => (onbDate(x) < onbDate(y) ? -1 : onbDate(x) > onbDate(y) ? 1 : 0));
const onboardedIn = (a, b) => sliceByDate(ONB_SORTED, onbDate, a, b);
const FIRST_ONB_TRACKED = SIGNUPS.reduce((m, s) => { const d = onbDate(s); return d && (!m || d < m) ? d : m; }, null);
// Onboarding can only happen once the recorder exists: first tracked install.
const FIRST_REC_TRACKED = SIGNUPS.reduce((m, s) => (s.rec && (!m || s.rec < m) ? s.rec : m), null);

// --- N-day conversion by signup day (Stage 3 + Lever 1) -------------------------
// Of the signups on day D, the share whose milestone date falls on D … D+N
// (milestones dated before the signup don't count). N is the conversion window
// picked in the Stage 3 dropdown (7 / 14 / 30 days; default 7). A day is
// "mature" once D+N ≤ the export's last day. If the milestone only became
// trackable on `trackFrom`, signup days whose window ends before it are "not
// tracked" (no point, not zero) and are skipped in pooled rates.
const CONV_WINDOWS = [7, 14, 30];
const DEFAULT_CONV_WINDOW = 7;
const SIGNUPS_BY_DAY = SIGNUPS.reduce((m, s) => {
  if (s.d >= SIGNUP_COUNT_START) (m[s.d] || (m[s.d] = [])).push(s);
  return m;
}, {});
function makeDailyConv(dateFn, trackFrom, days) {
  const lastMature = addDays(DATA_END, -days);
  const within = (s) => { const x = dateFn(s); return Boolean(x && x >= s.d && daysBetweenISO(s.d, x) <= days); };
  const tracked = (d) => !trackFrom || addDays(d, days) >= trackFrom;
  // Pooled rate over signup days a…b (mature + tracked days only).
  function pooled(a, b) {
    const end = b < lastMature ? b : lastMature;
    let n = 0;
    let from = null;
    const list = [];
    for (let d = a; d <= end; d = addDays(d, 1)) {
      if (!tracked(d)) continue;
      if (!from) from = d;
      for (const s of SIGNUPS_BY_DAY[d] || []) { n += 1; if (within(s)) list.push(s); }
    }
    return { n, a: list.length, rate: pct(list.length, n), list, from: from || a, to: end, fullyTracked: tracked(a) };
  }
  // Headline: the most recent `span` mature signup days vs the `span` before.
  // minFrom: never start before this day (YTD starts Jan 1, not `span` days back).
  function recent(span, minFrom) {
    const to = lastMature;
    let from = addDays(to, -(span - 1));
    if (minFrom && from < minFrom) from = minFrom;
    return { curr: pooled(from, to), prev: pooled(addDays(from, -span), addDays(from, -1)) };
  }
  // Daily series: trailing CHART_WEEKS weeks (the longest chart); cards trim to their period's weeks.
  const daily = [];
  for (let d = addDays(mondayOf(DATA_END), -7 * (CHART_WEEKS - 1)); d <= DATA_END; d = addDays(d, 1)) {
    const cohort = SIGNUPS_BY_DAY[d] || [];
    const list = cohort.filter(within);
    const mature = d <= lastMature;
    const isTracked = tracked(d);
    const rate = isTracked ? pct(list.length, cohort.length) : null;
    // Rolling 7 signup days (d-6 … d), pooled; only once d itself is mature.
    const roll = mature && isTracked ? pooled(addDays(d, -6), d).rate : null;
    daily.push({ d, label: monDay(d), n: cohort.length, a: list.length, list, mature, tracked: isTracked, rate: mature ? rate : null, rateImm: mature ? null : rate, roll });
  }
  const ticks = daily.filter((x) => x.d === mondayOf(x.d)).map((x) => x.d);
  return { days, pooled, recent, daily, ticks, trackFrom, lastMature };
}
// Individual onboarding steps are trackable from the first date each appears.
const firstOf = (key) => SIGNUPS.reduce((m, s) => (s[key] && (!m || s[key] < m) ? s[key] : m), null);
const FIRST_CAL_TRACKED = firstOf('cal');
// First recorded meeting (Lever 2 · A1 magic moment): the meeting export starts
// on betaSignups.meetingsFrom (written by ingest-signups; Sep 3, 2026 when this
// was built), so signup days whose window ends before then aren't tracked.
const FIRST_MT_TRACKED = betaSignups.meetingsFrom || '2026-09-03';
// First email (Lever 3 · A2 first customer send): sent OR drafted (Nick's rule:
// drafts count as sends). The email export starts Sep 4, 2026.
const FIRST_SND_TRACKED = betaSignups.emailsFrom || '2026-09-04';
const FIRST_EM_TRACKED = firstOf('em');
// First day onboarding can be measured: the latest of its steps' first days.
const ONB_TRACK_FROM = ONB_REQUIRES_RECORDER ? FIRST_REC_TRACKED : [FIRST_CAL_TRACKED, FIRST_EM_TRACKED].filter(Boolean).sort().pop();
// CONV[window][key] — precomputed for every window option.
const CONV = Object.fromEntries(CONV_WINDOWS.map((w) => [w, {
  ACT: makeDailyConv(actDate, null, w),
  ONB: makeDailyConv(onbDate, ONB_TRACK_FROM, w),
  REC: makeDailyConv((s) => s.rec, FIRST_REC_TRACKED, w),
  EM: makeDailyConv((s) => s.em, FIRST_EM_TRACKED, w),
  CAL: makeDailyConv((s) => s.cal, FIRST_CAL_TRACKED, w),
  MT: makeDailyConv((s) => s.mt, FIRST_MT_TRACKED, w),
  SND: makeDailyConv((s) => s.snd, FIRST_SND_TRACKED, w),
}]));


// --- Channel deep dive ------------------------------------------------------------



// Self-reported channel ("How did you hear about us?") — Amplitude
// referral_source, bucketed with the live dashboard's engine
// (channel-categorization.js). Only Company Setup Complete carries an answer,
// so the rest of the window's signups go in a "No answer" row.
// Colors (Nick, Oct 8): a bucket that also exists in Website visitors by
// channel (CHANNELS) uses that card's color; every other bucket gets a color
// no GA4 channel uses, so the two cards never mean different things by one color.
const gaColor = (key) => CHANNELS.find((c) => c.key === key).color;
const SELF_REPORTED_BUCKETS = [
  { name: 'Word of Mouth', color: C.green },
  { name: 'Search + AEO', color: gaColor('Search + AEO') },
  { name: 'Influencer / Community', color: C.lightRed },
  { name: 'YC', color: '#FFC93C' },
  { name: 'Social', color: gaColor('Social') },
  { name: 'Email', color: gaColor('Email') },
  { name: 'Joke / Invalid', color: '#9D9D9D' },
  { name: 'Other / Unparseable', color: C.black },
];


// Answered = Amplitude referral_source daily totals, bucketed (not per user).
// The rest of the period's signups (Metabase, per signup) are split (Nick, Oct 7):
//   Accepted an invite — Amplitude "User Invitation Completed" daily uniques
//     (Nick, Oct 7: accepted an invite = that event fired); never asked.
//   Joined a teammate's company — signups on a company that already had an
//     earlier signup (Metabase), minus the accepted invites (most invitees
//     join an existing company); i.e. joined without the invite event.
//   (Never completed — no company / unnamed company — is excluded from all
//   signup counts since Oct 15; listed via the button under the card.)
//   Other — what's left (created a company but no answer recorded, etc.).
// Answers aren't per user, so the split is approximate: a few joiners or
// never-completed signups did answer, which makes Other slightly too small;
// invitees who aren't on an existing company also make "Joined a teammate's
// company" slightly too small.
const SR_INVITED = { name: 'Accepted an invite', color: C.up };
const SR_JOINED = { name: 'Joined a teammate’s company', color: '#2BB5D9' };
const INVITE_DAILY = dataJson.amplitude?.inviteAcceptedDaily || null;
// Coverage of the per-person Amplitude pull (YYYYMMDD), if it has been run.
const AMP_PER_PERSON = betaSignups.ampEvents?.firstDay
  ? { firstDay: betaSignups.ampEvents.firstDay.replaceAll('-', ''), lastDay: betaSignups.ampEvents.lastDay.replaceAll('-', '') }
  : null;
const SR_OTHER = { name: 'Other (no answer)', color: '#CBC3B3' };
const REF_DAILY = (() => {
  const out = Object.fromEntries(SELF_REPORTED_BUCKETS.map((x) => [x.name, {}]));
  for (const e of dataJson.amplitude?.referralSources || []) {
    const bucket = out[categorizeReferralSource(e.source)];
    if (!bucket) continue;
    for (const [d, v] of Object.entries(e.daily || {})) bucket[d] = (bucket[d] || 0) + (v || 0);
  }
  return out;
})();
// Per-signup channel (Nick, Oct 7): when the per-person Amplitude pull covers
// the period, every signup in the period is classified by its OWN Amplitude
// events (matched on user id): its "How did you hear about us?" answer →
// channel; else accepted an invite (User Invitation Completed); else joined a
// teammate's company (company already had a signup); else never completed;
// else Other. Counts and Sign up → activated are then exact per row.
// Without that pull, falls back to Amplitude daily totals (approximate).
const actOf = (l) => ({ n: l.length, k: l.filter(actDate).length, rate: pct(l.filter(actDate).length, l.length), list: l });
const srGroup = (s) => (s.ref ? categorizeReferralSource(s.ref) : s.inv ? SR_INVITED.name : s.jx ? SR_JOINED.name : SR_OTHER.name);
function selfReportedIn(start, end) {
  const a = start.replaceAll('-', '');
  const b = end.replaceAll('-', '');
  const list = signupsIn(start, end);
  // Signups only count from SIGNUP_COUNT_START, so the pull needs to cover from there.
  const need = a > SIGNUP_COUNT_START.replaceAll('-', '') ? a : SIGNUP_COUNT_START.replaceAll('-', '');
  if (AMP_PER_PERSON && AMP_PER_PERSON.firstDay <= need && AMP_PER_PERSON.lastDay >= b) {
    const by = {};
    for (const x of [...SELF_REPORTED_BUCKETS, SR_INVITED, SR_JOINED, SR_OTHER]) by[x.name] = [];
    for (const s of list) (by[srGroup(s)] || by[SR_OTHER.name]).push(s);
    const counts = Object.fromEntries(SELF_REPORTED_BUCKETS.map((x) => [x.name, by[x.name].length]));
    const actByChannel = Object.fromEntries(SELF_REPORTED_BUCKETS.map((x) => [x.name, actOf(by[x.name])]));
    const neverList = neverCompletedIn(start, end); // excluded from counts; for the modal only
    const other = by[SR_OTHER.name].length;
    return {
      perSignup: true, counts, answered: sumVals(counts),
      invited: by[SR_INVITED.name].length, joined: by[SR_JOINED.name].length, neverList, other, otherList: by[SR_OTHER.name],
      total: list.length,
      actByChannel, actInvited: actOf(by[SR_INVITED.name]), actTeammate: actOf(by[SR_JOINED.name]),
      actOther: actOf(by[SR_OTHER.name]),
      actJoined: actOf([...by[SR_INVITED.name], ...by[SR_JOINED.name]]),
      actCreators: actOf(list.filter((s) => !s.jx && !s.nc)),
    };
  }
  // Fallback: Amplitude daily totals (not per person).
  const counts = {};
  for (const x of SELF_REPORTED_BUCKETS) {
    let n = 0;
    for (const [d, v] of Object.entries(REF_DAILY[x.name])) if (d >= a && d <= b) n += v;
    counts[x.name] = n;
  }
  const answered = sumVals(counts);
  const neverList = neverCompletedIn(start, end); // excluded from counts; for the modal only
  const joinedAll = list.filter((s) => s.jx).length;
  let invited = 0;
  if (INVITE_DAILY) for (const [d, v] of Object.entries(INVITE_DAILY)) if (d >= a && d <= b) invited += v || 0;
  invited = Math.min(invited, joinedAll); // can't exceed the existing-company joins it's carved from
  const joined = joinedAll - invited;
  const other = Math.max(0, list.length - answered - joinedAll);
  return {
    perSignup: false, counts, answered, invited, joined, neverList, other, total: list.length,
    actJoined: actOf(list.filter((s) => s.jx)), actCreators: actOf(list.filter((s) => !s.jx && !s.nc)),
    actByChannel: null, actInvited: null, actTeammate: null, actOther: null,
  };
}

// --- Window-dependent model (rebuilt per reporting window) ------------------
function buildModel(range, grain, custom) {
  const W = makeWindow(range, grain, custom);
  const mode = range;
  const { END, START, PRIOR_START, PRIOR_END, WEEKS, WEEKS_CUR } = W;

  // Oct 20: the granularity dropdown replaces the old "Fiscal YTD = monthly
  // columns" rule — every chart uses W.WEEKS (buckets of the chosen grain), so
  // the monthly variants below are the same buckets and MONTHLY_COLS is off.
  const MONTHLY_COLS = false;
  const MONTHS = WEEKS;

  // --- Derived series -----------------------------------------------------------
  const WINDOW = (() => {
    const curr = signupsIn(START, END);
    const prev = signupsIn(PRIOR_START, PRIOR_END);
    const visitors = sumSessions(START, END);
    const visitorsPrev = sumSessions(PRIOR_START, PRIOR_END);
    const roleCounts = Object.fromEntries(ROLES.map((r) => [r.key, 0]));
    curr.forEach((s) => { roleCounts[roleKey(s)] += 1; });
    // Funnel "Activated" = signups in the window that have activated (email
    // sent/drafted or asset published), any time so far.
    const activated = curr.filter(actDate).length;
    const activatedPrev = prev.filter(actDate).length;
    // High-intent window: clamped to File 4's first day (see hiWindowStart);
    // sessions and signups use the same clamped range.
    const hiStart = hiWindowStart(START, END);
    const hiStartPrev = hiWindowStart(PRIOR_START, PRIOR_END);
    const highIntent = hiStart ? sumHighIntent(hiStart, END) : null;
    const highIntentPrev = hiStartPrev ? sumHighIntent(hiStartPrev, PRIOR_END) : null;
    const hiVisitors = hiStart ? sumSessions(hiStart, END) : null;
    const hiVisitorsPrev = hiStartPrev ? sumSessions(hiStartPrev, PRIOR_END) : null;
    const hiCreators = hiStart ? signupsIn(hiStart, END).filter(isCreator).length : null;
    const hiCreatorsPrev = hiStartPrev ? signupsIn(hiStartPrev, PRIOR_END).filter(isCreator).length : null;
    return {
      hiStart,
      highIntent,
      highIntentPrev,
      hiVisitors,
      hiCreators,
      hiReach: hiReachOf(highIntent, hiVisitors),
      hiReachPrev: hiReachOf(highIntentPrev, hiVisitorsPrev),
      // High-intent visitor → sign up (Nick, Oct 13): COMPANY-CREATOR signups
      // ÷ high-intent sessions (File 4). Creators only, so invitees /
      // teammates joining an existing company don't inflate it.
      creators: curr.filter(isCreator).length,
      creatorsPrev: prev.filter(isCreator).length,
      hiConv: highIntent == null ? null : pct(hiCreators, highIntent),
      hiConvPrev: highIntentPrev == null ? null : pct(hiCreatorsPrev, highIntentPrev),
      signups: curr.length,
      signupsPrev: prev.length,
      visitors,
      visitorsPrev,
      conv: pct(curr.length, visitors),
      convPrev: pct(prev.length, visitorsPrev),
      // Consent-adjusted conversion (see CONSENT_ADJ). A window that starts
      // before Jul 17 is clamped to Jul 17; the prior period only counts when
      // it is fully comparable (else no delta).
      ...(() => {
        const n = (a, b) => signupsIn(a, b).length;
        const cur = adjConvOf(START, END, n);
        const prv = adjConvOf(PRIOR_START, PRIOR_END, n);
        return {
          convAdj: cur.rate,
          convAdjFrom: cur.from,
          visitorsAdj: cur.visitors ?? null,
          signupsAdj: cur.from ? n(cur.from, END) : null,
          convAdjPrev: prv.from === PRIOR_START ? prv.rate : null,
          convAdjScaled: overlapsConsentAdj(cur.from || START, END),
        };
      })(),
      activated,
      activatedPrev,
      actConv: pct(activated, curr.length),
      actConvPrev: pct(activatedPrev, prev.length),
      roleCounts,
      setup: setupStats(curr),
      setupPrev: setupStats(prev),
    };
  })();

  const WEEKLY = (() => {
    let cumVisitors = 0;
    // Cumulative signups start from the all-time total before the chart window.
    let cumSignups = signupsIn(SIGNUP_COUNT_START, addDays(WEEKS[0].start, -1)).length;
    return WEEKS.map((w) => {
      const end = w.partial ? DATA_END : w.end;
      const list = signupsIn(w.start, end);
      const visitors = sumSessions(w.start, end);
      cumVisitors += visitors;
      cumSignups += list.length;
      const highIntent = sumHighIntent(w.start, end);
      // Adjusted rate only for weeks fully on/after MEASURE_BREAK (the Jul 13
      // week mixes bot-counted days → gap). Raw `conv` stays for the faint line.
      const comparable = w.start >= MEASURE_BREAK;
      const visitorsAdj = comparable ? sumSessionsAdj(w.start, end) : null;
      const row = { ...w, signups: list.length, visitors, visitorsAdj, convAdj: comparable ? pct(list.length, visitorsAdj) : null, preBreak: !comparable, adjScaled: comparable && overlapsConsentAdj(w.start, end), cumVisitors, cumSignups, conv: pct(list.length, visitors), highIntent, allSessions: sumSessions(w.start, end), hiReach: hiReachOf(highIntent, sumSessions(w.start, end)),creators: list.filter(isCreator).length, hiConv: highIntent == null ? null : pct(list.filter(isCreator).length, highIntent) };
      ROLES.forEach((r) => { row[r.key] = 0; });
      list.forEach((s) => { row[roleKey(s)] += 1; });
      ROLES.forEach((r) => { row[`${r.key}_pct`] = list.length ? (row[r.key] / list.length) * 100 : 0; });
      const st = setupStats(list);
      row.setupAll = pct(st.all, st.n);
      row.setupAllN = st.all;
      STEPS.forEach((x) => { row[`setup_${x.key}`] = pct(st[x.key], st.n); row[`setup_${x.key}N`] = st[x.key]; });
      row.actList = list.filter(actDate);
      row.actN = row.actList.length;
      row.actPct = pct(row.actN, list.length);
      return row;
    });
  })();

  const ACT = Object.fromEntries(ACTIVATION.map((step) => [step.key, {
    curr: activationStats(step, START, END),
    prev: activationStats(step, PRIOR_START, PRIOR_END),
    weekly: WEEKS.map((w) => ({ ...w, ...activationStats(step, w.start, w.partial ? DATA_END : w.end) })),
    monthly: MONTHS.map((p) => ({ ...p, ...activationStats(step, p.start, p.last) })),
  }]));

  const MEETING_ANY_30D = signupsIn(START, END).filter((s) => s.mt).length;

  // Activated users, counted in the week/window they activated (any signup date).
  const ACTIVATED = (() => {
    const split = (list) => ({
      email: list.filter((s) => s.snd && actDate(s) === s.snd).length,
      asset: list.filter((s) => s.pub && actDate(s) === s.pub && s.snd !== s.pub).length,
    });
    const curr = activatedIn(START, END);
    // Cumulative, as of a day: every activated user to date (any signup date —
    // pre-Feb-16 signups count when they activate) vs the signup base to date
    // (signups since SIGNUP_COUNT_START).
    const cumAsOf = (d) => {
      const act = FIRST_ACT_TRACKED && d >= FIRST_ACT_TRACKED ? activatedIn(FIRST_ACT_TRACKED, d).length : 0;
      const base = d >= SIGNUP_COUNT_START ? signupsIn(SIGNUP_COUNT_START, d).length : 0;
      return { cum: act, cumBase: base, cumPct: pct(act, base) };
    };
    const weekly = WEEKS.map((w) => {
      const end = w.partial ? DATA_END : w.end;
      const list = activatedIn(w.start, end);
      const cur = cumAsOf(end);
      const before = cumAsOf(addDays(w.start, -1)); // end of the previous week
      return {
        ...w, n: list.length, list, ...split(list), ...cur,
        // Week-over-week change of the cumulative series (shown in tooltips).
        cumPctWoW: ptsDiff(cur.cumPct, before.cumPct),
        cumWoW: pctChange(cur.cum, before.cum),
      };
    });
    return {
      curr: curr.length,
      currList: curr,
      ...split(curr),
      prev: activatedIn(PRIOR_START, PRIOR_END).length,
      now: cumAsOf(DATA_END),
      atPriorEnd: cumAsOf(PRIOR_END),
      weekly,
      // Monthly columns for Fiscal YTD (Activated by type of first action).
      monthly: MONTHS.map((p) => { const list = activatedIn(p.start, p.last); return { ...p, n: list.length, list, ...split(list) }; }),
    };
  })();

  // Completed onboarding, cumulative (same shape as ACTIVATED's cum fields).
  // 7-day activation headline for the selected window (mature signup days only).

  const ONBOARDED = (() => {
    const cumAsOf = (d) => {
      const done = FIRST_ONB_TRACKED && d >= FIRST_ONB_TRACKED ? onboardedIn(FIRST_ONB_TRACKED, d).length : 0;
      const base = d >= SIGNUP_COUNT_START ? signupsIn(SIGNUP_COUNT_START, d).length : 0;
      return { cum: done, cumBase: base, cumPct: pct(done, base) };
    };
    const curr = onboardedIn(START, END);
    const weekly = WEEKS.map((w) => {
      const end = w.partial ? DATA_END : w.end;
      const list = onboardedIn(w.start, end);
      const cur = cumAsOf(end);
      const before = cumAsOf(addDays(w.start, -1));
      return { ...w, n: list.length, list, ...cur, cumPctWoW: ptsDiff(cur.cumPct, before.cumPct), cumWoW: pctChange(cur.cum, before.cum) };
    });
    return { curr: curr.length, currList: curr, prev: onboardedIn(PRIOR_START, PRIOR_END).length, now: cumAsOf(DATA_END), atPriorEnd: cumAsOf(PRIOR_END), weekly };
  })();

  // Returned within 7 days of activation, by activation week. Weeks whose
  // 7-day windows haven't all closed are "open" (drawn dotted).
  const RETURNED = (() => {
    const cohort = (a, b) => {
      const list = activatedIn(a, b);
      const ret = list.filter(returnedWithin);
      return { n: list.length, k: ret.length, rate: pct(ret.length, list.length), list, retList: ret };
    };
    const weekly = WEEKS.map((w) => {
      const end = w.partial ? DATA_END : w.end;
      const c = cohort(w.start, end);
      return { ...w, ...c, mature: w.end <= RET_LAST_MATURE };
    });
    weekly.forEach((w, i) => {
      const next = weekly[i + 1];
      w.rateFull = w.mature ? w.rate : null;
      w.rateOpen = !w.mature || (next && !next.mature) ? w.rate : null;
      w.kFull = w.mature ? w.k : null;
      w.kOpen = !w.mature || (next && !next.mature) ? w.k : null;
    });
    // Headline conversion: users who activated IN the reporting period (Nick,
    // Oct 7 — headline time frames match the window); only those whose 7-day
    // window has closed count, the rest are "still open". Same for the prior period.
    const to = END < RET_LAST_MATURE ? END : RET_LAST_MATURE;
    const curr = { ...cohort(START, to), from: START, to, open: to < END ? activatedIn(to < START ? START : addDays(to, 1), END).length : 0 };
    const pto = PRIOR_END < RET_LAST_MATURE ? PRIOR_END : RET_LAST_MATURE;
    const prev = { ...cohort(PRIOR_START, pto), from: PRIOR_START, to: pto };
    // Weekly headline: the latest week whose windows have all closed.
    const matureWeeks = weekly.filter((w) => w.mature && !w.partial);
    const lastWeek = matureWeeks[matureWeeks.length - 1] || null;
    const prevWeek = matureWeeks[matureWeeks.length - 2] || null;
    return { weekly, curr, prev, lastWeek, prevWeek };
  })();

  const CHANNEL_WEEKLY = WEEKS_CUR.map((w) => {
    const s = sumByChannel(GA_SESSIONS, w.start, w.partial ? DATA_END : w.end);
    return { ...w, ...s, total: sumVals(s) };
  });
  const CHANNEL_MONTHLY = MONTHS.map((p) => {
    const sums = sumByChannel(GA_SESSIONS, p.start, p.last);
    return { ...p, ...sums, total: sumVals(sums) };
  });

  // Active users by channel (GA4 Files 6–9 + presets). Same x-axis as the
  // sessions-by-source chart (WEEKS_CUR / MONTHS). A week or month GA4 hasn't
  // finished (ends after GA4_AU.end) is flagged partial; one with no GA4 rows
  // has no bars (no data, not zero).
  const AU = (() => {
    const row = (p, ch, total) => {
      const partial = GA4_AU.end ? p.end > GA4_AU.end : p.partial;
      const out = { ...p, partial, auThrough: partial && GA4_AU.end ? GA4_AU.end : p.end, auTotal: total ?? null, chSum: ch ? sumVals(ch) : null };
      CHANNELS.forEach((c) => { out[c.key] = ch ? ch[c.key] || 0 : undefined; });
      return out;
    };
    // Weekly frame (Nick, Oct 14): Last week uses the same columns as Last 4
    // weeks, and every weekly view ends with GA4's current week (in progress,
    // through GA4_AU.end) even when the signups export stops at the Sunday before.
    // Only this chart — the sessions-by-source chart keeps its own frame.
    const frame = [...WEEKS_CUR];
    if (grain === 'week' && GA4_AU.end && frame.length) {
      for (let w = addDays(frame[frame.length - 1].start, 7); w <= mondayOf(GA4_AU.end); w = addDays(w, 7)) {
        frame.push({ start: w, end: addDays(w, 6), label: monDay(w), partial: true, clipped: false, range: rangeLabel(w, addDays(w, 6) > GA4_AU.end ? GA4_AU.end : addDays(w, 6)) });
      }
    }
    const weekly = frame.map((w) => { const k = isoWeekKey(w.start); return row(w, GA4_AU.weekCh[k], GA4_AU.weekTotal[k]); });
    const monthly = MONTHS.map((p) => { const k = p.start.slice(0, 7).replace('-', ''); return row(p, GA4_AU.monthCh[k], GA4_AU.monthTotal[k]); });
    const presetKey = AU_PRESET_FOR_MODE[mode];
    return { presetKey, preset: GA4_AU.presets[presetKey] || null, thisWeek: GA4_AU.presets.thisWeek || null, weekly, monthly };
  })();

  const CH30 = (() => {
    const sessions = sumByChannel(GA_SESSIONS, START, END);
    const sessionsPrev = sumByChannel(GA_SESSIONS, PRIOR_START, PRIOR_END);
    return { sessions, total: sumVals(sessions), totalPrev: sumVals(sessionsPrev) };
  })();

  // Framer visitors: weekly line (same weeks as the GA4 visitors line), window
  // headline, and channel columns (same frames as the GA4 channel chart).
  // Partial weeks / months run to the last Framer day, not DATA_END, so the
  // in-progress week isn't cut a day short.
  // Since Oct 16 (Nick) these drive every VISIBLE visitor chart + the funnel;
  // the GA4 fields above (WINDOW.visitors, convAdj, hiReach…) are still built
  // for the hidden GA4 cards. Everything stops at DATA_END like the signups, so
  // numerator and denominator always cover the same days.
  //   visitors           Framer unique visitors
  //   conv               sign ups ÷ visitors (no consent adjustment needed)
  //   hiReach            high-intent visitors ÷ visitors
  //   hiConv             company-creator sign ups ÷ high-intent visitors
  // Sign up rates start at max(period start, Framer start, SIGNUP_COUNT_START):
  // in Fiscal YTD that's Feb 16, when sign up counts begin.
  const FRAMER = (() => {
    const lastDay = FRAMER_END < DATA_END ? FRAMER_END : DATA_END;
    const to = (w) => (w.end > lastDay ? lastDay : w.end);
    const fromW = (w) => (w.start < FRAMER_START ? FRAMER_START : w.start);
    const maxISO = (...xs) => xs.sort().pop();
    // Weekly lines (same weeks as WEEKLY → same x-axis as every other line chart).
    const lineRows = WEEKLY.map((w) => {
      const none = w.end < FRAMER_START;
      const a = fromW(w), b = to(w);
      const fv = none ? null : sumFramer(a, b);
      const hi = none ? null : sumFramerHi(a, b);
      const rated = !none && w.start >= SIGNUP_COUNT_START && w.start >= FRAMER_START;
      return {
        ...w,
        partial: w.partial || w.end > lastDay,
        fv, hi,
        hiReach: hi == null ? null : pct(hi, fv),
        conv: rated ? pct(w.signups, fv) : null,
        hiConv: rated ? pct(w.creators, hi) : null,
      };
    });
    const line = lineRows.map((w, i) => ({
      ...w,
      fvFull: w.partial ? null : w.fv,
      fvPartial: w.partial || lineRows[i + 1]?.partial ? w.fv : null,
    }));
    const chRow = (p) => {
      const s = sumByChannel(FRAMER_CH, fromW(p), to(p));
      return { ...p, ...s, total: sumVals(s), partial: p.partial || p.end > lastDay };
    };
    // Window (headline) numbers.
    const winStart = START < FRAMER_START ? FRAMER_START : START;
    const winEnd = END > lastDay ? lastDay : END;
    const channels = sumByChannel(FRAMER_CH, winStart, winEnd);
    const rateStart = maxISO(START, FRAMER_START, SIGNUP_COUNT_START);
    const prevOk = !W.noPrior && PRIOR_START >= FRAMER_START && PRIOR_START >= SIGNUP_COUNT_START;
    const rates = (a, b) => {
      const v = sumFramer(a, b), h = sumFramerHi(a, b), list = signupsIn(a, b);
      const cr = list.filter(isCreator).length;
      return { v, h, n: list.length, cr, conv: pct(list.length, v), hiReach: pct(h, v), hiConv: pct(cr, h) };
    };
    const cur = rates(rateStart, winEnd);
    const prv = prevOk ? rates(PRIOR_START, PRIOR_END) : null;
    const reachNow = rates(winStart, winEnd);
    return {
      line,
      weekly: WEEKS_CUR.map(chRow),
      monthly: MONTHS.map(chRow),
      winStart, winEnd, rateStart,
      visitors: reachNow.v,
      visitorsPrev: framerIn(PRIOR_START, PRIOR_END),
      channels,
      // visitor → sign up
      conv: cur.conv, convPrev: prv?.conv ?? null, convSignups: cur.n, convVisitors: cur.v,
      // high-intent reach (from the Framer start, no signup dependence)
      highIntent: reachNow.h, hiReach: reachNow.hiReach, hiReachPrev: prv?.hiReach ?? null,
      highIntentPrev: !W.noPrior && PRIOR_START >= FRAMER_START ? sumFramerHi(PRIOR_START, PRIOR_END) : null,
      // high-intent → sign up (company creators)
      hiConv: cur.hiConv, hiConvPrev: prv?.hiConv ?? null, hiCreators: cur.cr, hiVisitorsForConv: cur.h,
    };
  })();

  // Week to date (the in-progress week; not in the headline totals).
  const WTD_STATS = W.WTD ? (() => {
    const list = signupsIn(W.WTD.start, W.WTD.end);
    // visitors = Framer (Oct 16); GA4 sessions kept as gaVisitors.
    return { ...W.WTD, visitors: sumFramer(W.WTD.start, W.WTD.end), gaVisitors: sumSessions(W.WTD.start, W.WTD.end), signups: list.length, activated: list.filter(actDate).length };
  })() : null;
  const SELF_REPORTED = selfReportedIn(START, END);
  // Same split per week, for the stacked-column view of the channel table.
  const SELF_REPORTED_PREV = selfReportedIn(PRIOR_START, PRIOR_END);
  const SELF_REPORTED_WEEKLY = WEEKS_CUR.map((w) => ({ ...w, ...selfReportedIn(w.start, w.partial ? DATA_END : w.end) }));
  const SELF_REPORTED_MONTHLY = MONTHS.map((p) => ({ ...p, ...selfReportedIn(p.start, p.last) }));

  const VISITOR_LINE = WEEKLY.map((w, i) => {
    const next = WEEKLY[i + 1];
    return {
      ...w,
      visitorsFull: w.partial ? null : w.visitors,
      visitorsPartial: w.partial || next?.partial ? w.visitors : null,
    };
  });

  return { ...W, MONTHLY_COLS, MONTHS, WINDOW, WEEKLY, ACT, MEETING_ANY_30D, ACTIVATED, ONBOARDED, RETURNED, CHANNEL_WEEKLY, CHANNEL_MONTHLY, CH30, AU,WTD_STATS, SELF_REPORTED, SELF_REPORTED_PREV, SELF_REPORTED_WEEKLY, SELF_REPORTED_MONTHLY, VISITOR_LINE, FRAMER };
}
// Built on demand (24 range × grain combos) and cached.
const MODEL_CACHE = new Map();
const getModel = (range, grain, custom) => {
  const k = range === 'custom' ? `custom|${grain}|${custom?.from}|${custom?.to}` : `${range}|${grain}`;
  if (!MODEL_CACHE.has(k)) {
    // Custom ranges make a new model per pair of dates — keep only the last few.
    const customKeys = [...MODEL_CACHE.keys()].filter((x) => x.startsWith('custom|'));
    if (range === 'custom' && customKeys.length >= 6) MODEL_CACHE.delete(customKeys[0]);
    MODEL_CACHE.set(k, buildModel(range, grain, custom));
  }
  return MODEL_CACHE.get(k);
};
const ModelCtx = React.createContext(getModel(DEFAULT_RANGE, DEFAULT_GRAIN));
const useModel = () => React.useContext(ModelCtx);

// --- Activated-users modal ------------------------------------------------------
// Click a week on an activation chart (or "List users") to see who activated,
// with a link to each user's admin profile.
const ADMIN_USER_URL = 'https://admin.mutinyhq.com/users/';
const UsersModalCtx = React.createContext(() => {});
const useUsersModal = () => React.useContext(UsersModalCtx);
const activatedVia = (s) => (s.snd && s.pub && s.snd === s.pub ? 'Email + asset' : actDate(s) === s.snd ? 'Email' : 'Asset publish');
// Recharts chart onClick → open the modal for the clicked week's row.
const onWeekClick = (open, build) => (e) => {
  const row = e?.activePayload?.[0]?.payload;
  if (row) open(build(row));
};

function UsersModal({ data, onClose }) {
  useEffect(() => {
    if (!data) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [data, onClose]);
  if (!data) return null;
  // Defaults describe activated users; other lists (e.g. onboarding) override.
  const dateOf = data.dateOf || actDate;
  const noun = data.noun || 'activated user';
  const nounPlural = data.nounPlural || `${noun}s`;
  const dateLabel = data.dateLabel || 'Activated';
  const showVia = data.showVia !== false;
  const showDate = data.showDate !== false;
  const viaLabel = data.viaLabel || 'Via';
  const viaOf = data.viaOf || activatedVia;
  // Optional fadedOf(u) (activation funnel, Oct 20): users who haven't done the
  // next step yet draw faded and sort after those who have.
  const fadedOf = data.fadedOf || null;
  const sortKey = (u) => dateOf(u) || u.d || '';
  const rows = [...data.users].sort((a, b) => {
    if (fadedOf) { const fa = fadedOf(a) ? 1 : 0; const fb = fadedOf(b) ? 1 : 0; if (fa !== fb) return fa - fb; }
    return sortKey(a) < sortKey(b) ? -1 : sortKey(a) > sortKey(b) ? 1 : 0;
  });
  const th = { ...eyebrow, fontSize: 10, textAlign: 'left', padding: '8px 12px', borderBottom: `1px solid ${C.black}`, background: C.paper, position: 'sticky', top: 0 };
  const td = { fontFamily: FONT_BODY, fontSize: 13, padding: '8px 12px', borderBottom: `1px solid ${C.lightGrey}`, whiteSpace: 'nowrap' };
  return (
    <div role="presentation" onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div role="dialog" aria-modal="true" aria-label={data.title} onClick={(e) => e.stopPropagation()} style={{ background: C.white, border: `1px solid ${C.black}`, borderRadius: 4, boxShadow: `6px 6px 0 ${C.green}`, width: 'min(820px, 100%)', maxHeight: '82vh', display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, padding: '18px 20px 12px', borderBottom: `1px solid ${C.lightGrey}` }}>
          <div>
            <div style={{ fontFamily: FONT_BODY, fontSize: 16, fontWeight: 700 }}>{data.title}</div>
            <div style={{ fontFamily: FONT_BODY, fontSize: 13, color: C.muted, marginTop: 3 }}>{rows.length.toLocaleString()} {rows.length === 1 ? noun : nounPlural}{data.subtitle ? ` · ${data.subtitle}` : ''}</div>
            {data.note && <div style={{ fontFamily: FONT_BODY, fontSize: 12.5, color: C.black, marginTop: 6 }}>{data.note}</div>}
            {/* The card's headline breakdown (Nick, Oct 8): moved off the card into Details. */}
            {data.summary && (
              <div style={{ marginTop: 14, display: 'flex', alignItems: 'baseline', flexWrap: 'wrap', gap: '4px 14px' }}>
                {data.summary.label && <div style={{ ...eyebrow, flexBasis: '100%' }}>{data.summary.label}</div>}
                {data.summary.value != null && <div style={{ ...tabular, fontFamily: FONT_DISPLAY, fontSize: 28, lineHeight: 1.05, letterSpacing: '-0.03em' }}>{data.summary.value}</div>}
                {data.summary.sub && <div style={{ fontFamily: FONT_BODY, fontSize: 13, color: C.muted }}>{data.summary.sub}</div>}
              </div>
            )}
          </div>
          <button type="button" onClick={onClose} aria-label="Close" style={{ border: `1px solid ${C.black}`, borderRadius: 4, background: C.white, cursor: 'pointer', fontFamily: FONT_BODY, fontSize: 13, fontWeight: 600, padding: '4px 10px' }}>Close</button>
        </div>
        <div style={{ overflow: 'auto' }}>
          {rows.length ? (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={th}>User (admin profile)</th>
                  {data.stageCols ? data.stageCols.map((c) => <th key={c.label} style={th}>{c.label}</th>) : (
                    <>
                      <th style={th}>Signed up</th>
                      {showDate && <th style={th}>{dateLabel}</th>}
                      {showVia && <th style={th}>{viaLabel}</th>}
                    </>
                  )}
                </tr>
              </thead>
              <tbody>
                {rows.map((u, i) => (
                  <tr key={`${u.uid}-${u.co}-${i}`} style={fadedOf && fadedOf(u) ? { opacity: 0.38 } : undefined}>
                    <td style={td}>
                      {u.uid ? (
                        <a href={`${ADMIN_USER_URL}${u.uid}`} target="_blank" rel="noopener noreferrer" title={`${ADMIN_USER_URL}${u.uid}`} style={{ color: C.purple, textDecoration: 'underline', textUnderlineOffset: 2, ...(u.email ? {} : { fontFamily: "'Geist Mono', 'SF Mono', Consolas, monospace", fontSize: 12 }) }}>{u.email || u.uid}</a>
                      ) : <span style={{ color: C.muted }}>unknown</span>}
                    </td>
                    {data.stageCols ? data.stageCols.map((c) => <td key={c.label} style={{ ...td, ...tabular }}>{c.render(u)}</td>) : (
                      <>
                        <td style={{ ...td, ...tabular }}>{monDay(u.d)} {u.d.slice(0, 4)}</td>
                        {showDate && <td style={{ ...td, ...tabular }}>{dateOf(u) ? monDay(dateOf(u)) : '—'}</td>}
                        {showVia && <td style={td}>{viaOf(u)}</td>}
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div style={{ padding: 24, fontFamily: FONT_BODY, fontSize: 13, color: C.muted }}>No {nounPlural} in this period.</div>
          )}
        </div>
      </div>
    </div>
  );
}

// "Details" (Nick, Oct 8): sits top-right of the card (portaled into the
// card header) and opens the users modal, which also shows the headline
// breakdown (pass `summary` in the modal data).
const CardSlotCtx = React.createContext(null);
function ListUsersButton({ onClick, n, label }) {
  const slot = React.useContext(CardSlotCtx);
  const btn = (
    <button
      type="button"
      onClick={onClick}
      title={`List ${fmtInt(n)} ${n === 1 ? 'user' : 'users'} ${label || 'activated'}`}
      style={{ border: `1px solid ${C.black}`, borderRadius: 999, background: C.white, cursor: 'pointer', fontFamily: FONT_BODY, fontSize: 12, fontWeight: 600, padding: '4px 12px', whiteSpace: 'nowrap' }}
    >
      Details
    </button>
  );
  return slot ? createPortal(btn, slot) : btn;
}

// ===========================================================================
// UI primitives
// ===========================================================================
const fmtInt = (n) => (n == null ? '—' : Math.round(n).toLocaleString());
const fmtPct = (n, p = 1) => (n == null ? '—' : `${n.toFixed(p)}%`);
const fmtSigned = (n, suffix = '', p = 1) => (n == null || !isFinite(n) ? '—' : `${n > 0 ? '+' : n < 0 ? '−' : '±'}${Math.abs(n).toFixed(p)}${suffix}`);
const tabular = { fontVariantNumeric: 'tabular-nums' };
const eyebrow = { fontFamily: FONT_BODY, fontSize: 10.5, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: C.muted };

function Delta({ value, suffix = '%', size = 13 }) {
  if (value == null || !isFinite(value)) return <span style={{ color: C.muted, fontSize: size }}>—</span>;
  const up = value >= 0;
  const Icon = up ? ArrowUpRight : ArrowDownRight;
  return (
    <span style={{ ...tabular, display: 'inline-flex', alignItems: 'center', gap: 2, fontFamily: FONT_BODY, fontSize: size, fontWeight: 700, color: up ? C.up : C.down }}>
      <Icon size={size + 2} strokeWidth={2.5} />
      {Math.abs(value).toFixed(1)}{suffix}
    </span>
  );
}

// Hover (or focus) the number to see how to read it in plain English.
function Explain({ text, children, block, alignRight }) {
  const [open, setOpen] = useState(false);
  if (!text) return children;
  return (
    <span
      tabIndex={0}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
      style={{ position: 'relative', display: block ? 'block' : 'inline-block', cursor: 'help', outline: 'none' }}
    >
      <span style={{ textDecoration: 'underline dotted', textDecorationThickness: 1.5, textUnderlineOffset: 6, textDecorationColor: '#9A9A9A' }}>{children}</span>
      {open && (
        <span role="tooltip" style={{ position: 'absolute', ...(alignRight ? { right: 0 } : { left: 0 }), top: '100%', marginTop: 8, zIndex: 50, width: 280, background: C.white, border: `1px solid ${C.black}`, borderRadius: 4, boxShadow: `3px 3px 0 ${C.black}`, padding: '8px 11px', fontFamily: FONT_BODY, fontSize: 12.5, lineHeight: 1.45, letterSpacing: 0, fontWeight: 400, textTransform: 'none', fontStyle: 'normal', color: C.black, whiteSpace: 'normal', textAlign: 'left', cursor: 'default' }}>
          {text}
        </span>
      )}
    </span>
  );
}

function Stat({ label, value, muted, sub, explain }) {
  // The breakdown line (e.g. "32 of 370 signups · 115 still in their 7 days")
  // sits behind a small info icon by the label (Nick, Oct 8).
  return (
    <div>
      <div style={{ ...eyebrow, display: 'flex', alignItems: 'center' }}>{label}{sub && <HeaderTip text={sub} size={12} />}</div>
      <div style={{ ...tabular, fontFamily: FONT_DISPLAY, fontSize: 34, lineHeight: 1.05, letterSpacing: '-0.03em', marginTop: 4, color: muted ? C.muted : C.black }}><Explain text={muted ? null : explain}>{value}</Explain></div>
    </div>
  );
}

function StatRow({ children, delta, deltaLabel, always }) {
  const M = useModel();
  // YTD has no prior period: hide period deltas (cards with their own fixed
  // comparison, e.g. vs end of a month, pass `always`).
  if (M.noPrior && !always) delta = undefined;
  // Nick (Oct 8): no prior-period change on the chart cards. Kept the props so
  // this is a one-line revert; the funnel-at-a-glance deltas are unaffected.
  delta = undefined;
  deltaLabel = deltaLabel || `vs ${rangeLabel(M.PRIOR_START, M.PRIOR_END)}`;
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16, marginTop: 22 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px 40px', flex: 1 }}>{children}</div>
      {delta !== undefined && (
        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          <div style={eyebrow}>{deltaLabel}</div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 4 }}>{delta}</div>
        </div>
      )}
    </div>
  );
}

// Subheader collapsed into a small info icon beside the title (Nick, Oct 8):
// the text shows in a small popover only when the icon is clicked; a click
// anywhere else (or Esc) closes it.
function HeaderTip({ text, size = 14 }) {
  const [open, setOpen] = useState(false);
  const ref = React.useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey); };
  }, [open]);
  return (
    <span ref={ref} style={{ position: 'relative', display: 'inline-flex', verticalAlign: 'middle', marginLeft: 6 }}>
      <button
        type="button"
        className="beta-note-btn"
        aria-expanded={open}
        aria-label="About this chart"
        onClick={() => setOpen((v) => !v)}
        style={{ opacity: open ? 0.7 : 0.35 }}
      >
        <Info size={size} strokeWidth={2} />
      </button>
      {open && (
        <span role="tooltip" style={{
          position: 'absolute', top: 'calc(100% + 6px)', left: -6, zIndex: 20, width: 'max-content', maxWidth: 320,
          background: C.white, border: `1px solid ${C.black}`, borderRadius: 4, padding: '7px 10px',
          boxShadow: '2px 2px 0 rgba(0,0,0,0.12)', fontFamily: FONT_BODY, fontSize: 12, fontWeight: 400, lineHeight: 1.45, letterSpacing: 'normal', textTransform: 'none', color: C.muted,
        }}>
          {text}
        </span>
      )}
    </span>
  );
}

// allTime: the card's headline doesn't follow the reporting-period pills (all
// cohorts / running total); shows a small chip so it isn't read as "this period".
// Subtle per-chart conversion-window picker, inline after the card title
// (Nick, Oct 14: moved out of the sticky bar into the charts that use it).
// Each chart keeps its own window; default 7 days.
function ConvWindowPicker({ value, onChange }) {
  return (
    <label className="beta-cw" title="Conversion window: how many days after signing up still count">
      <Clock size={11} strokeWidth={2.25} aria-hidden />
      <select aria-label="Conversion window" value={value} onChange={(e) => onChange(Number(e.target.value))}>
        {CONV_WINDOWS.map((w) => <option key={w} value={w}>{w}-day window</option>)}
      </select>
      <ChevronDown size={11} strokeWidth={2.25} aria-hidden />
    </label>
  );
}

// Dates a card covers (Nick, Oct 20), printed under its title: the reporting
// period, started no earlier than the card's first day of data (`from`) and
// ended no later than its last (`to`).
const cardSpan = (M, from, to) => {
  const a = from && from > M.START ? from : M.START;
  const b = to && to < M.END ? to : M.END;
  return { a, b, empty: a > b };
};
// Chart rows (M.WEEKS buckets) that reach the card's first day of data.
// First day of data per source (charts start here when the range starts earlier).
const maxISO = (...xs) => xs.filter(Boolean).sort().pop();
const FV_RATE_FROM = maxISO(FRAMER_START, SIGNUP_COUNT_START); // visitor → sign up needs both
const STRIPE_START = betaPaying.historyStart || null;
const fromRows = (rows, from) => (from ? rows.filter((r) => (r.end || r.d) >= from) : rows);
function CardRange({ from, to }) {
  const M = useModel();
  const { a, b, empty } = cardSpan(M, from, to);
  return (
    <div style={{ ...tabular, fontFamily: FONT_BODY, fontSize: 12.5, color: C.muted, marginTop: 4 }}>
      {empty
        ? `No data in this period — data starts ${monDay(from)}, ${from.slice(0, 4)}`
        : <>{rangeLabel(a, b)}, {b.slice(0, 4)}{a !== M.START && <span title={`${M.label} starts ${monDay(M.START)}; this chart's data only starts ${monDay(a)}, so it begins there.`}> · earliest available data</span>}{M.WTD && !to && <span> · + {rangeLabel(M.WTD.start, M.WTD.end)} in progress</span>}</>}
    </div>
  );
}
function Card({ title, question, notice, footnote, children, accent = C.purple, allTime, convWindow, from, to, noRange }) {
  // Description is collapsed behind a small info icon (Nick, Oct 8).
  const [showNote, setShowNote] = useState(false);
  const [slot, setSlot] = useState(null);
  return (
    <CardSlotCtx.Provider value={slot}>
    <article style={{
      display: 'flex', flexDirection: 'column', background: C.white, border: `1px solid ${C.black}`,
      borderRadius: 4, padding: '28px 30px 22px', minWidth: 0, position: 'relative',
      // No colored drop shadow (Nick, Oct 20: too much).
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
      <h3 style={{ fontFamily: FONT_BODY, fontSize: 16, lineHeight: 1.35, fontWeight: 700, margin: 0, minWidth: 0 }}>
        {title}
        {question && <HeaderTip text={question} />}
        {convWindow && <span style={{ marginLeft: 6 }}><ConvWindowPicker value={convWindow[0]} onChange={convWindow[1]} /></span>}
        {allTime && (
          <span title={typeof allTime === 'string' ? allTime : 'This headline covers all time and does not change with the reporting period.'} style={{ marginLeft: 8, verticalAlign: 'middle', display: 'inline-block', border: `1px solid ${C.black}`, borderRadius: 999, padding: '1px 8px', fontSize: 10.5, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', background: C.paper, color: C.muted }}>
            {typeof allTime === 'string' ? allTime : 'All time'}
          </span>
        )}
      </h3>
      <div ref={setSlot} style={{ flexShrink: 0, display: 'flex', gap: 8 }} />
      </div>
      {!allTime && !noRange && <CardRange from={from} to={to} />}
      {notice && (
        <div style={{ marginTop: 12, borderRadius: 4, border: `1px solid ${C.black}`, background: C.paper, padding: '8px 12px', fontFamily: FONT_BODY, fontSize: 12, lineHeight: 1.55 }}>
          {notice}
        </div>
      )}
      <div style={{ flex: 1 }}>{children}</div>
      {footnote && (
        <>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
            <button
              type="button"
              className="beta-note-btn"
              aria-expanded={showNote}
              aria-label={showNote ? 'Hide description' : 'Show description'}
              title={showNote ? 'Hide description' : 'About this chart'}
              onClick={() => setShowNote((v) => !v)}
              style={{ opacity: showNote ? 0.7 : 0.35 }}
            >
              <Info size={14} strokeWidth={2} />
            </button>
          </div>
          {showNote && (
            <div style={{ marginTop: 4, fontFamily: FONT_CAPTION, fontStyle: 'italic', fontSize: 11.5, lineHeight: 1.5, color: C.black, opacity: 0.5 }}>
              {footnote}
            </div>
          )}
        </>
      )}
    </article>
    </CardSlotCtx.Provider>
  );
}

function Legend({ items, style, vertical }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 14px', fontFamily: FONT_BODY, fontSize: 11.5, lineHeight: '15px', color: C.muted, margin: '22px 0 10px', ...(vertical ? { flexDirection: 'column', flexWrap: 'nowrap', gap: 7, margin: 0 } : null), ...style }}>
      {items.map((it) => (
        <span key={it.label} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          {it.line ? (
            <span style={{ width: 16, borderTop: `${it.weight || 2}px ${it.dashed ? 'dashed' : 'solid'} ${it.color}` }} />
          ) : (
            <span style={{ width: 10, height: 10, borderRadius: 2, background: it.color, border: `1px solid ${C.black}` }} />
          )}
          {it.label}
          {it.value != null && <span style={{ ...tabular, color: C.black, fontWeight: 700, marginLeft: 2 }}>{it.value}</span>}
        </span>
      ))}
    </div>
  );
}

// Drag-to-zoom (Nick, Oct 13). Drop-in for <ResponsiveContainer> around any
// time-series chart: click and drag horizontally to zoom into that range
// (drag again inside it to zoom further); "Reset zoom" restores the full range.
// Works by slicing the chart's `data` (and any per-point <Cell>s inside a <Bar>,
// so striped in-progress bars stay aligned). A drag never fires the chart's
// onClick (the week / day user lists). Zoom resets when the data changes
// (e.g. a different reporting period).
const flatKids = (kids) => React.Children.toArray(kids).flatMap((k) => (React.isValidElement(k) && k.type === React.Fragment ? flatKids(k.props.children) : [k]));
function ZoomContainer({ height, children }) {
  const chart = React.Children.only(children);
  const full = chart.props.data || [];
  const keyOf = (r) => (r ? r.label ?? r.d ?? r.start ?? r.key ?? '' : '');
  const sig = `${full.length}|${keyOf(full[0])}|${keyOf(full[full.length - 1])}`;
  const [range, setRange] = useState(null); // [a, b] indices into `full`
  const [drag, setDrag] = useState(null); // { i0, l0, i1, l1 } indices into the shown data
  const dragged = React.useRef(false);
  useEffect(() => { setRange(null); setDrag(null); }, [sig]);
  const off = range ? range[0] : 0;
  const data = range ? full.slice(range[0], range[1] + 1) : full;
  const idx = (e) => (e && e.activeTooltipIndex != null && e.activeTooltipIndex >= 0 ? +e.activeTooltipIndex : null);

  const onMouseDown = (e) => {
    const i = idx(e);
    dragged.current = false;
    if (i != null) setDrag({ i0: i, l0: e.activeLabel, i1: i, l1: e.activeLabel });
  };
  const onMouseMove = (e) => {
    if (!drag) return;
    const i = idx(e);
    if (i == null || i === drag.i1) return;
    if (i !== drag.i0) dragged.current = true;
    setDrag({ ...drag, i1: i, l1: e.activeLabel });
  };
  const onMouseUp = () => {
    if (drag && drag.i0 !== drag.i1) {
      const a = Math.min(drag.i0, drag.i1);
      const b = Math.max(drag.i0, drag.i1);
      setRange([off + a, off + b]);
    }
    setDrag(null);
  };
  const origClick = chart.props.onClick;
  const onClick = (...args) => {
    if (dragged.current) { dragged.current = false; return; }
    if (origClick) origClick(...args);
  };

  const kids = flatKids(chart.props.children).map((el) => {
    if (!range || !React.isValidElement(el) || el.type !== Bar) return el;
    const inner = React.Children.toArray(el.props.children);
    const cells = inner.filter((c) => c.type === Cell);
    if (cells.length !== full.length) return el;
    return React.cloneElement(el, {}, [...cells.slice(range[0], range[1] + 1), ...inner.filter((c) => c.type !== Cell)]);
  });
  // ReferenceArea must point at an existing y-axis (some charts use named ids).
  const yAxis = flatKids(chart.props.children).find((el) => React.isValidElement(el) && el.type === YAxis);
  const yAxisId = yAxis?.props.yAxisId ?? 0;
  if (drag && drag.i0 !== drag.i1) {
    kids.push(<ReferenceArea key="__zoom" yAxisId={yAxisId} x1={drag.l0} x2={drag.l1} fill={C.purple} fillOpacity={0.12} stroke={C.purple} strokeOpacity={0.4} ifOverflow="visible" />);
  }
  const zoomed = React.cloneElement(chart, { data, onMouseDown, onMouseMove, onMouseUp, onMouseLeave: () => setDrag(null), onClick }, kids);
  return (
    <div style={{ position: 'relative', userSelect: 'none' }}>
      {range && (
        <button
          type="button"
          onClick={() => { setRange(null); setDrag(null); }}
          style={{ position: 'absolute', top: -4, right: 0, zIndex: 2, border: `1px solid ${C.black}`, borderRadius: 999, background: C.white, cursor: 'pointer', fontFamily: FONT_BODY, fontSize: 11, fontWeight: 600, padding: '2px 10px' }}
        >
          Reset zoom · {periodBound(data[0])} – {periodBound(data[data.length - 1])}
        </button>
      )}
      <ResponsiveContainer width="100%" height={height}>{zoomed}</ResponsiveContainer>
    </div>
  );
}
// Label for a zoom bound: the row's x label (dates for daily rows).
const periodBound = (r) => (r?.d ? monDay(r.d) : r?.label ?? '');

// Hidden-category state for the channel charts' legend toggles.
function useHiddenSet() {
  const [hidden, setHidden] = useState(() => new Set());
  const toggle = (label) => setHidden((prev) => { const n = new Set(prev); if (n.has(label)) n.delete(label); else n.add(label); return n; });
  return { hidden, toggle, showAll: () => setHidden(new Set()) };
}

// Chart with its legend in a column on the right (Nick, Oct 8). On narrow
// screens the legend wraps below the chart.
function SideLegend({ legend, children }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', gap: '20px 40px', marginTop: 24 }}>
      <div style={{ flex: '1 1 480px', minWidth: 0 }}>{children}</div>
      <div style={{ flex: '0 0 270px', paddingTop: 4 }}>{legend}</div>
    </div>
  );
}

// Right-hand legend with each row's count and share of the total (Nick, Oct 8).
// Optional category toggles (Nick, Oct 13): pass `hidden` (a Set of labels) and
// `onToggle(label)` and each row becomes a show/hide switch for its series.
// Counts and % in the table always cover every category.
// Optional (Oct 14, Active users): `totalLabel` / `totalShare` replace the footer's
// "Total {unit}" / "100%", and `note` adds a caption under the table — for
// non-additive metrics where rows can add up to more than the total.
function LegendTable({ title, items, total, unit, hidden, onToggle, onShowAll, totalLabel, totalShare = '100%', note }) {
  const cell = { ...tabular, fontFamily: FONT_BODY, fontSize: 11.5, lineHeight: '15px', textAlign: 'right', whiteSpace: 'nowrap' };
  const toggles = Boolean(onToggle);
  const anyHidden = toggles && hidden && hidden.size > 0;
  return (
    <div>
      {title && <div style={{ ...eyebrow, fontSize: 10, marginBottom: toggles ? 4 : 10 }}>{title}</div>}
      {toggles && (
        <div style={{ fontFamily: FONT_BODY, fontSize: 11, color: C.muted, marginBottom: 10 }}>
          Click a category to hide or show it.
          {anyHidden && <button type="button" onClick={onShowAll} style={{ marginLeft: 6, border: 'none', background: 'none', padding: 0, cursor: 'pointer', fontFamily: FONT_BODY, fontSize: 11, fontWeight: 700, color: C.purple, textDecoration: 'underline', textUnderlineOffset: 2 }}>Show all</button>}
        </div>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) auto auto', columnGap: 12, rowGap: 7, alignItems: 'center' }}>
        {items.map((it) => {
          const off = toggles && hidden?.has(it.label);
          const rowStyle = { opacity: off ? 0.4 : 1, ...(toggles ? { cursor: 'pointer' } : {}) };
          const click = toggles ? () => onToggle(it.label) : undefined;
          const title = toggles ? (off ? `Show ${it.label}` : `Hide ${it.label}`) : undefined;
          return (
            <React.Fragment key={it.label}>
              <span onClick={click} title={title} role={toggles ? 'button' : undefined} aria-pressed={toggles ? !off : undefined} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, minWidth: 0, fontFamily: FONT_BODY, fontSize: 11.5, lineHeight: '15px', color: C.muted, ...rowStyle }}>
                <span style={{ flexShrink: 0, width: 10, height: 10, borderRadius: 2, background: off ? C.white : it.color, border: `1px solid ${C.black}` }} />
                <span style={off ? { textDecoration: 'line-through' } : undefined}>{it.label}</span>
              </span>
              <span onClick={click} title={title} style={{ ...cell, color: C.black, fontWeight: 700, ...rowStyle }}>{fmtInt(it.n)}</span>
              <span onClick={click} title={title} style={{ ...cell, color: C.muted, minWidth: 30, ...rowStyle }}>{fmtPct(pct(it.n, total), 0)}</span>
            </React.Fragment>
          );
        })}
        <span style={{ fontFamily: FONT_BODY, fontSize: 11.5, fontWeight: 700, borderTop: `1px solid ${C.black}`, paddingTop: 6 }}>{totalLabel || `Total ${unit}`}</span>
        <span style={{ ...cell, fontWeight: 700, borderTop: `1px solid ${C.black}`, paddingTop: 6 }}>{fmtInt(total)}</span>
        <span style={{ ...cell, color: C.muted, borderTop: `1px solid ${C.black}`, paddingTop: 6 }}>{totalShare}</span>
      </div>
      {note && <div style={{ marginTop: 10, fontFamily: FONT_CAPTION, fontStyle: 'italic', fontSize: 11, lineHeight: 1.45, color: C.muted }}>{note}</div>}
    </div>
  );
}

function StageHeader({ n, prefix, title, subtitle, right, definition }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: '4px 16px', borderBottom: `1px solid ${C.black}`, paddingBottom: 14, margin: '64px 0 28px' }}>
      <h2 style={{ fontFamily: FONT_DISPLAY, fontWeight: 400, fontSize: 28, lineHeight: 1.15, letterSpacing: '-0.03em', margin: 0 }}>
        {n != null && <span style={{ color: C.purple }}>Stage {n}: </span>}{prefix && <span style={{ color: C.purple }}>{prefix}: </span>}{title}
        {subtitle && <HeaderTip text={subtitle} size={16} />}
      </h2>
      {/* Visible definition next to the title (Nick, Oct 8: Stage 3 states what "activated" means). */}
      {definition && (
        <span style={{ alignSelf: 'center', display: 'inline-flex', alignItems: 'baseline', gap: 6, border: `1px solid ${C.black}`, borderRadius: 999, background: C.white, padding: '4px 12px', fontFamily: FONT_BODY, fontSize: 12.5, lineHeight: 1.35 }}>
          {definition}
        </span>
      )}
      {right && <div style={{ marginLeft: 'auto', alignSelf: 'center' }}>{right}</div>}
    </div>
  );
}

// Two columns like the blueprint; one column on narrow screens.
const PAGE_CSS = `.beta-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:32px 28px;align-items:stretch}
.beta-grid > .full{grid-column:1 / -1}
.period-date{font-family:inherit;font-size:13px;font-weight:600;color:#000;background:#fff;border:1px solid #000;border-radius:8px;padding:5px 8px;box-shadow:2px 2px 0 #000}
.af-seg{transition:box-shadow 80ms}
.af-seg:hover{box-shadow:4px 4px 0 ${C.black}!important;z-index:2!important}
.af-seg:focus-visible{outline:2px solid ${C.black};outline-offset:2px}
@media (max-width: 760px){.af-grid{grid-template-columns:repeat(2,minmax(0,1fr))!important}}
.beta-grid.cols-3{grid-template-columns:repeat(3,minmax(0,1fr))}
@media (max-width: 1100px){.beta-grid.cols-3{grid-template-columns:repeat(2,minmax(0,1fr))}}
.beta-funnel-line{display:grid;align-items:stretch}
.bf-groups{display:flex;align-items:stretch}
.bf-group{flex:1 1 0;min-width:0;display:flex;flex-direction:column}
.bf-group-co{margin-left:-16px}
.bf-group:first-child .bf-head{margin-right:28px}
.bf-group-co .bf-head{padding-left:38px}
.bf-head{display:flex;align-items:baseline;gap:4px 10px;flex-wrap:wrap;line-height:16px;padding:0 30px 8px 0;margin-bottom:14px;border-bottom:1px solid #CFCFCF;min-width:0}
.bf-row{flex:1;display:flex;align-items:stretch}
.bf-chev{all:unset;box-sizing:border-box;flex:1 1 0;min-width:0;display:flex;flex-direction:column;align-items:flex-start;text-align:left;padding:22px 36px 22px 42px;background:${C.lightGrey};color:${C.black};clip-path:polygon(0 0,calc(100% - 22px) 0,100% 50%,calc(100% - 22px) 100%,0 100%,22px 50%);transition:background 120ms}
.bf-chev + .bf-chev{margin-left:-16px}
.bf-group:first-child .bf-chev:first-child{padding-left:24px;clip-path:polygon(0 0,calc(100% - 22px) 0,100% 50%,calc(100% - 22px) 100%,0 100%);border-radius:4px 0 0 4px}
.bf-group-co .bf-chev:last-child{padding-right:24px;clip-path:polygon(0 0,100% 0,100% 100%,0 100%,22px 50%)}
button.bf-chev{cursor:pointer}
button.bf-chev:hover{background:${C.lightPurple}}
button.bf-chev[aria-pressed=true]{background:${C.purple}}
button.bf-chev:focus-visible{box-shadow:inset 0 0 0 3px ${C.black}}}
@media (max-width: 1180px){.bf-groups{flex-direction:column;gap:20px}.bf-group-co{margin-left:0}.bf-group:first-child .bf-head{margin-right:0}.bf-group-co .bf-head{padding-left:0}.bf-group-co .bf-chev:first-child{padding-left:24px;clip-path:polygon(0 0,calc(100% - 22px) 0,100% 50%,calc(100% - 22px) 100%,0 100%)}.bf-group:first-child .bf-chev:last-child{padding-right:24px;clip-path:polygon(0 0,100% 0,100% 100%,0 100%,22px 50%)}}
@media (max-width: 760px){.bf-row{flex-direction:column;gap:8px}.bf-groups .bf-chev{clip-path:none!important;margin-left:0!important;padding:18px 20px!important;border-radius:4px!important}.bf-head,.bf-group-co .bf-head{padding:0 0 8px}}
.beta-cw{position:relative;display:inline-flex;align-items:center;gap:3px;vertical-align:middle;padding:1px 6px;border-radius:4px;color:${C.muted};font-family:${FONT_BODY};font-size:12px;font-weight:600;cursor:pointer;transition:background 120ms,color 120ms;white-space:nowrap}
.beta-cw:hover,.beta-cw:focus-within{background:${C.paper};color:${C.black}}
.beta-cw select{all:unset;cursor:pointer;font:inherit;color:inherit}
.beta-cw select:focus-visible{outline:none}
.beta-cw:has(select:focus-visible){outline:2px solid ${C.purple};outline-offset:1px}
.beta-note-btn{all:unset;cursor:pointer;display:inline-flex;padding:2px;border-radius:999px;color:${C.black};transition:opacity 120ms}
.beta-note-btn:hover{opacity:0.8 !important}
.beta-note-btn:focus-visible{outline:2px solid ${C.purple};outline-offset:2px}
@media (max-width: 900px){.beta-grid{grid-template-columns:minmax(0,1fr);gap:24px}}
@media (max-width: 760px){.beta-funnel-line{grid-template-columns:minmax(0,1fr)!important;gap:14px!important}.beta-funnel-arrow{display:none!important}}`;
const Grid = ({ children, cols }) => <div className={`beta-grid${cols === 3 ? ' cols-3' : ''}`}>{children}</div>;

// Hatch pattern for the in-progress week.
const hatchId = (color) => `hatch-${color.replace('#', '')}`;
// NOTE: called as a plain function ({hatchDefs([...])}), not as <HatchDefs />:
// Recharts only renders children it recognises (a raw <defs> element is fine,
// a custom component is silently dropped — which is why the stripes never
// showed before).
function hatchDefs(colors) {
  return (
    <defs key="hatch-defs">
      {colors.map((c) => (
        // Week in progress: full fill, with very faint white stripes on top.
        <pattern key={c} id={hatchId(c)} width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="8" height="8" fill={c} />
          <line x1="0" y1="0" x2="0" y2="8" stroke="#FFFFFF" strokeWidth="2.5" strokeOpacity="0.32" />
        </pattern>
      ))}
    </defs>
  );
}

const tick = { fontFamily: FONT_BODY, fontSize: 11, fill: C.black };
// interval 'preserveStartEnd' + minTickGap: recharts skips labels that would
// overlap on narrow cards (Nick, Oct 7) instead of drawing them on top of each other.
const xAxis = { dataKey: 'label', tick, tickLine: false, axisLine: { stroke: C.black }, tickMargin: 6, interval: 'preserveStartEnd', minTickGap: 10 };
const yAxis = { tick, tickLine: false, axisLine: false, width: 44 };
const grid = <CartesianGrid vertical={false} stroke={C.grid} />;
const chartMargin = { top: 6, right: 16, left: -6, bottom: 0 }; // right room so the last date label isn't clipped
const fmtK = (v) => (v >= 1000 ? `${(v / 1000).toFixed(v >= 10000 ? 0 : 1)}k` : v);

function TooltipBox({ title, rows, note }) {
  return (
    <div style={{ background: C.white, border: `1px solid ${C.black}`, borderRadius: 4, padding: '8px 12px', fontFamily: FONT_BODY, fontSize: 12, minWidth: 190, boxShadow: `3px 3px 0 ${C.black}` }}>
      <div style={{ fontWeight: 700, marginBottom: 4 }}>{title}</div>
      {rows.map((r) => (
        <div key={r.label} style={{ display: 'flex', justifyContent: 'space-between', gap: 16, lineHeight: 1.7 }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: C.muted }}>
            {r.color && <span style={{ width: 8, height: 8, borderRadius: 2, background: r.color, border: `1px solid ${C.black}` }} />}
            {r.label}
          </span>
          <span style={{ ...tabular, fontWeight: 700 }}>{r.value}</span>
        </div>
      ))}
      {note && <div style={{ marginTop: 4, color: C.muted, fontFamily: FONT_CAPTION, fontStyle: 'italic' }}>{note}</div>}
    </div>
  );
}
const weekTitle = (w) => w.title || `Week of ${w.range}${w.partial ? ' (in progress)' : ''}`;
// Column charts switch to months in Fiscal YTD (M.MONTHLY_COLS); these keep
// titles / modal subtitles / footnotes right for either grain.
const periodTitle = (p) => weekTitle(p);
const periodPhrase = (p) => (p.grain === 'day' ? `on ${p.title}` : p.grain === 'month' || p.monthly ? `in ${p.title}` : `week of ${p.range}`);
const colNote = (M) => barWeekNote(M);
const cursor = { fill: 'rgba(167,59,245,0.06)' };

// ===========================================================================
// PLG funnel at a glance
// ===========================================================================
// Sections a click can open. Line 1 opens by transition; line 2 by company stage.
const VIEWS = {
  visitors: { title: 'Website visitors', short: 'Website visitors' },
  signup: { title: 'Visitor → sign up', short: 'Visitor → sign up' },
  activation: { title: 'Sign up → activated', short: 'Sign up → activated' },
  paid: { title: 'Paid companies', short: 'Paid' },
  retained: { title: 'Retained companies', short: 'Retained' },
  expanding: { title: 'Expanding companies', short: 'Expanding' },
};
const DEFAULT_VIEW = 'signup';
const readHashView = () => {
  if (typeof window === 'undefined') return DEFAULT_VIEW;
  const h = (window.location.hash || '').replace('#', '');
  return VIEWS[h] ? h : DEFAULT_VIEW;
};

// Chevron funnel bar (Nick, Oct 15): one row of arrow-shaped cells, each a
// stage with its count and a white chip for the step conversion. The selected
// stage fills purple (black text — brand rule: white text only on black).
function FunnelChip({ rate, of, delta }) {
  return (
    <span className="bf-chip" style={{ ...tabular, display: 'inline-flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', alignSelf: 'flex-start', background: C.white, border: `1px solid ${C.black}`, borderRadius: 14, padding: '4px 12px', fontFamily: FONT_BODY, fontSize: 13, lineHeight: 1.3, color: C.black }}>
      <b>{rate}</b><span>{of}</span>
      {delta && <><span aria-hidden style={{ width: 1, alignSelf: 'stretch', background: C.lightGrey }} />{delta}</>}
    </span>
  );
}

function FunnelCell({ id, view, setView, label, value, chip, dim }) {
  const selected = id != null && view === id;
  const body = (
    <>
      <div style={{ fontFamily: FONT_BODY, fontSize: 14, fontWeight: 700, lineHeight: 1.25 }}>{label}</div>
      <div style={{ ...tabular, fontFamily: FONT_DISPLAY, fontSize: 44, lineHeight: 1, letterSpacing: '-0.03em', margin: '10px 0 12px', color: dim ? 'rgba(0,0,0,0.3)' : C.black }}>{value}</div>
      {chip}
    </>
  );
  if (id == null) return <div className="bf-chev">{body}</div>;
  return (
    <button type="button" className="bf-chev" aria-pressed={selected} onClick={() => setView(id)} title={`Show ${VIEWS[id].title} charts`}>
      {body}
    </button>
  );
}

function PlgFunnel({ view, setView }) {
  const M = useModel();
  const { END, START, WINDOW } = M;
  const W = WINDOW;
  const P = PAYING ? PAYING.asOf(M.END) : null;
  return (
    <section style={{ background: C.white, border: `1px solid ${C.black}`, borderRadius: 4, padding: '28px 32px 30px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 22 }}>
        <div style={{ fontFamily: FONT_BODY, fontSize: 14, fontWeight: 700 }}>
          PLG funnel at a glance
          <span style={{ fontWeight: 400, color: C.muted, marginLeft: 10 }}>{M.label} · {rangeLabel(START, END)}</span>
          {M.WTD_STATS && (
            <div style={{ fontWeight: 400, fontSize: 12.5, color: C.muted, marginTop: 4 }}>
              <span style={{ ...eyebrow, fontSize: 10, marginRight: 8 }}>Week to date · {rangeLabel(M.WTD_STATS.start, M.WTD_STATS.end)}</span>
              {fmtInt(M.WTD_STATS.visitors)} visitors · {fmtInt(M.WTD_STATS.signups)} sign ups · {fmtInt(M.WTD_STATS.activated)} activated <span style={{ fontStyle: 'italic' }}>(in progress, not in the totals below)</span>
            </div>
          )}
        </div>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: C.black, color: C.white, borderRadius: 999, padding: '5px 12px', fontFamily: FONT_BODY, fontSize: 12, fontWeight: 600 }}>
          <MousePointerClick size={14} /> Click a stage to see its charts
        </span>
      </div>

      {/* Two groups (users | companies), each a header rule + 3 chevrons. One row on
          wide screens, a row per group below 1180px, stacked boxes below 760px. */}
      <div className="bf-groups">
        <div className="bf-group">
          <div className="bf-head"><span style={eyebrow}>Users</span></div>
          <div className="bf-row">
            {/* Framer since Oct 16 (GA4: W.visitors / W.convAdj, kept in the model). */}
            <FunnelCell id="visitors" view={view} setView={setView} label="Website visitors" value={fmtInt(M.FRAMER.visitors)} />
            <FunnelCell id="signup" view={view} setView={setView} label="Sign ups" value={fmtInt(W.signups)}
              chip={<FunnelChip rate={fmtPct(M.FRAMER.conv, 1)} of="of visitors" delta={<Delta value={ptsDiff(M.FRAMER.conv, M.FRAMER.convPrev)} suffix=" pts" size={12} />} />} />
            <FunnelCell id="activation" view={view} setView={setView} label="Activated" value={fmtInt(W.activated)}
              chip={<FunnelChip rate={fmtPct(W.actConv, 1)} of="of sign ups" delta={<Delta value={M.noPrior ? null : ptsDiff(W.actConv, W.actConvPrev)} suffix=" pts" size={12} />} />} />
          </div>
        </div>
        <div className="bf-group bf-group-co">
          <div className="bf-head">
            <span style={eyebrow}>Companies</span>
            <span style={{ fontFamily: FONT_CAPTION, fontStyle: 'italic', fontSize: 12, color: C.muted }}>{PAYING ? 'Paid + retained from Stripe · expanding soon' : 'From stripe-dash — coming soon'}</span>
          </div>
          <div className="bf-row">
            {P
              ? <FunnelCell id="paid" view={view} setView={setView} label="Paying companies" value={fmtInt(P.companies)}
                  chip={<FunnelChip rate={fmtPct(P.conv, 1)} of="sign up → paid" />} />
              : <FunnelCell id="paid" view={view} setView={setView} label="Paying companies" value="—" dim />}
            {RETENTION
              ? <FunnelCell id="retained" view={view} setView={setView} label="Retained companies" value={fmtPct(RETENTION.m1Rate, 1)}
                  chip={<FunnelChip rate={`${fmtInt(RETENTION.m1Kept)} of ${fmtInt(RETENTION.m1Base)}`} of="kept past month 1" />} />
              : <FunnelCell id="retained" view={view} setView={setView} label="Retained companies" value="—" dim />}
            <FunnelCell id="expanding" view={view} setView={setView} label="Expanding companies" value="—" dim />
          </div>
        </div>
      </div>
    </section>
  );
}

function ViewingBar({ view }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 14, margin: '36px 0 0', padding: '16px 24px', border: `1px solid ${C.black}`, borderRadius: 4, background: C.lightPurple }}>
      <span style={{ background: C.black, color: C.white, borderRadius: 999, padding: '4px 12px', fontFamily: FONT_BODY, fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' }}>Viewing</span>
      <span style={{ fontFamily: FONT_DISPLAY, fontSize: 26, letterSpacing: '-0.03em', lineHeight: 1.1 }}>{VIEWS[view].title}</span>
    </div>
  );
}

// ===========================================================================
// Charts
// ===========================================================================
// Weekly visitors split so the in-progress week draws as a dotted tail
// (a partial week would otherwise look like a drop).


function WebsiteVisitorsCard() {
  const M = useModel();
  const { VISITOR_LINE, WINDOW } = M;
  return (
    <Card
      accent={C.blue}
      title="Website visitors"
      question="How many people are we getting to the site?"
      footnote={`GA4 sessions: every visit, engaged or not (the dashboard used engaged sessions until Oct 15; the live dashboard still does). Before Jul 17 GA4 also counted bot traffic, so those weeks run about 8× higher than today (Apr–Jun ≈ 6,200 sessions a day vs ≈ 800 since Sep 22). ${M.SHOWS_CUR ? 'Dotted segment = week in progress.' : 'Full weeks only; the week in progress is left off.'} No goal set yet.`}
    >
      <StatRow delta={<Delta value={pctChange(WINDOW.visitors, WINDOW.visitorsPrev)} />}>
        <Stat label={`Actual · ${rangeLabel(M.START, M.END)}`} value={fmtInt(WINDOW.visitors)} explain={`The site had ${fmtInt(WINDOW.visitors)} visits (GA4 sessions) from ${rangeLabel(M.START, M.END)}.`} />
        <Stat label="Goal" value="—" muted />
      </StatRow>
      <Legend items={[{ label: 'Sessions (weekly)', color: C.black, line: true }, { label: 'Goal (not set)', color: '#9A9A9A', line: true, dashed: true }]} />
      <ZoomContainer height={190}>
        <LineChart data={VISITOR_LINE} margin={chartMargin}>
          {grid}
          <XAxis {...xAxis} />
          <YAxis {...yAxis} tickFormatter={fmtK} domain={[0, 'auto']} />
          <Tooltip content={({ active, payload }) => active && payload?.length ? (
            <TooltipBox title={weekTitle(payload[0].payload)} rows={[{ label: 'Sessions', value: fmtInt(payload[0].payload.visitors), color: C.black }]} />
          ) : null} />
          <Line dataKey="visitorsFull" stroke={C.black} strokeWidth={2.5} dot={false} activeDot={{ r: 4, fill: C.blue, stroke: C.black }} isAnimationActive={false} />
          <Line dataKey="visitorsPartial" stroke={C.black} strokeWidth={2} strokeDasharray="2 4" dot={false} activeDot={{ r: 4, fill: C.blue, stroke: C.black }} legendType="none" isAnimationActive={false} />
        </LineChart>
      </ZoomContainer>
    </Card>
  );
}

// Website visitors from Framer Analytics (Nick, Oct 16) — sits beside the GA4
// card. Unique Framer visitors per week (see FRAMER_* above).
const framerWinLabel = (F) => rangeLabel(F.winStart, F.winEnd);
function FramerVisitorsCard() {
  const M = useModel();
  const F = M.FRAMER;
  const clipped = F.winStart !== M.START;
  return (
    <Card from={FRAMER_START}
      accent={C.blue}
      title="Website visitors"
      question="How many people are we getting to the site?"
      footnote={`Framer Analytics unique visitors (npm run ingest-framer, export ${monDay(FRAMER_START)} – ${monDay(FRAMER_END)}). Framer is cookieless, so unlike GA4 it isn't affected by the Jul 17 cookie banner, and its visitor ids reset daily — a visitor is one person on one day, so a weekly number adds up the days. Only www.mutinyhq.com (plus mutinyhq.com / .co); framer.app previews are left out. Framer doesn't filter bots, but bot-like ids are ~1% of visitors (they mainly inflate pageviews, e.g. the Mar 16 week). ${M.SHOWS_CUR ? 'Dotted segment = week in progress.' : 'Full weeks only; the week in progress is left off.'}${clipped ? ` The export starts ${monDay(FRAMER_START)}, so the headline starts there.` : ''} No goal set yet.`}
    >
      <StatRow delta={<Delta value={pctChange(F.visitors, F.visitorsPrev)} />}>
        <Stat label={`Actual · ${framerWinLabel(F)}`} value={fmtInt(F.visitors)} explain={`${fmtInt(F.visitors)} unique visitors (Framer) from ${framerWinLabel(F)}.${F.visitorsPrev != null ? ` ${fmtInt(F.visitorsPrev)} in the ${M.prior}.` : ''}`} />
        <Stat label="Goal" value="—" muted />
      </StatRow>
      <Legend items={[{ label: `Unique visitors (Framer), ${M.grainAdj}`, color: C.black, line: true }, { label: 'Goal (not set)', color: '#9A9A9A', line: true, dashed: true }]} />
      <ZoomContainer height={190}>
        <LineChart data={fromRows(F.line, FRAMER_START)} margin={chartMargin}>
          {grid}
          <XAxis {...xAxis} />
          <YAxis {...yAxis} tickFormatter={fmtK} domain={[0, 'auto']} />
          <Tooltip content={({ active, payload }) => active && payload?.length ? (
            <TooltipBox title={weekTitle(payload[0].payload)} rows={[{ label: 'Unique visitors', value: payload[0].payload.fv == null ? 'no data' : fmtInt(payload[0].payload.fv), color: C.black }]} />
          ) : null} />
          <Line dataKey="fvFull" stroke={C.black} strokeWidth={2.5} dot={false} activeDot={{ r: 4, fill: C.blue, stroke: C.black }} isAnimationActive={false} />
          <Line dataKey="fvPartial" stroke={C.black} strokeWidth={2} strokeDasharray="2 4" dot={false} activeDot={{ r: 4, fill: C.blue, stroke: C.black }} legendType="none" isAnimationActive={false} />
        </LineChart>
      </ZoomContainer>
    </Card>
  );
}

// Shaded GA4 measurement periods for weekly conversion charts (see CONSENT_ADJ):
// grey = bots counted (not comparable, incl. the mixed Jul 13 week), blue =
// opt-in banner (sessions × factor). Sep 22 onward is unshaded.
function measurementAreas(rows, yAxisId) {
  const pre = rows.filter((w) => w.preBreak);
  const optin = rows.filter((w) => !w.preBreak && w.start <= CONSENT_ADJ.end);
  const lbl = (value, fill) => ({ value, position: 'insideTopLeft', fontFamily: FONT_BODY, fontSize: 10.5, fill });
  const out = [];
  if (pre.length) out.push(<ReferenceArea key="m-pre" {...(yAxisId != null ? { yAxisId } : {})} x1={pre[0].label} x2={pre[pre.length - 1].label} fill={C.lightGrey} fillOpacity={0.7} strokeOpacity={0} ifOverflow="hidden" label={lbl('Bots counted · not comparable', C.muted)} />);
  if (optin.length) out.push(<ReferenceArea key="m-optin" {...(yAxisId != null ? { yAxisId } : {})} x1={optin[0].label} x2={optin[optin.length - 1].label} fill={C.lightBlue} fillOpacity={0.35} strokeOpacity={0} ifOverflow="hidden" label={lbl(`Opt-in banner · visits ×${CONSENT_ADJ.factor}`, C.black)} />);
  return out;
}
const adjNote = `Adjusted for the cookie banner: Jul 17 – Sep 21 sessions × ${CONSENT_ADJ.factor} (GA4 only counted visitors who clicked Accept); before Jul 17 GA4 counted bot traffic, so those weeks aren't comparable and show raw only.`;

function VisitorToSignupCard() {
  const M = useModel();
  const { WEEKLY, WINDOW } = M;
  const clamped = WINDOW.convAdjFrom && WINDOW.convAdjFrom !== M.START;
  const adjRange = WINDOW.convAdjFrom ? rangeLabel(WINDOW.convAdjFrom, M.END) : rangeLabel(M.START, M.END);
  const explain = WINDOW.convAdj == null
    ? `This period is before Jul 17, when GA4 counted bot traffic, so there's no comparable rate. Raw: ${fmtPct(WINDOW.conv, 2)}.`
    : `From ${adjRange}, ${fmtInt(WINDOW.signupsAdj)} signups came from ${fmtInt(Math.round(WINDOW.visitorsAdj))} visits${WINDOW.convAdjScaled ? ` (Jul 17 – Sep 21 visits scaled ×${CONSENT_ADJ.factor} for the opt-in cookie banner)` : ''} — about ${fmtPct(WINDOW.convAdj, 1)}.${clamped ? ' Days before Jul 17 are left out (bot traffic).' : ''} Raw GA4: ${fmtPct(WINDOW.conv, 2)}.`;
  return (
    <Card
      accent={C.blue}
      title="Website visitor → sign up"
      question="What share of visitors create an account?"
      footnote={`Sign ups ÷ GA4 sessions for the same week. Every sign up counts, including repeats by the same person. ${adjNote} No goal set yet.`}
    >
      <StatRow delta={<Delta value={ptsDiff(WINDOW.convAdj, WINDOW.convAdjPrev)} suffix=" pts" />}>
        <Stat label={`Conversion (adjusted) · ${adjRange}`} value={fmtPct(WINDOW.convAdj, 2)} explain={explain} sub={`Raw GA4: ${fmtPct(WINDOW.conv, 2)} (${fmtInt(WINDOW.signups)} signups ÷ ${fmtInt(WINDOW.visitors)} sessions, ${rangeLabel(M.START, M.END)})`} />
        <Stat label="Goal" value="—" muted />
      </StatRow>
      <Legend items={[{ label: 'Adjusted %', color: C.black, line: true }, { label: 'Raw GA4 %', color: '#9A9A9A', line: true, dashed: true }, { label: 'Goal % (not set)', color: '#C8C8C8', line: true, dashed: true, weight: 1 }]} />
      <ZoomContainer height={210}>
        <LineChart data={WEEKLY} margin={chartMargin}>
          {grid}
          {measurementAreas(WEEKLY)}
          <XAxis {...xAxis} />
          <YAxis {...yAxis} domain={[0, 'auto']} tickFormatter={(v) => `${v}%`} />
          <Tooltip content={({ active, payload }) => active && payload?.length ? (() => {
            const w = payload[0].payload;
            return (
              <TooltipBox
                title={weekTitle(w)}
                rows={[
                  { label: 'Adjusted', value: w.preBreak ? 'not comparable' : fmtPct(w.convAdj, 2), color: C.black },
                  { label: 'Raw GA4', value: fmtPct(w.conv, 2) },
                  { label: 'Sign ups', value: fmtInt(w.signups) },
                  { label: 'Sessions', value: fmtInt(w.visitors) },
                  ...(w.adjScaled ? [{ label: `Adjusted sessions (×${CONSENT_ADJ.factor})`, value: fmtInt(Math.round(w.visitorsAdj)) }] : []),
                ]}
                note={w.preBreak ? 'Bot traffic was counted before Jul 17.' : w.adjScaled ? 'Opt-in banner: GA4 only counted visitors who clicked Accept.' : null}
              />
            );
          })() : null} />
          <Line dataKey="conv" stroke="#9A9A9A" strokeWidth={1.5} strokeDasharray="4 3" dot={false} activeDot={false} isAnimationActive={false} />
          <Line dataKey="convAdj" stroke={C.black} strokeWidth={2.5} dot={false} connectNulls={false} activeDot={{ r: 4, fill: C.blue, stroke: C.black }} isAnimationActive={false} />
        </LineChart>
      </ZoomContainer>
    </Card>
  );
}

function CumulativeVisitorsCard() {
  const M = useModel();
  const { WEEKLY, WEEKS } = M;
  const total = WEEKLY[WEEKLY.length - 1]?.cumVisitors;
  return (
    <Card
      accent={C.blue}
      title="Total website visitors (cumulative)"
      question="Are we on pace?"
      footnote={`Running total of GA4 sessions since ${monDay(WEEKS[0].start)}. No goal set yet — a goal line will be added once we have one.`}
    >
      <StatRow>
        <Stat label={`Actual · since ${monDay(WEEKS[0].start)}`} value={fmtInt(total)} explain={`${fmtInt(total)} visits in total since ${monDay(WEEKS[0].start)}.`} />
        <Stat label="Goal" value="—" muted />
        <Stat label="Vs goal" value="—" muted />
      </StatRow>
      <Legend items={[{ label: 'Cumulative actual', color: C.black, line: true }, { label: 'Cumulative goal (not set)', color: '#9A9A9A', line: true, dashed: true }]} />
      <ZoomContainer height={190}>
        <LineChart data={WEEKLY} margin={chartMargin}>
          {grid}
          <XAxis {...xAxis} />
          <YAxis {...yAxis} tickFormatter={fmtK} />
          <Tooltip content={({ active, payload }) => active && payload?.length ? (
            <TooltipBox title={weekTitle(payload[0].payload)} rows={[
              { label: 'Cumulative visitors', value: fmtInt(payload[0].payload.cumVisitors), color: C.black },
              { label: 'This week', value: fmtInt(payload[0].payload.visitors) },
            ]} />
          ) : null} />
          <Line dataKey="cumVisitors" stroke={C.black} strokeWidth={2.5} dot={false} activeDot={{ r: 4, fill: C.purple, stroke: C.black }} isAnimationActive={false} />
        </LineChart>
      </ZoomContainer>
    </Card>
  );
}

// Website visitor → high-intent visitor (Nick, Oct 13; sessions since Oct 15). Of all
// sessions, what share visited at least one hypothesized high-intent page
// (pricing, customers, case studies, use cases — the filter lives in GA4 / Apps Script).
//   numerator   ← GA4 File 4 highIntentSessions (deduped per session by GA4)
//   denominator ← GA4 File 1 sessions
// Weekly reach = Σ high-intent ÷ Σ sessions × 100. Never average daily %s.
function HighIntentReachCard() {
  const M = useModel();
  const { WEEKLY, WINDOW } = M;
  const has = WINDOW.hiReach != null;
  return (
    <Card
      accent={C.blue}
      title="Website visitor → high-intent visitor"
      question={(
        <>
          <span style={{ display: 'block', color: C.black, fontWeight: 600 }}>What share of visits reach a high-intent page?</span>
          <span style={{ display: 'block', marginTop: 6 }}>Each week: visits that viewed at least one high-intent page ÷ all visits on the site. A visit counts once, even if it saw several high-intent pages. A rough read on how well the site steers traffic toward buying-consideration content.</span>
          <span style={{ display: 'block', marginTop: 6 }}>High-intent pages: pricing (/pricing), customer stories (/customers/…), case studies (/case-studies/…), and use-case pages (/use-cases/…).</span>
        </>
      )}
      footnote={`High-intent sessions ÷ all GA4 sessions for the same week (session counts summed first, then divided). High-intent = a session that viewed at least one hypothesized high-intent page (pricing, customers, case studies, use cases); a session that hits several still counts once. GA4 tracking changed around Jul 17 (CookieYes consent banner), when total sessions dropped ~94%, so compare reach within, not across, that line. ${lineWeekNote(M)} No goal set yet.`}
    >
      <StatRow delta={has ? <Delta value={ptsDiff(WINDOW.hiReach, WINDOW.hiReachPrev)} suffix=" pts" /> : null}>
        <Stat
          label={`Reach · ${rangeLabel(WINDOW.hiStart || M.START, M.END)}`}
          value={has ? fmtPct(WINDOW.hiReach, 1) : '—'}
          muted={!has}
          explain={has ? `From ${rangeLabel(WINDOW.hiStart, M.END)}, ${fmtInt(WINDOW.highIntent)} of ${fmtInt(WINDOW.hiVisitors)} visits reached a high-intent page — about ${fmtPct(WINDOW.hiReach, 1)}.${WINDOW.hiStart !== M.START ? ` Starts ${monDay(WINDOW.hiStart)}, the first day of high-intent data.` : ''}` : undefined}
        />
        <Stat label="Goal" value="—" muted />
      </StatRow>
      <Legend items={[{ label: 'High-intent reach %', color: C.black, line: true }, { label: 'Goal % (not set)', color: '#9A9A9A', line: true, dashed: true }]} />
      <ZoomContainer height={190}>
        <LineChart data={WEEKLY} margin={chartMargin}>
          {grid}
          <XAxis {...xAxis} />
          <YAxis {...yAxis} domain={[0, 'auto']} tickFormatter={(v) => `${v}%`} />
          <Tooltip content={({ active, payload }) => active && payload?.length ? (
            <TooltipBox title={weekTitle(payload[0].payload)} rows={[
              { label: 'High-intent reach', value: payload[0].payload.hiReach == null ? '—' : fmtPct(payload[0].payload.hiReach, 1), color: C.black },
              { label: 'High-intent sessions', value: payload[0].payload.highIntent == null ? '—' : fmtInt(payload[0].payload.highIntent) },
              { label: 'All sessions', value: fmtInt(payload[0].payload.allSessions) },
            ]} />
          ) : null} />
          <Line dataKey="hiReach" stroke={C.black} strokeWidth={2.5} dot={false} activeDot={{ r: 4, fill: C.blue, stroke: C.black }} connectNulls={false} isAnimationActive={false} />
        </LineChart>
      </ZoomContainer>
    </Card>
  );
}

// High-intent pages viewed (Nick, Oct 13). For each individual URL in GA4
// File 5 (every page under /pricing, /use-cases, /customers, /case-studies — subpages kept
// separate): Σ page sessions in the period (bars show the count since Oct 15;
// share of File 1 site sessions kept in the tooltip). Pages must
// not be summed into folder reach (a session can view several pages). This is
// page-level session reporting: GA4's page-dimension sessions
// isn't validated as equal to a session-scoped segment per URL.
const PAGE_SECTIONS = [
  { key: 'pricing', label: 'Pricing', rx: /^\/pricing/, color: C.purple },
  { key: 'customers', label: 'Customers', rx: /^\/customers/, color: C.green },
  { key: 'case-studies', label: 'Case studies', rx: /^\/case-studies/, color: C.red },
  { key: 'use-cases', label: 'Use cases', rx: /^\/use-cases/, color: C.blue },
];
const pageSection = (path) => PAGE_SECTIONS.find((s) => s.rx.test(path)) || { key: 'other', label: 'Other', color: C.lightGrey };
const pageSessionsIn = (a, b) => {
  const out = Object.fromEntries(HIGH_INTENT_PAGES.map((p) => [p, 0]));
  HIGH_INTENT_PAGE_ROWS.forEach((r) => { if (r.d >= a && r.d <= b) out[r.path] += r.n; });
  return out;
};

// Y-axis URL label (Nick, Oct 15): right-aligned, truncated with an ellipsis
// to fit the axis width (measured in the real font), full URL on hover.
const PATH_AXIS_W = 250;
const PATH_FONT_PX = 11.5;
let measureCtx = null;
const textWidth = (str) => {
  const font = `${PATH_FONT_PX}px ${FONT_BODY}`;
  try {
    // Web font not loaded yet → conservative estimate so labels never overflow.
    if (document.fonts && !document.fonts.check(font)) return str.length * PATH_FONT_PX * 0.62;
    if (!measureCtx) measureCtx = document.createElement('canvas').getContext('2d');
    measureCtx.font = font;
    return measureCtx.measureText(str).width;
  } catch (e) {
    return str.length * PATH_FONT_PX * 0.62;
  }
};
const fitWithEllipsis = (str, maxW) => {
  if (textWidth(str) <= maxW) return str;
  let lo = 0, hi = str.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (textWidth(`${str.slice(0, mid)}…`) <= maxW) lo = mid; else hi = mid - 1;
  }
  return `${str.slice(0, lo)}…`;
};
function PathTick({ x, y, payload }) {
  const full = payload?.value ?? '';
  const shown = fitWithEllipsis(full, PATH_AXIS_W - 14);
  return (
    <g transform={`translate(${x},${y})`} style={{ cursor: 'default' }}>
      <title>{full}</title>
      <text x={0} y={0} dy={4} textAnchor="end" fontFamily={FONT_BODY} fontSize={PATH_FONT_PX} fill={C.black}>{shown}</text>
    </g>
  );
}

function HighIntentPagesCard() {
  const M = useModel();
  // Clamp to File 5's first day like the reach card (Fiscal YTD starts Feb 1).
  const pStart = HIGH_INTENT_START && M.START < HIGH_INTENT_START ? HIGH_INTENT_START : M.START;
  const engaged = sumSessions(pStart, M.END); // all site sessions
  const engagedPrev = sumSessions(M.PRIOR_START, M.PRIOR_END);
  const cur = pageSessionsIn(pStart, M.END);
  const prev = pageSessionsIn(M.PRIOR_START, M.PRIOR_END);
  const rows = HIGH_INTENT_PAGES
    .map((path) => ({
      path,
      n: cur[path],
      share: pct(cur[path], engaged),
      nPrev: M.noPrior ? null : prev[path],
      sharePrev: M.noPrior ? null : pct(prev[path], engagedPrev),
      color: pageSection(path).color,
    }))
    // Rank on absolute sessions only (Nick, Oct 15: no 0.1% share cutoff).
    .filter((r) => r.n > 0)
    .sort((a, b) => b.n - a.n || a.path.localeCompare(b.path))
    .slice(0, 10); // Top 10 only (Nick, Oct 15)
  const top = rows[0];
  const has = engaged > 0 && rows.length > 0;
  return (
    <div className="full">
      <Card
        accent={C.blue}
        title="Top 10 high-intent pages — Sessions"
        question={(
          <>
            <span style={{ display: 'block', color: C.black, fontWeight: 600 }}>Which 10 high-intent pages get the most sessions?</span>
            <span style={{ display: 'block', marginTop: 6 }}>For each page: the number of sessions that included a view of that page, for the selected period. The page can be viewed anywhere in the session, not just as the landing page. A session that views the same page several times counts once.</span>
            <span style={{ display: 'block', marginTop: 6 }}>Each URL is shown on its own (e.g. /use-cases/account-executives is separate from /use-cases). One session can view several pages and count under each, so the bars don't add up to the high-intent session total above. Use the reach card for overall reach.</span>
            <span style={{ display: 'block', marginTop: 6 }}>High-intent pages: pricing (/pricing), customer stories (/customers/…), case studies (/case-studies/…), and use-case pages (/use-cases/…).</span>
          </>
        )}
        footnote={`Page-level session reporting (GA4 page-path breakdown). For each URL: number of sessions that viewed that page, for ${rangeLabel(pStart, M.END)} (not raw pageviews — repeat views in one session count once). Hover a bar for its share of all ${fmtInt(engaged)} site sessions. Shows the 10 pages with the most sessions; every page under /pricing, /customers, /case-studies and /use-cases is ranked on its own (e.g. /use-cases/account-executives is separate from /use-cases). Counts shouldn't be added together: one session can view several pages, so it shows up under each. For overall reach, use the high-intent reach card above. GA4's per-page sessions haven't been validated against a session-scoped segment per URL, so treat these as directional page-level numbers.`}
      >
        <StatRow>
          <Stat
            label={`Top page · ${rangeLabel(pStart, M.END)}`}
            value={top ? `${top.path} · ${fmtInt(top.n)}` : '—'}
            muted={!top}
            explain={top ? `${fmtInt(top.n)} sessions viewed ${top.path} (${fmtPct(top.share, 1)} of the site's ${fmtInt(engaged)} sessions).` : undefined}
          />
        </StatRow>
        <Legend items={PAGE_SECTIONS.map((s) => ({ label: s.label, color: s.color }))} />
        {has ? (
          <ResponsiveContainer width="100%" height={rows.length * 30 + 12}>
            <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 56, left: 0, bottom: 4 }} barCategoryGap={6}>
              <CartesianGrid horizontal={false} stroke={C.grid} />
              <XAxis type="number" tick={tick} tickLine={false} axisLine={{ stroke: C.black }} tickFormatter={(v) => fmtInt(v)} domain={[0, 'auto']} />
              <YAxis type="category" dataKey="path" tick={<PathTick />} tickLine={false} axisLine={false} width={PATH_AXIS_W} interval={0} />
              <Tooltip cursor={cursor} content={({ active, payload }) => active && payload?.length ? (
                <TooltipBox title={payload[0].payload.path} rows={[
                  { label: 'Page sessions', value: fmtInt(payload[0].payload.n), color: payload[0].payload.color },
                  { label: 'Share of site sessions', value: fmtPct(payload[0].payload.share, 2) },
                  { label: 'Site sessions', value: fmtInt(engaged) },
                  ...(M.noPrior ? [] : [{ label: `${M.prior[0].toUpperCase()}${M.prior.slice(1)}`, value: `${fmtInt(payload[0].payload.nPrev)} (${fmtPct(payload[0].payload.sharePrev, 2)})` }]),
                ]} note={
                  <div style={{ width: 250, whiteSpace: 'normal', lineHeight: 1.45, borderTop: `1px solid ${C.grid}`, paddingTop: 6, marginTop: 4 }}>
                    Sessions that viewed this page in {rangeLabel(pStart, M.END)}. Sessions that saw several pages count under each, so counts don't add up.
                  </div>
                } />
              ) : null} />
              <Bar dataKey="n" isAnimationActive={false} stroke={C.black} strokeWidth={1} radius={[0, 2, 2, 0]}>
                {rows.map((r) => <Cell key={r.path} fill={r.color} />)}
                <LabelList dataKey="n" position="right" formatter={(v) => fmtInt(v)} style={{ fontFamily: FONT_BODY, fontSize: 11, fontWeight: 700, fill: C.black }} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <div style={{ height: 120, border: `1px dashed #BDBDBD`, borderRadius: 4, background: C.paper, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: FONT_CAPTION, fontStyle: 'italic', fontSize: 14, color: C.muted }}>
            No high-intent page views in this period
          </div>
        )}
      </Card>
    </div>
  );
}

// High-intent visitor → sign up (Nick, Oct 13): same calculation as
// Website visitor → sign up, with high-intent sessions (GA4 File 4)
// replacing all sessions. Weekly signups ÷ weekly high-intent sessions.
// A ratio of two weekly totals, not a tracked path: signups aren't joined to
// the sessions they came from.
function HighIntentToSignupCard() {
  const M = useModel();
  const { WEEKLY, WINDOW } = M;
  const has = WINDOW.hiConv != null;
  return (
    <Card
      accent={C.purple}
      title="High-intent visitor → sign up"
      question={(
        <>
          <span style={{ display: 'block', color: C.black, fontWeight: 600 }}>Do high-intent visitors create an account?</span>
          <span style={{ display: 'block', marginTop: 6 }}>Each week: company-creator signups ÷ sessions that viewed at least one high-intent page.</span>
          <span style={{ display: 'block', marginTop: 6 }}>Only signups that created a new company count. People accepting an invite or joining a teammate's company, and signups that never set up a company, are left out, since they mostly don't arrive through the website.</span>
          <span style={{ display: 'block', marginTop: 6 }}>It's a ratio of two weekly totals, not a tracked path: a signup counts whether or not that person saw a high-intent page.</span>
          <span style={{ display: 'block', marginTop: 6 }}>High-intent pages: pricing (/pricing), customer stories (/customers/…), case studies (/case-studies/…), and use-case pages (/use-cases/…).</span>
        </>
      )}
      footnote={`Company-creator signups ÷ GA4 high-intent sessions for the same week (each total summed first, then divided). Company creator = the signup created a new company; accepted invites, people joining a teammate's existing company, and signups that never set up a company are excluded. Repeat signups by the same person still count if each created a company; internal (@mutinyhq.com, @gomomentic.com test account) signups are left out. Signups aren't linked to the sessions they came from, so this compares two weekly totals rather than following people from a high-intent page to signup, and it can run high. GA4 tracking changed around Jul 20, so compare within, not across, that line. ${lineWeekNote(M)} No goal set yet.`}
    >
      <StatRow delta={has ? <Delta value={ptsDiff(WINDOW.hiConv, WINDOW.hiConvPrev)} suffix=" pts" /> : null}>
        <Stat
          label={`Conversion · ${rangeLabel(WINDOW.hiStart || M.START, M.END)}`}
          value={has ? fmtPct(WINDOW.hiConv, 1) : '—'}
          muted={!has}
          explain={has ? `From ${rangeLabel(WINDOW.hiStart, M.END)}, ${fmtInt(WINDOW.hiCreators)} company-creator signups vs ${fmtInt(WINDOW.highIntent)} high-intent sessions — about ${fmtPct(WINDOW.hiConv, 1)}.${WINDOW.hiStart !== M.START ? ` Starts ${monDay(WINDOW.hiStart)}, the first day of high-intent data.` : ''}` : undefined}
        />
        <Stat label="Goal" value="—" muted />
      </StatRow>
      <Legend items={[{ label: 'Actual %', color: C.black, line: true }, { label: 'Goal % (not set)', color: '#9A9A9A', line: true, dashed: true }]} />
      <ZoomContainer height={190}>
        <LineChart data={WEEKLY} margin={chartMargin}>
          {grid}
          <XAxis {...xAxis} />
          <YAxis {...yAxis} domain={[0, 'auto']} tickFormatter={(v) => `${v}%`} />
          <Tooltip content={({ active, payload }) => active && payload?.length ? (
            <TooltipBox title={weekTitle(payload[0].payload)} rows={[
              { label: 'High-intent → sign up', value: fmtPct(payload[0].payload.hiConv, 1), color: C.black },
              { label: 'Company-creator sign ups', value: fmtInt(payload[0].payload.creators) },
              { label: 'High-intent sessions', value: fmtInt(payload[0].payload.highIntent) },
              { label: 'All sign ups (for reference)', value: fmtInt(payload[0].payload.signups) },
            ]} />
          ) : null} />
          <Line dataKey="hiConv" stroke={C.black} strokeWidth={2.5} dot={false} activeDot={{ r: 4, fill: C.purple, stroke: C.black }} connectNulls={false} isAnimationActive={false} />
        </LineChart>
      </ZoomContainer>
    </Card>
  );
}

// ===========================================================================
// Framer versions of the visitor cards (Nick, Oct 16). Same definitions as the
// GA4 cards above, with Framer unique visitors in place of GA4 sessions. No
// consent adjustment / bot shading: Framer is cookieless and the counts are
// consistent across the year. The GA4 cards stay in the file, unrendered.
// ===========================================================================
const FRAMER_SRC_NOTE = `Visitors = Framer Analytics unique visitors (Framer resets visitor ids daily, so one person on one day; weekly numbers add up the days). Only www.mutinyhq.com.`;
const HI_PAGES_LINE = 'High-intent pages: pricing (/pricing), customer stories (/customers/…), case studies (/case-studies/…), and use-case pages (/use-cases/…).';
const rateFromNote = (M, F) => (F.rateStart !== M.START ? ` Starts ${monDay(F.rateStart)}${F.rateStart === SIGNUP_COUNT_START ? ', when sign up counts begin' : ', the first day of Framer data'}.` : '');

function FramerVisitorToSignupCard() {
  const M = useModel();
  const F = M.FRAMER;
  const range = rangeLabel(F.rateStart, F.winEnd);
  return (
    <Card from={FV_RATE_FROM}
      accent={C.blue}
      title="Website visitor → sign up"
      question="What share of visitors create an account?"
      footnote={`Sign ups ÷ Framer unique visitors for the same days (each total summed first, then divided). Every sign up counts, including repeats by the same person; never-completed and internal (@mutinyhq.com, @gomomentic.com test account) sign ups are left out. ${FRAMER_SRC_NOTE} No cookie-banner adjustment is needed (Framer is cookieless). ${lineWeekNote(M)} No goal set yet.`}
    >
      <StatRow delta={<Delta value={ptsDiff(F.conv, F.convPrev)} suffix=" pts" />}>
        <Stat label={`Conversion · ${range}`} value={fmtPct(F.conv, 2)} explain={`From ${range}, ${fmtInt(F.convSignups)} sign ups came from ${fmtInt(F.convVisitors)} visitors — about ${fmtPct(F.conv, 1)}.${rateFromNote(M, F)}`} sub={`${fmtInt(F.convSignups)} sign ups ÷ ${fmtInt(F.convVisitors)} visitors`} />
        <Stat label="Goal" value="—" muted />
      </StatRow>
      <Legend items={[{ label: 'Visitor → sign up %', color: C.black, line: true }, { label: 'Goal % (not set)', color: '#9A9A9A', line: true, dashed: true }]} />
      <ZoomContainer height={210}>
        <LineChart data={fromRows(F.line, FV_RATE_FROM)} margin={chartMargin}>
          {grid}
          <XAxis {...xAxis} />
          <YAxis {...yAxis} domain={[0, 'auto']} tickFormatter={(v) => `${v}%`} />
          <Tooltip content={({ active, payload }) => active && payload?.length ? (() => {
            const w = payload[0].payload;
            return (
              <TooltipBox title={weekTitle(w)} rows={[
                { label: 'Visitor → sign up', value: w.conv == null ? '—' : fmtPct(w.conv, 2), color: C.black },
                { label: 'Sign ups', value: fmtInt(w.signups) },
                { label: 'Visitors', value: w.fv == null ? '—' : fmtInt(w.fv) },
              ]} note={w.conv == null && w.fv != null ? 'Sign ups are only counted from Feb 16.' : null} />
            );
          })() : null} />
          <Line dataKey="conv" stroke={C.black} strokeWidth={2.5} dot={false} connectNulls={false} activeDot={{ r: 4, fill: C.blue, stroke: C.black }} isAnimationActive={false} />
        </LineChart>
      </ZoomContainer>
    </Card>
  );
}

// High-intent website visitors (Nick, Oct 20): the count, not the share —
// replaces "Website visitor → high-intent visitor" (reach card kept, hidden).
function FramerHighIntentVisitorsCard() {
  const M = useModel();
  const F = M.FRAMER;
  const range = rangeLabel(F.winStart, F.winEnd);
  const data = fromRows(F.line, FRAMER_START).map((w, i, all) => ({ ...w, hiFull: w.partial ? null : w.hi, hiPartial: w.partial || all[i + 1]?.partial ? w.hi : null }));
  return (
    <Card from={FRAMER_START}
      accent={C.blue}
      title="High-intent website visitors"
      question={(
        <>
          <span style={{ display: 'block', color: C.black, fontWeight: 600 }}>How many visitors reach a high-intent page?</span>
          <span style={{ display: 'block', marginTop: 6 }}>{HI_PAGES_LINE}</span>
        </>
      )}
      footnote={`Framer unique visitors who viewed at least one page under /pricing, /customers, /case-studies or /use-cases that day — same filter as the GA4 Apps Script; several high-intent pages still count once. ${FRAMER_SRC_NOTE} ${lineWeekNote(M)} No goal set yet.`}
    >
      <StatRow delta={<Delta value={pctChange(F.highIntent, F.highIntentPrev)} />}>
        <Stat label={`Actual · ${range}`} value={fmtInt(F.highIntent)} explain={`${fmtInt(F.highIntent)} high-intent visitors from ${range} — ${fmtPct(F.hiReach, 1)} of all ${fmtInt(F.visitors)} visitors.${F.highIntentPrev != null ? ` ${fmtInt(F.highIntentPrev)} in the ${M.prior}.` : ''}`} />
        <Stat label="Goal" value="—" muted />
      </StatRow>
      <Legend items={[{ label: `High-intent visitors, ${M.grainAdj}`, color: C.black, line: true }, { label: 'Goal (not set)', color: '#9A9A9A', line: true, dashed: true }]} />
      <ZoomContainer height={190}>
        <LineChart data={data} margin={chartMargin}>
          {grid}
          <XAxis {...xAxis} />
          <YAxis {...yAxis} tickFormatter={fmtK} domain={[0, 'auto']} allowDecimals={false} />
          <Tooltip content={({ active, payload }) => active && payload?.length ? (
            <TooltipBox title={weekTitle(payload[0].payload)} rows={[
              { label: 'High-intent visitors', value: payload[0].payload.hi == null ? '—' : fmtInt(payload[0].payload.hi), color: C.black },
              { label: 'Share of all visitors', value: payload[0].payload.hiReach == null ? '—' : fmtPct(payload[0].payload.hiReach, 1) },
              { label: 'All visitors', value: payload[0].payload.fv == null ? '—' : fmtInt(payload[0].payload.fv) },
            ]} />
          ) : null} />
          <Line dataKey="hiFull" stroke={C.black} strokeWidth={2.5} dot={false} activeDot={{ r: 4, fill: C.blue, stroke: C.black }} isAnimationActive={false} />
          <Line dataKey="hiPartial" stroke={C.black} strokeWidth={2} strokeDasharray="2 4" dot={false} activeDot={{ r: 4, fill: C.blue, stroke: C.black }} legendType="none" isAnimationActive={false} />
        </LineChart>
      </ZoomContainer>
    </Card>
  );
}

function FramerHighIntentReachCard() {
  const M = useModel();
  const F = M.FRAMER;
  const range = rangeLabel(F.winStart, F.winEnd);
  return (
    <Card from={FRAMER_START}
      accent={C.blue}
      title="Website visitor → high-intent visitor"
      question={(
        <>
          <span style={{ display: 'block', color: C.black, fontWeight: 600 }}>What share of visitors reach a high-intent page?</span>
          <span style={{ display: 'block', marginTop: 6 }}>Each week: visitors who viewed at least one high-intent page ÷ all visitors. A visitor counts once, even if they saw several high-intent pages. A rough read on how well the site steers traffic toward buying-consideration content.</span>
          <span style={{ display: 'block', marginTop: 6 }}>{HI_PAGES_LINE}</span>
        </>
      )}
      footnote={`High-intent visitors ÷ all Framer unique visitors for the same week (summed first, then divided). High-intent = viewed at least one page under /pricing, /customers, /case-studies or /use-cases that day — same filter as the GA4 Apps Script; several high-intent pages still count once. ${FRAMER_SRC_NOTE} ${lineWeekNote(M)} No goal set yet.`}
    >
      <StatRow delta={<Delta value={ptsDiff(F.hiReach, F.hiReachPrev)} suffix=" pts" />}>
        <Stat label={`Reach · ${range}`} value={fmtPct(F.hiReach, 1)} explain={`From ${range}, ${fmtInt(F.highIntent)} of ${fmtInt(F.visitors)} visitors reached a high-intent page — about ${fmtPct(F.hiReach, 1)}.`} />
        <Stat label="Goal" value="—" muted />
      </StatRow>
      <Legend items={[{ label: 'High-intent reach %', color: C.black, line: true }, { label: 'Goal % (not set)', color: '#9A9A9A', line: true, dashed: true }]} />
      <ZoomContainer height={190}>
        <LineChart data={fromRows(F.line, FRAMER_START)} margin={chartMargin}>
          {grid}
          <XAxis {...xAxis} />
          <YAxis {...yAxis} domain={[0, 'auto']} tickFormatter={(v) => `${v}%`} />
          <Tooltip content={({ active, payload }) => active && payload?.length ? (
            <TooltipBox title={weekTitle(payload[0].payload)} rows={[
              { label: 'High-intent reach', value: payload[0].payload.hiReach == null ? '—' : fmtPct(payload[0].payload.hiReach, 1), color: C.black },
              { label: 'High-intent visitors', value: payload[0].payload.hi == null ? '—' : fmtInt(payload[0].payload.hi) },
              { label: 'All visitors', value: payload[0].payload.fv == null ? '—' : fmtInt(payload[0].payload.fv) },
            ]} />
          ) : null} />
          <Line dataKey="hiReach" stroke={C.black} strokeWidth={2.5} dot={false} activeDot={{ r: 4, fill: C.blue, stroke: C.black }} connectNulls={false} isAnimationActive={false} />
        </LineChart>
      </ZoomContainer>
    </Card>
  );
}

function FramerHighIntentPagesCard() {
  const M = useModel();
  const F = M.FRAMER;
  const pStart = F.winStart;
  const pEnd = F.winEnd;
  const visitors = F.visitors;
  const prevOk = !M.noPrior && M.PRIOR_START >= FRAMER_START;
  const visitorsPrev = prevOk ? sumFramer(M.PRIOR_START, M.PRIOR_END) : null;
  const cur = framerPagesIn(pStart, pEnd);
  const prev = prevOk ? framerPagesIn(M.PRIOR_START, M.PRIOR_END) : null;
  const rows = FRAMER_PAGES
    .map((path) => ({
      path,
      n: cur[path],
      share: pct(cur[path], visitors),
      nPrev: prev ? prev[path] : null,
      sharePrev: prev ? pct(prev[path], visitorsPrev) : null,
      color: pageSection(path).color,
    }))
    .filter((r) => r.n > 0)
    .sort((a, b) => b.n - a.n || a.path.localeCompare(b.path))
    .slice(0, 10);
  const top = rows[0];
  const has = visitors > 0 && rows.length > 0;
  return (
    <div className="full">
      <Card from={FRAMER_START}
        accent={C.blue}
        title="Top 10 high-intent pages — Visitors"
        question={(
          <>
            <span style={{ display: 'block', color: C.black, fontWeight: 600 }}>Which 10 high-intent pages get the most visitors?</span>
            <span style={{ display: 'block', marginTop: 6 }}>For each page: the number of visitors who viewed it in the selected period, anywhere in their visit (not just as the landing page). Repeat views by the same visitor that day count once.</span>
            <span style={{ display: 'block', marginTop: 6 }}>Each URL is shown on its own (e.g. /use-cases/account-executives is separate from /use-cases). One visitor can view several pages and count under each, so the bars don't add up to the high-intent total above. Use the reach card for overall reach.</span>
            <span style={{ display: 'block', marginTop: 6 }}>{HI_PAGES_LINE}</span>
          </>
        )}
        footnote={`Framer pageviews by URL, counted as unique visitors per page for ${rangeLabel(pStart, pEnd)} (not raw pageviews). Hover a bar for its share of all ${fmtInt(visitors)} visitors. Shows the 10 pages with the most visitors; trailing slashes and letter case are ignored, so /pricing/ and /pricing are one page. Counts shouldn't be added together: a visitor who viewed several pages shows up under each. ${FRAMER_SRC_NOTE}`}
      >
        <StatRow>
          <Stat
            label={`Top page · ${rangeLabel(pStart, pEnd)}`}
            value={top ? `${top.path} · ${fmtInt(top.n)}` : '—'}
            muted={!top}
            explain={top ? `${fmtInt(top.n)} visitors viewed ${top.path} (${fmtPct(top.share, 1)} of the site's ${fmtInt(visitors)} visitors).` : undefined}
          />
        </StatRow>
        <Legend items={PAGE_SECTIONS.map((s) => ({ label: s.label, color: s.color }))} />
        {has ? (
          <ResponsiveContainer width="100%" height={rows.length * 30 + 12}>
            <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 56, left: 0, bottom: 4 }} barCategoryGap={6}>
              <CartesianGrid horizontal={false} stroke={C.grid} />
              <XAxis type="number" tick={tick} tickLine={false} axisLine={{ stroke: C.black }} tickFormatter={(v) => fmtInt(v)} domain={[0, 'auto']} />
              <YAxis type="category" dataKey="path" tick={<PathTick />} tickLine={false} axisLine={false} width={PATH_AXIS_W} interval={0} />
              <Tooltip cursor={cursor} content={({ active, payload }) => active && payload?.length ? (
                <TooltipBox title={payload[0].payload.path} rows={[
                  { label: 'Page visitors', value: fmtInt(payload[0].payload.n), color: payload[0].payload.color },
                  { label: 'Share of site visitors', value: fmtPct(payload[0].payload.share, 2) },
                  { label: 'Site visitors', value: fmtInt(visitors) },
                  ...(prev ? [{ label: `${M.prior[0].toUpperCase()}${M.prior.slice(1)}`, value: `${fmtInt(payload[0].payload.nPrev)} (${fmtPct(payload[0].payload.sharePrev, 2)})` }] : []),
                ]} note={
                  <div style={{ width: 250, whiteSpace: 'normal', lineHeight: 1.45, borderTop: `1px solid ${C.grid}`, paddingTop: 6, marginTop: 4 }}>
                    Visitors who viewed this page in {rangeLabel(pStart, pEnd)}. Visitors who saw several pages count under each, so counts don't add up.
                  </div>
                } />
              ) : null} />
              <Bar dataKey="n" isAnimationActive={false} stroke={C.black} strokeWidth={1} radius={[0, 2, 2, 0]}>
                {rows.map((r) => <Cell key={r.path} fill={r.color} />)}
                <LabelList dataKey="n" position="right" formatter={(v) => fmtInt(v)} style={{ fontFamily: FONT_BODY, fontSize: 11, fontWeight: 700, fill: C.black }} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <div style={{ height: 120, border: `1px dashed #BDBDBD`, borderRadius: 4, background: C.paper, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: FONT_CAPTION, fontStyle: 'italic', fontSize: 14, color: C.muted }}>
            No high-intent page views in this period
          </div>
        )}
      </Card>
    </div>
  );
}

function FramerHighIntentToSignupCard() {
  const M = useModel();
  const F = M.FRAMER;
  const range = rangeLabel(F.rateStart, F.winEnd);
  return (
    <Card from={FV_RATE_FROM}
      accent={C.purple}
      title="High-intent visitor → sign up"
      question={(
        <>
          <span style={{ display: 'block', color: C.black, fontWeight: 600 }}>Do high-intent visitors create an account?</span>
          <span style={{ display: 'block', marginTop: 6 }}>Each week: company-creator signups ÷ visitors who viewed at least one high-intent page.</span>
          <span style={{ display: 'block', marginTop: 6 }}>Only signups that created a new company count. People accepting an invite or joining a teammate's company, and signups that never set up a company, are left out, since they mostly don't arrive through the website.</span>
          <span style={{ display: 'block', marginTop: 6 }}>It's a ratio of two weekly totals, not a tracked path: a signup counts whether or not that person saw a high-intent page.</span>
          <span style={{ display: 'block', marginTop: 6 }}>{HI_PAGES_LINE}</span>
        </>
      )}
      footnote={`Company-creator signups ÷ Framer high-intent visitors for the same week (each total summed first, then divided). Company creator = the signup created a new company; accepted invites, people joining a teammate's existing company, and signups that never set up a company are excluded. Repeat signups by the same person still count if each created a company; internal (@mutinyhq.com, @gomomentic.com test account) signups are left out. Signups aren't linked to the visitors they came from, so this compares two weekly totals rather than following people from a high-intent page to signup. ${FRAMER_SRC_NOTE} ${lineWeekNote(M)} No goal set yet.`}
    >
      <StatRow delta={<Delta value={ptsDiff(F.hiConv, F.hiConvPrev)} suffix=" pts" />}>
        <Stat
          label={`Conversion · ${range}`}
          value={fmtPct(F.hiConv, 1)}
          explain={`From ${range}, ${fmtInt(F.hiCreators)} company-creator signups vs ${fmtInt(F.hiVisitorsForConv)} high-intent visitors — about ${fmtPct(F.hiConv, 1)}.${rateFromNote(M, F)}`}
        />
        <Stat label="Goal" value="—" muted />
      </StatRow>
      <Legend items={[{ label: 'Actual %', color: C.black, line: true }, { label: 'Goal % (not set)', color: '#9A9A9A', line: true, dashed: true }]} />
      <ZoomContainer height={190}>
        <LineChart data={fromRows(F.line, FV_RATE_FROM)} margin={chartMargin}>
          {grid}
          <XAxis {...xAxis} />
          <YAxis {...yAxis} domain={[0, 'auto']} tickFormatter={(v) => `${v}%`} />
          <Tooltip content={({ active, payload }) => active && payload?.length ? (
            <TooltipBox title={weekTitle(payload[0].payload)} rows={[
              { label: 'High-intent → sign up', value: payload[0].payload.hiConv == null ? '—' : fmtPct(payload[0].payload.hiConv, 1), color: C.black },
              { label: 'Company-creator sign ups', value: fmtInt(payload[0].payload.creators) },
              { label: 'High-intent visitors', value: payload[0].payload.hi == null ? '—' : fmtInt(payload[0].payload.hi) },
              { label: 'All sign ups (for reference)', value: fmtInt(payload[0].payload.signups) },
            ]} />
          ) : null} />
          <Line dataKey="hiConv" stroke={C.black} strokeWidth={2.5} dot={false} activeDot={{ r: 4, fill: C.purple, stroke: C.black }} connectNulls={false} isAnimationActive={false} />
        </LineChart>
      </ZoomContainer>
    </Card>
  );
}

function VisitorsByChannelCard() {
  const M = useModel();
  const { CH30 } = M;
  const monthly = M.MONTHLY_COLS;
  const data = monthly ? M.CHANNEL_MONTHLY : M.CHANNEL_WEEKLY;
  const order = [...CHANNELS].sort((a, b) => CH30.sessions[b.key] - CH30.sessions[a.key]);
  // Legend rows toggle channels on/off (Nick, Oct 13).
  const H = useHiddenSet();
  const shown = CHANNELS.filter((c) => !H.hidden.has(c.key));
  const shownTotal = (row) => shown.reduce((t, c) => t + (row[c.key] || 0), 0);
  return (
    <div className="full">
      <Card
        accent={C.blue}
        title="Website visitors by channel"
        question={`Where are visitors coming from? · ${monthly ? 'monthly' : 'weekly'}`}
        footnote={`GA4 sessions by channel, bucketed with the same rules as the live dashboard (LinkedIn split out from Social; search engines and AI referrals combined as Search + AEO). Totals can differ slightly from the Website visitors card because GA4 samples the channel breakdown. ${monthly ? 'Fiscal YTD shows monthly columns; the faintly striped one is the month in progress.' : 'Faintly striped bar = week in progress.'}`}
      >
        <StatRow delta={<Delta value={pctChange(CH30.total, CH30.totalPrev)} />}>
          <Stat label={`Actual · ${rangeLabel(M.START, M.END)}`} value={fmtInt(CH30.total)} explain={`${fmtInt(CH30.total)} visits from ${rangeLabel(M.START, M.END)}, split by where they came from below.`} />
        </StatRow>
        <SideLegend legend={(
          <LegendTable
            title={`${M.label} · ${rangeLabel(M.START, M.END)}`}
            unit="visitors"
            total={CH30.total}
            items={order.map((c) => ({ label: c.key, color: c.color, n: CH30.sessions[c.key] }))}
            hidden={H.hidden}
            onToggle={H.toggle}
            onShowAll={H.showAll}
          />
        )}>
        <ZoomContainer height={420}>
          <BarChart data={data} margin={chartMargin} barCategoryGap="22%">
            {hatchDefs(CHANNELS.map((c) => c.color))}
            {grid}
            <XAxis {...xAxis} />
            <YAxis {...yAxis} tickFormatter={fmtK} />
            <Tooltip cursor={cursor} content={({ active, payload }) => active && payload?.length ? (
              <TooltipBox
                title={monthly ? payload[0].payload.title : weekTitle(payload[0].payload)}
                rows={[...shown].reverse().filter((c) => payload[0].payload[c.key]).map((c) => ({
                  label: c.key, color: c.color,
                  value: `${fmtInt(payload[0].payload[c.key])} · ${fmtPct(pct(payload[0].payload[c.key], payload[0].payload.total), 0)}`,
                }))}
                note={H.hidden.size ? `${fmtInt(shownTotal(payload[0].payload))} of ${fmtInt(payload[0].payload.total)} sessions shown (% = share of all)` : `${fmtInt(payload[0].payload.total)} sessions`}
              />
            ) : null} />
            {shown.map((c) => (
              <Bar key={c.key} dataKey={c.key} stackId="ch" stroke={C.black} strokeWidth={0.5} isAnimationActive={false}>
                {data.map((w) => <Cell key={w.start} fill={w.partial ? `url(#${hatchId(c.color)})` : c.color} />)}
              </Bar>
            ))}
          </BarChart>
        </ZoomContainer>
        </SideLegend>
      </Card>
    </div>
  );
}

// Website visitors by channel — Framer (Nick, Oct 16). Same categories, colors,
// stacking and Fiscal-YTD monthly rule as the GA4 channel charts; one channel
// per visitor (first pageview), so the bars add up to the Framer visitors card.
function FramerVisitorsByChannelCard() {
  const M = useModel();
  const F = M.FRAMER;
  const monthly = M.MONTHLY_COLS;
  const data = fromRows(monthly ? F.monthly : F.weekly, FRAMER_START);
  const used = CHANNELS.filter((c) => FRAMER_CH.some((r) => r.ch === c.key));
  const order = [...used].sort((a, b) => (F.channels[b.key] || 0) - (F.channels[a.key] || 0));
  const H = useHiddenSet();
  const shown = used.filter((c) => !H.hidden.has(c.key));
  const shownTotal = (row) => shown.reduce((t, c) => t + (row[c.key] || 0), 0);
  const total = sumVals(F.channels);
  return (
    <div className="full">
      <Card from={FRAMER_START}
        accent={C.blue}
        title="Website visitors by channel"
        question={`Where are visitors coming from? · ${M.grainAdj}`}
        footnote={`Framer Analytics unique visitors by channel. Each visitor's channel comes from its first pageview that day: utm_source / utm_medium if present, otherwise the referrer (search engines → Search + AEO, chatgpt.com / claude.ai / gemini / perplexity → Search + AEO, linkedin.com and the LinkedIn app → LinkedIn, X / Reddit / Facebook / Instagram / YouTube / Hacker News → Social, Gmail / Outlook / newsletters / utm_medium=email → Email, any other site → Referral, nothing → Direct). Bucketed with the same rules as the GA4 channel charts. Framer only gets a referrer when the browser sends one, so Direct is large (~⅔ of visitors) — it includes dark social, Slack / Teams desktop apps and typed URLs. Channels add up to the Website visitors card. ${monthly ? colNote(M) : 'Faintly striped bar = week in progress.'}`}
      >
        <StatRow delta={<Delta value={pctChange(F.visitors, F.visitorsPrev)} />}>
          <Stat label={`Actual · ${framerWinLabel(F)}`} value={fmtInt(F.visitors)} explain={`${fmtInt(F.visitors)} unique visitors (Framer) from ${framerWinLabel(F)}, split by where they came from below.`} />
        </StatRow>
        <SideLegend legend={(
          <LegendTable
            title={`${M.label} · ${framerWinLabel(F)}`}
            unit="visitors"
            total={total}
            items={order.map((c) => ({ label: c.key, color: c.color, n: F.channels[c.key] || 0 }))}
            hidden={H.hidden}
            onToggle={H.toggle}
            onShowAll={H.showAll}
          />
        )}>
        <ZoomContainer height={420}>
          <BarChart data={data} margin={chartMargin} barCategoryGap="22%">
            {hatchDefs(used.map((c) => c.color))}
            {grid}
            <XAxis {...xAxis} />
            <YAxis {...yAxis} tickFormatter={fmtK} />
            <Tooltip cursor={cursor} content={({ active, payload }) => active && payload?.length ? (
              <TooltipBox
                title={monthly ? payload[0].payload.title : weekTitle(payload[0].payload)}
                rows={[...shown].reverse().filter((c) => payload[0].payload[c.key]).map((c) => ({
                  label: c.key, color: c.color,
                  value: `${fmtInt(payload[0].payload[c.key])} · ${fmtPct(pct(payload[0].payload[c.key], payload[0].payload.total), 0)}`,
                }))}
                note={H.hidden.size ? `${fmtInt(shownTotal(payload[0].payload))} of ${fmtInt(payload[0].payload.total)} visitors shown (% = share of all)` : `${fmtInt(payload[0].payload.total)} visitors`}
              />
            ) : null} />
            {shown.map((c) => (
              <Bar key={c.key} dataKey={c.key} stackId="ch" stroke={C.black} strokeWidth={0.5} isAnimationActive={false}>
                {data.map((w) => <Cell key={w.start} fill={w.partial ? `url(#${hatchId(c.color)})` : c.color} />)}
              </Bar>
            ))}
          </BarChart>
        </ZoomContainer>
        </SideLegend>
      </Card>
    </div>
  );
}

// Website visitors by channel — Sessions (Active Users Oct 14 → sessions Oct 15).
// Sits directly under the source/medium sessions chart. Same
// categories, colors, x-axis and Fiscal-YTD monthly rule; metric is GA4 sessions:
//   headline + channel table ← Apps Script presets (exact range)
//   bars ← File 6 / 7 (period × channel); black line ← File 8 / 9 (total per
//   week / month). Internal names (AU, auTotal…) are left over from Active Users.
function VisitorsActiveUsersByChannelCard() {
  const M = useModel();
  const { AU } = M;
  const monthly = M.MONTHLY_COLS;
  const baseData = monthly ? AU.monthly : AU.weekly;
  const P = AU.preset;
  const TW = AU.thisWeek;
  const pRange = P ? rangeLabel(P.startDate, P.endDate) : null;
  const sameRange = P && P.startDate === M.START && P.endDate === M.END;
  const chans = P?.channels || {};
  const chSum = sumVals(chans);
  const order = [...CHANNELS].sort((a, b) => (chans[b.key] || 0) - (chans[a.key] || 0));
  const H = useHiddenSet();
  const shown = CHANNELS.filter((c) => !H.hidden.has(c.key));
  const shownSum = (row) => shown.reduce((t, c) => t + (row[c.key] || 0), 0);
  // Line follows the legend toggles (Nick, Oct 14). All categories shown → GA4's
  // deduplicated total. Some hidden → GA4 has no deduplicated figure for a
  // subset of channels, so the line is the visible channels added together
  // (a user in two visible channels counts twice), drawn dashed and labelled so.
  const filtered = H.hidden.size > 0;
  const data = baseData.map((r) => ({ ...r, auLine: filtered ? (r.chSum == null ? null : shownSum(r)) : r.auTotal }));
  const unitWord = monthly ? 'month' : 'week';
  const auTitle = (r) => (monthly
    ? `${r.title.replace(/ \(to .*\)$/, '')}${r.partial ? ` (to ${monDay(r.auThrough)}, in progress)` : ''}`
    : `Week of ${rangeLabel(r.start, r.auThrough)}${r.partial ? ' (in progress)' : ''}`);
  return (
    <div className="full">
      <Card
        accent={C.blue}
        title="Website visitors by channel — Sessions"
        question={(
          <>
            <span style={{ display: 'block', color: C.black, fontWeight: 600 }}>How many visits does the site get, and through which channels? · {monthly ? 'monthly' : 'weekly'}</span>
            <span style={{ display: 'block', marginTop: 6 }}>Same metric as the chart above (GA4 sessions), but channels come straight from GA4's channel group rather than source/medium, and the headline uses the Apps Script's exact preset range.</span>
            <span style={{ display: 'block', marginTop: 6 }}>Each visit has one channel, so the channels add up to the total.</span>
          </>
        )}
        footnote={`GA4 sessions by session channel group. Bars: sessions per ${unitWord} and channel (GA4 ${monthly ? 'File 7, calendar months' : 'File 6, ISO weeks Mon–Sun'}). Black line: GA4's total sessions for each ${unitWord} (${monthly ? 'File 9' : 'File 8'}). The headline and the channel table use GA4's figures precomputed for the exact preset range by the Apps Script, so their dates can differ by a few days from the period at the top${P ? ` (here ${pRange})` : ''}. Channel groups map onto the same categories as the chart above: Organic Search, AI Referrals and Paid Search → Search + AEO; Organic Social, Twitter, Reddit and Paid Social → Social; Organic Social - LinkedIn → LinkedIn; anything else (e.g. Organic Video, Paid Other) → Unassigned. Where several groups share a category their sessions are added. This feed has no source/medium, so unlike the chart above, LinkedIn visits GA4 grouped as plain Organic Social (mostly Feb–May) show under Social, and AI-tool visits GA4 grouped as Referral stay in Referral. ${monthly ? colNote(M) : `${M.mode === '1w' ? 'Last week shows the same columns as Last 4 weeks. ' : ''}The last, faintly striped column is the week in progress${GA4_AU.end ? ` (GA4 data through ${monDay(GA4_AU.end)})` : ''}.`}`}
      >
        <StatRow>
          <Stat
            label={`Sessions · ${pRange || rangeLabel(M.START, M.END)}`}
            value={P ? fmtInt(P.sessions) : '—'}
            muted={!P}
            explain={P ? `${fmtInt(P.sessions)} sessions on the site from ${pRange} (GA4 "${P.label}").${sameRange ? '' : ` That's the Apps Script's preset range; the period at the top is ${rangeLabel(M.START, M.END)}.`}` : 'No sessions preset for this period in the GA4 feed.'}
          />
          {TW && AU.presetKey !== 'thisWeek' && (
            <Stat
              label={`This week so far · ${rangeLabel(TW.startDate, TW.endDate)}`}
              value={fmtInt(TW.sessions)}
              explain={`${fmtInt(TW.sessions)} sessions from ${rangeLabel(TW.startDate, TW.endDate)} (GA4).`}
            />
          )}
        </StatRow>
        {P && !sameRange && (
          <div style={{ marginTop: 6, fontFamily: FONT_CAPTION, fontStyle: 'italic', fontSize: 11.5, color: C.muted }}>
            GA4 preset range {pRange} · period at the top {rangeLabel(M.START, M.END)}
          </div>
        )}
        <SideLegend legend={(
          <LegendTable
            title={`${P?.label || M.label} · ${pRange || rangeLabel(M.START, M.END)}`}
            unit="sessions"
            total={P?.sessions}
            totalLabel="Sessions (total)"
            totalShare=""
            items={order.map((c) => ({ label: c.key, color: c.color, n: chans[c.key] || 0 }))}
            hidden={H.hidden}
            onToggle={H.toggle}
            onShowAll={H.showAll}
            note={P ? `% = share of the ${fmtInt(P.sessions)} sessions.${Math.abs(chSum - P.sessions) > 1 ? ` Channels add up to ${fmtInt(chSum)} (GA4 rounding / thresholding).` : ''}` : null}
          />
        )}>
          <Legend style={{ margin: '0 0 10px' }} items={[filtered
            ? { label: `Sessions, visible channels only`, color: C.black, line: true, dashed: true }
            : { label: `Sessions (GA4 ${unitWord} total)`, color: C.black, line: true }]} />
          <ZoomContainer height={420}>
            <ComposedChart data={data} margin={chartMargin} barCategoryGap="22%">
              {hatchDefs(CHANNELS.map((c) => c.color))}
              {grid}
              <XAxis {...xAxis} />
              <YAxis {...yAxis} tickFormatter={fmtK} />
              <Tooltip cursor={cursor} content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const r = payload[0].payload;
                if (r.chSum == null && r.auTotal == null) return <TooltipBox title={auTitle(r)} rows={[]} note="No GA4 sessions data for this period" />;
                return (
                  <TooltipBox
                    title={auTitle(r)}
                    rows={[
                      ...[...shown].reverse().filter((c) => r[c.key]).map((c) => ({
                        label: c.key, color: c.color,
                        value: `${fmtInt(r[c.key])}${r.auTotal ? ` · ${fmtPct(pct(r[c.key], r.auTotal), 0)}` : ''}`,
                      })),
                      ...(filtered ? [{ label: 'Visible channels added', value: fmtInt(r.auLine), color: C.black }] : []),
                      { label: filtered ? 'All channels' : 'Sessions (total)', value: fmtInt(r.auTotal), color: filtered ? undefined : C.black },
                    ]}
                    note={
                      <div style={{ width: 240, whiteSpace: 'normal', lineHeight: 1.45 }}>
                        {H.hidden.size ? `Shown categories add up to ${fmtInt(shownSum(r))}. ` : ''}% = share of total sessions.
                      </div>
                    }
                  />
                );
              }} />
              {shown.map((c) => (
                <Bar key={c.key} dataKey={c.key} stackId="au" stroke={C.black} strokeWidth={0.5} isAnimationActive={false}>
                  {data.map((w) => <Cell key={w.start} fill={w.partial ? `url(#${hatchId(c.color)})` : c.color} />)}
                </Bar>
              ))}
              <Line dataKey="auLine" stroke={C.black} strokeWidth={2} strokeDasharray={filtered ? '5 4' : undefined} dot={{ r: 2.5, fill: C.black, stroke: C.black }} activeDot={{ r: 4, fill: C.blue, stroke: C.black }} connectNulls={false} isAnimationActive={false} />
            </ComposedChart>
          </ZoomContainer>
        </SideLegend>
      </Card>
    </div>
  );
}

const SR_STACK = [...SELF_REPORTED_BUCKETS, SR_INVITED, SR_JOINED, SR_OTHER]; // bottom → top (Never completed excluded, Oct 15)
const NEVER_MODAL = {
  noun: 'signup', nounPlural: 'signups', showDate: false, viaLabel: 'Role',
  dateOf: (s) => s.d, viaOf: (s) => ROLES.find((r) => r.key === roleKey(s))?.label || '—',
};

function ViewToggle({ value, onChange, options }) {
  return (
    <div role="tablist" style={{ display: 'inline-flex', border: `1px solid ${C.black}`, borderRadius: 999, overflow: 'hidden', background: C.white }}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="tab"
          aria-selected={value === o.value}
          onClick={() => onChange(o.value)}
          style={{ border: 'none', cursor: 'pointer', fontFamily: FONT_BODY, fontSize: 12, fontWeight: 600, padding: '5px 14px', background: value === o.value ? C.black : C.white, color: value === o.value ? C.white : C.black }}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

// Growth view of the channel table: this period vs the prior one, per row.
const srValue = (sr, name) => (
  name === SR_INVITED.name ? sr.invited
    : name === SR_JOINED.name ? sr.joined
      : name === SR_OTHER.name ? sr.other
          : sr.counts[name] || 0
);
const GROWTH_MIN = 10; // rows below this in both periods are greyed (too small to read % change)

function Sparkline({ values, color, width = 120, height = 28 }) {
  if (!values.length) return null;
  const max = Math.max(...values, 1);
  const step = values.length > 1 ? (width - 4) / (values.length - 1) : 0;
  const pts = values.map((v, i) => `${2 + i * step},${height - 3 - (v / max) * (height - 6)}`).join(' ');
  const [lx, ly] = pts.split(' ').pop().split(',');
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true" style={{ display: 'block' }}>
      <polyline points={pts} fill="none" stroke={color} strokeWidth={1.75} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={lx} cy={ly} r={2.5} fill={color} />
    </svg>
  );
}

// Growth view (Nick, Oct 8): each channel's share of the week's sign ups,
// week by week, for the weeks in the reporting period + the week in progress.
function ChannelShareLines({ M, weekly, legend, hidden }) {
  const weeks = weekly.filter((w) => w.end >= M.START);
  const data = weeks.map((w) => {
    const row = { ...w };
    SR_STACK.forEach((b) => { row[`${b.name}__pct`] = w.noData ? null : w.total ? ((w[b.name] || 0) / w.total) * 100 : 0; });
    return row;
  });
  const lines = SR_STACK.filter((b) => weeks.some((w) => w[b.name]) && !hidden?.has(b.name));
  return (
    <SideLegend legend={legend}>
      <ZoomContainer height={420}>
        <LineChart data={data} margin={chartMargin}>
          <CartesianGrid vertical={false} stroke={C.grid} strokeDasharray="4 4" />
          <XAxis {...xAxis} />
          <YAxis {...yAxis} domain={[0, 'auto']} tickFormatter={(v) => `${Math.round(v)}%`} />
          <Tooltip content={({ active, payload }) => active && payload?.length ? (payload[0].payload.noData ? (
            <TooltipBox title={weekTitle(payload[0].payload)} rows={[]} note={`No sign up data yet — the signups export ends ${monDay(DATA_END)}`} />
          ) : (
            <TooltipBox
              title={weekTitle(payload[0].payload)}
              rows={lines.map((b) => ({ b, v: payload[0].payload[`${b.name}__pct`], n: payload[0].payload[b.name] || 0 }))
                .filter((x) => x.n).sort((x, y) => y.v - x.v)
                .map((x) => ({ label: x.b.name, color: x.b.color, value: `${fmtPct(x.v, 1)} · ${fmtInt(x.n)}` }))}
              note={`${fmtInt(payload[0].payload.total)} sign ups`}
            />
          )) : null} />
          {lines.map((b) => (
            <Line
              key={b.name} type="monotone" dataKey={`${b.name}__pct`} name={b.name}
              stroke={b.color} strokeWidth={2}
              dot={{ r: 4, fill: b.color, stroke: C.black, strokeWidth: 1 }}
              activeDot={{ r: 5, fill: b.color, stroke: C.black, strokeWidth: 1 }}
              isAnimationActive={false}
            />
          ))}
        </LineChart>
      </ZoomContainer>
    </SideLegend>
  );
}

function ChannelGrowthTable({ M, th, td }) {
  if (M.noPrior) {
    return (
      <div style={{ marginTop: 16, border: `1px dashed ${C.black}`, borderRadius: 4, background: C.paper, padding: '22px 20px', textAlign: 'center', fontFamily: FONT_BODY, fontSize: 13, color: C.muted }}>
        {M.label} has no full prior period to compare with (sign up data starts Feb 16). Pick a shorter date range to see growth by channel.
      </div>
    );
  }
  const cur = M.SELF_REPORTED;
  const prev = M.SELF_REPORTED_PREV;
  // 12 complete weeks for the trend, whatever the toggle (the week in progress
  // would look like a drop).
  const trendWeeks = getModel('ytd', 'week').SELF_REPORTED_WEEKLY.filter((w) => !w.partial).slice(-12); // always 12 weeks
  const rows = SR_STACK.map((b) => {
    const c = srValue(cur, b.name);
    const p = srValue(prev, b.name);
    return { ...b, c, p, diff: c - p, pctChg: p ? ((c - p) / p) * 100 : null, small: Math.max(c, p) < GROWTH_MIN, trend: trendWeeks.map((w) => srValue(w, b.name)) };
  }).filter((r) => r.c || r.p)
    .sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff) || b.c - a.c);
  const totC = cur.total;
  const totP = prev.total;
  const chg = (n) => (n > 0 ? C.up : n < 0 ? C.down : C.muted);
  return (
    <div style={{ overflowX: 'auto', margin: '20px -30px 0' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 720 }}>
        <thead>
          <tr>
            <th style={{ ...th, textAlign: 'left', paddingLeft: 30 }}>Channel (self-reported)</th>
            <th style={{ ...th, textAlign: 'left' }}>12-week trend</th>
            <th style={th}>{rangeLabel(M.PRIOR_START, M.PRIOR_END)}</th>
            <th style={th}>{rangeLabel(M.START, M.END)}</th>
            <th style={th}>Change</th>
            <th style={{ ...th, paddingRight: 30 }}>% change</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.name} style={r.small ? { color: '#9A9A9A' } : undefined} title={r.small ? `Fewer than ${GROWTH_MIN} signups in both periods — % change is noisy` : undefined}>
              <td style={{ ...td, textAlign: 'left', paddingLeft: 30, fontWeight: 600 }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ width: 10, height: 10, borderRadius: 2, background: r.color, border: `1px solid ${C.black}`, opacity: r.small ? 0.5 : 1 }} />
                  {r.name}
                </span>
              </td>
              <td style={{ ...td, textAlign: 'left', padding: '6px 14px' }}>
                <Sparkline values={r.trend} color={r.small ? '#BDBDBD' : C.black} />
              </td>
              <td style={td}>{fmtInt(r.p)}</td>
              <td style={{ ...td, fontWeight: 600 }}>{fmtInt(r.c)}</td>
              <td style={{ ...td, fontWeight: 700, color: r.small ? '#9A9A9A' : chg(r.diff) }}>{r.diff > 0 ? '+' : r.diff < 0 ? '−' : '±'}{fmtInt(Math.abs(r.diff))}</td>
              <td style={{ ...td, paddingRight: 30, color: r.small ? '#9A9A9A' : chg(r.diff) }}>{r.pctChg == null ? 'new' : fmtSigned(r.pctChg, '%', 0)}</td>
            </tr>
          ))}
          <tr style={{ background: C.paper }}>
            <td style={{ ...td, textAlign: 'left', paddingLeft: 30, fontWeight: 700, borderBottom: 'none' }}>Overall</td>
            <td style={{ ...td, borderBottom: 'none' }} />
            <td style={{ ...td, fontWeight: 700, borderBottom: 'none' }}>{fmtInt(totP)}</td>
            <td style={{ ...td, fontWeight: 700, borderBottom: 'none' }}>{fmtInt(totC)}</td>
            <td style={{ ...td, fontWeight: 700, borderBottom: 'none', color: chg(totC - totP) }}>{totC - totP > 0 ? '+' : totC - totP < 0 ? '−' : '±'}{fmtInt(Math.abs(totC - totP))}</td>
            <td style={{ ...td, paddingRight: 30, fontWeight: 700, borderBottom: 'none', color: chg(totC - totP) }}>{fmtSigned(pctChange(totC, totP), '%', 0)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function SignupsByChannelCard() {
  const M = useModel();
  const { END, SELF_REPORTED, SELF_REPORTED_WEEKLY, SELF_REPORTED_MONTHLY, START, WINDOW } = M;
  const monthly = M.MONTHLY_COLS; // Fiscal YTD: monthly columns (Nick, Oct 13)
  // Legend rows toggle categories on/off in the chart + Growth views (Nick, Oct 13).
  const H = useHiddenSet();
  const shownStack = SR_STACK.filter((b) => !H.hidden.has(b.name));
  const shownTotal = (row) => shownStack.reduce((t, b) => t + (row[b.name] || 0), 0);
  const SR = SELF_REPORTED;
  const total = WINDOW.signups;
  const openUsers = useUsersModal();
  const [view, setViewState] = useState(() => {
    // Weekly chart is the default (Nick, Oct 8). New storage key so an older saved choice doesn't override it.
    try { const v = window.localStorage.getItem('beta-channel-view-v2'); return v === 'table' || v === 'growth' ? v : 'chart'; } catch (e) { return 'chart'; }
  });
  const setView = (v) => { setViewState(v); try { window.localStorage.setItem('beta-channel-view-v2', v); } catch (e) { /* ignore */ } };
  const openNever = (list, subtitle) => openUsers({ ...NEVER_MODAL, title: 'Never completed', subtitle, users: list });

  // Everything except No answer, biggest first (Nick, Oct 7); No answer stays at the bottom.
  const rows = [
    ...SELF_REPORTED_BUCKETS.map((b) => ({ key: b.name, color: b.color, n: SR.counts[b.name], act: SR.actByChannel?.[b.name] })).filter((r) => r.n > 0),
    { key: SR_INVITED.name, sub: SR.perSignup || INVITE_DAILY ? 'User Invitation Completed fired — never asked' : 'available after the next pull-data', color: SR_INVITED.color, n: SR.invited, act: SR.actInvited || SR.actJoined, actCombined: !SR.actInvited },
    { key: SR_JOINED.name, sub: 'joined an existing company without an invite — never asked', color: SR_JOINED.color, n: SR.joined, act: SR.actTeammate || SR.actJoined, actCombined: !SR.actTeammate },
  ].sort((a, b) => b.n - a.n);
  // Other (no answer) stays at the bottom. Never completed is no longer a row
  // (excluded from sign ups, Nick Oct 15) — see the button under the card.
  rows.push({ key: SR_OTHER.name, sub: SR.otherList ? 'created a company, no answer · click to see who' : null, color: SR_OTHER.color, n: SR.other, act: SR.actOther, ...(SR.otherList ? { onClick: () => openUsers({ ...NEVER_MODAL, title: 'Other (no answer)', subtitle: `signed up ${rangeLabel(START, END)}, created a company but no answer or invite in Amplitude`, users: SR.otherList }) } : {}) });
  const maxN = Math.max(...rows.map((r) => r.n || 0), 1);

  const flat = (w) => ({ ...w, ...w.counts, [SR_INVITED.name]: w.invited, [SR_JOINED.name]: w.joined, [SR_OTHER.name]: w.other });
  // Weekly frame (Nick, Oct 14 — same as the Active Users chart): Last week
  // shows the Last 4 weeks columns, and every weekly view runs to the current
  // week. Weeks past the signups export (DATA_END) are placeholders with no
  // bars ("no data yet", not zero). The legend table keeps the selected period.
  const FM = M;
  const weekly = withCurrentWeek(FM.SELF_REPORTED_WEEKLY.map(flat));
  // Column chart data: months in Fiscal YTD, weeks otherwise. (Growth view is a line chart, stays weekly.)
  const cols = fromRows(monthly ? SELF_REPORTED_MONTHLY.map(flat) : weekly, SIGNUP_COUNT_START);
  const th = { ...eyebrow, fontSize: 10, padding: '10px 14px', textAlign: 'right', whiteSpace: 'nowrap', borderBottom: `1px solid ${C.black}`, background: C.paper };
  const td = { ...tabular, fontFamily: FONT_BODY, fontSize: 13.5, padding: '11px 14px', textAlign: 'right', borderBottom: `1px solid ${C.lightGrey}`, whiteSpace: 'nowrap' };
  const soon = <span style={{ color: '#B5B5B5' }}>—</span>;
  return (
    <div className="full">
      <Card from={SIGNUP_COUNT_START}
        accent={C.purple}
        title="Sign ups and conversion by channel"
        question={`Self-reported “How did you hear about us?” · ${view === 'chart' ? M.grainAdj : view === 'growth' ? `share of sign ups, ${M.grainAdj}` : `${M.label} · ${rangeLabel(START, END)}`}`}
        footnote={`${SR.perSignup ? `Every signup in the period (Metabase) is looked up in Amplitude by user id and put in exactly one row: its own “How did you hear about us?” answer (referral_source, bucketed with the same rules as the live dashboard's “User signups by Channel”); otherwise Accepted an invite (fired “User Invitation Completed”); otherwise Joined a teammate's company (its company already had a signup, no invite event); otherwise Other (created a company but no answer in Amplitude). Only company setup asks the question, so joiners are never asked. Rows add up to Overall. Internal (@mutinyhq.com, @gomomentic.com test account) signups are left out, like the rest of this page.` : `Channel = the signup's self-reported answer (Amplitude referral_source daily totals), bucketed with the same rules as the live dashboard's “User signups by Channel”. Only company setup asks the question. Accepted an invite = Amplitude “User Invitation Completed” (daily unique users). Joined a teammate's company = signups on a company that already had an earlier signup (Metabase), minus the accepted invites. Other = what's left. Answers are daily totals here, not per person, so the split is approximate — run npm run pull-amp-events for exact per-signup rows.`} Overall = all Metabase signups in the window, matching the rest of this page. Never-completed signups (no workspace, or one never named) are left out of every sign up number on this page; use “View never-completed sign ups” under the card to see them.${view === 'table' ? ` Sign up → activated = share of the row's signups in the period that have activated (email sent/drafted or asset published) so far, same as the funnel. ${SR.perSignup ? `Every row is exact: it's the share of that row's signups that have activated (hover a cell for the count).` : `It's filled in only where we know each signup's group: the two joiner rows share one rate (${fmtPct(SR.actJoined.rate, 1)}, ${fmtInt(SR.actJoined.k)} of ${fmtInt(SR.actJoined.n)}) because invites vs teammates is only an Amplitude total; channel rows need each person's answer (run npm run pull-amp-events) — together, company creators (the people who were asked) activated at ${fmtPct(SR.actCreators.rate, 1)} (${fmtInt(SR.actCreators.k)} of ${fmtInt(SR.actCreators.n)}).`}` : ''}${view === 'growth' ? ` Growth: each channel's share of that week's sign ups, for the weeks in the reporting period; the last point is the week in progress. Hover a week for counts.` : view === 'chart' ? ` ${monthly ? 'Fiscal YTD shows monthly columns; the faintly striped one is the month in progress.' : `${M.mode === '1w' ? 'Last week shows the same columns as Last 4 weeks; the table on the right is last week only. ' : ''}Faintly striped bar = week in progress. The chart runs to the current week; a week with no bars has no sign up data yet (the signups export ends ${monDay(DATA_END)}).`}` : ' Activated → paid comes from stripe-dash.'}`}
      >
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
          <ViewToggle value={view} onChange={setView} options={[{ value: 'chart', label: `${M.grainLabel} chart` }, { value: 'table', label: 'Table' }, { value: 'growth', label: 'Growth' }]} />
        </div>
        {view === 'growth' ? (
          <ChannelShareLines M={FM} weekly={fromRows(weekly, SIGNUP_COUNT_START)} hidden={H.hidden} legend={(
            <LegendTable
              title={`${M.label} · ${rangeLabel(START, END)}`}
              unit="sign ups"
              total={SR.total}
              items={SR_STACK.map((b) => ({ label: b.name, color: b.color, n: srValue(SR, b.name) })).sort((a, b) => b.n - a.n)}
              hidden={H.hidden}
              onToggle={H.toggle}
              onShowAll={H.showAll}
            />
          )} />
        ) : view === 'chart' ? (
          <>
            <SideLegend legend={(
              <LegendTable
                title={`${M.label} · ${rangeLabel(START, END)}`}
                unit="sign ups"
                total={SR.total}
                items={SR_STACK.map((b) => ({ label: b.name, color: b.color, n: srValue(SR, b.name) })).sort((a, b) => b.n - a.n)}
                hidden={H.hidden}
                onToggle={H.toggle}
                onShowAll={H.showAll}
              />
            )}>
            <ZoomContainer height={420}>
              <BarChart data={cols} margin={chartMargin} barCategoryGap="22%">
                {hatchDefs(SR_STACK.map((b) => b.color))}
                {grid}
                <XAxis {...xAxis} />
                <YAxis {...yAxis} allowDecimals={false} />
                <Tooltip cursor={cursor} content={({ active, payload }) => active && payload?.length ? (payload[0].payload.noData ? (
                  <TooltipBox title={periodTitle(payload[0].payload)} rows={[]} note={`No sign up data yet — the signups export ends ${monDay(DATA_END)}`} />
                ) : (
                  <TooltipBox
                    title={periodTitle(payload[0].payload)}
                    rows={[...shownStack].reverse().filter((b) => payload[0].payload[b.name]).map((b) => ({
                      label: b.name, color: b.color,
                      value: `${fmtInt(payload[0].payload[b.name])} · ${fmtPct(pct(payload[0].payload[b.name], payload[0].payload.total), 1)}`,
                    }))}
                    note={H.hidden.size ? `${fmtInt(shownTotal(payload[0].payload))} of ${fmtInt(payload[0].payload.total)} sign ups shown (% = share of all)` : `${fmtInt(payload[0].payload.total)} sign ups`}
                  />
                )) : null} />
                {cols.filter((w) => w.noData).map((w) => (
                  <ReferenceArea key={`nd-${w.start}`} x1={w.label} x2={w.label} fill={C.lightGrey} fillOpacity={0.5} strokeOpacity={0} ifOverflow="extendDomain"
                    label={{ value: 'No data yet', position: 'insideBottom', offset: 10, style: { fontFamily: FONT_CAPTION, fontStyle: 'italic', fontSize: 11, fill: C.muted } }} />
                ))}
                {shownStack.map((b) => (
                  <Bar key={b.name} dataKey={b.name} stackId="sr" stroke={C.black} strokeWidth={0.5} isAnimationActive={false}>
                    {cols.map((w) => <Cell key={w.start} fill={w.partial ? `url(#${hatchId(b.color)})` : b.color} />)}
                  </Bar>
                ))}
              </BarChart>
            </ZoomContainer>
            </SideLegend>
          </>
        ) : (
          <div style={{ overflowX: 'auto', margin: '20px -30px 0' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 720 }}>
              <thead>
                <tr>
                  <th style={{ ...th, textAlign: 'left', paddingLeft: 30 }}>Channel (self-reported)</th>
                  <th style={{ ...th, textAlign: 'left', width: '34%' }}>Sign ups</th>
                  <th style={th}>% of sign ups</th>
                  <th style={th}>Sign up → activated</th>
                  <th style={{ ...th, paddingRight: 30 }}>Activated → paid</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr
                    key={r.key}
                    onClick={r.onClick}
                    title={r.onClick ? 'Click to list these signups' : undefined}
                    style={{ ...(r.child ? { background: C.paper } : {}), ...(r.onClick ? { cursor: 'pointer' } : {}) }}
                  >
                    <td style={{ ...td, textAlign: 'left', paddingLeft: r.child ? 44 : 22, fontWeight: r.child ? 500 : 600, fontSize: r.child ? 13 : td.fontSize }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                        {r.child
                          ? <span style={{ color: C.muted }}>↳</span>
                          : <span style={{ width: 10, height: 10, borderRadius: 2, background: r.color, border: `1px solid ${C.black}` }} />}
                        <span style={r.onClick ? { textDecoration: 'underline', textUnderlineOffset: 3 } : undefined}>{r.key}</span>
                        {r.sub && <span style={{ fontWeight: 400, fontSize: 12, color: C.muted }}>{r.sub}</span>}
                      </span>
                    </td>
                    <td style={{ ...td, textAlign: 'left' }}>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ height: r.child ? 9 : 12, width: `${Math.max((r.n / maxN) * 75, 1)}%`, background: r.color, border: `1px solid ${C.black}`, borderRadius: 2 }} />
                        <span>{fmtInt(r.n)}</span>
                      </span>
                    </td>
                    <td style={td}>{fmtPct(pct(r.n, total), 1)}</td>
                    <td style={td} title={r.act ? `${fmtInt(r.act.k)} of ${fmtInt(r.act.n)} ${r.act.n === r.n || r.actCombined ? '' : 'matched '}signups activated${r.actCombined ? ' — Accepted an invite + Joined a teammate’s company combined' : ''}` : 'Needs each person’s answer — see the note below'}>
                      {r.act ? (
                        <span>{fmtPct(r.act.rate, 1)} <span style={{ fontSize: 12, color: C.muted }}>({fmtInt(r.act.k)})</span>{r.actCombined && <span style={{ fontSize: 11, color: C.muted, marginLeft: 4 }}>both joiner rows</span>}</span>
                      ) : soon}
                    </td>
                    <td style={{ ...td, paddingRight: 30 }}>{soon}</td>
                  </tr>
                ))}
                <tr style={{ background: C.paper }}>
                  <td style={{ ...td, textAlign: 'left', paddingLeft: 30, fontWeight: 700, borderBottom: 'none' }}>Overall</td>
                  <td style={{ ...td, textAlign: 'left', fontWeight: 700, borderBottom: 'none' }}>{fmtInt(total)}</td>
                  <td style={{ ...td, fontWeight: 700, borderBottom: 'none' }}>100%</td>
                  <td style={{ ...td, fontWeight: 700, borderBottom: 'none' }}>{fmtPct(WINDOW.actConv, 1)} <span style={{ fontSize: 12, fontWeight: 400, color: C.muted }}>({fmtInt(WINDOW.activated)})</span></td>
                  <td style={{ ...td, paddingRight: 30, borderBottom: 'none' }}>{soon}</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 14 }}>
          <button
            type="button"
            onClick={() => openNever(SR.neverList, `signed up ${rangeLabel(START, END)} but never finished onboarding (no workspace, or one never named) — excluded from sign up counts`)}
            title="These signups are excluded from every sign up number on this page"
            style={{ border: 'none', background: 'none', padding: 0, cursor: 'pointer', fontFamily: FONT_BODY, fontSize: 12, color: C.muted, textDecoration: 'underline', textUnderlineOffset: 3 }}
          >
            View never-completed sign ups ({fmtInt(SR.neverList.length)}, excluded) →
          </button>
        </div>
      </Card>
    </div>
  );
}

function CumulativeSignupsCard() {
  const M = useModel();
  const { WEEKLY, WEEKS } = M;
  const total = WEEKLY[WEEKLY.length - 1]?.cumSignups;
  return (
    <div style={{ display: 'grid' }}>
      <Card
        title="Total sign ups (cumulative)"
        question="Are we on pace?"
        footnote={`Running total of every signup (incl. repeats by the same person) since ${monDay(SIGNUP_COUNT_START)}, ${SIGNUP_COUNT_START.slice(0, 4)}, the same start as the live dashboard, shown for the last ${WEEKS.length} weeks. ${lineWeekNote(M)} No goal set yet — the dashed goal line will be added once we have one.`}
      >
        <StatRow>
          <Stat label={`Actual · since ${monDay(SIGNUP_COUNT_START)}`} value={fmtInt(total)} explain={`${fmtInt(total)} signups in total since ${monDay(SIGNUP_COUNT_START)} (someone signing up to two companies counts twice).`} />
          <Stat label="Goal" value="—" muted />
          <Stat label="Vs goal" value="—" muted />
        </StatRow>
        <Legend items={[{ label: 'Cumulative actual', color: C.black, line: true }, { label: 'Cumulative goal (not set)', color: '#9A9A9A', line: true, dashed: true }]} />
        <ZoomContainer height={220}>
          <LineChart data={WEEKLY} margin={chartMargin}>
            {grid}
            <XAxis {...xAxis} />
            <YAxis {...yAxis} tickFormatter={fmtK} domain={['dataMin', 'auto']} allowDecimals={false} />
            <Tooltip content={({ active, payload }) => active && payload?.length ? (
              <TooltipBox title={weekTitle(payload[0].payload)} rows={[
                { label: 'Cumulative sign ups', value: fmtInt(payload[0].payload.cumSignups), color: C.black },
                { label: 'This week', value: fmtInt(payload[0].payload.signups) },
              ]} />
            ) : null} />
            <Line dataKey="cumSignups" stroke={C.black} strokeWidth={2.5} dot={false} activeDot={{ r: 4, fill: C.purple, stroke: C.black }} isAnimationActive={false} />
          </LineChart>
        </ZoomContainer>
      </Card>
    </div>
  );
}

// Enterprise meetings (Nick, Oct 20): HubSpot New Business deals that entered
// Stage 0 "0 - Interest" or Stage 1 "1 - Discovery", dated by whichever came
// first, one per deal (dataJson.hubspot.enterpriseDeals, from pull-data.mjs
// fetchEnterpriseDeals; test / Mutiny deals excluded). Replaced "Talk to Sales"
// form submissions. Counted only through HubSpot's pull day (HS_END).
const DEAL_STAGE_LABELS = {
  '8c55c259-5132-4198-a4b9-36b19723b348': '0 - Interest',
  '4ff97a89-00bc-47ac-9033-876618cff081': '1 - Discovery',
  '51010f0f-8129-4575-a563-2532d0601dc0': '2 - Active Evaluation',
  '69a6ec34-c553-4277-ae9c-7ce286638f48': '3 - Solution Validation',
  'ae106f7a-d9f2-416c-ac87-d99ff715eee3': '4 - Negotiation',
  'a7d68614-73a0-4242-b004-bd907d755028': '5 - Procurement',
  'cbcfae4d-26b1-4768-a004-492f1ee2f074': 'Closed Won',
  '69dbe40f-8288-41df-be7a-9dd2172c902e': 'Closed Lost',
};
const HS_MEETINGS = (dataJson.hubspot?.enterpriseDeals || []).map((m) => ({ ...m, d: `${m.date.slice(0, 4)}-${m.date.slice(4, 6)}-${m.date.slice(6)}`, stageLabel: DEAL_STAGE_LABELS[m.stage] || 'Other stage' }));
const HS_END = dataJson.hubspot?.pulledAt ? dataJson.hubspot.pulledAt.slice(0, 10) : null;
const HS_FIRST = HS_MEETINGS.map((m) => m.d).sort()[0] || null;
const meetingsIn = (a, b) => HS_MEETINGS.filter((m) => m.d >= a && m.d <= b);

function EnterpriseMeetingsCard() {
  const M = useModel();
  const { WEEKLY } = M;
  const end = HS_END && HS_END < M.END ? HS_END : M.END;
  const total = meetingsIn(M.START, end).length;
  const prev = M.noPrior ? null : meetingsIn(M.PRIOR_START, M.PRIOR_END).length;
  const rows = WEEKLY.map((w) => {
    if (!HS_END || w.start > HS_END) return { ...w, meetings: null, subs: [] };
    const last = [w.partial ? DATA_END : w.end, HS_END].sort()[0];
    const subs = meetingsIn(w.start, last);
    return { ...w, meetings: subs.length, subs, hsPartial: w.partial || last < w.end };
  });
  const data = rows.map((w, i) => {
    const next = rows[i + 1];
    const tail = w.hsPartial || (next && next.hsPartial);
    return { ...w, meetingsFull: w.hsPartial ? null : w.meetings, meetingsPartial: tail ? w.meetings : null };
  });
  return (
    <Card from={HS_FIRST} to={HS_END}
      accent={C.red}
      title="Enterprise meetings"
      question="How many new enterprise deals reach Stage 0 or Stage 1?"
      footnote={`HubSpot New Business deals that entered Stage 0 (0 - Interest) or Stage 1 (1 - Discovery), dated by whichever came first; each deal counts once. Test and Mutiny-internal deals are left out. Replaced “Talk to Sales” form submissions on Oct 20. Hover lists each deal's current stage. HubSpot pulled ${HS_END ? monDay(HS_END) : '—'}; a period HubSpot hasn't fully covered yet draws dotted. No goal set yet.`}
    >
      <StatRow delta={prev == null ? null : <Delta value={pctChange(total, prev)} />}>
        <Stat label={`Actual · ${rangeLabel(M.START, end)}`} value={fmtInt(total)} explain={`${fmtInt(total)} enterprise deals reached Stage 0 or 1 from ${rangeLabel(M.START, end)}.${prev != null ? ` ${fmtInt(prev)} in the ${M.prior}.` : ''}`} />
        <Stat label="Goal" value="—" muted />
      </StatRow>
      <Legend items={[{ label: `Enterprise meetings (${M.grainAdj})`, color: C.black, line: true }, { label: 'Goal (not set)', color: '#9A9A9A', line: true, dashed: true }]} />
      <ZoomContainer height={220}>
        <LineChart data={fromRows(data, HS_FIRST)} margin={chartMargin}>
          {grid}
          <XAxis {...xAxis} />
          <YAxis {...yAxis} domain={[0, 'auto']} allowDecimals={false} />
          <Tooltip content={({ active, payload }) => active && payload?.length ? (
            <TooltipBox
              title={weekTitle(payload[0].payload)}
              rows={[
                { label: 'Enterprise meetings', value: payload[0].payload.meetings == null ? '—' : fmtInt(payload[0].payload.meetings), color: C.black },
                ...payload[0].payload.subs.slice(0, 8).map((m, i) => ({ label: m.company || m.name || '—', value: m.stageLabel, key: i })),
              ]}
              note={payload[0].payload.subs.length > 8 ? `+${payload[0].payload.subs.length - 8} more` : undefined}
            />
          ) : null} />
          <Line dataKey="meetingsFull" stroke={C.black} strokeWidth={2.5} dot={false} activeDot={{ r: 4, fill: C.red, stroke: C.black }} isAnimationActive={false} />
          <Line dataKey="meetingsPartial" stroke={C.black} strokeWidth={2} strokeDasharray="2 4" dot={false} activeDot={{ r: 4, fill: C.red, stroke: C.black }} legendType="none" isAnimationActive={false} />
        </LineChart>
      </ZoomContainer>
    </Card>
  );
}

// Sign ups per week (Nick, Oct 20): replaces the cumulative card on the Sign
// ups tab. Weekly in every reporting period, Fiscal YTD included (Nick asked for per week).
// Line chart (Nick, Oct 20); the week in progress draws as a dotted tail.
function WeeklySignupsCard() {
  const M = useModel();
  const { WEEKLY, WINDOW } = M;
  const data = WEEKLY.map((w, i) => {
    const next = WEEKLY[i + 1];
    return { ...w, signupsFull: w.partial ? null : w.signups, signupsPartial: w.partial || next?.partial ? w.signups : null };
  });
  return (
    <Card from={SIGNUP_COUNT_START}
      title="Sign ups"
      question="Are we on pace?"
      footnote={`Every signup in each ${M.grainEach}, including repeat signups by the same person (someone signing up to two companies counts twice); internal (@mutinyhq.com, @gomomentic.com test account) and never-completed signups are left out. ${lineWeekNote(M)}${M.SHOWS_CUR ? ' (dotted)' : ''} No goal set yet.`}
    >
      <StatRow delta={<Delta value={pctChange(WINDOW.signups, WINDOW.signupsPrev)} />}>
        <Stat label={`Actual · ${rangeLabel(M.START, M.END)}`} value={fmtInt(WINDOW.signups)} explain={`${fmtInt(WINDOW.signups)} signups from ${rangeLabel(M.START, M.END)}.${WINDOW.signupsPrev != null ? ` ${fmtInt(WINDOW.signupsPrev)} in the ${M.prior}.` : ''}`} />
        <Stat label="Goal" value="—" muted />
      </StatRow>
      <Legend items={[{ label: `Sign ups (${M.grainAdj})`, color: C.black, line: true }, { label: 'Goal (not set)', color: '#9A9A9A', line: true, dashed: true }]} />
      <ZoomContainer height={220}>
        <LineChart data={fromRows(data, SIGNUP_COUNT_START)} margin={chartMargin}>
          {grid}
          <XAxis {...xAxis} />
          <YAxis {...yAxis} domain={[0, 'auto']} allowDecimals={false} />
          <Tooltip content={({ active, payload }) => active && payload?.length ? (
            <TooltipBox title={weekTitle(payload[0].payload)} rows={[{ label: 'Sign ups', value: fmtInt(payload[0].payload.signups), color: C.black }]} />
          ) : null} />
          <Line dataKey="signupsFull" stroke={C.black} strokeWidth={2.5} dot={false} activeDot={{ r: 4, fill: C.purple, stroke: C.black }} isAnimationActive={false} />
          <Line dataKey="signupsPartial" stroke={C.black} strokeWidth={2} strokeDasharray="2 4" dot={false} activeDot={{ r: 4, fill: C.purple, stroke: C.black }} legendType="none" isAnimationActive={false} />
        </LineChart>
      </ZoomContainer>
    </Card>
  );
}

function NewSignupsCard() {
  const M = useModel();
  const { WEEKLY, WINDOW } = M;
  return (
    <Card
      title="New sign ups"
      question="Are we converting intent into accounts?"
      footnote={`Visitor → signup = signups ÷ GA4 sessions for the same days. Every signup counts, including repeat signups by the same person; internal (@mutinyhq.com, @gomomentic.com test account) signups are left out. ${adjNote} ${barWeekNote(M)}`}
    >
      <StatRow delta={<Delta value={ptsDiff(WINDOW.convAdj, WINDOW.convAdjPrev)} suffix=" pts" />}>
        <Stat label="Visitor → sign up (adjusted)" value={fmtPct(WINDOW.convAdj, 2)} explain={WINDOW.convAdj == null ? `Before Jul 17 GA4 counted bot traffic, so there's no comparable rate. Raw: ${fmtPct(WINDOW.conv, 2)}.` : `About ${fmtPct(WINDOW.convAdj, 1)} of visits turned into a signup from ${rangeLabel(WINDOW.convAdjFrom, M.END)}, after adjusting for the cookie banner. Raw GA4: ${fmtPct(WINDOW.conv, 2)}.`} />
        <Stat label={`Sign ups · ${rangeLabel(M.START, M.END)}`} value={fmtInt(WINDOW.signups)} explain={`${fmtInt(WINDOW.signups)} signups from ${rangeLabel(M.START, M.END)}.`} sub={<Delta value={pctChange(WINDOW.signups, WINDOW.signupsPrev)} size={12} />} />
      </StatRow>
      <Legend items={[{ label: 'Sign ups (bars)', color: C.purple }, { label: 'Visitor → sign up %, adjusted (line)', color: C.black, line: true }]} />
      <ZoomContainer height={190}>
        <ComposedChart data={WEEKLY} margin={chartMargin}>
          {hatchDefs([C.purple])}
          {grid}
          {measurementAreas(WEEKLY, 'n')}
          <XAxis {...xAxis} />
          <YAxis yAxisId="n" {...yAxis} />
          <YAxis yAxisId="p" orientation="right" {...yAxis} tickFormatter={(v) => `${v}%`} />
          <Tooltip cursor={cursor} content={({ active, payload }) => active && payload?.length ? (
            <TooltipBox
              title={weekTitle(payload[0].payload)}
              rows={[
                { label: 'Sign ups', value: fmtInt(payload[0].payload.signups), color: C.purple },
                { label: 'Sessions', value: fmtInt(payload[0].payload.visitors) },
                { label: 'Visitor → sign up (adjusted)', value: payload[0].payload.preBreak ? 'not comparable' : fmtPct(payload[0].payload.convAdj, 2) },
                { label: 'Visitor → sign up (raw)', value: fmtPct(payload[0].payload.conv, 2) },
              ]}
            />
          ) : null} />
          <Bar yAxisId="n" dataKey="signups" stroke={C.black} strokeWidth={1} isAnimationActive={false}>
            {WEEKLY.map((w) => <Cell key={w.start} fill={w.partial ? `url(#${hatchId(C.purple)})` : C.purple} />)}
          </Bar>
          <Line yAxisId="p" dataKey="convAdj" stroke={C.black} strokeWidth={2} dot={{ r: 3, fill: C.black }} connectNulls={false} isAnimationActive={false} />
        </ComposedChart>
      </ZoomContainer>
    </Card>
  );
}

function RoleMixCard() {
  const M = useModel();
  const { WEEKLY, WINDOW } = M;
  const total = WINDOW.signups;
  return (
    <Card
      title="Who signs up (role mix)"
      question="Are the right people signing up — sales leaders, or mostly reps?"
      footnote="Role is the self-selected answer at signup (self_selected_role), shown as-is. Bars show each role's share of that week's signups; hover for counts."
    >
      <StatRow>
        <Stat label={`Sign ups · ${rangeLabel(M.START, M.END)}`} value={fmtInt(total)} explain={`${fmtInt(total)} signups from ${rangeLabel(M.START, M.END)}, split by the role they picked.`} />
      </StatRow>
      <div style={{ ...eyebrow, marginTop: 24 }}>By role · share of signups, {rangeLabel(M.START, M.END)}</div>
      <Legend
        style={{ margin: '8px 0 6px' }}
        items={ROLES.map((r) => ({ label: r.label, color: r.color, value: fmtPct(pct(WINDOW.roleCounts[r.key], total), 0) }))}
      />
      <ZoomContainer height={190}>
        <BarChart data={WEEKLY} margin={chartMargin} barCategoryGap="20%">
          {grid}
          <XAxis {...xAxis} />
          <YAxis {...yAxis} domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} tickFormatter={(v) => `${v}%`} />
          <Tooltip cursor={cursor} content={({ active, payload }) => active && payload?.length ? (
            <TooltipBox
              title={weekTitle(payload[0].payload)}
              rows={[...ROLES].reverse().map((r) => ({
                label: r.label, color: r.color,
                value: `${fmtPct(payload[0].payload[`${r.key}_pct`], 0)} · ${payload[0].payload[r.key]}`,
              }))}
              note={`${payload[0].payload.signups} signups`}
            />
          ) : null} />
          {ROLES.map((r) => (
            <Bar key={r.key} dataKey={`${r.key}_pct`} stackId="role" fill={r.color} stroke={C.black} strokeWidth={0.5} isAnimationActive={false} />
          ))}
        </BarChart>
      </ZoomContainer>
    </Card>
  );
}

function CompletedSetupCard() {
  const M = useModel();
  const { WEEKLY, WINDOW } = M;
  const s = WINDOW.setup;
  const p = WINDOW.setupPrev;
  const allRate = pct(s.all, s.n);
  return (
    <Card
      title="Completed setup (recorder + calendar + email)"
      question="Do new accounts finish all three setup steps?"
      notice="Coming soon: Product will help define the order of setup steps. We'll then add a view showing where people drop off between downloading the call recorder, connecting email and connecting calendar."
      footnote="Grouped by signup week: of signups that week, the share who have done each step so far. Completed setup requires all three: recorder installed, Google Calendar connected and Gmail connected. A connection counts as soon as they try, even if it failed or is pending. Recent weeks have had less time to finish, so they read low."
    >
      <StatRow delta={<Delta value={ptsDiff(allRate, pct(p.all, p.n))} suffix=" pts" />}>
        <Stat label="Sign up → completed setup" value={fmtPct(allRate, 1)} sub={`${s.all} of ${s.n} signups · ${rangeLabel(M.START, M.END)}`} />
      </StatRow>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px 32px', marginTop: 14 }}>
        {STEPS.map((st) => (
          <div key={st.key}>
            <div style={{ ...eyebrow, fontSize: 10 }}>{st.label}</div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginTop: 2 }}>
              <span style={{ ...tabular, fontFamily: FONT_DISPLAY, fontSize: 20, letterSpacing: '-0.02em' }}>{fmtPct(pct(s[st.key], s.n), 1)}</span>
              <Delta value={ptsDiff(pct(s[st.key], s.n), pct(p[st.key], p.n))} suffix=" pts" size={12} />
            </div>
          </div>
        ))}
      </div>
      <Legend items={[
        { label: 'All 3 steps', color: C.purple, line: true, weight: 3 },
        ...STEPS.map((st) => ({ label: st.label, color: st.color, line: true, dashed: true })),
      ]} />
      <ZoomContainer height={190}>
        <LineChart data={WEEKLY} margin={chartMargin}>
          {grid}
          <XAxis {...xAxis} />
          <YAxis {...yAxis} tickFormatter={(v) => `${v}%`} />
          <Tooltip content={({ active, payload }) => active && payload?.length ? (
            <TooltipBox
              title={`Signed up ${weekTitle(payload[0].payload).replace('Week of', 'week of')}`}
              rows={[
                { label: 'All 3 steps', color: C.purple, value: `${fmtPct(payload[0].payload.setupAll)} · ${payload[0].payload.setupAllN}` },
                ...STEPS.map((st) => ({
                  label: st.label, color: st.color,
                  value: `${fmtPct(payload[0].payload[`setup_${st.key}`])} · ${payload[0].payload[`setup_${st.key}N`]}`,
                })),
              ]}
              note={`${payload[0].payload.signups} signups`}
            />
          ) : null} />
          {STEPS.map((st) => (
            <Line key={st.key} dataKey={`setup_${st.key}`} stroke={st.color} strokeWidth={1.5} strokeDasharray="5 4" dot={false} activeDot={{ r: 3 }} isAnimationActive={false} />
          ))}
          <Line dataKey="setupAll" stroke={C.purple} strokeWidth={3} dot={{ r: 3, fill: C.purple, stroke: C.black, strokeWidth: 1 }} isAnimationActive={false} />
        </LineChart>
      </ZoomContainer>
    </Card>
  );
}

function ActivationCard({ stepKey, title, question, rateLabel, cohortNoun, convNoun, footnote, extra, accent }) {
  const M = useModel();
  const { ACT } = M;
  const { curr, prev, weekly: wk, monthly: mo } = ACT[stepKey];
  // Fiscal YTD: monthly columns (Nick, Oct 13).
  const weekly = M.MONTHLY_COLS ? mo : wk;
  const Cohort = cohortNoun[0].toUpperCase() + cohortNoun.slice(1);
  return (
    <Card title={title} question={question} footnote={M.MONTHLY_COLS ? `${footnote} Fiscal YTD groups by month instead of week; the faintly striped column is the month in progress.` : footnote} accent={accent}>
      <StatRow delta={<Delta value={ptsDiff(curr.rate, prev.rate)} suffix=" pts" />}>
        <Stat label={rateLabel} value={fmtPct(curr.rate, 1)} sub={`${curr.conv} of ${curr.n} ${cohortNoun} · ${rangeLabel(M.START, M.END)}`} />
      </StatRow>
      {extra}
      <Legend items={[{ label: 'Conversion % (line)', color: C.black, line: true }, { label: `${Cohort} (cohort size, bars)`, color: C.lightPurple }]} />
      <ZoomContainer height={190}>
        <ComposedChart data={weekly} margin={chartMargin}>
          {hatchDefs([C.purple])}
          {grid}
          <XAxis {...xAxis} />
          <YAxis yAxisId="p" {...yAxis} domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} tickFormatter={(v) => `${v}%`} />
          <YAxis yAxisId="n" orientation="right" {...yAxis} allowDecimals={false} />
          <Tooltip cursor={cursor} content={({ active, payload }) => active && payload?.length ? (
            <TooltipBox
              title={periodTitle(payload[0].payload)}
              rows={[
                { label: 'Conversion', value: fmtPct(payload[0].payload.rate), color: C.black },
                { label: convNoun, value: fmtInt(payload[0].payload.conv) },
                { label: Cohort, value: fmtInt(payload[0].payload.n), color: C.lightPurple },
              ]}
            />
          ) : null} />
          <Bar yAxisId="n" dataKey="n" stroke={C.black} strokeWidth={1} isAnimationActive={false}>
            {weekly.map((w) => <Cell key={w.start} fill={w.partial ? `url(#${hatchId(C.purple)})` : C.lightPurple} />)}
          </Bar>
          <Line yAxisId="p" dataKey="rate" stroke={C.black} strokeWidth={2} dot={{ r: 3.5, fill: C.purple, stroke: C.black, strokeWidth: 1 }} connectNulls={false} isAnimationActive={false} />
        </ComposedChart>
      </ZoomContainer>
    </Card>
  );
}

// Shared "Sign up → X" 7-day-by-signup-day card.
function Daily7Card({ seriesKey, title, question, accent, verb, milestone, modal = {}, extraNote = '' }) {
  const M = useModel();
  const [CONV_WINDOW_DAYS, setConvDays] = useState(DEFAULT_CONV_WINDOW);
  const series = CONV[CONV_WINDOW_DAYS][seriesKey];
  // Headline = signups IN the reporting period (Nick, Oct 7: headline time
  // frames must match the reporting window). Only signups whose N-day window
  // has closed count toward the rate; the rest are shown as "still open".
  const curr = series.pooled(M.START, M.END);
  const prev = series.pooled(M.PRIOR_START, M.PRIOR_END);
  const open = signupsIn(curr.to < M.START ? M.START : addDays(curr.to, 1), M.END).length;
  const openUsers = useUsersModal();
  const dayTitle = (x) => `Signed up ${monDay(x.d)}, ${x.d.slice(0, 4)}`;
  // No delta when the prior window starts before the milestone was trackable.
  const delta = prev.fullyTracked && prev.n ? ptsDiff(curr.rate, prev.rate) : null;
  // First signup day this milestone can be measured for (window ends on/after trackFrom).
  const dataFrom = maxISO(SIGNUP_COUNT_START, series.trackFrom ? addDays(series.trackFrom, -CONV_WINDOW_DAYS) : null);
  const periodLabel = rangeLabel(maxISO(M.START, dataFrom), M.END);
  const days = series.daily.filter((x) => x.d >= M.FRAME_START && x.d <= M.FRAME_END && x.d >= dataFrom);
  const dayTicks = days.length > 21 ? days.filter((x) => x.d === mondayOf(x.d)).map((x) => x.d) : undefined;
  return (
    <Card convWindow={[CONV_WINDOW_DAYS, setConvDays]} from={dataFrom}
      accent={accent}
      title={title}
      question={question}
      footnote={`For each signup day, the share of that day's signups that ${milestone} on the signup day or within the next ${CONV_WINDOW_DAYS} days. Dots = each day; line = rolling 7 signup days (pooled). Signups from the last ${CONV_WINDOW_DAYS} days are still inside their window, so they're faded. The headline covers signups in the reporting period (${periodLabel}); only signups whose ${CONV_WINDOW_DAYS} days are up count toward the rate${open ? ` — ${fmtInt(open)} signups from the last ${CONV_WINDOW_DAYS} days are still open and left out` : ''}. Compared with the same for ${rangeLabel(M.PRIOR_START, M.PRIOR_END)}.${extraNote} Signups count from ${monDay(SIGNUP_COUNT_START)}. Click a day to list who ${verb}. No goal set yet.`}
    >
      <StatRow delta={<Delta value={delta} suffix=" pts" />}>
        <Stat
          label={`${CONV_WINDOW_DAYS}-day conversion · sign ups ${periodLabel}`}
          value={curr.n ? fmtPct(curr.rate, 1) : '—'}
          sub={curr.n ? `${fmtInt(curr.a)} of ${fmtInt(curr.n)} signups${open ? ` · ${fmtInt(open)} still in their ${CONV_WINDOW_DAYS} days` : ''}` : `All ${fmtInt(open)} signups are still in their ${CONV_WINDOW_DAYS}-day window`}
          explain={curr.n ? `Of the ${fmtInt(curr.n)} people who signed up ${rangeLabel(curr.from, curr.to)} (the part of ${periodLabel} whose ${CONV_WINDOW_DAYS} days are up), ${fmtInt(curr.a)} (${fmtPct(curr.rate, 1)}) ${verb} within ${CONV_WINDOW_DAYS} days of signing up.${open ? ` ${fmtInt(open)} later signups are still in their window.` : ''}` : null}
        />
        <Stat label="Goal" value="—" muted />
      </StatRow>
      <ListUsersButton n={curr.a} label={`${verb} within ${CONV_WINDOW_DAYS} days`} onClick={() => openUsers({ ...modal, title: `${title} within ${CONV_WINDOW_DAYS} days`, subtitle: `signed up ${curr.n ? rangeLabel(curr.from, curr.to) : periodLabel} · ${fmtInt(curr.a)} of ${fmtInt(curr.n)} signups`, users: curr.list, summary: { label: `${CONV_WINDOW_DAYS}-day conversion · signups ${periodLabel}`, value: curr.n ? fmtPct(curr.rate, 1) : '—', sub: curr.n ? `${fmtInt(curr.a)} of ${fmtInt(curr.n)} signups${open ? ` · ${fmtInt(open)} still in their ${CONV_WINDOW_DAYS} days` : ''}` : `All ${fmtInt(open)} signups are still in their ${CONV_WINDOW_DAYS}-day window` } })} />
      <Legend items={[
        { label: '7-day rolling %', color: C.black, line: true, weight: 3 },
        { label: 'Daily %', color: 'rgba(154,154,154,0.3)' },
        { label: 'Goal % (not set)', color: '#9A9A9A', line: true, dashed: true },
      ]} />
      <ZoomContainer height={210}>
        <LineChart data={days} margin={chartMargin} style={{ cursor: 'pointer' }} onClick={onWeekClick(openUsers, (x) => ({ ...modal, title: dayTitle(x), subtitle: `${fmtInt(x.a)} of ${fmtInt(x.n)} signups ${verb} within ${CONV_WINDOW_DAYS} days${x.mature ? '' : ' (window still open)'}`, users: x.list }))}>
          {grid}
          <XAxis {...xAxis} dataKey="d" ticks={dayTicks} tickFormatter={monDay} />
          <YAxis {...yAxis} domain={[0, 'auto']} tickFormatter={(v) => `${v}%`} />
          <Tooltip content={({ active, payload }) => active && payload?.length ? (
            <TooltipBox title={dayTitle(payload[0].payload)} rows={payload[0].payload.tracked ? [
              { label: `${verb[0].toUpperCase()}${verb.slice(1)} within ${CONV_WINDOW_DAYS} days`, value: fmtPct(payload[0].payload.mature ? payload[0].payload.rate : payload[0].payload.rateImm, 1), color: '#9A9A9A' },
              { label: '7-day rolling', value: fmtPct(payload[0].payload.roll, 1), color: C.black },
              { label: 'Sign ups that day', value: fmtInt(payload[0].payload.n) },
              { label: `${verb[0].toUpperCase()}${verb.slice(1)}`, value: fmtInt(payload[0].payload.a) },
            ] : [{ label: 'Sign ups that day', value: fmtInt(payload[0].payload.n) }]} note={!payload[0].payload.tracked ? 'Not tracked yet for this signup day' : payload[0].payload.mature ? `Click to list who ${verb}` : `Still inside the ${CONV_WINDOW_DAYS}-day window · click to list`} />
          ) : null} />
          <Line dataKey="rate" stroke="transparent" dot={{ r: 2.5, fill: '#9A9A9A', fillOpacity: 0.3, stroke: 'none' }} activeDot={{ r: 4, fill: accent, stroke: C.black }} isAnimationActive={false} legendType="none" />
          <Line dataKey="rateImm" stroke="transparent" dot={{ r: 2.5, fill: '#9A9A9A', fillOpacity: 0.12, stroke: 'none' }} activeDot={{ r: 4, fill: '#D9D9D9', stroke: C.black }} isAnimationActive={false} legendType="none" />
          <Line dataKey="roll" stroke={C.black} strokeWidth={2.5} dot={false} activeDot={{ r: 4, fill: accent, stroke: C.black }} connectNulls={false} isAnimationActive={false} />
        </LineChart>
      </ZoomContainer>
    </Card>
  );
}

function SignupToActivatedCard() {
  return (
    <Daily7Card
      seriesKey="ACT"
      accent={C.green}
      title="Sign up → activated"
      question="Of each day's signups, what share activate within the window?"
      verb="activated"
      milestone="activated (sent or drafted an email, or published an asset)"
    />
  );
}

// Activated users per week (Nick, Oct 20): replaces the cumulative card on the
// Activated tab; full width. Weekly line in every period (lines stay weekly in
// Fiscal YTD); the week in progress draws as a dotted tail.
function ActivatedUsersWeeklyCard() {
  const M = useModel();
  const { ACTIVATED, END, START } = M;
  const A = ACTIVATED;
  const openUsers = useUsersModal();
  const data = A.weekly.map((w, i) => {
    const next = A.weekly[i + 1];
    const tracked = FIRST_ACT_TRACKED && (w.partial ? DATA_END : w.end) >= FIRST_ACT_TRACKED;
    const n = tracked ? w.n : null;
    return { ...w, nFull: w.partial ? null : n, nPartial: w.partial || next?.partial ? n : null };
  });
  return (
    <Card from={FIRST_ACT_TRACKED}
      accent={C.green}
      title="Activated users"
      question="Are we on pace?"
      footnote={`Users who activated for the first time in each ${M.grainEach}, whatever their signup date. Activated = sent (or drafted) an email or published an asset, counted once, in the period they first did either. Asset data starts ${monDay(FIRST_ACT_TRACKED || END)}, ${(FIRST_ACT_TRACKED || END).slice(0, 4)}; email sends start Sep 4. Asset publishes carry no company, so each is credited to the user's latest signup at the time; publishes with no user are left out. ${lineWeekNote(M)}${M.SHOWS_CUR ? ' (dotted)' : ''} Click a point to list who activated then. No goal set yet.`}
    >
      <StatRow delta={M.noPrior ? null : <Delta value={pctChange(A.curr, A.prev)} />}>
        <Stat label={`Actual · ${rangeLabel(M.START, M.END)}`} value={fmtInt(A.curr)} explain={`${fmtInt(A.curr)} users activated for the first time from ${rangeLabel(M.START, M.END)} (sent an email or published an asset).${M.noPrior ? '' : ` ${fmtInt(A.prev)} in the ${M.prior}.`} ${fmtInt(A.now.cum)} have activated to date.`} sub={`${fmtInt(A.now.cum)} activated to date`} />
        <Stat label="Goal" value="—" muted />
      </StatRow>
      <ListUsersButton n={A.curr} label={`activated in the ${M.long}`} onClick={() => openUsers({ title: 'Activated users', subtitle: `activated ${rangeLabel(START, END)}`, users: A.currList, summary: { label: `Activated · ${rangeLabel(START, END)}`, value: fmtInt(A.curr), sub: `${fmtInt(A.email)} by email · ${fmtInt(A.asset)} by asset · ${fmtInt(A.now.cum)} activated to date` } })} />
      <Legend items={[{ label: `Activated users (${M.grainAdj})`, color: C.black, line: true }, { label: 'Goal (not set)', color: '#9A9A9A', line: true, dashed: true }]} />
      <ZoomContainer height={220}>
        <LineChart data={fromRows(data, FIRST_ACT_TRACKED)} margin={chartMargin} style={{ cursor: 'pointer' }} onClick={onWeekClick(openUsers, (row) => ({ title: 'Activated users', subtitle: `activated ${periodPhrase(row)}`, users: row.list }))}>
          {grid}
          <XAxis {...xAxis} />
          <YAxis {...yAxis} domain={[0, 'auto']} allowDecimals={false} />
          <Tooltip content={({ active, payload }) => active && payload?.length ? (
            <TooltipBox title={weekTitle(payload[0].payload)} rows={[
              { label: `Activated this ${M.grainNoun}`, value: fmtInt(payload[0].payload.n), color: C.black },
              { label: '…first via asset publish', value: fmtInt(payload[0].payload.asset) },
              { label: '…first via email', value: fmtInt(payload[0].payload.email) },
              { label: 'Activated to date', value: fmtInt(payload[0].payload.cum) },
            ]} note="Click to list these activated users" />
          ) : null} />
          <Line dataKey="nFull" stroke={C.black} strokeWidth={2.5} dot={false} activeDot={{ r: 4, fill: C.green, stroke: C.black }} isAnimationActive={false} />
          <Line dataKey="nPartial" stroke={C.black} strokeWidth={2} strokeDasharray="2 4" dot={false} activeDot={{ r: 4, fill: C.green, stroke: C.black }} legendType="none" isAnimationActive={false} />
        </LineChart>
      </ZoomContainer>
    </Card>
  );
}

function ActivatedUsersCard() {
  const M = useModel();
  const { ACTIVATED, END, START } = M;
  const A = ACTIVATED;
  const openUsers = useUsersModal();
  return (
    <Card
      accent={C.green}
      title="Total activated users (cumulative)"
      question="Are we on pace?"
      footnote={`Running total of activated users since ${monDay(FIRST_ACT_TRACKED || END)}, ${(FIRST_ACT_TRACKED || END).slice(0, 4)} (when asset data starts; email sends start Sep 4). Activated = sent (or drafted) an email or published an asset, counted once, in the week they first did either, whatever their signup date. Asset publishes carry no company, so each is credited to the user's latest signup at the time; publishes with no user are left out. Click a week to list who activated that week. No goal set yet.`}
    >
      <StatRow>
        <Stat label={`Actual · ${rangeLabel(M.START, M.END)}`} value={fmtInt(A.curr)} explain={`${fmtInt(A.curr)} users activated for the first time from ${rangeLabel(M.START, M.END)} (sent an email or published an asset); ${fmtInt(A.now.cum)} have activated to date.`} sub={`${fmtInt(A.now.cum)} activated to date`} />
        <Stat label="Goal" value="—" muted />
        <Stat label="Vs goal" value="—" muted />
      </StatRow>
      <ListUsersButton n={A.curr} label={`activated in the ${M.long}`} onClick={() => openUsers({ title: 'Activated users', subtitle: `activated ${rangeLabel(START, END)}`, users: A.currList, summary: { label: `Activated · ${rangeLabel(START, END)}`, value: fmtInt(A.curr), sub: `${fmtInt(A.email)} by email · ${fmtInt(A.asset)} by asset · ${fmtInt(A.now.cum)} activated to date` } })} />
      <Legend items={[{ label: 'Cumulative actual', color: C.black, line: true }, { label: 'Cumulative goal (not set)', color: '#9A9A9A', line: true, dashed: true }]} />
      <ZoomContainer height={190}>
        <LineChart data={A.weekly} margin={chartMargin} style={{ cursor: 'pointer' }} onClick={onWeekClick(openUsers, (row) => ({ title: 'Activated users', subtitle: `activated week of ${row.range}`, users: row.list }))}>
          {grid}
          <XAxis {...xAxis} />
          <YAxis {...yAxis} tickFormatter={fmtK} domain={['dataMin', 'auto']} allowDecimals={false} />
          <Tooltip content={({ active, payload }) => active && payload?.length ? (
            <TooltipBox title={`To end of ${weekTitle(payload[0].payload).replace('Week of', 'week of')}`} rows={[
              { label: 'Activated to date', value: fmtInt(payload[0].payload.cum), color: C.black },
              { label: 'Change vs prior week', value: fmtSigned(payload[0].payload.cumWoW, '%', 1) },
              { label: 'Activated this week', value: fmtInt(payload[0].payload.n) },
              { label: '…first via asset publish', value: fmtInt(payload[0].payload.asset) },
              { label: '…first via email', value: fmtInt(payload[0].payload.email) },
            ]} note="Click to list this week's activated users" />
          ) : null} />
          <Line dataKey="cum" stroke={C.black} strokeWidth={2.5} dot={false} activeDot={{ r: 4, fill: C.green, stroke: C.black }} isAnimationActive={false} />
        </LineChart>
      </ZoomContainer>
    </Card>
  );
}

// Activated users split by how they FIRST activated. A signup whose first
// email and first asset publish fall on the same day counts as email.
const ACT_TYPES = [
  { key: 'email', label: 'Sent an email', color: C.purple },
  { key: 'asset', label: 'Published an asset', color: C.green },
];
function ActivatedByTypeCard() {
  const M = useModel();
  const { ACTIVATED, START, END } = M;
  const A = ACTIVATED;
  const cols = M.MONTHLY_COLS ? A.monthly : A.weekly; // Fiscal YTD: monthly (Nick, Oct 13)
  const openUsers = useUsersModal();
  return (
    <div className="full">
      <Card
        accent={C.green}
        title="Activated by type of first action"
        question="Do users activate by sending an email or by publishing an asset?"
        footnote={`Users who activated in each ${M.MONTHLY_COLS ? 'month' : 'week'}, split by what they did first: sent (or drafted) an email, or published an asset. If both happened on the same day, it counts as email. Email sends are only tracked from Sep 4, so earlier weeks are all assets. ${colNote(M)} Click a bar to list that ${M.MONTHLY_COLS ? 'month' : 'week'}'s users.`}
      >
        <StatRow delta={<Delta value={pctChange(A.curr, A.prev)} />}>
          <Stat label={`Activated · ${rangeLabel(M.START, M.END)}`} value={fmtInt(A.curr)} explain={`${fmtInt(A.curr)} users activated for the first time from ${rangeLabel(START, END)}: ${fmtInt(A.email)} by sending an email, ${fmtInt(A.asset)} by publishing an asset.`} />
        </StatRow>
        <ListUsersButton n={A.curr} label={`activated in the ${M.long}`} onClick={() => openUsers({ title: 'Activated users', subtitle: `activated ${rangeLabel(START, END)}`, users: A.currList, summary: { label: `Activated · ${rangeLabel(START, END)}`, value: fmtInt(A.curr), sub: `${fmtInt(A.email)} by email · ${fmtInt(A.asset)} by asset · ${fmtInt(A.now.cum)} activated to date` } })} />
        <div style={{ ...eyebrow, marginTop: 24 }}>By type of first action · {rangeLabel(M.START, M.END)}</div>
        <Legend
          style={{ margin: '8px 0 6px' }}
          items={ACT_TYPES.map((t) => ({ label: t.label, color: t.color, value: fmtPct(pct(A[t.key], A.curr), 0) }))}
        />
        <ZoomContainer height={240}>
          <BarChart data={cols} margin={chartMargin} barCategoryGap="22%" style={{ cursor: 'pointer' }} onClick={onWeekClick(openUsers, (row) => ({ title: 'Activated users', subtitle: `activated ${periodPhrase(row)}`, users: row.list }))}>
            {hatchDefs(ACT_TYPES.map((t) => t.color))}
            {grid}
            <XAxis {...xAxis} />
            <YAxis {...yAxis} allowDecimals={false} />
            <Tooltip cursor={cursor} content={({ active, payload }) => active && payload?.length ? (
              <TooltipBox
                title={periodTitle(payload[0].payload)}
                rows={[...ACT_TYPES].reverse().map((t) => ({
                  label: t.label, color: t.color,
                  value: `${fmtInt(payload[0].payload[t.key])} · ${fmtPct(pct(payload[0].payload[t.key], payload[0].payload.n), 0)}`,
                }))}
                note={`${fmtInt(payload[0].payload.n)} activated · click to list users`}
              />
            ) : null} />
            {ACT_TYPES.map((t) => (
              <Bar key={t.key} dataKey={t.key} stackId="type" stroke={C.black} strokeWidth={0.5} isAnimationActive={false}>
                {cols.map((w) => <Cell key={w.start} fill={w.partial ? `url(#${hatchId(t.color)})` : t.color} />)}
              </Bar>
            ))}
          </BarChart>
        </ZoomContainer>
      </Card>
    </div>
  );
}

// --- Lever 1: Onboarding -----------------------------------------------------------
const ONB_MODAL = { noun: 'user completed onboarding', nounPlural: 'users completed onboarding', dateLabel: 'Completed onboarding', dateOf: onbDate, showVia: false };
function SignupToOnboardedCard() {
  return (
    <Daily7Card
      seriesKey="ONB"
      accent={C.purple}
      title="Sign up → completed onboarding"
      question="Of each day's signups, what share finish onboarding within the window?"
      verb="completed onboarding"
      milestone={`completed onboarding (${ONB_DEF_TEXT}, dated by the last step)`}
      modal={ONB_MODAL}
      extraNote={` Onboarding is only tracked from ${monDay(ONB_TRACK_FROM || DATA_END)}, so earlier signup days have no point and the prior-period comparison is hidden until it's fully tracked.`}
    />
  );
}

// Lever 1 detail: each onboarding step on its own, same 7-day-by-signup-day logic.
const stepModal = (noun, dateLabel, key) => ({ noun: `user ${noun}`, nounPlural: `users ${noun}`, dateLabel, dateOf: (s) => s[key], showVia: false });
const trackedNote = (d) => ` This step is only tracked from ${monDay(d || DATA_END)}, ${(d || DATA_END).slice(0, 4)}, so earlier signup days have no point.`;
function SignupToRecorderCard() {
  return (
    <Daily7Card seriesKey="REC" accent={C.purple}
      title="Sign up → downloaded call recorder"
      question="Of each day's signups, what share install the recorder within the window?"
      verb="downloaded the recorder"
      milestone="installed the call recorder"
      modal={stepModal('downloaded the recorder', 'Recorder installed', 'rec')}
      extraNote={trackedNote(FIRST_REC_TRACKED)} />
  );
}
function SignupToEmailCard() {
  return (
    <Daily7Card seriesKey="EM" accent={C.purple}
      title="Sign up → connected email"
      question="Of each day's signups, what share connect email within the window?"
      verb="connected email"
      milestone="connected Gmail (any status, including failed or pending)"
      modal={stepModal('connected email', 'Email connected', 'em')}
      extraNote={trackedNote(FIRST_EM_TRACKED)} />
  );
}
// --- Lever 2: A1 magic moment = first recorded meeting (Nick, Oct 8) ------------
const MT_MODAL = { noun: 'user recorded a meeting', nounPlural: 'users recorded a meeting', dateLabel: 'First meeting', dateOf: (s) => s.mt, showVia: false };
function SignupToMeetingCard() {
  return (
    <Daily7Card seriesKey="MT" accent={C.lightPurple}
      title="Sign up → first recorded meeting"
      question="Of each day's signups, what share record their first meeting within the window?"
      verb="recorded a meeting"
      milestone="recorded their first meeting (a finalized capture, complete or partial)"
      modal={MT_MODAL}
      extraNote={` Meeting captures are only tracked from ${monDay(FIRST_MT_TRACKED)}, ${FIRST_MT_TRACKED.slice(0, 4)}, so earlier signup days have no point and the prior-period comparison is hidden until it's fully tracked.`} />
  );
}

// Running total of signups that reached a milestone (date field `field`)
// within the conversion window, counted in the week they reached it. Used by
// Lever 2 (first recorded meeting) and Lever 3 (first email).
function MilestoneCumulativeCard({ field, trackedFrom, modal, accent, title, question, did, what, listTitle }) {
  const M = useModel();
  const { START, END } = M;
  const [CONV_WINDOW_DAYS, setConvDays] = useState(DEFAULT_CONV_WINDOW);
  const openUsers = useUsersModal();
  const base = React.useMemo(() => SIGNUPS.filter((s) => s.d >= SIGNUP_COUNT_START && s[field] && s[field] >= s.d && daysBetweenISO(s.d, s[field]) <= CONV_WINDOW_DAYS), [CONV_WINDOW_DAYS, field]);
  const upTo = (d) => base.filter((s) => s[field] <= d).length;
  const weekly = M.WEEKS.map((w) => {
    const end = w.partial ? DATA_END : w.end;
    const list = base.filter((s) => s[field] >= w.start && s[field] <= end);
    return { ...w, cum: upTo(end), n: list.length, list };
  });
  const currList = base.filter((s) => inRange(s[field], START, END));
  const total = upTo(DATA_END);
  const summary = { label: `${listTitle} · ${rangeLabel(START, END)}`, value: fmtInt(currList.length), sub: `${fmtInt(total)} signups to date ${did} within ${CONV_WINDOW_DAYS} days of signing up` };
  return (
    <Card from={trackedFrom} convWindow={[CONV_WINDOW_DAYS, setConvDays]}
      accent={accent}
      title={title}
      question={question}
      footnote={`Running total of signups (since ${monDay(SIGNUP_COUNT_START)}) that ${what} within ${CONV_WINDOW_DAYS} days of signing up (change the window next to the title), counted in the ${M.grainNoun} they did it. Only tracked from ${monDay(trackedFrom)}, so the line starts there. ${lineWeekNote(M)} Click a point to list who ${did} then. No goal set yet.`}
    >
      <StatRow>
        <Stat
          label={`Actual · ${rangeLabel(START, END)}`}
          value={fmtInt(currList.length)}
          sub={`${fmtInt(total)} to date`}
          explain={`${fmtInt(currList.length)} signups ${did} from ${rangeLabel(START, END)}, within ${CONV_WINDOW_DAYS} days of signing up; ${fmtInt(total)} to date.`}
        />
        <Stat label="Goal" value="—" muted />
        <Stat label="Vs goal" value="—" muted />
      </StatRow>
      <ListUsersButton n={currList.length} label={`${did} in the ${M.long}`} onClick={() => openUsers({ ...modal, title: listTitle, subtitle: `${rangeLabel(START, END)}, within ${CONV_WINDOW_DAYS} days of signing up`, users: currList, summary })} />
      <Legend items={[{ label: 'Cumulative actual', color: C.black, line: true }, { label: 'Cumulative goal (not set)', color: '#9A9A9A', line: true, dashed: true }]} />
      <ZoomContainer height={210}>
        <LineChart data={fromRows(weekly, trackedFrom)} margin={chartMargin} style={{ cursor: 'pointer' }} onClick={onWeekClick(openUsers, (row) => ({ ...modal, title: listTitle, subtitle: periodPhrase(row), users: row.list }))}>
          {grid}
          <XAxis {...xAxis} />
          <YAxis {...yAxis} domain={[0, 'auto']} allowDecimals={false} />
          <Tooltip content={({ active, payload }) => active && payload?.length ? (
            <TooltipBox title={`To end of ${weekTitle(payload[0].payload).replace('Week of', 'week of')}`} rows={[
              { label: `${listTitle}, to date`, value: fmtInt(payload[0].payload.cum), color: C.black },
              { label: 'This week', value: fmtInt(payload[0].payload.n) },
            ]} note="Click to list these users" />
          ) : null} />
          <Line dataKey="cum" stroke={C.black} strokeWidth={2.5} dot={false} activeDot={{ r: 4, fill: accent, stroke: C.black }} isAnimationActive={false} />
        </LineChart>
      </ZoomContainer>
    </Card>
  );
}
function MeetingSignupsCumulativeCard() {
  return (
    <MilestoneCumulativeCard field="mt" trackedFrom={FIRST_MT_TRACKED} modal={MT_MODAL} accent={C.lightPurple}
      title="Sign ups with a recorded meeting (cumulative)"
      question="How many signups have reached the magic moment?"
      did="recorded a meeting" listTitle="Recorded a meeting"
      what="recorded their first meeting (a finalized capture, complete or partial)" />
  );
}

// --- Lever 3: A2 first customer send = first email, sent or drafted (Nick, Oct 8)
const SND_MODAL = { noun: 'user sent an email', nounPlural: 'users sent an email', dateLabel: 'First email', dateOf: (s) => s.snd, showVia: false };
function SignupToEmailSendCard() {
  return (
    <Daily7Card seriesKey="SND" accent={C.lightPurple}
      title="Sign up → first email"
      question="Of each day's signups, what share send (or draft) their first email within the window?"
      verb="sent an email"
      milestone="sent or drafted their first email"
      modal={SND_MODAL}
      extraNote={` Emails are only tracked from ${monDay(FIRST_SND_TRACKED)}, ${FIRST_SND_TRACKED.slice(0, 4)}, so earlier signup days have no point and the prior-period comparison is hidden until it's fully tracked.`} />
  );
}
function EmailSignupsCumulativeCard() {
  return (
    <MilestoneCumulativeCard field="snd" trackedFrom={FIRST_SND_TRACKED} modal={SND_MODAL} accent={C.lightPurple}
      title="Sign ups with a first email (cumulative)"
      question="How many signups have made their first customer send?"
      did="sent an email" listTitle="Sent an email"
      what="sent or drafted their first email" />
  );
}

function SignupToCalendarCard() {
  return (
    <Daily7Card seriesKey="CAL" accent={C.purple}
      title="Sign up → connected calendar"
      question="Of each day's signups, what share connect their calendar within the window?"
      verb="connected calendar"
      milestone="connected Google Calendar (any status, including failed or pending)"
      modal={stepModal('connected calendar', 'Calendar connected', 'cal')}
      extraNote={trackedNote(FIRST_CAL_TRACKED)} />
  );
}

// Users who completed onboarding per week (Nick, Oct 20): replaces the
// cumulative card; full width. Weekly line, week in progress dotted.
function OnboardedUsersWeeklyCard() {
  const M = useModel();
  const { ONBOARDED, START, END } = M;
  const O = ONBOARDED;
  const openUsers = useUsersModal();
  const data = O.weekly.map((w, i) => {
    const next = O.weekly[i + 1];
    const tracked = FIRST_ONB_TRACKED && (w.partial ? DATA_END : w.end) >= FIRST_ONB_TRACKED;
    const n = tracked ? w.n : null;
    return { ...w, nFull: w.partial ? null : n, nPartial: w.partial || next?.partial ? n : null };
  });
  return (
    <Card from={ONB_TRACK_FROM}
      accent={C.purple}
      title="Users who completed onboarding"
      question="Are we on pace?"
      footnote={`Users who completed onboarding (${ONB_DEF_TEXT}) in each ${M.grainEach}, counted once, in the period they finished the last step, whatever their signup date. Tracked from ${monDay(FIRST_ONB_TRACKED || END)}, ${(FIRST_ONB_TRACKED || END).slice(0, 4)}. ${lineWeekNote(M)}${M.SHOWS_CUR ? ' (dotted)' : ''} Click a point to list who completed then. No goal set yet.`}
    >
      <StatRow delta={M.noPrior ? null : <Delta value={pctChange(O.curr, O.prev)} />}>
        <Stat label={`Actual · ${rangeLabel(M.START, M.END)}`} value={fmtInt(O.curr)} explain={`${fmtInt(O.curr)} users completed onboarding from ${rangeLabel(M.START, M.END)} (recorder + Gmail + Google Calendar).${M.noPrior ? '' : ` ${fmtInt(O.prev)} in the ${M.prior}.`} ${fmtInt(O.now.cum)} have completed it to date.`} sub={`${fmtInt(O.now.cum)} completed onboarding to date`} />
        <Stat label="Goal" value="—" muted />
      </StatRow>
      <ListUsersButton n={O.curr} label={`completed onboarding in the ${M.long}`} onClick={() => openUsers({ ...ONB_MODAL, title: 'Completed onboarding', subtitle: `completed ${rangeLabel(START, END)}`, users: O.currList, summary: { label: `Completed onboarding · ${rangeLabel(START, END)}`, value: fmtInt(O.curr), sub: `${fmtInt(O.now.cum)} completed onboarding to date` } })} />
      <Legend items={[{ label: `Completed onboarding (${M.grainAdj})`, color: C.black, line: true }, { label: 'Goal (not set)', color: '#9A9A9A', line: true, dashed: true }]} />
      <ZoomContainer height={220}>
        <LineChart data={fromRows(data, ONB_TRACK_FROM)} margin={chartMargin} style={{ cursor: 'pointer' }} onClick={onWeekClick(openUsers, (row) => ({ ...ONB_MODAL, title: 'Completed onboarding', subtitle: `completed ${periodPhrase(row)}`, users: row.list }))}>
          {grid}
          <XAxis {...xAxis} />
          <YAxis {...yAxis} domain={[0, 'auto']} allowDecimals={false} />
          <Tooltip content={({ active, payload }) => active && payload?.length ? (
            <TooltipBox title={weekTitle(payload[0].payload)} rows={[
              { label: `Completed this ${M.grainNoun}`, value: fmtInt(payload[0].payload.n), color: C.black },
              { label: 'Completed to date', value: fmtInt(payload[0].payload.cum) },
            ]} note="Click to list these users" />
          ) : null} />
          <Line dataKey="nFull" stroke={C.black} strokeWidth={2.5} dot={false} activeDot={{ r: 4, fill: C.purple, stroke: C.black }} isAnimationActive={false} />
          <Line dataKey="nPartial" stroke={C.black} strokeWidth={2} strokeDasharray="2 4" dot={false} activeDot={{ r: 4, fill: C.purple, stroke: C.black }} legendType="none" isAnimationActive={false} />
        </LineChart>
      </ZoomContainer>
    </Card>
  );
}

function OnboardedUsersCard() {
  const M = useModel();
  const { ONBOARDED, START, END } = M;
  const O = ONBOARDED;
  const openUsers = useUsersModal();
  return (
    <Card
      accent={C.purple}
      title="Total users who completed onboarding (cumulative)"
      question="Are we on pace?"
      footnote={`Running total of users who completed onboarding (${ONB_DEF_TEXT}) since ${monDay(FIRST_ONB_TRACKED || END)}, ${(FIRST_ONB_TRACKED || END).slice(0, 4)}, counted once, in the week they finished the last of the three, whatever their signup date. Click a week to list who completed that week. No goal set yet.`}
    >
      <StatRow>
        <Stat label={`Actual · ${rangeLabel(M.START, M.END)}`} value={fmtInt(O.curr)} explain={`${fmtInt(O.curr)} users completed onboarding from ${rangeLabel(M.START, M.END)} (recorder + Gmail + Google Calendar); ${fmtInt(O.now.cum)} have completed it to date.`} sub={`${fmtInt(O.now.cum)} completed onboarding to date`} />
        <Stat label="Goal" value="—" muted />
        <Stat label="Vs goal" value="—" muted />
      </StatRow>
      <ListUsersButton n={O.curr} label={`completed onboarding in the ${M.long}`} onClick={() => openUsers({ ...ONB_MODAL, title: 'Completed onboarding', subtitle: `completed ${rangeLabel(START, END)}`, users: O.currList, summary: { label: `Completed onboarding · ${rangeLabel(START, END)}`, value: fmtInt(O.curr), sub: `${fmtInt(O.now.cum)} completed onboarding to date` } })} />
      <Legend items={[{ label: 'Cumulative actual', color: C.black, line: true }, { label: 'Cumulative goal (not set)', color: '#9A9A9A', line: true, dashed: true }]} />
      <ZoomContainer height={190}>
        <LineChart data={O.weekly} margin={chartMargin} style={{ cursor: 'pointer' }} onClick={onWeekClick(openUsers, (row) => ({ ...ONB_MODAL, title: 'Completed onboarding', subtitle: `completed week of ${row.range}`, users: row.list }))}>
          {grid}
          <XAxis {...xAxis} />
          <YAxis {...yAxis} domain={[0, 'auto']} allowDecimals={false} />
          <Tooltip content={({ active, payload }) => active && payload?.length ? (
            <TooltipBox title={`To end of ${weekTitle(payload[0].payload).replace('Week of', 'week of')}`} rows={[
              { label: 'Completed to date', value: fmtInt(payload[0].payload.cum), color: C.black },
              { label: 'Change vs prior week', value: fmtSigned(payload[0].payload.cumWoW, '%', 1) },
              { label: 'Completed this week', value: fmtInt(payload[0].payload.n) },
            ]} note="Click to list these users" />
          ) : null} />
          <Line dataKey="cum" stroke={C.black} strokeWidth={2.5} dot={false} activeDot={{ r: 4, fill: C.purple, stroke: C.black }} isAnimationActive={false} />
        </LineChart>
      </ZoomContainer>
    </Card>
  );
}

// --- Returned ------------------------------------------------------------------------
const RET_DEF = `Returned = an activated user who, in the ${RETURN_DAYS} days after the day they activated, came back and used credits, created or published an asset, or sent (or drafted) an email. The activation day itself doesn't count.`;
const RET_SOURCES = 'Credits are tracked from Apr 1, assets from Feb 16 and emails from Sep 4. Credits are matched by email + company; assets carry no company, so they go to the user\'s latest signup at the time.';

function ActivatedToReturnedCard() {
  const M = useModel();
  const { RETURNED } = M;
  const R = RETURNED;
  const openUsers = useUsersModal();
  const periodLabel = rangeLabel(M.START, M.END);
  return (
    <Card from={FIRST_ACT_TRACKED}
      accent={C.blue}
      title="Activated → returned"
      question="Do activated users come back the following week?"
      footnote={`${RET_DEF} Each point groups users by the ${M.grainNoun} they activated. The headline covers users who activated in the reporting period (${periodLabel}); only those whose ${RETURN_DAYS}-day window has closed count${R.curr.open ? ` — ${fmtInt(R.curr.open)} who activated in the last ${RETURN_DAYS} days are still open and left out` : ''}. Compared with the same for ${rangeLabel(M.PRIOR_START, M.PRIOR_END)}. Dotted = weeks whose windows are still open. ${RET_SOURCES} Click a week to list who returned. No goal set yet.`}
    >
      <StatRow delta={<Delta value={R.prev.n ? ptsDiff(R.curr.rate, R.prev.rate) : null} suffix=" pts" />}>
        <Stat
          label={`Conversion · activated ${periodLabel}`}
          value={R.curr.n ? fmtPct(R.curr.rate, 1) : '—'}
          sub={R.curr.n ? `${fmtInt(R.curr.k)} of ${fmtInt(R.curr.n)} activated${R.curr.open ? ` · ${fmtInt(R.curr.open)} still in their ${RETURN_DAYS} days` : ''}` : `All ${fmtInt(R.curr.open)} are still in their ${RETURN_DAYS}-day window`}
          explain={R.curr.n ? `Of the ${fmtInt(R.curr.n)} users who activated ${rangeLabel(R.curr.from, R.curr.to)} (the part of ${periodLabel} whose ${RETURN_DAYS} days are up), ${fmtInt(R.curr.k)} (${fmtPct(R.curr.rate, 1)}) came back and did something within ${RETURN_DAYS} days.` : null}
        />
        <Stat label="Goal" value="—" muted />
      </StatRow>
      <ListUsersButton n={R.curr.k} label={`returned within ${RETURN_DAYS} days`} onClick={() => openUsers({ ...RET_MODAL, title: 'Returned users', subtitle: `activated ${rangeLabel(R.curr.from, R.curr.to)} · ${fmtInt(R.curr.k)} of ${fmtInt(R.curr.n)} returned`, users: R.curr.retList, summary: { label: `Conversion · activated ${periodLabel}`, value: R.curr.n ? fmtPct(R.curr.rate, 1) : '—', sub: R.curr.n ? `${fmtInt(R.curr.k)} of ${fmtInt(R.curr.n)} activated${R.curr.open ? ` · ${fmtInt(R.curr.open)} still in their ${RETURN_DAYS} days` : ''}` : `All ${fmtInt(R.curr.open)} are still in their ${RETURN_DAYS}-day window` } })} />
      <Legend items={[{ label: 'Actual %', color: C.black, line: true }, { label: 'Goal % (not set)', color: '#9A9A9A', line: true, dashed: true }]} />
      <ZoomContainer height={210}>
        <LineChart data={fromRows(R.weekly, FIRST_ACT_TRACKED)} margin={chartMargin} style={{ cursor: 'pointer' }} onClick={onWeekClick(openUsers, (row) => ({ ...RET_MODAL, title: 'Returned users', subtitle: `activated week of ${row.range} · ${fmtInt(row.k)} of ${fmtInt(row.n)} returned${row.mature ? '' : ' (window still open)'}`, users: row.retList }))}>
          {grid}
          <XAxis {...xAxis} />
          <YAxis {...yAxis} domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} tickFormatter={(v) => `${v}%`} />
          <Tooltip content={({ active, payload }) => active && payload?.length ? (
            <TooltipBox title={`Activated ${weekTitle(payload[0].payload).replace('Week of', 'week of')}`} rows={[
              { label: `Returned within ${RETURN_DAYS} days`, value: fmtPct(payload[0].payload.rate, 1), color: C.black },
              { label: 'Activated', value: fmtInt(payload[0].payload.n) },
              { label: 'Returned', value: fmtInt(payload[0].payload.k) },
            ]} note={payload[0].payload.mature ? 'Click to list who returned' : `Some ${RETURN_DAYS}-day windows still open · click to list`} />
          ) : null} />
          <Line dataKey="rateFull" stroke={C.black} strokeWidth={2.5} dot={{ r: 2.5, fill: C.black }} activeDot={{ r: 4, fill: C.blue, stroke: C.black }} connectNulls={false} isAnimationActive={false} />
          <Line dataKey="rateOpen" stroke={C.black} strokeWidth={2} strokeDasharray="3 4" dot={false} activeDot={{ r: 4, fill: '#D9D9D9', stroke: C.black }} connectNulls={false} isAnimationActive={false} legendType="none" />
        </LineChart>
      </ZoomContainer>
    </Card>
  );
}

function WeeklyReturnedUsersCard() {
  const M = useModel();
  const R = M.RETURNED;
  const openUsers = useUsersModal();
  const c = R.curr;
  const periodLabel = rangeLabel(M.START, M.END);
  return (
    <Card from={FIRST_ACT_TRACKED}
      accent={C.blue}
      title="Weekly returned users"
      question={`How many activated users come back each ${M.grainNoun}?`}
      footnote={`${RET_DEF} Chart: ${M.grainAdj} count, not cumulative, by the ${M.grainNoun} they activated; dotted = points whose windows are still open. Headline: returned users among those who activated in the reporting period (${periodLabel}) whose ${RETURN_DAYS}-day window has closed, vs the same for ${rangeLabel(M.PRIOR_START, M.PRIOR_END)}. ${RET_SOURCES} Click a week to list who returned. No goal set yet.`}
    >
      <StatRow delta={<Delta value={R.prev.n ? pctChange(c.k, R.prev.k) : null} />}>
        <Stat
          label={`Returned · activated ${periodLabel}`}
          value={c.n ? fmtInt(c.k) : '—'}
          sub={c.n ? `of ${fmtInt(c.n)} activated${c.open ? ` · ${fmtInt(c.open)} still open` : ''}` : `All still in their ${RETURN_DAYS}-day window`}
          explain={c.n ? `${fmtInt(c.k)} of the ${fmtInt(c.n)} users who activated ${rangeLabel(c.from, c.to)} came back within ${RETURN_DAYS} days.` : null}
        />
        <Stat label="Goal" value="—" muted />
        <Stat label="Vs goal" value="—" muted />
      </StatRow>
      {c.n > 0 && <ListUsersButton n={c.k} label={`returned (activated ${periodLabel})`} onClick={() => openUsers({ ...RET_MODAL, title: 'Returned users', subtitle: `activated ${rangeLabel(c.from, c.to)} · ${fmtInt(c.k)} of ${fmtInt(c.n)} returned`, users: c.retList, summary: { label: `Returned · activated ${periodLabel}`, value: fmtInt(c.k), sub: `of ${fmtInt(c.n)} activated${c.open ? ` · ${fmtInt(c.open)} still open` : ''}` } })} />}
      <Legend items={[{ label: 'Actual', color: C.black, line: true }, { label: 'Goal (not set)', color: '#9A9A9A', line: true, dashed: true }]} />
      <ZoomContainer height={210}>
        <LineChart data={fromRows(R.weekly, FIRST_ACT_TRACKED)} margin={chartMargin} style={{ cursor: 'pointer' }} onClick={onWeekClick(openUsers, (row) => ({ ...RET_MODAL, title: 'Returned users', subtitle: `activated week of ${row.range} · ${fmtInt(row.k)} of ${fmtInt(row.n)} returned${row.mature ? '' : ' (window still open)'}`, users: row.retList }))}>
          {grid}
          <XAxis {...xAxis} />
          <YAxis {...yAxis} domain={[0, 'auto']} allowDecimals={false} />
          <Tooltip content={({ active, payload }) => active && payload?.length ? (
            <TooltipBox title={`Activated ${weekTitle(payload[0].payload).replace('Week of', 'week of')}`} rows={[
              { label: 'Returned users', value: fmtInt(payload[0].payload.k), color: C.black },
              { label: 'Activated that week', value: fmtInt(payload[0].payload.n) },
              { label: 'Share returned', value: fmtPct(payload[0].payload.rate, 1) },
            ]} note={payload[0].payload.mature ? 'Click to list who returned' : `Some ${RETURN_DAYS}-day windows still open · click to list`} />
          ) : null} />
          <Line dataKey="kFull" stroke={C.black} strokeWidth={2.5} dot={{ r: 2.5, fill: C.black }} activeDot={{ r: 4, fill: C.blue, stroke: C.black }} connectNulls={false} isAnimationActive={false} />
          <Line dataKey="kOpen" stroke={C.black} strokeWidth={2} strokeDasharray="3 4" dot={false} activeDot={{ r: 4, fill: '#D9D9D9', stroke: C.black }} connectNulls={false} isAnimationActive={false} legendType="none" />
        </LineChart>
      </ZoomContainer>
    </Card>
  );
}

function FirstMeetingCard() {
  const M = useModel();
  const { MEETING_ANY_30D, WINDOW } = M;
  return (
    <ActivationCard
      stepKey="mt"
      accent={C.green}
      title="First meeting recorded"
      question="Do set-up users capture a real meeting?"
      rateLabel="Completed setup → first meeting"
      cohortNoun="completed setup"
      convNoun="Recorded a meeting ≤7d"
      extra={
        <div style={{ marginTop: 14 }}>
          <div style={{ ...eyebrow, fontSize: 10 }}>Any signup → first meeting</div>
          <span style={{ ...tabular, fontFamily: FONT_DISPLAY, fontSize: 20, letterSpacing: '-0.02em' }}>{fmtPct(pct(MEETING_ANY_30D, WINDOW.signups), 1)}</span>
          <span style={{ fontFamily: FONT_BODY, fontSize: 12, color: C.muted, marginLeft: 8 }}>{MEETING_ANY_30D} of {WINDOW.signups} signups · {rangeLabel(M.START, M.END)}, setup or not</span>
        </div>
      }
      footnote="Share of signups that completed setup and recorded at least one meeting within 7 days. Grouped by the week setup was completed (the last of recorder, calendar and email). Signups that finished setup in the last 7 days are still inside their window. Line gaps = weeks where nobody completed setup."
    />
  );
}

function FirstSendCard() {
  return (
    <ActivationCard
      stepKey="snd"
      accent={C.green}
      title="First customer send (A2)"
      question="Did the user send an email or asset to a customer using Mutiny?"
      rateLabel="First meeting → first customer send"
      cohortNoun="with a first meeting"
      convNoun="Sent or drafted first email"
      footnote="Share of signups with a first recorded meeting that have sent or drafted their first email (email_delivery_events: send or create_draft). Grouped by the week of the first meeting. Meetings count whether the capture was complete or partial. The export doesn't yet separate customer sends from internal ones, so all count for now."
    />
  );
}

function ComingSoonCard({ title, question, body, heading = 'Coming from stripe-dash' }) {
  return (
    <div className="full">
      <Card noRange title={title} question={question} accent={C.lightGrey}>
        <div style={{ marginTop: 16, border: `1px dashed ${C.black}`, borderRadius: 4, background: C.paper, padding: '28px 20px', textAlign: 'center' }}>
          <div style={{ fontFamily: FONT_DISPLAY, fontSize: 24, letterSpacing: '-0.02em' }}>{heading}</div>
          <div style={{ fontFamily: FONT_BODY, fontSize: 13, color: C.muted, marginTop: 6, maxWidth: 560, marginInline: 'auto', lineHeight: 1.5 }}>{body}</div>
        </div>
      </Card>
    </div>
  );
}

// --- Paid companies (Stripe, npm run pull-stripe) -------------------------------
// Paying PLG company at instant T = PLG customer whose MRR at T > 0 (stripe-dash
// billings engine: renewals reset MRR, mid-cycle adds raise it now, churn when
// the last sub ends). Graduated-to-enterprise accounts count only before their
// graduation date; enterprise never counts. All points are "as of the end of
// the week" and use the page's weeks (toggle-aware).
//   Sign up → paid (Nick, Oct 7): of the individual companies that have signed
//     up (distinct company ids whose first signup is on/after SIGNUP_COUNT_START,
//     up to that week's end), the share that are paying at that week's end.
//   Total paying users: signup rows (user + company, never deduped) on a company
//     that is paying at that week's end, signed up by then.
// Activated-user threshold for the company-level "activated → paid" cards
// (Nick, Oct 8: 1+ activated users; was 2+).
const ACT_MIN = 1;
const PAYING = (() => {
  const custs = (betaPaying.customers || []).filter((c) => c.ev?.length);
  if (!custs.length) return null;
  const mrrAtTs = (ev, ts) => { let m = 0; for (const [t, v] of ev) { if (t <= ts) m = v; else break; } return m; };
  const payingAt = (c, ts) => !(c.grad && ts >= c.grad) && mrrAtTs(c.ev, ts) > 1e-9;
  const signupDaysByCo = new Map();
  const firstDayByCo = new Map();
  for (const s of SIGNUPS) {
    if (!s.co) continue;
    (signupDaysByCo.get(s.co) || signupDaysByCo.set(s.co, []).get(s.co)).push(s.d);
    const f = firstDayByCo.get(s.co);
    if (!f || s.d < f) firstDayByCo.set(s.co, s.d);
  }
  // Sign up → paid cohort (Nick, Oct 7): companies whose first signup is on or
  // after SIGNUP_COUNT_START, PLUS any older company that has started paying by
  // then (e.g. accounts from before Feb 16 that converted later). So every
  // paying PLG company counts as a conversion, and is in the denominator too.
  const firstPaidTs = new Map();
  for (const c of custs) {
    const f = c.ev.find(([, v]) => v > 1e-9);
    if (c.co && f && (!firstPaidTs.has(c.co) || f[0] < firstPaidTs.get(c.co))) firstPaidTs.set(c.co, f[0]);
  }
  const inCohort = (co, day) => {
    const f = co && firstDayByCo.get(co);
    if (!f || f > day) return false;
    if (f >= SIGNUP_COUNT_START) return true;
    const fp = firstPaidTs.get(co);
    return Boolean(fp && fp <= Math.floor(Date.parse(`${day}T23:59:59Z`) / 1000));
  };
  // Day each company reached ACT_MIN activated users (any of its signups, any
  // signup date). Nick, Oct 8: criterion changed from 2+ to 1+ activated users.
  const secondActByCo = new Map();
  {
    const acts = new Map();
    for (const s of SIGNUPS) { const a = s.co && actDate(s); if (a) (acts.get(s.co) || acts.set(s.co, []).get(s.co)).push(a); }
    for (const [co, l] of acts) if (l.length >= ACT_MIN) secondActByCo.set(co, l.sort()[ACT_MIN - 1]);
  }
  // Company first paid strictly before it reached ACT_MIN activated users.
  const paidBeforeAct = (co) => {
    const fp = firstPaidTs.get(co);
    return Boolean(fp && toISO(new Date(fp * 1000)) < secondActByCo.get(co));
  };
  const pulledDay = betaPaying.pulledAt ? betaPaying.pulledAt.slice(0, 10) : DATA_END;
  // Points stop at whichever data ends first (Stripe pull or signups export).
  const last = pulledDay < DATA_END ? pulledDay : DATA_END;
  const cache = new Map();
  const asOf = (dayIn) => {
    const day = dayIn > last ? last : dayIn;
    if (cache.has(day)) return cache.get(day);
    const ts = Math.floor(Date.parse(`${day}T23:59:59Z`) / 1000);
    const list = custs.filter((c) => payingAt(c, ts));
    const mrr = list.reduce((sum, c) => sum + mrrAtTs(c.ev, ts), 0);
    let users = 0;
    let noCo = 0;
    for (const c of list) {
      if (!c.co) { noCo += 1; continue; }
      users += (signupDaysByCo.get(c.co) || []).filter((d) => d <= day).length;
    }
    let cohort = 0;
    for (const co of firstDayByCo.keys()) if (inCohort(co, day)) cohort += 1;
    const cohortPaying = list.filter((c) => inCohort(c.co, day)).length;
    // 1+ activated → paid (Nick, Oct 8): only activation that came BEFORE (or
    // on the same day as) the company's first payment counts. Denominator =
    // companies that reached ACT_MIN activated users by `day`, minus companies
    // that were already paying before that (paid first, activated later).
    // Numerator = those that are paying on `day`.
    let act2 = 0;
    for (const [co, d2] of secondActByCo) if (d2 <= day && !paidBeforeAct(co)) act2 += 1;
    const act2Paying = list.filter((c) => c.co && secondActByCo.has(c.co) && secondActByCo.get(c.co) <= day && !paidBeforeAct(c.co)).length;
    const r = {
      day, companies: list.length, arr: mrr * 12, users, noCo,
      perCo: list.length - noCo ? users / (list.length - noCo) : null,
      cohort, cohortPaying, conv: pct(cohortPaying, cohort),
      act2, act2Paying, act2Conv: pct(act2Paying, act2),
    };
    cache.set(day, r);
    return r;
  };
  // Companies line is reported by calendar month (Nick, Oct 7): headline = as
  // of the latest data day, compared with the end of the previous month.
  const prevMonthEnd = addDays(`${last.slice(0, 7)}-01`, -1);
  // What the Companies line compares with, per reporting period: a week ago /
  // end of last month / end of the month 3 months back (≈ a quarter).
  // Paid cards (Nick, Oct 7 — headlines match the reporting window): value as of
  // the period's last day, compared with the day before the period started.
  return { asOf, last, prevMonthEnd, pulledAt: betaPaying.pulledAt, custs, mrrAtTs };
})();
const payingWeekly = (M) => M.WEEKS.map((w) => ({ ...w, ...PAYING.asOf(w.partial ? DATA_END : w.end) }));

function PaidEmptyCard() {
  return (
    <ComingSoonCard
      title="Paying companies"
      question="Does the habit turn into revenue?"
      body="No Stripe data yet. Run npm run pull-stripe (needs STRIPE_API_KEY in .env.local) to load paying companies, then rebuild."
    />
  );
}

function SignupToPaidCard() {
  const M = useModel();
  const weeks = payingWeekly(M);
  const now = PAYING.asOf(M.END);
  const prev = PAYING.asOf(addDays(M.START, -1));
  return (
    <Card from={maxISO(STRIPE_START, SIGNUP_COUNT_START)}
      accent={C.green}
      title="Sign up → paid"
      question="What share of companies that sign up end up paying?"
      footnote={`Paying companies ÷ individual companies that have signed up, as of the end of each ${M.grainNoun}. Signed up = a distinct company id whose first signup is on or after ${monDay(SIGNUP_COUNT_START)}, ${SIGNUP_COUNT_START.slice(0, 4)} (same start as the signup counts), plus older companies once they've started paying (e.g. accounts from before ${monDay(SIGNUP_COUNT_START)} that converted later), so every paying PLG company counts. Paying = PLG Stripe customer with MRR above $0 (revenue dashboard definition). No goal set yet.`}
    >
      <StatRow delta={<Delta value={ptsDiff(now.conv, prev.conv)} suffix=" pts" />} deltaLabel={`vs ${monDay(addDays(M.START, -1))}`}>
        <Stat label={`Conversion · as of ${monDay(now.day)}`} value={fmtPct(now.conv, 1)} explain={`Of the ${fmtInt(now.cohort)} companies that signed up since ${monDay(SIGNUP_COUNT_START)} (plus older ones that started paying), ${fmtInt(now.cohortPaying)} (${fmtPct(now.conv, 1)}) were paying on ${monDay(now.day)}.`} sub={<span style={{ fontSize: 12, color: C.muted }}>{fmtInt(now.cohortPaying)} of {fmtInt(now.cohort)} companies</span>} />
        <Stat label="Goal" value="—" muted />
      </StatRow>
      <Legend items={[{ label: 'Actual %', color: C.black, line: true }, { label: 'Goal % (not set)', color: '#9A9A9A', line: true, dashed: true }]} />
      <ZoomContainer height={200}>
        <LineChart data={fromRows(weeks, maxISO(STRIPE_START, SIGNUP_COUNT_START))} margin={chartMargin}>
          {grid}
          <XAxis {...xAxis} />
          <YAxis {...yAxis} tickFormatter={(v) => `${v}%`} domain={[0, 'auto']} />
          <Tooltip content={({ active, payload }) => active && payload?.length ? (
            <TooltipBox title={weekTitle(payload[0].payload)} rows={[
              { label: 'Sign up → paid', value: fmtPct(payload[0].payload.conv, 2), color: C.black },
              { label: 'Paying companies', value: fmtInt(payload[0].payload.cohortPaying) },
              { label: 'Companies signed up', value: fmtInt(payload[0].payload.cohort) },
            ]} />
          ) : null} />
          <Line dataKey="conv" stroke={C.black} strokeWidth={2.5} dot={false} activeDot={{ r: 4, fill: C.green, stroke: C.black }} isAnimationActive={false} />
        </LineChart>
      </ZoomContainer>
    </Card>
  );
}

function Act2ToPaidCard() {
  const M = useModel();
  const weeks = payingWeekly(M);
  const now = PAYING.asOf(M.END);
  const prev = PAYING.asOf(addDays(M.START, -1));
  return (
    <Card from={maxISO(STRIPE_START, FIRST_ACT_TRACKED)}
      accent={C.purple}
      title="1+ activated users → paid"
      question="Of companies with at least 1 activated user, what share are paying?"
      footnote={`Of companies that had an activated user (sent or drafted an email, or published an asset) before or on the same day as their first payment, the share paying at the end of each ${M.grainNoun}. Companies that started paying first and only activated later are left out of both sides. Paying = PLG Stripe customer with MRR above $0 (revenue dashboard definition). No goal set yet.`}
    >
      <StatRow delta={<Delta value={ptsDiff(now.act2Conv, prev.act2Conv)} suffix=" pts" />} deltaLabel={`vs ${monDay(addDays(M.START, -1))}`}>
        <Stat
          label={`Conversion · as of ${monDay(now.day)}`}
          value={fmtPct(now.act2Conv, 1)}
          sub={<span style={{ fontSize: 12, color: C.muted }}>{fmtInt(now.act2Paying)} of {fmtInt(now.act2)} companies</span>}
          explain={`Of the ${fmtInt(now.act2)} companies that had an activated user before or on the day of their first payment (or haven't paid yet), ${fmtInt(now.act2Paying)} (${fmtPct(now.act2Conv, 1)}) were paying on ${monDay(now.day)} — vs ${fmtPct(now.conv, 1)} of all signed-up companies.`}
        />
        <Stat label="Goal" value="—" muted />
      </StatRow>
      <Legend items={[{ label: '1+ activated → paid', color: C.black, line: true }]} />
      <ZoomContainer height={200}>
        <LineChart data={fromRows(weeks, maxISO(STRIPE_START, FIRST_ACT_TRACKED))} margin={chartMargin}>
          {grid}
          <XAxis {...xAxis} />
          <YAxis {...yAxis} tickFormatter={(v) => `${v}%`} domain={[0, 'auto']} />
          <Tooltip content={({ active, payload }) => active && payload?.length ? (
            <TooltipBox title={weekTitle(payload[0].payload)} rows={[
              { label: '1+ activated → paid', value: fmtPct(payload[0].payload.act2Conv, 2), color: C.black },
              { label: 'Paying (1+ activated)', value: fmtInt(payload[0].payload.act2Paying) },
              { label: 'Companies with 1+ activated', value: fmtInt(payload[0].payload.act2) },
            ]} />
          ) : null} />
          <Line dataKey="act2Conv" stroke={C.black} strokeWidth={2.5} dot={false} activeDot={{ r: 4, fill: C.purple, stroke: C.black }} isAnimationActive={false} />
        </LineChart>
      </ZoomContainer>
    </Card>
  );
}

function PayingCompaniesCard() {
  const M = useModel();
  // Weekly line, week in progress dotted (Nick, Oct 20: top of the Paid tab).
  const weeks = payingWeekly(M).map((w, i, all) => ({ ...w, coFull: w.partial ? null : w.companies, coPartial: w.partial || all[i + 1]?.partial ? w.companies : null }));
  const now = PAYING.asOf(M.END);
  const prev = PAYING.asOf(addDays(M.START, -1));
  return (
    <Card from={STRIPE_START}
      accent={C.green}
      title="Paying companies (PLG)"
      question="How many self-serve companies are paying?"
      footnote={`Same definition as the revenue dashboard's Paying logos: one Stripe customer = one company, paying when its MRR (rebuilt from invoices) is above $0 at the end of each ${M.grainNoun}. Enterprise customers are excluded; accounts that graduated to enterprise count only until their graduation date. Scheduled-to-cancel and past-due still count. ${lineWeekNote(M)}`}
    >
      <StatRow delta={<Delta value={pctChange(now.companies, prev.companies)} />} deltaLabel={`vs ${monDay(addDays(M.START, -1))} (${fmtInt(prev.companies)})`}>
        <Stat label={`Paying · as of ${monDay(now.day)}`} value={fmtInt(now.companies)} explain={`${fmtInt(now.companies)} self-serve companies were paying on ${monDay(now.day)} (enterprise not included).`} />
        <Stat label="PLG ARR" value={`$${fmtInt(Math.round(now.arr))}`} explain={`Those companies pay $${fmtInt(Math.round(now.arr / 12))} a month in total, so $${fmtInt(Math.round(now.arr))} a year.`} />
      </StatRow>
      <Legend items={[{ label: `Paying companies (end of each ${M.grainNoun})`, color: C.black, line: true }]} />
      <ZoomContainer height={220}>
        <LineChart data={fromRows(weeks, STRIPE_START)} margin={chartMargin}>
          {grid}
          <XAxis {...xAxis} />
          <YAxis {...yAxis} allowDecimals={false} domain={[0, 'auto']} />
          <Tooltip content={({ active, payload }) => active && payload?.length ? (
            <TooltipBox title={weekTitle(payload[0].payload)} rows={[
              { label: 'Paying companies', value: fmtInt(payload[0].payload.companies), color: C.black },
              { label: 'PLG ARR', value: `$${fmtInt(Math.round(payload[0].payload.arr))}` },
              { label: 'Users in paying companies', value: fmtInt(payload[0].payload.users) },
            ]} />
          ) : null} />
          <Line dataKey="coFull" stroke={C.black} strokeWidth={2.5} dot={false} activeDot={{ r: 4, fill: C.green, stroke: C.black }} isAnimationActive={false} />
          <Line dataKey="coPartial" stroke={C.black} strokeWidth={2} strokeDasharray="2 4" dot={false} activeDot={{ r: 4, fill: C.green, stroke: C.black }} legendType="none" isAnimationActive={false} />
        </LineChart>
      </ZoomContainer>
    </Card>
  );
}

function TotalPayingUsersCard() {
  const M = useModel();
  const weeks = payingWeekly(M);
  const now = PAYING.asOf(M.END);
  const prev = PAYING.asOf(addDays(M.START, -1));
  return (
    <Card
      title="Total paying users"
      question="How many people sit inside paying companies?"
      footnote={`Users that are part of a paying PLG company at the end of each week: every signup (user + company, not deduped) on that company, made by then. Joined on the Mutiny company id (Stripe customer metadata.company_id = Metabase company_id). Uses today's company membership, so people removed from a company drop out of past weeks too. Drops when a company stops paying.${now.noCo ? ` ${now.noCo} paying Stripe customer${now.noCo === 1 ? ' has' : 's have'} no company id in Stripe, so their users can't be counted.` : ''} No goal set yet — the dashed goal line will be added once we have one.`}
    >
      <StatRow delta={<Delta value={pctChange(now.users, prev.users)} />} deltaLabel={`vs ${monDay(addDays(M.START, -1))} (${fmtInt(prev.users)})`}>
        <Stat label={`Actual · as of ${monDay(now.day)}`} value={fmtInt(now.users)} explain={`${fmtInt(now.users)} users belong to the ${fmtInt(now.companies)} companies that were paying on ${monDay(now.day)}.`} sub={<span style={{ fontSize: 12, color: C.muted }}>{now.perCo == null ? '' : `${now.perCo.toFixed(1)} per paying company`}</span>} />
        <Stat label="Goal" value="—" muted />
        <Stat label="Vs goal" value="—" muted />
      </StatRow>
      <Legend items={[{ label: 'Paying users (end of week)', color: C.black, line: true }, { label: 'Goal (not set)', color: '#9A9A9A', line: true, dashed: true }]} />
      <ZoomContainer height={220}>
        <LineChart data={weeks} margin={chartMargin}>
          {grid}
          <XAxis {...xAxis} />
          <YAxis {...yAxis} tickFormatter={fmtK} domain={[0, 'auto']} allowDecimals={false} />
          <Tooltip content={({ active, payload }) => active && payload?.length ? (
            <TooltipBox title={weekTitle(payload[0].payload)} rows={[
              { label: 'Paying users', value: fmtInt(payload[0].payload.users), color: C.black },
              { label: 'Paying companies', value: fmtInt(payload[0].payload.companies) },
              { label: 'Users per company', value: payload[0].payload.perCo == null ? '—' : payload[0].payload.perCo.toFixed(1) },
            ]} />
          ) : null} />
          <Line dataKey="users" stroke={C.black} strokeWidth={2.5} dot={false} activeDot={{ r: 4, fill: C.purple, stroke: C.black }} isAnimationActive={false} />
        </LineChart>
      </ZoomContainer>
    </Card>
  );
}

// --- Retained companies: monthly cohort retention (Stripe) -----------------------
// Cohort = the calendar month (UTC) a PLG company first started paying (first
// MRR event > $0). Month N = share of that cohort still paying (MRR > 0) at the
// end of the Nth month after (23:59:59 UTC on the last day, the revenue
// dashboard's month-end snapshot). Month 1 = "kept paying the next month".
// Graduating to enterprise isn't churn, so a graduated company counts as
// retained while it still has MRR. The current month is measured as of the
// latest Stripe day and marked in progress.
const RETENTION = (() => {
  if (!PAYING) return null;
  const { custs, mrrAtTs, last } = PAYING;
  const ymOf = (ts) => new Date(ts * 1000).toISOString().slice(0, 7);
  const addMonths = (ym, n) => { const d = new Date(Date.UTC(+ym.slice(0, 4), +ym.slice(5, 7) - 1 + n, 1)); return d.toISOString().slice(0, 7); };
  const monthEndTs = (ym) => Math.floor(Date.UTC(+ym.slice(0, 4), +ym.slice(5, 7), 0, 23, 59, 59) / 1000);
  const lastYm = last.slice(0, 7);
  const lastTs = Math.floor(Date.parse(`${last}T23:59:59Z`) / 1000);
  const byCohort = new Map();
  for (const c of custs) {
    const first = c.ev.find(([, v]) => v > 1e-9);
    if (!first || first[0] > lastTs) continue; // started after the data cut-off
    const ym = ymOf(first[0]);
    (byCohort.get(ym) || byCohort.set(ym, []).get(ym)).push(c);
  }
  const cohorts = [...byCohort.keys()].sort().map((ym) => {
    const list = byCohort.get(ym);
    const cells = [];
    for (let k = 0, m = ym; m <= lastYm; k += 1, m = addMonths(ym, k)) {
      const partial = m === lastYm;
      const ts = partial ? Math.min(lastTs, monthEndTs(m)) : monthEndTs(m);
      const kept = list.filter((c) => mrrAtTs(c.ev, ts) > 1e-9).length;
      cells.push({ k, month: m, kept, rate: pct(kept, list.length), partial });
    }
    return { ym, n: list.length, cells };
  });
  const maxK = Math.max(0, ...cohorts.map((c) => c.cells.length - 1));
  // Headline: Month-1 retention pooled over cohorts whose month 1 is complete.
  const m1 = cohorts.map((c) => c.cells[1]).filter((x) => x && !x.partial);
  const m1Base = cohorts.filter((c) => c.cells[1] && !c.cells[1].partial).reduce((s, c) => s + c.n, 0);
  const m1Kept = m1.reduce((s, x) => s + x.kept, 0);
  return { cohorts, maxK, m1Rate: pct(m1Kept, m1Base), m1Kept, m1Base, lastYm };
})();

const monthLabel = (ym) => `${MON[+ym.slice(5, 7) - 1]} ${ym.slice(0, 4)}`;
// Stepped purple scale (light → brand purple → deep) so neighbouring rates are
// easy to tell apart; steps are tighter at the top, where most retention sits.
// Ranges include the lower bound only (85–95% = 85.0 up to 94.9…). Rates are
// shown to one decimal — Nick doesn't want them rounded to whole numbers.
const HEAT_STEPS = [
  { min: 95, bg: '#5B0E91', fg: C.white, label: '95%+' },
  { min: 85, bg: '#8420CF', fg: C.white, label: '85–95%' },
  { min: 75, bg: '#A73BF5', fg: C.white, label: '75–85%' },
  { min: 65, bg: '#C47CF8', fg: C.black, label: '65–75%' },
  { min: 50, bg: '#DDB0FA', fg: C.black, label: '50–65%' },
  { min: 30, bg: '#EDD6FC', fg: C.black, label: '30–50%' },
  { min: 0, bg: '#F9EFFE', fg: C.black, label: '<30%' },
];
const heatStep = (rate) => (rate == null ? null : HEAT_STEPS.find((h) => rate >= h.min));

function CohortRetentionCard() {
  const R = RETENTION;
  const th = { ...eyebrow, fontSize: 10, padding: '10px 8px', textAlign: 'center', whiteSpace: 'nowrap', borderBottom: `1px solid ${C.black}`, background: C.paper };
  const cell = { ...tabular, fontFamily: FONT_BODY, fontSize: 13, padding: 0, textAlign: 'center', border: `1px solid ${C.white}`, height: 40, minWidth: 64 };
  return (
    <div className="full">
      <Card
        accent={C.purple}
        title="Monthly cohort retention"
        allTime="All cohorts"
        question="Of the companies that started paying in a month, how many are still paying in the months after?"
        footnote={`Cohort = the month a self-serve (PLG) company first started paying in Stripe. Month 1 = still paying at the end of the next month, Month 2 = the month after that, and so on (paying = MRR above $0 at month end, revenue dashboard definition). Month 0 = still paying at the end of the month they started. Companies that graduated to enterprise count as retained while they keep paying. Faded italic cells are the current month, measured as of ${monDay(PAYING.last)}. Cohorts start when Stripe went live (${monDay(betaPaying.historyStart || '2026-03-26')}).`}
      >
        <StatRow>
          <Stat label="Month-1 retention" value={fmtPct(R.m1Rate, 1)} explain={`Of the ${fmtInt(R.m1Base)} companies that started paying (in months that are now over), ${fmtInt(R.m1Kept)} (${fmtPct(R.m1Rate, 1)}) were still paying at the end of the following month.`} sub={<span style={{ fontSize: 12, color: C.muted }}>{fmtInt(R.m1Kept)} of {fmtInt(R.m1Base)} companies, all complete cohorts</span>} />
          <Stat label="Cohorts" value={fmtInt(R.cohorts.length)} explain={`One row per month that companies started paying in, ${fmtInt(R.cohorts.length)} so far.`} />
        </StatRow>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 4, marginTop: 14, fontFamily: FONT_BODY, fontSize: 11, color: C.muted }}>
          <span style={{ marginRight: 6 }}>Still paying</span>
          {[...HEAT_STEPS].reverse().map((h) => (
            <span key={h.label} style={{ background: h.bg, color: h.fg, border: `1px solid ${C.black}`, borderRadius: 2, padding: '2px 7px', fontWeight: 600 }}>{h.label}</span>
          ))}
        </div>
        <div style={{ overflowX: 'auto', margin: '20px -30px 0' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 160 + (R.maxK + 1) * 64 }}>
            <thead>
              <tr>
                <th style={{ ...th, textAlign: 'left', paddingLeft: 30 }}>Cohort</th>
                <th style={{ ...th, textAlign: 'right' }}>Companies</th>
                {Array.from({ length: R.maxK + 1 }, (_, k) => <th key={k} style={th}>Month {k}</th>)}
              </tr>
            </thead>
            <tbody>
              {R.cohorts.map((c) => (
                <tr key={c.ym}>
                  <td style={{ ...tabular, fontFamily: FONT_BODY, fontSize: 13.5, fontWeight: 600, padding: '0 14px 0 22px', whiteSpace: 'nowrap', borderBottom: `1px solid ${C.lightGrey}` }}>{monthLabel(c.ym)}</td>
                  <td style={{ ...tabular, fontFamily: FONT_BODY, fontSize: 13.5, padding: '0 14px', textAlign: 'right', borderBottom: `1px solid ${C.lightGrey}` }}>{fmtInt(c.n)}</td>
                  {Array.from({ length: R.maxK + 1 }, (_, k) => {
                    const x = c.cells[k];
                    if (!x) return <td key={k} style={{ ...cell, background: C.white }} />;
                    const h = heatStep(x.rate);
                    return (
                      <td
                        key={k}
                        title={`${monthLabel(c.ym)} cohort · ${monthLabel(x.month)}${x.partial ? ' (in progress)' : ''}: ${fmtInt(x.kept)} of ${fmtInt(c.n)} still paying`}
                        style={{ ...cell, background: h ? h.bg : C.white, fontStyle: x.partial ? 'italic' : 'normal', fontWeight: 600, color: h ? h.fg : C.black, opacity: x.partial ? 0.6 : 1 }}
                      >
                        {fmtPct(x.rate, 1)}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

// --- Does returning predict converting to paid? (company level) ------------------
// Leading-indicator test (Nick, Oct 7), built to avoid the usual traps:
//   Unit = company (signups since SIGNUP_COUNT_START, PLG Stripe as "paid").
//   2+ returning: companies with at least 2 returned users (returnedWithin);
//     anchor = the day the 2nd of them returned.
//   Fewer than 2: companies with ≥1 activated user but < 2 returned users
//     (a fair comparison — every 2+ company has activated users too);
//     anchor = the company's first activation day.
//   Converted = company's first paid day falls in the PAID_WINDOW days after
//     the anchor. Companies already paying on/before their anchor are left out
//     (paying can't be predicted after it happened). A company only counts once
//     its window has closed (anchor + PAID_WINDOW ≤ the as-of day).
//   Each weekly point = pooled rate over every company whose window had closed
//     by that week's end (running, so it's stable with small weekly numbers).
const PAID_WINDOW = 30;
const PREDICT = (() => {
  if (!PAYING) return null;
  const firstPaid = new Map(); // co -> first paid day (ISO)
  for (const c of PAYING.custs) {
    const f = c.ev.find(([, v]) => v > 1e-9);
    if (!c.co || !f) continue;
    const d = new Date(f[0] * 1000).toISOString().slice(0, 10);
    if (!firstPaid.has(c.co) || d < firstPaid.get(c.co)) firstPaid.set(c.co, d);
  }
  const byCo = new Map();
  for (const s of SIGNUPS) {
    if (!s.co || s.d < SIGNUP_COUNT_START) continue;
    const a = actDate(s);
    if (!a) continue;
    const b = byCo.get(s.co) || byCo.set(s.co, { acts: [], rets: [] }).get(s.co);
    b.acts.push(a);
    if (returnedWithin(s)) b.rets.push(s.ret);
  }
  const companies = [];
  let alreadyPaying = { T: 0, C: 0 };
  for (const [co, b] of byCo) {
    const grp = b.rets.length >= 2 ? 'T' : 'C';
    const anchor = grp === 'T' ? [...b.rets].sort()[1] : [...b.acts].sort()[0];
    const fp = firstPaid.get(co) || null;
    if (fp && fp <= anchor) { alreadyPaying[grp] += 1; continue; }
    const closes = addDays(anchor, PAID_WINDOW);
    companies.push({ co, grp, anchor, closes, conv: Boolean(fp && fp <= closes) });
  }
  const asOf = (day) => {
    const d = day > PAYING.last ? PAYING.last : day;
    const out = {};
    for (const g of ['T', 'C']) {
      const list = companies.filter((c) => c.grp === g && c.closes <= d);
      const k = list.filter((c) => c.conv).length;
      out[g] = { n: list.length, k, rate: pct(k, list.length) };
    }
    out.lift = out.T.rate != null && out.C.rate ? out.T.rate / out.C.rate : null;
    return out;
  };
  return { asOf, alreadyPaying, open: companies.filter((c) => c.closes > PAYING.last).length };
})();

function ReturningPredictsPaidCard() {
  const M = useModel();
  const P = PREDICT;
  const now = P.asOf(M.END);
  const weeks = M.WEEKS.map((w) => {
    const x = P.asOf(w.partial ? DATA_END : w.end);
    return { ...w, t: x.T.rate, c: x.C.rate, tN: x.T.n, tK: x.T.k, cN: x.C.n, cK: x.C.k, lift: x.lift };
  });
  const sub = (x) => <span style={{ fontSize: 12, color: C.muted }}>{fmtInt(x.k)} of {fmtInt(x.n)} companies</span>;
  return (
    <div className="full">
      <Card
        accent={C.green}
        title="Does returning predict converting to paid?"
        question={`Companies with 2+ returning users vs companies with fewer: share that start paying within ${PAID_WINDOW} days`}
        footnote={`Tests whether a company having 2 or more returning users is a strong signal for converting to paid; if those companies convert at several times the rate of the rest, it's worth tracking as a funnel step. Company level, companies with a signup since ${monDay(SIGNUP_COUNT_START)}. 2+ returning = at least 2 of the company's users returned (${RET_DEF.replace('Returned = ', '').replace(/\.$/, '')}); measured from the day the 2nd one returned. Fewer than 2 = companies with at least one activated user but 0–1 returning users; measured from their first activation. Converted = first paid (PLG Stripe, MRR above $0) within ${PAID_WINDOW} days after that day. Companies already paying before that day are left out (${fmtInt(P.alreadyPaying.T)} with 2+ returning, ${fmtInt(P.alreadyPaying.C)} with fewer), and companies whose ${PAID_WINDOW} days aren't up yet aren't counted (${fmtInt(P.open)} now). Each point pools every company whose window had closed by that week. Small numbers — read the 2+ line as directional.`}
      >
        <StatRow>
          <Stat label="Converted to paid: 2+ returning" value={fmtPct(now.T.rate, 1)} sub={sub(now.T)} explain={`Of ${fmtInt(now.T.n)} companies where 2+ users came back, ${fmtInt(now.T.k)} (${fmtPct(now.T.rate, 1)}) started paying within ${PAID_WINDOW} days of the 2nd one coming back.`} />
          <Stat label="Converted to paid: fewer than 2" value={fmtPct(now.C.rate, 1)} sub={sub(now.C)} explain={`Of ${fmtInt(now.C.n)} companies with an activated user but fewer than 2 coming back, ${fmtInt(now.C.k)} (${fmtPct(now.C.rate, 1)}) started paying within ${PAID_WINDOW} days of their first activation.`} />
          <Stat label="Lift" value={now.lift == null ? '—' : `${now.lift.toFixed(1)}×`} explain={now.lift == null ? null : `Companies with 2+ returning users were ${now.lift.toFixed(1)} times as likely to start paying.`} />
        </StatRow>
        <Legend items={[{ label: '2+ returning users', color: C.black, line: true }, { label: 'Fewer than 2', color: '#9A9A9A', line: true, dashed: true }]} />
        <ZoomContainer height={220}>
          <LineChart data={weeks} margin={chartMargin}>
            {grid}
            <XAxis {...xAxis} />
            <YAxis {...yAxis} tickFormatter={(v) => `${v}%`} domain={[0, 'auto']} />
            <Tooltip content={({ active, payload }) => active && payload?.length ? (
              <TooltipBox title={`As of ${weekTitle(payload[0].payload).replace('Week of ', 'week of ')}`} rows={[
                { label: '2+ returning', value: `${fmtPct(payload[0].payload.t, 1)} · ${fmtInt(payload[0].payload.tK)} of ${fmtInt(payload[0].payload.tN)}`, color: C.black },
                { label: 'Fewer than 2', value: `${fmtPct(payload[0].payload.c, 1)} · ${fmtInt(payload[0].payload.cK)} of ${fmtInt(payload[0].payload.cN)}`, color: '#9A9A9A' },
                { label: 'Lift', value: payload[0].payload.lift == null ? '—' : `${payload[0].payload.lift.toFixed(1)}×` },
              ]} />
            ) : null} />
            <Line dataKey="t" stroke={C.black} strokeWidth={2.5} dot={false} activeDot={{ r: 4, fill: C.green, stroke: C.black }} isAnimationActive={false} connectNulls />
            <Line dataKey="c" stroke="#9A9A9A" strokeWidth={2} strokeDasharray="5 4" dot={false} isAnimationActive={false} connectNulls />
          </LineChart>
        </ZoomContainer>
      </Card>
    </div>
  );
}

// --- Does activation predict paid and retention? (company level) -----------------
// Nick, Oct 7. Same leading-indicator rules as the returning card:
//   Nick, Oct 8: criterion changed to 1+ activated users (was 2+ vs exactly 1).
//   1+ activated: companies with at least 1 activated user (actDate);
//     anchor = the day the first user activated.
//   No activated users: companies with none; anchor = the company's first signup.
//   Converted to paid = first PLG paid day within PAID_WINDOW days after the
//     anchor; companies already paying by the anchor are left out; only
//     companies whose window has closed count.
//   Retention = of the companies that started paying, still paying at the end
//     of the month after their first paid month ("month 1", same as the cohort
//     heat map). Grouped by activated users AT the moment they started paying;
//     only companies whose month 1 has finished count.
const ACT_PREDICT = (() => {
  if (!PAYING) return null;
  const firstPaidTs = new Map(); // co -> first paid unix ts
  const custByCo = new Map();
  for (const c of PAYING.custs) {
    const f = c.ev.find(([, v]) => v > 1e-9);
    if (!c.co || !f) continue;
    if (!firstPaidTs.has(c.co) || f[0] < firstPaidTs.get(c.co)) { firstPaidTs.set(c.co, f[0]); custByCo.set(c.co, c); }
  }
  const isoOf = (ts) => new Date(ts * 1000).toISOString().slice(0, 10);
  const byCo = new Map();
  for (const s of SIGNUPS) {
    if (!s.co || s.d < SIGNUP_COUNT_START) continue;
    const b = byCo.get(s.co) || byCo.set(s.co, { first: s.d, acts: [] }).get(s.co);
    if (s.d < b.first) b.first = s.d;
    const a = actDate(s);
    if (a) b.acts.push(a);
  }
  const last = PAYING.last;
  const lastTs = Math.floor(Date.parse(`${last}T23:59:59Z`) / 1000);
  const monthEndTs = (ym) => Math.floor(Date.UTC(+ym.slice(0, 4), +ym.slice(5, 7), 0, 23, 59, 59) / 1000);
  const nextYm = (ym) => new Date(Date.UTC(+ym.slice(0, 4), +ym.slice(5, 7), 1)).toISOString().slice(0, 7);
  const paid = { T: { n: 0, k: 0 }, C: { n: 0, k: 0 } };
  const ret = { T: { n: 0, k: 0 }, C: { n: 0, k: 0 } };
  let excluded = 0;
  let open = 0;
  for (const [co, b] of byCo) {
    const acts = [...b.acts].sort();
    const grp = acts.length >= ACT_MIN ? 'T' : 'C';
    const anchor = grp === 'T' ? acts[ACT_MIN - 1] : b.first;
    const fpTs = firstPaidTs.get(co);
    const fp = fpTs ? isoOf(fpTs) : null;
    // Paid
    if (fp && fp <= anchor) excluded += 1;
    else {
      const closes = addDays(anchor, PAID_WINDOW);
      if (closes > last) open += 1;
      else { paid[grp].n += 1; if (fp && fp <= closes) paid[grp].k += 1; }
    }
    // Retention (companies that started paying; month 1 finished)
    if (fpTs) {
      const m1 = nextYm(fp.slice(0, 7));
      const m1End = monthEndTs(m1);
      if (m1End <= lastTs) {
        const nAct = acts.filter((a) => a <= fp).length;
        const g = nAct >= ACT_MIN ? 'T' : 'C';
        const ev = custByCo.get(co).ev;
        let m = 0;
        for (const [t, v] of ev) { if (t <= m1End) m = v; else break; }
        ret[g].n += 1;
        if (m > 1e-9) ret[g].k += 1;
      }
    }
  }
  const fin = (o) => { for (const g of ['T', 'C']) o[g].rate = pct(o[g].k, o[g].n); o.lift = o.T.rate != null && o.C.rate ? o.T.rate / o.C.rate : null; return o; };
  return { paid: fin(paid), ret: fin(ret), excluded, open };
})();

function LiftBars({ eyebrowLabel, verb, data, explain }) {
  const max = Math.max(data.T.rate || 0, data.C.rate || 0, 1);
  const bars = [
    { key: 'T', label: '1+ activated users', color: C.black, text: C.black },
    { key: 'C', label: 'No activated users', color: '#CFCFCF', text: C.black },
  ];
  return (
    <div style={{ minWidth: 0 }}>
      <div style={eyebrow}>{eyebrowLabel}</div>
      <div style={{ fontFamily: FONT_DISPLAY, fontSize: 26, letterSpacing: '-0.02em', lineHeight: 1.2, marginTop: 6 }}>
        <Explain text={data.lift == null ? null : explain(data)}>
          {data.lift == null ? 'Not enough data yet' : `${data.lift.toFixed(1)}× more likely to ${verb}`}
        </Explain>
      </div>
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-around', gap: 16, height: 190, marginTop: 18, borderBottom: `1px solid ${C.black}` }}>
        {bars.map((b) => {
          const x = data[b.key];
          return (
            <div key={b.key} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end', height: '100%', width: '32%' }}>
              <div style={{ ...tabular, fontFamily: FONT_BODY, fontSize: 14, fontWeight: 700, marginBottom: 6 }}>{fmtPct(x.rate, 1)}</div>
              <div style={{ width: '100%', height: `${Math.max(((x.rate || 0) / max) * 150, 2)}px`, background: b.color, border: `1px solid ${C.black}`, borderRadius: '4px 4px 0 0' }} />
            </div>
          );
        })}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-around', gap: 16, marginTop: 8 }}>
        {bars.map((b) => (
          <div key={b.key} style={{ width: '32%', textAlign: 'center', fontFamily: FONT_BODY, fontSize: 12.5 }}>
            <div style={{ fontWeight: 600 }}>{b.label}</div>
            <div style={{ ...tabular, color: C.muted, fontSize: 12 }}>{fmtInt(data[b.key].k)} of {fmtInt(data[b.key].n)} companies</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ActivationPredictsCard() {
  const P = ACT_PREDICT;
  return (
    <div className="full">
      <Card noRange
        accent={C.purple}
        title="Does activation predict paid and retention?"
        question="Companies with 1+ activated users vs companies with none: do they convert to paid, and keep paying?"
        footnote={`Company level, companies with a signup since ${monDay(SIGNUP_COUNT_START)}. Activated user = sent (or drafted) an email or published an asset. Converted to paid: 1+ activated = companies with at least 1 activated user, measured from the day the first one activated; no activated users = companies with none, measured from the company's first signup. Converted = first paid (PLG Stripe, MRR above $0) within ${PAID_WINDOW} days after that day. Companies already paying by then are left out (${fmtInt(P.excluded)}), and companies whose ${PAID_WINDOW} days aren't up yet aren't counted (${fmtInt(P.open)}). Retention rate: of the companies that started paying, the share still paying at the end of the month after their first paid month (month 1, same as the cohort heat map), grouped by how many activated users they had when they started paying (1+ vs none); only companies whose month 1 has finished count. Small numbers — read as directional.`}
      >
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 36, marginTop: 18 }}>
          <LiftBars eyebrowLabel={`Converted to paid (within ${PAID_WINDOW} days)`} verb="convert to paid" data={P.paid} explain={(d) => `${fmtPct(d.T.rate, 1)} of companies with 1+ activated users started paying within ${PAID_WINDOW} days, vs ${fmtPct(d.C.rate, 1)} of companies with none — ${d.lift.toFixed(1)} times as likely.`} />
          <LiftBars eyebrowLabel="Retention rate (month 1)" verb="retain" data={P.ret} explain={(d) => `Of paying companies, ${fmtPct(d.T.rate, 1)} of those with 1+ activated users were still paying a month later, vs ${fmtPct(d.C.rate, 1)} of those with none — ${d.lift.toFixed(1)} times as likely.`} />
        </div>
      </Card>
    </div>
  );
}

// --- Credits used, by billing cycle (Nick, Oct 7) ---------------------------------
// Credits reset every billing cycle, so usage is measured per cycle, not per
// calendar month. For each PLG company and each of its billing cycles (from its
// Stripe renewal invoices, pull-stripe → beta-paying.json `cy`):
//   Allowance = credits per $ × what the cycle was billed (renewal invoice +
//               any credit packs / manual charges paid inside the cycle).
//               Credits per $ = today's allowance ÷ today's MRR (the export only
//               has today's allowance; includes manual / reward credits, per
//               Nick); companies not paying today use the typical rate.
//   Used      = credits used from the cycle's first day to its last.
//   % used    = Used ÷ Allowance.
// Cycles that started before credit usage is tracked (Apr 1) are left out;
// cycles still running are "in progress" (used so far ÷ the full allowance).
// Two views: the monthly trend (each cycle counted in the month it ENDS) and
// the cohort heat map (M0 = a company's 1st cycle, M1 = 2nd, …).
const CREDIT_BANDS = [
  { key: 'b0', label: 'Under 10%', min: 0, color: '#F9EFFE', fg: C.black },
  { key: 'b10', label: '10–25%', min: 10, color: '#DDB0FA', fg: C.black },
  { key: 'b25', label: '25–50%', min: 25, color: '#C47CF8', fg: C.black },
  { key: 'b50', label: '50–100%', min: 50, color: '#A73BF5', fg: C.white },
  { key: 'b100', label: '100%+', min: 100, color: '#5B0E91', fg: C.white },
];
const creditBand = (p) => [...CREDIT_BANDS].reverse().find((b) => p >= b.min);
const medianOf = (xs) => {
  const v = [...xs].sort((a, b) => a - b);
  const n = v.length;
  return n ? (n % 2 ? v[(n - 1) / 2] : (v[n / 2 - 1] + v[n / 2]) / 2) : null;
};
// Summary of a set of cycle rows (a chart column, a heat-map cell, a modal).
function cycleSummary(rows) {
  const used = rows.reduce((t, r) => t + r.used, 0);
  const allowed = rows.reduce((t, r) => t + r.allowance, 0);
  const counts = Object.fromEntries(CREDIT_BANDS.map((b) => [b.key, rows.filter((r) => r.band === b.key).length]));
  // avg = average company % used (Nick, Oct 7: average instead of median).
  const avg = rows.length ? rows.reduce((t, r) => t + r.pct, 0) / rows.length : null;
  return { n: rows.length, used, allowed, pooled: pct(used, allowed), median: medianOf(rows.map((r) => r.pct)), avg, ...counts };
}

const CYCLE_CREDITS = (() => {
  if (!PAYING || !betaCredits?.daily || !betaCredits.usageLastDay) return null;
  const { custs, mrrAtTs, last } = PAYING;
  const allow = betaCredits.allowance || {};
  const daily = betaCredits.daily || {};
  const usageStart = betaCredits.usageFirstDay || '2026-04-01';
  const cut = betaCredits.usageLastDay < last ? betaCredits.usageLastDay : last;
  const lastTs = Math.floor(Date.parse(`${last}T23:59:59Z`) / 1000);
  const isoOf = (ts) => toISO(new Date(ts * 1000));
  const payingNow = (c) => !(c.grad && lastTs >= c.grad) && mrrAtTs(c.ev, lastTs) > 1e-9;
  const perDollar = new Map();
  for (const c of custs) {
    const a = c.co && allow[c.co]?.a;
    const m = mrrAtTs(c.ev, lastTs);
    if (a > 0 && m > 1e-9 && payingNow(c)) perDollar.set(c.co, a / m);
  }
  const typical = medianOf([...perDollar.values()]) || 2;
  const rows = [];
  for (const c of custs) {
    if (!c.co || !c.cy?.length) continue;
    const firstPaid = c.ev.find(([, v]) => v > 1e-9);
    const cohort = firstPaid ? isoOf(firstPaid[0]).slice(0, 7) : isoOf(c.cy[0][0]).slice(0, 7);
    const rate = perDollar.get(c.co) || typical;
    const snap = allow[c.co] || {};
    const dd = daily[c.co] || {};
    c.cy.forEach(([s, e, billed, adds], k) => {
      if (c.grad && s >= c.grad) return; // enterprise from here on
      const startDay = isoOf(s);
      const lastDay = addDays(isoOf(e), -1);
      if (startDay < usageStart || startDay > cut) return; // usage not tracked / not started
      const allowance = rate * (billed + adds);
      if (!(allowance > 0)) return;
      const complete = lastDay <= cut;
      const upto = complete ? lastDay : cut;
      let used = 0;
      for (const [d, v] of Object.entries(dd)) if (d >= startDay && d <= upto) used += v;
      const p = (used / allowance) * 100;
      rows.push({
        co: c.co, cus: c.cus, name: snap.n || null, cohort, k, startDay, lastDay, upto, complete,
        billed, adds, rate, rateEstimated: !perDollar.has(c.co), allowance, used, pct: p, band: creditBand(p).key,
        allowNow: snap.a ?? null, man: snap.man ?? null, rew: snap.rew ?? null, u30: snap.u30 ?? null, pctNow: snap.pctNow ?? null,
      });
    });
  }
  // Trend: completed cycles by the month they ended, + one column for cycles in progress.
  const cutMonth = cut.slice(0, 7);
  const done = rows.filter((r) => r.complete);
  const monthsSet = [...new Set(done.map((r) => r.lastDay.slice(0, 7)))].sort();
  const columns = monthsSet.map((m) => {
    const list = done.filter((r) => r.lastDay.slice(0, 7) === m);
    const soFar = m === cutMonth;
    return { key: m, label: `${MON[+m.slice(5, 7) - 1]}${soFar ? ' (so far)' : ''}`, title: `Cycles ending in ${monthLabel(m)}${soFar ? ` (to ${monDay(cut)})` : ''}`, soFar, rows: list, ...cycleSummary(list) };
  });
  const running = rows.filter((r) => !r.complete);
  // "Current" column (cycles still running) hidden from the chart (Nick, Oct 8).
  if (false && running.length) columns.push({ key: 'current', label: 'Current', title: `Cycles in progress (usage to ${monDay(cut)})`, current: true, rows: running, ...cycleSummary(running) });
  for (const col of columns) col.avgLine = col.current ? null : col.avg;
  const full = columns.filter((c) => !c.current && !c.soFar);
  // Cohort heat map: rows = month the company started paying, cols = cycle number.
  const cohorts = [...new Set(rows.map((r) => r.cohort))].sort().map((ym) => {
    const mine = rows.filter((r) => r.cohort === ym);
    const cells = [];
    const maxK = Math.max(...mine.map((r) => r.k));
    for (let k = 0; k <= maxK; k += 1) {
      const all = mine.filter((r) => r.k === k);
      const doneK = all.filter((r) => r.complete);
      const shown = doneK.length ? doneK : all; // only in-progress cycles → show those, faded
      cells.push(all.length ? { k, rows: all, inProgress: !doneK.length, open: all.length - doneK.length, ...cycleSummary(shown) } : null);
    }
    return { ym, n: new Set(mine.map((r) => r.co)).size, cells };
  });
  const maxK = Math.max(0, ...cohorts.map((c) => c.cells.length - 1));
  // Finished cycles that ended in [a, b] — the headline uses the reporting period.
  const ending = (a, b) => { const list = done.filter((r) => r.lastDay >= a && r.lastDay <= b); return { rows: list, ...cycleSummary(list) }; };
  return { rows, columns, ending, cohorts, maxK, typical, cut, usageStart };
})();

// QA modal: one row per company-cycle.
const STRIPE_CUS_URL = 'https://dashboard.stripe.com/customers/';
const ADMIN_COMPANY_URL = 'https://admin.mutinyhq.com/companies/';
function CreditsModal({ data, onClose }) {
  const [band, setBand] = useState(data.band || 'all');
  const [sortKey, setSortKey] = useState('pct');
  const [asc, setAsc] = useState(false);
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const all = data.rows;
  const counts = cycleSummary(all);
  const rows = all
    .filter((r) => band === 'all' || r.band === band)
    .sort((a, b) => {
      const x = a[sortKey] ?? -Infinity;
      const y = b[sortKey] ?? -Infinity;
      const d = typeof x === 'string' || typeof y === 'string' ? String(x).localeCompare(String(y)) : x - y;
      return asc ? d : -d;
    });
  const S = cycleSummary(rows);
  const snapDay = (String(betaCredits.allowanceFile || '').match(/(\d{4}-\d{2}-\d{2})T/) || [])[1] || null;
  const snapLabel = snapDay ? monDay(snapDay) : 'the export date';
  const cyc = (r) => `${rangeLabel(r.startDay, r.lastDay)}${r.complete ? '' : ' (running)'}`;
  const cols = [
    { key: 'name', label: 'Company', desc: 'Company name — opens its Mutiny admin page. Stripe ↗ opens the Stripe customer.' },
    { key: 'startDay', label: 'Billing cycle', desc: 'The billing cycle, from its Stripe renewal invoice (first day – last day). M0 is a company’s first cycle, M1 its second, and so on.', fmt: (r) => <span>{cyc(r)} <span style={{ color: C.muted }}>· M{r.k}</span></span> },
    { key: 'billed', label: 'Billed', desc: 'What the cycle was billed in Stripe: the renewal invoice, plus any credit packs / manual charges paid during the cycle (in brackets).', num: true, fmt: (r) => <span>${fmtInt(r.billed)}{r.adds ? <span style={{ color: C.muted }}> (+${fmtInt(r.adds)})</span> : null}</span> },
    { key: 'rate', label: 'Credits / $', desc: 'Credits per $1 billed = allowance today ÷ MRR today. * = not paying today, so the typical rate is used.', num: true, fmt: (r) => <span>{r.rate.toFixed(2)}{r.rateEstimated ? '*' : ''}</span> },
    { key: 'allowance', label: 'Cycle allowance', desc: 'Credits the company had for this cycle = credits / $ × billed.', num: true, fmt: (r) => fmtInt(r.allowance) },
    { key: 'used', label: 'Used', desc: 'Credits the company used from the first to the last day of this cycle (to the latest credit data for a running cycle), from the credit usage export.', num: true, fmt: (r) => (r.used ? r.used.toLocaleString(undefined, { maximumFractionDigits: 2 }) : '0') },
    { key: 'pct', label: '% used', desc: 'Used ÷ cycle allowance. The colour is the usage band.', num: true, fmt: (r) => <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><span style={{ width: 9, height: 9, borderRadius: 2, border: `1px solid ${C.black}`, background: CREDIT_BANDS.find((b) => b.key === r.band).color }} />{fmtPct(r.pct, 1)}</span> },
    { key: 'allowNow', label: 'Allowance today', desc: `The company's credit allowance on ${snapLabel}, straight from the allowance export (includes manual / reward credits).`, num: true, fmt: (r) => (r.allowNow == null ? '—' : fmtInt(r.allowNow)) },
    { key: 'man', label: 'Manual adj. (today)', desc: `One-off manual credit adjustments in the company's allowance on ${snapLabel} (reward credits in brackets). They're included in Allowance today and so in Credits / $.`, num: true, fmt: (r) => (r.man == null && r.rew == null ? '—' : <span>{r.man == null ? '0' : fmtInt(r.man)}{r.rew ? <span style={{ color: C.muted }}> (+{fmtInt(r.rew)} reward)</span> : null}</span>) },
    { key: 'u30', label: 'Used last 30d (today)', desc: `Credits used in the 30 days before ${snapLabel}, straight from the allowance export — for sanity-checking.`, num: true, fmt: (r) => (r.u30 == null ? '—' : r.u30.toLocaleString(undefined, { maximumFractionDigits: 2 })) },
    { key: 'pctNow', label: '% of current cycle (today)', desc: `Share of the current cycle's allowance used, as of ${snapLabel}, from the allowance export. For a running cycle it should be close to "% used".`, num: true, fmt: (r) => (r.pctNow == null ? '—' : `${r.pctNow.toFixed(1)}%`) },
  ];
  const downloadCsv = () => {
    const head = ['company', 'company_id', 'stripe_customer_id', 'cycle', 'cycle_start', 'cycle_end', 'cycle_complete', 'cycle_number', 'billed_renewal', 'billed_adds', 'credits_per_dollar', 'credits_per_dollar_estimated', 'cycle_allowance', 'credits_used', 'pct_used', 'band', 'allowance_today', 'manual_adjustment_today', 'reward_bonus_today', 'used_last_30d_today', 'pct_current_cycle_today'];
    const esc = (v) => (v == null ? '' : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
    const lines = rows.map((r) => [r.name, r.co, r.cus, cyc(r), r.startDay, r.lastDay, r.complete, `M${r.k}`, r.billed, r.adds, r.rate.toFixed(4), r.rateEstimated, r.allowance.toFixed(2), r.used, r.pct.toFixed(2), CREDIT_BANDS.find((b) => b.key === r.band).label, r.allowNow, r.man, r.rew, r.u30, r.pctNow].map(esc).join(','));
    try {
      const url = URL.createObjectURL(new Blob([[head.join(','), ...lines].join('\n')], { type: 'text/csv' }));
      const a = document.createElement('a');
      a.href = url; a.download = `credits_by_cycle_${data.file || 'export'}${band === 'all' ? '' : `_${band}`}.csv`; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) { /* ignore */ }
  };
  const th = { ...eyebrow, fontSize: 10, padding: '8px 10px', borderBottom: `1px solid ${C.black}`, background: C.paper, position: 'sticky', top: 0, cursor: 'pointer', whiteSpace: 'nowrap', userSelect: 'none' };
  const td = { ...tabular, fontFamily: FONT_BODY, fontSize: 12.5, padding: '7px 10px', borderBottom: `1px solid ${C.lightGrey}`, whiteSpace: 'nowrap' };
  const chip = (key, label, color) => (
    <button key={key} type="button" onClick={() => setBand(key)} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, border: `1px solid ${C.black}`, borderRadius: 999, padding: '3px 10px', background: band === key ? C.black : C.white, color: band === key ? C.white : C.black, fontFamily: FONT_BODY, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
      {color && <span style={{ width: 9, height: 9, borderRadius: 2, border: `1px solid ${band === key ? C.white : C.black}`, background: color }} />}
      {label} · {key === 'all' ? all.length : counts[key]}
    </button>
  );
  return (
    <div role="presentation" onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div role="dialog" aria-modal="true" aria-label={data.title} onClick={(e) => e.stopPropagation()} style={{ background: C.white, border: `1px solid ${C.black}`, borderRadius: 4, boxShadow: `6px 6px 0 ${C.purple}`, width: 'min(1280px, 100%)', maxHeight: '86vh', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '16px 20px 12px', borderBottom: `1px solid ${C.lightGrey}` }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16 }}>
            <div>
              <div style={{ fontFamily: FONT_BODY, fontSize: 16, fontWeight: 700 }}>{data.title}</div>
              <div style={{ fontFamily: FONT_BODY, fontSize: 13, color: C.muted, marginTop: 3 }}>
                {fmtInt(S.n)} company cycles · used {fmtInt(S.used)} of {fmtInt(S.allowed)} credits ({fmtPct(S.pooled, 1)}) · average {fmtPct(S.avg, 1)} · median {fmtPct(S.median, 1)}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
              <button type="button" onClick={downloadCsv} style={{ border: `1px solid ${C.black}`, borderRadius: 4, background: C.white, cursor: 'pointer', fontFamily: FONT_BODY, fontSize: 13, fontWeight: 600, padding: '4px 10px' }}>Download CSV</button>
              <button type="button" onClick={onClose} aria-label="Close" style={{ border: `1px solid ${C.black}`, borderRadius: 4, background: C.white, cursor: 'pointer', fontFamily: FONT_BODY, fontSize: 13, fontWeight: 600, padding: '4px 10px' }}>Close</button>
            </div>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
            {chip('all', 'All')}
            {[...CREDIT_BANDS].reverse().map((b) => chip(b.key, b.label, b.color))}
          </div>
        </div>
        <div style={{ overflow: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                {cols.map((c) => (
                  <th key={c.key} onClick={() => { if (sortKey === c.key) setAsc(!asc); else { setSortKey(c.key); setAsc(c.key === 'name' || c.key === 'startDay'); } }} style={{ ...th, textAlign: c.num ? 'right' : 'left' }}>
                    <Explain text={c.desc} alignRight={c.num}>{c.label}</Explain>{sortKey === c.key ? (asc ? ' ↑' : ' ↓') : ''}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={`${r.co}-${r.k}`} style={r.complete ? undefined : { color: C.muted, fontStyle: 'italic' }}>
                  <td style={{ ...td, fontWeight: 600, fontStyle: 'normal' }}>
                    <a href={`${ADMIN_COMPANY_URL}${r.co}`} target="_blank" rel="noopener noreferrer" style={{ color: C.purple, textDecoration: 'underline', textUnderlineOffset: 2 }}>{r.name || r.co.slice(0, 8)}</a>
                    {r.cus && <a href={`${STRIPE_CUS_URL}${r.cus}`} target="_blank" rel="noopener noreferrer" style={{ marginLeft: 8, fontSize: 11, fontWeight: 500, color: C.muted }}>Stripe ↗</a>}
                  </td>
                  {cols.slice(1).map((c) => <td key={c.key} style={{ ...td, textAlign: c.num ? 'right' : 'left' }}>{c.fmt(r)}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div style={{ padding: '10px 20px', borderTop: `1px solid ${C.lightGrey}`, fontFamily: FONT_CAPTION, fontStyle: 'italic', fontSize: 12, color: C.muted, lineHeight: 1.5 }}>
          One row per company billing cycle. Cycle allowance = credits per $ × billed; credits per $ = today's allowance ÷ today's MRR (* = not paying today, typical rate used). Running cycles are in grey italics (usage so far ÷ the full allowance). "Today" columns come straight from the credit allowance export, for cross-checking. Hover a column title for what it means; click it to sort.
        </div>
      </div>
    </div>
  );
}

function CreditsUsedCard() {
  const M = useModel();
  const D = CYCLE_CREDITS;
  // Headline = cycles that ended in the reporting period (Nick, Oct 7), vs the prior period.
  const L = D.ending(M.START, M.END < D.cut ? M.END : D.cut);
  const P = D.ending(M.PRIOR_START, M.PRIOR_END);
  const [detail, setDetail] = useState(null);
  const barClicked = React.useRef(false); // a band click wins over the column click that follows
  const open = (col, band = 'all') => setDetail({ title: col.title, rows: col.rows, band, file: col.key });
  const lastLabel = rangeLabel(M.START, M.END < D.cut ? M.END : D.cut);
  return (
    <div className="full">
      {detail && <CreditsModal data={detail} onClose={() => setDetail(null)} />}
      <Card from={betaCredits?.usageFirstDay || undefined}
        accent={C.purple}
        title="Credits used per billing cycle"
        question="How much of each billing cycle's credits do paying companies use?"
        footnote={`One point per paying self-serve (PLG) company per billing cycle (from its Stripe renewal invoices). % used = credits used during the cycle ÷ the cycle's allowance (credits per $ × what the cycle was billed, incl. credit packs bought mid-cycle). Credits per $ comes from today's allowance export (includes manual / reward credits); companies not paying today use the typical ${D.typical.toFixed(1)} credits per $. Each column counts the cycles that ENDED in that month; cycles still running aren't shown (usage so far would read low). Columns = how many company cycles fall in each usage band; the line = the average company % used (each company counts equally). Cycles that began before credit usage is tracked (${monDay(D.usageStart)}) are left out. The headline covers cycles that ended in the reporting period, vs the period before. Click a column (or one band of it) to see each company's cycle, billing, allowance and usage.`}
      >
        {L.n > 0 && (
          <StatRow delta={<Delta value={P.n ? ptsDiff(L.avg, P.avg) : null} suffix=" pts" />} deltaLabel={`vs cycles ending ${rangeLabel(M.PRIOR_START, M.PRIOR_END)}`}>
            {/* Only the average (Nick, Oct 8); "All credits used" and "Used under 10%" removed. */}
            <Stat label={`Avg. credits used of allotment · cycles ending ${lastLabel}`} value={fmtPct(L.avg, 1)} sub={`${fmtInt(L.n)} company cycles · median ${fmtPct(L.median, 1)} · ${fmtInt(L.used)} of ${fmtInt(L.allowed)} credits used overall (${fmtPct(L.pooled, 1)}) · ${fmtInt(L.b0)} cycles used under 10%`} explain={`For billing cycles that ended ${lastLabel}, paying companies used ${fmtPct(L.avg, 1)} of that cycle's credit allotment on average (each company counts equally; a few heavy users pull it above the median of ${fmtPct(L.median, 1)}).`} />
          </StatRow>
        )}
        <Legend style={{ margin: '14px 0 6px' }} items={[...CREDIT_BANDS.map((b) => ({ label: b.label, color: b.color })), { label: 'Average % (line)', color: C.black, line: true }]} />
        <ZoomContainer height={260}>
          <ComposedChart data={D.columns} margin={chartMargin} barCategoryGap="26%" style={{ cursor: 'pointer' }} onClick={(e) => { if (barClicked.current) { barClicked.current = false; return; } const col = e?.activePayload?.[0]?.payload; if (col) open(col); }}>
            {grid}
            <XAxis {...xAxis} />
            <YAxis yAxisId="n" {...yAxis} allowDecimals={false} />
            <YAxis yAxisId="p" orientation="right" {...yAxis} tickFormatter={(v) => `${v}%`} />
            <Tooltip cursor={cursor} content={({ active, payload }) => active && payload?.length ? (
              <TooltipBox
                title={payload[0].payload.title}
                rows={[
                  { label: 'Average', value: fmtPct(payload[0].payload.avg, 1), color: C.black },
                  { label: 'Median', value: fmtPct(payload[0].payload.median, 1) },
                  { label: 'All credits used', value: `${fmtPct(payload[0].payload.pooled, 1)} · ${fmtInt(payload[0].payload.used)} of ${fmtInt(payload[0].payload.allowed)}` },
                  ...[...CREDIT_BANDS].reverse().map((b) => ({ label: b.label, color: b.color, value: `${fmtInt(payload[0].payload[b.key])} cycles` })),
                ]}
                note="Click to see each company's cycle, billing and usage"
              />
            ) : null} />
            {CREDIT_BANDS.map((b) => (
              <Bar key={b.key} yAxisId="n" dataKey={b.key} stackId="cb" stroke={C.black} strokeWidth={0.5} isAnimationActive={false} onClick={(d) => { if (d?.payload) { barClicked.current = true; open(d.payload, b.key); } }}>
                {D.columns.map((x) => <Cell key={x.key} fill={b.color} fillOpacity={x.current || x.soFar ? 0.45 : 1} />)}
              </Bar>
            ))}
            <Line yAxisId="p" dataKey="avgLine" stroke={C.black} strokeWidth={2.5} dot={{ r: 3, fill: C.black }} isAnimationActive={false} />
          </ComposedChart>
        </ZoomContainer>
      </Card>
    </div>
  );
}

// Cohort heat map of credit usage: rows = month the company started paying,
// columns = billing cycle number (M0 = first cycle). Cell = average % of that
// cycle's credits used (completed cycles; a cell with only running cycles
// shows them faded).
function CreditsCohortCard() {
  const D = CYCLE_CREDITS;
  const [detail, setDetail] = useState(null);
  const th = { ...eyebrow, fontSize: 10, padding: '10px 8px', textAlign: 'center', whiteSpace: 'nowrap', borderBottom: `1px solid ${C.black}`, background: C.paper };
  const cell = { ...tabular, fontFamily: FONT_BODY, fontSize: 13, padding: 0, textAlign: 'center', border: `1px solid ${C.white}`, height: 40, minWidth: 64 };
  return (
    <div className="full">
      {detail && <CreditsModal data={detail} onClose={() => setDetail(null)} />}
      <Card
        accent={C.purple}
        title="Credits used by billing cycle (cohorts)"
        allTime="All cohorts"
        question="Do companies use more or less of their credits the longer they pay?"
        footnote={`Rows = the month a self-serve company started paying (same cohorts as the retention heat map). M0 = its first billing cycle, M1 the second, and so on. Each cell = the average % of that cycle's credits used across the cohort's companies (each company counts equally) (credits used during the cycle ÷ the cycle's allowance — same method as the chart above), over cycles that have finished; hover for counts, click for the companies. A cell whose cycles are all still running shows usage so far, faded. Cycles that began before credit usage is tracked (${monDay(D.usageStart)}) are blank. Read it next to the retention heat map: falling usage in early cycles often comes before churn.`}
      >
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 4, marginTop: 14, fontFamily: FONT_BODY, fontSize: 11, color: C.muted }}>
          <span style={{ marginRight: 6 }}>Average % used</span>
          {CREDIT_BANDS.map((b) => <span key={b.key} style={{ background: b.color, color: b.fg, border: `1px solid ${C.black}`, borderRadius: 2, padding: '2px 7px', fontWeight: 600 }}>{b.label}</span>)}
        </div>
        <div style={{ overflowX: 'auto', margin: '20px -30px 0' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 160 + (D.maxK + 1) * 64 }}>
            <thead>
              <tr>
                <th style={{ ...th, textAlign: 'left', paddingLeft: 30 }}>Started paying</th>
                <th style={{ ...th, textAlign: 'right' }}>Companies</th>
                {Array.from({ length: D.maxK + 1 }, (_, k) => <th key={k} style={th}>M{k}</th>)}
              </tr>
            </thead>
            <tbody>
              {D.cohorts.map((c) => (
                <tr key={c.ym}>
                  <td style={{ ...tabular, fontFamily: FONT_BODY, fontSize: 13.5, fontWeight: 600, padding: '0 14px 0 22px', whiteSpace: 'nowrap', borderBottom: `1px solid ${C.lightGrey}` }}>{monthLabel(c.ym)}</td>
                  <td style={{ ...tabular, fontFamily: FONT_BODY, fontSize: 13.5, padding: '0 14px', textAlign: 'right', borderBottom: `1px solid ${C.lightGrey}` }}>{fmtInt(c.n)}</td>
                  {Array.from({ length: D.maxK + 1 }, (_, k) => {
                    const x = c.cells[k];
                    if (!x) return <td key={k} style={{ ...cell, background: C.white, color: '#C9C9C9' }}>{k < c.cells.length ? '—' : ''}</td>;
                    const b = x.avg == null ? null : creditBand(x.avg);
                    return (
                      <td
                        key={k}
                        onClick={() => setDetail({ title: `Started paying ${monthLabel(c.ym)} · cycle M${k}`, rows: x.rows, file: `${c.ym}_M${k}` })}
                        title={`${monthLabel(c.ym)} cohort · M${k}: average ${fmtPct(x.avg, 1)} (median ${fmtPct(x.median, 1)}) of ${fmtInt(x.n)} ${x.inProgress ? 'running' : 'finished'} cycles${!x.inProgress && x.open ? ` (+${x.open} still running)` : ''} · click for companies`}
                        style={{ ...cell, cursor: 'pointer', background: b ? b.color : C.white, color: b ? b.fg : C.black, fontWeight: 600, fontStyle: x.inProgress ? 'italic' : 'normal', opacity: x.inProgress ? 0.55 : 1 }}
                      >
                        {fmtPct(x.avg, 1)}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

// Collapsible detail section (closed by default). Children only mount when
// open, so hidden charts don't render.
function Collapsible({ title, children, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section style={{ margin: '36px 0 0' }}>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        style={{ display: 'inline-flex', alignItems: 'center', gap: 8, border: `1px solid ${C.black}`, borderRadius: 4, background: C.white, cursor: 'pointer', fontFamily: FONT_BODY, fontSize: 14, fontWeight: 700, padding: '8px 14px', boxShadow: `2px 2px 0 ${C.black}` }}
      >
        <span aria-hidden="true" style={{ display: 'inline-block', transition: 'transform 120ms', transform: open ? 'rotate(90deg)' : 'none' }}>›</span>
        {title}
      </button>
      {open && <div style={{ marginTop: 20 }}>{children}</div>}
    </section>
  );
}

// --- Activation funnels (Nick, Oct 20) ---------------------------------------------
// Two Amplitude-style funnels on the Activation tab, one per sign up type:
//   Org creators   created a new company (isCreator: not jx, not nc)
//   Invited users  joined an existing company (jx: accepted an invite or
//                  joined a teammate's workspace)
// Cohort = that type's sign ups in the reporting period, clamped to start no
// earlier than the week of Sep 7, 2026 (AF_START, the first full week every
// source has data: recorder installs from Aug 27, email sends from Sep 4);
// a period ending before that shows an empty state.
// Steps are NOT sequential (Nick, Oct 20 — some steps aren't required): each
// step counts every sign up in the cohort that has done it, any time so far,
// whether or not they did the other steps. Bars are % of the cohort's sign
// ups: solid = did the step, striped = hasn't yet. Click either part to list them.
const AF_START = '2026-09-07';
const AF_SEGMENTS = {
  creators: { title: 'Activation funnel — org creators', who: 'org creators', filter: isCreator, def: 'sign ups that created a new company (workspace)' },
  invited: { title: 'Activation funnel — invited users', who: 'invited users', filter: (s) => Boolean(s.jx), def: 'sign ups that joined an existing company (accepted an invite or joined a teammate’s workspace)' },
};
const onbStepsDone = (s) => STEPS.filter((st) => ONB_KEYS.includes(st.key) && s[st.key]).map((st) => st.label.replace(/ (installed|connected)$/, '')).join(' · ') || 'None yet';
// Funnel modal: one column per step — ✓ + date when done, otherwise — (with
// what's partly done in grey).
const afDone = (txt) => <span><span style={{ color: C.up, fontWeight: 700 }}>✓</span> {txt}</span>;
const afNo = (hint) => <span style={{ color: C.muted }}>—{hint ? ` ${hint}` : ''}</span>;
const AF_STAGE_COLS = [
  { label: 'Signed up', render: (s) => afDone(monDay(s.d)) },
  { label: 'Completed onboarding', render: (s) => {
    if (isSetUp(s)) return afDone(monDay(onbDate(s)));
    const done = ONB_KEYS.filter((k) => s[k]).length;
    return afNo(`${done} of ${ONB_KEYS.length}${done ? ` (${onbStepsDone(s)})` : ''}`);
  } },
  { label: 'Activated', render: (s) => (actDate(s) ? afDone(`${monDay(actDate(s))} · ${activatedVia(s)}`) : afNo('')) },
];
const buildActFunnel = (a, b, seg) => {
  const cohort = signupsIn(a, b).filter(AF_SEGMENTS[seg].filter);
  return [
    { key: 'signups', label: 'Sign ups', list: cohort, dateOf: (u) => u.d, def: `${AF_SEGMENTS[seg].def} (never-completed sign ups excluded, as in the Sign ups metric)` },
    { key: 'onboarded', label: 'Completed onboarding', list: cohort.filter(isSetUp), dateOf: onbDate, def: ONB_DEF_TEXT },
    { key: 'activated', label: 'Activated', list: cohort.filter((s) => Boolean(actDate(s))), dateOf: actDate, def: 'sent (or drafted) an email or published an asset' },
  ];
};

function ActivationFunnelCard({ segment }) {
  const SEG = AF_SEGMENTS[segment];
  const openUsers = useUsersModal();
  const M = useModel();
  const afFrom = M.START > AF_START ? M.START : AF_START;
  const afTo = M.END;
  const outOfRange = afTo < AF_START;
  const steps = React.useMemo(() => buildActFunnel(afFrom, afTo, segment), [afFrom, afTo, segment]);
  // Last segment clicked (solid or striped) keeps a shadow so it's clear what the modal shows.
  const [sel, setSel] = useState(null);
  const top = steps[0].list.length;
  const H = 200;
  const range = `${SEG.who} who signed up ${rangeLabel(afFrom, afTo)}`;
  return (
    <Card
      accent={C.green}
      title={SEG.title}
      from={AF_START}
      question={`Of ${SEG.who} who signed up in the period, how many completed onboarding and how many activated?`}
      footnote={<>
        {steps.map((st, i) => <span key={st.key} style={{ display: 'block' }}><b>{i + 1}. {st.label}</b> = {st.def}</span>)}
        <span style={{ display: 'block', marginTop: 6 }}>{`Cohort = ${SEG.who}' sign ups in the reporting period (${M.label}), from the week of ${monDay(AF_START)} at the earliest — the first full week every source has data (recorder installs from Aug 27, email sends from Sep 4). Steps aren't sequential: each counts every sign up in the cohort that has done it, any time so far, whether or not they did the other step — so Activated can be larger than Completed onboarding. Repeats by the same person count separately (one row per user + company). Recent sign ups have had less time. Bars: solid = did the step; striped = hasn't yet. Click either part to list them.`}</span>
      </>}
    >
      {outOfRange ? (
        <div style={{ marginTop: 18, padding: '28px 20px', border: `1px dashed ${C.lightGrey}`, borderRadius: 4, fontFamily: FONT_BODY, fontSize: 14, color: C.muted }}>
          This reporting period ({rangeLabel(M.START, M.END)}) ends before the week of {monDay(AF_START)}, when funnel data starts. Pick a later period to see the funnel.
        </div>
      ) : (
      <div className="af-grid" style={{ display: 'grid', gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))`, gap: 14, marginTop: 18 }}>
        {steps.map((st, i) => {
          const n = st.list.length;
          const notYet = top - n;
          const open = (inStep) => {
            const ids = new Set(st.list);
            const users = inStep ? st.list : steps[0].list.filter((u) => !ids.has(u));
            setSel(`${st.key}:${inStep ? 'in' : 'out'}`);
            openUsers({
              noun: 'sign up', nounPlural: 'sign ups',
              dateOf: inStep ? st.dateOf : (u) => u.d, // sort by when they did this step
              stageCols: AF_STAGE_COLS,
              title: inStep ? `${st.label} · ${SEG.who}` : `Not yet: ${st.label.toLowerCase()} · ${SEG.who}`,
              subtitle: range,
              users,
              summary: inStep
                ? { label: st.label, value: fmtInt(n), sub: `${fmtPct(pct(n, top), 1)} of ${fmtInt(top)} sign ups` }
                : { label: `Haven't ${st.key === 'onboarded' ? 'completed onboarding' : 'activated'} yet`, value: fmtInt(notYet), sub: `${fmtPct(pct(notYet, top), 1)} of ${fmtInt(top)} sign ups` },
            });
          };
          const segStyle = (id) => ({ all: 'unset', boxSizing: 'border-box', display: 'block', width: '100%', cursor: 'pointer', position: 'relative', boxShadow: sel === id ? `4px 4px 0 ${C.black}` : 'none', zIndex: sel === id ? 2 : 'auto' });
          return (
            <div key={st.key} style={{ display: 'flex', flexDirection: 'column', minWidth: 0, padding: '8px 6px 10px' }} title={`${st.label} = ${st.def}.`}>
              <div style={{ fontFamily: FONT_BODY, fontSize: 14, fontWeight: 700, margin: '0 0 8px', minHeight: 36 }}>{st.label}</div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
                <span style={{ ...tabular, fontFamily: FONT_DISPLAY, fontSize: 34, lineHeight: 1, letterSpacing: '-0.03em' }}>{fmtInt(n)}</span>
                {i > 0 && <span style={{ ...tabular, fontFamily: FONT_BODY, fontSize: 12.5, color: C.muted }}>{fmtPct(pct(n, top), 1)}</span>}
              </div>
              <div style={{ height: H, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', marginTop: 14, borderBottom: `1px solid ${C.black}` }}>
                {i > 0 && notYet > 0 && (
                  <button type="button" className="af-seg" onClick={() => open(false)} title={`${fmtInt(notYet)} haven't yet — click to list them`}
                    style={{ ...segStyle(`${st.key}:out`), height: Math.max(8, (notYet / (top || 1)) * H), background: `repeating-linear-gradient(135deg, ${C.lightPurple} 0 6px, #F8E9FD 6px 12px)`, border: `1px dashed ${C.purple}`, borderBottom: 'none' }} />
                )}
                {n > 0 && (
                  <button type="button" className="af-seg" onClick={() => open(true)} title={`${fmtInt(n)} — click to list them`}
                    style={{ ...segStyle(`${st.key}:in`), height: Math.max(8, (n / (top || 1)) * H), background: C.purple, border: `1px solid ${C.black}`, borderBottom: 'none' }} />
                )}
              </div>
              <div style={{ ...tabular, fontFamily: FONT_BODY, fontSize: 12.5, marginTop: 10, minHeight: 36, lineHeight: 1.45, color: C.muted }}>
                {i > 0 ? <>{fmtPct(pct(n, top), 1)} of sign ups<div>{fmtInt(notYet)} haven't yet</div></> : <>Everyone in the cohort</>}
              </div>
            </div>
          );
        })}
      </div>
      )}
    </Card>
  );
}

// Funnel-style step charts (Nick, Oct 20 — "it should all work like a
// funnel"): each point = sign ups IN that period who have done the step at any
// time so far, not when they did it. Same counting as the activation funnels,
// so the period total = the funnels' org creators + invited users.
const COHORT_STEP = {
  act: { title: 'Activated users', verb: 'activated', did: (s) => Boolean(actDate(s)), from: () => FIRST_ACT_TRACKED, accent: C.green, def: 'sent (or drafted) an email or published an asset', dateOf: actDate },
  mt: { title: 'Sign ups with a recorded meeting', verb: 'recorded a meeting', did: (s) => Boolean(s.mt), from: () => FIRST_MT_TRACKED, accent: C.blue, def: 'a finalized capture, complete or partial', dateOf: (s) => s.mt, noFunnelNote: true },
  snd: { title: 'Sign ups with a first email', verb: 'sent (or drafted) an email', did: (s) => Boolean(s.snd), from: () => FIRST_SND_TRACKED, accent: C.red, def: 'drafts count as sends', dateOf: (s) => s.snd, noFunnelNote: true },
  onb: { title: 'Sign ups who completed onboarding', verb: 'completed onboarding', did: isSetUp, from: () => ONB_TRACK_FROM, accent: C.purple, def: ONB_DEF_TEXT, dateOf: onbDate },
};
function CohortStepCard({ kind }) {
  const K = COHORT_STEP[kind];
  const M = useModel();
  const openUsers = useUsersModal();
  const from = K.from();
  const of = (a, b) => { const base = signupsIn(a, b); const list = base.filter(K.did); return { base: base.length, n: list.length, list, rate: pct(list.length, base.length) }; };
  const rows = fromRows(M.WEEKS, from).map((w) => ({ ...w, ...of(w.start, w.end) }));
  const data = rows.map((w, i) => ({ ...w, nFull: w.partial ? null : w.n, nPartial: w.partial || rows[i + 1]?.partial ? w.n : null }));
  const curr = of(M.START, M.END);
  const prev = M.noPrior ? null : of(M.PRIOR_START, M.PRIOR_END);
  const list = (title, subtitle, users, x) => openUsers({
    noun: 'sign up', nounPlural: 'sign ups', dateOf: K.dateOf, stageCols: AF_STAGE_COLS, title, subtitle, users,
    summary: { label: `${K.title} · ${subtitle}`, value: fmtInt(x.n), sub: `${fmtPct(x.rate, 1)} of ${fmtInt(x.base)} sign ups` },
  });
  const Verb = K.verb[0].toUpperCase() + K.verb.slice(1);
  return (
    <Card from={from}
      accent={K.accent}
      title={K.title}
      question={`Of each ${M.grainNoun}'s sign ups, how many have ${K.verb}?`}
      footnote={`Funnel view: each point = sign ups in that ${M.grainEach} who have ${K.verb} (${K.def}) at any time so far — grouped by when they signed up, not when they ${K.verb}.${K.noFunnelNote ? ' Same counting as the activation funnels.' : ' Same counting as the activation funnels, so the period total equals org creators + invited users there.'} Never-completed sign ups are excluded. Recent sign ups have had less time, so the latest points rise as data comes in. ${lineWeekNote(M)}${M.SHOWS_CUR ? ' (dotted)' : ''} Click a point to list them. No goal set yet.`}
    >
      <StatRow delta={prev ? <Delta value={pctChange(curr.n, prev.n)} /> : null}>
        <Stat label={`Actual · signed up ${rangeLabel(maxISO(M.START, from), M.END)}`} value={fmtInt(curr.n)} sub={`${fmtPct(curr.rate, 1)} of ${fmtInt(curr.base)} sign ups`}
          explain={`Of the ${fmtInt(curr.base)} people who signed up from ${rangeLabel(M.START, M.END)}, ${fmtInt(curr.n)} (${fmtPct(curr.rate, 1)}) have ${K.verb} so far.${prev ? ` ${fmtInt(prev.n)} of the ${M.prior}'s sign ups.` : ''}`} />
        <Stat label="Goal" value="—" muted />
      </StatRow>
      <ListUsersButton n={curr.n} label={`${K.verb} (signed up in the ${M.long})`} onClick={() => list(K.title, `signed up ${rangeLabel(M.START, M.END)}`, curr.list, curr)} />
      <Legend items={[{ label: `${Verb}, by sign up ${M.grainNoun}`, color: C.black, line: true }, { label: 'Goal (not set)', color: '#9A9A9A', line: true, dashed: true }]} />
      <ZoomContainer height={220}>
        <LineChart data={data} margin={chartMargin} style={{ cursor: 'pointer' }} onClick={onWeekClick(openUsers, (row) => ({
          noun: 'sign up', nounPlural: 'sign ups', dateOf: K.dateOf, stageCols: AF_STAGE_COLS, title: K.title, subtitle: `signed up ${periodPhrase(row)}`, users: row.list,
          summary: { label: `${K.title} · signed up ${periodPhrase(row)}`, value: fmtInt(row.n), sub: `${fmtPct(row.rate, 1)} of ${fmtInt(row.base)} sign ups` },
        }))}>
          {grid}
          <XAxis {...xAxis} />
          <YAxis {...yAxis} domain={[0, 'auto']} allowDecimals={false} />
          <Tooltip content={({ active, payload }) => active && payload?.length ? (
            <TooltipBox title={`Signed up ${weekTitle(payload[0].payload).replace(/^Week of/, 'week of')}`} rows={[
              { label: Verb, value: fmtInt(payload[0].payload.n), color: C.black },
              { label: 'Sign ups', value: fmtInt(payload[0].payload.base) },
              { label: `% ${K.verb}`, value: fmtPct(payload[0].payload.rate, 1) },
            ]} note="Click to list them" />
          ) : null} />
          <Line dataKey="nFull" stroke={C.black} strokeWidth={2.5} dot={false} activeDot={{ r: 4, fill: K.accent, stroke: C.black }} isAnimationActive={false} />
          <Line dataKey="nPartial" stroke={C.black} strokeWidth={2} strokeDasharray="2 4" dot={false} activeDot={{ r: 4, fill: K.accent, stroke: C.black }} legendType="none" isAnimationActive={false} />
        </LineChart>
      </ZoomContainer>
    </Card>
  );
}

// --- Sections per funnel view -------------------------------------------------
function SectionsFor({ view }) {
  if (view === 'visitors') {
    // WV tab (Nick, Oct 19): all website-visitor charts live here.
    return (
      <>
        <StageHeader n={1} title="Website visitors" subtitle="Top of the funnel: people who reach the site." />
        <Grid>
          {/* Framer since Oct 16 (Nick). GA4 versions kept, hidden:
              <WebsiteVisitorsCard /> <VisitorToSignupCard /> <HighIntentReachCard /> <HighIntentPagesCard /> <HighIntentToSignupCard /> */}
          <div className="full"><FramerVisitorsCard /></div>
          <div className="full"><FramerVisitorToSignupCard /></div>
          {/* Reach % card hidden Oct 20 (Nick): <FramerHighIntentReachCard /> */}
          <FramerHighIntentVisitorsCard />
          <FramerHighIntentToSignupCard />
          <FramerHighIntentPagesCard />
        </Grid>
        <StageHeader title="Channel deep dive" subtitle="Which channels bring visitors to the site." />
        <Grid>
          {/* Hidden Oct 15 (Nick): <VisitorsByChannelCard />. GA4 version hidden Oct 16:
              {GA4_AU.has && <VisitorsActiveUsersByChannelCard />} */}
          <FramerVisitorsByChannelCard />
        </Grid>
      </>
    );
  }
  if (view === 'signup') {
    return (
      <>
        <StageHeader n={2} title="Sign up" subtitle="Visitors who create an account and finish setting up a workspace. The gate between anonymous and known." />
        <Grid>
          {/* Cumulative version hidden Oct 20 (Nick): <CumulativeSignupsCard /> */}
          <div className="full"><WeeklySignupsCard /></div>
          <div className="full"><EnterpriseMeetingsCard /></div>
          <SignupsByChannelCard />
        </Grid>
      </>
    );
  }
  if (view === 'activation') {
    return (
      <>
        <StageHeader n={3} title="Activation" subtitle="First real value: the first time a user puts Mutiny to work." definition={<><b>Activated user</b> = sent (or drafted) an email, or published an asset</>} />
        <Grid>
          {/* Weekly, full width, first (Nick, Oct 20) so the two half cards below pair up.
              Cumulative version hidden: <ActivatedUsersCard /> */}
          {/* Funnel-style (Nick, Oct 20): by sign up period. Event-dated version kept: <ActivatedUsersWeeklyCard /> */}
          <div className="full"><CohortStepCard kind="act" /></div>
          {/* Activation funnels (Nick, Oct 20): below Activated users, one per sign up type. */}
          <ActivationFunnelCard segment="creators" />
          <ActivationFunnelCard segment="invited" />
          <SignupToActivatedCard />
          {ACT_PREDICT && <ActivationPredictsCard />}
          {/* Hidden (Nick, Oct 8) — component kept: <ActivatedByTypeCard /> */}
          {/* Hidden for now (Nick, Oct 6) — components kept, re-add to show:
              <CompletedSetupCard /> <FirstMeetingCard /> <FirstSendCard /> */}
        </Grid>
        <StageHeader prefix="Lever 1" title="Onboarding" subtitle="New users getting set up so Mutiny can work for them. Conversion charts have a window picker (7, 14 or 30 days) next to their title." definition={<><b>Completed onboarding</b> = {ONB_DEF_TEXT}</>} />
        <Grid>
          {/* Weekly, full width (Nick, Oct 20). Cumulative version hidden: <OnboardedUsersCard /> */}
          {/* Funnel-style (Nick, Oct 20): by sign up period. Event-dated version kept: <OnboardedUsersWeeklyCard /> */}
          <CohortStepCard kind="onb" />
          <SignupToOnboardedCard />
        </Grid>
        <Collapsible title="Onboarding steps in detail">
          <p style={{ fontFamily: FONT_BODY, fontSize: 13, color: C.muted, margin: '0 0 14px', maxWidth: 820, lineHeight: 1.5 }}>
            Completed onboarding needs {ONB_REQUIRES_RECORDER ? 'all three steps' : 'email and calendar (the recorder is shown for reference, no longer required)'}. Here's each one on its own: of each day's signups, the share that did that step within the selected window. Use these to see which step people stall on.
          </p>
          <Grid cols={3}>
            <SignupToRecorderCard />
            <SignupToEmailCard />
            <SignupToCalendarCard />
          </Grid>
        </Collapsible>
        <StageHeader prefix="Lever 2" title="A1: Magic moment" subtitle="The moment a new user first gets real value from Mutiny. Conversion charts have a window picker (7, 14 or 30 days) next to their title." definition={<><b>Magic moment</b> = recorded their first meeting</>} />
        <Grid>
          {/* Not cumulative (Nick, Oct 20): funnel-style by sign up period. Kept: <MeetingSignupsCumulativeCard /> */}
          <CohortStepCard kind="mt" />
          <SignupToMeetingCard />
        </Grid>
        <StageHeader prefix="Lever 3" title="A2: First customer send" subtitle="The first time a user sends something to a real customer. Conversion charts have a window picker (7, 14 or 30 days) next to their title." definition={<><b>First customer send</b> = sent (or drafted) their first email</>} />
        <Grid>
          {/* Not cumulative (Nick, Oct 20): funnel-style by sign up period. Kept: <EmailSignupsCumulativeCard /> */}
          <CohortStepCard kind="snd" />
          <SignupToEmailSendCard />
        </Grid>
        <StageHeader title="Returned" subtitle={`Activated users who come back within ${RETURN_DAYS} days of activating and do something meaningful.`} definition={<><b>Returned user</b> = in the {RETURN_DAYS} days after activating, used credits, created or published an asset, or sent (or drafted) an email</>} />
        <Grid>
          <WeeklyReturnedUsersCard />
          <ActivatedToReturnedCard />
          {/* Hidden (Nick, Oct 7) — component kept; re-add to show:
              {PREDICT && <ReturningPredictsPaidCard />} */}
        </Grid>
      </>
    );
  }
  if (view === 'retained' && RETENTION) {
    return (
      <>
        <StageHeader n={5} title="Retained companies" subtitle="Do paying companies keep paying? Monthly cohorts of self-serve companies by the month they started paying." />
        <Grid>
          <CohortRetentionCard />
          {CYCLE_CREDITS && <CreditsCohortCard />}
          {CYCLE_CREDITS && <CreditsUsedCard />}
        </Grid>
      </>
    );
  }
  if (view === 'paid') {
    return (
      <>
        <StageHeader n={4} title="Paid companies" subtitle="Self-serve (PLG) companies paying in Stripe, and the users inside them." />
        {PAYING ? (
          <>
            {/* Paying companies, weekly, full width on top (Nick, Oct 20). Replaces
                Total paying users (component kept): <TotalPayingUsersCard /> */}
            <Grid><div className="full"><PayingCompaniesCard /></div></Grid>
            <div style={{ marginTop: 32 }}>
              <Grid>
                <SignupToPaidCard />
                {/* Paying companies (PLG) chart removed (Nick, Oct 8) — component kept. */}
                <Act2ToPaidCard />
              </Grid>
            </div>
          </>
        ) : <Grid><PaidEmptyCard /></Grid>}
      </>
    );
  }
  const copy = {
    paid: { n: 4, title: 'Paid companies', subtitle: 'Free accounts (logos) that start paying. Counted per company, not per user.', q: 'Does the habit turn into revenue?', body: 'Paying self-serve companies, signup → paid and activated → paid conversion will come from the stripe-dash project.' },
    retained: { n: 5, title: 'Retained companies', subtitle: 'Do paying companies stick around?', q: 'Do the accounts that pay keep paying?', body: 'Logo retention and monthly cohort retention of paying companies will come from the stripe-dash project.' },
    expanding: { n: 6, title: 'Expanding companies', subtitle: 'Paying companies that grow seats or plan.', q: 'Are paying companies growing with us?', body: 'Companies that expand (more seats or a higher plan) will come from the stripe-dash project.' },
  }[view];
  return (
    <>
      <StageHeader n={copy.n} title={copy.title} subtitle={copy.subtitle} />
      <Grid>
        <ComingSoonCard title={copy.title} question={copy.q} body={copy.body} />
      </Grid>
    </>
  );
}

// ===========================================================================
// Page
// ===========================================================================
// One "data as of" line for the header (Nick, Oct 7): each source has its own
// last day; headlines stop at the earliest so they never mix cut-offs.
const DATA_SOURCES = (() => {
  const gaLast = Object.keys(SESSIONS_BY_DATE).filter((d) => SESSIONS_BY_DATE[d] != null).sort().pop() || null;
  const ampLast = betaSignups.ampEvents?.lastDay
    || (() => { const days = (dataJson.amplitude?.referralSources || []).flatMap((e) => Object.keys(e.daily || {})).sort(); const d = days.pop(); return d ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6)}` : null; })();
  return [
    { name: 'Signups', day: DATA_END },
    { name: 'Website (Framer)', day: FRAMER_END },
    { name: 'GA4', day: gaLast },
    { name: 'Amplitude', day: ampLast },
    { name: 'Stripe', day: betaPaying.pulledAt ? betaPaying.pulledAt.slice(0, 10) : null },
    { name: 'Credits', day: betaCredits?.usageLastDay || null },
  ].filter((x) => x.day);
})();
function DataAsOf() {
  return (
    <div style={{ color: C.muted, marginTop: 4, fontSize: 12 }} title="Each data source's latest day. Headline numbers stop at the reporting period's end, which is never later than the signups export.">
      Data as of: {DATA_SOURCES.map((x, i) => <span key={x.name}>{i ? ' · ' : ''}{x.name} {monDay(x.day)}</span>)}
    </div>
  );
}

// Footer: first day of each product data export (Metabase, written by
// ingest-signups) and the first day it matches a counted (non-internal) sign up.
// Earlier dates may be the feature launch or just where the export starts.
const DATA_COVERAGE = [
  { name: 'Call recorder installs', from: betaSignups.recorderFrom, matched: FIRST_REC_TRACKED },
  { name: 'Gmail connections', from: betaSignups.gmailFrom, matched: FIRST_EM_TRACKED },
  { name: 'Google Calendar connections', from: betaSignups.calendarFrom, matched: FIRST_CAL_TRACKED },
  { name: 'Recorded meetings', from: betaSignups.meetingsFrom, matched: firstOf('mt') },
  { name: 'Email sends / drafts', from: betaSignups.emailsFrom, matched: firstOf('snd') },
  { name: 'Asset publishes', from: firstOf('pub'), matched: firstOf('pub') },
];
const fullDay = (iso) => (iso ? `${monDay(iso)}, ${iso.slice(0, 4)}` : '—');
function DataCoverage() {
  return (
    <div style={{ fontFamily: FONT_CAPTION, fontStyle: 'italic', fontSize: 12, color: C.muted, marginTop: 10, lineHeight: 1.6 }}>
      <span style={{ fontStyle: 'normal', fontFamily: FONT_BODY, fontWeight: 700, fontSize: 10.5, letterSpacing: '0.08em', textTransform: 'uppercase', marginRight: 8 }}>Data coverage</span>
      {DATA_COVERAGE.map((x, i) => (
        <span key={x.name}>{i ? ' · ' : ''}{x.name} from {fullDay(x.from)}{x.matched && x.matched !== x.from ? ` (first counted sign up ${monDay(x.matched)})` : ''}</span>
      ))}
      . Each export's first day; may be the feature launch or just where the export starts.
    </div>
  );
}

// Dropdown for the controls bar: a native <select> (keyboard + mobile
// friendly) dressed as a pill with an optional leading icon and a chevron.
function PeriodSelect({ label, value, onChange, options, icon, group }) {
  return (
    <label className="period-select" title={label} style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', background: C.white, border: `1px solid ${C.black}`, borderRadius: 8, boxShadow: `2px 2px 0 ${C.black}` }}>
      {icon && <span aria-hidden style={{ position: 'absolute', left: 10, display: 'inline-flex', pointerEvents: 'none' }}>{icon}</span>}
      <select aria-label={label} value={value} onChange={(e) => onChange(e.target.value)}
        style={{ appearance: 'none', WebkitAppearance: 'none', border: 'none', background: 'transparent', fontFamily: FONT_BODY, fontSize: 13.5, fontWeight: 600, color: C.black, padding: `6px 32px 6px ${icon ? 32 : 12}px`, cursor: 'pointer', borderRadius: 8 }}>
        {group
          ? <optgroup label={group}>{options.map(([id, text]) => <option key={id} value={id}>{text}</option>)}</optgroup>
          : options.map(([id, text]) => <option key={id} value={id}>{text}</option>)}
      </select>
      <ChevronDown size={15} aria-hidden style={{ position: 'absolute', right: 10, pointerEvents: 'none' }} />
    </label>
  );
}

export default function BetaDashboard() {
  const [view, setViewState] = useState(readHashView);
  // Reporting period = date range + granularity (Nick, Oct 20), remembered per browser.
  const stored = (key, ok, dflt) => { try { const v = window.localStorage.getItem(key); return ok(v) ? v : dflt; } catch (e) { return dflt; } };
  const [grain, setGrainState] = useState(() => stored('beta-grain', (v) => Boolean(GRAINS[v]), DEFAULT_GRAIN));
  const [rangeSel, setRangeState] = useState(() => stored('beta-range', (v) => Boolean(RANGES[v]), DEFAULT_RANGE));
  // Derived at render, so the dropdown always shows a preset the granularity has.
  const range = presetFor(rangeSel, grain);
  // Custom date range (Nick, Oct 21): two day pickers, shown when "Custom range" is picked.
  const [custom, setCustomState] = useState(() => ({
    from: stored('beta-custom-from', (v) => /^\d{4}-\d{2}-\d{2}$/.test(v || ''), addDays(DATA_END, -29)),
    to: stored('beta-custom-to', (v) => /^\d{4}-\d{2}-\d{2}$/.test(v || ''), DATA_END),
  }));
  const setCustom = (patch) => {
    const next = { ...custom, ...patch };
    if (next.from > next.to) { if (patch.from) next.to = next.from; else next.from = next.to; }
    setCustomState(next);
    save('beta-custom-from', next.from); save('beta-custom-to', next.to);
  };
  const save = (k, v) => { try { window.localStorage.setItem(k, v); } catch (e) { /* ignore */ } };
  // Amplitude preset logic (Nick, Oct 20): each granularity has its own preset
  // list; switching granularity keeps the range if listed, else its Default.
  const setRange = (v) => {
    const r = v === 'default' ? GRAIN_DEFAULT[grain] : presetFor(v, grain);
    setRangeState(r); save('beta-range', r);
    // A custom range is a daily timeframe (Nick, Oct 21): switch to Daily.
    if (r === 'custom' && grain !== 'day') { setGrainState('day'); save('beta-grain', 'day'); }
  };
  const setGrain = (g) => { const r = presetFor(range, g); setGrainState(g); setRangeState(r); save('beta-grain', g); save('beta-range', r); };
  const M = getModel(range, grain, range === 'custom' ? custom : null);
  const { START, END, WEEKS } = M;
  const [usersModal, setUsersModal] = useState(null);
  const closeUsersModal = React.useCallback(() => setUsersModal(null), []);
  const setView = (v) => {
    setViewState(v);
    try { window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}#${v}`); } catch (e) { /* ignore */ }
  };
  useEffect(() => {
    const onHash = () => setViewState(readHashView());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  return (
    <ModelCtx.Provider value={M}>
    <UsersModalCtx.Provider value={setUsersModal}>
    <div style={{ background: C.paper, minHeight: '100vh', fontFamily: FONT_BODY, color: C.black }}>
      <style>{PAGE_CSS}</style>
      <header style={{ borderBottom: `1px solid ${C.black}`, background: C.white }}>
        <div style={{ maxWidth: 1400, margin: '0 auto', padding: '32px 32px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: C.muted }}>
              Mutiny · Growth
              <span style={{ background: C.green, color: C.black, border: `1px solid ${C.black}`, borderRadius: 3, padding: '1px 6px', letterSpacing: '0.08em' }}>Beta</span>
            </div>
            <h1 style={{ fontFamily: FONT_DISPLAY, fontWeight: 400, fontSize: 44, lineHeight: 1.05, letterSpacing: '-0.035em', margin: '8px 0 0' }}>
              Mutiny growth performance
            </h1>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 10 }}>
            {/* One-page guide (public/dashboard-guide.pdf → copied next to index.html on build). */}
            <a href="dashboard-guide.pdf" target="_blank" rel="noopener noreferrer" style={{ border: `1px solid ${C.black}`, borderRadius: 4, background: C.white, padding: '7px 12px', fontSize: 13, fontWeight: 600, color: C.black, textDecoration: 'none', boxShadow: `2px 2px 0 ${C.black}` }}>
              How to read this dashboard ↗
            </a>
            <DataAsOf />
          </div>
        </div>
      </header>

      {/* Controls bar (Nick, Oct 8): reporting period, stuck to the top of the
          viewport while scrolling. Conversion window lives in each chart (Oct 14). */}
      <div className="beta-controls" style={{ position: 'sticky', top: 0, zIndex: 900, background: C.lightBlue, borderBottom: `1px solid ${C.black}` }}>
        <div style={{ maxWidth: 1400, margin: '0 auto', padding: '10px 32px', display: 'flex', alignItems: 'center', gap: '10px 24px', flexWrap: 'wrap', fontSize: 13 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            {/* Amplitude-style filter (Nick, Oct 20): granularity + date range dropdowns. */}
            <span style={{ fontFamily: FONT_BODY, fontSize: 14, fontWeight: 700 }}>Filter by:</span>
            <PeriodSelect label="Granularity" value={grain} onChange={setGrain} options={Object.entries(GRAINS).map(([id, g]) => [id, g.label])} />
            <PeriodSelect label="Date range" icon={<Calendar size={15} />} value={range} onChange={setRange} group="Presets"
              options={[['default', `Default (${RANGES[GRAIN_DEFAULT[grain]].label})`], ...GRAIN_PRESETS[grain].map((id) => [id, id === 'custom' ? 'Custom range…' : makeWindow(id, grain).label])]} />
            {range === 'custom' && (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <input type="date" aria-label="From" className="period-date" value={custom.from} min={CUSTOM_MIN} max={DATA_END} onChange={(e) => e.target.value && setCustom({ from: e.target.value })} />
                <span style={{ color: C.muted }}>to</span>
                <input type="date" aria-label="To" className="period-date" value={custom.to} min={CUSTOM_MIN} max={DATA_END} onChange={(e) => e.target.value && setCustom({ to: e.target.value })} />
              </span>
            )}
            <span style={{ fontWeight: 700, whiteSpace: 'nowrap' }}>{rangeLabel(START, END)}, {END.slice(0, 4)}</span>
            {M.WTD && <span style={{ color: C.muted, whiteSpace: 'nowrap' }}>· week to date {rangeLabel(M.WTD.start, M.WTD.end)} not in totals</span>}
          </div>
        </div>
      </div>

      <main style={{ maxWidth: 1400, margin: '0 auto', padding: '40px 32px 96px' }}>

        <PlgFunnel view={view} setView={setView} />
        <ViewingBar view={view} />
        <SectionsFor view={view} />

        <div style={{ fontFamily: FONT_CAPTION, fontStyle: 'italic', fontSize: 12, color: C.muted, marginTop: 56 }}>
          Signups export: {betaSignups.source} · {SIGNUPS.length.toLocaleString()} signup rows · {monDay(DATA_START)} {DATA_START.slice(0, 4)} – {monDay(betaSignups.lastDate)} {betaSignups.lastDate.slice(0, 4)} ({COUNTED_SIGNUPS.toLocaleString()} counted as signups from {monDay(SIGNUP_COUNT_START)}, {SIGNUP_COUNT_START.slice(0, 4)}){betaSignups.internalExcluded ? `; ${betaSignups.internalExcluded.toLocaleString()} internal @mutinyhq.com / @gomomentic.com signups excluded` : ''}; {NEVER_COMPLETED.length.toLocaleString()} never-completed signups (no workspace, or one never named) excluded.
          GA4 pulled {dataJson.ga4.pulledAt?.slice(0, 10)}.
        </div>
        {/* Data coverage (Nick, Oct 20): when each product data source starts. */}
        <DataCoverage />
      </main>
      <UsersModal data={usersModal} onClose={closeUsersModal} />
    </div>
    </UsersModalCtx.Provider>
    </ModelCtx.Provider>
  );
}
