import React, { useState, useRef } from 'react';
import {
  PieChart, Pie, Cell, ResponsiveContainer,
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  BarChart, Bar, AreaChart, Area, ComposedChart,
} from 'recharts';
import {
  ArrowUpRight, ArrowDownRight, HelpCircle, AlertTriangle, Sparkles, Info, ChevronDown,
} from 'lucide-react';
import dataJson from './src/data.json';

// ---------------------------------------------------------------------------
// Mutiny brand tokens
// ---------------------------------------------------------------------------
const C = {
  purple: '#A73BF5',
  green: '#B2FF14',
  red: '#FB5A3D',
  blue: '#96ECFF',
  lightPurple: '#F2D1FC',
  lightBlue: '#BCEEFD',
  lightRed: '#FF9987',
  lightGreen: '#D6E7DA',
  black: '#000000',
  lightGrey: '#EFEFEF',
  white: '#FFFFFF',
  paper: '#FAF8F4', // off-white editorial background
  linkedinBlue: '#0A66C2', // LinkedIn brand blue (for LinkedIn-specific viz)
};

const FONT_DISPLAY = "'Fraunces', 'Reckless Condensed S', Georgia, serif";
const FONT_BODY = "'Manrope', 'KMR Waldenburg', Arial, sans-serif";
const FONT_MONO = "'Geist Mono', 'JetBrains Mono', 'SF Mono', Consolas, monospace";
const FONT_CAPTION = "'Fraunces', 'Affix', Georgia, serif";

// ---------------------------------------------------------------------------
// Live data window — anchored at Apr 27, rolls forward with every build.
//
// All three data sources come from src/data.json, pulled at build time by
// scripts/pull-data.mjs:
//   ga4       — Apps Script Web App returning Sheets data (sessions, channel)
//   amplitude — Dashboard REST API (daily signup uniques + referral_source pie)
//   hubspot   — CRM contact search (Talk-to-Sales submissions)
//
// The Apr 27 floor is fixed (data prior is unreliable); the end date is the
// latest day in the GA4 file1 response.
// ---------------------------------------------------------------------------

// --- Date helpers (UTC, to avoid CI timezone-shift bugs) -------------------
function parseYYYYMMDD(s) {
  const str = String(s);
  return new Date(Date.UTC(
    parseInt(str.slice(0, 4), 10),
    parseInt(str.slice(4, 6), 10) - 1,
    parseInt(str.slice(6, 8), 10),
  ));
}
function fmtYYYYMMDD(d) {
  return `${d.getUTCFullYear()}` +
    `${String(d.getUTCMonth() + 1).padStart(2, '0')}` +
    `${String(d.getUTCDate()).padStart(2, '0')}`;
}
// Same as fmtYYYYMMDD but with dashes — matches HTML `<input type="date">`'s
// value format. Used by Reporting Mode's date pickers.
function fmtYYYYMMDDDash(d) {
  return `${d.getUTCFullYear()}-` +
    `${String(d.getUTCMonth() + 1).padStart(2, '0')}-` +
    `${String(d.getUTCDate()).padStart(2, '0')}`;
}
const MONTH_ABBR = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
function fmtMonDay(d)   { return `${MONTH_ABBR[d.getUTCMonth()]} ${d.getUTCDate()}`; }
function fmtMMDD(d)     {
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${m}/${day}`;
}
function addUTCDays(d, n) {
  const r = new Date(d);
  r.setUTCDate(r.getUTCDate() + n);
  return r;
}
function mondayOfUTC(d) {
  const day = d.getUTCDay(); // 0 = Sun
  return addUTCDays(d, day === 0 ? -6 : 1 - day);
}

// --- Live window: Last 30 days, rolling ------------------------------------
// "Today" is taken from dataJson.pulledAt so the dashboard's window stays
// stable for a given build (doesn't drift across user time zones at render).
const LIVE_END_DATE       = (() => {
  const iso = dataJson.pulledAt || new Date().toISOString();
  return new Date(Date.UTC(
    Number(iso.slice(0, 4)),
    Number(iso.slice(5, 7)) - 1,
    Number(iso.slice(8, 10)),
  ));
})();
const LIVE_START_DATE     = addUTCDays(LIVE_END_DATE, -30);
const LIVE_END_YYYYMMDD   = fmtYYYYMMDD(LIVE_END_DATE);
const LIVE_START_YYYYMMDD = fmtYYYYMMDD(LIVE_START_DATE);
const LIVE_DAYS_ELAPSED   = 31;  // today (inclusive) + 30 prior days
// Use the most recent successful per-source pulledAt for the header. Top-level
// pulledAt is the orchestrator timestamp; per-source is more accurate.
const LIVE_DATA_PULLED_AT =
  dataJson.ga4?.pulledAt
  || dataJson.amplitude?.pulledAt
  || dataJson.hubspot?.pulledAt
  || dataJson.pulledAt;

// --- Daily signups (Amplitude) and meetings (HubSpot), both live ----------
// dataJson.amplitude.dailySignups : { "20260427": 26, ... }
// dataJson.hubspot.meetings       : [{ date, email, company, referralSource }]
const LIVE_SIGNUPS_BY_DATE = dataJson.amplitude?.dailySignups || {};
// Previous signup definition — daily unique [Onboarding] Company Setup Complete
// (org-creators only). Powers the "Company signups by Channel (previous method)"
// stacked column. Summed daily per period (no cross-day dedup), matching how the
// pre-USC dashboard counted.
const LIVE_CSC_BY_DATE = dataJson.amplitude?.companySetupDaily || {};
const LIVE_MEETINGS_BY_DATE = (() => {
  const out = {};
  for (const m of (dataJson.hubspot?.meetings || [])) {
    out[m.date] = (out[m.date] || 0) + 1;
  }
  return out;
})();

// --- File 1 indexed by date (engaged sessions, daily totals) ---------------
const LIVE_ENGAGED_BY_DATE = Object.fromEntries(
  dataJson.ga4.file1.map((r) => [r.date, r.engagedSessions]),
);

// --- Weekly buckets (Mon-Sun, expanded outward) ---------------------------
// First bucket = the Mon-Sun week containing LIVE_START (may extend 1-6
// days earlier than the strict 30-day window). Last bucket = the Mon-Sun
// week containing LIVE_END (today) — extends into the future if today
// isn't Sunday yet.
//
// Two flavors of "partial":
//   - `trailingPartial` — current week, Sunday hasn't happened yet
//   - `leadingPartial`  — first week, its Monday pre-dates the strict 30d
// `partial` is the OR of the two (used for hatching). The current-week vs
// leading-week distinction surfaces in tooltips so we can label them
// differently — both are visually hatched.
function buildWeeks() {
  const weeks = [];
  const weeklyStart = mondayOfUTC(LIVE_START_DATE);
  const weeklyEnd   = addUTCDays(mondayOfUTC(LIVE_END_DATE), 6);  // Sunday of current week
  let wkStart = weeklyStart;
  while (wkStart <= weeklyEnd) {
    const wkEnd = addUTCDays(wkStart, 6);
    const dates = [];
    for (let d = new Date(wkStart); d <= wkEnd; d = addUTCDays(d, 1)) {
      dates.push(fmtYYYYMMDD(d));
    }
    const trailingPartial = wkEnd > LIVE_END_DATE;
    const leadingPartial  = wkStart < LIVE_START_DATE;
    // Per design call: only the trailing (current, in-progress) week is
    // visually hatched. The leading week is displayed as a normal bar even
    // if its Monday slightly pre-dates the strict 30-day start — that
    // information is captured in the "How to read" banner instead.
    weeks.push({
      weekStartLabel: fmtMonDay(wkStart),
      weekStart: fmtYYYYMMDD(wkStart),
      dateRange: `${fmtMonDay(wkStart)} – ${fmtMonDay(wkEnd)}`,
      partial: trailingPartial,
      trailingPartial,
      leadingPartial,
      dates,
    });
    wkStart = addUTCDays(wkEnd, 1);
  }
  return weeks;
}
const LIVE_WEEKS = buildWeeks();

// ---------------------------------------------------------------------------
// Visitor → User Signup weekly conversion trend — a FIXED trailing 12-week
// window, independent of the dashboard's date toggle. Each point is that ISO
// (Mon-Sun) week's completed signups ÷ engaged sessions. Per-week (NOT
// cumulative), so it shows the actual week-to-week trend and never depends on
// deduped-window anchoring (no staleness spikes). User Setup Complete fires
// once per user, so summing daily uniques over a week equals the week's unique
// signup count. The current (in-progress) week is flagged partial.
// ---------------------------------------------------------------------------
const RATIO_TREND_WEEKS = 12;
const RATIO_TREND_SERIES = (() => {
  const out = [];
  // End at the last COMPLETE Mon-Sun week — the in-progress week is excluded so
  // a 1-3 day partial can't distort the trend with a volume spike.
  const curMon = mondayOfUTC(LIVE_END_DATE);
  const curSun = addUTCDays(curMon, 6);
  const lastCompleteMon = curSun > LIVE_END_DATE ? addUTCDays(curMon, -7) : curMon;
  for (let i = RATIO_TREND_WEEKS - 1; i >= 0; i--) {
    const wkStart = addUTCDays(lastCompleteMon, -7 * i);
    const wkEnd   = addUTCDays(wkStart, 6);
    let sig = 0, sess = 0;
    for (let d = new Date(wkStart); d <= wkEnd; d = addUTCDays(d, 1)) {
      const k = fmtYYYYMMDD(d);
      sig  += LIVE_SIGNUPS_BY_DATE[k] || 0;
      sess += LIVE_ENGAGED_BY_DATE[k] || 0;
    }
    out.push({
      week:            fmtMonDay(wkStart),
      dateRange:       `${fmtMonDay(wkStart)} – ${fmtMonDay(wkEnd)}`,
      partial:         false,
      trailingPartial: false,
      signups:         sig,
      sessions:        sess,
      ratio: (sess > 0 && sig > 0) ? +((sig / sess) * 100).toFixed(2) : null,
    });
  }
  return out;
})();
const RATIO_TREND_LABEL = RATIO_TREND_SERIES.length
  ? `${RATIO_TREND_SERIES[0].week} – ${RATIO_TREND_SERIES[RATIO_TREND_SERIES.length - 1].dateRange.split('–')[1].trim()}, ${LIVE_END_DATE.getUTCFullYear()}`
  : '';

const WINDOW = {
  start: LIVE_START_YYYYMMDD,
  end:   LIVE_END_YYYYMMDD,
  label: `${fmtMonDay(LIVE_START_DATE)} – ${fmtMonDay(LIVE_END_DATE)}, ${LIVE_END_DATE.getUTCFullYear()}`,
  daysElapsed: LIVE_DAYS_ELAPSED,
  asteriskNote:
    'Last 30 days, rolling. Weekly charts extend out to full Mon-Sun weeks; the first week reuses the entire week and the current in-progress week is hatched.',
};

// KPI cards + pies use the strict 30-day window (LIVE_START → LIVE_END).
// Weekly charts use the expanded Mon-Sun range. The two ranges can differ
// by up to 12 days (6 before + 6 after).
function inStrictWindow(dateStr) {
  return dateStr >= LIVE_START_YYYYMMDD && dateStr <= LIVE_END_YYYYMMDD;
}

const SIGNUPS_30D = Object.entries(LIVE_SIGNUPS_BY_DATE)
  .filter(([d]) => inStrictWindow(d))
  .reduce((s, [, n]) => s + (Number(n) || 0), 0);
const MEETINGS_30D = (dataJson.hubspot?.meetings || [])
  .filter((m) => inStrictWindow(m.date)).length;
const ENGAGED_30D = Object.entries(LIVE_ENGAGED_BY_DATE)
  .filter(([d]) => inStrictWindow(d))
  .reduce((s, [, n]) => s + (Number(n) || 0), 0);

const DATA = {
  signups:         { window: SIGNUPS_30D },
  engagedSessions: { window: ENGAGED_30D },
  salesMeetings:   { window: MEETINGS_30D },
};

const ratioWindow = (DATA.signups.window / DATA.engagedSessions.window) * 100;

// ---------------------------------------------------------------------------
// Sparkline daily series — strict-30d daily values for the KPI tile trends.
// All four series share the same date axis (LIVE_START..LIVE_END inclusive).
// Ratio is 7-day rolling to smooth out daily 0/0 noise.
// ---------------------------------------------------------------------------
const STRICT_WINDOW_DATES = (() => {
  const out = [];
  for (let d = new Date(LIVE_START_DATE); d <= LIVE_END_DATE; d = addUTCDays(d, 1)) {
    out.push(fmtYYYYMMDD(d));
  }
  return out;
})();
function rolling7(arr) {
  return arr.map((_, i) => {
    const start = Math.max(0, i - 6);
    const win = arr.slice(start, i + 1);
    return win.reduce((s, v) => s + v, 0) / win.length;
  });
}
const SPARK_SIGNUPS  = STRICT_WINDOW_DATES.map((d) => LIVE_SIGNUPS_BY_DATE[d]  || 0);
const SPARK_SESSIONS = STRICT_WINDOW_DATES.map((d) => LIVE_ENGAGED_BY_DATE[d]  || 0);
const SPARK_MEETINGS = STRICT_WINDOW_DATES.map((d) => LIVE_MEETINGS_BY_DATE[d] || 0);
const SPARK_RATIO    = rolling7(
  STRICT_WINDOW_DATES.map((d) => {
    const s = LIVE_SIGNUPS_BY_DATE[d]  || 0;
    const e = LIVE_ENGAGED_BY_DATE[d]  || 0;
    return e > 0 ? (s / e) * 100 : 0;
  }),
);

// ---------------------------------------------------------------------------
// Last-4-weeks window (used by the "Last 4 weeks" view mode).
// Matches Amplitude's preset: 4 most recent complete Mon-Sun weeks PLUS the
// current in-progress week (5 weeks total). Window = Monday of (current
// week - 4) → today. The current week bar is rendered hatched in charts.
// ---------------------------------------------------------------------------
const _thisWeekMonday      = mondayOfUTC(LIVE_END_DATE);
const FOURWEEKS_START_DATE = addUTCDays(_thisWeekMonday, -28);  // Mon of 4 weeks ago
const FOURWEEKS_END_DATE   = LIVE_END_DATE;                     // today (inclusive)
const FOURWEEKS_END_YYYYMMDD   = fmtYYYYMMDD(FOURWEEKS_END_DATE);
const FOURWEEKS_START_YYYYMMDD = fmtYYYYMMDD(FOURWEEKS_START_DATE);
const FOURWEEKS_DATES_ARRAY = [];
for (let d = new Date(FOURWEEKS_START_DATE); d <= FOURWEEKS_END_DATE; d = addUTCDays(d, 1)) {
  FOURWEEKS_DATES_ARRAY.push(fmtYYYYMMDD(d));
}
const FOURWEEKS_DATES_SET = new Set(FOURWEEKS_DATES_ARRAY);
function inFourWeeksWindow(dateStr) { return FOURWEEKS_DATES_SET.has(dateStr); }
const FOURWEEKS_RANGE_LABEL = `${fmtMonDay(FOURWEEKS_START_DATE)} – ${fmtMonDay(FOURWEEKS_END_DATE)}, ${FOURWEEKS_END_DATE.getUTCFullYear()}`;

// ---------------------------------------------------------------------------
// Year-to-Date window (used by the "Year to Date" view mode).
// Jan 1 of LIVE_END_DATE's year → today, inclusive. Weekly bars start on the
// Monday of the week containing Jan 1 (so the first bar may include a few
// December days from the prior year, which always sum to 0 since we don't
// pull pre-Jan data).
// ---------------------------------------------------------------------------
const _ytdYear = LIVE_END_DATE.getUTCFullYear();
const YTD_START_DATE     = new Date(Date.UTC(_ytdYear, 0, 1));   // Jan 1
const YTD_END_DATE       = LIVE_END_DATE;                        // today
const YTD_START_YYYYMMDD = fmtYYYYMMDD(YTD_START_DATE);
const YTD_END_YYYYMMDD   = fmtYYYYMMDD(YTD_END_DATE);
const YTD_DATES_ARRAY = [];
for (let d = new Date(YTD_START_DATE); d <= YTD_END_DATE; d = addUTCDays(d, 1)) {
  YTD_DATES_ARRAY.push(fmtYYYYMMDD(d));
}
const YTD_DATES_SET = new Set(YTD_DATES_ARRAY);
function inYtdWindow(dateStr) { return YTD_DATES_SET.has(dateStr); }
const YTD_RANGE_LABEL = `${fmtMonDay(YTD_START_DATE)} – ${fmtMonDay(YTD_END_DATE)}, ${_ytdYear}`;

// ---------------------------------------------------------------------------
// Month-to-Date window (used by the "MTD" view mode).
// 1st of current month → today, inclusive.
// ---------------------------------------------------------------------------
const MTD_START_DATE     = new Date(Date.UTC(
  LIVE_END_DATE.getUTCFullYear(),
  LIVE_END_DATE.getUTCMonth(),
  1,
));
const MTD_END_DATE       = LIVE_END_DATE;
const MTD_START_YYYYMMDD = fmtYYYYMMDD(MTD_START_DATE);
const MTD_END_YYYYMMDD   = fmtYYYYMMDD(MTD_END_DATE);
const MTD_DATES_ARRAY = [];
for (let d = new Date(MTD_START_DATE); d <= MTD_END_DATE; d = addUTCDays(d, 1)) {
  MTD_DATES_ARRAY.push(fmtYYYYMMDD(d));
}
const MTD_DATES_SET = new Set(MTD_DATES_ARRAY);
function inMtdWindow(dateStr) { return MTD_DATES_SET.has(dateStr); }
const MTD_RANGE_LABEL = `${fmtMonDay(MTD_START_DATE)} – ${fmtMonDay(MTD_END_DATE)}, ${MTD_END_DATE.getUTCFullYear()}`;

// ---------------------------------------------------------------------------
// Prior 30 days — for "vs prior 30d" delta on KPI cards in Last 30 days mode.
// PRIOR_DATA_AVAILABLE is false if pull-data hasn't been re-run with the new
// 60-day window — in that case the delta is suppressed cleanly.
// ---------------------------------------------------------------------------
const PRIOR30_END_DATE   = addUTCDays(LIVE_START_DATE, -1);
const PRIOR30_START_DATE = addUTCDays(PRIOR30_END_DATE, -29);
const PRIOR30_END_YYYYMMDD   = fmtYYYYMMDD(PRIOR30_END_DATE);
const PRIOR30_START_YYYYMMDD = fmtYYYYMMDD(PRIOR30_START_DATE);
function inPrior30Window(dateStr) {
  return dateStr >= PRIOR30_START_YYYYMMDD && dateStr <= PRIOR30_END_YYYYMMDD;
}
const _dataWindowStartCompact = (dataJson.window?.start || '').replaceAll('-', '');
const PRIOR_DATA_AVAILABLE =
  Boolean(_dataWindowStartCompact) && _dataWindowStartCompact <= PRIOR30_START_YYYYMMDD;

// ---------------------------------------------------------------------------
// KPI totals — 4-week + prior-30d for the toggle + delta rendering
// ---------------------------------------------------------------------------
function sumByMapFilter(map, predicate) {
  let t = 0;
  for (const [d, n] of Object.entries(map)) if (predicate(d)) t += Number(n) || 0;
  return t;
}
function countMeetingsByFilter(predicate) {
  return (dataJson.hubspot?.meetings || []).filter((m) => predicate(m.date)).length;
}
const SIGNUPS_4W   = sumByMapFilter(LIVE_SIGNUPS_BY_DATE,  inFourWeeksWindow);
const SESSIONS_4W  = sumByMapFilter(LIVE_ENGAGED_BY_DATE,  inFourWeeksWindow);
const MEETINGS_4W  = countMeetingsByFilter(inFourWeeksWindow);
const RATIO_4W     = SESSIONS_4W > 0 ? (SIGNUPS_4W  / SESSIONS_4W)  * 100 : 0;
const SIGNUPS_YTD  = sumByMapFilter(LIVE_SIGNUPS_BY_DATE,  inYtdWindow);
const SESSIONS_YTD = sumByMapFilter(LIVE_ENGAGED_BY_DATE,  inYtdWindow);
const MEETINGS_YTD = countMeetingsByFilter(inYtdWindow);
const RATIO_YTD    = SESSIONS_YTD > 0 ? (SIGNUPS_YTD / SESSIONS_YTD) * 100 : 0;
const SIGNUPS_MTD  = sumByMapFilter(LIVE_SIGNUPS_BY_DATE,  inMtdWindow);
const SESSIONS_MTD = sumByMapFilter(LIVE_ENGAGED_BY_DATE,  inMtdWindow);
const MEETINGS_MTD = countMeetingsByFilter(inMtdWindow);
const RATIO_MTD    = SESSIONS_MTD > 0 ? (SIGNUPS_MTD / SESSIONS_MTD) * 100 : 0;
const SIGNUPS_PRIOR30  = sumByMapFilter(LIVE_SIGNUPS_BY_DATE,  inPrior30Window);
const SESSIONS_PRIOR30 = sumByMapFilter(LIVE_ENGAGED_BY_DATE,  inPrior30Window);
const MEETINGS_PRIOR30 = countMeetingsByFilter(inPrior30Window);
const RATIO_PRIOR30    = SESSIONS_PRIOR30 > 0 ? (SIGNUPS_PRIOR30 / SESSIONS_PRIOR30) * 100 : 0;

// ---------------------------------------------------------------------------
// Deduplicated signup totals (Amplitude `amplitude.dedup`).
// The daily signup series counts a user once per active DAY, so summing it
// across a window double-counts anyone active on multiple days (a user can
// fire Registration Submitted one day and Company Setup Complete another).
// `amplitude.dedup` carries TRUE deduplicated unique-user counts of the
// 4-event union, pulled at two granularities:
//   - windows: { last30, prior30, mtd, ytd, fourweeks } — one number per KPI window.
//   - periods: { "<firstDate>_<lastDate>": uniques } — one per weekly/monthly bar,
//       keyed by the first & last YYYYMMDD of the bar's date range.
// We prefer these for the headline KPI and per-bar totals, and fall back to
// the summed-daily value whenever a range isn't precomputed (e.g. custom
// Reporting windows), so nothing ever breaks — it just loses the dedup.
// Channel segment heights still come from the per-day referralSources split
// (Company Setup Complete fires ~once per user, so it's already effectively
// deduped); the Invited / Referred residual = deduped period total − buckets.
// ---------------------------------------------------------------------------
// Signups now use RAW EVENT TOTALS (User Setup Complete event count), not
// deduped uniques. dedup is intentionally ignored so every signup total is the
// summed-daily event count from dailySignups — this makes the Signups-by-Team
// split (same events grouped by user_work_role) sum EXACTLY to the KPI by
// construction, with no scaling. (The old amplitude.dedup block may still be
// present in data.json; it is deliberately not read.)
const DEDUP         = { periods: {}, windows: {} };
const DEDUP_WINDOWS = DEDUP.windows || {};
function periodDedupKey(dates) {
  if (!dates || !dates.length) return null;
  return `${dates[0]}_${dates[dates.length - 1]}`;
}
function dedupPeriodTotal(dates, fallback) {
  const k = periodDedupKey(dates);
  const v = k != null ? DEDUP.periods?.[k] : undefined;
  return (v != null) ? v : fallback;
}
// Running cumulative sum of a {date:n} map over an ordered date list → {date:cum}.
// Used as the fallback numerator (summed-daily) when no deduped within-window
// cumulative-unique series exists (e.g. custom Reporting windows).
function runningSumMap(datesArray, byDate) {
  let c = 0; const out = {};
  for (const d of datesArray) { c += (byDate[d] || 0); out[d] = c; }
  return out;
}
// Guard against a STALE deduped cumulative series. These series are date-
// anchored (regenerated out-of-band); once the rolling window advances past the
// last regeneration, a stored series no longer covers the current window and
// mixing its old cumulative numerator with fresh sessions produces a garbage
// ratio (e.g. a 55% leading spike). Only use the series if it actually spans
// the current window's first AND last date; otherwise the caller falls back to
// the summed-daily numerator, which is self-consistent (just not deduped).
function windowAlignedCum(series, windowDates) {
  if (!series || !windowDates || !windowDates.length) return null;
  const first = windowDates[0], last = windowDates[windowDates.length - 1];
  return (series[first] != null && series[last] != null) ? series : null;
}
// Build the Visitor → User Signup cumulative line: for each period (week or
// month), ratio = cumulative-unique signups ÷ cumulative sessions, both running
// from the window start. `cumUniqueByDate` is the DEDUPED within-window
// cumulative-unique series (so the final period's value = the window's deduped
// total → the line's endpoint equals the KPI tile). Sessions accumulate from
// LIVE_ENGAGED_BY_DATE. Periods must be chronological with in-window `dates`.
function buildCumRatioSeries(periods, cumUniqueByDate, sessionsByDate) {
  let cumSess = 0;
  return periods.map((p) => {
    const dates = p.dates || [];
    for (const d of dates) cumSess += (sessionsByDate[d] || 0);
    let cumUnique = null;
    for (let i = dates.length - 1; i >= 0; i--) {
      if (cumUniqueByDate[dates[i]] != null) { cumUnique = cumUniqueByDate[dates[i]]; break; }
    }
    const ratio = (cumSess > 0 && cumUnique != null && cumUnique > 0)
      ? +((cumUnique / cumSess) * 100).toFixed(2) : null;
    return {
      week:            p.week ?? p.weekStartLabel ?? p.label,
      dateRange:       p.dateRange,
      partial:         p.partial,
      trailingPartial: p.trailingPartial ?? p.partial,
      ratio,
    };
  });
}
const SIGNUPS_30D_DEDUP     = DEDUP_WINDOWS.last30    ?? SIGNUPS_30D;
const SIGNUPS_PRIOR30_DEDUP = DEDUP_WINDOWS.prior30   ?? SIGNUPS_PRIOR30;
const SIGNUPS_MTD_DEDUP     = DEDUP_WINDOWS.mtd       ?? SIGNUPS_MTD;
const SIGNUPS_YTD_DEDUP     = DEDUP_WINDOWS.ytd       ?? SIGNUPS_YTD;
const SIGNUPS_4W_DEDUP      = DEDUP_WINDOWS.fourweeks ?? SIGNUPS_4W;

// Visitor → User Signup ratios use the DEDUPED signup total as the numerator
// (matching the User Signups KPI tile), not the summed-daily count. Sessions
// are additive so they stay as-is. Reporting mode keeps its summed ratio since
// custom windows have no precomputed dedup.
const RATIO_30D_DEDUP     = ENGAGED_30D      > 0 ? (SIGNUPS_30D_DEDUP     / ENGAGED_30D)      * 100 : 0;
const RATIO_PRIOR30_DEDUP = SESSIONS_PRIOR30 > 0 ? (SIGNUPS_PRIOR30_DEDUP / SESSIONS_PRIOR30) * 100 : 0;
const RATIO_MTD_DEDUP     = SESSIONS_MTD     > 0 ? (SIGNUPS_MTD_DEDUP     / SESSIONS_MTD)     * 100 : 0;
const RATIO_YTD_DEDUP     = SESSIONS_YTD     > 0 ? (SIGNUPS_YTD_DEDUP     / SESSIONS_YTD)     * 100 : 0;

// Returns { raw, pct } or null when prior period isn't available
function delta30d(curr, prev, available) {
  if (!available || prev === undefined || prev === null) return null;
  return {
    raw: curr - prev,
    pct: prev !== 0 ? ((curr - prev) / prev) * 100 : null,
  };
}
const DELTA_30D = {
  signups:         delta30d(SIGNUPS_30D_DEDUP, SIGNUPS_PRIOR30_DEDUP, PRIOR_DATA_AVAILABLE),
  engagedSessions: delta30d(ENGAGED_30D,  SESSIONS_PRIOR30, PRIOR_DATA_AVAILABLE),
  salesMeetings:   delta30d(MEETINGS_30D, MEETINGS_PRIOR30, PRIOR_DATA_AVAILABLE),
  ratio:           delta30d(RATIO_30D_DEDUP, RATIO_PRIOR30_DEDUP, PRIOR_DATA_AVAILABLE),
};

// ---------------------------------------------------------------------------
// Top-of-funnel chart data for both modes. Same record shape; TopOfFunnelTrend
// just renders whichever array it's handed. Daily entries have partial=false.
// ---------------------------------------------------------------------------
const TOP_OF_FUNNEL_DAILY_30D = STRICT_WINDOW_DATES.map((d) => {
  const y = Number(d.slice(0, 4));
  const m = Number(d.slice(4, 6)) - 1;
  const day = Number(d.slice(6, 8));
  const dt = new Date(Date.UTC(y, m, day));
  const lbl = fmtMonDay(dt);
  return {
    week:      lbl,        // x-axis tick (renamed-in-context — daily here)
    dateRange: lbl,
    partial:   false,
    sessions:  LIVE_ENGAGED_BY_DATE[d]  || 0,
    signups:   LIVE_SIGNUPS_BY_DATE[d]  || 0,
    meetings:  LIVE_MEETINGS_BY_DATE[d] || 0,
  };
});
// Weekly bars for "Last 30 days" mode — strict 30-day data bucketed Mon-Sun.
// Leading/trailing weeks may be window-clipped (the 30-day cutoff slices the
// first/last week mid-week). Only the current in-progress week is hatched.
// Sum of bars = 30-day KPI total exactly.
const TOP_OF_FUNNEL_WEEKLY_30D = LIVE_WEEKS.map((w) => {
  const dates30 = w.dates.filter(inStrictWindow);
  const sumIn = (m) => dates30.reduce((s, d) => s + (m[d] || 0), 0);
  return {
    week:      w.weekStartLabel,
    dateRange: w.dateRange,
    partial:   w.trailingPartial,
    trailingPartial: w.trailingPartial,
    sessions:  sumIn(LIVE_ENGAGED_BY_DATE),
    signups:   sumIn(LIVE_SIGNUPS_BY_DATE),
    meetings:  sumIn(LIVE_MEETINGS_BY_DATE),
  };
});

// Weekly bars for "Last 4 weeks" mode — 4 complete Mon-Sun weeks plus the
// current in-progress week (5 bars total). Matches Amplitude's "Last 4
// weeks" preset. Sum of bars = SIGNUPS_4W / SESSIONS_4W / MEETINGS_4W totals
// (which is what the KPI tiles display in 4w mode).
const LAST_FOUR_WEEKS_LIST = (() => {
  const list = [];
  for (let i = 4; i >= 0; i--) {
    const wkStart = addUTCDays(_thisWeekMonday, -7 * i);
    const wkEnd   = addUTCDays(wkStart, 6);
    const dates = [];
    for (let d = new Date(wkStart); d <= wkEnd; d = addUTCDays(d, 1)) {
      dates.push(fmtYYYYMMDD(d));
    }
    list.push({
      weekStartLabel: fmtMonDay(wkStart),
      dateRange: `${fmtMonDay(wkStart)} – ${fmtMonDay(wkEnd)}`,
      dates,
      partial: wkEnd > LIVE_END_DATE,
    });
  }
  return list;
})();
const TOP_OF_FUNNEL_WEEKLY_4W = LAST_FOUR_WEEKS_LIST.map((w) => {
  const sumIn = (m) => w.dates.reduce((s, d) => s + (m[d] || 0), 0);
  return {
    week:      w.weekStartLabel,
    dateRange: w.dateRange,
    partial:   w.partial,
    trailingPartial: w.partial,
    sessions:  sumIn(LIVE_ENGAGED_BY_DATE),
    signups:   sumIn(LIVE_SIGNUPS_BY_DATE),
    meetings:  sumIn(LIVE_MEETINGS_BY_DATE),
  };
});

// 30d weekly bars — every Mon-Sun week that overlaps the strict 30-day
// window, including the full week that CONTAINS the 30-day start (so the
// leading bar isn't clipped). Uses LIVE_WEEKS which is anchored to
// mondayOf(today-30) → Sunday of current week. Each bar shows the FULL
// week's data; sums do NOT match the strict-30d KPI total.
const TOP_OF_FUNNEL_WEEKLY_30D_FULL = LIVE_WEEKS.map((w) => {
  const sumIn = (m) => w.dates.reduce((s, d) => s + (m[d] || 0), 0);
  return {
    week:      w.weekStartLabel,
    dateRange: w.dateRange,
    partial:   w.trailingPartial,
    trailingPartial: w.trailingPartial,
    sessions:  sumIn(LIVE_ENGAGED_BY_DATE),
    signups:   sumIn(LIVE_SIGNUPS_BY_DATE),
    meetings:  sumIn(LIVE_MEETINGS_BY_DATE),
  };
});
// Effective chart range label: first week's Monday → today.
const WEEKLY_30D_FULL_RANGE_LABEL = LIVE_WEEKS.length
  ? `${LIVE_WEEKS[0].weekStartLabel} – ${fmtMonDay(LIVE_END_DATE)}, ${LIVE_END_DATE.getUTCFullYear()}`
  : WINDOW.label;

// YTD weekly bars — Monday of the week containing Jan 1 → end of week containing today.
// First bar may include a few pre-Jan-1 days (zero data); current week is hatched.
const YTD_WEEKS_LIST = (() => {
  const list = [];
  let wkStart = mondayOfUTC(YTD_START_DATE);
  while (wkStart <= LIVE_END_DATE) {
    const wkEnd = addUTCDays(wkStart, 6);
    const dates = [];
    for (let d = new Date(wkStart); d <= wkEnd; d = addUTCDays(d, 1)) {
      dates.push(fmtYYYYMMDD(d));
    }
    list.push({
      // X-axis label: MM/DD (e.g. "05/02") — compact for the ~20-bar YTD chart.
      weekStartLabel: fmtMMDD(wkStart),
      dateRange: `${fmtMonDay(wkStart)} – ${fmtMonDay(wkEnd)}`,
      dates,
      partial: wkEnd > LIVE_END_DATE,
    });
    wkStart = addUTCDays(wkStart, 7);
  }
  return list;
})();
const TOP_OF_FUNNEL_WEEKLY_YTD = YTD_WEEKS_LIST.map((w) => {
  const sumIn = (m) => w.dates.reduce((s, d) => s + (m[d] || 0), 0);
  return {
    week:      w.weekStartLabel,
    dateRange: w.dateRange,
    partial:   w.partial,
    trailingPartial: w.partial,
    sessions:  sumIn(LIVE_ENGAGED_BY_DATE),
    signups:   sumIn(LIVE_SIGNUPS_BY_DATE),
    meetings:  sumIn(LIVE_MEETINGS_BY_DATE),
  };
});

// MTD daily — strict MTD window, day-by-day bars.
const TOP_OF_FUNNEL_DAILY_MTD = MTD_DATES_ARRAY.map((d) => {
  const y = Number(d.slice(0, 4));
  const m = Number(d.slice(4, 6)) - 1;
  const day = Number(d.slice(6, 8));
  const dt = new Date(Date.UTC(y, m, day));
  const lbl = fmtMonDay(dt);
  return {
    week:      lbl,
    dateRange: lbl,
    partial:   false,
    sessions:  LIVE_ENGAGED_BY_DATE[d]  || 0,
    signups:   LIVE_SIGNUPS_BY_DATE[d]  || 0,
    meetings:  LIVE_MEETINGS_BY_DATE[d] || 0,
  };
});
// MTD weekly — Mon-Sun weeks that overlap MTD, FULL week data per bar
// (matches the 30d "show full weeks" framework). First bar may include
// pre-MTD days; current week is hatched. Bars do not sum to MTD KPI.
const MTD_WEEKS_LIST = (() => {
  const list = [];
  let wkStart = mondayOfUTC(MTD_START_DATE);
  while (wkStart <= LIVE_END_DATE) {
    const wkEnd = addUTCDays(wkStart, 6);
    const dates = [];
    for (let d = new Date(wkStart); d <= wkEnd; d = addUTCDays(d, 1)) {
      dates.push(fmtYYYYMMDD(d));
    }
    list.push({
      weekStartLabel: fmtMonDay(wkStart),
      dateRange: `${fmtMonDay(wkStart)} – ${fmtMonDay(wkEnd)}`,
      dates,
      partial: wkEnd > LIVE_END_DATE,
    });
    wkStart = addUTCDays(wkStart, 7);
  }
  return list;
})();
// MTD weekly date range covers the first Mon-Sun week overlapping MTD
// through today. Used as the chart's effective date range label.
const MTD_WEEKLY_RANGE_LABEL = (() => {
  if (MTD_WEEKS_LIST.length === 0) return MTD_RANGE_LABEL;
  const firstWeekStart = MTD_WEEKS_LIST[0].dateRange.split('–')[0].trim();
  return `${firstWeekStart} – ${fmtMonDay(LIVE_END_DATE)}, ${LIVE_END_DATE.getUTCFullYear()}`;
})();
const TOP_OF_FUNNEL_WEEKLY_MTD = MTD_WEEKS_LIST.map((w) => {
  const sumIn = (m) => w.dates.reduce((s, d) => s + (m[d] || 0), 0);
  return {
    week:      w.weekStartLabel,
    dateRange: w.dateRange,
    partial:   w.partial,
    trailingPartial: w.partial,
    sessions:  sumIn(LIVE_ENGAGED_BY_DATE),
    signups:   sumIn(LIVE_SIGNUPS_BY_DATE),
    meetings:  sumIn(LIVE_MEETINGS_BY_DATE),
  };
});

// YTD monthly — one bar per month from Jan to current month.
// Current month is hatched as in-progress (partial: true).
const YTD_MONTHS_LIST = (() => {
  const list = [];
  const year = LIVE_END_DATE.getUTCFullYear();
  const currentMonth = LIVE_END_DATE.getUTCMonth();
  for (let m = 0; m <= currentMonth; m++) {
    const mStart = new Date(Date.UTC(year, m, 1));
    const mEnd   = new Date(Date.UTC(year, m + 1, 0));  // last day of month
    const dates = [];
    for (let d = new Date(mStart); d <= mEnd; d = addUTCDays(d, 1)) {
      dates.push(fmtYYYYMMDD(d));
    }
    list.push({
      label: MONTH_ABBR[m],
      dateRange: `${MONTH_ABBR[m]} ${year}`,
      dates,
      partial: m === currentMonth,  // current month = in-progress = hatched
    });
  }
  return list;
})();

// Monthly variant of the visitor-conversion-rate trend, shown when the toggle
// is YTD. Per-month rate (month signups ÷ month sessions), complete calendar
// months only (the in-progress current month is excluded like the weekly view).
const RATIO_TREND_MONTHLY_SERIES = YTD_MONTHS_LIST
  .filter((m) => !m.partial)
  .map((m) => {
    let sig = 0, sess = 0;
    for (const k of m.dates) { sig += LIVE_SIGNUPS_BY_DATE[k] || 0; sess += LIVE_ENGAGED_BY_DATE[k] || 0; }
    return {
      week:            m.label,
      dateRange:       m.dateRange,
      partial:         false,
      trailingPartial: false,
      signups:         sig,
      sessions:        sess,
      ratio: (sess > 0 && sig > 0) ? +((sig / sess) * 100).toFixed(2) : null,
    };
  });
const RATIO_TREND_MONTHLY_LABEL = RATIO_TREND_MONTHLY_SERIES.length
  ? `${RATIO_TREND_MONTHLY_SERIES[0].week} – ${RATIO_TREND_MONTHLY_SERIES[RATIO_TREND_MONTHLY_SERIES.length - 1].week} ${LIVE_END_DATE.getUTCFullYear()}`
  : '';
const TOP_OF_FUNNEL_MONTHLY_YTD = YTD_MONTHS_LIST.map((mo) => {
  const sumIn = (map) => mo.dates.reduce((s, d) => s + (map[d] || 0), 0);
  return {
    week:      mo.label,           // re-uses 'week' xKey for BarPanel compatibility
    dateRange: mo.dateRange,
    partial:   mo.partial,
    trailingPartial: mo.partial,
    sessions:  sumIn(LIVE_ENGAGED_BY_DATE),
    signups:   sumIn(LIVE_SIGNUPS_BY_DATE),
    meetings:  sumIn(LIVE_MEETINGS_BY_DATE),
  };
});

// YTD monthly cohorts shaped like LIVE_WEEKS so the Channel Analytics builders
// (computeSignupsByChannelGAWeekly / computeWebSessionsWeekly /
// computeChannelDeepDive / SelfReportedSourcesChart) produce one bar per month
// (Jan→current) in YTD instead of weekly bars. They key off weekStartLabel +
// dates, so the month label becomes the x-axis label.
const YTD_MONTH_COHORTS = YTD_MONTHS_LIST.map((mo) => ({
  weekStartLabel: mo.label,
  weekStart:      mo.dates[0],     // YYYYMMDD month start — unique row key
  dateRange:      mo.dateRange,
  dates:          mo.dates,
  partial:        mo.partial,
}));

// ---------------------------------------------------------------------------
// Helper: per-source count over an arbitrary date set. Handles both the OLD
// pre-aggregated referralSources shape ({source, count}) and the NEW shape
// that includes a per-day breakdown ({source, count, daily:{ 'YYYYMMDD':n }}).
// Old shape can't slice — it returns the full window total, which falls back
// gracefully for the pie until src/data.json is refreshed with new pull-data.
// ---------------------------------------------------------------------------
function sourceWindowCount(sourceEntry, dateSet) {
  if (sourceEntry?.daily) {
    let t = 0;
    for (const d of dateSet) t += sourceEntry.daily[d] || 0;
    return t;
  }
  return sourceEntry?.count || 0;
}

// ---------------------------------------------------------------------------
// Week-over-Week — same-days-of-week cumulative (option B).
// Compares this-week's-Mon-through-today against last-week's-same-days.
// Caveat: a one-day spike in the previous week lingers in the comparison
// for ~5 days (through end of that week), then resets when we cross into
// the next Mon-Sun bucket. Acceptable for the "live" reactive feel.
// ---------------------------------------------------------------------------
const _currentWeekMon = mondayOfUTC(LIVE_END_DATE);
const _lastWeekMon    = addUTCDays(_currentWeekMon, -7);
const _daysIntoWeek   = Math.round((LIVE_END_DATE - _currentWeekMon) / 86400000) + 1; // 1..7

const _thisWeekDates = [];
for (let i = 0; i < _daysIntoWeek; i++) _thisWeekDates.push(fmtYYYYMMDD(addUTCDays(_currentWeekMon, i)));
const _lastWeekDates = [];
for (let i = 0; i < _daysIntoWeek; i++) _lastWeekDates.push(fmtYYYYMMDD(addUTCDays(_lastWeekMon, i)));

function sumByDateMap(map, dates)   { return dates.reduce((s, d) => s + (map[d]   || 0), 0); }
function countMeetingsIn(dates)     { return (dataJson.hubspot?.meetings || []).filter((m) => dates.includes(m.date)).length; }

const _wowSignups = {
  thisWeek: sumByDateMap(LIVE_SIGNUPS_BY_DATE, _thisWeekDates),
  lastWeek: sumByDateMap(LIVE_SIGNUPS_BY_DATE, _lastWeekDates),
};
const _wowEngaged = {
  thisWeek: sumByDateMap(LIVE_ENGAGED_BY_DATE, _thisWeekDates),
  lastWeek: sumByDateMap(LIVE_ENGAGED_BY_DATE, _lastWeekDates),
};
const _wowMeetings = {
  thisWeek: countMeetingsIn(_thisWeekDates),
  lastWeek: countMeetingsIn(_lastWeekDates),
};
const _wowRatio = {
  thisWeek: _wowEngaged.thisWeek ? (_wowSignups.thisWeek / _wowEngaged.thisWeek) * 100 : 0,
  lastWeek: _wowEngaged.lastWeek ? (_wowSignups.lastWeek / _wowEngaged.lastWeek) * 100 : 0,
};

// Returns { raw, pct } or null if there's no comparable prior period.
// `raw` is the absolute change (this − last); `pct` is the relative %.
// If `prev` is zero we still render `raw` (it's meaningful) but suppress
// `pct` so we don't show "+Infinity%".
function wow(curr, prev) {
  if (curr === undefined || curr === null || prev === undefined || prev === null) return null;
  return {
    raw: curr - prev,
    pct: prev !== 0 ? ((curr - prev) / prev) * 100 : null,
  };
}
const WOW = {
  signups:         wow(_wowSignups.thisWeek,  _wowSignups.lastWeek),
  engagedSessions: wow(_wowEngaged.thisWeek,  _wowEngaged.lastWeek),
  salesMeetings:   wow(_wowMeetings.thisWeek, _wowMeetings.lastWeek),
  // Ratio WoW: raw is percentage-points (pp); pct is relative change of the ratio.
  ratio:           wow(_wowRatio.thisWeek,    _wowRatio.lastWeek),
};

// Weekly top-of-funnel — all three series live now.
//   sessions ← GA4 file1 daily
//   signups  ← Amplitude dailySignups
//   meetings ← HubSpot meetings, counted per submission date
const WEEKLY_TOP_OF_FUNNEL = LIVE_WEEKS.map((w) => {
  const sumIn = (m) => w.dates.reduce((s, d) => s + (m[d] || 0), 0);
  return {
    week:             w.weekStartLabel,
    dateRange:        w.dateRange,
    partial:          w.partial,
    trailingPartial:  w.trailingPartial,
    leadingPartial:   w.leadingPartial,
    sessions:  sumIn(LIVE_ENGAGED_BY_DATE),
    signups:   sumIn(LIVE_SIGNUPS_BY_DATE),
    meetings:  sumIn(LIVE_MEETINGS_BY_DATE),
  };
});

// Share of Signups
// ---------------------------------------------------------------------------
// Share of Signups — categorization rules + bucketed data.
// The `rules` array below is the source of truth for how raw referral_source
// strings get bucketed. Each rule is (regex, bucketName) checked top-to-bottom;
// first match wins, so order matters. New entries from future Amplitude pulls
// can be auto-bucketed by running them through categorizeReferralSource() —
// no manual re-categorization required.
// ---------------------------------------------------------------------------
// Known employer/customer mentions that indicate "heard from coworkers at
// this company" — bucketed as Word of Mouth. Grows over time as new
// employer-mention patterns appear in raw data.
const KNOWN_EMPLOYER_MENTIONS = /^(BMC|Homebase|Slack|calm|sequoia|Team|SWI|Airwallex|Apollo\s?IO?|Builtwith|Exadel|Octave|tennr|Samsara)$|we use it at|use(d)?\s?(it)?\s?at|previous\s?role|previous\s?company|usage\s?in|worked?\s?with|evaluated\s?in/i;

// Smart inference rules for self-reported referral_source. Each rule's pattern
// runs against the response after lightweight normalization (lowercase + URL
// host extraction + punctuation strip). Order matters: more specific patterns
// must come before generic ones so they win. Patterns are designed to handle
// typos, casing, multi-language responses, and full-phrase variants — e.g.
// "from a coworker", "Co-Worker", "my colleagues", and "collegaue" all hit the
// same Word of Mouth rule.
const CATEGORIZATION_RULES = [
  // ── 1. LinkedIn — name OR linkedin.com domain (any casing/spacing). ──
  { match: /linked[\s-]?in|linkedin\.com/i, bucket: 'LinkedIn' },

  // ── 2. AEO — AI search/chat engines & their URLs. ──
  // Catches: chatgpt, chat gpt, claude (incl. claude.ai/claude.com), gpt,
  // perplexity, gemini, copilot (incl. co-pilot, co pilot), bare "ai".
  { match: /chat\s?gpt|\bgpt\b|claude(\.ai|\.com)?|perplexity|gemini|co[-\s]?pilot|\bai\b/i, bucket: 'AEO' },

  // ── 3. YC — Y Combinator and its internal community (Bookface). ──
  { match: /y\s?combinator|\byc\b|bookface/i, bucket: 'YC' },

  // ── 4. Influencer / Community — known names, podcasts, conferences,
  //       courses/academies, content channels. ──
  { match: /\bmkt1\b|\bhbs\b|alumni|community|30\s?mpc|30\s?mins?\s?to|emily\s?kramer|\bjaleh\b|wes\s?bush|joel\s?klettke|patrick\s?collins|inbound\s?conference|substack|\bacademy\b|long\s?time\s?listener|^content$|par\s?une\s?formation/i,
    bucket: 'Influencer / Community' },
  { match: /podcast/i, bucket: 'Influencer / Community' },

  // ── 5. Word of Mouth — peer/colleague/client recommendations, employer
  //       mentions, family/personal references, multi-language equivalents,
  //       and "someone mentioned it" phrasings. Order this AFTER LinkedIn
  //       so "LinkedIn post from someone" stays in LinkedIn. ──
  // Typos: `colleg` stem catches colleague/colleagues/collegues/collegaue;
  //        `refer` stem catches referred/referral/referal/refferal/recc/refers.
  // Multi-language: passaparola (it), indicação (pt).
  // `\bfan\b` is safe — in a "how did you hear" field, "fan" almost always
  // means a third party is enthusiastic about Mutiny.
  // "work"/"working with" handles bare-word "work" / "at work" / "Working
  // with Mutiny on rebrand" type responses (colleague-adjacent context).
  { match: new RegExp(
      /friend|colleagu|colleg(au|ue|e)|co[-\s]?worker|\bclients?\b|\bteammate\b|\bcousin\b|\bre[fF]+er|\brecc\b|recommen|word.?of.?mouth|\bwom\b|\bmanager\b|\bteacher\b|\bceo\b|\bvp\b|\bboss\b|\bfan\b|\bbuddy\b|\bhubby\b|\bwife\b|\bhusband\b|\bspouse\b|\binvestor\b|\bruben\b|\bnikhil\b|\belijah\b|\bawoke\b|\blexi\b|sam\s?gong|previous\s?customer|consultant|advisor|\bfounder\b|\bboard\b|cowboy\s?ventures|newsletter|passaparola|indicaç|mention(ed|ing|s)?\b|my\s?(ae|coworker|boss|hubby|manager|wife|husband|teammate|bosses)|^work$|^at\s?work$|work(ing|ed)?\s?with|^company$|^company\s?profile$|^business$|^marketing(\s?lead)?$|^another\s?competitor$|^other\s?company$|from\s?job\s?boards?|^job\s?boards?$|interview|peer|industry/.source
      + '|' + KNOWN_EMPLOYER_MENTIONS.source, 'i'),
    bucket: 'Word of Mouth' },

  // ── 6. Search — Google/web/internet/organic + generic "looking for"
  //       intent + SEO/research-style phrasings. ──
  { match: /google|googl|\bsearch\b|^web$|web\s?search|^organic$|online|internet|^www$|\bseo\b|looking\s?for|\bresearch\b|^website$/i,
    bucket: 'Search' },

  // ── 7. Social — all major platforms + bare "social"/"social media" +
  //       email/mail (outbound, not its own bucket). ──
  { match: /\bx post\b|^x$|twitter|reddit|facebook|^fb$|^fb\b|instagram|\binsta\b|youtube|^yt$|\byt\b|tiktok|tik\s?tok|snapchat|pinterest|threads|bluesky|mastodon|social\s?media|^social$|^email$|^mail$/i,
    bucket: 'Social' },

  // ── 8. Joke / Invalid — fate/destiny variants, test entries, blanks,
  //       short random strings, obvious joke phrases, "I don't know"
  //       equivalents. Keeps the Other bucket meaningful. Vague-but-real
  //       responses ("Marketing", "business", "company profile") fall through
  //       to Other rather than getting buried in Joke. ──
  { match: /\bfate\b|\bdestiny\b|\bluck\b|^test|\btesting\b|^demo$|^trining$|\bidk\b|^jk$|^it$|^try$|^omar$|^dj\s?khaled$|^sfasf$|^hello$|^\.+$|^-+$|^\d{1,2}$|^n\/?a$|^na$|^tbd$|^dunno$|^date$|^spam$|^myself$|^my\s?meta\s?data$|i didn'?t|i was so excited|don'?t remember|pressured me into|its blowing up|my neighbors|home\s?boy|20 year marketing|\bloved it\b|wizard.*alley|raccoon|^(aa+|gg+|ff+|das|sds|ifif|f)$/i,
    bucket: 'Joke / Invalid' },
];

// Normalize a raw referral_source for matching: lowercase, trim, extract URL
// hosts (so "https://www.linkedin.com/in/..." matches the LinkedIn rule),
// collapse whitespace.
function normalizeReferralSource(raw) {
  if (!raw) return '';
  let s = String(raw).toLowerCase().trim();
  const urlMatch = s.match(/https?:\/\/(?:www\.)?([^\s/]+)/);
  if (urlMatch) s = urlMatch[1] + ' ' + s; // prepend host so rules still see context
  return s.replace(/\s+/g, ' ');
}

function categorizeReferralSource(raw) {
  if (!raw) return 'Other / Unparseable';
  const normalized = normalizeReferralSource(raw);
  if (!normalized) return 'Other / Unparseable';
  for (const rule of CATEGORIZATION_RULES) {
    if (rule.match.test(normalized)) return rule.bucket;
  }
  return 'Other / Unparseable';
}

// ---------------------------------------------------------------------------
// Signups pie data — live from Amplitude. dataJson.amplitude.referralSources
// is an array of { source: string, count: number } objects (one per unique
// referral_source value seen in the window). categorizeReferralSource maps
// each raw string to one of nine buckets via the rules above.
// ---------------------------------------------------------------------------
const BUCKET_DEFINITIONS = [
  { name: 'Word of Mouth',          color: C.purple },
  { name: 'Search',                 color: C.lightBlue },
  { name: 'AEO',                    color: C.green },
  { name: 'Influencer / Community', color: C.lightPurple },
  { name: 'YC',                     color: C.red },
  { name: 'LinkedIn',                color: C.linkedinBlue },
  { name: 'Social',                  color: C.lightRed },
  { name: 'Joke / Invalid',          color: '#9D9D9D' },
  { name: 'Other / Unparseable',     color: C.black },
];

// Pie data is now a function of the active date set so the toggle (Last 30
// days vs Last 4 weeks) can re-slice on the fly. Both shapes of
// referralSources are supported: NEW shape (per-source `daily` map) slices
// to the requested window; OLD shape falls back to the full pre-aggregated
// count (no date attribution available until pull-data is re-run).
function computeShareOfSignups(dateSet) {
  return BUCKET_DEFINITIONS.map((def) => {
    let value = 0;
    const sources = [];
    for (const entry of (dataJson.amplitude?.referralSources || [])) {
      if (categorizeReferralSource(entry.source) === def.name) {
        const n = sourceWindowCount(entry, dateSet);
        if (n > 0) {
          value += n;
          sources.push(entry.source);
        }
      }
    }
    return { ...def, value, sources };
  });
}
// Backwards-compatible default exports — pre-computed for the strict 30-day
// window. Used as the default when no mode-specific window is in play.
const STRICT_WINDOW_DATES_SET = new Set(STRICT_WINDOW_DATES);
const SHARE_OF_SIGNUPS = computeShareOfSignups(STRICT_WINDOW_DATES_SET);
const TOTAL_SIGNUPS_CATEGORIZED = SHARE_OF_SIGNUPS.reduce((s, x) => s + x.value, 0);
// 4-week variant for the toggle.
const SHARE_OF_SIGNUPS_4W = computeShareOfSignups(FOURWEEKS_DATES_SET);
const TOTAL_SIGNUPS_CATEGORIZED_4W = SHARE_OF_SIGNUPS_4W.reduce((s, x) => s + x.value, 0);
const SHARE_OF_SIGNUPS_YTD = computeShareOfSignups(YTD_DATES_SET);
const TOTAL_SIGNUPS_CATEGORIZED_YTD = SHARE_OF_SIGNUPS_YTD.reduce((s, x) => s + x.value, 0);
const SHARE_OF_SIGNUPS_MTD = computeShareOfSignups(MTD_DATES_SET);
const TOTAL_SIGNUPS_CATEGORIZED_MTD = SHARE_OF_SIGNUPS_MTD.reduce((s, x) => s + x.value, 0);

// ---------------------------------------------------------------------------
// Per-period stacked-bar data for the Customer signups by channel weekly
// chart (replaces the pie). Each row = one period (week or month) with the
// 9 BUCKET_DEFINITIONS bucket counts + an `Invited / Referred` residual = total
// signups in the period minus sum of categorized buckets. Signups now = the
// 4-event onboarding union; only Company Setup Complete carries a
// referral_source, so every other signup falls into the residual, which we
// label Invited / Referred rather than silently hiding it.
//
// Period shape supported: { weekStartLabel | label, dateRange, dates,
// partial, trailingPartial? }. Returns one row per period with keys:
//   - week:           x-axis tick label
//   - dateRange, partial, trailingPartial: passthrough for tooltip + hatch
//   - <bucketName>:   count per bucket (one key per BUCKET_DEFINITIONS entry)
//   - 'Invited / Referred': residual for signups on/after the May 7 cutoff
//   - 'Not Specified':      residual for signups before the cutoff
//   - total:          full unique signups in the period
// ---------------------------------------------------------------------------
// The `referral_source` field became REQUIRED on May 7, 2026. So a signup with
// no source is interpreted differently by date:
//   - before the cutoff → "Not Specified" (field was optional; source unknown)
//   - on/after the cutoff → "Invited / Referred" (joined via invitation /
//       registration; only Company Setup Complete carries a source)
const REFERRAL_REQUIRED_CUTOFF = '20260507';
const INVITED_REFERRED_BUCKET = { name: 'Invited / Referred', color: '#B6B6B6' };
const NOT_SPECIFIED_BUCKET    = { name: 'Not Specified',      color: '#DCDCDC' };
const SIGNUPS_CHANNEL_BUCKETS = [...BUCKET_DEFINITIONS, INVITED_REFERRED_BUCKET, NOT_SPECIFIED_BUCKET];
// Stack order (bottom → top): the two no-channel residuals at the base, then
// the categorized buckets in the same order they appear in the pie legend.
const SIGNUPS_CHANNEL_STACK = [NOT_SPECIFIED_BUCKET, INVITED_REFERRED_BUCKET, ...BUCKET_DEFINITIONS];

function computeSignupsByChannelPeriodic(periods) {
  // Per-day per-bucket counts from referralSources (skip entries without daily).
  const perDay = {};
  for (const entry of (dataJson.amplitude?.referralSources || [])) {
    const bucket = categorizeReferralSource(entry.source);
    if (!entry.daily) continue;
    for (const [d, n] of Object.entries(entry.daily)) {
      perDay[d] = perDay[d] || {};
      perDay[d][bucket] = (perDay[d][bucket] || 0) + (n || 0);
    }
  }
  return periods.map((p) => {
    const row = {
      week:            p.weekStartLabel ?? p.label,
      dateRange:       p.dateRange,
      partial:         p.trailingPartial ?? p.partial,
      trailingPartial: p.trailingPartial ?? p.partial,
      dates:           p.dates,
    };
    let categorized = 0;
    for (const def of BUCKET_DEFINITIONS) {
      let v = 0;
      for (const d of p.dates) v += perDay[d]?.[def.name] || 0;
      row[def.name] = v;
      categorized += v;
    }
    // Per-bar total = deduped union uniques over the bar's date range when
    // available (so each weekly/monthly bar dedupes within its own period),
    // else the summed-daily total. See the `amplitude.dedup` note up top.
    const summedTotal = p.dates.reduce((s, d) => s + (LIVE_SIGNUPS_BY_DATE[d] || 0), 0);
    const total = dedupPeriodTotal(p.dates, summedTotal);
    // Residual = signups with no referral channel (total − categorized),
    // clamped to 0. It's split at the May 7, 2026 cutoff (when referral_source
    // became required): the portion of the period before the cutoff is
    // "Not Specified" (source unknown), the portion on/after is
    // "Invited / Referred". We allocate the deduped residual across the two by
    // the share of daily-union signups on each side of the cutoff, so the bar
    // total stays exact. Most bars sit entirely on one side (share 0 or 1);
    // only periods straddling May 7 (the May month / the May 4–10 week) split.
    const residual = Math.max(0, total - categorized);
    let preUnion = 0, postUnion = 0;
    for (const d of p.dates) {
      const u = LIVE_SIGNUPS_BY_DATE[d] || 0;
      if (d < REFERRAL_REQUIRED_CUTOFF) preUnion += u; else postUnion += u;
    }
    const denom = preUnion + postUnion;
    const preFrac = denom > 0
      ? preUnion / denom
      : (p.dates[p.dates.length - 1] < REFERRAL_REQUIRED_CUTOFF ? 1 : 0);
    const notSpecified = Math.round(residual * preFrac);
    row['Not Specified']      = notSpecified;
    row['Invited / Referred'] = residual - notSpecified;
    row.total = total;
    return row;
  });
}

const SIGNUPS_BY_CHANNEL_WEEKLY_30D = computeSignupsByChannelPeriodic(LIVE_WEEKS);
const SIGNUPS_BY_CHANNEL_WEEKLY_MTD = computeSignupsByChannelPeriodic(MTD_WEEKS_LIST);
const SIGNUPS_BY_CHANNEL_MONTHLY_YTD = computeSignupsByChannelPeriodic(YTD_MONTHS_LIST);

// ---------------------------------------------------------------------------
// Previous-method signups by channel — [Onboarding] Company Setup Complete,
// SUM-OF-DAILY (the way the pre-June-29 dashboard counted: no cross-day
// dedup). Same referral_source categorization as the USC chart, but the
// per-bar total is the summed daily CSC count and the residual (CSC signups
// with a blank/(none) referral_source) is labelled "Not Specified" — CSC only
// fires for org-creators, so there's no "Invited / Referred" cohort here.
// ---------------------------------------------------------------------------
function computeCscByChannelPeriodic(periods) {
  const perDay = {};
  for (const entry of (dataJson.amplitude?.referralSources || [])) {
    const bucket = categorizeReferralSource(entry.source);
    if (!entry.daily) continue;
    for (const [d, n] of Object.entries(entry.daily)) {
      perDay[d] = perDay[d] || {};
      perDay[d][bucket] = (perDay[d][bucket] || 0) + (n || 0);
    }
  }
  return periods.map((p) => {
    const row = {
      week:            p.weekStartLabel ?? p.label,
      dateRange:       p.dateRange,
      partial:         p.trailingPartial ?? p.partial,
      trailingPartial: p.trailingPartial ?? p.partial,
      dates:           p.dates,
    };
    let categorized = 0;
    for (const def of BUCKET_DEFINITIONS) {
      let v = 0;
      for (const d of p.dates) v += perDay[d]?.[def.name] || 0;
      row[def.name] = v;
      categorized += v;
    }
    // Sum-of-daily CSC total for the bar (no dedup).
    const total = p.dates.reduce((s, d) => s + (LIVE_CSC_BY_DATE[d] || 0), 0);
    // Residual = CSC signups whose referral_source was blank/(none). Labelled
    // "Not Specified" for the whole series (no invited cohort in the CSC event).
    row['Not Specified']      = Math.max(0, total - categorized);
    row['Invited / Referred'] = 0;
    row.total = total;
    return row;
  });
}
const CSC_BY_CHANNEL_WEEKLY_30D  = computeCscByChannelPeriodic(LIVE_WEEKS);
const CSC_BY_CHANNEL_WEEKLY_MTD  = computeCscByChannelPeriodic(MTD_WEEKS_LIST);
const CSC_BY_CHANNEL_MONTHLY_YTD = computeCscByChannelPeriodic(YTD_MONTHS_LIST);

// ---------------------------------------------------------------------------
// Signups by TEAM — from the `user_work_role` EVENT property stamped on
// [Onboarding] User Setup Complete itself (amplitude.roles). Every completer
// carries it at completion time (no event-time-evaluation lag, no MOST_RECENT
// drift), so genuine blanks are near-zero from Mar 2026 on. Only gap: the
// property wasn't instrumented for the first USC weeks → Feb 2026 has ~117
// 'none'. Team split per period/window:
//   Sales     = AE + BDR/SDR + Sales other
//   Marketing = ABM + Demand gen + Ops lead + Marketing other + Product mktg
//   Other     = Founder + Other role + CRO
//   No role   = the 'none' group (genuinely blank work role).
// BASIS: amplitude.roles.daily is the SAME User Setup Complete events counted
// by dailySignups, grouped by user_work_role as EVENT TOTALS per day. So for
// every day Σ over roles === dailySignups[day], and summing the daily map over
// any window's dates yields a role split whose four team segments sum EXACTLY
// to the signup total for that window — no scaling, no dedup reconciliation.
// This holds for custom Reporting ranges too (just another set of dates).
// Falls back to all-No-role only if roles.daily is absent (e.g. data.json not
// yet refreshed by pull-data).
// ---------------------------------------------------------------------------
const ROLES = dataJson.amplitude?.roles || {};
const ROLES_BY_DATE = ROLES.daily || {};
// Sum per-role event totals over a set/array of YYYYMMDD dates → { role: n },
// or null if no daily role data covers any of those dates.
function roleMapForDates(dates) {
  if (!dates) return null;
  const arr = Array.isArray(dates) ? dates : [...dates];
  const out = {};
  let any = false;
  for (const d of arr) {
    const m = ROLES_BY_DATE[d];
    if (!m) continue;
    for (const [k, v] of Object.entries(m)) { out[k] = (out[k] || 0) + v; any = true; }
  }
  return any ? out : null;
}
const TEAM_DEFS = [
  { name: 'Sales',                color: C.purple,  roles: ['ae', 'bdr_sdr', 'sales_other'] },
  { name: 'Marketing',            color: C.blue,    roles: ['abm', 'demand_gen', 'ops_lead', 'marketing_other', 'product_marketing'] },
  { name: 'Other',                color: '#5DCAA5', roles: ['founder', 'other', 'cro'] },
  { name: 'No role', color: '#C8C8C8', roles: null },
];
const TEAM_STACK = ['Sales', 'Marketing', 'Other', 'No role'];  // bottom → top
const SALES_ROLES = new Set(['ae', 'bdr_sdr', 'sales_other']);
const MKT_ROLES   = new Set(['abm', 'demand_gen', 'ops_lead', 'marketing_other', 'product_marketing']);
const OTHER_ROLES = new Set(['founder', 'other', 'cro']);
const ROLE_LABELS = {
  ae: 'AE', bdr_sdr: 'BDR/SDR', sales_other: 'Sales other',
  abm: 'ABM', demand_gen: 'Demand gen', ops_lead: 'Ops lead',
  marketing_other: 'Marketing other', product_marketing: 'Product mktg',
  founder: 'Founder', other: 'Other role', cro: 'CRO',
};
// Largest-remainder rounding: scale `values` by `target / sum(values)` and
// round so the results sum EXACTLY to `target`.
function scaleToTotal(values, target) {
  const rawSum = values.reduce((a, b) => a + b, 0);
  if (!(rawSum > 0) || !(target > 0)) return values.map(() => 0);
  const exact = values.map((v) => (v * target) / rawSum);
  const out = exact.map(Math.floor);
  let remainder = target - out.reduce((a, b) => a + b, 0);
  const byRemainder = exact
    .map((v, i) => [v - out[i], i])
    .sort((a, b) => b[0] - a[0]);
  for (const [, i] of byRemainder) {
    if (remainder <= 0) break;
    out[i] += 1;
    remainder -= 1;
  }
  return out;
}
// Bucket the raw per-role EVENT TOTALS into the four teams. No scaling: the
// segments are the true event counts and already sum to the window's signup
// total (same events, just grouped). Any unrecognized/blank role → No role, so
// nothing is dropped. `total` is only used as the all-No-role fallback when no
// role data exists for the range.
function teamSplit(roleMap, total) {
  let sales = 0, mkt = 0, other = 0, blank = 0;
  for (const [k, v] of Object.entries(roleMap || {})) {
    if (SALES_ROLES.has(k)) sales += v;
    else if (MKT_ROLES.has(k)) mkt += v;
    else if (OTHER_ROLES.has(k)) other += v;
    else blank += v; // 'none' / '(none)' / any blank or unknown role
  }
  const rawSum = sales + mkt + other + blank;
  if (!rawSum) {
    // No role data for this range → everything falls into "No role".
    return { Sales: 0, Marketing: 0, Other: 0, 'No role': Math.max(0, total || 0) };
  }
  return { Sales: sales, Marketing: mkt, Other: other, 'No role': blank };
}
// Per-role detail map for the pie's sub-role lines — raw event totals, passed
// through unchanged (no scaling now that segments already tie to the total).
function scaleRoleMap(roleMap) {
  return roleMap || null;
}
function computeTeamPeriodic(periods) {
  return periods.map((p) => {
    const summed = p.dates.reduce((s, d) => s + (LIVE_SIGNUPS_BY_DATE[d] || 0), 0);
    const t = teamSplit(roleMapForDates(p.dates), summed);
    // Bar height = sum of the four segments; equals the summed-daily signup
    // total exactly whenever roles.daily covers the period.
    const total = t.Sales + t.Marketing + t.Other + t['No role'];
    return {
      week: p.weekStartLabel ?? p.label,
      dateRange: p.dateRange,
      partial: p.trailingPartial ?? p.partial,
      ...t,
      total,
    };
  });
}
const TEAM_WEEKLY_30D  = computeTeamPeriodic(LIVE_WEEKS);
const TEAM_WEEKLY_MTD  = computeTeamPeriodic(MTD_WEEKS_LIST);
const TEAM_MONTHLY_YTD = computeTeamPeriodic(YTD_MONTHS_LIST);

// ---------------------------------------------------------------------------
// Sales Meeting Discovery — self-reported "how did you discover Mutiny"
// from the Talk to Sales form (HubSpot contacts, property
// `how_did_you_discover_mutiny`). Same bucketing rules as Share of Signups.
// Pull: May 13, 2026.
// Window: Talk to Sales form-submission date BETWEEN Apr 27 – May 13, 2026.
//   Submission date logic: if recent_conversion_event_name = "Talk to Sales",
//   use recent_conversion_date; else (recent = a later "Meetings Link"
//   booking), use first_conversion_date (createdate) since Talk to Sales was
//   their first conversion.
// 23 contacts with how_did_you_discover_mutiny set + any conversion activity
// in window → 14 valid TtS submissions in window after filtering:
//   - 4 test accounts excluded (3× matt.ratchford+*@mutinyhq.com; kedwardsfake@1mind.com)
//   - 5 outside-window excluded (Talk to Sales fill predates Apr 27; their
//     in-window activity was a meeting booking, not a fresh form fill).
// ---------------------------------------------------------------------------
// Sales meetings pie — live from HubSpot. dataJson.hubspot.meetings is an
// array of { date, email, company, referralSource } objects, one per valid
// in-window Talk-to-Sales submission (test-filtered, submission-date by
// the corrected first_conversion_date rule — see CONTEXT.md).
// Filter HubSpot meetings to the strict 30-day window so the pie matches
// the KPI tile rather than the weekly chart's expanded Mon-Sun range.
function computeShareOfSalesMeetings(datePredicate) {
  const responses = (dataJson.hubspot?.meetings || [])
    .filter((m) => datePredicate(m.date))
    .map((m) => m.referralSource);
  return BUCKET_DEFINITIONS.map((def) => {
    const sources = responses.filter(
      (raw) => categorizeReferralSource(raw) === def.name
    );
    return { ...def, value: sources.length, sources };
  });
}
const SHARE_OF_SALES_MEETINGS = computeShareOfSalesMeetings(inStrictWindow);
const TOTAL_SALES_MEETINGS_CATEGORIZED = SHARE_OF_SALES_MEETINGS.reduce((s, x) => s + x.value, 0);
const SHARE_OF_SALES_MEETINGS_4W = computeShareOfSalesMeetings(inFourWeeksWindow);
const TOTAL_SALES_MEETINGS_CATEGORIZED_4W = SHARE_OF_SALES_MEETINGS_4W.reduce((s, x) => s + x.value, 0);
const SHARE_OF_SALES_MEETINGS_YTD = computeShareOfSalesMeetings(inYtdWindow);
const TOTAL_SALES_MEETINGS_CATEGORIZED_YTD = SHARE_OF_SALES_MEETINGS_YTD.reduce((s, x) => s + x.value, 0);
const SHARE_OF_SALES_MEETINGS_MTD = computeShareOfSalesMeetings(inMtdWindow);
const TOTAL_SALES_MEETINGS_CATEGORIZED_MTD = SHARE_OF_SALES_MEETINGS_MTD.reduce((s, x) => s + x.value, 0);

// Bucketing rules — tightened regexes so that e.g. "mail.google.com" doesn't
// get caught by the Search rule. Rules applied in order; first match wins.
const SIGNUPS_BUCKETING_RULES = [
  // AEO / Answer Engine Optimization — match known LLM/AI search sources
  { match: /^chatgpt\.com$|^claude\.com$|^claude\.ai$|^perplexity\.ai$|^gemini\.google\.com$|^bard\.google\.com$|^copilot\.microsoft\.com$|^poe\.com$|chatgpt|^claude$|perplexity/i, bucket: 'AEO' },
  // LinkedIn — broken out from Organic Social
  { match: /linkedin/i, bucket: 'LinkedIn' },
  // Social — Twitter/X, Reddit, Facebook, Instagram, other social
  { match: /twitter|^x\.com$|^t\.co$|reddit|facebook|^fb\.|instagram|^ig$/i, bucket: 'Social' },
  // Search engines — STRICT exact-match so subdomains like mail.google.com or
  // tagassistant.google.com don't get caught and end up here incorrectly.
  { match: /^google$|^bing$|^duckduckgo$|^yahoo$|^brave$|^ecosia$|^qwant$|^baidu$|^yandex$/i, bucket: 'Search' },
  // Email — medium-based or known mail prefix
  { match: /^email$|newsletter|mailchimp|^hs_email$/i, bucket: 'Email' },
  // Direct
  { match: /^\(direct\)$/i, bucket: 'Direct' },
];

function bucketSignupEntry(entry) {
  for (const rule of SIGNUPS_BUCKETING_RULES) {
    if (rule.match.test(entry.source) || rule.match.test(entry.medium)) return rule.bucket;
  }
  // Fallback to GA4's channel group, mapped to our naming. Supports both the
  // stock "Session default channel group" buckets and the custom Mutiny
  // "With AI Referrals" group (adds the AI Referrals bucket).
  const fallback = {
    'Direct':         'Direct',
    'Organic Search': 'Search',
    'Organic Social': 'Social',
    'Referral':       'Referral',
    'Paid Search':    'Search',
    'Paid Social':    'Social',
    'Email':          'Email',
    'Unassigned':     'Unassigned',
    'AI Referrals':   'AEO',
  };
  return fallback[entry.gaChannelGroup] || 'Unassigned';
}

// Color map. Channel order in the stack (bottom → top) decided alongside
// SIGNUPS_STACK_ORDER below; colors here are the source of truth.
const SIGNUPS_CHANNEL_COLORS = {
  'Direct':     C.lightGrey,
  'Search':     C.blue,
  'Referral':   C.purple,
  'Social':     C.lightPurple,
  'LinkedIn':   C.linkedinBlue,
  'Email':      C.red,
  'Unassigned': '#D5D5D5',
  'AEO':        C.green,
};

// Bottom → top stack order. AEO at the top with hero green so it pops even
// at small values (matches the Channel Mix chart's AI Referrals treatment).
const SIGNUPS_STACK_ORDER = [
  { key: 'Direct',     color: SIGNUPS_CHANNEL_COLORS['Direct'] },
  { key: 'Search',     color: SIGNUPS_CHANNEL_COLORS['Search'] },
  { key: 'Referral',   color: SIGNUPS_CHANNEL_COLORS['Referral'] },
  { key: 'Social',     color: SIGNUPS_CHANNEL_COLORS['Social'] },
  { key: 'LinkedIn',   color: SIGNUPS_CHANNEL_COLORS['LinkedIn'] },
  { key: 'Email',      color: SIGNUPS_CHANNEL_COLORS['Email'] },
  { key: 'Unassigned', color: SIGNUPS_CHANNEL_COLORS['Unassigned'] },
  { key: 'AEO',        color: SIGNUPS_CHANNEL_COLORS['AEO'], hero: true },
];

// Weekly chart data — Mon-Sun weeks, anchored Apr 27 2026, end date rolls
// with each build. Per-week sessions + signups are computed live from
// dataJson.file2 (plg_signup_click events) and dataJson.file3 (all engaged
// sessions), bucketed via bucketSignupEntry.
//
// Note: plg_signup_click events were first reliably captured May 7, 2026 —
// so any week ending before May 7 has session data but ZERO attributed
// signups. File 1 vs File 3 grand totals differ by a handful of sessions
// (GA4 sampling); File 1 is canonical for the KPI, per-channel uses File 3.
function bucketRowFromGA(row) {
  const parts  = String(row.sourceMedium || '').split('/').map((s) => s.trim());
  return bucketSignupEntry({
    source:         parts[0] || '',
    medium:         parts[1] || '',
    gaChannelGroup: row.channelGroup || '',
  });
}
const SIGNUPS_BY_CHANNEL_KEYS = ['Direct','Search','Referral','Social','LinkedIn','Email','Unassigned','AEO'];
// plg_signup_click became reliable on 2026-05-13 (Wednesday). Before that
// the GA4 event was under setup and only intermittently active, so every
// signup-side view (weekly bars, Channel Funnel table, drill-down modal,
// deep-dive cards) only sums events on or after that date.
const ATTRIBUTION_START_YYYYMMDD = '20260513';
const ATTRIBUTION_START_LABEL    = 'May 13, 2026';

// Compute per-week GA channel breakdown for any list of Mon-Sun week objects
// (LIVE_WEEKS for 30d, MTD_WEEKS_LIST for MTD, reportingWeeks for Reporting
// Mode, etc.). Each week needs `dates` (the days summed into bar values)
// plus passthrough labels.
function computeSignupsByChannelGAWeekly(weeks) {
  return weeks.map((w) => {
    const blank = () => Object.fromEntries(SIGNUPS_BY_CHANNEL_KEYS.map((k) => [k, 0]));
    const signups  = blank();
    const sessions = blank();
    // For Reporting Mode the week's `dates` is the clipped (cohort ∩ range)
    // set, falling back to the full Mon-Sun set when datesInRange is absent.
    const dateBag = w.datesInRange || w.dates;
    const weekDates = new Set(dateBag);
    for (const r of dataJson.ga4.file2) {
      if (!weekDates.has(r.date)) continue;
      // Skip pre-attribution dates — plg_signup_click was unreliable before then.
      if (r.date < ATTRIBUTION_START_YYYYMMDD) continue;
      const b = bucketRowFromGA(r);
      signups[b] = (signups[b] || 0) + (r.eventCount || 0);
    }
    for (const r of dataJson.ga4.file3) {
      // Sessions (file3 engagedSessions) come from GA4's normal session-tracking
      // and are reliable across the full window — NOT filtered by attribution
      // start. This keeps Website Visitors and other session-side views intact.
      if (!weekDates.has(r.date)) continue;
      const b = bucketRowFromGA(r);
      sessions[b] = (sessions[b] || 0) + (r.engagedSessions || 0);
    }
    return {
      weekStartLabel: w.weekStartLabel,
      dateRange:      w.dateRange,
      weekStart:      w.weekStart,
      partial:        w.partial,
      signups,
      sessions,
    };
  });
}
const SIGNUPS_BY_CHANNEL_WEEKLY = computeSignupsByChannelGAWeekly(LIVE_WEEKS);

// Compute chart-shaped weekly data for the signups stacked column chart.
// Each row has the channel keys flattened (so Recharts can stack them) plus
// metadata for tooltip/labels. Pre-attribution weeks are kept (as empty bars)
// so the X-axis stays consistent with the other weekly charts on the page.
function computeWeeklyData(source = SIGNUPS_BY_CHANNEL_WEEKLY) {
  return source.map((w) => ({
    week: w.weekStartLabel,
    dateRange: w.dateRange,
    populated: true,
    partial: w.partial,
    Direct: w.signups.Direct,
    Search: w.signups.Search,
    Referral: w.signups.Referral,
    Social: w.signups.Social,
    LinkedIn: w.signups.LinkedIn,
    Email: w.signups.Email,
    Unassigned: w.signups.Unassigned,
    AEO: w.signups.AEO,
    _ghost: 0,
  }));
}

// Compute Sessions → Signups channel table for the conversion window
// (2026-05-07 → end of Last 30 Days). Aggregates raw GA4 rows directly so we
// can slice mid-week without re-bucketing the weekly summary.
function computeChannelTable(startCompact, endCompact) {
  // Default window: from plg_signup_click attribution start through today.
  // Reporting Mode passes (rangeStartCompact, rangeEndCompact) explicitly,
  // intersected with the attribution window below.
  const channels = ['Direct','Search','Referral','LinkedIn','Social','Unassigned','AEO','Email'];
  const sessions = Object.fromEntries(channels.map((c) => [c, 0]));
  const signups  = Object.fromEntries(channels.map((c) => [c, 0]));
  const effectiveStart = startCompact
    ? (startCompact > ATTRIBUTION_START_YYYYMMDD ? startCompact : ATTRIBUTION_START_YYYYMMDD)
    : ATTRIBUTION_START_YYYYMMDD;
  const effectiveEnd = endCompact || LIVE_END_YYYYMMDD;
  const inAttribWindow = (d) => d >= effectiveStart && d <= effectiveEnd;

  for (const r of dataJson.ga4.file2) {
    if (!inAttribWindow(r.date)) continue;
    const b = bucketRowFromGA(r);
    if (b in signups) signups[b] += (r.eventCount || 0);
  }
  for (const r of dataJson.ga4.file3) {
    if (!inAttribWindow(r.date)) continue;
    const b = bucketRowFromGA(r);
    if (b in sessions) sessions[b] += (r.engagedSessions || 0);
  }
  return channels.map((ch) => ({
    channel: ch,
    engagedSessions: sessions[ch],
    signups: signups[ch],
  }));
}

// Compute per-source/medium breakdown WITHIN a single channel bucket — used by
// the row-click drill-down on the Channel Funnel table. Same window rule as
// computeChannelTable (from 2026-05-07, when signup attribution began).
function computeChannelDrillDown(channelName, startCompact, endCompact) {
  // Window matches computeChannelTable: from plg_signup_click attribution
  // start through end; in Reporting Mode the caller passes range bounds.
  const effectiveStart = startCompact
    ? (startCompact > ATTRIBUTION_START_YYYYMMDD ? startCompact : ATTRIBUTION_START_YYYYMMDD)
    : ATTRIBUTION_START_YYYYMMDD;
  const effectiveEnd = endCompact || LIVE_END_YYYYMMDD;
  const inAttribWindow = (d) => d >= effectiveStart && d <= effectiveEnd;
  // Group by SOURCE only (the part before " / " in GA4's sourceMedium).
  // E.g. "google / organic" + "google / cpc" both roll up to "google".
  const sourceOf = (sourceMedium) => {
    const s = String(sourceMedium || '').split('/')[0].trim();
    return s || '(unknown)';
  };
  const bySrc = new Map();
  const ensure = (k) => {
    if (!bySrc.has(k)) {
      bySrc.set(k, { source: k, signups: 0, engagedSessions: 0 });
    }
    return bySrc.get(k);
  };
  for (const r of dataJson.ga4.file2) {
    if (!inAttribWindow(r.date)) continue;
    if (bucketRowFromGA(r) !== channelName) continue;
    ensure(sourceOf(r.sourceMedium)).signups += (r.eventCount || 0);
  }
  for (const r of dataJson.ga4.file3) {
    if (!inAttribWindow(r.date)) continue;
    if (bucketRowFromGA(r) !== channelName) continue;
    ensure(sourceOf(r.sourceMedium)).engagedSessions += (r.engagedSessions || 0);
  }
  return Array.from(bySrc.values()).sort(
    (a, b) => b.signups - a.signups || b.engagedSessions - a.engagedSessions,
  );
}

// Compute a deep-dive weekly array for one or more channel keys.
// Each row has the channel keys flattened on it (so Recharts can render
// either a single bar or a stacked column without code changes), plus the
// usual week metadata. Pass a string for a single channel or an array of
// strings for multiple. Pre-attribution weeks are kept as empty bars for
// X-axis consistency with the other weekly charts.
function computeChannelDeepDive(channelKeys, source = SIGNUPS_BY_CHANNEL_WEEKLY) {
  const keys = Array.isArray(channelKeys) ? channelKeys : [channelKeys];
  return source.map((w) => {
    const row = {
      week: w.weekStartLabel,
      dateRange: w.dateRange,
      populated: true,
      partial: w.partial,
      _ghost: 0,
    };
    for (const k of keys) row[k] = w.signups[k] || 0;
    return row;
  });
}

// Equivalent for engaged sessions — used by the Web stacked column section.
function computeWebSessionsWeekly(source = SIGNUPS_BY_CHANNEL_WEEKLY) {
  return source.map((w) => {
    const row = {
      week: w.weekStartLabel,
      dateRange: w.dateRange,
      populated: true,
      partial: w.partial,
      _ghost: 0,
    };
    for (const k of SIGNUPS_BY_CHANNEL_KEYS) row[k] = w.sessions[k] || 0;
    return row;
  });
}

// ---------------------------------------------------------------------------
// Channel deep-dives. Each declares one OR more channel keys from
// SIGNUPS_BY_CHANNEL_WEEKLY; multiple keys render as a stacked column.
// `accentColor` is used for the right-edge stripe and KPI tile accent.
// ---------------------------------------------------------------------------
const LINKEDIN_DEEP_DIVE = {
  name: 'LinkedIn Signup Attribution',
  subtitle: 'Organic posts and thought leadership',
  iconLabel: 'in',
  iconBg: C.linkedinBlue,
  accentColor: C.linkedinBlue,
  series: [{ key: 'LinkedIn', label: 'LinkedIn', color: C.linkedinBlue }],
};

const AEO_DEEP_DIVE = {
  name: 'AEO + Search Signup Attribution',
  subtitle: 'Signups attributed to AI engines (ChatGPT, Claude, Perplexity, Gemini) and search engines (Google, Bing, DuckDuckGo)',
  iconLabel: 'A',
  iconBg: C.green,
  accentColor: C.green,
  series: [
    { key: 'AEO',    label: 'AEO',    color: C.green },
    { key: 'Search', label: 'Search', color: C.blue  },
  ],
};

// ---------------------------------------------------------------------------
// AEO data (Peec AI) — pulled live by scripts/pull-data.mjs.
// Window: Apr 23 → today (Peec coverage starts earlier than the GA4 anchor).
// Topic IDs and color mapping kept in JSX; everything else comes from data.json.
// Pre-tracking dates render as `null` so the chart shows a gap rather than
// a fake zero baseline.
// ---------------------------------------------------------------------------
const AEO_TOPIC_COLORS = {
  'Competitor Comparisons': C.green,
  'ABM':                    C.purple,
  'Modern GTM tech stack':  C.blue,
  'AI Sales Tools':         C.red,
  'AI Sales Enablement':    C.lightRed,
  'Outbound tools':         C.lightPurple,
};

function buildAEOFromPeec(peec) {
  if (!peec || peec.error) {
    // Fallback empty state — keeps the chart rendering without data instead
    // of throwing. The "Last updated on" header signals staleness.
    return {
      windowLabel: '—', windowDays: 0, visibility: 0, mentionCount: 0, avgPosition: 0,
      competitorRank: null, competitorTotal: 0, topCompetitor: null,
      topics: [], daily: [],
    };
  }

  // Reformat ISO dates ("2026-04-23") to "Apr 23" / "May 7".
  const fmtPeecDate = (iso) => {
    const [, m, d] = iso.split('-').map((x) => parseInt(x, 10));
    return `${MONTH_ABBR[m - 1]} ${d}`;
  };

  // windowDays count
  const days = peec.daily?.length || 0;
  const startLabel = peec.daily?.length ? fmtPeecDate(peec.daily[0].date) : '—';
  const endLabel   = peec.daily?.length ? fmtPeecDate(peec.daily[peec.daily.length - 1].date) : '—';
  const year       = (peec.windowEnd || '').slice(0, 4);

  // Topics — attach color from the name-keyed map, plus a "tracked from <date>"
  // note if any daily row for that topic is null (i.e. tracking started mid-window).
  const topics = (peec.topics || []).map((t) => {
    const firstTrackedDate = (peec.daily || []).find((row) => row[t.name] !== null && row[t.name] !== undefined)?.date;
    const someEarlierAreNull = (peec.daily || []).some((row) => row[t.name] === null);
    const note = someEarlierAreNull && firstTrackedDate
      ? `tracked from ${fmtPeecDate(firstTrackedDate)}`
      : undefined;
    return {
      name:       t.name,
      visibility: t.visibility,
      mentions:   t.mentions,
      responses:  t.responses,
      color:      AEO_TOPIC_COLORS[t.name] || C.lightGrey,
      ...(note ? { note } : {}),
    };
  });

  // Daily rows — reformat dates, keep per-topic columns as-is.
  const daily = (peec.daily || []).map((r) => {
    const out = { date: fmtPeecDate(r.date), rawDate: r.date, visibility: r.visibility };
    for (const t of topics) {
      out[t.name] = r[t.name];
    }
    return out;
  });

  // Sources — daily mutinyhq.com retrieval counts broken down by topic.
  // Shape mirrors the visibility `daily` array so the chart can reuse the
  // same topic-line + legend convention as AEOVisibilityChart.
  const sourcesDaily = (peec.sources?.mutinyhq?.daily || []).map((r) => {
    const out = { date: fmtPeecDate(r.date), rawDate: r.date, Total: r.Total ?? 0 };
    for (const t of topics) {
      out[t.name] = r[t.name];  // null | 0 | number
    }
    return out;
  });

  // Raw daily counts for window-aggregated stats above each chart.
  // brandDailyStats: { date, visCount, visTotal, mentions }
  // sourcesDailyStats: { date, retrievedPct, retrievalRate, citationRate,
  //                      retrievalCount, citationCount }
  const brandDailyStats = (peec.brandDailyStats || []).map((r) => ({
    date: r.date,
    label: fmtPeecDate(r.date),
    visCount: r.visCount,
    visTotal: r.visTotal,
    mentions: r.mentions,
  }));
  const sourcesDailyStats = (peec.sources?.mutinyhq?.dailyStats || []).map((r) => ({
    date: r.date,
    label: fmtPeecDate(r.date),
    retrievedPct:   r.retrievedPct,
    retrievalRate:  r.retrievalRate,
    citationRate:   r.citationRate,
    retrievalCount: r.retrievalCount,
    citationCount:  r.citationCount,
  }));

  return {
    windowLabel:     `${startLabel} – ${endLabel}, ${year}`,
    windowDays:      days,
    visibility:      peec.visibility,
    mentionCount:    peec.mentionCount,
    avgPosition:     peec.avgPosition,
    competitorRank:  peec.competitorRank,
    competitorTotal: peec.competitorTotal,
    topCompetitor:   peec.topCompetitor,
    topics,
    daily,
    sourcesDaily,
    brandDailyStats,
    sourcesDailyStats,
  };
}

const AEO = buildAEOFromPeec(dataJson.peec);

// ---------------------------------------------------------------------------
// Small components
// ---------------------------------------------------------------------------

const Delta = ({ value, suffix = '%', precision = 1, secondary, secondarySuffix = '%', secondaryPrecision = 1 }) => {
  const up = value >= 0;
  const Icon = up ? ArrowUpRight : ArrowDownRight;
  const fmtPrimary = (v) => {
    const n = Number(v);
    if (precision === 0) return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
    return n.toFixed(precision);
  };
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        color: up ? '#117a3d' : '#a8341f',
        fontFamily: FONT_BODY,
        fontWeight: 600,
        fontSize: 14,
        letterSpacing: '-0.01em',
      }}
    >
      <Icon size={14} strokeWidth={2.5} />
      {up ? '+' : ''}{fmtPrimary(value)}{suffix}
      {secondary !== undefined && secondary !== null && Number.isFinite(secondary) && (
        <span style={{ opacity: 0.7, fontWeight: 500, marginLeft: 2, fontSize: 13 }}>
          ({secondary >= 0 ? '+' : ''}{secondary.toFixed(secondaryPrecision)}{secondarySuffix})
        </span>
      )}
    </span>
  );
};

// Inline SVG sparkline for KPI cards — minimal, axis-less daily trend.
// Renders a polyline + soft fill underneath + a dot on "today" so the eye
// finds the end of the series quickly. Designed to be ~180×32px so it
// tucks under the big value without dominating the card.
function Sparkline({ values, color, height = 32, width = 180 }) {
  if (!values || values.length === 0) return null;
  const maxV = Math.max(...values, 0.0001);
  const minV = Math.min(...values, 0);
  const range = (maxV - minV) || 1;
  const stepX = width / Math.max(values.length - 1, 1);
  const coords = values.map((v, i) => {
    const x = i * stepX;
    const y = height - ((v - minV) / range) * (height - 4) - 2;
    return [x, y];
  });
  const linePath = coords
    .map(([x, y], i) => `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`)
    .join(' ');
  const lastIdx = coords.length - 1;
  const areaPath =
    `${linePath} L ${coords[lastIdx][0].toFixed(1)} ${height} L 0 ${height} Z`;
  const [lastX, lastY] = coords[lastIdx];
  return (
    <svg width={width} height={height} style={{ display: 'block' }} aria-hidden="true">
      <path d={areaPath} fill={color} opacity={0.18} />
      <path
        d={linePath}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <circle cx={lastX} cy={lastY} r={2.5} fill={color} stroke={C.white} strokeWidth={1} />
    </svg>
  );
}

const KpiCard = ({
  label,
  value,
  sublabel,
  momNode,
  momLabel = 'MoM',
  sparkline,
  deltaNode,
  deltaLabel,
  dateRangeLabel,
  footnote,
  bgColor,
  accentColor,
  placeholder = false,
}) => {
  // Compact when there's no bottom slot (delta, sparkline, momNode). With a
  // bottom element the card needs more vertical room; otherwise tighten.
  const hasBottomSlot = Boolean(deltaNode || sparkline || momNode);
  return (
  <div
    style={{
      background: bgColor,
      border: `1px solid ${C.black}`,
      borderRadius: 4,
      padding: '12px 16px',
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'space-between',
      minHeight: hasBottomSlot ? 152 : 112,
      position: 'relative',
      opacity: placeholder ? 0.55 : 1,
    }}
  >
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
      <div
        style={{
          fontFamily: FONT_BODY,
          fontWeight: 700,
          fontSize: 11,
          letterSpacing: '0.12em',
          textTransform: 'uppercase',
          color: C.black,
          display: 'flex',
          alignItems: 'center',
        }}
      >
        {label}
        {(sublabel || footnote) && (
          <InfoTooltip width={280}>
            {sublabel && (
              <div style={{ fontWeight: 600, marginBottom: footnote ? 6 : 0 }}>
                {sublabel}
              </div>
            )}
            {footnote && (
              <div style={{ opacity: 0.8 }}>{footnote}</div>
            )}
          </InfoTooltip>
        )}
      </div>
      {placeholder && (
        <span
          style={{
            fontFamily: FONT_CAPTION,
            fontStyle: 'italic',
            fontSize: 11,
            color: C.black,
            background: C.white,
            padding: '2px 8px',
            borderRadius: 999,
            border: `1px solid ${C.black}`,
          }}
        >
          data pending
        </span>
      )}
    </div>

    <div
      style={{
        fontFamily: FONT_DISPLAY,
        fontWeight: 400,
        fontSize: 52,
        lineHeight: 1,
        color: C.black,
        letterSpacing: '-0.03em',
        fontVariantNumeric: 'tabular-nums',
        marginTop: 6,
      }}
    >
      {value}
    </div>
    {dateRangeLabel && (
      <div
        style={{
          fontFamily: FONT_CAPTION,
          fontStyle: 'italic',
          fontSize: 10.5,
          color: C.black,
          opacity: 0.55,
          marginTop: 4,
          letterSpacing: '0.02em',
        }}
      >
        {dateRangeLabel}
      </div>
    )}

    {deltaNode ? (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 14 }}>
        {deltaNode}
        <span
          style={{
            fontFamily: FONT_BODY,
            fontSize: 11,
            color: C.black,
            opacity: 0.6,
            letterSpacing: '0.04em',
          }}
        >
          {deltaLabel || 'vs prior'}
        </span>
      </div>
    ) : sparkline ? (
      <div style={{ marginTop: 14 }}>
        {sparkline}
        <div
          style={{
            fontFamily: FONT_BODY,
            fontSize: 10,
            color: C.black,
            opacity: 0.55,
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
            marginTop: 5,
          }}
        >
          30-day trend
        </div>
      </div>
    ) : momNode ? (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 14 }}>
        {momNode}
        <span
          style={{
            fontFamily: FONT_BODY,
            fontSize: 11,
            color: C.black,
            opacity: 0.6,
            letterSpacing: '0.04em',
          }}
        >
          {momLabel}
        </span>
      </div>
    ) : null}

    <div
      style={{
        position: 'absolute',
        right: -1,
        top: -1,
        width: 8,
        height: 36,
        background: accentColor,
        border: `1px solid ${C.black}`,
      }}
    />
  </div>
  );
};

// ---------------------------------------------------------------------------
// Custom hover tooltip for the pie — shows raw referral_source values
// ---------------------------------------------------------------------------
const PieHoverPanel = ({ slice, total, unit = 'signup' }) => {
  if (!slice) {
    return (
      <div
        style={{
          fontFamily: FONT_CAPTION,
          fontStyle: 'italic',
          fontSize: 13,
          color: C.black,
          opacity: 0.6,
          lineHeight: 1.5,
          padding: '8px 0',
        }}
      >
        Hover a slice to see the raw responses it contains.
      </div>
    );
  }
  const pct = ((slice.value / total) * 100).toFixed(1);
  return (
    <div style={{ fontFamily: FONT_BODY }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 4 }}>
        <div
          style={{
            width: 12,
            height: 12,
            background: slice.color,
            border: `1px solid ${C.black}`,
            alignSelf: 'center',
          }}
        />
        <div
          style={{
            fontFamily: FONT_DISPLAY,
            fontSize: 28,
            letterSpacing: '-0.02em',
            lineHeight: 1,
            color: C.black,
          }}
        >
          {slice.name}
        </div>
      </div>
      <div
        style={{
          fontFamily: FONT_BODY,
          fontSize: 13,
          color: C.black,
          opacity: 0.7,
          marginBottom: 12,
        }}
      >
        {slice.value} {unit}{slice.value === 1 ? '' : 's'} · {pct}% of total
      </div>
      {slice.sources.length === 0 ? (
        <div
          style={{
            fontFamily: FONT_CAPTION,
            fontStyle: 'italic',
            fontSize: 12,
            color: C.black,
            opacity: 0.6,
          }}
        >
          No raw responses bucketed here yet. Consider adding this as an explicit
          option in the onboarding form.
        </div>
      ) : (
        <div>
          <div
            style={{
              fontFamily: FONT_BODY,
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: '0.12em',
              textTransform: 'uppercase',
              color: C.black,
              opacity: 0.55,
              marginBottom: 6,
            }}
          >
            Raw responses ({slice.sources.length})
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {slice.sources.map((s, i) => (
              <span
                key={i}
                style={{
                  fontFamily: FONT_BODY,
                  fontSize: 11,
                  background: C.white,
                  border: `1px solid ${C.black}`,
                  borderRadius: 999,
                  padding: '2px 9px',
                  color: C.black,
                  lineHeight: 1.4,
                  maxWidth: 240,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
                title={s}
              >
                "{s}"
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// VisitorSignupTrend — Visitor → User Signup conversion rate over time, as a
// per-week line (each point = that week's signups ÷ engaged sessions). Fixed
// trailing window, independent of the dashboard toggle. Rows are precomputed
// by the caller: { week, dateRange, ratio, partial, trailingPartial }. Weeks
// with no data render as gaps (connectNulls off). This is a trend view, so it
// is intentionally NOT the same number as the window-aggregate KPI tile.
// ---------------------------------------------------------------------------
function VisitorSignupTrend({
  data,
  dateRangeLabel,
  cadence = 'weekly',
  isReporting = false,
}) {
  const rows = data;
  const vals = rows.map((r) => r.ratio).filter((v) => v != null);
  const maxV = vals.length ? Math.max(...vals) : 1;
  const { ticks, max: yMax } = niceTicks(maxV, 5);

  return (
    <div
      style={{
        background: C.white,
        border: `1px solid ${C.black}`,
        borderRadius: 4,
        padding: '28px 32px 24px',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
        <div>
          <h3 style={{ fontFamily: FONT_DISPLAY, fontWeight: 400, fontSize: 22, letterSpacing: '-0.02em', margin: 0 }}>
            {cadence === 'monthly' ? 'Monthly' : 'Weekly'} visitor conversion rate
          </h3>
          <div style={{ fontFamily: FONT_BODY, fontSize: 11, opacity: 0.6, marginTop: 4 }}>
            Signups ÷ Engaged Sessions · {cadence}
          </div>
          {dateRangeLabel ? (
            <div style={{ fontFamily: FONT_CAPTION, fontStyle: 'italic', fontSize: 10.5, opacity: 0.55, marginTop: 3, letterSpacing: '0.02em' }}>
              {dateRangeLabel}
            </div>
          ) : null}
        </div>
        <div style={{ width: 44, height: 8, background: C.green, border: `1px solid ${C.black}`, flexShrink: 0, marginTop: 6 }} />
      </div>
      <div style={{ height: 320, marginTop: 16 }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={rows} margin={{ top: 12, right: 12, bottom: 8, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.1)" vertical={false} />
            <XAxis
              dataKey="week"
              axisLine={{ stroke: C.black, strokeWidth: 1 }}
              tickLine={false}
              tick={{ fontFamily: FONT_BODY, fontSize: 11, fill: C.black }}
              interval={rows.length > 8 ? 'preserveStartEnd' : 0}
              minTickGap={rows.length > 8 ? 28 : 5}
            />
            <YAxis
              tickFormatter={(v) => `${v}%`}
              axisLine={false}
              tickLine={false}
              tick={{ fontFamily: FONT_BODY, fontSize: 10, fill: C.black, opacity: 0.6 }}
              width={44}
              domain={[0, yMax]}
              ticks={ticks}
            />
            <Tooltip
              cursor={{ stroke: C.black, strokeOpacity: 0.2, strokeWidth: 1 }}
              content={({ active, payload }) => {
                if (!active || !payload || !payload.length) return null;
                const d = payload[0].payload;
                return (
                  <div style={{ background: C.white, border: `1px solid ${C.black}`, borderRadius: 4, padding: '8px 10px', fontFamily: FONT_BODY, fontSize: 12, minWidth: 190, boxShadow: '4px 4px 0 rgba(0,0,0,0.08)' }}>
                    <div style={{ fontWeight: 700, marginBottom: 2 }}>
                      {d.dateRange}
                      {d.trailingPartial ? (isReporting ? ' · clipped to range' : ' · current, in progress') : ''}
                    </div>
                    <div>Visitor → User Signup: <strong>{d.ratio == null ? '—' : `${d.ratio.toFixed(2)}%`}</strong></div>
                    <div style={{ opacity: 0.6, marginTop: 2 }}>
                      {(d.signups ?? 0).toLocaleString()} signups ÷ {(d.sessions ?? 0).toLocaleString()} sessions
                    </div>
                  </div>
                );
              }}
            />
            <Line
              type="monotone"
              dataKey="ratio"
              stroke={C.black}
              strokeWidth={2.5}
              dot={{ r: 3, fill: C.green, stroke: C.black, strokeWidth: 1 }}
              activeDot={{ r: 5, fill: C.green, stroke: C.black, strokeWidth: 1 }}
              connectNulls={false}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <div style={{ fontFamily: FONT_BODY, fontSize: 10.5, opacity: 0.55, marginTop: 12, lineHeight: 1.5 }}>
        Cross-system ratio: Amplitude completed user signups ÷ GA4 engaged sessions — directional only.
        Each point is <strong>that {cadence === 'monthly' ? 'month' : "week"}'s own</strong> signups ÷
        sessions (not cumulative) — so it reads as a trend. {cadence === 'monthly'
          ? 'Complete calendar months (Jan → last complete month); the in-progress month is excluded.'
          : `Complete Mon–Sun weeks only over a fixed trailing ${RATIO_TREND_WEEKS} weeks; the in-progress week is excluded.`}
        {' '}The KPI tile above is the full-window rate, so it won't equal any single {cadence === 'monthly' ? 'month' : 'week'} here.
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// TopOfFunnelTrend — three single-axis bar charts answering "how is the top
// of the funnel trending week-over-week?" Columns: Signups, Engaged Sessions,
// Sales Meetings Requested. Each chart owns its own y-axis — no dual-axis
// encoding tricks, no derived metrics overlaid.
//
// Partial-week handling: the current week (Wk 3) is rendered with a diagonal
// hatch pattern in all three charts. A footnote spells out the partial-week
// caveat so Wk 3 isn't mis-read as a step-down.
// ---------------------------------------------------------------------------
function TopOfFunnelTrend({
  data,
  weeklyData,
  mode = 'weekly',
  footnoteOverride,
  dateRangeLabel,
  weeklyDateRangeLabel,
  // Controls which BarPanels to render. Default is the original two
  // (Signups + Sales Meetings Requested). Passing `['meetings']` renders
  // only the Sales Meetings chart — used when relocating it below the
  // Signups by Channel card.
  chartKeys = ['signups', 'meetings'],
  // When this is the only chart in a non-"Top of funnel" context, hide
  // the section eyebrow.
  showEyebrow = true,
  // In Reporting Mode partial bars are edge-clipped, not in-progress.
  isReporting = false,
  // Suppress the trailing footnote entirely (and the surrounding margin).
  hideFootnote = false,
}) {
  // When `weeklyData` is provided alongside `data`, each chart gets its own
  // Daily/Weekly toggle in the card header. Used by the Last 30 days view
  // mode so users can flip Signups and Sales Meetings between granularities
  // independently. When omitted, the section is single-granularity (4w/YTD).
  const hasPerChartToggle = Boolean(weeklyData);
  // When per-chart toggle is on, default both charts to whatever `mode` is
  // passed in (parent picks 'weekly' for 30d/MTD per design call).
  const [granularity, setGranularity] = useState({
    signups:  hasPerChartToggle ? mode : mode,
    meetings: hasPerChartToggle ? mode : mode,
  });
  const resolveData = (key) =>
    hasPerChartToggle && granularity[key] === 'weekly' ? weeklyData : data;
  const resolveIsDaily = (key) =>
    hasPerChartToggle ? granularity[key] === 'daily' : mode === 'daily';
  const setGranularityFor = (key, value) =>
    setGranularity((g) => ({ ...g, [key]: value }));

  // For the eyebrow + footnote when there's no per-chart toggle.
  const isDaily = mode === 'daily';

  // Recharts custom Bar shape that swaps in a hatched fill for partial weeks.
  const HatchedBar = (color) => (props) => {
    const { x, y, width, height, payload } = props;
    if (!payload || height <= 0) return null;
    const isPartial = payload.partial;
    const patternId = `hatch-${color.replace('#','')}-${(payload.week || '').replace(/[^a-zA-Z0-9]/g,'')}`;
    return (
      <g>
        {isPartial && (
          <defs>
            <pattern id={patternId} patternUnits="userSpaceOnUse" width="6" height="6" patternTransform="rotate(45)">
              <rect width="6" height="6" fill={color} fillOpacity="0.25" />
              <line x1="0" y1="0" x2="0" y2="6" stroke={color} strokeWidth="2" />
            </pattern>
          </defs>
        )}
        <rect
          x={x}
          y={y}
          width={width}
          height={height}
          fill={isPartial ? `url(#${patternId})` : color}
          stroke={C.black}
          strokeWidth={1}
        />
      </g>
    );
  };

  // Custom tooltip for the bar charts
  const BarTooltip = (metricLabel, formatter) => ({ active, payload }) => {
    if (!active || !payload || !payload.length) return null;
    const d = payload[0].payload;
    return (
      <div
        style={{
          background: C.white,
          border: `1px solid ${C.black}`,
          padding: '8px 10px',
          fontFamily: FONT_BODY,
          fontSize: 12,
        }}
      >
        <div style={{ fontWeight: 700, marginBottom: 2 }}>
          {d.dateRange}
          {d.trailingPartial ? (isReporting ? ' · clipped to range' : ' · current week, in progress') : ''}
        </div>
        <div>{metricLabel}: <strong>{formatter(d)}</strong></div>
      </div>
    );
  };

  // Reusable card-shaped bar chart panel
  const BarPanel = ({ title, source, dataKey, color, format, chartKey }) => {
    const panelData   = resolveData(chartKey);
    const panelIsDaily = resolveIsDaily(chartKey);
    return (
      <div
        style={{
          background: C.white,
          border: `1px solid ${C.black}`,
          borderRadius: 4,
          padding: '28px 32px 24px',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
          <div>
            <h3 style={{ fontFamily: FONT_DISPLAY, fontWeight: 400, fontSize: 22, letterSpacing: '-0.02em', margin: 0 }}>
              {title}
            </h3>
            <div style={{ fontFamily: FONT_BODY, fontSize: 11, opacity: 0.6, marginTop: 4 }}>
              {source} · {panelIsDaily ? 'daily' : 'weekly'}
            </div>
            {(() => {
              const lbl = !panelIsDaily && weeklyDateRangeLabel
                ? weeklyDateRangeLabel
                : dateRangeLabel;
              return lbl ? (
                <div
                  style={{
                    fontFamily: FONT_CAPTION,
                    fontStyle: 'italic',
                    fontSize: 10.5,
                    opacity: 0.55,
                    marginTop: 3,
                    letterSpacing: '0.02em',
                  }}
                >
                  {lbl}
                </div>
              ) : null;
            })()}
          </div>
          {hasPerChartToggle && (
            <div
              style={{
                display: 'inline-flex',
                border: `1px solid ${C.black}`,
                borderRadius: 999,
                overflow: 'hidden',
                fontFamily: FONT_BODY,
                fontSize: 10.5,
                fontWeight: 600,
                flexShrink: 0,
              }}
            >
              {[
                { id: 'daily',  label: 'Daily'  },
                { id: 'weekly', label: 'Weekly' },
              ].map((opt) => {
                const active = granularity[chartKey] === opt.id;
                return (
                  <button
                    key={opt.id}
                    onClick={() => setGranularityFor(chartKey, opt.id)}
                    style={{
                      padding: '3px 10px',
                      background: active ? C.black : 'transparent',
                      color: active ? C.white : C.black,
                      border: 'none',
                      cursor: active ? 'default' : 'pointer',
                      fontFamily: FONT_BODY,
                      fontSize: 10.5,
                      fontWeight: 600,
                      letterSpacing: '0.04em',
                    }}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
          )}
        </div>
        <div style={{ height: 320, marginTop: 16 }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={panelData} margin={{ top: 12, right: 8, bottom: 8, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.1)" vertical={false} />
              <XAxis
                dataKey="week"
                axisLine={{ stroke: C.black, strokeWidth: 1 }}
                tickLine={false}
                tick={{ fontFamily: FONT_BODY, fontSize: panelIsDaily ? 9 : 11, fill: C.black }}
                // Auto-thin tick labels when the dataset is dense (YTD weekly
                // = ~20 bars; daily = ~30 bars). For shorter weekly series
                // (4w, 30d-bucketed = 5 bars) show every tick.
                interval={
                  panelIsDaily || panelData.length > 8 ? 'preserveStartEnd' : 0
                }
                minTickGap={
                  panelIsDaily ? 12 : panelData.length > 8 ? 28 : 5
                }
              />
              {(() => {
                const max = Math.max(...panelData.map((d) => d[dataKey] || 0), 1);
                const { ticks, max: yMax } = niceTicks(max, 5);
                return (
                  <YAxis
                    tickFormatter={format}
                    axisLine={false}
                    tickLine={false}
                    tick={{ fontFamily: FONT_BODY, fontSize: 10, fill: C.black, opacity: 0.6 }}
                    width={40}
                    domain={[0, yMax]}
                    ticks={ticks}
                    allowDecimals={false}
                  />
                );
              })()}
              <Tooltip
                content={BarTooltip(title, (d) => format ? format(d[dataKey]) : d[dataKey].toLocaleString())}
                cursor={{ fill: 'rgba(0,0,0,0.04)' }}
              />
              <Bar
                dataKey={dataKey}
                shape={HatchedBar(color)}
                maxBarSize={60}
                isAnimationActive={false}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    );
  };

  // Available panel specs keyed by chartKey. Only the ones in `chartKeys`
  // are rendered. When only one is rendered, the grid collapses to a
  // single column (full width of the wrapping container).
  const PANEL_SPECS = {
    signups: {
      chartKey: 'signups',
      title:    'Signups',
      source:   'Amplitude',
      dataKey:  'signups',
      color:    C.purple,
    },
    meetings: {
      chartKey: 'meetings',
      title:    'Sales Meetings Requested',
      source:   'HubSpot',
      dataKey:  'meetings',
      color:    C.red,
    },
  };
  const panelsToRender = chartKeys.map((k) => PANEL_SPECS[k]).filter(Boolean);

  return (
    <section style={{ marginBottom: 40 }}>
      {/* Eyebrow */}
      {showEyebrow && (
        <div
          style={{
            fontFamily: FONT_BODY,
            fontWeight: 700,
            fontSize: 11,
            letterSpacing: '0.18em',
            textTransform: 'uppercase',
            opacity: 0.7,
            marginBottom: 8,
            display: 'flex',
            alignItems: 'center',
            gap: 10,
          }}
        >
          <span>
            Top of funnel{hasPerChartToggle ? '' : isDaily ? ' · daily trend' : ' · weekly trend'}
          </span>
          <span style={{ flex: 1, height: 1, background: 'rgba(0,0,0,0.15)' }} />
        </div>
      )}

      {/* Side-by-side bar charts (or single, depending on chartKeys) */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: `repeat(${panelsToRender.length}, 1fr)`,
          gap: 20,
        }}
      >
        {panelsToRender.map((spec) => (
          <BarPanel key={spec.chartKey} {...spec} />
        ))}
      </div>

      {/* Footnote — adapts to mode. Omitted entirely when hideFootnote. */}
      {!hideFootnote && (
        <div
          style={{
            fontFamily: FONT_CAPTION,
            fontStyle: 'italic',
            fontSize: 11,
            opacity: 0.6,
            marginTop: 10,
            lineHeight: 1.5,
          }}
        >
          {footnoteOverride ? (
            footnoteOverride
          ) : hasPerChartToggle ? (
            <>
              * Each chart covers the strict <strong>Last 30 days</strong>. Toggle each between
              Daily and Weekly to compare granularities — bars sum to the same KPI total either
              way. In weekly, leading/trailing bars may be partial where the 30-day window
              clips a week; the current in-progress week is hatched.
            </>
          ) : isDaily ? (
            <>
              * Daily bars cover the strict <strong>Last 30 days</strong> window. Sum of bars equals
              the KPI total above. Today's bar reflects events received so far — late-arriving
              events may nudge it as the day progresses.
            </>
          ) : (
            <>
              * Bars are <strong>Mon–Sun</strong> weeks. Sum of bars equals the KPI total above.
            </>
          )}
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// SelfReportedPieCard — reusable card for self-reported source breakdowns.
// Used for both "Customer signups by channel" (Amplitude) and "Sales meeting
// requests by channel" (HubSpot). Each card owns its hover state. Layout:
// header → [pie on left | legend on right] → responses panel below.
// ---------------------------------------------------------------------------
function SelfReportedPieCard({
  eyebrow,
  title,
  source,
  data,
  total,
  totalLabel,
  unit,
  infoTooltip,
  dataStartNote,
  alertBanner,
  dateRangeLabel,
}) {
  const [activeSlice, setActiveSlice] = useState(null);
  const populated = data.filter((s) => s.value > 0);
  return (
    <section
      style={{
        background: C.white,
        border: `1px solid ${C.black}`,
        borderRadius: 4,
        padding: '28px 32px',
        position: 'relative',
      }}
    >
      {/* Optional data-availability ribbon (e.g. "data starts May 4") */}
      {alertBanner && (
        <div
          style={{
            margin: '-28px -32px 22px',
            padding: '12px 22px',
            background: '#FFF6D6',
            borderBottom: `1px solid ${C.black}`,
            borderTopLeftRadius: 4,
            borderTopRightRadius: 4,
            fontFamily: FONT_BODY,
            fontSize: 12.5,
            lineHeight: 1.55,
            display: 'flex',
            alignItems: 'flex-start',
            gap: 10,
          }}
        >
          <span style={{ fontSize: 14, lineHeight: 1, marginTop: 1 }}>⚠️</span>
          <div>{alertBanner}</div>
        </div>
      )}

      {/* Header */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          marginBottom: 6,
          gap: 12,
        }}
      >
        <div>
          <div
            style={{
              fontFamily: FONT_BODY,
              fontWeight: 700,
              fontSize: 11,
              letterSpacing: '0.12em',
              textTransform: 'uppercase',
            }}
          >
            {eyebrow}
          </div>
          <h2
            style={{
              fontFamily: FONT_DISPLAY,
              fontWeight: 400,
              fontSize: 28,
              lineHeight: 1.05,
              letterSpacing: '-0.03em',
              margin: '6px 0 0',
              display: 'flex',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: 10,
            }}
          >
            {title}
            <SelfReportedTag />
            <InfoTooltip>{infoTooltip}</InfoTooltip>
          </h2>
        </div>
        <div
          style={{
            fontFamily: FONT_BODY,
            fontSize: 11,
            opacity: 0.6,
            letterSpacing: '0.04em',
            flexShrink: 0,
          }}
        >
          Source: {source}
          {dateRangeLabel && (
            <div style={{ marginTop: 4, fontStyle: 'italic', fontSize: 10.5, opacity: 0.6 }}>
              {dateRangeLabel}
            </div>
          )}
          {dataStartNote ? (
            <div style={{ marginTop: 4, fontStyle: 'italic', fontSize: 10, opacity: 0.7 }}>
              {dataStartNote}
            </div>
          ) : null}
        </div>
      </div>

      {/* Pie on left | Legend on right */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '260px 1fr',
          gap: 28,
          alignItems: 'center',
          marginTop: 16,
        }}
      >
        {/* Pie */}
        <div style={{ height: 320, position: 'relative' }}>
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={populated}
                dataKey="value"
                nameKey="name"
                cx="50%"
                cy="50%"
                innerRadius={55}
                outerRadius={110}
                paddingAngle={2}
                stroke={C.black}
                strokeWidth={1.5}
                onMouseEnter={(d) => setActiveSlice(d)}
                onMouseLeave={() => setActiveSlice(null)}
                isAnimationActive={false}
              >
                {populated.map((entry, i) => (
                  <Cell
                    key={i}
                    fill={entry.color}
                    style={{
                      cursor: 'pointer',
                      outline: 'none',
                      transition: 'opacity 0.15s',
                      opacity:
                        activeSlice && activeSlice.name !== entry.name ? 0.35 : 1,
                    }}
                  />
                ))}
              </Pie>
            </PieChart>
          </ResponsiveContainer>
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              pointerEvents: 'none',
            }}
          >
            <div
              style={{
                fontFamily: FONT_DISPLAY,
                fontSize: 40,
                lineHeight: 1,
                letterSpacing: '-0.03em',
              }}
            >
              {total}
            </div>
            <div
              style={{
                fontFamily: FONT_CAPTION,
                fontStyle: 'italic',
                fontSize: 11,
                opacity: 0.65,
                marginTop: 4,
              }}
            >
              {totalLabel}
            </div>
          </div>
        </div>

        {/* Legend */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
          }}
        >
          {data.map((s) => {
            const pct = ((s.value / total) * 100).toFixed(0);
            const dim =
              activeSlice && activeSlice.name !== s.name ? 0.4 : 1;
            return (
              <div
                key={s.name}
                onMouseEnter={() => s.value > 0 && setActiveSlice(s)}
                onMouseLeave={() => setActiveSlice(null)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  fontFamily: FONT_BODY,
                  fontSize: 13,
                  opacity: s.value === 0 ? 0.4 : dim,
                  cursor: s.value > 0 ? 'pointer' : 'default',
                  transition: 'opacity 0.15s',
                }}
              >
                <div
                  style={{
                    width: 12,
                    height: 12,
                    background: s.color,
                    border: `1px solid ${C.black}`,
                    flexShrink: 0,
                  }}
                />
                <span style={{ fontWeight: 600 }}>{s.name}</span>
                <span
                  style={{
                    marginLeft: 'auto',
                    opacity: 0.65,
                    fontVariantNumeric: 'tabular-nums',
                  }}
                >
                  {s.value} · {pct}%
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Floating hover overlay — appears only while a slice/legend row is
          hovered. Sits inside the card's relative-positioned shell so it
          doesn't blow out of the layout. Replaces the prior fixed-height
          panel below the pie. */}
      {activeSlice && (
        <div
          style={{
            position: 'absolute',
            left: 16,
            right: 16,
            bottom: 16,
            background: C.white,
            border: `1px solid ${C.black}`,
            borderRadius: 4,
            padding: '14px 16px',
            boxShadow: '2px 2px 0 rgba(0,0,0,0.08)',
            pointerEvents: 'none',
            zIndex: 5,
          }}
        >
          <PieHoverPanel slice={activeSlice} total={total} unit={unit} />
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// SelfReportedWeeklyCard — replaces the Customer signups pie with a weekly
// stacked column chart broken out by referral_source bucket. Uses the same
// outer chrome (eyebrow + title + Self-reported tag + Source pill + alert
// banner) as SelfReportedPieCard so the two cards sit visually balanced
// side-by-side. Mirrors the Top-of-Funnel Signups bar's weekly logic:
//   30d  → LIVE_WEEKS (full Mon-Sun weeks, trailing partial hatched)
//   MTD  → MTD_WEEKS_LIST
//   YTD  → YTD_MONTHS_LIST (monthly bars)
//
// The residual (total − categorized referral buckets) sits at the base of the
// stack, split at the May 7, 2026 cutoff: "Not Specified" before it (when
// referral_source was optional, so a missing source is unknown) and
// "Invited / Referred" on/after it (joined via invitation / registration;
// only Company Setup Complete carries a referral_source).
// ---------------------------------------------------------------------------
function SelfReportedWeeklyCard({
  eyebrow,
  title,
  source,
  data,
  total,
  unit,
  infoTooltip,
  alertBanner,
  dateRangeLabel,
  dateSet,
  // When true, partial bars are edge-clipped to a custom range rather than
  // current-week in-progress; tooltip wording adapts.
  isReporting = false,
}) {
  // ── State ──────────────────────────────────────────────────────────────
  //   visible        — { bucketName: bool }, all on by default
  //   detailsOpen    — modal open/closed
  //   hoveredBucket  — modal hover state (toggle/legend chip → show responses)
  //   selectedWeek   — modal click state (clicking a column scopes responses
  //                    to just that week's dates)
  const [visible, setVisible] = useState(
    () => Object.fromEntries(SIGNUPS_CHANNEL_BUCKETS.map((b) => [b.name, true]))
  );
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [hoveredBucket, setHoveredBucket] = useState(null);
  const [selectedWeek, setSelectedWeek] = useState(null);
  // Modal-only: set of bucket names whose raw responses are "pinned" into
  // the responses panel. Clicking a chip in the modal toggles its bucket in
  // this set (multi-select). Does NOT affect chart bar visibility — for
  // that, see `visible` (controlled only by the card's chip clicks).
  const [selectedResponseBuckets, setSelectedResponseBuckets] = useState(() => new Set());
  // Chart mode — 3-state segmented control:
  //   'summary' — single bar per week (total signups). Default.
  //   'stacked' — stacked bars by referral_source bucket.
  //   'percent' — line chart of each bucket's share of weekly signups (%).
  const [chartMode, setChartMode] = useState('summary');
  const summary = chartMode === 'summary';
  const percent = chartMode === 'percent';

  // Per-bucket sources scoped to an arbitrary dateSet (returns
  // [{source, count}] sorted by count desc, plus a notSpecCount for the
  // residual bucket). Used for both window-wide and per-week response lookup.
  function buildBucketSources(dateScope) {
    const byBucket = Object.fromEntries(BUCKET_DEFINITIONS.map((b) => [b.name, []]));
    for (const entry of (dataJson.amplitude?.referralSources || [])) {
      const bucket = categorizeReferralSource(entry.source);
      if (!byBucket[bucket]) continue;
      const count = dateScope ? sourceWindowCount(entry, dateScope) : (entry.count || 0);
      if (count > 0) byBucket[bucket].push({ source: entry.source, count });
    }
    for (const k of Object.keys(byBucket)) {
      byBucket[k].sort((a, b) => b.count - a.count);
    }
    // Invited / Referred residual = total signups − sum of categorized per date.
    let nsCount = 0;
    if (dateScope) {
      const dateArr = Array.isArray(dateScope) ? dateScope : Array.from(dateScope);
      for (const d of dateArr) {
        const tot = LIVE_SIGNUPS_BY_DATE[d] || 0;
        let cat = 0;
        for (const entry of (dataJson.amplitude?.referralSources || [])) {
          if (entry.daily?.[d]) cat += entry.daily[d];
        }
        nsCount += Math.max(0, tot - cat);
      }
    }
    return { byBucket, nsCount };
  }

  // Window-wide detailed buckets (used when no week is selected in the modal).
  const detailedBuckets = buildBucketSources(dateSet).byBucket;

  // Per-selected-week detailed buckets (computed only when a week is selected
  // to keep the no-selection path light).
  const selectedRow = selectedWeek
    ? data.find((r) => r.week === selectedWeek)
    : null;
  const selectedWeekSources = selectedRow
    ? buildBucketSources(selectedRow.dates || [])
    : null;

  // Per-bucket window totals (raw integer sums from the bucket counts).
  const totals = Object.fromEntries(
    SIGNUPS_CHANNEL_BUCKETS.map((b) => [
      b.name,
      data.reduce((s, r) => s + (r[b.name] || 0), 0),
    ])
  );
  // Y-axis scales to the *visible* stack (in breakdown) or row.total (in
  // summary) so toggling off big buckets lets the smaller ones fill the chart.
  const visibleBuckets = SIGNUPS_CHANNEL_BUCKETS.filter((b) => visible[b.name]);
  const maxValue = summary
    ? Math.max(...data.map((r) => r.total || 0), 1)
    : Math.max(
        ...data.map((r) =>
          visibleBuckets.reduce((s, b) => s + (r[b.name] || 0), 0)
        ),
        1
      );
  const { ticks: yTicks, max: yMax } = niceTicks(maxValue, 5);
  // Two distinct, both-valid window totals:
  //   summaryTotal = Σ daily-uniques (matches the Signups KPI / Top of Funnel)
  //   bucketsTotal = Σ per-source-uniques + Invited / Referred residual
  // They can differ when a user touches multiple referral_source values in
  // the window (Amplitude counts them in each bucket they appeared in).
  const summaryTotal = data.reduce((s, r) => s + (r.total || 0), 0);
  const bucketsTotal = SIGNUPS_CHANNEL_BUCKETS.reduce((s, b) => s + (totals[b.name] || 0), 0);
  const visibleTotal = visibleBuckets.reduce((s, b) => s + (totals[b.name] || 0), 0);
  // Number shown in the card header — the sum the user reads off the chart.
  const displayedTotal = summary ? summaryTotal : visibleTotal;

  function toggleBucket(name) {
    setVisible((v) => ({ ...v, [name]: !v[name] }));
  }
  function allOn()  { setVisible(Object.fromEntries(SIGNUPS_CHANNEL_BUCKETS.map((b) => [b.name, true]))); }
  function allOff() { setVisible(Object.fromEntries(SIGNUPS_CHANNEL_BUCKETS.map((b) => [b.name, false]))); }
  function closeModal() {
    setDetailsOpen(false);
    setHoveredBucket(null);
    setSelectedWeek(null);
    setSelectedResponseBuckets(new Set());
  }
  function togglePinnedBucket(name) {
    setSelectedResponseBuckets((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  // Hatched fill helper. In the modal, dims any non-selected week when
  // `selectedWeek` is set, so the clicked column visually pops.
  const HatchedStack = (color, opts = {}) => (props) => {
    const { x, y, width, height, payload, dataKey } = props;
    if (!payload || height <= 0) return null;
    const isPartial = payload.partial;
    const dimmed = opts.selectedWeek && payload.week !== opts.selectedWeek;
    const patternId =
      `hatchpie-${String(dataKey).replace(/[^a-zA-Z0-9]/g, '')}-${(payload.week || '').replace(/[^a-zA-Z0-9]/g, '')}-${opts.scope || 'card'}`;
    return (
      <g style={{ opacity: dimmed ? 0.3 : 1, transition: 'opacity 0.15s' }}>
        {isPartial && (
          <defs>
            <pattern id={patternId} patternUnits="userSpaceOnUse" width="6" height="6" patternTransform="rotate(45)">
              <rect width="6" height="6" fill={color} fillOpacity="0.25" />
              <line x1="0" y1="0" x2="0" y2="6" stroke={color} strokeWidth="2" />
            </pattern>
          </defs>
        )}
        <rect
          x={x}
          y={y}
          width={width}
          height={height}
          fill={isPartial ? `url(#${patternId})` : color}
          stroke={C.black}
          strokeWidth={1}
        />
      </g>
    );
  };

  // ── Chart helper. Renders the chart for both the card and the modal,
  //    branching on chartMode: 'summary' (single bar), 'stacked' (stacked
  //    bars), or 'percent' (line chart of each bucket's share %).
  function renderChart({ height, interactive, scope }) {
    const onBarClick = interactive
      ? (payload) => {
          if (!payload) return;
          const wk = payload.activeLabel ?? payload.week;
          if (!wk) return;
          setSelectedWeek((cur) => (cur === wk ? null : wk));
        }
      : undefined;

    // Pre-compute %-of-row-total per bucket per row (only used in percent mode).
    const percentData = data.map((row) => {
      const denom = row.total || 0;
      const out = { ...row };
      for (const b of SIGNUPS_CHANNEL_BUCKETS) {
        out[`__pct_${b.name}`] = denom > 0 ? ((row[b.name] || 0) / denom) * 100 : 0;
      }
      return out;
    });
    // Percent y-axis bound — auto-scale, min cap 50%, max cap 100%.
    const maxPercent = percent
      ? Math.max(
          ...percentData.flatMap((r) =>
            visibleBuckets.map((b) => r[`__pct_${b.name}`] || 0),
          ),
          10,
        )
      : 0;
    const pctMax = percent ? Math.min(100, Math.max(50, Math.ceil(maxPercent / 10) * 10 + 10)) : 0;
    const pctTicks = percent
      ? Array.from({ length: 6 }, (_, i) => Math.round((pctMax / 5) * i))
      : [];

    return (
      <div>
        <div style={{ width: '100%', height }}>
          <ResponsiveContainer width="100%" height="100%">
            {percent ? (
              <LineChart
                data={percentData}
                margin={{ top: 8, right: 16, bottom: 8, left: 0 }}
                onClick={onBarClick}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.1)" vertical={false} />
                <XAxis
                  dataKey="week"
                  axisLine={{ stroke: C.black, strokeWidth: 1 }}
                  tickLine={false}
                  tick={{ fontFamily: FONT_BODY, fontSize: 11, fill: C.black }}
                  interval={0}
                />
                <YAxis
                  axisLine={false}
                  tickLine={false}
                  tick={{ fontFamily: FONT_BODY, fontSize: 10, fill: C.black, opacity: 0.6 }}
                  width={44}
                  domain={[0, pctMax]}
                  ticks={pctTicks}
                  tickFormatter={(v) => `${v}%`}
                  allowDecimals={false}
                />
                <Tooltip
                  content={({ active, payload }) => {
                    if (!active || !payload || !payload.length) return null;
                    const d = payload[0].payload;
                    const rows = visibleBuckets
                      .map((b) => ({
                        ...b,
                        v:   d[b.name] || 0,
                        pct: d[`__pct_${b.name}`] || 0,
                      }))
                      .filter((r) => r.v > 0)
                      .sort((a, b) => b.pct - a.pct);
                    return (
                      <div
                        style={{
                          background: C.white,
                          border: `1px solid ${C.black}`,
                          padding: '10px 12px',
                          fontFamily: FONT_BODY,
                          fontSize: 12,
                          minWidth: 240,
                        }}
                      >
                        <div style={{ fontWeight: 700, marginBottom: 6 }}>
                          {d.dateRange}{d.partial ? (isReporting ? ' · clipped to range' : ' · in progress') : ''}
                          {interactive && (
                            <span style={{ fontWeight: 400, opacity: 0.6, marginLeft: 6 }}>
                              (click to select)
                            </span>
                          )}
                        </div>
                        {rows.length === 0 ? (
                          <div style={{ opacity: 0.6, fontStyle: 'italic' }}>No data</div>
                        ) : rows.map((r) => (
                          <div
                            key={r.name}
                            style={{ display: 'flex', justifyContent: 'space-between', gap: 14 }}
                          >
                            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              <span style={{
                                display: 'inline-block', width: 8, height: 8, background: r.color,
                                border: `1px solid ${C.black}`,
                              }} />
                              {r.name}
                            </span>
                            <strong style={{ fontVariantNumeric: 'tabular-nums' }}>
                              {r.pct.toFixed(1)}%
                              <span style={{ fontWeight: 400, opacity: 0.6, marginLeft: 4 }}>
                                · {Math.round(r.v)}
                              </span>
                            </strong>
                          </div>
                        ))}
                        <div
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            borderTop: '1px solid rgba(0,0,0,0.1)',
                            marginTop: 6,
                            paddingTop: 6,
                          }}
                        >
                          <span>Total signups</span>
                          <strong style={{ fontVariantNumeric: 'tabular-nums' }}>
                            {Math.round(d.total || 0)}
                          </strong>
                        </div>
                      </div>
                    );
                  }}
                  cursor={{ stroke: 'rgba(0,0,0,0.15)', strokeWidth: 1 }}
                />
                {SIGNUPS_CHANNEL_STACK.filter((b) => visible[b.name]).map((b) => (
                  <Line
                    key={b.name}
                    type="monotone"
                    dataKey={`__pct_${b.name}`}
                    stroke={b.color}
                    strokeWidth={2}
                    dot={{ r: 3, fill: b.color, stroke: C.black, strokeWidth: 1 }}
                    activeDot={{ r: 5, fill: b.color, stroke: C.black, strokeWidth: 1.5 }}
                    isAnimationActive={false}
                  />
                ))}
              </LineChart>
            ) : (
            <BarChart
              data={data}
              margin={{ top: 8, right: 8, bottom: 8, left: 0 }}
              onClick={onBarClick}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.1)" vertical={false} />
              <XAxis
                dataKey="week"
                axisLine={{ stroke: C.black, strokeWidth: 1 }}
                tickLine={false}
                tick={{ fontFamily: FONT_BODY, fontSize: 11, fill: C.black }}
                interval={0}
              />
              <YAxis
                axisLine={false}
                tickLine={false}
                tick={{ fontFamily: FONT_BODY, fontSize: 10, fill: C.black, opacity: 0.6 }}
                width={40}
                domain={[0, yMax]}
                ticks={yTicks}
                allowDecimals={false}
              />
              <Tooltip
                content={({ active, payload }) => {
                  if (!active || !payload || !payload.length) return null;
                  const d = payload[0].payload;
                  // Summary mode: just show the total signups for the period.
                  if (summary) {
                    return (
                      <div
                        style={{
                          background: C.white,
                          border: `1px solid ${C.black}`,
                          padding: '10px 12px',
                          fontFamily: FONT_BODY,
                          fontSize: 12,
                          minWidth: 170,
                        }}
                      >
                        <div style={{ fontWeight: 700, marginBottom: 4 }}>
                          {d.dateRange}{d.partial ? (isReporting ? ' · clipped to range' : ' · in progress') : ''}
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 14 }}>
                          <span>Signups</span>
                          <strong style={{ fontVariantNumeric: 'tabular-nums' }}>
                            {Math.round(d.total || 0)}
                          </strong>
                        </div>
                      </div>
                    );
                  }
                  // Breakdown mode: per-bucket rows, sorted desc, with %s.
                  const rows = visibleBuckets
                    .map((b) => ({ ...b, v: d[b.name] || 0 }))
                    .filter((r) => r.v > 0)
                    .sort((a, b) => b.v - a.v);
                  const tot = rows.reduce((s, r) => s + r.v, 0);
                  return (
                    <div
                      style={{
                        background: C.white,
                        border: `1px solid ${C.black}`,
                        padding: '10px 12px',
                        fontFamily: FONT_BODY,
                        fontSize: 12,
                        minWidth: 240,
                      }}
                    >
                      <div style={{ fontWeight: 700, marginBottom: 6 }}>
                        {d.dateRange}{d.partial ? (isReporting ? ' · clipped to range' : ' · in progress') : ''}
                        {interactive && (
                          <span style={{ fontWeight: 400, opacity: 0.6, marginLeft: 6 }}>
                            (click to select)
                          </span>
                        )}
                      </div>
                      {rows.map((r) => {
                        const pct = tot > 0 ? (r.v / tot) * 100 : 0;
                        return (
                          <div
                            key={r.name}
                            style={{ display: 'flex', justifyContent: 'space-between', gap: 14 }}
                          >
                            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              <span style={{
                                display: 'inline-block', width: 8, height: 8, background: r.color,
                                border: `1px solid ${C.black}`,
                              }} />
                              {r.name}
                            </span>
                            <strong style={{ fontVariantNumeric: 'tabular-nums' }}>
                              {r.v} · {pct.toFixed(1)}%
                            </strong>
                          </div>
                        );
                      })}
                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          borderTop: '1px solid rgba(0,0,0,0.1)',
                          marginTop: 6,
                          paddingTop: 6,
                        }}
                      >
                        <span>Total{visibleBuckets.length < SIGNUPS_CHANNEL_BUCKETS.length ? ' (shown)' : ''}</span>
                        <strong style={{ fontVariantNumeric: 'tabular-nums' }}>{tot}</strong>
                      </div>
                    </div>
                  );
                }}
                cursor={{ fill: 'rgba(0,0,0,0.04)' }}
              />
              {summary ? (
                <Bar
                  dataKey="total"
                  shape={HatchedStack(C.purple, {
                    selectedWeek: interactive ? selectedWeek : null,
                    scope,
                  })}
                  maxBarSize={interactive ? 140 : 130}
                  isAnimationActive={false}
                  style={interactive ? { cursor: 'pointer' } : undefined}
                />
              ) : (
                SIGNUPS_CHANNEL_STACK.filter((b) => visible[b.name]).map((b) => (
                  <Bar
                    key={b.name}
                    dataKey={b.name}
                    stackId="a"
                    shape={HatchedStack(b.color, {
                      selectedWeek: interactive ? selectedWeek : null,
                      scope,
                    })}
                    maxBarSize={interactive ? 140 : 130}
                    isAnimationActive={false}
                    style={interactive ? { cursor: 'pointer' } : undefined}
                  />
                ))
              )}
            </BarChart>
            )}
          </ResponsiveContainer>
        </div>
      </div>
    );
  }

  // ── Combined toggles+legend row. Click to toggle on/off. Optionally
  //    accepts onHover for the modal's response-panel behavior.
  function renderToggleLegend({ onHover, hovered, layout = 'horizontal', useWeekScope = false, mode = 'toggle' } = {}) {
    // Two modes:
    //   'toggle' (card): click → hide/show bucket in the stacked chart
    //                    (controls `visible` state).
    //   'select' (modal): click → add/remove bucket from the pinned
    //                    response-selection set; chart is NOT affected.
    const isSelectMode = mode === 'select';
    // When a week is selected in the modal AND useWeekScope is true, the
    // legend chip values reflect that week's data; otherwise window-wide.
    const inWeek = useWeekScope && Boolean(selectedRow);
    const valueFor   = (b) => inWeek ? (selectedRow[b.name] || 0) : (totals[b.name] || 0);
    const scopeTotal = inWeek
      ? SIGNUPS_CHANNEL_BUCKETS.reduce((s, b) => s + (selectedRow[b.name] || 0), 0)
      : total;
    const gridCols = layout === 'vertical'
      ? '1fr'
      : 'repeat(auto-fill, minmax(190px, 1fr))';
    return (
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: gridCols,
          gap: 6,
          fontFamily: FONT_BODY,
          fontSize: 12,
        }}
        onMouseLeave={onHover ? () => onHover(null) : undefined}
      >
        {[...SIGNUPS_CHANNEL_STACK].reverse().map((b) => {
          const v = valueFor(b);
          const pct = scopeTotal > 0 ? Math.round((v / scopeTotal) * 100) : 0;
          const on = isSelectMode
            ? selectedResponseBuckets.has(b.name)
            : visible[b.name];
          const isHovered = hovered === b.name;
          const onClick = isSelectMode
            ? () => togglePinnedBucket(b.name)
            : () => toggleBucket(b.name);
          const titleAttr = isSelectMode
            ? (on ? 'Click to unpin responses' : 'Click to pin responses')
            : (on ? 'Click to hide' : 'Click to show');
          return (
            <button
              key={b.name}
              type="button"
              onClick={onClick}
              onMouseEnter={onHover ? () => onHover(b.name) : undefined}
              aria-pressed={on}
              title={titleAttr}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '5px 10px',
                background: isSelectMode
                  ? (on ? b.color + '22' : (isHovered ? C.paper : C.white))
                  : (isHovered ? C.paper : C.white),
                border: `${isSelectMode && on ? 2 : 1}px solid ${C.black}`,
                borderRadius: 4,
                cursor: 'pointer',
                color: C.black,
                fontFamily: FONT_BODY,
                fontSize: 12,
                // In select mode all chips stay fully readable (we're not
                // hiding anything from the chart); in toggle mode off-chips
                // strike through to communicate "hidden in chart".
                opacity: isSelectMode ? 1 : (on ? 1 : 0.45),
                textDecoration: !isSelectMode && !on ? 'line-through' : 'none',
                textAlign: 'left',
                lineHeight: 1.3,
                fontWeight: isSelectMode && on ? 700 : 400,
              }}
            >
              <span style={{
                display: 'inline-block', width: 10, height: 10, background: b.color,
                border: `1px solid ${C.black}`, flexShrink: 0,
                opacity: !isSelectMode && !on ? 0.4 : 1,
              }} />
              <span style={{ fontWeight: isSelectMode && on ? 700 : 600, flex: 1 }}>{b.name}</span>
              <span style={{
                opacity: 0.65, fontVariantNumeric: 'tabular-nums',
              }}>
                {v} · {pct}%
              </span>
            </button>
          );
        })}
        {isSelectMode ? (
          selectedResponseBuckets.size > 0 && (
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <button
                type="button"
                onClick={() => setSelectedResponseBuckets(new Set())}
                style={{
                  padding: '4px 10px',
                  background: 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  fontFamily: FONT_BODY,
                  fontSize: 11,
                  fontWeight: 600,
                  color: C.black,
                  opacity: 0.55,
                  textDecoration: 'underline',
                }}
              >
                clear pinned
              </button>
            </div>
          )
        ) : (
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <button
              type="button"
              onClick={allOn}
              style={{
                padding: '4px 10px',
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
                fontFamily: FONT_BODY,
                fontSize: 11,
                fontWeight: 600,
                color: C.black,
                opacity: 0.55,
                textDecoration: 'underline',
              }}
            >
              all
            </button>
            <button
              type="button"
              onClick={allOff}
              style={{
                padding: '4px 10px',
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
                fontFamily: FONT_BODY,
                fontSize: 11,
                fontWeight: 600,
                color: C.black,
                opacity: 0.55,
                textDecoration: 'underline',
              }}
            >
              none
            </button>
          </div>
        )}
      </div>
    );
  }

  // ── Responses panel — renders one section per *pinned* bucket in the
  //    modal's response selection. Scope: per-selected-week if a week is
  //    clicked on the chart, otherwise window-wide. Multi-select: pin
  //    several buckets to compare side-by-side.
  function renderResponsesPanel() {
    const inWeek      = Boolean(selectedRow);
    const scopeLabel  = inWeek
      ? `${selectedRow.dateRange}${selectedRow.partial ? (isReporting ? ' · clipped to range' : ' · in progress') : ''}`
      : `Window: ${dateRangeLabel}`;
    const scopeData   = inWeek ? selectedWeekSources : { byBucket: detailedBuckets, nsCount: totals['Invited / Referred'] || 0 };
    const headerNote  = inWeek
      ? <>Showing responses for <strong>{selectedRow.dateRange}</strong>. <button onClick={() => setSelectedWeek(null)} style={{ background: 'none', border: 'none', textDecoration: 'underline', cursor: 'pointer', fontFamily: FONT_BODY, fontSize: 12, color: C.black, padding: 0 }}>Clear selection</button> to see the full window.</>
      : <>Click a column above to scope responses to a single week.</>;

    const pinned = [...SIGNUPS_CHANNEL_STACK]
      .reverse()
      .filter((b) => selectedResponseBuckets.has(b.name));

    let body;
    if (pinned.length === 0) {
      body = (
        <div style={{
          fontFamily: FONT_CAPTION,
          fontStyle: 'italic',
          fontSize: 13,
          opacity: 0.55,
          padding: '8px 0',
        }}>
          Click a category chip above to pin its responses here. Multiple categories can be pinned at once.
        </div>
      );
    } else {
      body = (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
          {pinned.map((b) => {
            if (b.name === 'Invited / Referred' || b.name === 'Not Specified') {
              const cnt = inWeek ? (selectedRow[b.name] || 0) : (totals[b.name] || 0);
              const isInvited = b.name === 'Invited / Referred';
              return (
                <section
                  key={b.name}
                  style={{
                    border: `1px solid ${C.black}`,
                    borderLeft: `4px solid ${b.color}`,
                    borderRadius: 4,
                    padding: '12px 16px',
                    background: C.white,
                  }}
                >
                  <div style={{
                    fontFamily: FONT_DISPLAY, fontSize: 18, letterSpacing: '-0.02em',
                    marginBottom: 4, display: 'flex', alignItems: 'center', gap: 10,
                  }}>
                    <span style={{
                      display: 'inline-block', width: 12, height: 12, background: b.color,
                      border: `1px solid ${C.black}`,
                    }} />
                    {b.name} — {cnt} signup{cnt === 1 ? '' : 's'}
                  </div>
                  <div style={{ fontFamily: FONT_BODY, fontSize: 12, opacity: 0.7, lineHeight: 1.5 }}>
                    {isInvited ? (
                      <>Signups from <strong>May 7, 2026</strong> on with no referral source —
                      invited / referred users who joined via Registration Submitted, User
                      Invitation Completed, or User Setup Complete (only Company Setup Complete
                      carries a{' '}
                      <code style={{ fontFamily: FONT_MONO, fontSize: 11 }}>referral_source</code>).
                      No raw response text exists for these.</>
                    ) : (
                      <>Signups from <strong>before May 7, 2026</strong>, when{' '}
                      <code style={{ fontFamily: FONT_MONO, fontSize: 11 }}>referral_source</code>{' '}
                      was optional — no source was captured, so these can't be attributed to a
                      channel. No raw response text exists for these.</>
                    )}
                  </div>
                </section>
              );
            }
            const sources = scopeData.byBucket[b.name] || [];
            const bTotal  = sources.reduce((s, x) => s + x.count, 0);
            return (
              <section
                key={b.name}
                style={{
                  border: `1px solid ${C.black}`,
                  borderLeft: `4px solid ${b.color}`,
                  borderRadius: 4,
                  padding: '12px 16px',
                  background: C.white,
                }}
              >
                <div style={{
                  fontFamily: FONT_DISPLAY, fontSize: 18, letterSpacing: '-0.02em',
                  marginBottom: 4, display: 'flex', alignItems: 'center', gap: 10,
                }}>
                  <span style={{
                    display: 'inline-block', width: 12, height: 12, background: b.color,
                    border: `1px solid ${C.black}`,
                  }} />
                  {b.name} — {bTotal} signup{bTotal === 1 ? '' : 's'}
                </div>
                <div style={{
                  fontFamily: FONT_BODY, fontSize: 10, fontWeight: 700,
                  letterSpacing: '0.12em', textTransform: 'uppercase',
                  opacity: 0.55, marginTop: 6, marginBottom: 8,
                }}>
                  Raw responses ({sources.length} unique value{sources.length === 1 ? '' : 's'})
                </div>
                {sources.length === 0 ? (
                  <div style={{
                    fontFamily: FONT_CAPTION, fontStyle: 'italic', fontSize: 12, opacity: 0.6,
                  }}>
                    No raw responses for {b.name} in {inWeek ? 'this week' : 'this window'}.
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {sources.map((s, i) => (
                      <span
                        key={i}
                        title={s.source}
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 6,
                          fontFamily: FONT_BODY,
                          fontSize: 12,
                          background: C.paper,
                          border: `1px solid ${C.black}`,
                          borderRadius: 999,
                          padding: '3px 10px',
                          lineHeight: 1.4,
                          maxWidth: 360,
                        }}
                      >
                        <span style={{
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                          maxWidth: 300,
                        }}>
                          "{s.source}"
                        </span>
                        <span style={{
                          fontVariantNumeric: 'tabular-nums',
                          fontWeight: 700,
                          opacity: 0.7,
                        }}>
                          ×{s.count}
                        </span>
                      </span>
                    ))}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      );
    }
    return (
      <div>
        <div style={{
          fontFamily: FONT_BODY,
          fontSize: 11,
          opacity: 0.65,
          marginBottom: 14,
          lineHeight: 1.5,
        }}>
          {headerNote}
          {' · '}
          <span style={{ fontStyle: 'italic' }}>Scope: {scopeLabel}</span>
        </div>
        {body}
      </div>
    );
  }

  return (
    <section
      style={{
        background: C.white,
        border: `1px solid ${C.black}`,
        borderRadius: 4,
        padding: '28px 32px',
      }}
    >
      {alertBanner && (
        <div
          style={{
            margin: '-28px -32px 22px',
            padding: '12px 22px',
            background: '#FFF6D6',
            borderBottom: `1px solid ${C.black}`,
            borderTopLeftRadius: 4,
            borderTopRightRadius: 4,
            fontFamily: FONT_BODY,
            fontSize: 12.5,
            lineHeight: 1.55,
            display: 'flex',
            alignItems: 'flex-start',
            gap: 10,
          }}
        >
          <span style={{ fontSize: 14, lineHeight: 1, marginTop: 1 }}>⚠️</span>
          <div>{alertBanner}</div>
        </div>
      )}

      {/* Header (same shape as SelfReportedPieCard) */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          marginBottom: 6,
          gap: 12,
        }}
      >
        <div>
          {eyebrow && (
            <div
              style={{
                fontFamily: FONT_BODY,
                fontWeight: 700,
                fontSize: 11,
                letterSpacing: '0.12em',
                textTransform: 'uppercase',
              }}
            >
              {eyebrow}
            </div>
          )}
          <h2
            style={{
              fontFamily: FONT_DISPLAY,
              fontWeight: 400,
              fontSize: 28,
              lineHeight: 1.05,
              letterSpacing: '-0.03em',
              margin: eyebrow ? '6px 0 0' : 0,
              display: 'flex',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: 10,
            }}
          >
            {title}
            <SelfReportedTag />
            <InfoTooltip>{infoTooltip}</InfoTooltip>
          </h2>
        </div>
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'flex-end',
            gap: 8,
            flexShrink: 0,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {/* Stacked / Summary segmented toggle — sized to match the
                Details button on the right. */}
            <div
              role="group"
              aria-label="Chart mode"
              style={{
                display: 'inline-flex',
                border: `1px solid ${C.black}`,
                borderRadius: 4,
                overflow: 'hidden',
                fontFamily: FONT_BODY,
                fontSize: 10.5,
                fontWeight: 600,
                letterSpacing: '0.04em',
                lineHeight: 1.2,
              }}
            >
              {[
                { key: 'summary', label: 'Summary' },
                { key: 'stacked', label: 'Stacked' },
                { key: 'percent', label: '%' },
              ].map((opt, i) => {
                const isOn = chartMode === opt.key;
                return (
                  <button
                    key={opt.key}
                    type="button"
                    onClick={() => setChartMode(opt.key)}
                    aria-pressed={isOn}
                    style={{
                      padding: '4px 9px',
                      background: isOn ? C.black : C.white,
                      color: isOn ? C.white : C.black,
                      border: 'none',
                      borderLeft: i > 0 ? `1px solid ${C.black}` : 'none',
                      cursor: 'pointer',
                      lineHeight: 1.2,
                      fontFamily: FONT_BODY,
                      fontSize: 10.5,
                      fontWeight: 600,
                    }}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
            <button
              type="button"
              onClick={() => setDetailsOpen(true)}
              style={{
                background: C.white,
                border: `1px solid ${C.black}`,
                borderRadius: 4,
                padding: '4px 10px',
                fontFamily: FONT_BODY,
                fontWeight: 600,
                fontSize: 11,
                letterSpacing: '0.04em',
                cursor: 'pointer',
                color: C.black,
                lineHeight: 1.2,
              }}
            >
              Details →
            </button>
          </div>
          <div
            style={{
              fontFamily: FONT_BODY,
              fontSize: 11,
              opacity: 0.6,
              letterSpacing: '0.04em',
              textAlign: 'right',
            }}
          >
            Source: {source}
            {dateRangeLabel && (
              <div style={{ marginTop: 4, fontStyle: 'italic', fontSize: 10.5, opacity: 0.6 }}>
                {dateRangeLabel}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Chart area. In Summary mode the chart takes the full card width.
          In Stacked mode it sits in a 2-col grid with the combined toggle +
          legend on the right (vertical list) — chart ~85%, toggles ~15%. */}
      <div style={{ marginTop: 14 }}>
        {summary ? (
          renderChart({ height: 440, interactive: false, scope: 'card' })
        ) : (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '5fr 1fr',
              gap: 20,
              alignItems: 'start',
            }}
          >
            <div>
              {renderChart({ height: 440, interactive: false, scope: 'card' })}
            </div>
            <div>
              {renderToggleLegend({ layout: 'vertical' })}
            </div>
          </div>
        )}
      </div>

      {/* ── Details modal ──────────────────────────────────────────────── */}
      {detailsOpen && (
        <div
          onClick={closeModal}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.45)',
            zIndex: 100,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 24,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: C.white,
              border: `1px solid ${C.black}`,
              borderRadius: 4,
              maxWidth: 1100,
              width: '100%',
              maxHeight: '92vh',
              overflow: 'hidden',
              display: 'flex',
              flexDirection: 'column',
              boxShadow: '4px 4px 0 rgba(0,0,0,0.12)',
            }}
          >
            {/* Modal header */}
            <div
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                justifyContent: 'space-between',
                gap: 12,
                padding: '22px 28px 16px',
                borderBottom: `1px solid ${C.black}`,
                flexShrink: 0,
              }}
            >
              <div>
                <div
                  style={{
                    fontFamily: FONT_BODY,
                    fontWeight: 700,
                    fontSize: 10.5,
                    letterSpacing: '0.14em',
                    textTransform: 'uppercase',
                    opacity: 0.7,
                  }}
                >
                  {eyebrow} — Responses
                </div>
                <h3
                  style={{
                    fontFamily: FONT_DISPLAY,
                    fontWeight: 400,
                    fontSize: 26,
                    letterSpacing: '-0.02em',
                    margin: '4px 0 0',
                  }}
                >
                  {title}
                </h3>
                <div
                  style={{
                    fontFamily: FONT_CAPTION,
                    fontStyle: 'italic',
                    fontSize: 11,
                    opacity: 0.65,
                    marginTop: 4,
                  }}
                >
                  {total} {unit}s in window{dateRangeLabel ? ` · ${dateRangeLabel}` : ''}{' '}
                  · click a column to scope, hover a category to see raw responses
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                {/* Same Summary / Stacked / % segmented toggle as the card. */}
                <div
                  role="group"
                  aria-label="Chart mode"
                  style={{
                    display: 'inline-flex',
                    border: `1px solid ${C.black}`,
                    borderRadius: 4,
                    overflow: 'hidden',
                    fontFamily: FONT_BODY,
                    fontSize: 11,
                    fontWeight: 600,
                    letterSpacing: '0.04em',
                    lineHeight: 1.2,
                  }}
                >
                  {[
                    { key: 'summary', label: 'Summary' },
                    { key: 'stacked', label: 'Stacked' },
                    { key: 'percent', label: '%' },
                  ].map((opt, i) => {
                    const isOn = chartMode === opt.key;
                    return (
                      <button
                        key={opt.key}
                        type="button"
                        onClick={() => setChartMode(opt.key)}
                        aria-pressed={isOn}
                        style={{
                          padding: '5px 10px',
                          background: isOn ? C.black : C.white,
                          color: isOn ? C.white : C.black,
                          border: 'none',
                          borderLeft: i > 0 ? `1px solid ${C.black}` : 'none',
                          cursor: 'pointer',
                          fontFamily: FONT_BODY,
                          fontSize: 11,
                          fontWeight: 600,
                        }}
                      >
                        {opt.label}
                      </button>
                    );
                  })}
                </div>
                <button
                  onClick={closeModal}
                  aria-label="Close"
                  style={{
                    background: 'transparent',
                    border: `1px solid ${C.black}`,
                    borderRadius: 4,
                    width: 28,
                    height: 28,
                    fontFamily: FONT_BODY,
                    fontSize: 14,
                    cursor: 'pointer',
                    color: C.black,
                  }}
                >
                  ✕
                </button>
              </div>
            </div>

            {/* Modal body — chart on top, combined toggle+legend, then responses panel */}
            <div
              style={{
                overflow: 'auto',
                padding: '22px 28px 24px',
                flex: 1,
              }}
            >
              {renderChart({ height: 460, interactive: !summary, scope: 'modal' })}

              {!summary && (
                <>
                  <div style={{ marginTop: 20, marginBottom: 18 }}>
                    {renderToggleLegend({ useWeekScope: true, mode: 'select' })}
                  </div>

                  <div
                    style={{
                      borderTop: `1px solid ${C.black}`,
                      paddingTop: 18,
                      background: C.paper,
                      margin: '0 -28px -24px',
                      padding: '18px 28px 24px',
                      minHeight: 200,
                    }}
                  >
                    {renderResponsesPanel()}
                  </div>
                </>
              )}

              {summary && (
                <div
                  style={{
                    fontFamily: FONT_BODY,
                    fontSize: 12,
                    opacity: 0.6,
                    marginTop: 18,
                    lineHeight: 1.5,
                  }}
                >
                  Summary view — single bar per week using daily-uniques total. Switch to{' '}
                  <button
                    onClick={() => setChartMode('stacked')}
                    style={{
                      background: 'none', border: 'none', cursor: 'pointer',
                      fontFamily: FONT_BODY, fontSize: 12, color: C.black,
                      textDecoration: 'underline', padding: 0,
                    }}
                  >
                    Stacked
                  </button>{' '}
                  to see channel breakdown and explore raw responses.
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Helpers shared by the two cumulative cards so they respect the top-of-page
// timeframe toggle (Last 30 days / MTD / YTD / Reporting).
//
// cumWindowFilter: dateSet holds compact 'YYYYMMDD' day strings for the active
// window. A weekly point is in-window when its week-ending day falls within the
// set's date span. (Zoom only — the cumulative VALUES are left untouched, so
// the line keeps its true running total within the window.)
function cumWindowFilter(dateSet) {
  if (!dateSet || !dateSet.size) return () => true;
  let lo = null, hi = null;
  for (const d of dateSet) { if (lo === null || d < lo) lo = d; if (hi === null || d > hi) hi = d; }
  return (iso) => { const c = String(iso).replaceAll('-', ''); return c >= lo && c <= hi; };
}
// cumYDomain: a nice [min,max] that zooms to the (filtered) values while
// keeping true totals — snaps the floor to 0 when the minimum is near the
// bottom (e.g. full-history YTD), otherwise lifts it so short windows aren't
// flat lines pinned to the top.
function cumYDomain(counts) {
  if (!counts.length) return [0, 10];
  const maxC = Math.max(...counts), minC = Math.min(...counts);
  const span = Math.max(maxC - minC, 1);
  const pow = Math.pow(10, Math.floor(Math.log10((span / 5) || 1)));
  const n = (span / 5) / pow;
  const step = ((n < 2 ? 1 : n < 5 ? 2 : 5) * pow) || 1;
  const hi = Math.ceil((maxC + span * 0.08) / step) * step;
  const lo = (minC <= span * 0.5) ? 0 : Math.floor((minC - span * 0.08) / step) * step;
  return [Math.max(0, lo), hi];
}
// cumRateDomain: symmetric-ish domain for the WoW % axis. Always includes 0 so
// the sign of the rate is readable; pads above/below the observed values.
function cumRateDomain(rates) {
  const vals = rates.filter((v) => v != null && Number.isFinite(v));
  if (!vals.length) return [0, 10];
  const maxR = Math.max(...vals, 0);
  const minR = Math.min(...vals, 0);
  const pad = Math.max((maxR - minR) * 0.12, 1);
  return [Math.floor(minR - pad), Math.ceil(maxR + pad)];
}
// Tiny two-item legend for the cumulative cards (solid cumulative line on the
// left axis, dashed WoW growth-rate line on the right axis).
function LegendRow({ accent, cumLabel, rateLabel = 'WoW' }) {
  return (
    <div style={{ display: 'flex', gap: 16, alignItems: 'center', marginTop: 10, fontFamily: FONT_BODY, fontSize: 10.5, opacity: 0.8 }}>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        <span style={{ width: 14, borderTop: `2px solid ${C.black}` }} />
        {cumLabel} <span style={{ opacity: 0.55 }}>(left)</span>
      </span>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        <span style={{ width: 14, borderTop: `2px dashed ${accent}` }} />
        {rateLabel} growth % <span style={{ opacity: 0.55 }}>(right)</span>
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Cumulative total signups — running total of signups at the end of each week,
// over the full history. Same data source as the "Signups by Channel" card
// (Amplitude dailySignups — the all-channel total). Sits to the LEFT of the
// Cumulative active logos chart. The last point equals total signups in the
// pulled window (Jan 1 → now, i.e. the YTD signups figure).
// ---------------------------------------------------------------------------
function CumulativeSignupsCard({ dateSet, granularity = 'weekly', months } = {}) {
  const daily = dataJson.amplitude?.dailySignups || {};
  const keys = Object.keys(daily).filter((k) => /^\d{8}$/.test(k)).sort();
  if (!keys.length) return null;

  // Today (for the trailing partial week) from the data's own pulledAt.
  const today = (dataJson.pulledAt || new Date().toISOString()).slice(0, 10);

  // True deduplicated running total (amplitude.dedup.cumulativeDaily): the
  // cumulative count of distinct users in the 4-event union, so the line
  // ends on the same deduped YTD figure as the Signups KPI rather than the
  // (higher) sum-of-daily-uniques. cumAt() reads the cumulative value at a
  // date, clamped to the latest available date ≤ that date. Falls back to
  // summing dailySignups when the deduped series isn't present.
  const cumDaily = dataJson.amplitude?.dedup?.cumulativeDaily || null;
  const _cumDates = cumDaily ? Object.keys(cumDaily).sort() : [];
  function cumAt(yyyymmddDashOrCompact) {
    if (!cumDaily) return null;
    const key = String(yyyymmddDashOrCompact).replaceAll('-', '');
    const clamped = key > today.replaceAll('-', '') ? today.replaceAll('-', '') : key;
    if (cumDaily[clamped] != null) return cumDaily[clamped];
    let best = null;
    for (const k of _cumDates) { if (k <= clamped) best = k; else break; }
    return best != null ? cumDaily[best] : 0;
  }

  // Bucket daily signups into week-ending Sunday (Mon–Sun weeks), then cumulate.
  const bySun = {};
  for (const k of keys) {
    const d = parseYYYYMMDD(k);
    const dow = d.getUTCDay();                       // 0 = Sun
    const sun = addUTCDays(d, dow === 0 ? 0 : 7 - dow);
    const sunKey = fmtYYYYMMDDDash(sun);
    bySun[sunKey] = (bySun[sunKey] || 0) + (Number(daily[k]) || 0);
  }

  // YTD aggregates by MONTH (matching the rest of the dashboard); other windows
  // use weekly points. The growth-rate line is MoM in monthly mode, WoW weekly.
  const monthly  = granularity === 'monthly';
  const rateName = monthly ? 'MoM' : 'WoW';
  let data;
  if (monthly) {
    // One point per month (Jan→current): cumulative signups through month-end.
    let mcum = 0;
    data = (months || []).map((mo) => {
      const endDate = mo.dates[mo.dates.length - 1];
      let count;
      if (cumDaily) {
        count = cumAt(endDate);                 // deduped running total at month-end
      } else {
        mcum += mo.dates.reduce((s, d) => s + (Number(daily[d]) || 0), 0);
        count = mcum;
      }
      return {
        label:   mo.label,
        ending:  mo.label,
        year:    Number(String(mo.dates[0]).slice(0, 4)),
        count,
        partial: !!mo.partial,
      };
    });
  } else {
    // Cumulate over ALL weeks first (true running total), THEN zoom to the window.
    let cum = 0;
    const allData = Object.keys(bySun).sort().map((sun) => {
      cum += bySun[sun];
      const partial = sun > today;                   // week-ending Sunday not yet reached
      const ed = parseYYYYMMDD(sun.replaceAll('-', '')); // label by the true week-ending Sunday
      // Prefer the deduped running total at the week-ending Sunday (clamped to
      // today for the in-progress week); fall back to the summed running total.
      const count = cumDaily ? cumAt(sun) : cum;
      return {
        iso:     partial ? today : sun,               // filter key: clamp the partial week so it stays in-window
        label:   fmtMonDay(ed),
        ending:  fmtMonDay(ed),
        year:    ed.getUTCFullYear(),
        count,
        partial,
      };
    });
    // WoW computed on the FULL series so the first visible week keeps a valid rate.
    allData.forEach((p, i) => {
      const prev = i > 0 ? allData[i - 1].count : null;
      p.wow = (prev && prev > 0) ? ((p.count - prev) / prev) * 100 : null;
    });
    const inWin    = cumWindowFilter(dateSet);
    const filtered = allData.filter((p) => inWin(p.iso));
    data = filtered.length ? filtered : allData;
  }
  if (monthly) {
    data.forEach((p, i) => {
      const prev = i > 0 ? data[i - 1].count : null;
      p.wow = (prev && prev > 0) ? ((p.count - prev) / prev) * 100 : null;
    });
  }
  const last     = data[data.length - 1];
  const [yLo, yHi] = cumYDomain(data.map((r) => r.count));
  const wDomain    = cumRateDomain(data.map((r) => r.wow));
  const sep      = monthly ? ' ' : ', ';
  const firstLbl = data[0] ? `${data[0].ending}${sep}${data[0].year}` : '';
  const lastLbl  = last ? `${last.ending}${sep}${last.year}` : '';

  return (
    <div style={{ background: C.white, border: `1px solid ${C.black}`, borderRadius: 4, padding: '28px 32px 24px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
        <div>
          <h3 style={{ fontFamily: FONT_DISPLAY, fontWeight: 400, fontSize: 22, letterSpacing: '-0.02em', margin: 0 }}>
            Cumulative total user signups
          </h3>
          <div style={{ fontFamily: FONT_BODY, fontSize: 11, opacity: 0.6, marginTop: 4 }}>
            Amplitude · weekly · all channels
          </div>
          {firstLbl && (
            <div style={{ fontFamily: FONT_CAPTION, fontStyle: 'italic', fontSize: 10.5, opacity: 0.55, marginTop: 4 }}>
              {firstLbl} – {lastLbl}
            </div>
          )}
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 400, fontSize: 30, lineHeight: 1, letterSpacing: '-0.02em' }}>
            {last.count.toLocaleString()}
          </div>
          <div style={{ fontFamily: FONT_BODY, fontSize: 10.5, opacity: 0.6, marginTop: 4 }}>
            signups to date
          </div>
        </div>
      </div>

      <LegendRow accent={C.purple} cumLabel="Cumulative signups" rateLabel={rateName} />

      <div style={{ width: '100%', height: 360, marginTop: 8 }}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 10, right: 8, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id="signupsFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%"   stopColor={C.blue} stopOpacity={0.35} />
                <stop offset="100%" stopColor={C.blue} stopOpacity={0.04} />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} stroke={C.black} strokeOpacity={0.08} />
            <XAxis
              dataKey="label"
              axisLine={{ stroke: C.black }}
              tickLine={false}
              tick={{ fontFamily: FONT_BODY, fontSize: 10, fill: C.black }}
              interval="preserveStartEnd"
              minTickGap={36}
              height={28}
            />
            <YAxis
              yAxisId="left"
              axisLine={false}
              tickLine={false}
              tick={{ fontFamily: FONT_BODY, fontSize: 11, fill: C.black }}
              domain={[yLo, yHi]}
              width={48}
              allowDecimals={false}
              tickFormatter={(v) => (Number.isInteger(v) ? v.toLocaleString() : '')}
            />
            <YAxis
              yAxisId="right"
              orientation="right"
              axisLine={false}
              tickLine={false}
              tick={{ fontFamily: FONT_BODY, fontSize: 11, fill: C.purple }}
              domain={wDomain}
              width={44}
              tickFormatter={(v) => `${v}%`}
            />
            <Tooltip
              cursor={{ stroke: C.black, strokeOpacity: 0.2, strokeWidth: 1 }}
              content={({ active, payload }) => {
                if (!active || !payload || !payload.length) return null;
                const p = payload[0].payload;
                return (
                  <div style={{ background: C.white, border: `1px solid ${C.black}`, borderRadius: 4, padding: '10px 12px', fontFamily: FONT_BODY, fontSize: 11, boxShadow: '4px 4px 0 rgba(0,0,0,0.08)' }}>
                    <div style={{ fontWeight: 700, marginBottom: 2 }}>
                      {monthly
                        ? `${p.ending} ${p.year}${p.partial ? ' · month in progress' : ''}`
                        : `Week ending ${p.ending}, ${p.year}${p.partial ? ' · current week, in progress' : ''}`}
                    </div>
                    <div>
                      <strong style={{ fontVariantNumeric: 'tabular-nums' }}>{p.count.toLocaleString()}</strong> signups
                    </div>
                    <div style={{ color: C.purple }}>
                      {rateName}: <strong>{p.wow == null ? '—' : `${p.wow >= 0 ? '+' : ''}${p.wow.toFixed(1)}%`}</strong>
                    </div>
                  </div>
                );
              }}
            />
            <Area
              yAxisId="left"
              type="monotone"
              dataKey="count"
              stroke={C.black}
              strokeWidth={2}
              fill="url(#signupsFill)"
              dot={false}
              activeDot={{ r: 4, stroke: C.black, strokeWidth: 1, fill: C.blue }}
              isAnimationActive={false}
            />
            <Line
              yAxisId="right"
              type="monotone"
              dataKey="wow"
              stroke={C.purple}
              strokeWidth={1.5}
              strokeDasharray="4 3"
              dot={false}
              activeDot={{ r: 3, stroke: C.purple, strokeWidth: 1, fill: C.white }}
              connectNulls
              isAnimationActive={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <div style={{ fontFamily: FONT_BODY, fontSize: 10.5, opacity: 0.6, marginTop: 12, lineHeight: 1.5 }}>
        Running total of signups (all channels) at each {monthly ? 'month-end' : 'week-end'}, same
        source as Signups by Channel (Amplitude). Final point = {last.count.toLocaleString()} signups
        to date; dashed line = {monthly ? 'month-over-month' : 'week-over-week'} growth rate (right axis).
        The trailing in-progress {monthly ? 'month' : 'week'} is partial.
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Cumulative active logos — combined PLG + Enterprise paying-customer logo
// count at the end of each week, plotted over the full history. Sits directly
// below "Signups by Channel". Source: HubSpot (dataJson.hubspot.logos), built
// from the revenue connector and kept fresh by scripts/pull-data.mjs.
//   • PLG paying logos — HubSpot proxy for the canonical Stripe MRR>0 count
//     (business/free, monthly_payment_amount>0, active, seats_purchased set,
//     excl niche.com), anchored by subscription_start_date.
//   • Enterprise logos — HubSpot List 5010 "Current Enterprise Customers"
//     (active, mutiny_app_plan=enterprise, monthly_payment set, start_date
//     >2026-02-01, excl niche.com), anchored by most-recent closed-won closedate.
// Single combined line (no PLG/Enterprise split). The last point equals the
// current total active logo count (reconciles to the revenue dashboard's 116).
// Integer (count) axis — not dollars.
// ---------------------------------------------------------------------------
function CumulativeLogosCard({ dateSet, granularity = 'weekly', months } = {}) {
  const logos  = dataJson.hubspot?.logos || null;
  const weeklyAll = logos?.weekly || [];
  if (!weeklyAll.length) return null;

  // Build the full series (display fields + WoW growth rate), THEN zoom to the
  // active window — WoW computed on the full series so the first visible week
  // keeps a valid rate. Active-logo stock values are left untouched.
  // YTD aggregates by MONTH (matching the rest of the dashboard); other windows
  // use weekly points. Growth-rate line is MoM in monthly mode, WoW weekly.
  const monthly  = granularity === 'monthly';
  const rateName = monthly ? 'MoM' : 'WoW';
  const todayISO = (dataJson.pulledAt || new Date().toISOString()).slice(0, 10);
  const todayCompact = todayISO.replaceAll('-', '');
  let data;
  if (monthly) {
    // Active-logo stock at each month-end (Jan→current), resampled from the
    // weekly series: latest week-ending on/before month-end, clamped to today
    // for the current (partial) month.
    data = (months || []).map((mo) => {
      const monthEnd = mo.dates[mo.dates.length - 1];           // YYYYMMDD
      const cap = mo.partial ? todayCompact : monthEnd;
      let val = 0;
      for (const w of weeklyAll) {
        const we = (w.week_ending || '').slice(0, 10).replaceAll('-', '');
        if (we <= cap) val = w.count;
      }
      return {
        label:   mo.label,
        ending:  mo.label,
        year:    Number(String(mo.dates[0]).slice(0, 4)),
        count:   val,
        partial: !!mo.partial,
      };
    });
    data.forEach((p, i) => {
      const prev = i > 0 ? data[i - 1].count : null;
      p.wow = (prev && prev > 0) ? ((p.count - prev) / prev) * 100 : null;
    });
  } else {
    const fullData = weeklyAll.map((w, i) => {
      // week_ending is normally ISO 'YYYY-MM-DD'. Guard against other label
      // formats the revenue repo might use by falling back to the raw string.
      const raw = (w.week_ending || '').slice(0, 10);
      const d = /^\d{4}-\d{2}-\d{2}/.test(raw) ? parseYYYYMMDD(raw.replaceAll('-', '')) : null;
      const valid = d && !Number.isNaN(d.getTime());
      // Display by the week-ending Sunday: full weeks are already Sundays; the
      // partial week's stored date is the as-of day, whose week ends next Sunday.
      const disp = valid ? (d.getUTCDay() === 0 ? d : addUTCDays(d, 7 - d.getUTCDay())) : null;
      const prev = i > 0 ? weeklyAll[i - 1].count : null;
      return {
        iso:     raw > todayISO ? todayISO : raw,      // filter key: clamp future/partial labels into the window
        label:   disp ? fmtMonDay(disp) : raw,
        ending:  disp ? fmtMonDay(disp) : raw,
        year:    disp ? disp.getUTCFullYear() : '',
        count:   w.count,
        wow:     (prev && prev > 0) ? ((w.count - prev) / prev) * 100 : null,
        partial: !!w.partial,
      };
    });
    const inWin    = cumWindowFilter(dateSet);
    const filtered = fullData.filter((p) => inWin(p.iso));
    data = filtered.length ? filtered : fullData;
  }
  const last     = data[data.length - 1];
  const [yLo, yHi] = cumYDomain(data.map((r) => r.count));
  const wDomain    = cumRateDomain(data.map((r) => r.wow));
  const sep      = monthly ? ' ' : ', ';
  const firstLbl = data[0]?.ending ? `${data[0].ending}${sep}${data[0].year}` : '';
  const lastLbl  = last?.ending ? `${last.ending}${sep}${last.year}` : '';

  return (
    <div
      style={{
        background: C.white,
        border: `1px solid ${C.black}`,
        borderRadius: 4,
        padding: '28px 32px 24px',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
        <div>
          <h3 style={{ fontFamily: FONT_DISPLAY, fontWeight: 400, fontSize: 22, letterSpacing: '-0.02em', margin: 0 }}>
            Cumulative active logos
          </h3>
          <div style={{ fontFamily: FONT_BODY, fontSize: 11, opacity: 0.6, marginTop: 4 }}>
            HubSpot · weekly · PLG + Enterprise
          </div>
          {firstLbl && (
            <div style={{ fontFamily: FONT_CAPTION, fontStyle: 'italic', fontSize: 10.5, opacity: 0.55, marginTop: 4 }}>
              {firstLbl} – {lastLbl}
            </div>
          )}
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 400, fontSize: 30, lineHeight: 1, letterSpacing: '-0.02em' }}>
            {(logos.total ?? last.count).toLocaleString()}
          </div>
          <div style={{ fontFamily: FONT_BODY, fontSize: 10.5, opacity: 0.6, marginTop: 4 }}>
            active logos today
          </div>
        </div>
      </div>

      <LegendRow accent={C.linkedinBlue} cumLabel="Active logos" rateLabel={rateName} />

      <div style={{ width: '100%', height: 360, marginTop: 8 }}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 10, right: 8, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id="logosFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%"   stopColor={C.purple} stopOpacity={0.18} />
                <stop offset="100%" stopColor={C.purple} stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} stroke={C.black} strokeOpacity={0.08} />
            <XAxis
              dataKey="label"
              axisLine={{ stroke: C.black }}
              tickLine={false}
              tick={{ fontFamily: FONT_BODY, fontSize: 10, fill: C.black }}
              interval="preserveStartEnd"
              minTickGap={36}
              height={28}
            />
            <YAxis
              yAxisId="left"
              axisLine={false}
              tickLine={false}
              tick={{ fontFamily: FONT_BODY, fontSize: 11, fill: C.black }}
              domain={[yLo, yHi]}
              width={40}
              allowDecimals={false}
              tickFormatter={(v) => (Number.isInteger(v) ? v.toLocaleString() : '')}
            />
            <YAxis
              yAxisId="right"
              orientation="right"
              axisLine={false}
              tickLine={false}
              tick={{ fontFamily: FONT_BODY, fontSize: 11, fill: C.linkedinBlue }}
              domain={wDomain}
              width={44}
              tickFormatter={(v) => `${v}%`}
            />
            <Tooltip
              cursor={{ stroke: C.black, strokeOpacity: 0.2, strokeWidth: 1 }}
              content={({ active, payload }) => {
                if (!active || !payload || !payload.length) return null;
                const p = payload[0].payload;
                return (
                  <div
                    style={{
                      background: C.white,
                      border: `1px solid ${C.black}`,
                      borderRadius: 4,
                      padding: '10px 12px',
                      fontFamily: FONT_BODY,
                      fontSize: 11,
                      boxShadow: '4px 4px 0 rgba(0,0,0,0.08)',
                    }}
                  >
                    <div style={{ fontWeight: 700, marginBottom: 2 }}>
                      {monthly
                        ? `${p.ending} ${p.year}${p.partial ? ' · month in progress' : ''}`
                        : `Week ending ${p.ending}, ${p.year}${p.partial ? ' · current week, in progress' : ''}`}
                    </div>
                    <div>
                      <strong style={{ fontVariantNumeric: 'tabular-nums' }}>{p.count.toLocaleString()}</strong> active logos
                    </div>
                    <div style={{ color: C.linkedinBlue }}>
                      {rateName}: <strong>{p.wow == null ? '—' : `${p.wow >= 0 ? '+' : ''}${p.wow.toFixed(1)}%`}</strong>
                    </div>
                  </div>
                );
              }}
            />
            <Area
              yAxisId="left"
              type="monotone"
              dataKey="count"
              stroke={C.black}
              strokeWidth={2}
              fill="url(#logosFill)"
              dot={false}
              activeDot={{ r: 4, stroke: C.black, strokeWidth: 1, fill: C.purple }}
              isAnimationActive={false}
            />
            <Line
              yAxisId="right"
              type="monotone"
              dataKey="wow"
              stroke={C.linkedinBlue}
              strokeWidth={1.5}
              strokeDasharray="4 3"
              dot={false}
              activeDot={{ r: 3, stroke: C.linkedinBlue, strokeWidth: 1, fill: C.white }}
              connectNulls
              isAnimationActive={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <div style={{ fontFamily: FONT_BODY, fontSize: 10.5, opacity: 0.6, marginTop: 12, lineHeight: 1.5 }}>
        {monthly ? 'End-of-month' : 'End-of-week'} count of active paying logos (PLG + Enterprise). PLG
        (Stripe-equivalent via HubSpot) anchored by subscription start date;
        Enterprise (HubSpot List 5010) by most-recent closed-won deal close date.
        Final point = {(logos.total ?? last.count).toLocaleString()} active logos
        ({(logos.plg ?? '—')} PLG + {(logos.enterprise ?? '—')} Enterprise); dashed line =
        {monthly ? ' month-over-month' : ' week-over-week'} growth rate (right axis). The trailing
        in-progress {monthly ? 'month' : 'week'} is partial.
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Signups by Team — pie + stacked column (user_work_role → Sales/Marketing/Other)
// ---------------------------------------------------------------------------
function teamSubRoleLine(teamName, roles, teamValue) {
  if (!roles) return '';
  if (teamName === 'No role') {
    return teamValue > 0 ? 'completed setup, role left blank' : '';
  }
  const def = TEAM_DEFS.find((t) => t.name === teamName);
  return (def.roles || [])
    .filter((k) => roles[k])
    .sort((a, b) => roles[b] - roles[a])
    .map((k) => `${ROLE_LABELS[k]} ${roles[k].toLocaleString()}`)
    .join(' · ');
}

function TeamPieCard({ title, source, dateRangeLabel, data, total, roles, infoTooltip }) {
  const populated = data.filter((d) => d.value > 0);
  const pct = (v) => (total > 0 ? ((v / total) * 100).toFixed(1) : '0.0');
  return (
    <section style={{ background: C.white, border: `1px solid ${C.black}`, borderRadius: 4, padding: '28px 32px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 2, gap: 12 }}>
        <h3 style={{ fontFamily: FONT_DISPLAY, fontWeight: 400, fontSize: 22, letterSpacing: '-0.02em', margin: 0 }}>{title}</h3>
        {infoTooltip && <InfoTooltip width={340}>{infoTooltip}</InfoTooltip>}
      </div>
      <div style={{ fontFamily: FONT_BODY, fontSize: 11, opacity: 0.6, marginBottom: 16 }}>
        {source} · {dateRangeLabel}
      </div>
      <div style={{ display: 'flex', gap: 24, alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ position: 'relative', width: 200, height: 200, flex: '0 0 auto' }}>
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={populated} dataKey="value" nameKey="name" innerRadius={58} outerRadius={92} startAngle={90} endAngle={-270} stroke={C.white} strokeWidth={2} isAnimationActive={false}>
                {populated.map((d) => <Cell key={d.name} fill={d.color} />)}
              </Pie>
            </PieChart>
          </ResponsiveContainer>
          <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
            <span style={{ fontFamily: FONT_DISPLAY, fontSize: 28, lineHeight: 1 }}>{total.toLocaleString()}</span>
            <span style={{ fontFamily: FONT_BODY, fontSize: 11, opacity: 0.6 }}>signups</span>
          </div>
        </div>
        <div style={{ flex: '1 1 240px', minWidth: 240, display: 'flex', flexDirection: 'column', gap: 12 }}>
          {data.map((d) => (
            <div key={d.name}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ width: 11, height: 11, borderRadius: 2, background: d.color, border: `1px solid ${C.black}` }} />
                <span style={{ fontFamily: FONT_BODY, fontSize: 14, fontWeight: 700 }}>{d.name}</span>
                <span style={{ marginLeft: 'auto', fontFamily: FONT_BODY, fontSize: 13, opacity: 0.75, fontVariantNumeric: 'tabular-nums' }}>
                  {d.value.toLocaleString()} · {pct(d.value)}%
                </span>
              </div>
              {roles && (
                <div style={{ fontFamily: FONT_BODY, fontSize: 11, opacity: 0.55, margin: '2px 0 0 19px' }}>
                  {teamSubRoleLine(d.name, roles, d.value) || '—'}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function TeamStackedCard({ title, source, dateRangeLabel, data, total, infoTooltip, isReporting }) {
  const maxValue = Math.max(...data.map((r) => r.total || 0), 1);
  const { ticks: yTicks, max: yMax } = niceTicks(maxValue, 5);
  return (
    <section style={{ background: C.white, border: `1px solid ${C.black}`, borderRadius: 4, padding: '28px 32px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 2, gap: 12 }}>
        <h3 style={{ fontFamily: FONT_DISPLAY, fontWeight: 400, fontSize: 22, letterSpacing: '-0.02em', margin: 0 }}>{title}</h3>
        {infoTooltip && <InfoTooltip width={340}>{infoTooltip}</InfoTooltip>}
      </div>
      <div style={{ fontFamily: FONT_BODY, fontSize: 11, opacity: 0.6, marginBottom: 14 }}>
        {source} · {dateRangeLabel} · {total.toLocaleString()} signups
      </div>
      <div style={{ display: 'flex', gap: 16, marginBottom: 10, flexWrap: 'wrap' }}>
        {TEAM_DEFS.map((t) => (
          <span key={t.name} style={{ display: 'flex', alignItems: 'center', gap: 6, fontFamily: FONT_BODY, fontSize: 12 }}>
            <span style={{ width: 10, height: 10, borderRadius: 2, background: t.color, border: `1px solid ${C.black}` }} />
            {t.name}
          </span>
        ))}
      </div>
      <div style={{ width: '100%', height: 300 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 8, right: 8, bottom: 8, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.1)" vertical={false} />
            <XAxis dataKey="week" axisLine={{ stroke: C.black, strokeWidth: 1 }} tickLine={false} tick={{ fontFamily: FONT_BODY, fontSize: 11, fill: C.black }} interval={0} />
            <YAxis axisLine={false} tickLine={false} tick={{ fontFamily: FONT_BODY, fontSize: 10, fill: C.black, opacity: 0.6 }} width={40} domain={[0, yMax]} ticks={yTicks} allowDecimals={false} />
            <Tooltip
              cursor={{ fill: 'rgba(0,0,0,0.04)' }}
              content={({ active, payload }) => {
                if (!active || !payload || !payload.length) return null;
                const d = payload[0].payload;
                const rows = TEAM_DEFS.map((t) => ({ name: t.name, color: t.color, v: d[t.name] || 0 })).filter((r) => r.v > 0);
                return (
                  <div style={{ background: C.white, border: `1px solid ${C.black}`, padding: '10px 12px', fontFamily: FONT_BODY, fontSize: 12, minWidth: 200 }}>
                    <div style={{ fontWeight: 700, marginBottom: 6 }}>{d.dateRange}{d.partial ? (isReporting ? ' · clipped to range' : ' · in progress') : ''}</div>
                    {rows.map((r) => (
                      <div key={r.name} style={{ display: 'flex', justifyContent: 'space-between', gap: 14, alignItems: 'center' }}>
                        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span style={{ width: 9, height: 9, borderRadius: 2, background: r.color, border: `1px solid ${C.black}` }} />{r.name}
                        </span>
                        <strong style={{ fontVariantNumeric: 'tabular-nums' }}>{r.v.toLocaleString()} · {Math.round((r.v / (d.total || 1)) * 100)}%</strong>
                      </div>
                    ))}
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 14, marginTop: 6, paddingTop: 6, borderTop: `1px solid rgba(0,0,0,0.15)` }}>
                      <span>Total</span><strong style={{ fontVariantNumeric: 'tabular-nums' }}>{(d.total || 0).toLocaleString()}</strong>
                    </div>
                  </div>
                );
              }}
            />
            {TEAM_STACK.map((name) => {
              const def = TEAM_DEFS.find((t) => t.name === name);
              return <Bar key={name} dataKey={name} stackId="team" fill={def.color} stroke={C.black} strokeWidth={0.5} isAnimationActive={false} />;
            })}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// TeamSplitCard — combines the Signups-by-Team breakdown (donut) and the
// per-period trend (stacked column) into one card with a Breakdown/Trend
// toggle. Body switches on the toggle; header stays put. Pie uses the
// window-total split (pieData/pieRoles/pieTotal), trend uses the periodic
// stacked series (trendData/trendTotal).
// ---------------------------------------------------------------------------
function TeamSplitCard({
  source,
  pieDateRangeLabel, pieData, pieTotal, pieRoles,
  trendDateRangeLabel, trendData, trendTotal,
  isReporting, infoTooltip,
}) {
  const [view, setView] = useState('split'); // 'split' | 'trend'
  const populated = pieData.filter((d) => d.value > 0);
  const pct = (v) => (pieTotal > 0 ? ((v / pieTotal) * 100).toFixed(1) : '0.0');
  const maxValue = Math.max(...trendData.map((r) => r.total || 0), 1);
  const { ticks: yTicks, max: yMax } = niceTicks(maxValue, 5);
  return (
    <section style={{ background: C.white, border: `1px solid ${C.black}`, borderRadius: 4, padding: '28px 32px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 2, gap: 12 }}>
        <h3 style={{ fontFamily: FONT_DISPLAY, fontWeight: 400, fontSize: 22, letterSpacing: '-0.02em', margin: 0 }}>User Signups by Team</h3>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          <div style={{ display: 'inline-flex', border: `1px solid ${C.black}`, borderRadius: 999, overflow: 'hidden', fontFamily: FONT_BODY, fontSize: 10.5, fontWeight: 600 }}>
            {[
              { id: 'split', label: 'Breakdown' },
              { id: 'trend', label: 'Trend' },
            ].map((opt) => {
              const active = view === opt.id;
              return (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setView(opt.id)}
                  style={{
                    padding: '3px 10px',
                    background: active ? C.black : 'transparent',
                    color: active ? C.white : C.black,
                    border: 'none',
                    cursor: active ? 'default' : 'pointer',
                    fontFamily: FONT_BODY,
                    fontSize: 10.5,
                    fontWeight: 600,
                    letterSpacing: '0.04em',
                  }}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
          {infoTooltip && <InfoTooltip width={340}>{infoTooltip}</InfoTooltip>}
        </div>
      </div>
      <div style={{ fontFamily: FONT_BODY, fontSize: 11, opacity: 0.6, marginBottom: 16 }}>
        {source} · {view === 'split' ? pieDateRangeLabel : `${trendDateRangeLabel} · ${trendTotal.toLocaleString()} signups`}
      </div>

      {view === 'split' ? (
        <div style={{ display: 'flex', gap: 24, alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ position: 'relative', width: 200, height: 200, flex: '0 0 auto' }}>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={populated} dataKey="value" nameKey="name" innerRadius={58} outerRadius={92} startAngle={90} endAngle={-270} stroke={C.white} strokeWidth={2} isAnimationActive={false}>
                  {populated.map((d) => <Cell key={d.name} fill={d.color} />)}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
            <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
              <span style={{ fontFamily: FONT_DISPLAY, fontSize: 28, lineHeight: 1 }}>{pieTotal.toLocaleString()}</span>
              <span style={{ fontFamily: FONT_BODY, fontSize: 11, opacity: 0.6 }}>signups</span>
            </div>
          </div>
          <div style={{ flex: '1 1 240px', minWidth: 240, display: 'flex', flexDirection: 'column', gap: 12 }}>
            {pieData.map((d) => (
              <div key={d.name}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ width: 11, height: 11, borderRadius: 2, background: d.color, border: `1px solid ${C.black}` }} />
                  <span style={{ fontFamily: FONT_BODY, fontSize: 14, fontWeight: 700 }}>{d.name}</span>
                  <span style={{ marginLeft: 'auto', fontFamily: FONT_BODY, fontSize: 13, opacity: 0.75, fontVariantNumeric: 'tabular-nums' }}>
                    {d.value.toLocaleString()} · {pct(d.value)}%
                  </span>
                </div>
                {pieRoles && (
                  <div style={{ fontFamily: FONT_BODY, fontSize: 11, opacity: 0.55, margin: '2px 0 0 19px' }}>
                    {teamSubRoleLine(d.name, pieRoles, d.value) || '—'}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      ) : (
        <>
          <div style={{ display: 'flex', gap: 16, marginBottom: 10, flexWrap: 'wrap' }}>
            {TEAM_DEFS.map((t) => (
              <span key={t.name} style={{ display: 'flex', alignItems: 'center', gap: 6, fontFamily: FONT_BODY, fontSize: 12 }}>
                <span style={{ width: 10, height: 10, borderRadius: 2, background: t.color, border: `1px solid ${C.black}` }} />
                {t.name}
              </span>
            ))}
          </div>
          <div style={{ width: '100%', height: 300 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={trendData} margin={{ top: 8, right: 8, bottom: 8, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.1)" vertical={false} />
                <XAxis dataKey="week" axisLine={{ stroke: C.black, strokeWidth: 1 }} tickLine={false} tick={{ fontFamily: FONT_BODY, fontSize: 11, fill: C.black }} interval={0} />
                <YAxis axisLine={false} tickLine={false} tick={{ fontFamily: FONT_BODY, fontSize: 10, fill: C.black, opacity: 0.6 }} width={40} domain={[0, yMax]} ticks={yTicks} allowDecimals={false} />
                <Tooltip
                  cursor={{ fill: 'rgba(0,0,0,0.04)' }}
                  content={({ active, payload }) => {
                    if (!active || !payload || !payload.length) return null;
                    const d = payload[0].payload;
                    const rows = TEAM_DEFS.map((t) => ({ name: t.name, color: t.color, v: d[t.name] || 0 })).filter((r) => r.v > 0);
                    return (
                      <div style={{ background: C.white, border: `1px solid ${C.black}`, padding: '10px 12px', fontFamily: FONT_BODY, fontSize: 12, minWidth: 200 }}>
                        <div style={{ fontWeight: 700, marginBottom: 6 }}>{d.dateRange}{d.partial ? (isReporting ? ' · clipped to range' : ' · in progress') : ''}</div>
                        {rows.map((r) => (
                          <div key={r.name} style={{ display: 'flex', justifyContent: 'space-between', gap: 14, alignItems: 'center' }}>
                            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              <span style={{ width: 9, height: 9, borderRadius: 2, background: r.color, border: `1px solid ${C.black}` }} />{r.name}
                            </span>
                            <strong style={{ fontVariantNumeric: 'tabular-nums' }}>{r.v.toLocaleString()} · {Math.round((r.v / (d.total || 1)) * 100)}%</strong>
                          </div>
                        ))}
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 14, marginTop: 6, paddingTop: 6, borderTop: `1px solid rgba(0,0,0,0.15)` }}>
                          <span>Total</span><strong style={{ fontVariantNumeric: 'tabular-nums' }}>{(d.total || 0).toLocaleString()}</strong>
                        </div>
                      </div>
                    );
                  }}
                />
                {TEAM_STACK.map((name) => {
                  const def = TEAM_DEFS.find((t) => t.name === name);
                  return <Bar key={name} dataKey={name} stackId="team" fill={def.color} stroke={C.black} strokeWidth={0.5} isAnimationActive={false} />;
                })}
              </BarChart>
            </ResponsiveContainer>
          </div>
        </>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Main dashboard
// ---------------------------------------------------------------------------
export default function MutinyGrowthDashboard() {
  const [definitionsOpen, setDefinitionsOpen] = useState(false);
  const [drillChannel, setDrillChannel]       = useState(null); // channel name or null
  // Top-of-page view mode:
  //   "30d" = strict Last 30 days; per-chart Daily/Weekly toggle (weekly uses
  //           the 4-complete + current-in-progress 5-bar Amplitude pattern)
  //   "mtd" = Month-to-Date; same per-chart toggle (weekly = Mon-Sun weeks
  //           overlapping MTD with full week data, bars may exceed MTD KPI)
  //   "ytd" = Year to Date; monthly bars (Jan…current, current hatched)
  // Affects KPI tiles, top-of-funnel charts, and the two pies above the
  // "Programmatic Channel Analytics" divider. Sections below are unaffected.
  const [viewMode, setViewMode] = useState('30d');

  // Reporting Mode — user-pickable date range. Defaults to last 7 days
  // (today-6 → today, inclusive). When active, weekly charts keep their
  // Mon-Sun cohorts but bar values are clipped to (cohort ∩ range); edge
  // bars get hatched.
  //
  // Floor: 2026-05-07. Pre-May-8 our self-reported referral_source field
  // wasn't required and per-channel attribution (plg_signup_click) wasn't
  // wired yet — so we don't let users pick ranges that extend further back.
  const REPORTING_FLOOR_DASH = '2026-05-07';
  const REPORTING_FLOOR_COMPACT = '20260507';
  const _today = LIVE_END_DATE;
  const _last7Start = addUTCDays(_today, -6);
  const [reportingRange, setReportingRange] = useState({
    start: fmtYYYYMMDDDash(_last7Start),
    end:   fmtYYYYMMDDDash(_today),
  });

  const is30d = viewMode === '30d';
  const isMtd = viewMode === 'mtd';
  const isYtd = viewMode === 'ytd';
  const isReporting = viewMode === 'reporting';

  // ── Reporting Mode helpers ────────────────────────────────────────────
  // Parse "YYYY-MM-DD" date input into a UTC Date. Returns null if invalid.
  function parseISODate(s) {
    if (!s || typeof s !== 'string') return null;
    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return null;
    return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  }
  const reportingStartDate = parseISODate(reportingRange.start) || _last7Start;
  const reportingEndDate   = parseISODate(reportingRange.end)   || _today;
  // Compact (YYYYMMDD) form for date-string comparisons against the data
  // pulls (which use compact form).
  const reportingStartCompact = fmtYYYYMMDD(reportingStartDate);
  const reportingEndCompact   = fmtYYYYMMDD(reportingEndDate);
  // Inclusive-on-both-ends date predicate (range-set).
  const reportingDatesArray = (() => {
    const out = [];
    if (reportingStartDate <= reportingEndDate) {
      for (let d = new Date(reportingStartDate); d <= reportingEndDate; d = addUTCDays(d, 1)) {
        out.push(fmtYYYYMMDD(d));
      }
    }
    return out;
  })();
  const reportingDatesSet = new Set(reportingDatesArray);
  function inReportingWindow(dateStr) { return reportingDatesSet.has(dateStr); }
  const reportingDays = reportingDatesArray.length;
  const reportingRangeLabel = reportingStartDate <= reportingEndDate
    ? `${fmtMonDay(reportingStartDate)} – ${fmtMonDay(reportingEndDate)}, ${reportingEndDate.getUTCFullYear()}`
    : 'Invalid range';

  // Build Mon-Sun weekly cohorts that overlap the reporting range. Each
  // cohort exposes both `dates` (full Mon-Sun, 7 days) and `datesInRange`
  // (clipped to the user's start/end). Weeks where dates !== datesInRange
  // are marked partial → hatched in the chart.
  const reportingWeeks = (() => {
    if (!reportingDatesArray.length) return [];
    const wkStart = mondayOfUTC(reportingStartDate);
    const wkEnd   = addUTCDays(mondayOfUTC(reportingEndDate), 6);
    const out = [];
    let cur = wkStart;
    while (cur <= wkEnd) {
      const ce = addUTCDays(cur, 6);
      const dates = [];
      const datesInRange = [];
      for (let d = new Date(cur); d <= ce; d = addUTCDays(d, 1)) {
        const ds = fmtYYYYMMDD(d);
        dates.push(ds);
        if (d >= reportingStartDate && d <= reportingEndDate) datesInRange.push(ds);
      }
      out.push({
        weekStartLabel: fmtMonDay(cur),
        weekStart:      fmtYYYYMMDD(cur),
        dateRange:      `${fmtMonDay(cur)} – ${fmtMonDay(ce)}`,
        dates,
        datesInRange,
        partial:        datesInRange.length < dates.length,
        // For HatchedStack compatibility: partial doubles as the
        // "in-progress/clipped" indicator. Tooltip wording is conditional.
        trailingPartial: datesInRange.length < dates.length,
        leadingPartial:  false,
        reportingClipped: datesInRange.length < dates.length,
      });
      cur = addUTCDays(ce, 1);
    }
    return out;
  })();
  const reportingWeeksRangeLabel = reportingWeeks.length
    ? (() => {
        const lastWeekStartCompact = reportingWeeks[reportingWeeks.length - 1].weekStart;
        // Parse YYYYMMDD → Date → +6 days → fmtMonDay
        const lastMon = new Date(Date.UTC(
          +lastWeekStartCompact.slice(0, 4),
          +lastWeekStartCompact.slice(4, 6) - 1,
          +lastWeekStartCompact.slice(6, 8),
        ));
        return `${reportingWeeks[0].weekStartLabel} – ${fmtMonDay(addUTCDays(lastMon, 6))}`;
      })()
    : reportingRangeLabel;

  // Reporting-mode KPI sums (range-strict, like 30d KPI uses STRICT_WINDOW).
  const SIGNUPS_REPORTING = reportingDatesArray.reduce(
    (s, d) => s + (LIVE_SIGNUPS_BY_DATE[d] || 0), 0,
  );
  const SESSIONS_REPORTING = reportingDatesArray.reduce(
    (s, d) => s + (LIVE_ENGAGED_BY_DATE[d] || 0), 0,
  );
  const MEETINGS_REPORTING = (dataJson.hubspot?.meetings || [])
    .filter((m) => inReportingWindow(m.date)).length;
  const RATIO_REPORTING = SESSIONS_REPORTING > 0
    ? (SIGNUPS_REPORTING / SESSIONS_REPORTING) * 100 : 0;

  // ── Prior period (same length, immediately preceding the reporting range)
  // Used for the KPI delta tiles in Reporting Mode.
  const reportingPriorEnd   = reportingDays > 0 ? addUTCDays(reportingStartDate, -1) : null;
  const reportingPriorStart = reportingDays > 0
    ? addUTCDays(reportingPriorEnd, -(reportingDays - 1))
    : null;
  const reportingPriorDatesArray = [];
  if (reportingPriorStart && reportingPriorEnd) {
    for (let d = new Date(reportingPriorStart); d <= reportingPriorEnd; d = addUTCDays(d, 1)) {
      reportingPriorDatesArray.push(fmtYYYYMMDD(d));
    }
  }
  const reportingPriorDatesSet = new Set(reportingPriorDatesArray);
  const reportingPriorStartCompact = reportingPriorStart ? fmtYYYYMMDD(reportingPriorStart) : null;
  // Suppress the delta when the prior period extends past the data-quality
  // floor (2026-05-07) or past our pulled-data window start.
  const _pulledWindowStartCompact = (dataJson.window?.start || '').replaceAll('-', '');
  const REPORTING_PRIOR_AVAILABLE = Boolean(
    reportingPriorStartCompact &&
    reportingPriorStartCompact >= REPORTING_FLOOR_COMPACT &&
    (!_pulledWindowStartCompact || _pulledWindowStartCompact <= reportingPriorStartCompact)
  );
  const SIGNUPS_PRIOR_REPORTING = reportingPriorDatesArray.reduce(
    (s, d) => s + (LIVE_SIGNUPS_BY_DATE[d] || 0), 0,
  );
  const SESSIONS_PRIOR_REPORTING = reportingPriorDatesArray.reduce(
    (s, d) => s + (LIVE_ENGAGED_BY_DATE[d] || 0), 0,
  );
  const MEETINGS_PRIOR_REPORTING = (dataJson.hubspot?.meetings || [])
    .filter((m) => reportingPriorDatesSet.has(m.date)).length;
  const RATIO_PRIOR_REPORTING = SESSIONS_PRIOR_REPORTING > 0
    ? (SIGNUPS_PRIOR_REPORTING / SESSIONS_PRIOR_REPORTING) * 100 : 0;
  const DELTA_REPORTING = {
    signups:         REPORTING_PRIOR_AVAILABLE ? wow(SIGNUPS_REPORTING,  SIGNUPS_PRIOR_REPORTING)  : null,
    engagedSessions: REPORTING_PRIOR_AVAILABLE ? wow(SESSIONS_REPORTING, SESSIONS_PRIOR_REPORTING) : null,
    salesMeetings:   REPORTING_PRIOR_AVAILABLE ? wow(MEETINGS_REPORTING, MEETINGS_PRIOR_REPORTING) : null,
    ratio:           REPORTING_PRIOR_AVAILABLE ? wow(RATIO_REPORTING,    RATIO_PRIOR_REPORTING)    : null,
  };
  const reportingPriorRangeLabel = REPORTING_PRIOR_AVAILABLE && reportingPriorStart && reportingPriorEnd
    ? `${fmtMonDay(reportingPriorStart)} – ${fmtMonDay(reportingPriorEnd)}`
    : null;

  // Reporting-mode pies + signups-by-channel reuse the existing computers
  // with the active date set / weeks list.
  const SHARE_OF_SIGNUPS_REPORTING = computeShareOfSignups(reportingDatesSet);
  const TOTAL_SIGNUPS_CATEGORIZED_REPORTING = SHARE_OF_SIGNUPS_REPORTING.reduce((s, x) => s + x.value, 0);
  const SHARE_OF_SALES_MEETINGS_REPORTING = computeShareOfSalesMeetings(inReportingWindow);
  const TOTAL_SALES_MEETINGS_CATEGORIZED_REPORTING = SHARE_OF_SALES_MEETINGS_REPORTING.reduce((s, x) => s + x.value, 0);

  // For computeSignupsByChannelPeriodic: feed weeks where `dates` is the
  // CLIPPED set (so bar values = sum over cohort ∩ range), but keep the
  // dateRange label as the full Mon-Sun for the tooltip.
  const SIGNUPS_BY_CHANNEL_WEEKLY_REPORTING = computeSignupsByChannelPeriodic(
    reportingWeeks.map((w) => ({
      weekStartLabel:  w.weekStartLabel,
      dateRange:       w.dateRange,
      trailingPartial: w.trailingPartial,
      partial:         w.partial,
      dates:           w.datesInRange,
    })),
  );
  const CSC_BY_CHANNEL_WEEKLY_REPORTING = computeCscByChannelPeriodic(
    reportingWeeks.map((w) => ({
      weekStartLabel:  w.weekStartLabel,
      dateRange:       w.dateRange,
      trailingPartial: w.trailingPartial,
      partial:         w.partial,
      dates:           w.datesInRange,
    })),
  );

  // Top-of-funnel weekly data shape (Sales Meetings column chart). Same
  // clipping rule: bar values use datesInRange.
  const TOP_OF_FUNNEL_WEEKLY_REPORTING = reportingWeeks.map((w) => {
    const sumIn = (m) => w.datesInRange.reduce((s, d) => s + (m[d] || 0), 0);
    return {
      week:      w.weekStartLabel,
      dateRange: w.dateRange,
      partial:   w.partial,
      trailingPartial: w.partial,
      sessions:  sumIn(LIVE_ENGAGED_BY_DATE),
      signups:   sumIn(LIVE_SIGNUPS_BY_DATE),
      meetings:  sumIn(LIVE_MEETINGS_BY_DATE),
    };
  });
  // Channel funnel / weekly data — for the PCA section. Mode-aware so
  // reporting mode reaches in too.
  const channelTable = isReporting
    ? computeChannelTable(reportingStartCompact, reportingEndCompact)
    : computeChannelTable();
  // YTD uses monthly cohorts (one bar per month) to match the rest of the
  // dashboard's YTD convention; Reporting uses its custom weeks; else weekly.
  const channelWeeklyCohorts = isReporting ? reportingWeeks : isYtd ? YTD_MONTH_COHORTS : LIVE_WEEKS;
  const channelWeeklySource  = computeSignupsByChannelGAWeekly(channelWeeklyCohorts);
  const weeklyChartData      = computeWeeklyData(channelWeeklySource);
  const kpiSignups   = is30d ? SIGNUPS_30D_DEDUP          : isMtd ? SIGNUPS_MTD_DEDUP : isReporting ? SIGNUPS_REPORTING : SIGNUPS_YTD_DEDUP;
  const kpiSessions  = is30d ? DATA.engagedSessions.window : isMtd ? SESSIONS_MTD : isReporting ? SESSIONS_REPORTING : SESSIONS_YTD;
  const kpiMeetings  = is30d ? DATA.salesMeetings.window   : isMtd ? MEETINGS_MTD : isReporting ? MEETINGS_REPORTING : MEETINGS_YTD;
  const kpiRatio     = is30d ? RATIO_30D_DEDUP             : isMtd ? RATIO_MTD_DEDUP : isReporting ? RATIO_REPORTING : RATIO_YTD_DEDUP;
  // Visitor conversion-rate trend — per-period rate, complete periods only.
  // Weekly (fixed trailing 12 weeks) for every view except YTD, which switches
  // to per-month (Jan → last complete month) to match the YTD convention.
  const ratioTrendData = isYtd ? RATIO_TREND_MONTHLY_SERIES : RATIO_TREND_SERIES;
  const ratioTrendCadence = isYtd ? 'monthly' : 'weekly';
  const ratioTrendLabel = isYtd ? RATIO_TREND_MONTHLY_LABEL : RATIO_TREND_LABEL;
  const pieSignups        = is30d ? SHARE_OF_SIGNUPS              : isMtd ? SHARE_OF_SIGNUPS_MTD             : isReporting ? SHARE_OF_SIGNUPS_REPORTING             : SHARE_OF_SIGNUPS_YTD;
  const pieSignupsTotal   = is30d ? TOTAL_SIGNUPS_CATEGORIZED     : isMtd ? TOTAL_SIGNUPS_CATEGORIZED_MTD    : isReporting ? TOTAL_SIGNUPS_CATEGORIZED_REPORTING    : TOTAL_SIGNUPS_CATEGORIZED_YTD;
  // Weekly stacked-column data for Customer signups by channel (replaces the pie).
  // Total = sum of all bars (includes Invited / Referred) — matches what's plotted.
  const signupsByChannelData = is30d
    ? SIGNUPS_BY_CHANNEL_WEEKLY_30D
    : isMtd
      ? SIGNUPS_BY_CHANNEL_WEEKLY_MTD
      : isReporting
        ? SIGNUPS_BY_CHANNEL_WEEKLY_REPORTING
        : SIGNUPS_BY_CHANNEL_MONTHLY_YTD;
  const signupsByChannelTotal = signupsByChannelData.reduce((s, r) => s + (r.total || 0), 0);
  // Previous-method (Company Setup Complete) signups by channel, sum-of-daily.
  const cscByChannelData = is30d
    ? CSC_BY_CHANNEL_WEEKLY_30D
    : isMtd
      ? CSC_BY_CHANNEL_WEEKLY_MTD
      : isReporting
        ? CSC_BY_CHANNEL_WEEKLY_REPORTING
        : CSC_BY_CHANNEL_MONTHLY_YTD;
  const cscByChannelTotal = cscByChannelData.reduce((s, r) => s + (r.total || 0), 0);
  // Signups by Team (user_work_role → Sales/Marketing/Other), window-aware.
  const teamStackedData = is30d
    ? TEAM_WEEKLY_30D
    : isMtd
      ? TEAM_WEEKLY_MTD
      : isReporting
        ? computeTeamPeriodic(reportingWeeks.map((w) => ({
            weekStartLabel: w.weekStartLabel, dateRange: w.dateRange,
            trailingPartial: w.trailingPartial, partial: w.partial, dates: w.datesInRange,
          })))
        : TEAM_MONTHLY_YTD;
  const teamStackedTotal = teamStackedData.reduce((s, r) => s + (r.total || 0), 0);
  const teamWindowTotal = is30d ? SIGNUPS_30D_DEDUP : isMtd ? SIGNUPS_MTD_DEDUP : isReporting ? SIGNUPS_REPORTING : SIGNUPS_YTD_DEDUP;
  const teamWindowDates = is30d ? STRICT_WINDOW_DATES : isMtd ? MTD_DATES_ARRAY : isReporting ? reportingDatesArray : YTD_DATES_ARRAY;
  const teamWindowRoles = roleMapForDates(teamWindowDates);
  const teamWindowRolesScaled = scaleRoleMap(teamWindowRoles);
  const teamWinSplit    = teamSplit(teamWindowRoles, teamWindowTotal);
  const teamPieData     = TEAM_DEFS.map((t) => ({ name: t.name, value: teamWinSplit[t.name], color: t.color }));
  const pieMeetings       = is30d ? SHARE_OF_SALES_MEETINGS       : isMtd ? SHARE_OF_SALES_MEETINGS_MTD      : isReporting ? SHARE_OF_SALES_MEETINGS_REPORTING      : SHARE_OF_SALES_MEETINGS_YTD;
  const pieMeetingsTotal  = is30d ? TOTAL_SALES_MEETINGS_CATEGORIZED : isMtd ? TOTAL_SALES_MEETINGS_CATEGORIZED_MTD : isReporting ? TOTAL_SALES_MEETINGS_CATEGORIZED_REPORTING : TOTAL_SALES_MEETINGS_CATEGORIZED_YTD;
  const activeWindowLabel = is30d
    ? 'Last 30 days'
    : isMtd
      ? `MTD · ${MTD_RANGE_LABEL}`
      : isReporting
        ? `Reporting · ${reportingRangeLabel}`
        : `Year to Date · ${YTD_RANGE_LABEL}`;
  // Compact date-range label for inside each KPI card (no prefix).
  const kpiDateRangeLabel = is30d
    ? WINDOW.label
    : isMtd
      ? MTD_RANGE_LABEL
      : isReporting
        ? reportingRangeLabel
        : YTD_RANGE_LABEL;
  // PCA deep-dive sources — use Reporting Mode weeks when active so the
  // LinkedIn / AEO+Search weekly columns honor the user-picked range.
  const webSessionsWeekly = computeWebSessionsWeekly(channelWeeklySource);
  const linkedinKeys = LINKEDIN_DEEP_DIVE.series.map((s) => s.key);
  const aeoKeys      = AEO_DEEP_DIVE.series.map((s) => s.key);
  const linkedinWeekly = computeChannelDeepDive(linkedinKeys, channelWeeklySource);
  const aeoChannelWeekly = computeChannelDeepDive(aeoKeys, channelWeeklySource);
  // Window totals = sum of all series for that deep-dive.
  const sumRow = (row, keys) => keys.reduce((s, k) => s + (row[k] || 0), 0);
  const linkedinWindowSignups   = linkedinWeekly.reduce((s, w) => s + sumRow(w, linkedinKeys), 0);
  const aeoChannelWindowSignups = aeoChannelWeekly.reduce((s, w) => s + sumRow(w, aeoKeys), 0);
  // PCA window label — fixed (Apr 27 → today) by default, custom range in Reporting Mode.
  const windowLabel = isReporting ? reportingRangeLabel : WINDOW.label;
  const windowDateRange = windowLabel;

  return (
    <div
      style={{
        background: C.paper,
        minHeight: '100vh',
        padding: '40px 48px 60px',
        color: C.black,
        fontFamily: FONT_BODY,
        backgroundImage:
          'radial-gradient(rgba(0,0,0,0.025) 1px, transparent 1px)',
        backgroundSize: '4px 4px',
      }}
    >
      <link
        rel="stylesheet"
        href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,300..900;1,9..144,300..700&family=Manrope:wght@400;500;600;700;800&display=swap"
      />

      {/* Header */}
      <header
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-end',
          paddingBottom: 24,
          borderBottom: `2px solid ${C.black}`,
          marginBottom: 32,
        }}
      >
        <div>
          <div
            style={{
              fontFamily: FONT_CAPTION,
              fontStyle: 'italic',
              fontSize: 13,
              opacity: 0.6,
              letterSpacing: '0.04em',
            }}
          >
            Mutiny · Growth Dashboard
          </div>
          <h1
            style={{
              fontFamily: FONT_DISPLAY,
              fontWeight: 400,
              fontSize: 56,
              lineHeight: 1,
              letterSpacing: '-0.035em',
              margin: '6px 0 0',
            }}
          >
            Growth Dashboard
          </h1>
        </div>
        <div
          style={{
            textAlign: 'right',
            fontFamily: FONT_BODY,
            fontSize: 12,
            lineHeight: 1.5,
          }}
        >
          <div style={{ fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
            Reporting window
          </div>
          {/* Toggle: Last 30 days / Last 4 weeks */}
          <div
            style={{
              display: 'inline-flex',
              marginTop: 6,
              border: `1px solid ${C.black}`,
              borderRadius: 999,
              overflow: 'hidden',
              fontFamily: FONT_BODY,
              fontSize: 12,
              fontWeight: 600,
            }}
          >
            {[
              { id: '30d',       label: 'Last 30 days' },
              { id: 'mtd',       label: 'MTD' },
              { id: 'ytd',       label: 'YTD' },
              { id: 'reporting', label: 'Reporting' },
            ].map((opt) => {
              const active = viewMode === opt.id;
              return (
                <button
                  key={opt.id}
                  onClick={() => setViewMode(opt.id)}
                  style={{
                    padding: '5px 14px',
                    background: active ? C.black : 'transparent',
                    color: active ? C.white : C.black,
                    border: 'none',
                    cursor: active ? 'default' : 'pointer',
                    fontFamily: FONT_BODY,
                    fontSize: 12,
                    fontWeight: 600,
                  }}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
          {isReporting && (
            <div
              style={{
                display: 'flex',
                gap: 10,
                alignItems: 'center',
                marginTop: 8,
                flexWrap: 'wrap',
              }}
            >
              <label style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                fontFamily: FONT_BODY, fontSize: 11, fontWeight: 600, opacity: 0.75,
              }}>
                From
                <input
                  type="date"
                  value={reportingRange.start}
                  min={REPORTING_FLOOR_DASH}
                  max={reportingRange.end}
                  onChange={(e) => setReportingRange((r) => ({ ...r, start: e.target.value }))}
                  style={{
                    border: `1px solid ${C.black}`,
                    borderRadius: 4,
                    padding: '3px 6px',
                    fontFamily: FONT_BODY,
                    fontSize: 12,
                    background: C.white,
                    color: C.black,
                  }}
                />
              </label>
              <label style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                fontFamily: FONT_BODY, fontSize: 11, fontWeight: 600, opacity: 0.75,
              }}>
                To
                <input
                  type="date"
                  value={reportingRange.end}
                  min={reportingRange.start > REPORTING_FLOOR_DASH ? reportingRange.start : REPORTING_FLOOR_DASH}
                  onChange={(e) => setReportingRange((r) => ({ ...r, end: e.target.value }))}
                  style={{
                    border: `1px solid ${C.black}`,
                    borderRadius: 4,
                    padding: '3px 6px',
                    fontFamily: FONT_BODY,
                    fontSize: 12,
                    background: C.white,
                    color: C.black,
                  }}
                />
              </label>
              <span style={{ fontFamily: FONT_BODY, fontSize: 11, opacity: 0.65 }}>
                {reportingDays} day{reportingDays === 1 ? '' : 's'}
              </span>
              {/* Quick presets */}
              <div
                style={{
                  display: 'inline-flex',
                  border: `1px solid ${C.black}`,
                  borderRadius: 4,
                  overflow: 'hidden',
                  fontFamily: FONT_BODY,
                  fontSize: 10.5,
                  fontWeight: 600,
                  marginLeft: 4,
                }}
              >
                {[
                  { id: 'last7',  label: 'Last 7d',  days: 7  },
                  { id: 'last14', label: 'Last 14d', days: 14 },
                  { id: 'last30', label: 'Last 30d', days: 30 },
                ].map((preset, i) => {
                  const presetStart = addUTCDays(_today, -(preset.days - 1));
                  const startDash = fmtYYYYMMDDDash(presetStart);
                  const endDash   = fmtYYYYMMDDDash(_today);
                  const isActive  = reportingRange.start === startDash
                                  && reportingRange.end   === endDash;
                  return (
                    <button
                      key={preset.id}
                      type="button"
                      onClick={() => setReportingRange({ start: startDash, end: endDash })}
                      style={{
                        padding: '3px 8px',
                        background: isActive ? C.black : C.white,
                        color: isActive ? C.white : C.black,
                        border: 'none',
                        borderLeft: i > 0 ? `1px solid ${C.black}` : 'none',
                        cursor: 'pointer',
                        fontFamily: FONT_BODY,
                        fontSize: 10.5,
                        fontWeight: 600,
                      }}
                    >
                      {preset.label}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          <div style={{ opacity: 0.6, marginTop: 4, fontSize: 11 }}>
            {is30d
              ? WINDOW.label
              : isMtd
                ? MTD_RANGE_LABEL
                : isReporting
                  ? reportingRangeLabel
                  : YTD_RANGE_LABEL}
          </div>
          <div style={{ opacity: 0.6, marginTop: 6, fontFamily: FONT_MONO, fontSize: 11 }}>
            Last updated: {new Date(LIVE_DATA_PULLED_AT).toLocaleString('en-US', {
              dateStyle: 'medium',
              timeStyle: 'short',
            })}
          </div>
        </div>
      </header>

      {/* KPI cards */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(4, 1fr)',
          gap: 16,
          marginBottom: 40,
        }}
      >
        <KpiCard
          label="User Signups"
          value={kpiSignups.toLocaleString()}
          sublabel="User Setup Complete · Amplitude"
          footnote={`A completed signup = a unique user who finished onboarding by firing [Onboarding] User Setup Complete — the step both paths converge on (create an org, or accept an invite), i.e. they actually made it into the app (internal accounts excluded). Deduplicated across the selected window. Note: this event only began firing ~Feb 16, 2026, so earlier dates read zero. Distinct from "Signup Clicks" in the Channel Funnel below, which counts the upstream click on the signup CTA from GA4.`}
          bgColor={C.lightPurple}
          accentColor={C.purple}
          dateRangeLabel={kpiDateRangeLabel}
          deltaNode={
            is30d && DELTA_30D.signups
              ? <Delta value={DELTA_30D.signups.raw} suffix="" precision={0} secondary={DELTA_30D.signups.pct} />
              : isReporting && DELTA_REPORTING.signups
                ? <Delta value={DELTA_REPORTING.signups.raw} suffix="" precision={0} secondary={DELTA_REPORTING.signups.pct} />
                : null
          }
          deltaLabel={isReporting ? `vs prior ${reportingDays}d${reportingPriorRangeLabel ? ` · ${reportingPriorRangeLabel}` : ''}` : 'vs prior 30d'}
        />
        <KpiCard
          label="Website Visitors"
          value={kpiSessions.toLocaleString()}
          sublabel="Engaged Sessions · GA4"
          footnote="Engaged Sessions used as bot-resistant proxy (AEO crawlers inflated Total Users in March)."
          bgColor={C.lightBlue}
          accentColor={C.blue}
          dateRangeLabel={kpiDateRangeLabel}
          deltaNode={
            is30d && DELTA_30D.engagedSessions
              ? <Delta value={DELTA_30D.engagedSessions.raw} suffix="" precision={0} secondary={DELTA_30D.engagedSessions.pct} />
              : isReporting && DELTA_REPORTING.engagedSessions
                ? <Delta value={DELTA_REPORTING.engagedSessions.raw} suffix="" precision={0} secondary={DELTA_REPORTING.engagedSessions.pct} />
                : null
          }
          deltaLabel={isReporting ? `vs prior ${reportingDays}d${reportingPriorRangeLabel ? ` · ${reportingPriorRangeLabel}` : ''}` : 'vs prior 30d'}
        />
        <KpiCard
          label="Visitor → User Signup"
          value={kpiRatio.toFixed(2) + '%'}
          sublabel="Signups ÷ Engaged Sessions"
          footnote="Cross-system ratio: Amplitude ÷ GA4, directional only."
          bgColor={C.lightGreen}
          accentColor={C.green}
          dateRangeLabel={kpiDateRangeLabel}
          deltaNode={
            is30d && DELTA_30D.ratio
              ? <Delta value={DELTA_30D.ratio.raw} suffix="pp" precision={2} secondary={DELTA_30D.ratio.pct} />
              : isReporting && DELTA_REPORTING.ratio
                ? <Delta value={DELTA_REPORTING.ratio.raw} suffix="pp" precision={2} secondary={DELTA_REPORTING.ratio.pct} />
                : null
          }
          deltaLabel={isReporting ? `vs prior ${reportingDays}d${reportingPriorRangeLabel ? ` · ${reportingPriorRangeLabel}` : ''}` : 'vs prior 30d'}
        />
        <KpiCard
          label="Sales Meetings Requested"
          value={kpiMeetings.toLocaleString()}
          sublabel="Talk to Sales form fills · HubSpot"
          footnote="HubSpot contacts where Talk to Sales form-submission date is within the window. Test-filtered."
          bgColor={C.lightRed}
          accentColor={C.red}
          dateRangeLabel={kpiDateRangeLabel}
          deltaNode={
            is30d && DELTA_30D.salesMeetings
              ? <Delta value={DELTA_30D.salesMeetings.raw} suffix="" precision={0} secondary={DELTA_30D.salesMeetings.pct} />
              : isReporting && DELTA_REPORTING.salesMeetings
                ? <Delta value={DELTA_REPORTING.salesMeetings.raw} suffix="" precision={0} secondary={DELTA_REPORTING.salesMeetings.pct} />
                : null
          }
          deltaLabel={isReporting ? `vs prior ${reportingDays}d${reportingPriorRangeLabel ? ` · ${reportingPriorRangeLabel}` : ''}` : 'vs prior 30d'}
        />
      </div>

      {/* ── Signups by Channel — full-width.
          Replaces the prior Top-of-funnel Signups column + the Customer
          signups by channel pie. Defaults to Summary mode (single weekly
          bar that mirrors the old Signups column); flip to Stacked for
          the per-channel breakdown. */}
      <div style={{ marginBottom: 24 }}>
        <SelfReportedWeeklyCard
          title="User signups by Channel"
          source="Amplitude"
          dateRangeLabel={kpiDateRangeLabel}
          data={signupsByChannelData}
          total={signupsByChannelTotal}
          unit="signup"
          isReporting={isReporting}
          dateSet={is30d ? STRICT_WINDOW_DATES_SET : isMtd ? MTD_DATES_SET : isReporting ? reportingDatesSet : YTD_DATES_SET}
          infoTooltip={`Signups = completed signups (unique users who fired [Onboarding] User Setup Complete), excl. internal accounts. Each bar is deduplicated within its own period (week or month); the KPI tile up top is deduplicated across the whole window, so the bars can sum slightly higher than that headline (someone active in two weeks counts in both bars but once in the window total). Referral source is only captured at Company Setup Complete, so invited users and org-creators who left it blank fall into the residual. In Stacked mode, signups with no source split by date: before May 7, 2026 (field optional) they're "Not Specified"; from May 7 on they're "Invited / Referred". Bucketing rules: see the Definitions panel.`}
          alertBanner={
            <>
              Only <strong>Company Setup Complete</strong> carries a referral source. Signups
              without one are <strong>Not Specified</strong> before May 7, 2026 (field was
              optional) and <strong>Invited / Referred</strong> from May 7 on.
            </>
          }
        />
      </div>

      {/* ── Company signups by Channel (PREVIOUS method) — the pre-June-29 way
          of counting: [Onboarding] Company Setup Complete (org-creators only),
          summed daily per period, split by self-reported referral_source. Kept
          alongside the current User-Signups chart for continuity. */}
      <div style={{ marginBottom: 24 }}>
        <SelfReportedWeeklyCard
          title="Company signups by Channel"
          source="Amplitude · Company Setup Complete"
          dateRangeLabel={kpiDateRangeLabel}
          data={cscByChannelData}
          total={cscByChannelTotal}
          unit="signup"
          isReporting={isReporting}
          dateSet={is30d ? STRICT_WINDOW_DATES_SET : isMtd ? MTD_DATES_SET : isReporting ? reportingDatesSet : YTD_DATES_SET}
          infoTooltip={`How we counted signups before June 29, 2026: a signup = a unique user who fired [Onboarding] Company Setup Complete (org-creators only; internal accounts excluded). Counts are SUM-OF-DAILY (each day's unique count added up per period — the way the old dashboard displayed it, so a user active on two days counts twice). Bars split by the self-reported referral_source captured on that event; signups that left it blank are "Not Specified." This is a lower, narrower number than the current "User Signups" (User Setup Complete), which also counts invited users who join an existing org. For reference: June = 496 sum-of-daily (484 deduped).`}
        />
      </div>

      {/* ── Signups by Team (toggle: Breakdown donut / per-period Trend) on the
          left; Visitor → Signup cumulative conversion line on the right. */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, marginBottom: 24 }}>
        <TeamSplitCard
          source="Amplitude · user_work_role"
          pieDateRangeLabel={activeWindowLabel}
          pieData={teamPieData}
          pieTotal={teamWindowTotal}
          pieRoles={teamWindowRolesScaled}
          trendDateRangeLabel={kpiDateRangeLabel}
          trendData={teamStackedData}
          trendTotal={teamStackedTotal}
          isReporting={isReporting}
          infoTooltip={`Completed signups (User Setup Complete event count) grouped by the work role reported at setup completion (user_work_role event property). Sales = AE + BDR/SDR + Sales other. Marketing = ABM + Demand gen + Ops lead + Marketing other + Product mktg. Other = Founder + Other + CRO. No role = genuinely left blank (near-zero since Mar 2026; the property wasn't captured for the first setup-complete weeks of Feb 2026). These are raw event totals — the same events counted by the User Signups KPI, just grouped by role — so the four segments sum exactly to the signup total for the window (no dedup, no scaling), including custom Reporting ranges.`}
        />
        <VisitorSignupTrend
          data={ratioTrendData}
          dateRangeLabel={ratioTrendLabel}
          cadence={ratioTrendCadence}
          isReporting={isReporting}
        />
      </div>

      {/* ── Cumulative trends — 2-col row directly below Signups by Channel:
          total signups (Amplitude) on the left, active logos (PLG + Enterprise,
          from the revenue dashboard) on the right. */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 24 }}>
        <CumulativeSignupsCard
          granularity={isYtd ? 'monthly' : 'weekly'}
          months={YTD_MONTHS_LIST}
          dateSet={is30d ? STRICT_WINDOW_DATES_SET : isMtd ? MTD_DATES_SET : isReporting ? reportingDatesSet : YTD_DATES_SET}
        />
        <CumulativeLogosCard
          granularity={isYtd ? 'monthly' : 'weekly'}
          months={YTD_MONTHS_LIST}
          dateSet={is30d ? STRICT_WINDOW_DATES_SET : isMtd ? MTD_DATES_SET : isReporting ? reportingDatesSet : YTD_DATES_SET}
        />
      </div>

      {/* ── Sales Meetings — column chart + self-reported channel pie,
          2-col grid below the full-width Signups by Channel. */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 20,
          marginBottom: 40,
        }}
      >
        {is30d && (
          <TopOfFunnelTrend
            data={TOP_OF_FUNNEL_DAILY_30D}
            weeklyData={TOP_OF_FUNNEL_WEEKLY_30D_FULL}
            mode="weekly"
            dateRangeLabel={WINDOW.label}
            weeklyDateRangeLabel={WEEKLY_30D_FULL_RANGE_LABEL}
            chartKeys={['meetings']}
            showEyebrow={false}
            hideFootnote={true}
          />
        )}
        {isMtd && (
          <TopOfFunnelTrend
            data={TOP_OF_FUNNEL_DAILY_MTD}
            weeklyData={TOP_OF_FUNNEL_WEEKLY_MTD}
            mode="weekly"
            dateRangeLabel={MTD_RANGE_LABEL}
            weeklyDateRangeLabel={MTD_WEEKLY_RANGE_LABEL}
            chartKeys={['meetings']}
            showEyebrow={false}
            hideFootnote={true}
          />
        )}
        {isYtd && (
          <TopOfFunnelTrend
            data={TOP_OF_FUNNEL_MONTHLY_YTD}
            mode="weekly"
            dateRangeLabel={kpiDateRangeLabel}
            chartKeys={['meetings']}
            showEyebrow={false}
            hideFootnote={true}
          />
        )}
        {isReporting && (
          <TopOfFunnelTrend
            data={TOP_OF_FUNNEL_WEEKLY_REPORTING}
            mode="weekly"
            dateRangeLabel={reportingRangeLabel}
            chartKeys={['meetings']}
            showEyebrow={false}
            isReporting={true}
            hideFootnote={true}
          />
        )}
        <SelfReportedPieCard
          eyebrow="Share of Sales Meetings"
          title="Sales meeting requests by channel"
          source="HubSpot"
          dataStartNote=""
          dateRangeLabel={kpiDateRangeLabel}
          data={pieMeetings}
          total={pieMeetingsTotal}
          totalLabel="meeting requests"
          unit="request"
          infoTooltip={`Self-reported "how did you discover Mutiny" on the Talk to Sales form (HubSpot contacts). ${pieMeetingsTotal} valid submissions in window (${activeWindowLabel}) — by actual form-submission date. 4 internal/test accounts excluded (3× matt.ratchford+*@mutinyhq.com, kedwardsfake@1mind.com). Same bucketing rules as Customer signups.`}
        />
      </div>

      {/* ─────────────────────────────────────────────────────────────────────
          PROGRAMMATIC CHANNEL ANALYTICS — divider header.
          Everything below this line uses GA4 plg_signup_click attribution +
          per-channel session data + Peec visibility. As of the Reporting
          Mode rollout, these sections also respect the top-of-page mode
          toggle (Last 30 days / MTD / YTD / Reporting). Note that
          plg_signup_click only became reliable May 13, 2026 — picking a
          range that pre-dates that will show empty/sparse per-channel bars
          (the existing alert banners explain why).
          ───────────────────────────────────────────────────────────────────── */}
      <div
        style={{
          margin: '12px 0 28px',
          padding: '20px 0 16px',
          borderTop: `2px solid ${C.black}`,
          borderBottom: `1px solid ${C.black}`,
        }}
      >
        <div
          style={{
            fontFamily: FONT_BODY,
            fontWeight: 700,
            fontSize: 11,
            letterSpacing: '0.18em',
            textTransform: 'uppercase',
            opacity: 0.7,
            marginBottom: 4,
          }}
        >
          Section
        </div>
        <div
          style={{
            fontFamily: FONT_DISPLAY,
            fontSize: 38,
            fontWeight: 400,
            letterSpacing: '-0.02em',
            lineHeight: 1.05,
          }}
        >
          Channel Analytics
        </div>
        <div
          style={{
            fontFamily: FONT_BODY,
            fontSize: 12.5,
            opacity: 0.7,
            marginTop: 6,
            maxWidth: 720,
            lineHeight: 1.5,
          }}
        >
          Website visitors, self-reported signup attribution, and AI-search
          visibility. Charts honor the top-of-page mode toggle.
        </div>
      </div>

      {/* ── Website Visitors ── */}
      <section
        style={{
          background: C.white,
          border: `1px solid ${C.black}`,
          borderRadius: 4,
          padding: '28px 32px 24px',
          marginBottom: 40,
          position: 'relative',
        }}
      >
        {/* Header row: icon + name + subtitle (left), KPI tile (right) */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            gap: 24,
            marginBottom: 26,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <div
              style={{
                width: 44,
                height: 44,
                background: C.blue,
                border: `1px solid ${C.black}`,
                borderRadius: 6,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontFamily: FONT_DISPLAY,
                fontSize: 22,
                fontWeight: 400,
                lineHeight: 1,
                flexShrink: 0,
              }}
            >
              W
            </div>
            <div>
              <h2
                style={{
                  fontFamily: FONT_DISPLAY,
                  fontWeight: 400,
                  fontSize: 32,
                  lineHeight: 1,
                  letterSpacing: '-0.03em',
                  margin: 0,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                }}
              >
                Website Visitors
                <ProgrammaticTag />
              </h2>
              <div
                style={{
                  fontFamily: FONT_BODY,
                  fontSize: 13,
                  opacity: 0.65,
                  marginTop: 6,
                  lineHeight: 1.4,
                }}
              >
                All website visitors by attribution channel
              </div>
            </div>
          </div>
        </div>

        {/* 2-col grid: chart on left, sources table on right.
            alignItems: stretch + marginTop: auto on the right-side table
            wrapper pushes the table's bottom row down to align with the
            chart's x-axis line. */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 28, alignItems: 'stretch' }}>
        <div>
        <div style={{ marginBottom: 12 }}>
          <div
            style={{
              fontFamily: FONT_BODY,
              fontWeight: 600,
              fontSize: 14,
              display: 'flex',
              alignItems: 'baseline',
              gap: 10,
            }}
          >
            Engaged Sessions · {isYtd ? 'monthly' : 'weekly'}
            <span style={{ fontFamily: FONT_BODY, fontWeight: 400, fontSize: 11, opacity: 0.6 }}>
              Stacked by channel
            </span>
          </div>
        </div>

        {/* Legend */}
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: '6px 14px',
            marginBottom: 14,
            fontFamily: FONT_BODY,
            fontSize: 11,
          }}
        >
          {SIGNUPS_STACK_ORDER.slice().reverse().map((s) => (
            <div key={s.key} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <span
                style={{
                  width: 10,
                  height: 10,
                  background: s.color,
                  border: `1px solid ${C.black}`,
                  borderRadius: 1,
                  display: 'inline-block',
                }}
              />
              <span>{s.key}</span>
            </div>
          ))}
        </div>

        {/* Chart */}
        <div style={{ width: '100%', height: 480 }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={webSessionsWeekly}
              barCategoryGap="22%"
              margin={{ top: 10, right: 8, bottom: 0, left: 4 }}
            >
              <CartesianGrid vertical={false} stroke={C.black} strokeOpacity={0.08} />
              <XAxis
                dataKey="week"
                axisLine={{ stroke: C.black }}
                tickLine={false}
                interval={0}
                height={48}
                tick={makeWeekTick(
                  webSessionsWeekly.reduce(
                    (acc, r) => ({ ...acc, [r.week]: r.dateRange }),
                    {}
                  )
                )}
              />
              {(() => {
                const max = Math.max(
                  ...webSessionsWeekly.map((r) =>
                    SIGNUPS_BY_CHANNEL_KEYS.reduce((s, k) => s + (r[k] || 0), 0)
                  ),
                  1
                );
                const { ticks, max: yMax } = niceTicks(max, 5);
                return (
                  <YAxis
                    axisLine={false}
                    tickLine={false}
                    tick={{ fontFamily: FONT_BODY, fontSize: 11, fill: C.black }}
                    domain={[0, yMax]}
                    ticks={ticks}
                    allowDecimals={false}
                    width={48}
                    tickFormatter={(v) => v >= 1000 ? `${(v/1000).toFixed(1)}k` : v}
                  />
                );
              })()}
              <Tooltip
                cursor={{ fill: 'rgba(0,0,0,0.04)' }}
                content={({ active, payload, label }) => {
                  if (!active || !payload || !payload.length) return null;
                  const row = webSessionsWeekly.find((r) => r.week === label);
                  if (!row) return null;
                  const total = SIGNUPS_BY_CHANNEL_KEYS.reduce((s, k) => s + (row[k] || 0), 0);
                  return (
                    <div
                      style={{
                        background: C.white,
                        border: `1px solid ${C.black}`,
                        borderRadius: 4,
                        padding: '10px 12px',
                        fontFamily: FONT_BODY,
                        fontSize: 11,
                        minWidth: 200,
                        boxShadow: '4px 4px 0 rgba(0,0,0,0.08)',
                      }}
                    >
                      <div style={{ fontWeight: 700, marginBottom: 4 }}>
                        {row.week} · {row.dateRange}
                        {row.partial && (
                          <span style={{ fontWeight: 400, opacity: 0.6, marginLeft: 6 }}>
                            · partial
                          </span>
                        )}
                      </div>
                      <div style={{ marginBottom: 6, opacity: 0.7 }}>
                        {total.toLocaleString()} engaged session{total === 1 ? '' : 's'}
                      </div>
                      {SIGNUPS_STACK_ORDER.slice().reverse().map((s) => {
                        const v = row[s.key];
                        if (!v) return null;
                        return (
                          <div
                            key={s.key}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: 6,
                              marginTop: 2,
                            }}
                          >
                            <span
                              style={{
                                width: 8,
                                height: 8,
                                background: s.color,
                                border: `1px solid ${C.black}`,
                                flexShrink: 0,
                              }}
                            />
                            <span style={{ flex: 1 }}>{s.key}</span>
                            <span
                              style={{
                                fontVariantNumeric: 'tabular-nums',
                                fontWeight: 600,
                              }}
                            >
                              {v.toLocaleString()}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  );
                }}
              />
              {SIGNUPS_STACK_ORDER.map((s) => (
                <Bar
                  key={s.key}
                  dataKey={s.key}
                  stackId="web"
                  shape={makeHatchedBarShape(s.color, {
                    strokeWidth: s.hero ? 1.2 : 0.5,
                    idPrefix: 'web',
                  })}
                  isAnimationActive={false}
                />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>
        </div>

        {/* Right slot — sources table.
            Flex column + marginTop:auto wrapper pushes the table to the
            bottom so its last row aligns with the chart's x-axis. */}
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div style={{ marginTop: 'auto' }}>
          {(() => {
            // Aggregate per-channel sessions across all weekly buckets.
            const totals = SIGNUPS_BY_CHANNEL_KEYS.map((key) => {
              const colorMeta = SIGNUPS_STACK_ORDER.find((s) => s.key === key);
              return {
                key,
                color: colorMeta?.color || C.lightGrey,
                sessions: webSessionsWeekly.reduce((s, w) => s + (w[key] || 0), 0),
              };
            }).sort((a, b) => b.sessions - a.sessions);
            const grandTotal = totals.reduce((s, r) => s + r.sessions, 0);

            return (
              <div
                style={{
                  fontFamily: FONT_BODY,
                  fontSize: 13,
                  border: `1px solid ${C.black}`,
                  borderRadius: 4,
                  overflow: 'hidden',
                }}
              >
                {/* Table header */}
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '14px 1fr 90px 80px',
                    gap: 12,
                    padding: '10px 14px',
                    background: C.paper,
                    borderBottom: `1px solid ${C.black}`,
                    fontFamily: FONT_BODY,
                    fontWeight: 700,
                    fontSize: 10,
                    letterSpacing: '0.1em',
                    textTransform: 'uppercase',
                    opacity: 0.7,
                    alignItems: 'center',
                  }}
                >
                  <div></div>
                  <div>Channel</div>
                  <div style={{ textAlign: 'right' }}>Sessions</div>
                  <div style={{ textAlign: 'right' }}>Share</div>
                </div>

                {/* Table rows */}
                {totals.map((r, i) => {
                  const pct = grandTotal ? (r.sessions / grandTotal) * 100 : 0;
                  return (
                    <div
                      key={r.key}
                      style={{
                        display: 'grid',
                        gridTemplateColumns: '14px 1fr 90px 80px',
                        gap: 12,
                        padding: '12px 14px',
                        borderTop: i > 0 ? `1px solid rgba(0,0,0,0.08)` : 'none',
                        alignItems: 'center',
                        background: C.white,
                      }}
                    >
                      <div
                        style={{
                          width: 12,
                          height: 12,
                          background: r.color,
                          border: `1px solid ${C.black}`,
                          borderRadius: 2,
                        }}
                      />
                      <div style={{ fontWeight: r.sessions > 0 ? 600 : 400 }}>{r.key}</div>
                      <div
                        style={{
                          textAlign: 'right',
                          fontVariantNumeric: 'tabular-nums',
                          fontWeight: r.sessions > 0 ? 700 : 400,
                          opacity: r.sessions === 0 ? 0.4 : 1,
                        }}
                      >
                        {r.sessions.toLocaleString()}
                      </div>
                      <div
                        style={{
                          textAlign: 'right',
                          fontVariantNumeric: 'tabular-nums',
                          opacity: pct === 0 ? 0.35 : 0.65,
                        }}
                      >
                        {pct === 0 ? '—' : pct.toFixed(1) + '%'}
                      </div>
                    </div>
                  );
                })}

                {/* Total row */}
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '14px 1fr 90px 80px',
                    gap: 12,
                    padding: '12px 14px',
                    background: C.paper,
                    borderTop: `1px solid ${C.black}`,
                    fontFamily: FONT_BODY,
                    fontSize: 13,
                    alignItems: 'center',
                    fontWeight: 700,
                  }}
                >
                  <div></div>
                  <div>Total</div>
                  <div
                    style={{
                      textAlign: 'right',
                      fontVariantNumeric: 'tabular-nums',
                    }}
                  >
                    {grandTotal.toLocaleString()}
                  </div>
                  <div
                    style={{
                      textAlign: 'right',
                      fontVariantNumeric: 'tabular-nums',
                    }}
                  >
                    100.0%
                  </div>
                </div>
              </div>
            );
          })()}
          </div>{/* end marginTop:auto wrapper */}
        </div>
        </div>

        <div
          style={{
            position: 'absolute',
            right: -1,
            top: -1,
            width: 8,
            height: 36,
            background: C.blue,
            border: `1px solid ${C.black}`,
          }}
        />
      </section>

      {/* ── Signup Attribution — combined self-reported breakdowns for
          LinkedIn and AEO + Search, side-by-side in one card. Replaces
          the prior LinkedIn / AEO ChannelDeepDive cards (which carried
          GA4-based programmatic charts alongside these self-reported ones). */}
      <section
        style={{
          background: C.white,
          border: `1px solid ${C.black}`,
          borderRadius: 4,
          padding: '28px 32px 24px',
          marginBottom: 40,
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            gap: 24,
            marginBottom: 24,
          }}
        >
          <div>
            <h2
              style={{
                fontFamily: FONT_DISPLAY,
                fontWeight: 400,
                fontSize: 32,
                lineHeight: 1,
                letterSpacing: '-0.03em',
                margin: 0,
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                flexWrap: 'wrap',
              }}
            >
              Signup Attribution
              <SelfReportedTag />
            </h2>
            <div
              style={{
                fontFamily: FONT_BODY,
                fontSize: 13,
                opacity: 0.65,
                marginTop: 6,
                lineHeight: 1.4,
              }}
            >
              Self-reported source from the onboarding{' '}
              <code style={codeStyle}>referral_source</code> field, {isYtd ? 'monthly' : 'weekly'}.
              Reliable from <strong>May 7, 2026</strong> (made required field).
            </div>
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 28 }}>
          <div>
            <div
              style={{
                fontFamily: FONT_BODY,
                fontWeight: 700,
                fontSize: 11,
                letterSpacing: '0.12em',
                textTransform: 'uppercase',
                opacity: 0.75,
                marginBottom: 6,
              }}
            >
              LinkedIn
            </div>
            <SelfReportedSourcesChart
              title="LinkedIn"
              targets={[{ name: 'LinkedIn', color: C.linkedinBlue }]}
              weeks={channelWeeklyCohorts}
              cadenceLabel={isYtd ? 'monthly' : 'weekly'}
            />
          </div>
          <div>
            <div
              style={{
                fontFamily: FONT_BODY,
                fontWeight: 700,
                fontSize: 11,
                letterSpacing: '0.12em',
                textTransform: 'uppercase',
                opacity: 0.75,
                marginBottom: 6,
              }}
            >
              AEO + Search
            </div>
            <SelfReportedSourcesChart
              title="AEO + Search"
              targets={[
                { name: 'AEO',    color: C.green },
                { name: 'Search', color: C.lightBlue },
              ]}
              weeks={channelWeeklyCohorts}
              cadenceLabel={isYtd ? 'monthly' : 'weekly'}
            />
          </div>
        </div>
      </section>

      {/* AEO Visibility + Source Retrievals — dedicated Peec AI section
          below the AEO+Search signup-attribution card. Two side-by-side
          line charts: brand visibility across topics, and the top source
          domains retrieved by AI engines answering Mutiny-related prompts. */}
      <div
        style={{
          fontFamily: FONT_BODY,
          fontWeight: 700,
          fontSize: 11,
          letterSpacing: '0.18em',
          textTransform: 'uppercase',
          opacity: 0.7,
          marginBottom: 8,
          display: 'flex',
          alignItems: 'center',
          gap: 10,
        }}
      >
        <span>AEO Visibility · Peec AI</span>
        <span style={{ flex: 1, height: 1, background: 'rgba(0,0,0,0.15)' }} />
      </div>
      <AEOSection
        windowStartISO={fmtYYYYMMDDDash(
          isReporting ? reportingStartDate :
          isMtd       ? MTD_START_DATE     :
          isYtd       ? YTD_START_DATE     :
                        LIVE_START_DATE
        )}
        windowEndISO={fmtYYYYMMDDDash(
          isReporting ? reportingEndDate :
          isMtd       ? MTD_END_DATE     :
          isYtd       ? YTD_END_DATE     :
                        LIVE_END_DATE
        )}
        windowLabel={
          isReporting ? reportingRangeLabel :
          isMtd       ? MTD_RANGE_LABEL    :
          isYtd       ? YTD_RANGE_LABEL    :
                        'Last 30 days'
        }
      />

      {/* Definitions — collapsible */}
      <section
        style={{
          background: C.black,
          color: C.white,
          padding: definitionsOpen ? '24px 36px 32px' : '18px 36px',
          borderRadius: 4,
          transition: 'padding 0.15s ease',
        }}
      >
        <button
          type="button"
          onClick={() => setDefinitionsOpen((v) => !v)}
          style={{
            background: 'transparent',
            border: 'none',
            color: C.white,
            padding: 0,
            cursor: 'pointer',
            width: '100%',
            textAlign: 'left',
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            font: 'inherit',
          }}
        >
          <HelpCircle size={16} color={C.green} strokeWidth={2.5} />
          <span
            style={{
              fontFamily: FONT_BODY,
              fontWeight: 700,
              fontSize: 11,
              letterSpacing: '0.12em',
              textTransform: 'uppercase',
              color: C.green,
            }}
          >
            Definitions & methodology
          </span>
          <span
            style={{
              fontFamily: FONT_CAPTION,
              fontStyle: 'italic',
              fontSize: 12,
              color: 'rgba(255,255,255,0.55)',
              marginLeft: 4,
            }}
          >
            {definitionsOpen ? 'click to collapse' : 'click to expand'}
          </span>
          <span style={{ flex: 1 }} />
          <ChevronDown
            size={18}
            color={C.green}
            strokeWidth={2.5}
            style={{
              transform: definitionsOpen ? 'rotate(180deg)' : 'rotate(0deg)',
              transition: 'transform 0.18s ease',
            }}
          />
        </button>

        {definitionsOpen && (
          <>
            <h2
              style={{
                fontFamily: FONT_DISPLAY,
                fontWeight: 400,
                fontSize: 32,
                lineHeight: 1.05,
                letterSpacing: '-0.025em',
                margin: '16px 0 22px',
                color: C.white,
              }}
            >
              What each number means &amp; where it comes from.
            </h2>

            <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: '20px 36px',
            fontFamily: FONT_BODY,
            fontSize: 13,
            lineHeight: 1.55,
          }}
        >
          <Def
            term="Signups"
            body={
              <>
                A <strong>completed signup</strong> = a unique user who finished onboarding by firing{' '}
                <code style={codeStyle}>[Onboarding] User Setup Complete</code> in Amplitude — the step
                both paths converge on (create an org, or accept an invite into one), i.e. they
                actually made it into the app. Deduplicated so one person counts once (internal
                accounts excluded). This is the source of truth for new account creation and powers the
                KPI tile up top. <strong>Note:</strong> this event only began firing ~Feb 16, 2026, so
                dates before then read zero. Only Company Setup Complete carries a{' '}
                <code style={codeStyle}>referral_source</code>. In the Signups by Channel chart, a
                signup with no source is <strong>Not Specified</strong> before May 7, 2026 (when the
                field was optional) and <strong>Invited / Referred</strong> from May 7 on.
              </>
            }
          />
          <Def
            term="Signup Clicks"
            body={
              <>
                GA4 <code style={codeStyle}>plg_signup_click</code> events — the upstream click on the signup CTA, attributed by source/medium.
                Used by the per-channel weekly chart and the Channel Funnel table. <strong>Distinct from
                "Signups (Completed)"</strong>: many users click without completing, and event setup means
                this only captures cleanly from {ATTRIBUTION_START_LABEL} (Wednesday) onward.
              </>
            }
          />
          <Def
            term="Website Visitors (Engaged Sessions)"
            body={
              <>
                Sum of daily <em>Engaged Sessions</em> from GA4, not Total Users. An Engaged Session = &gt;10s
                duration, a conversion event, or 2+ pageviews. We use this because AEO crawlers (GPTBot,
                ClaudeBot, PerplexityBot, etc.) materially inflated Total Users in March 2026 — engagement
                rate on the spike days dropped to 0.5–7% vs. a 40–60% baseline. Engaged Sessions filter
                that out implicitly.
              </>
            }
          />
          <Def
            term="Visitor → User Signup ratio"
            body={
              <>
                Signups ÷ Engaged Sessions over the same window. Directional only: numerator comes from
                Amplitude (deduplicated by user), denominator from GA4 (counted by session). The two
                systems don't share user IDs, so this is not a true cohort conversion rate.
              </>
            }
          />
          <Def
            term="Share of Signups"
            body={
              <>
                Self-reported <code style={codeStyle}>referral_source</code> from the onboarding
                form (Amplitude event <code style={codeStyle}>[Onboarding] Company Setup Complete</code>),
                bucketed into 9 categories: Word of Mouth, Search, AEO, Influencer /
                Community, YC, LinkedIn, Social, Joke / Invalid, and Other / Unparseable.
                Bucketing is rule-based (regex patterns) — see <em>Share of Signups · how
                buckets are assigned</em> below. Hover any slice to see the raw responses
                bucketed into it. Internal Mutiny test accounts excluded at the Amplitude
                query layer (<code style={codeStyle}>email does not contain "mutiny"</code>).
              </>
            }
          />
          <Def
            term="Share of Signups · how buckets are assigned"
            body={
              <>
                Each raw <code style={codeStyle}>referral_source</code> string runs through a
                rules pipeline. Order matters; first match wins.
                <ul style={{ margin: '6px 0 0 0', paddingLeft: 18 }}>
                  <li><strong>LinkedIn</strong> — contains "linkedin"</li>
                  <li><strong>AEO</strong> — contains chatgpt, claude, perplexity, gemini, copilot, or "ai" as a whole word</li>
                  <li><strong>YC</strong> — matches "y combinator" or "yc" as a whole word (catches "YC Video" too)</li>
                  <li><strong>Influencer / Community</strong> — mkt1, hbs, alumni, community, 30mpc, podcast</li>
                  <li><strong>Word of Mouth</strong> — friend, colleague (incl. typo "collegaue"), coworker, client, manager, teacher, CEO, VP, boss, buddy, referred, referral, recommended, recommendation, "word of mouth", "WOM", anyone described as a fan ("Our Group CEO is a huge fan"), AND single-token employer mentions (BMC, Homebase, Slack, calm, sequoia, Team, "we use it at X") read as "heard from coworkers there." The signal is "heard from a real person."</li>
                  <li><strong>Search</strong> — google, search, organic, "web"</li>
                  <li><strong>Social</strong> — all major social platforms: X / X post / twitter, reddit, facebook (incl. "FB"), instagram (incl. "insta"), youtube (incl. "YT"), tiktok, snapchat, pinterest, threads, bluesky, mastodon, plus generic "social media" / "social" mentions. Plain "email" also bucketed here as an outbound channel.</li>
                  <li><strong>Joke / Invalid</strong> — fate/destiny, test/demo, empty entries (".", "-", single digits), one-off joke responses ("dj khaled", "I was so excited about spirit 2.0…", "Jason Liu my homeboy", "20 year marketing veteran"). Separated from Other so the Other bucket stays meaningful.</li>
                  <li><strong>Other / Unparseable</strong> — legit-looking but ambiguous: external products mentioned without context (Online, Newsletter, "Ruben email"), unclear intent ("Looking for ABM Strategy help").</li>
                </ul>
                Joke / Invalid (~26%) is the actionable finding: the free-text field
                attracts a lot of non-signal — the form needs a dropdown.
              </>
            }
          />
          <Def
            term="Reporting window · Apr 27 – May 13, 2026"
            body={<>17 days of data, anchored at Mon Apr 27. Weeks are Mon–Sun: Apr 27–May 3, May 4–10, May 11–17 (partial, through May 13). Where a source started collecting data later than Apr 27 (e.g. <code style={codeStyle}>plg_signup_click</code> from May 7; pie's <code style={codeStyle}>referral_source</code> populated from ~May 4), the section shows what's available within the window and is annotated inline.</>}
          />
          <Def
            term="Data sources"
            body={
              <>
                Amplitude (Signups KPI, Share of Signups) · Google Analytics 4 (Website
                Visitors KPI, Signups by Channel weekly + funnel table) · HubSpot (Sales
                Meetings Requested KPI, Share of Sales Meetings — Talk to Sales form
                <code style={codeStyle}>how_did_you_discover_mutiny</code> property) ·
                Peec AI (AEO Visibility and Topic breakdown).
              </>
            }
          />
          <Def
            term="Signup Form Clicks by Channel · methodology"
            body={
              <>
                Count of <code style={codeStyle}>plg_signup_click</code> events on
                <code style={codeStyle}>app.mutinyhq.com/register</code>, broken out by the
                session source that brought the user into the funnel (typically on
                <code style={codeStyle}>mutinyhq.com</code>, with the source carried across
                domains via the GA4 cross-domain linker). Channel buckets use GA4's default
                channel group with overrides to break out LinkedIn, Twitter, Reddit, and
                AI Referrals (ChatGPT, Claude, Perplexity, Gemini) as their own categories.
              </>
            }
          />
          <Def
            term="Signup Form Clicks · tracking start"
            body={
              <>
                <code style={codeStyle}>plg_signup_click</code> events were first reliably
                captured on May 7, 2026. Cross-domain attribution between
                <code style={codeStyle}>mutinyhq.com</code> and
                <code style={codeStyle}>app.mutinyhq.com</code> shipped May 11, 2026.
                Week 1 (Apr 27 – May 3) has session data but zero signup events. Weeks 2–3
                are real attributed signups.
              </>
            }
          />
          <Def
            term="Sales Meetings Requested"
            body={
              <>
                Count of <em>Talk to Sales</em> form submissions in HubSpot whose
                submission date falls in the window. Form-submission date is derived as:
                if the contact's most recent conversion event is Talk to Sales, use
                <code style={codeStyle}>recent_conversion_date</code>; otherwise (they
                later booked a meeting via a Meetings Link), use
                <code style={codeStyle}>first_conversion_date</code> since Talk to Sales
                was their first form. Test-filtered: excludes
                <code style={codeStyle}>@mutinyhq.com</code> emails and the
                <code style={codeStyle}>kedwardsfake@1mind.com</code> stress-test account.
              </>
            }
          />
          <Def
            term="AEO · Visibility"
            body={
              <>
                Percentage of AI search responses (ChatGPT, Claude, Perplexity, Gemini, Google AI
                Overview) that mention Mutiny. From Peec AI. Computed weighted:
                sum(mentions) ÷ sum(responses) across the window — not an average of daily
                ratios, since Peec's prompt run volumes vary day-to-day.
              </>
            }
          />
          <Def
            term="AEO · Mentions vs. Visibility"
            body={
              <>
                <em>Visibility</em> counts a response as 1 if it mentions Mutiny at all.
                <em> Mentions</em> counts every individual reference, so a response that names
                Mutiny three times contributes 3. Mentions ≫ Visibility means AI tends to
                discuss Mutiny in depth when it does come up.
              </>
            }
          />
          <Def
            term="AEO · Avg position"
            body={
              <>
                When Mutiny is mentioned, its average rank among all brands cited in that
                response. Lower is better — 1 = mentioned first. Mutiny at 2.9 means typically
                inside the top 3.
              </>
            }
          />
          <Def
            term="AEO · Standalone window"
            body={
              <>
                The AEO section uses a fixed window (Apr 23 – May 10, 2026 = the full history
                Peec has for Mutiny right now) and does not follow any global date toggle
                introduced in v2. The window will extend as Peec accumulates more days.
              </>
            }
          />
            </div>
          </>
        )}
      </section>

      {/* Footer */}
      <div
        style={{
          marginTop: 24,
          fontFamily: FONT_CAPTION,
          fontStyle: 'italic',
          fontSize: 12,
          opacity: 0.55,
          textAlign: 'center',
        }}
      >
        Last refreshed May 13, 2026 · v2 (Apr 27 anchor, Mon–Sun weeks)
      </div>

      {/* Channel drill-down modal — opens when a row in the Channel Funnel
          table is clicked. Shows per-source/medium breakdown for that
          channel within the same May-7-onward window. */}
      {drillChannel && (() => {
        const breakdown = isReporting
          ? computeChannelDrillDown(drillChannel, reportingStartCompact, reportingEndCompact)
          : computeChannelDrillDown(drillChannel);
        const totalSignups  = breakdown.reduce((s, r) => s + r.signups, 0);
        const totalSessions = breakdown.reduce((s, r) => s + r.engagedSessions, 0);
        const overallRate   = totalSessions > 0 ? (totalSignups / totalSessions) * 100 : 0;
        const swatchColor   = SIGNUPS_CHANNEL_COLORS[drillChannel] || C.lightGrey;
        return (
          <div
            onClick={() => setDrillChannel(null)}
            style={{
              position: 'fixed',
              inset: 0,
              background: 'rgba(0,0,0,0.45)',
              zIndex: 100,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: 24,
            }}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              style={{
                background: C.white,
                border: `1px solid ${C.black}`,
                borderRadius: 4,
                maxWidth: 760,
                width: '100%',
                maxHeight: '85vh',
                overflow: 'auto',
                padding: '24px 28px 22px',
                boxShadow: '4px 4px 0 rgba(0,0,0,0.12)',
              }}
            >
              {/* Header */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  justifyContent: 'space-between',
                  gap: 12,
                  marginBottom: 18,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div
                    style={{
                      width: 18,
                      height: 18,
                      background: swatchColor,
                      border: `1px solid ${C.black}`,
                      borderRadius: 2,
                      flexShrink: 0,
                    }}
                  />
                  <div>
                    <div
                      style={{
                        fontFamily: FONT_BODY,
                        fontWeight: 700,
                        fontSize: 10.5,
                        letterSpacing: '0.14em',
                        textTransform: 'uppercase',
                        opacity: 0.7,
                      }}
                    >
                      Source breakdown
                    </div>
                    <h3
                      style={{
                        fontFamily: FONT_DISPLAY,
                        fontWeight: 400,
                        fontSize: 26,
                        letterSpacing: '-0.02em',
                        margin: '4px 0 0',
                      }}
                    >
                      {drillChannel}
                    </h3>
                    <div
                      style={{
                        fontFamily: FONT_CAPTION,
                        fontStyle: 'italic',
                        fontSize: 11,
                        opacity: 0.65,
                        marginTop: 4,
                      }}
                    >
                      {totalSignups} signups · {totalSessions.toLocaleString()} visitors ·{' '}
                      {overallRate.toFixed(2)}% conv · since {ATTRIBUTION_START_LABEL}
                    </div>
                  </div>
                </div>
                <button
                  onClick={() => setDrillChannel(null)}
                  aria-label="Close"
                  style={{
                    background: 'transparent',
                    border: `1px solid ${C.black}`,
                    borderRadius: 4,
                    width: 28,
                    height: 28,
                    fontFamily: FONT_BODY,
                    fontSize: 14,
                    cursor: 'pointer',
                    color: C.black,
                    flexShrink: 0,
                  }}
                >
                  ✕
                </button>
              </div>

              {breakdown.length === 0 ? (
                <div
                  style={{
                    padding: '32px 0',
                    opacity: 0.55,
                    fontStyle: 'italic',
                    fontFamily: FONT_BODY,
                    fontSize: 13,
                    textAlign: 'center',
                  }}
                >
                  No source data captured for this channel since {ATTRIBUTION_START_LABEL}.
                </div>
              ) : (
                <div style={{ border: `1px solid ${C.black}`, borderRadius: 4, overflow: 'hidden' }}>
                  {/* Modal table header */}
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '1fr 80px 110px 90px',
                      gap: 12,
                      padding: '10px 14px',
                      background: C.paper,
                      borderBottom: `1px solid ${C.black}`,
                      fontFamily: FONT_BODY,
                      fontWeight: 700,
                      fontSize: 10,
                      letterSpacing: '0.1em',
                      textTransform: 'uppercase',
                      opacity: 0.75,
                    }}
                  >
                    <div>Source</div>
                    <div style={{ textAlign: 'right' }}>Signup Clicks</div>
                    <div style={{ textAlign: 'right' }}>Visitors</div>
                    <div style={{ textAlign: 'right' }}>Web Conv.</div>
                  </div>
                  {/* Modal rows */}
                  {breakdown.map((r, i) => {
                    const rate = r.engagedSessions > 0
                      ? (r.signups / r.engagedSessions) * 100
                      : 0;
                    return (
                      <div
                        key={r.source}
                        style={{
                          display: 'grid',
                          gridTemplateColumns: '1fr 80px 110px 90px',
                          gap: 12,
                          padding: '10px 14px',
                          borderTop: i > 0 ? '1px solid rgba(0,0,0,0.08)' : 'none',
                          fontFamily: FONT_BODY,
                          fontSize: 13,
                          background: C.white,
                          alignItems: 'center',
                        }}
                      >
                        <div style={{ wordBreak: 'break-word' }}>{r.source}</div>
                        <div
                          style={{
                            textAlign: 'right',
                            fontVariantNumeric: 'tabular-nums',
                            opacity: r.signups === 0 ? 0.4 : 1,
                            fontWeight: r.signups > 0 ? 600 : 400,
                          }}
                        >
                          {r.signups || '—'}
                        </div>
                        <div
                          style={{
                            textAlign: 'right',
                            fontVariantNumeric: 'tabular-nums',
                            opacity: r.engagedSessions === 0 ? 0.4 : 1,
                          }}
                        >
                          {r.engagedSessions
                            ? r.engagedSessions.toLocaleString()
                            : '—'}
                        </div>
                        <div
                          style={{
                            textAlign: 'right',
                            fontVariantNumeric: 'tabular-nums',
                            opacity: rate === 0 ? 0.4 : 1,
                          }}
                        >
                          {rate === 0 ? '—' : rate.toFixed(2) + '%'}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              <div
                style={{
                  marginTop: 12,
                  fontFamily: FONT_CAPTION,
                  fontStyle: 'italic',
                  fontSize: 10.5,
                  opacity: 0.55,
                }}
              >
                Click outside or press ✕ to close. Sources are GA4's raw
                attribution values, aggregated across mediums.
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Definition row used in the bottom section
// ---------------------------------------------------------------------------
const codeStyle = {
  fontFamily: "'Geist Mono', 'Menlo', monospace",
  fontSize: 12,
  background: 'rgba(178, 255, 20, 0.18)',
  color: C.green,
  padding: '1px 6px',
  borderRadius: 3,
};

function Def({ term, body }) {
  return (
    <div>
      <div
        style={{
          fontFamily: FONT_DISPLAY,
          fontSize: 18,
          lineHeight: 1.15,
          letterSpacing: '-0.01em',
          color: C.green,
          marginBottom: 4,
        }}
      >
        {term}
      </div>
      <div style={{ color: 'rgba(255,255,255,0.82)' }}>{body}</div>
    </div>
  );
}

// SelfReportedTag — small pill used next to chart titles when the underlying
// data comes from user free-text input rather than tracked attribution.
// Signals that the breakdown is directional, not measured.
// WeekTick — custom XAxis tick that renders "Wk N" on the first line and
// the date range ("Apr 12–18") on a second line in italics. Used by both
// the Channel Mix and Sales Meeting Discovery weekly charts.
//
// Recharts injects { x, y, payload } when this is passed as the `tick` prop.
// `lookup` is a map of weekKey -> dateRangeString, supplied via closure.
// Pick a clean tick step (1, 2, 5, 10, 20, 50, 100, ...) for a Y-axis on
// integer-count data. Returns { ticks, max }.
//   - Candidates are {1, 2, 5, 10}×10ⁿ only — no 2.5, so we never produce
//     fractional ticks like 0/2.5/5/7.5 on small-scale charts.
//   - Step is rounded to an integer minimum of 1 (everything we plot in
//     column charts is a count, never a fraction).
//   - The top tick is always *one full step* above the data max — so the
//     tallest bar never butts against the chart's top edge.
function niceTicks(maxValue, preferredCount = 5) {
  if (!Number.isFinite(maxValue) || maxValue <= 0) {
    return { ticks: [0, 1, 2, 3, 4, 5], max: 5 };
  }
  const rough = maxValue / preferredCount;
  const magnitude = Math.pow(10, Math.floor(Math.log10(rough)));
  const candidates = [1, 2, 5, 10];
  let step = 10 * magnitude;
  for (const c of candidates) {
    if (c * magnitude >= rough) { step = c * magnitude; break; }
  }
  step = Math.max(1, Math.round(step));
  // Always add one step of headroom above the max bar.
  const max = (Math.floor(maxValue / step) + 1) * step;
  const ticks = [];
  for (let v = 0; v <= max + step / 2; v += step) ticks.push(v);
  return { ticks, max };
}

// Shared Recharts shape factory for stacked/single bars that should hatch
// in-progress weeks. Returns a custom shape function for Recharts <Bar>:
//   <Bar shape={makeHatchedBarShape('#A37FD9', { strokeWidth: 0.5, idPrefix: 'foo' })} />
// Each datum is hatched whenever `payload.partial` or `payload.trailingPartial`
// is truthy — matches the convention used by the data builders.
function makeHatchedBarShape(color, opts = {}) {
  const { strokeWidth = 1, idPrefix = 'hatch' } = opts;
  return (props) => {
    const { x, y, width, height, payload, dataKey } = props;
    if (!payload || height <= 0) return null;
    const isPartial = !!(payload.partial || payload.trailingPartial);
    const safeKey = (s) => String(s || '').replace(/[^a-zA-Z0-9]/g, '');
    const patternId = `${idPrefix}-${safeKey(dataKey)}-${safeKey(payload.week)}`;
    return (
      <g>
        {isPartial && (
          <defs>
            <pattern id={patternId} patternUnits="userSpaceOnUse" width="6" height="6" patternTransform="rotate(45)">
              <rect width="6" height="6" fill={color} fillOpacity="0.25" />
              <line x1="0" y1="0" x2="0" y2="6" stroke={color} strokeWidth="2" />
            </pattern>
          </defs>
        )}
        <rect
          x={x}
          y={y}
          width={width}
          height={height}
          fill={isPartial ? `url(#${patternId})` : color}
          stroke={C.black}
          strokeWidth={strokeWidth}
        />
      </g>
    );
  };
}

function makeWeekTick(lookup) {
  return function WeekTick({ x, y, payload }) {
    const dateRange = lookup[payload.value] || '';
    return (
      <g transform={`translate(${x},${y})`}>
        <text
          x={0}
          y={0}
          dy={14}
          textAnchor="middle"
          style={{
            fontFamily: FONT_BODY,
            fontSize: 12,
            fontWeight: 600,
            fill: C.black,
          }}
        >
          {payload.value}
        </text>
        <text
          x={0}
          y={0}
          dy={28}
          textAnchor="middle"
          style={{
            fontFamily: FONT_CAPTION,
            fontStyle: 'italic',
            fontSize: 10.5,
            fill: C.black,
            opacity: 0.6,
          }}
        >
          {dateRange}
        </text>
      </g>
    );
  };
}

function Tag({ children }) {
  return (
    <span
      style={{
        fontFamily: FONT_BODY,
        fontSize: 10,
        fontWeight: 700,
        letterSpacing: '0.1em',
        textTransform: 'uppercase',
        color: C.black,
        background: 'transparent',
        border: `1px solid ${C.black}`,
        borderRadius: 999,
        padding: '3px 9px 2px',
        lineHeight: 1,
        whiteSpace: 'nowrap',
        verticalAlign: 'middle',
      }}
    >
      {children}
    </span>
  );
}

function SelfReportedTag() {
  return <Tag>Self-reported</Tag>;
}

function ProgrammaticTag() {
  return <Tag>Programmatic · GA4</Tag>;
}

// InfoTooltip — small "i" icon that reveals contextual info on hover. Used to
// hide methodology / explanation text that would otherwise clutter section
// headings, while keeping the info one hover away.
function InfoTooltip({ children, width = 320, align }) {
  const [open, setOpen] = useState(false);
  const [autoAlign, setAutoAlign] = useState('left');
  const iconRef = useRef(null);

  // Resolve final alignment: explicit prop wins, else auto-detect based on
  // viewport. If tooltip extending right would clip past viewport, anchor
  // from the right edge instead (so it extends leftward).
  const effectiveAlign = align || autoAlign;
  const horizontalAnchor = effectiveAlign === 'right' ? { right: 0 } : { left: 0 };

  const handleEnter = () => {
    if (!align && iconRef.current) {
      const rect = iconRef.current.getBoundingClientRect();
      const vw = window.innerWidth || document.documentElement.clientWidth;
      // 16px buffer for body margins / scrollbars
      setAutoAlign(rect.left + width + 16 > vw ? 'right' : 'left');
    }
    setOpen(true);
  };

  return (
    <span
      ref={iconRef}
      style={{
        position: 'relative',
        display: 'inline-flex',
        alignItems: 'center',
        marginLeft: 6,
      }}
      onMouseEnter={handleEnter}
      onMouseLeave={() => setOpen(false)}
      onFocus={handleEnter}
      onBlur={() => setOpen(false)}
      tabIndex={0}
    >
      <Info
        size={13}
        strokeWidth={2}
        style={{
          opacity: 0.5,
          cursor: 'help',
          color: C.black,
        }}
      />
      {open && (
        <span
          style={{
            position: 'absolute',
            top: '100%',
            ...horizontalAnchor,
            marginTop: 6,
            zIndex: 50,
            background: C.white,
            border: `1px solid ${C.black}`,
            borderRadius: 4,
            padding: '10px 12px',
            fontFamily: FONT_BODY,
            fontStyle: 'normal',
            fontSize: 11.5,
            lineHeight: 1.5,
            color: C.black,
            width,
            boxShadow: '2px 2px 0 rgba(0,0,0,0.08)',
            whiteSpace: 'normal',
          }}
        >
          {children}
        </span>
      )}
    </span>
  );
}

function AeoStat({ label, value, hint }) {
  return (
    <div style={{ textAlign: 'right' }}>
      <div
        style={{
          fontFamily: FONT_BODY,
          fontWeight: 700,
          fontSize: 10,
          letterSpacing: '0.12em',
          textTransform: 'uppercase',
          opacity: 0.7,
          marginBottom: 4,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontFamily: FONT_DISPLAY,
          fontSize: 36,
          lineHeight: 1,
          letterSpacing: '-0.03em',
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {value}
      </div>
      {hint && (
        <div
          style={{
            fontFamily: FONT_CAPTION,
            fontStyle: 'italic',
            fontSize: 11,
            opacity: 0.6,
            marginTop: 4,
          }}
        >
          {hint}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sales Meeting Form chart — single 100%-stacked horizontal column showing
// how 28 sales prospects discovered Mutiny. Hover any segment to see the raw
// verbatim responses bucketed into that channel.
// ---------------------------------------------------------------------------
// AEOVisibilityChart — multi-line visibility chart for the AEO deep-dive.
// All 6 lines (overall + 5 topics) use real daily Peec data.
// Competitor Comparisons was added to monitoring May 5; pre-May-5 cells are
// null so the line starts cleanly mid-window rather than dragging from 0.
// Legend items are clickable to toggle lines on/off — Y-axis dynamically
// rescales to fit only the currently visible lines, so users can drill into
// low-visibility topics without Competitor Comparisons (~70%) flattening
// everything else.
// Placeholder for the LinkedIn deep-dive's right slot. Matches the
// AEOVisibilityChart's footprint so the LinkedIn card has the same visual
// weight as AEO + Search.
function LinkedInPlaceholderChart() {
  return (
    <div>
      <div style={{ marginBottom: 12 }}>
        <div
          style={{
            fontFamily: FONT_BODY,
            fontWeight: 600,
            fontSize: 14,
            display: 'flex',
            alignItems: 'baseline',
            gap: 10,
          }}
        >
          LinkedIn deep-dive · daily
          <span style={{ fontFamily: FONT_BODY, fontWeight: 400, fontSize: 11, opacity: 0.6 }}>
            Coming soon
          </span>
        </div>
      </div>
      <div
        style={{
          width: '100%',
          height: 390,
          border: `1px dashed ${C.black}`,
          borderRadius: 4,
          background: 'rgba(0,0,0,0.02)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexDirection: 'column',
          gap: 8,
          opacity: 0.55,
        }}
      >
        <div
          style={{
            fontFamily: FONT_DISPLAY,
            fontSize: 28,
            letterSpacing: '-0.02em',
            color: C.black,
          }}
        >
          Placeholder
        </div>
        <div
          style={{
            fontFamily: FONT_BODY,
            fontSize: 12,
            color: C.black,
            opacity: 0.7,
            textAlign: 'center',
            maxWidth: 280,
            lineHeight: 1.4,
          }}
        >
          Reserved for a future LinkedIn-specific drilldown (post engagement,
          impressions, or content-type breakdown).
        </div>
      </div>
    </div>
  );
}

// Shared set of lines for both AEO charts (topics + Total). Module-level so
// AEOVisibilityChart, SourceRetrievalsChart, and AEOSection share the same
// keys and colors without re-declaring.
const AEO_LINES = [
  ...AEO.topics.map((t) => ({
    key: t.name,
    label: t.name,
    color: t.color,
    strokeWidth: 1.75,
    isTotal: false,
  })),
  { key: 'Total', label: 'Total (all topics)', color: C.black, strokeWidth: 2.5, isTotal: true },
];

function AEOVisibilityChart({ visible, dailySlice = AEO.daily }) {
  const allLines = AEO_LINES;

  // Build chart dataset (0-1 ratios → 0-100 percentages; nulls flow through).
  const data = dailySlice.map((d) => {
    const row = { date: d.date, Total: +(d.visibility * 100).toFixed(2) };
    for (const t of AEO.topics) {
      const v = d[t.name];
      row[t.name] = v === null || v === undefined ? null : +(v * 100).toFixed(2);
    }
    return row;
  });

  // Y-axis: use the same niceTicks helper as the column charts so the
  // ticks are evenly spaced on round percentages (0/5/10... or 0/10/20...)
  // and there's always one full step of headroom above the max.
  const visibleKeys = allLines.filter((l) => visible[l.key]).map((l) => l.key);
  const visibleValues = data.flatMap((row) =>
    visibleKeys
      .map((k) => row[k])
      .filter((v) => v !== null && v !== undefined)
  );
  const maxVisible = visibleValues.length > 0 ? Math.max(...visibleValues) : 10;
  const { ticks: yTicks, max: yMax } = niceTicks(maxVisible, 5);

  return (
    <div>
      {/* Heading */}
      <div style={{ marginBottom: 12 }}>
        <div
          style={{
            fontFamily: FONT_BODY,
            fontWeight: 600,
            fontSize: 14,
            display: 'flex',
            alignItems: 'baseline',
            gap: 10,
          }}
        >
          Visibility · daily
          <span style={{ fontFamily: FONT_BODY, fontWeight: 400, fontSize: 11, opacity: 0.6 }}>
            % of tracked queries
          </span>
        </div>
      </div>

      {/* Chart */}
      <div style={{ width: '100%', height: 390 }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 10, right: 16, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} stroke={C.black} strokeOpacity={0.08} />
            <XAxis
              dataKey="date"
              axisLine={{ stroke: C.black }}
              tickLine={false}
              tick={{ fontFamily: FONT_BODY, fontSize: 10, fill: C.black }}
              interval="preserveStartEnd"
              minTickGap={20}
              height={28}
            />
            <YAxis
              axisLine={false}
              tickLine={false}
              tick={{ fontFamily: FONT_BODY, fontSize: 11, fill: C.black }}
              tickFormatter={(v) => `${v}%`}
              domain={[0, yMax]}
              ticks={yTicks}
              width={48}
              allowDecimals={false}
            />
            <Tooltip
              cursor={{ stroke: C.black, strokeOpacity: 0.2, strokeWidth: 1 }}
              content={({ active, payload, label }) => {
                if (!active || !payload || !payload.length) return null;
                const visiblePayload = payload.filter(
                  (p) => p.value !== null && p.value !== undefined
                );
                if (!visiblePayload.length) return null;
                return (
                  <div
                    style={{
                      background: C.white,
                      border: `1px solid ${C.black}`,
                      borderRadius: 4,
                      padding: '10px 12px',
                      fontFamily: FONT_BODY,
                      fontSize: 11,
                      minWidth: 220,
                      boxShadow: '4px 4px 0 rgba(0,0,0,0.08)',
                    }}
                  >
                    <div style={{ fontWeight: 700, marginBottom: 6 }}>{label}</div>
                    {visiblePayload.map((p) => (
                      <div
                        key={p.dataKey}
                        style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}
                      >
                        <span
                          style={{
                            width: 12,
                            height: 0,
                            borderTop: `${p.dataKey === 'Total' ? '2.5px' : '2px'} solid ${p.color || p.stroke}`,
                          }}
                        />
                        <span style={{ flex: 1 }}>{p.dataKey}</span>
                        <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>
                          {p.value}%
                        </span>
                      </div>
                    ))}
                  </div>
                );
              }}
            />
            {/* Render only the visible lines. Topics first, Total last so it overlays. */}
            {allLines.map((line) =>
              visible[line.key] ? (
                <Line
                  key={line.key}
                  type="monotone"
                  dataKey={line.key}
                  stroke={line.color}
                  strokeWidth={line.strokeWidth}
                  dot={line.isTotal ? { r: 2.5, fill: line.color } : false}
                  activeDot={{ r: line.isTotal ? 5 : 4, stroke: C.black, strokeWidth: 1 }}
                  connectNulls={false}
                  isAnimationActive={false}
                />
              ) : null
            )}
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Footnote */}
      <div
        style={{
          fontFamily: FONT_BODY,
          fontSize: 10.5,
          opacity: 0.55,
          marginTop: 10,
          lineHeight: 1.5,
        }}
      >
        Source: Peec AI · {AEO.windowLabel}. Competitor Comparisons topic added to
        monitoring May 5 (line starts then).
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// SelfReportedSourcesChart — weekly stacked column chart for one or more
// self-reported referral_source buckets from the Customer signups by channel
// pie. Reused in the AEO+Search section (AEO+Search) and the LinkedIn section
// (LinkedIn). Chart-area height matches the parent ChannelDeepDive's main
// chart so the two sit at the same visual weight side-by-side.
// ---------------------------------------------------------------------------
function SelfReportedSourcesChart({ title, targets, weeks = LIVE_WEEKS, cadenceLabel = 'weekly' }) {
  // Build per-day per-bucket counts from amplitude.referralSources entries
  // (skips entries that don't carry a daily map — old shape fallback).
  const bucketDaily = Object.fromEntries(targets.map((t) => [t.name, {}]));
  for (const entry of (dataJson.amplitude?.referralSources || [])) {
    const bucket = categorizeReferralSource(entry.source);
    if (!targets.some((t) => t.name === bucket)) continue;
    if (!entry.daily) continue;
    for (const [d, n] of Object.entries(entry.daily)) {
      bucketDaily[bucket][d] = (bucketDaily[bucket][d] || 0) + (n || 0);
    }
  }

  const data = weeks.map((w) => {
    // Reporting Mode passes weeks with `datesInRange` (clipped to range);
    // other modes pass weeks with just `dates` (full Mon-Sun).
    const dateBag = w.datesInRange || w.dates;
    const row = {
      week:            w.weekStartLabel,
      dateRange:       w.dateRange,
      partial:         (w.trailingPartial ?? w.partial) || false,
      trailingPartial: (w.trailingPartial ?? w.partial) || false,
    };
    for (const t of targets) {
      row[t.name] = dateBag.reduce((s, d) => s + (bucketDaily[t.name][d] || 0), 0);
    }
    return row;
  });
  const totalByBucket = Object.fromEntries(
    targets.map((t) => [t.name, data.reduce((s, r) => s + (r[t.name] || 0), 0)])
  );
  const totalAll = Object.values(totalByBucket).reduce((s, v) => s + v, 0);

  const maxValue = Math.max(
    ...data.map((r) => targets.reduce((s, t) => s + (r[t.name] || 0), 0)),
    1
  );
  const { ticks: yTicks, max: yMax } = niceTicks(maxValue, 5);

  const HatchedStack = (color) => (props) => {
    const { x, y, width, height, payload, dataKey } = props;
    if (!payload || height <= 0) return null;
    const isPartial = payload.partial;
    const patternId =
      `hatchsrc-${dataKey}-${(payload.week || '').replace(/[^a-zA-Z0-9]/g, '')}`;
    return (
      <g>
        {isPartial && (
          <defs>
            <pattern id={patternId} patternUnits="userSpaceOnUse" width="6" height="6" patternTransform="rotate(45)">
              <rect width="6" height="6" fill={color} fillOpacity="0.25" />
              <line x1="0" y1="0" x2="0" y2="6" stroke={color} strokeWidth="2" />
            </pattern>
          </defs>
        )}
        <rect
          x={x}
          y={y}
          width={width}
          height={height}
          fill={isPartial ? `url(#${patternId})` : color}
          stroke={C.black}
          strokeWidth={1}
        />
      </g>
    );
  };

  return (
    <div>
      {/* Heading */}
      <div style={{ marginBottom: 12 }}>
        <div
          style={{
            fontFamily: FONT_BODY,
            fontWeight: 600,
            fontSize: 14,
            display: 'flex',
            alignItems: 'baseline',
            gap: 10,
          }}
        >
          <SelfReportedTag />
          <span style={{ fontFamily: FONT_BODY, fontWeight: 400, fontSize: 11, opacity: 0.6 }}>
            {cadenceLabel}
          </span>
        </div>
      </div>

      {/* Window totals as a small summary row */}
      <div
        style={{
          display: 'flex',
          gap: 18,
          marginBottom: 14,
          fontFamily: FONT_BODY,
          fontSize: 11,
          opacity: 0.75,
          flexWrap: 'wrap',
        }}
      >
        {targets.map((t) => (
          <span key={t.name}>
            <span style={{
              display: 'inline-block', width: 10, height: 10, background: t.color,
              border: `1px solid ${C.black}`, marginRight: 6, verticalAlign: '-1px',
            }} />
            {t.name} <strong>{totalByBucket[t.name]}</strong>
          </span>
        ))}
        {targets.length > 1 && (
          <span style={{ opacity: 0.7 }}>· Total <strong>{totalAll}</strong></span>
        )}
      </div>

      {/* Stacked column chart — height matches ChannelDeepDive's main chart */}
      <div style={{ width: '100%', height: 390 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 12, right: 8, bottom: 8, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.1)" vertical={false} />
            <XAxis
              dataKey="week"
              axisLine={{ stroke: C.black, strokeWidth: 1 }}
              tickLine={false}
              tick={{ fontFamily: FONT_BODY, fontSize: 11, fill: C.black }}
              interval={0}
            />
            <YAxis
              axisLine={false}
              tickLine={false}
              tick={{ fontFamily: FONT_BODY, fontSize: 10, fill: C.black, opacity: 0.6 }}
              width={40}
              domain={[0, yMax]}
              ticks={yTicks}
              allowDecimals={false}
            />
            <Tooltip
              content={({ active, payload }) => {
                if (!active || !payload || !payload.length) return null;
                const d = payload[0].payload;
                const tot = targets.reduce((s, t) => s + (d[t.name] || 0), 0);
                return (
                  <div
                    style={{
                      background: C.white,
                      border: `1px solid ${C.black}`,
                      padding: '8px 10px',
                      fontFamily: FONT_BODY,
                      fontSize: 12,
                      minWidth: 170,
                    }}
                  >
                    <div style={{ fontWeight: 700, marginBottom: 4 }}>
                      {d.dateRange}{d.partial ? ' · in progress' : ''}
                    </div>
                    {targets.map((t) => (
                      <div
                        key={t.name}
                        style={{ display: 'flex', justifyContent: 'space-between' }}
                      >
                        <span>{t.name}</span>
                        <strong>{d[t.name] ?? 0}</strong>
                      </div>
                    ))}
                    {targets.length > 1 && (
                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          borderTop: '1px solid rgba(0,0,0,0.1)',
                          marginTop: 4,
                          paddingTop: 4,
                        }}
                      >
                        <span>Total</span>
                        <strong>{tot}</strong>
                      </div>
                    )}
                  </div>
                );
              }}
              cursor={{ fill: 'rgba(0,0,0,0.04)' }}
            />
            {targets.map((t) => (
              <Bar
                key={t.name}
                dataKey={t.name}
                stackId="a"
                shape={HatchedStack(t.color)}
                maxBarSize={48}
                isAnimationActive={false}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Footnote */}
      <div
        style={{
          fontFamily: FONT_BODY,
          fontSize: 10.5,
          opacity: 0.55,
          marginTop: 10,
          lineHeight: 1.5,
        }}
      >
        From the Customer signups by channel chart, broken down by week.
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// SourceRetrievalsChart — daily count of how often mutinyhq.com is retrieved
// as a citation source by AI search engines, broken down by topic. Uses the
// same topic-line + Total convention as AEOVisibilityChart, and reads
// `visible` from a shared parent so both charts toggle in lockstep.
// ---------------------------------------------------------------------------
function SourceRetrievalsChart({ visible, dailySlice = AEO.sourcesDaily }) {
  const allLines = AEO_LINES;
  const data = dailySlice;

  const visibleKeys = allLines.filter((l) => visible[l.key]).map((l) => l.key);
  const visibleValues = data.flatMap((row) =>
    visibleKeys.map((k) => row[k]).filter((v) => v !== null && v !== undefined)
  );
  const maxVisible = visibleValues.length > 0 ? Math.max(...visibleValues) : 10;
  const { ticks: yTicks, max: yMax } = niceTicks(maxVisible, 5);

  return (
    <div>
      <div style={{ marginBottom: 12 }}>
        <div
          style={{
            fontFamily: FONT_BODY,
            fontWeight: 600,
            fontSize: 14,
            display: 'flex',
            alignItems: 'baseline',
            gap: 10,
          }}
        >
          mutinyhq.com retrievals · daily
          <span style={{ fontFamily: FONT_BODY, fontWeight: 400, fontSize: 11, opacity: 0.6 }}>
            chats per day that retrieved mutinyhq.com
          </span>
        </div>
      </div>

      <div style={{ width: '100%', height: 390 }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 10, right: 16, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} stroke={C.black} strokeOpacity={0.08} />
            <XAxis
              dataKey="date"
              axisLine={{ stroke: C.black }}
              tickLine={false}
              tick={{ fontFamily: FONT_BODY, fontSize: 10, fill: C.black }}
              interval="preserveStartEnd"
              minTickGap={20}
              height={28}
            />
            <YAxis
              axisLine={false}
              tickLine={false}
              tick={{ fontFamily: FONT_BODY, fontSize: 11, fill: C.black }}
              domain={[0, yMax]}
              ticks={yTicks}
              width={44}
              allowDecimals={false}
            />
            <Tooltip
              cursor={{ stroke: C.black, strokeOpacity: 0.2, strokeWidth: 1 }}
              content={({ active, payload, label }) => {
                if (!active || !payload || !payload.length) return null;
                const visiblePayload = payload.filter(
                  (p) => p.value !== null && p.value !== undefined
                );
                if (!visiblePayload.length) return null;
                return (
                  <div
                    style={{
                      background: C.white,
                      border: `1px solid ${C.black}`,
                      borderRadius: 4,
                      padding: '10px 12px',
                      fontFamily: FONT_BODY,
                      fontSize: 11,
                      minWidth: 220,
                      boxShadow: '4px 4px 0 rgba(0,0,0,0.08)',
                    }}
                  >
                    <div style={{ fontWeight: 700, marginBottom: 6 }}>{label}</div>
                    {[...visiblePayload]
                      .sort((a, b) => b.value - a.value)
                      .map((p) => (
                        <div
                          key={p.dataKey}
                          style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}
                        >
                          <span
                            style={{
                              width: 12,
                              height: 0,
                              borderTop: `${p.dataKey === 'Total' ? '2.5px' : '2px'} solid ${p.color || p.stroke}`,
                            }}
                          />
                          <span style={{ flex: 1 }}>{p.dataKey}</span>
                          <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>
                            {p.value}
                          </span>
                        </div>
                      ))}
                  </div>
                );
              }}
            />
            {allLines.map((line) =>
              visible[line.key] ? (
                <Line
                  key={line.key}
                  type="monotone"
                  dataKey={line.key}
                  stroke={line.color}
                  strokeWidth={line.strokeWidth}
                  dot={line.isTotal ? { r: 2.5, fill: line.color } : false}
                  activeDot={{ r: line.isTotal ? 5 : 4, stroke: C.black, strokeWidth: 1 }}
                  connectNulls={false}
                  isAnimationActive={false}
                />
              ) : null
            )}
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div
        style={{
          fontFamily: FONT_BODY,
          fontSize: 10.5,
          opacity: 0.55,
          marginTop: 10,
          lineHeight: 1.5,
        }}
      >
        Source: Peec AI · {AEO.windowLabel}. Counts chats per day where
        mutinyhq.com appeared as a citation source, broken down by topic
        (matches Peec UI's Sources view).
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// AEOSection — wrapper that owns the shared topic-legend state and renders
// both AEO charts (Visibility + Source Retrievals for mutinyhq.com) side by
// side. Toggling a topic pill applies to BOTH charts simultaneously.
// ---------------------------------------------------------------------------
function AEOSection({ windowStartISO, windowEndISO, windowLabel, windowDays }) {
  const allLines = AEO_LINES;
  const [visible, setVisible] = useState(
    Object.fromEntries(allLines.map((l) => [l.key, l.isTotal]))
  );

  // Range comes from the parent (main mode toggle). Compute prior window
  // as same length, immediately preceding.
  const parseISO = (iso) => {
    if (!iso) return null;
    const [y, m, d] = iso.split('-').map((x) => parseInt(x, 10));
    return new Date(Date.UTC(y, m - 1, d));
  };
  const fmtISO = (d) =>
    `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;

  const winStart   = parseISO(windowStartISO);
  const winEnd     = parseISO(windowEndISO);
  const winDays    = winStart && winEnd
    ? Math.round((winEnd - winStart) / 86400000) + 1
    : (windowDays || 0);
  const priorEnd   = winStart ? new Date(winStart.getTime() - 86400000) : null;
  const priorStart = priorEnd && winDays > 0
    ? new Date(priorEnd.getTime() - (winDays - 1) * 86400000)
    : null;
  const priorStartISO = priorStart ? fmtISO(priorStart) : null;
  const priorEndISO   = priorEnd   ? fmtISO(priorEnd)   : null;

  // Each AEO array has either `rawDate` (ISO, on `daily` / `sourcesDaily`) or
  // `date` (ISO, on `brandDailyStats` / `sourcesDailyStats`). Filter by ISO.
  const isoOf = (r) => r.rawDate || r.date;
  const filterRange = (arr, sISO, eISO) => {
    if (!sISO || !eISO) return [];
    return (arr || []).filter((r) => {
      const iso = isoOf(r);
      return iso >= sISO && iso <= eISO;
    });
  };

  // Filtered slices used by the charts + stats blocks
  const visDaily   = filterRange(AEO.daily,          windowStartISO, windowEndISO);
  const srcDaily   = filterRange(AEO.sourcesDaily,   windowStartISO, windowEndISO);
  const brandStats = filterRange(AEO.brandDailyStats, windowStartISO, windowEndISO);
  const srcStats   = filterRange(AEO.sourcesDailyStats, windowStartISO, windowEndISO);
  // Prior-window equivalents — same N days immediately preceding the active window.
  const brandStatsPrev = filterRange(AEO.brandDailyStats,   priorStartISO, priorEndISO);
  const srcStatsPrev   = filterRange(AEO.sourcesDailyStats, priorStartISO, priorEndISO);

  // Reducers — extracted so we can compute current + prior windows with one fn.
  const reduceBrand = (rows) => rows.reduce(
    (a, r) => ({
      visCount: a.visCount + r.visCount,
      visTotal: a.visTotal + r.visTotal,
      mentions: a.mentions + r.mentions,
    }),
    { visCount: 0, visTotal: 0, mentions: 0 },
  );
  const reduceSrc = (rows) => rows.reduce(
    (a, r) => {
      const totalChats = r.retrievalRate > 0 ? r.retrievalCount / r.retrievalRate : 0;
      const chatsWithDomain = r.retrievedPct * totalChats;
      return {
        totalChats:        a.totalChats + totalChats,
        chatsWithDomain:   a.chatsWithDomain + chatsWithDomain,
        retrievalCount:    a.retrievalCount + r.retrievalCount,
        citationCount:     a.citationCount + r.citationCount,
      };
    },
    { totalChats: 0, chatsWithDomain: 0, retrievalCount: 0, citationCount: 0 },
  );

  // Window aggregates — sum raw counts so percentages reflect the window,
  // not an average of per-day ratios.
  const brandWin     = reduceBrand(brandStats);
  const brandWinPrev = reduceBrand(brandStatsPrev);
  const brandVisPct  = brandWin.visTotal > 0
    ? (brandWin.visCount / brandWin.visTotal) * 100
    : 0;
  const brandVisPctPrev = brandWinPrev.visTotal > 0
    ? (brandWinPrev.visCount / brandWinPrev.visTotal) * 100
    : 0;

  const srcWin     = reduceSrc(srcStats);
  const srcWinPrev = reduceSrc(srcStatsPrev);
  const srcRetrievedPct = srcWin.totalChats > 0
    ? (srcWin.chatsWithDomain / srcWin.totalChats) * 100
    : 0;
  const srcRetrievedPctPrev = srcWinPrev.totalChats > 0
    ? (srcWinPrev.chatsWithDomain / srcWinPrev.totalChats) * 100
    : 0;
  const srcCitationRate = srcWin.retrievalCount > 0
    ? srcWin.citationCount / srcWin.retrievalCount
    : 0;

  // Helper — relative % change for COUNTS (e.g. # of retrievals).
  const pctChange = (curr, prev) => {
    if (!Number.isFinite(prev) || prev === 0) return null;
    return ((curr - prev) / prev) * 100;
  };
  // Helper — absolute percentage-POINT change for PERCENTAGE metrics
  // (Visibility%, Retrieved%). Matches Peec UI semantics: 21% vs 18.3% = +2.7pp.
  const ppChange = (curr, prev) => {
    if (!Number.isFinite(prev)) return null;
    return curr - prev;
  };
  // Deltas for the three stat tiles. null when prior window is empty.
  const hasPrev          = brandStatsPrev.length > 0 || srcStatsPrev.length > 0;
  const visPctDelta      = hasPrev ? ppChange(brandVisPct, brandVisPctPrev) : null;
  const retrievedDelta   = hasPrev ? ppChange(srcRetrievedPct, srcRetrievedPctPrev) : null;
  const retrievalsDelta  = hasPrev ? pctChange(srcWin.chatsWithDomain, srcWinPrev.chatsWithDomain) : null;

  // Compact stat-row used above each chart.
  const StatRow = ({ title, items }) => (
    <div
      style={{
        display: 'flex',
        alignItems: 'baseline',
        gap: 18,
        marginBottom: 14,
        paddingBottom: 12,
        borderBottom: `1px solid rgba(0,0,0,0.1)`,
        flexWrap: 'wrap',
      }}
    >
      <div
        style={{
          fontFamily: FONT_DISPLAY,
          fontSize: 18,
          letterSpacing: '-0.02em',
          fontWeight: 400,
        }}
      >
        {title}
      </div>
      {items.map((it) => (
        <div key={it.label}>
          <div
            style={{
              fontFamily: FONT_BODY,
              fontWeight: 700,
              fontSize: 9.5,
              letterSpacing: '0.12em',
              textTransform: 'uppercase',
              opacity: 0.55,
            }}
          >
            {it.label}
          </div>
          <div
            style={{
              display: 'flex',
              alignItems: 'baseline',
              gap: 8,
              marginTop: 2,
            }}
          >
            <div
              style={{
                fontFamily: FONT_DISPLAY,
                fontSize: 22,
                lineHeight: 1.1,
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {it.value}
            </div>
            {it.delta !== undefined && it.delta !== null && Number.isFinite(it.delta) && (
              <Delta value={it.delta} suffix={it.deltaSuffix || '%'} precision={1} />
            )}
          </div>
        </div>
      ))}
    </div>
  );

  return (
    <section
      style={{
        background: C.white,
        border: `1px solid ${C.black}`,
        borderRadius: 4,
        padding: '28px 32px 24px',
        marginBottom: 40,
        position: 'relative',
      }}
    >
      {/* Header row: date range toggle on right, topic legend below */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          gap: 16,
          marginBottom: 14,
        }}
      >
        <div>
          <div
            style={{
              fontFamily: FONT_BODY,
              fontWeight: 700,
              fontSize: 10,
              letterSpacing: '0.12em',
              textTransform: 'uppercase',
              opacity: 0.6,
              marginBottom: 8,
            }}
          >
            Filter topics — applies to both charts
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 6px' }}>
            {[allLines[allLines.length - 1], ...allLines.slice(0, -1)].map((line) => {
              const isOn = visible[line.key];
              return (
                <button
                  key={line.key}
                  onClick={() =>
                    setVisible((v) => ({ ...v, [line.key]: !v[line.key] }))
                  }
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 5,
                    background: isOn ? 'rgba(0,0,0,0.04)' : 'transparent',
                    border: `1px solid ${isOn ? C.black : 'rgba(0,0,0,0.2)'}`,
                    borderRadius: 999,
                    padding: '4px 10px 4px 7px',
                    cursor: 'pointer',
                    fontFamily: FONT_BODY,
                    fontSize: 12,
                    color: C.black,
                    opacity: isOn ? 1 : 0.45,
                    transition: 'opacity 80ms, background 80ms, border-color 80ms',
                  }}
                  type="button"
                >
                  <span
                    style={{
                      display: 'inline-block',
                      width: 16,
                      height: 0,
                      borderTop: `${line.isTotal ? '2.5px' : '2px'} solid ${line.color}`,
                    }}
                  />
                  <span
                    style={{
                      fontWeight: line.isTotal ? 700 : 400,
                      textDecoration: isOn ? 'none' : 'line-through',
                    }}
                  >
                    {line.label}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Range — passive label; AEO follows the top-of-page mode toggle. */}
        <div style={{ flexShrink: 0, textAlign: 'right' }}>
          <div
            style={{
              fontFamily: FONT_BODY,
              fontWeight: 700,
              fontSize: 10,
              letterSpacing: '0.12em',
              textTransform: 'uppercase',
              opacity: 0.6,
              marginBottom: 4,
            }}
          >
            Range
          </div>
          <div
            style={{
              fontFamily: FONT_BODY,
              fontSize: 11,
              fontWeight: 600,
              padding: '4px 10px',
              border: `1px solid ${C.black}`,
              borderRadius: 4,
              display: 'inline-block',
            }}
          >
            {windowLabel || `${winDays} days`}
          </div>
        </div>
      </div>

      {/* Two charts side-by-side, each with a stat-row header */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(2, 1fr)',
          gap: 28,
          alignItems: 'flex-start',
          marginTop: 18,
        }}
      >
        <div>
          <StatRow
            title="Mutiny"
            items={[
              { label: 'Visibility', value: `${brandVisPct.toFixed(1)}%`, delta: visPctDelta, deltaSuffix: 'pp' },
            ]}
          />
          <AEOVisibilityChart visible={visible} dailySlice={visDaily} />
        </div>
        <div>
          <StatRow
            title="mutinyhq.com"
            items={[
              { label: 'Retrieved', value: `${srcRetrievedPct.toFixed(1)}%`, delta: retrievedDelta, deltaSuffix: 'pp' },
              {
                label: '# of retrievals',
                // Matches Peec UI: counts CHATS where mutinyhq.com appeared
                // as a citation source (not URL-level retrievals).
                value: Math.round(srcWin.chatsWithDomain).toLocaleString(),
                delta: retrievalsDelta,
              },
            ]}
          />
          <SourceRetrievalsChart visible={visible} dailySlice={srcDaily} />
        </div>
      </div>
    </section>
  );
}

// ChannelDeepDive — single-channel OR stacked multi-channel deep-dive card.
// `data.series` is an array of { key, label, color }. One entry = single bar
// per week. Multiple entries = stacked column. Header: square icon + name +
// subtitle (left), KPI tile with the window total (right). Ghost-placeholder
// bars render for empty/future weeks.
function ChannelDeepDive({ data, weekly, signupsWindow, windowLabel, extraChart }) {
  const seriesKeys = data.series.map((s) => s.key);
  const rowTotal = (w) => seriesKeys.reduce((s, k) => s + (w[k] || 0), 0);
  // Y-axis: niceTicks gives uniform clean intervals (1/2/2.5/5/10 × 10ⁿ).
  const maxValue = Math.max(...weekly.map((w) => rowTotal(w) + (w._ghost || 0)), 1);
  const { ticks: yTicks, max: yMax } = niceTicks(maxValue, 5);

  return (
    <section
      style={{
        background: C.white,
        border: `1px solid ${C.black}`,
        borderRadius: 4,
        padding: '28px 32px 24px',
        marginBottom: 40,
        position: 'relative',
      }}
    >
      {/* Data-availability ribbon — same plg_signup_click setup story as the
          parent Signup Form Clicks by Channel section. */}
      <div
        style={{
          margin: '-28px -32px 24px',
          padding: '12px 22px',
          background: '#FFF6D6',
          borderBottom: `1px solid ${C.black}`,
          borderTopLeftRadius: 4,
          borderTopRightRadius: 4,
          fontFamily: FONT_BODY,
          fontSize: 12.5,
          lineHeight: 1.55,
          display: 'flex',
          alignItems: 'flex-start',
          gap: 10,
        }}
      >
        <span style={{ fontSize: 14, lineHeight: 1, marginTop: 1 }}>⚠️</span>
        <div>
          Reliable programmatic GA4 data begins <strong>Wednesday, {ATTRIBUTION_START_LABEL}</strong>.
        </div>
      </div>

      {/* Header row: icon + name + subtitle (left), KPI (right) */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          gap: 24,
          marginBottom: 26,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          {/* Icon badge */}
          <div
            style={{
              width: 44,
              height: 44,
              background: data.iconBg,
              border: `1px solid ${C.black}`,
              borderRadius: 6,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontFamily: FONT_DISPLAY,
              fontSize: 22,
              fontWeight: 400,
              lineHeight: 1,
              flexShrink: 0,
            }}
          >
            {data.iconLabel}
          </div>
          <div>
            <h2
              style={{
                fontFamily: FONT_DISPLAY,
                fontWeight: 400,
                fontSize: 32,
                lineHeight: 1,
                letterSpacing: '-0.03em',
                margin: 0,
                display: 'flex',
                alignItems: 'center',
                gap: 10,
              }}
            >
              {data.name}
            </h2>
            <div
              style={{
                fontFamily: FONT_BODY,
                fontSize: 13,
                opacity: 0.65,
                marginTop: 6,
                lineHeight: 1.4,
              }}
            >
              {data.subtitle}
            </div>
          </div>
        </div>

        {/* (KPI tile removed — section totals now surface in the chart
            cards below instead of the deep-dive header.) */}
      </div>

      {/* Chart area — single column or 2-col grid based on extraChart prop */}
      <div
        style={
          extraChart
            ? { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 28, alignItems: 'start' }
            : undefined
        }
      >
      <div>
      {/* Chart heading */}
      <div style={{ marginBottom: 12 }}>
        <div
          style={{
            fontFamily: FONT_BODY,
            fontWeight: 600,
            fontSize: 14,
            display: 'flex',
            alignItems: 'baseline',
            gap: 10,
          }}
        >
          <ProgrammaticTag />
          <span style={{ fontFamily: FONT_BODY, fontWeight: 400, fontSize: 11, opacity: 0.6 }}>
            Self-serve signup clicks{data.series.length > 1 ? ' · stacked by channel' : ''}
          </span>
        </div>
      </div>

      {/* Legend — one swatch per series. Single-channel deep-dives still
          render their swatch for visual consistency. */}
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: '6px 14px',
          marginBottom: 14,
          fontFamily: FONT_BODY,
          fontSize: 11,
        }}
      >
        {data.series.map((s) => (
          <div key={s.key} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <span
              style={{
                width: 10,
                height: 10,
                background: s.color,
                border: `1px solid ${C.black}`,
                borderRadius: 1,
              }}
            />
            <span>{s.label}</span>
          </div>
        ))}
      </div>

      {/* Chart */}
      <div style={{ width: '100%', height: 390 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={weekly}
            barCategoryGap="22%"
            margin={{ top: 10, right: 8, bottom: 0, left: -10 }}
          >
            <CartesianGrid vertical={false} stroke={C.black} strokeOpacity={0.08} />
            <XAxis
              dataKey="week"
              axisLine={{ stroke: C.black }}
              tickLine={false}
              interval={0}
              height={48}
              tick={makeWeekTick(
                weekly.reduce((acc, r) => ({ ...acc, [r.week]: r.dateRange }), {})
              )}
            />
            <YAxis
              axisLine={false}
              tickLine={false}
              tick={{ fontFamily: FONT_BODY, fontSize: 11, fill: C.black }}
              domain={[0, yMax]}
              ticks={yTicks}
              allowDecimals={false}
              width={32}
            />
            <Tooltip
              cursor={{ fill: 'rgba(0,0,0,0.04)' }}
              content={({ active, payload, label }) => {
                if (!active || !payload || !payload.length) return null;
                const row = weekly.find((r) => r.week === label);
                if (!row) return null;
                return (
                  <div
                    style={{
                      background: C.white,
                      border: `1px solid ${C.black}`,
                      borderRadius: 4,
                      padding: '10px 12px',
                      fontFamily: FONT_BODY,
                      fontSize: 11,
                      minWidth: 180,
                      boxShadow: '4px 4px 0 rgba(0,0,0,0.08)',
                    }}
                  >
                    <div style={{ fontWeight: 700, marginBottom: 4 }}>
                      {row.week} · {row.dateRange}
                      {row.partial && (
                        <span style={{ fontWeight: 400, opacity: 0.6, marginLeft: 6 }}>
                          · partial
                        </span>
                      )}
                    </div>
                    {!row.populated ? (
                      <div style={{ opacity: 0.6, fontStyle: 'italic' }}>
                        Future week — placeholder for upcoming data.
                      </div>
                    ) : (
                      <>
                        {data.series.map((s) => (
                          <div
                            key={s.key}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: 6,
                              marginTop: 2,
                            }}
                          >
                            <span
                              style={{
                                width: 8,
                                height: 8,
                                background: s.color,
                                border: `1px solid ${C.black}`,
                                flexShrink: 0,
                              }}
                            />
                            <span style={{ flex: 1 }}>{s.label}</span>
                            <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>
                              {row[s.key] || 0}
                            </span>
                          </div>
                        ))}
                        {data.series.length > 1 && (
                          <div
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: 6,
                              marginTop: 6,
                              paddingTop: 6,
                              borderTop: `1px solid rgba(0,0,0,0.15)`,
                              fontWeight: 600,
                            }}
                          >
                            <span style={{ flex: 1 }}>Total</span>
                            <span style={{ fontVariantNumeric: 'tabular-nums' }}>
                              {rowTotal(row)}
                            </span>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                );
              }}
            />
            {data.series.map((s) => (
              <Bar
                key={s.key}
                dataKey={s.key}
                stackId="deepdive"
                shape={makeHatchedBarShape(s.color, {
                  strokeWidth: 0.6,
                  idPrefix: 'cd',
                })}
                isAnimationActive={false}
              />
            ))}
            <Bar
              dataKey="_ghost"
              stackId="deepdive"
              fill="transparent"
              stroke={C.black}
              strokeDasharray="4 4"
              strokeOpacity={0.22}
              isAnimationActive={false}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
      </div>

      {/* Right slot: optional secondary chart (e.g. AEO visibility line) */}
      {extraChart}
      </div>

      {/* Right accent stripe */}
      <div
        style={{
          position: 'absolute',
          right: -1,
          top: -1,
          width: 8,
          height: 36,
          background: data.accentColor,
          border: `1px solid ${C.black}`,
        }}
      />
    </section>
  );
}
