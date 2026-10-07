// ---------------------------------------------------------------------------
// Beta growth dashboard — rendered only when the URL has ?beta (see
// src/main.jsx). Rebuild of the dashboard following the Lovable blueprint's
// layout, in Mutiny brand styling (Fraunces / Manrope, purple · green · red ·
// blue, black 1px borders). The current dashboard is untouched.
//
// Layout: "PLG funnel at a glance" with two lines —
//   line 1: Website visitors → User sign ups → Activated (live data)
//   line 2: Paid → Retained → Expanding companies (stripe-dash, coming soon)
// Clicking a step switches which section's charts show below (also kept in
// the URL hash, e.g. ?beta#activation, so a view can be shared).
//
// Data:
//   Website visitors  ← GA4 engaged sessions (src/data.json → ga4.file1), same
//                       metric as the current dashboard's "Website Visitors".
//   Signups           ← Metabase signups export → src/beta-signups.json
//                       (npm run ingest-signups). One row = one user+company
//                       signup; never deduped.
// ---------------------------------------------------------------------------
import React, { useEffect, useState } from 'react';
import {
  ResponsiveContainer, ComposedChart, BarChart, LineChart, Bar, Line, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip,
} from 'recharts';
import { ArrowUpRight, ArrowDownRight, ArrowRight, MousePointerClick } from 'lucide-react';
import dataJson from './src/data.json';
import betaSignups from './src/beta-signups.json';
import betaPaying from './src/beta-paying.json';
import betaCredits from './src/beta-credits.json';
import { categorizeReferralSource } from './channel-categorization.js';

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
const SIGNUPS = betaSignups.signups;
const ENGAGED_BY_DATE = Object.fromEntries(
  dataJson.ga4.file1.map((r) => [`${r.date.slice(0, 4)}-${r.date.slice(4, 6)}-${r.date.slice(6)}`, r.engagedSessions]),
);

const DATA_START = betaSignups.firstDate;
const DATA_END = betaSignups.lastDate;
const inRange = (d, a, b) => d >= a && d <= b;

// Reporting periods (Nick, Oct 7). Four pills:
//   1w  — Last week: last complete Mon–Sun week vs the week before (weekly review).
//   4w  — Last 4 weeks (default): last 4 complete weeks vs the 4 before (trend).
//   qtd — Quarter to date (FISCAL quarter, see FISCAL_START_MONTH): first day of the quarter → latest data day, vs the
//         same number of days at the start of last quarter. Charts show last
//         quarter + this one, so the two can be compared.
//   ytd — Fiscal year to date: Feb 1 → latest data day. No prior-year data exists
//         (signups count from Feb 16, Stripe from Mar 26), so no comparison
//         deltas (noPrior). Charts show every week since Jan 1.
// 1w/4w use COMPLETE weeks only; the week in progress is shown separately as
// "week to date" (WTD). QTD/YTD run to the latest day, so they include it.
// The Companies line compares with a fixed earlier date per period (see
// the start of the period). Daily series are built for the longest chart.
const MODES = {
  '1w': { label: 'Last week', short: '1w', long: 'last week', prior: 'prior week', tag: 'LW', weeks: 1 },
  '4w': { label: 'Last 4 weeks', short: '4w', long: 'last 4 weeks', prior: 'prior 4 weeks', tag: 'L4W', weeks: 4 },
  qtd: { label: 'Quarter to date', short: 'QTD', long: 'fiscal quarter to date', prior: 'same days last quarter', tag: 'QTD' },
  ytd: { label: 'Year to date', short: 'YTD', long: 'fiscal year to date', prior: 'no prior year', tag: 'YTD', noPrior: true },
};
const DEFAULT_MODE = '4w';
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
// Chart frame (Nick, Oct 7): weekly charts never show less than the current
// fiscal quarter. Last week / Last 4 weeks / QTD all chart the quarter's weeks;
// only Fiscal YTD goes further back. Two safeguards: at least MIN_CHART_WEEKS
// weeks (early in a quarter the frame reaches into the previous one), and
// the frame always covers the selected period. Last week / Last 4 weeks start
// on the quarter's first FULL week; QTD / YTD start on the period's first day,
// so the first bar can be a short (clipped) week and the bars add up exactly
// to the headline.
const MIN_CHART_WEEKS = 6;
function makeWindow(mode) {
  const cfg = MODES[mode];
  const mon = mondayOf(DATA_END);
  const qs = quarterStart(DATA_END);
  const qFirstFull = mondayOf(qs) === qs ? qs : addDays(mondayOf(qs), 7);
  const floor = addDays(mon, -7 * (MIN_CHART_WEEKS - 1));
  const minISO = (...xs) => xs.sort()[0];
  let END;
  let START;
  let PRIOR_START;
  let PRIOR_END;
  let chartStart;
  if (mode === 'qtd') {
    END = DATA_END;
    START = qs;
    PRIOR_START = addMonthsISO(START, -3);
    const span = daysBetweenISO(START, END);
    PRIOR_END = addDays(PRIOR_START, span) < START ? addDays(PRIOR_START, span) : addDays(START, -1);
    chartStart = floor < qs ? floor : qs;
  } else if (mode === 'ytd') {
    END = DATA_END;
    START = fiscalYearStart(DATA_END);
    PRIOR_END = addDays(START, -1); // no data there; deltas are hidden (noPrior)
    PRIOR_START = addDays(START, -(daysBetweenISO(START, END) + 1));
    chartStart = minISO(START, floor);
  } else {
    END = addDays(mon, 6) === DATA_END ? DATA_END : addDays(mon, -1); // last complete Sunday
    START = addDays(END, -(7 * cfg.weeks - 1));
    PRIOR_END = addDays(START, -1);
    PRIOR_START = addDays(START, -7 * cfg.weeks);
    chartStart = minISO(qFirstFull, floor, START);
  }
  if (chartStart < DATA_START) chartStart = DATA_START;
  const WTD = END < DATA_END ? { start: addDays(END, 1), end: DATA_END } : null;
  const WEEKS = [];
  for (let w = mondayOf(chartStart); w <= DATA_END; w = addDays(w, 7)) {
    const sun = addDays(w, 6);
    const start = w < chartStart ? chartStart : w; // first week may be clipped to the period's first day
    WEEKS.push({ start, end: sun, label: monDay(start), partial: sun > DATA_END, clipped: start !== w, range: rangeLabel(start, sun > DATA_END ? DATA_END : sun) });
  }
  // Pill / header label names the fiscal quarter, e.g. "Q3 to date".
  const label = mode === 'qtd' ? `Q${fiscalQuarter(DATA_END)} to date` : mode === 'ytd' ? 'Fiscal YTD' : cfg.label;
  return { mode, ...cfg, label, END, START, PRIOR_START, PRIOR_END, WTD, WEEKS };
}

const sumEngaged = (a, b) => {
  let s = 0;
  for (let d = a; d <= b; d = addDays(d, 1)) s += ENGAGED_BY_DATE[d] || 0;
  return s;
};
// Signup COUNTS start on SIGNUP_COUNT_START, same as the live dashboard (when
// [Onboarding] User Setup Complete began firing). Earlier signups are still
// kept in SIGNUPS: anything they do later (setup, meetings, sends, activation)
// still counts — only the signup metric itself ignores them.
const SIGNUP_COUNT_START = '2026-02-16';
const signupsIn = (a, b) => SIGNUPS.filter((s) => s.d >= SIGNUP_COUNT_START && inRange(s.d, a, b));
const COUNTED_SIGNUPS = SIGNUPS.filter((s) => s.d >= SIGNUP_COUNT_START).length;
const pctChange = (curr, prev) => (prev ? ((curr - prev) / prev) * 100 : null);
const pct = (n, d) => (d ? (n / d) * 100 : null);
const ptsDiff = (a, b) => (a != null && b != null ? a - b : null);

// --- Channels (GA4) -------------------------------------------------------------
// Same bucketing as the live dashboard (mutiny_growth_dashboard.jsx →
// SIGNUPS_BUCKETING_RULES / bucketSignupEntry): source/medium regexes first,
// then GA4's channel group as fallback. Keep the two in sync.
const CHANNEL_RULES = [
  { match: /^chatgpt\.com$|^claude\.com$|^claude\.ai$|^perplexity\.ai$|^gemini\.google\.com$|^bard\.google\.com$|^copilot\.microsoft\.com$|^poe\.com$|chatgpt|^claude$|perplexity/i, bucket: 'AEO' },
  { match: /linkedin/i, bucket: 'LinkedIn' },
  { match: /twitter|^x\.com$|^t\.co$|reddit|facebook|^fb\.|instagram|^ig$/i, bucket: 'Social' },
  { match: /^google$|^bing$|^duckduckgo$|^yahoo$|^brave$|^ecosia$|^qwant$|^baidu$|^yandex$/i, bucket: 'Search' },
  { match: /^email$|newsletter|mailchimp|^hs_email$/i, bucket: 'Email' },
  { match: /^\(direct\)$/i, bucket: 'Direct' },
];
const CHANNEL_FALLBACK = {
  'Direct': 'Direct', 'Organic Search': 'Search', 'Organic Social': 'Social', 'Referral': 'Referral',
  'Paid Search': 'Search', 'Paid Social': 'Social', 'Email': 'Email', 'Unassigned': 'Unassigned', 'AI Referrals': 'AEO',
};
function channelOf(row) {
  const [source = '', medium = ''] = String(row.sourceMedium || '').split('/').map((s) => s.trim());
  for (const r of CHANNEL_RULES) if (r.match.test(source) || r.match.test(medium)) return r.bucket;
  return CHANNEL_FALLBACK[row.channelGroup] || 'Unassigned';
}
// Bottom → top stack order and colors, as on the live dashboard.
const CHANNELS = [
  { key: 'Direct', color: C.lightGrey },
  { key: 'Search', color: C.blue },
  { key: 'Referral', color: C.purple },
  { key: 'Social', color: C.lightPurple },
  { key: 'LinkedIn', color: '#0A66C2' },
  { key: 'Email', color: C.red },
  { key: 'Unassigned', color: '#D5D5D5' },
  { key: 'AEO', color: C.green },
];
const gaISO = (d) => `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6)}`;
const GA_SESSIONS = dataJson.ga4.file3.map((r) => ({ d: gaISO(r.date), ch: channelOf(r), n: r.engagedSessions || 0 }));
function sumByChannel(rows, a, b) {
  const out = Object.fromEntries(CHANNELS.map((c) => [c.key, 0]));
  for (const r of rows) if (r.d >= a && r.d <= b) out[r.ch] = (out[r.ch] || 0) + r.n;
  return out;
}
const sumVals = (o) => Object.values(o).reduce((s, v) => s + v, 0);

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
const isSetUp = (s) => Boolean(s.rec && s.cal && s.em);
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
const setupDate = (s) => (isSetUp(s) ? [s.rec, s.cal, s.em].sort()[2] : null);
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
const activatedIn = (a, b) => SIGNUPS.filter((s) => { const d = actDate(s); return d && inRange(d, a, b); });
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
// Completed onboarding = installed the call recorder AND connected email (Gmail)
// AND connected Google Calendar; dated by the last of the three (setupDate).
// Like activation, users who signed up before Feb 16 count when they complete.
const onbDate = (s) => setupDate(s);
const onboardedIn = (a, b) => SIGNUPS.filter((s) => { const d = onbDate(s); return d && inRange(d, a, b); });
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
const FIRST_EM_TRACKED = firstOf('em');
// CONV[window][key] — precomputed for every window option.
const CONV = Object.fromEntries(CONV_WINDOWS.map((w) => [w, {
  ACT: makeDailyConv(actDate, null, w),
  ONB: makeDailyConv(onbDate, FIRST_REC_TRACKED, w),
  REC: makeDailyConv((s) => s.rec, FIRST_REC_TRACKED, w),
  EM: makeDailyConv((s) => s.em, FIRST_EM_TRACKED, w),
  CAL: makeDailyConv((s) => s.cal, FIRST_CAL_TRACKED, w),
}]));
const ConvWindowCtx = React.createContext([DEFAULT_CONV_WINDOW, () => {}]);
const useConvWindow = () => React.useContext(ConvWindowCtx);


// --- Channel deep dive ------------------------------------------------------------



// Self-reported channel ("How did you hear about us?") — Amplitude
// referral_source, bucketed with the live dashboard's engine
// (channel-categorization.js). Only Company Setup Complete carries an answer,
// so the rest of the window's signups go in a "No answer" row.
const SELF_REPORTED_BUCKETS = [
  { name: 'Word of Mouth', color: C.purple },
  { name: 'Search', color: C.lightBlue },
  { name: 'AEO', color: C.green },
  { name: 'Influencer / Community', color: C.lightPurple },
  { name: 'YC', color: C.red },
  { name: 'Social', color: C.lightRed },
  { name: 'Email', color: '#0A66C2' },
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
//   Never completed — no company / unnamed company: never finished onboarding.
//   Other — what's left (created a company but no answer recorded, etc.).
// Answers aren't per user, so the split is approximate: a few joiners or
// never-completed signups did answer, which makes Other slightly too small;
// invitees who aren't on an existing company also make "Joined a teammate's
// company" slightly too small.
const SR_INVITED = { name: 'Accepted an invite', color: C.lightGreen };
const SR_JOINED = { name: 'Joined a teammate’s company', color: '#2BB5D9' };
const INVITE_DAILY = dataJson.amplitude?.inviteAcceptedDaily || null;
// Coverage of the per-person Amplitude pull (YYYYMMDD), if it has been run.
const AMP_PER_PERSON = betaSignups.ampEvents?.firstDay
  ? { firstDay: betaSignups.ampEvents.firstDay.replaceAll('-', ''), lastDay: betaSignups.ampEvents.lastDay.replaceAll('-', '') }
  : null;
const SR_NEVER = { name: 'Never completed', color: '#6B6B6B' };
const SR_OTHER = { name: 'Other (no answer)', color: C.lightGrey };
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
const srGroup = (s) => (s.ref ? categorizeReferralSource(s.ref) : s.inv ? SR_INVITED.name : s.jx ? SR_JOINED.name : s.nc ? SR_NEVER.name : SR_OTHER.name);
function selfReportedIn(start, end) {
  const a = start.replaceAll('-', '');
  const b = end.replaceAll('-', '');
  const list = signupsIn(start, end);
  // Signups only count from SIGNUP_COUNT_START, so the pull needs to cover from there.
  const need = a > SIGNUP_COUNT_START.replaceAll('-', '') ? a : SIGNUP_COUNT_START.replaceAll('-', '');
  if (AMP_PER_PERSON && AMP_PER_PERSON.firstDay <= need && AMP_PER_PERSON.lastDay >= b) {
    const by = {};
    for (const x of [...SELF_REPORTED_BUCKETS, SR_INVITED, SR_JOINED, SR_NEVER, SR_OTHER]) by[x.name] = [];
    for (const s of list) (by[srGroup(s)] || by[SR_OTHER.name]).push(s);
    const counts = Object.fromEntries(SELF_REPORTED_BUCKETS.map((x) => [x.name, by[x.name].length]));
    const actByChannel = Object.fromEntries(SELF_REPORTED_BUCKETS.map((x) => [x.name, actOf(by[x.name])]));
    const never = by[SR_NEVER.name].length;
    const other = by[SR_OTHER.name].length;
    return {
      perSignup: true, counts, answered: sumVals(counts),
      invited: by[SR_INVITED.name].length, joined: by[SR_JOINED.name].length, never, neverList: by[SR_NEVER.name], other, otherList: by[SR_OTHER.name],
      noAnswer: never + other, total: list.length,
      actByChannel, actInvited: actOf(by[SR_INVITED.name]), actTeammate: actOf(by[SR_JOINED.name]),
      actNever: actOf(by[SR_NEVER.name]), actOther: actOf(by[SR_OTHER.name]),
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
  const neverList = list.filter((s) => s.nc);
  const joinedAll = list.filter((s) => s.jx).length;
  let invited = 0;
  if (INVITE_DAILY) for (const [d, v] of Object.entries(INVITE_DAILY)) if (d >= a && d <= b) invited += v || 0;
  invited = Math.min(invited, joinedAll); // can't exceed the existing-company joins it's carved from
  const joined = joinedAll - invited;
  const never = neverList.length;
  const other = Math.max(0, list.length - answered - joinedAll - never);
  return {
    perSignup: false, counts, answered, invited, joined, never, neverList, other, noAnswer: never + other, total: list.length,
    actJoined: actOf(list.filter((s) => s.jx)), actNever: actOf(neverList), actCreators: actOf(list.filter((s) => !s.jx && !s.nc)),
    actByChannel: null, actInvited: null, actTeammate: null, actOther: null,
  };
}

// --- Window-dependent model (rebuilt per reporting window) ------------------
function buildModel(mode) {
  const W = makeWindow(mode);
  const { END, START, PRIOR_START, PRIOR_END, WEEKS } = W;

  // --- Derived series -----------------------------------------------------------
  const WINDOW = (() => {
    const curr = signupsIn(START, END);
    const prev = signupsIn(PRIOR_START, PRIOR_END);
    const visitors = sumEngaged(START, END);
    const visitorsPrev = sumEngaged(PRIOR_START, PRIOR_END);
    const roleCounts = Object.fromEntries(ROLES.map((r) => [r.key, 0]));
    curr.forEach((s) => { roleCounts[roleKey(s)] += 1; });
    // Funnel "Activated" = signups in the window that have activated (email
    // sent/drafted or asset published), any time so far.
    const activated = curr.filter(actDate).length;
    const activatedPrev = prev.filter(actDate).length;
    return {
      signups: curr.length,
      signupsPrev: prev.length,
      visitors,
      visitorsPrev,
      conv: pct(curr.length, visitors),
      convPrev: pct(prev.length, visitorsPrev),
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
      const visitors = sumEngaged(w.start, end);
      cumVisitors += visitors;
      cumSignups += list.length;
      const row = { ...w, signups: list.length, visitors, cumVisitors, cumSignups, conv: pct(list.length, visitors) };
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

  const CHANNEL_WEEKLY = WEEKS.map((w) => {
    const s = sumByChannel(GA_SESSIONS, w.start, w.partial ? DATA_END : w.end);
    return { ...w, ...s, total: sumVals(s) };
  });
  // Calendar months from the period start (used by Fiscal YTD: Nick, Oct 7 —
  // monthly columns read better than ~37 weekly bars).
  const CHANNEL_MONTHLY = (() => {
    const out = [];
    for (let m = START.slice(0, 7); m <= DATA_END.slice(0, 7); m = addMonthsISO(`${m}-01`, 1).slice(0, 7)) {
      const first = `${m}-01` < START ? START : `${m}-01`;
      const monthEnd = addDays(addMonthsISO(`${m}-01`, 1), -1);
      const partial = monthEnd > DATA_END;
      const last = partial ? DATA_END : monthEnd;
      const sums = sumByChannel(GA_SESSIONS, first, last);
      out.push({ start: m, label: MON[+m.slice(5, 7) - 1], partial, title: `${MON[+m.slice(5, 7) - 1]} ${m.slice(0, 4)}${partial ? ` (to ${monDay(DATA_END)}, in progress)` : ''}`, ...sums, total: sumVals(sums) });
    }
    return out;
  })();

  const CH30 = (() => {
    const sessions = sumByChannel(GA_SESSIONS, START, END);
    const sessionsPrev = sumByChannel(GA_SESSIONS, PRIOR_START, PRIOR_END);
    return { sessions, total: sumVals(sessions), totalPrev: sumVals(sessionsPrev) };
  })();

  // Week to date (the in-progress week; not in the headline totals).
  const WTD_STATS = W.WTD ? (() => {
    const list = signupsIn(W.WTD.start, W.WTD.end);
    return { ...W.WTD, visitors: sumEngaged(W.WTD.start, W.WTD.end), signups: list.length, activated: list.filter(actDate).length };
  })() : null;
  const SELF_REPORTED = selfReportedIn(START, END);
  // Same split per week, for the stacked-column view of the channel table.
  const SELF_REPORTED_PREV = selfReportedIn(PRIOR_START, PRIOR_END);
  const SELF_REPORTED_WEEKLY = WEEKS.map((w) => ({ ...w, ...selfReportedIn(w.start, w.partial ? DATA_END : w.end) }));

  const VISITOR_LINE = WEEKLY.map((w, i) => {
    const next = WEEKLY[i + 1];
    return {
      ...w,
      visitorsFull: w.partial ? null : w.visitors,
      visitorsPartial: w.partial || next?.partial ? w.visitors : null,
    };
  });

  return { ...W, WINDOW, WEEKLY, ACT, MEETING_ANY_30D, ACTIVATED, ONBOARDED, RETURNED, CHANNEL_WEEKLY, CHANNEL_MONTHLY, CH30, WTD_STATS, SELF_REPORTED, SELF_REPORTED_PREV, SELF_REPORTED_WEEKLY, VISITOR_LINE };
}
const MODELS = Object.fromEntries(Object.keys(MODES).map((m) => [m, buildModel(m)]));
const ModelCtx = React.createContext(MODELS[DEFAULT_MODE]);
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
  const rows = [...data.users].sort((a, b) => (dateOf(a) < dateOf(b) ? -1 : dateOf(a) > dateOf(b) ? 1 : 0));
  const th = { ...eyebrow, fontSize: 10, textAlign: 'left', padding: '8px 12px', borderBottom: `1px solid ${C.black}`, background: C.paper, position: 'sticky', top: 0 };
  const td = { fontFamily: FONT_BODY, fontSize: 13, padding: '8px 12px', borderBottom: `1px solid ${C.lightGrey}`, whiteSpace: 'nowrap' };
  return (
    <div role="presentation" onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div role="dialog" aria-modal="true" aria-label={data.title} onClick={(e) => e.stopPropagation()} style={{ background: C.white, border: `1px solid ${C.black}`, borderRadius: 4, boxShadow: `6px 6px 0 ${C.green}`, width: 'min(820px, 100%)', maxHeight: '82vh', display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, padding: '18px 20px 12px', borderBottom: `1px solid ${C.lightGrey}` }}>
          <div>
            <div style={{ fontFamily: FONT_BODY, fontSize: 16, fontWeight: 700 }}>{data.title}</div>
            <div style={{ fontFamily: FONT_BODY, fontSize: 13, color: C.muted, marginTop: 3 }}>{rows.length.toLocaleString()} {rows.length === 1 ? noun : nounPlural}{data.subtitle ? ` · ${data.subtitle}` : ''}</div>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" style={{ border: `1px solid ${C.black}`, borderRadius: 4, background: C.white, cursor: 'pointer', fontFamily: FONT_BODY, fontSize: 13, fontWeight: 600, padding: '4px 10px' }}>Close</button>
        </div>
        <div style={{ overflow: 'auto' }}>
          {rows.length ? (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={th}>User (admin profile)</th>
                  <th style={th}>Signed up</th>
                  {showDate && <th style={th}>{dateLabel}</th>}
                  {showVia && <th style={th}>{viaLabel}</th>}
                </tr>
              </thead>
              <tbody>
                {rows.map((u, i) => (
                  <tr key={`${u.uid}-${u.co}-${i}`}>
                    <td style={td}>
                      {u.uid ? (
                        <a href={`${ADMIN_USER_URL}${u.uid}`} target="_blank" rel="noopener noreferrer" title={`${ADMIN_USER_URL}${u.uid}`} style={{ color: C.purple, textDecoration: 'underline', textUnderlineOffset: 2, ...(u.email ? {} : { fontFamily: "'Geist Mono', 'SF Mono', Consolas, monospace", fontSize: 12 }) }}>{u.email || u.uid}</a>
                      ) : <span style={{ color: C.muted }}>unknown</span>}
                    </td>
                    <td style={{ ...td, ...tabular }}>{monDay(u.d)} {u.d.slice(0, 4)}</td>
                    {showDate && <td style={{ ...td, ...tabular }}>{monDay(dateOf(u))}</td>}
                    {showVia && <td style={td}>{viaOf(u)}</td>}
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

function ListUsersButton({ onClick, n, label }) {
  return (
    <button type="button" onClick={onClick} style={{ marginTop: 10, border: `1px solid ${C.black}`, borderRadius: 999, background: C.white, cursor: 'pointer', fontFamily: FONT_BODY, fontSize: 12, fontWeight: 600, padding: '4px 12px' }}>
      List {fmtInt(n)} {n === 1 ? 'user' : 'users'} {label || 'activated'} →
    </button>
  );
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
  return (
    <div>
      <div style={eyebrow}>{label}</div>
      <div style={{ ...tabular, fontFamily: FONT_DISPLAY, fontSize: 34, lineHeight: 1.05, letterSpacing: '-0.03em', marginTop: 4, color: muted ? C.muted : C.black }}><Explain text={muted ? null : explain}>{value}</Explain></div>
      {sub && <div style={{ fontFamily: FONT_BODY, fontSize: 12, color: C.muted, marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

function StatRow({ children, delta, deltaLabel, always }) {
  const M = useModel();
  // YTD has no prior period: hide period deltas (cards with their own fixed
  // comparison, e.g. vs end of a month, pass `always`).
  if (M.noPrior && !always) delta = undefined;
  deltaLabel = deltaLabel || `vs ${rangeLabel(M.PRIOR_START, M.PRIOR_END)}`;
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16, marginTop: 16 }}>
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

// allTime: the card's headline doesn't follow the reporting-period pills (all
// cohorts / running total); shows a small chip so it isn't read as "this period".
function Card({ title, question, notice, footnote, children, accent = C.purple, allTime }) {
  return (
    <article style={{
      display: 'flex', flexDirection: 'column', background: C.white, border: `1px solid ${C.black}`,
      borderRadius: 4, padding: '20px 22px 18px', minWidth: 0, position: 'relative',
      boxShadow: `4px 4px 0 ${accent}`,
    }}>
      <h3 style={{ fontFamily: FONT_BODY, fontSize: 16, lineHeight: 1.35, fontWeight: 700, margin: 0 }}>
        {title}
        {allTime && (
          <span title={typeof allTime === 'string' ? allTime : 'This headline covers all time and does not change with the reporting period.'} style={{ marginLeft: 8, verticalAlign: 'middle', display: 'inline-block', border: `1px solid ${C.black}`, borderRadius: 999, padding: '1px 8px', fontSize: 10.5, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', background: C.paper, color: C.muted }}>
            {typeof allTime === 'string' ? allTime : 'All time'}
          </span>
        )}
      </h3>
      {question && <p style={{ fontFamily: FONT_BODY, fontSize: 13, lineHeight: 1.45, color: C.muted, margin: '3px 0 0' }}>{question}</p>}
      {notice && (
        <div style={{ marginTop: 12, borderRadius: 4, border: `1px solid ${C.black}`, background: C.lightGreen, padding: '8px 12px', fontFamily: FONT_BODY, fontSize: 12, lineHeight: 1.55 }}>
          {notice}
        </div>
      )}
      <div style={{ flex: 1 }}>{children}</div>
      {footnote && (
        <div style={{ marginTop: 16, borderTop: `1px solid ${C.lightGrey}`, paddingTop: 12, fontFamily: FONT_CAPTION, fontStyle: 'italic', fontSize: 12, lineHeight: 1.5, color: C.muted }}>
          {footnote}
        </div>
      )}
    </article>
  );
}

function Legend({ items, style }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 14px', fontFamily: FONT_BODY, fontSize: 11.5, lineHeight: '15px', color: C.muted, margin: '16px 0 6px', ...style }}>
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

function StageHeader({ n, prefix, title, subtitle, right }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: '4px 16px', borderBottom: `1px solid ${C.black}`, paddingBottom: 10, margin: '32px 0 20px' }}>
      <h2 style={{ fontFamily: FONT_DISPLAY, fontWeight: 400, fontSize: 28, lineHeight: 1.15, letterSpacing: '-0.03em', margin: 0 }}>
        {n != null && <span style={{ color: C.purple }}>Stage {n}: </span>}{prefix && <span style={{ color: C.purple }}>{prefix}: </span>}{title}
      </h2>
      {subtitle && <p style={{ fontFamily: FONT_BODY, fontSize: 13.5, color: C.muted, margin: 0 }}>{subtitle}</p>}
      {right && <div style={{ marginLeft: 'auto', alignSelf: 'center' }}>{right}</div>}
    </div>
  );
}

// Two columns like the blueprint; one column on narrow screens.
const PAGE_CSS = `.beta-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:20px;align-items:stretch}
.beta-grid > .full{grid-column:1 / -1}
.beta-grid.cols-3{grid-template-columns:repeat(3,minmax(0,1fr))}
@media (max-width: 1100px){.beta-grid.cols-3{grid-template-columns:repeat(2,minmax(0,1fr))}}
.beta-funnel-line{display:grid;align-items:stretch}
.beta-step{all:unset;box-sizing:border-box;cursor:pointer;display:flex;flex-direction:column;min-width:0}
.beta-step:focus-visible{outline:2px solid ${C.purple};outline-offset:3px}
.beta-step:hover .beta-step-bar{background:#BDBDBD}
.beta-step[aria-pressed="true"]:hover .beta-step-bar{background:${C.purple}}
@media (max-width: 900px){.beta-grid{grid-template-columns:minmax(0,1fr)}}
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
const weekTitle = (w) => `Week of ${w.range}${w.partial ? ' (in progress)' : w.clipped ? ' (first days of the period)' : ''}`;
const cursor = { fill: 'rgba(167,59,245,0.06)' };

// ===========================================================================
// PLG funnel at a glance
// ===========================================================================
// Sections a click can open. Line 1 opens by transition; line 2 by company stage.
const VIEWS = {
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

function FunnelNode({ label, value, sub, dim }) {
  return (
    <div style={{ minWidth: 0, padding: '2px 0' }}>
      <div style={{ fontFamily: FONT_BODY, fontSize: 14, fontWeight: 700, lineHeight: 1.25, color: dim ? C.muted : C.black }}>{label}</div>
      <div style={{ ...tabular, fontFamily: FONT_DISPLAY, fontSize: 30, lineHeight: 1.1, letterSpacing: '-0.03em', marginTop: 4, color: dim ? '#B5B5B5' : C.black }}>{value}</div>
      {sub && <div style={{ fontFamily: FONT_CAPTION, fontStyle: 'italic', fontSize: 11.5, color: C.muted, marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

// A clickable step: arrow + conversion chip + delta, with a selection bar and label under it.
function FunnelStep({ id, view, setView, label, rate, delta, children }) {
  const selected = view === id;
  return (
    <button type="button" className="beta-step" aria-pressed={selected} onClick={() => setView(id)} title={`Show ${VIEWS[id].title} charts`}>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4, padding: '0 6px 10px' }}>
        {children || (
          <>
            <ArrowRight size={22} strokeWidth={2.5} color={selected ? C.black : '#9A9A9A'} />
            <span style={{
              ...tabular, fontFamily: FONT_BODY, fontSize: 18, fontWeight: 700, padding: '3px 10px', borderRadius: 4,
              border: `1px solid ${selected ? C.black : '#CFCFCF'}`, background: selected ? C.lightPurple : C.white,
              color: selected ? C.black : C.muted,
            }}>
              {rate}
            </span>
            {delta}
          </>
        )}
      </div>
      <div className="beta-step-bar" style={{ height: selected ? 4 : 3, borderRadius: 2, background: selected ? C.purple : C.lightGrey, transition: 'background 120ms' }} />
      <div style={{ ...eyebrow, fontSize: 10.5, marginTop: 8, color: selected ? C.black : C.muted, textAlign: 'center' }}>{label}</div>
    </button>
  );
}

function PlgFunnel({ view, setView }) {
  const M = useModel();
  const { END, START, WINDOW } = M;
  const W = WINDOW;
  return (
    <section style={{ background: C.white, border: `1px solid ${C.black}`, borderRadius: 4, padding: '20px 24px 22px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 18 }}>
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
          <MousePointerClick size={14} /> Click a step to see its charts
        </span>
      </div>

      {/* Line 1 — users */}
      <div style={{ ...eyebrow, marginBottom: 10 }}>Users</div>
      <div className="beta-funnel-line" style={{ gridTemplateColumns: 'minmax(110px,0.8fr) minmax(0,1.4fr) minmax(110px,0.8fr) minmax(0,1.4fr) minmax(110px,0.8fr)', gap: 12 }}>
        <FunnelNode label="Website visitors" value={fmtInt(W.visitors)} sub="GA4 engaged sessions" />
        <FunnelStep id="signup" view={view} setView={setView} label="Visitor → sign up" rate={fmtPct(W.conv, 1)} delta={<Delta value={ptsDiff(W.conv, W.convPrev)} suffix=" pts" size={12} />} />
        <FunnelNode label="User sign ups" value={fmtInt(W.signups)} sub="Every signup, incl. repeats" />
        <FunnelStep id="activation" view={view} setView={setView} label="Sign up → activated" rate={fmtPct(W.actConv, 1)} delta={<Delta value={ptsDiff(W.actConv, W.actConvPrev)} suffix=" pts" size={12} />} />
        <FunnelNode label="Activated" value={fmtInt(W.activated)} sub="Email sent or asset published" />
      </div>

      {/* Line 2 — companies (stripe-dash) */}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, margin: '26px 0 10px', paddingTop: 18, borderTop: `1px dashed #CFCFCF` }}>
        <span style={eyebrow}>Companies</span>
        <span style={{ fontFamily: FONT_CAPTION, fontStyle: 'italic', fontSize: 12, color: C.muted }}>{PAYING ? 'Paid + retained from Stripe · expanding coming soon' : 'From stripe-dash — coming soon'}</span>
      </div>
      <div className="beta-funnel-line" style={{ gridTemplateColumns: 'repeat(3, minmax(0,1fr))', gap: 20 }}>
        {[
          { id: 'paid', label: 'Paid companies' },
          { id: 'retained', label: 'Retained companies' },
          { id: 'expanding', label: 'Expanding companies' },
        ].map((s) => (
          <FunnelStep key={s.id} id={s.id} view={view} setView={setView} label={VIEWS[s.id].short}>
            <div style={{ alignSelf: 'stretch' }}>
              {s.id === 'retained' && RETENTION
                ? <FunnelNode label="Retained companies" value={fmtPct(RETENTION.m1Rate, 1)} sub="Month-1 retention · Stripe" dim={view !== s.id} />
                : s.id === 'paid' && PAYING
                ? <FunnelNode label="Paying companies (PLG)" value={fmtInt(PAYING.asOf(M.END).companies)} sub={`as of ${monDay(PAYING.asOf(M.END).day)} · ${fmtInt(PAYING.asOf(M.END).users)} paying users · ${fmtPct(PAYING.asOf(M.END).conv, 1)} sign up → paid`} dim={view !== s.id} />
                : <FunnelNode label={s.label} value="—" sub="Not connected yet" dim={view !== s.id} />}
            </div>
          </FunnelStep>
        ))}
      </div>
    </section>
  );
}

function ViewingBar({ view }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 14, margin: '24px 0 0', padding: '14px 20px', border: `1px solid ${C.black}`, borderRadius: 4, background: C.lightPurple }}>
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
      footnote="GA4 engaged sessions (>10s, a conversion, or 2+ pageviews), same metric as the current dashboard. Used instead of total users because AI crawlers inflate that number. Dotted segment = week in progress. No goal set yet."
    >
      <StatRow delta={<Delta value={pctChange(WINDOW.visitors, WINDOW.visitorsPrev)} />}>
        <Stat label={`Actual · ${rangeLabel(M.START, M.END)}`} value={fmtInt(WINDOW.visitors)} explain={`The site had ${fmtInt(WINDOW.visitors)} engaged visits (GA4 engaged sessions) from ${rangeLabel(M.START, M.END)}.`} />
        <Stat label="Goal" value="—" muted />
      </StatRow>
      <Legend items={[{ label: 'Engaged sessions (weekly)', color: C.black, line: true }, { label: 'Goal (not set)', color: '#9A9A9A', line: true, dashed: true }]} />
      <ResponsiveContainer width="100%" height={190}>
        <LineChart data={VISITOR_LINE} margin={chartMargin}>
          {grid}
          <XAxis {...xAxis} />
          <YAxis {...yAxis} tickFormatter={fmtK} domain={[0, 'auto']} />
          <Tooltip content={({ active, payload }) => active && payload?.length ? (
            <TooltipBox title={weekTitle(payload[0].payload)} rows={[{ label: 'Engaged sessions', value: fmtInt(payload[0].payload.visitors), color: C.black }]} />
          ) : null} />
          <Line dataKey="visitorsFull" stroke={C.black} strokeWidth={2.5} dot={false} activeDot={{ r: 4, fill: C.blue, stroke: C.black }} isAnimationActive={false} />
          <Line dataKey="visitorsPartial" stroke={C.black} strokeWidth={2} strokeDasharray="2 4" dot={false} activeDot={{ r: 4, fill: C.blue, stroke: C.black }} legendType="none" isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </Card>
  );
}

function VisitorToSignupCard() {
  const M = useModel();
  const { WEEKLY, WINDOW } = M;
  return (
    <Card
      accent={C.blue}
      title="Website visitor → sign up"
      question="What share of visitors create an account?"
      footnote="Signups ÷ GA4 engaged sessions for the same week. Every signup counts, including repeats by the same person. No goal set yet."
    >
      <StatRow delta={<Delta value={ptsDiff(WINDOW.conv, WINDOW.convPrev)} suffix=" pts" />}>
        <Stat label={`Conversion · ${rangeLabel(M.START, M.END)}`} value={fmtPct(WINDOW.conv, 2)} explain={`From ${rangeLabel(M.START, M.END)}, ${fmtInt(WINDOW.signups)} signups came from ${fmtInt(WINDOW.visitors)} engaged visits — about ${fmtPct(WINDOW.conv, 1)} of visits.`} />
        <Stat label="Goal" value="—" muted />
      </StatRow>
      <Legend items={[{ label: 'Actual %', color: C.black, line: true }, { label: 'Goal % (not set)', color: '#9A9A9A', line: true, dashed: true }]} />
      <ResponsiveContainer width="100%" height={190}>
        <LineChart data={WEEKLY} margin={chartMargin}>
          {grid}
          <XAxis {...xAxis} />
          <YAxis {...yAxis} domain={[0, 'auto']} tickFormatter={(v) => `${v}%`} />
          <Tooltip content={({ active, payload }) => active && payload?.length ? (
            <TooltipBox title={weekTitle(payload[0].payload)} rows={[
              { label: 'Visitor → sign up', value: fmtPct(payload[0].payload.conv, 2), color: C.black },
              { label: 'Signups', value: fmtInt(payload[0].payload.signups) },
              { label: 'Engaged sessions', value: fmtInt(payload[0].payload.visitors) },
            ]} />
          ) : null} />
          <Line dataKey="conv" stroke={C.black} strokeWidth={2.5} dot={false} activeDot={{ r: 4, fill: C.blue, stroke: C.black }} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
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
      footnote={`Running total of GA4 engaged sessions since ${monDay(WEEKS[0].start)}. No goal set yet — a goal line will be added once we have one.`}
    >
      <StatRow>
        <Stat label={`Actual · since ${monDay(WEEKS[0].start)}`} value={fmtInt(total)} explain={`${fmtInt(total)} engaged visits in total since ${monDay(WEEKS[0].start)}.`} />
        <Stat label="Goal" value="—" muted />
        <Stat label="Vs goal" value="—" muted />
      </StatRow>
      <Legend items={[{ label: 'Cumulative actual', color: C.black, line: true }, { label: 'Cumulative goal (not set)', color: '#9A9A9A', line: true, dashed: true }]} />
      <ResponsiveContainer width="100%" height={190}>
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
      </ResponsiveContainer>
    </Card>
  );
}

// High-intent visitor isn't defined yet — placeholder in the final layout.
function HighIntentCard({ title, question, accent }) {
  const M = useModel();
  return (
    <Card
      accent={accent}
      title={title}
      question={question}
      footnote="“High-intent visitor” still needs a definition (e.g. viewed pricing, or clicked a sign up CTA). The chart fills in once it's set."
    >
      <StatRow>
        <Stat label={`Conversion · ${rangeLabel(M.START, M.END)}`} value="—" muted />
        <Stat label="Goal" value="—" muted />
      </StatRow>
      <Legend items={[{ label: 'Actual %', color: C.black, line: true }, { label: 'Goal % (not set)', color: '#9A9A9A', line: true, dashed: true }]} />
      <div style={{ height: 190, border: `1px dashed #BDBDBD`, borderRadius: 4, background: C.paper, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: FONT_CAPTION, fontStyle: 'italic', fontSize: 14, color: C.muted }}>
        Definition coming
      </div>
    </Card>
  );
}

function VisitorsByChannelCard() {
  const M = useModel();
  const { CH30 } = M;
  const monthly = M.mode === 'ytd';
  const data = monthly ? M.CHANNEL_MONTHLY : M.CHANNEL_WEEKLY;
  const order = [...CHANNELS].sort((a, b) => CH30.sessions[b.key] - CH30.sessions[a.key]);
  return (
    <div className="full">
      <Card
        accent={C.blue}
        title="Website visitors by channel"
        question="Where are visitors coming from?"
        footnote={`GA4 engaged sessions by channel, bucketed with the same rules as the live dashboard (LinkedIn split out from Social, AI referrals → AEO). Totals can differ slightly from the Website visitors card because GA4 samples the channel breakdown. ${monthly ? 'Fiscal YTD shows monthly columns; the faintly striped one is the month in progress.' : 'Faintly striped bars = week in progress.'}`}
      >
        <StatRow delta={<Delta value={pctChange(CH30.total, CH30.totalPrev)} />}>
          <Stat label={`Actual · ${rangeLabel(M.START, M.END)}`} value={fmtInt(CH30.total)} explain={`${fmtInt(CH30.total)} engaged visits from ${rangeLabel(M.START, M.END)}, split by where they came from below.`} />
        </StatRow>
        <div style={{ ...eyebrow, marginTop: 16 }}>By channel · share of visitors, {rangeLabel(M.START, M.END)}</div>
        <Legend
          style={{ margin: '8px 0 6px' }}
          items={order.map((c) => ({ label: c.key, color: c.color, value: fmtPct(pct(CH30.sessions[c.key], CH30.total), 0) }))}
        />
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={data} margin={chartMargin} barCategoryGap="22%">
            {hatchDefs(CHANNELS.map((c) => c.color))}
            {grid}
            <XAxis {...xAxis} />
            <YAxis {...yAxis} tickFormatter={fmtK} />
            <Tooltip cursor={cursor} content={({ active, payload }) => active && payload?.length ? (
              <TooltipBox
                title={monthly ? payload[0].payload.title : weekTitle(payload[0].payload)}
                rows={[...CHANNELS].reverse().filter((c) => payload[0].payload[c.key]).map((c) => ({
                  label: c.key, color: c.color,
                  value: `${fmtInt(payload[0].payload[c.key])} · ${fmtPct(pct(payload[0].payload[c.key], payload[0].payload.total), 0)}`,
                }))}
                note={`${fmtInt(payload[0].payload.total)} engaged sessions`}
              />
            ) : null} />
            {CHANNELS.map((c) => (
              <Bar key={c.key} dataKey={c.key} stackId="ch" stroke={C.black} strokeWidth={0.5} isAnimationActive={false}>
                {data.map((w) => <Cell key={w.start} fill={w.partial ? `url(#${hatchId(c.color)})` : c.color} />)}
              </Bar>
            ))}
          </BarChart>
        </ResponsiveContainer>
      </Card>
    </div>
  );
}

const SR_STACK = [...SELF_REPORTED_BUCKETS, SR_INVITED, SR_JOINED, SR_NEVER, SR_OTHER]; // bottom → top
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
      : name === SR_NEVER.name ? sr.never
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

function ChannelGrowthTable({ M, th, td }) {
  if (M.noPrior) {
    return (
      <div style={{ marginTop: 16, border: `1px dashed ${C.black}`, borderRadius: 4, background: C.paper, padding: '22px 20px', textAlign: 'center', fontFamily: FONT_BODY, fontSize: 13, color: C.muted }}>
        Year to date has no prior period to compare with. Pick Last week, Last 4 weeks or Quarter to date to see growth by channel.
      </div>
    );
  }
  const cur = M.SELF_REPORTED;
  const prev = M.SELF_REPORTED_PREV;
  // 12 complete weeks for the trend, whatever the toggle (the week in progress
  // would look like a drop).
  const trendWeeks = MODELS['4w'].SELF_REPORTED_WEEKLY.filter((w) => !w.partial).slice(-12); // always 12 weeks
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
    <div style={{ overflowX: 'auto', margin: '12px -22px 0' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 720 }}>
        <thead>
          <tr>
            <th style={{ ...th, textAlign: 'left', paddingLeft: 22 }}>Channel (self-reported)</th>
            <th style={{ ...th, textAlign: 'left' }}>12-week trend</th>
            <th style={th}>{rangeLabel(M.PRIOR_START, M.PRIOR_END)}</th>
            <th style={th}>{rangeLabel(M.START, M.END)}</th>
            <th style={th}>Change</th>
            <th style={{ ...th, paddingRight: 22 }}>% change</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.name} style={r.small ? { color: '#9A9A9A' } : undefined} title={r.small ? `Fewer than ${GROWTH_MIN} signups in both periods — % change is noisy` : undefined}>
              <td style={{ ...td, textAlign: 'left', paddingLeft: 22, fontWeight: 600 }}>
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
              <td style={{ ...td, paddingRight: 22, color: r.small ? '#9A9A9A' : chg(r.diff) }}>{r.pctChg == null ? 'new' : fmtSigned(r.pctChg, '%', 0)}</td>
            </tr>
          ))}
          <tr style={{ background: C.paper }}>
            <td style={{ ...td, textAlign: 'left', paddingLeft: 22, fontWeight: 700, borderBottom: 'none' }}>Overall</td>
            <td style={{ ...td, borderBottom: 'none' }} />
            <td style={{ ...td, fontWeight: 700, borderBottom: 'none' }}>{fmtInt(totP)}</td>
            <td style={{ ...td, fontWeight: 700, borderBottom: 'none' }}>{fmtInt(totC)}</td>
            <td style={{ ...td, fontWeight: 700, borderBottom: 'none', color: chg(totC - totP) }}>{totC - totP > 0 ? '+' : totC - totP < 0 ? '−' : '±'}{fmtInt(Math.abs(totC - totP))}</td>
            <td style={{ ...td, paddingRight: 22, fontWeight: 700, borderBottom: 'none', color: chg(totC - totP) }}>{fmtSigned(pctChange(totC, totP), '%', 0)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function SignupsByChannelCard() {
  const M = useModel();
  const { END, SELF_REPORTED, SELF_REPORTED_WEEKLY, START, WINDOW } = M;
  const SR = SELF_REPORTED;
  const total = WINDOW.signups;
  const openUsers = useUsersModal();
  const [view, setViewState] = useState(() => {
    try { const v = window.localStorage.getItem('beta-channel-view'); return v === 'chart' || v === 'growth' ? v : 'table'; } catch (e) { return 'table'; }
  });
  const setView = (v) => { setViewState(v); try { window.localStorage.setItem('beta-channel-view', v); } catch (e) { /* ignore */ } };
  const openNever = (list, subtitle) => openUsers({ ...NEVER_MODAL, title: 'Never completed', subtitle, users: list });

  // Everything except No answer, biggest first (Nick, Oct 7); No answer stays at the bottom.
  const rows = [
    ...SELF_REPORTED_BUCKETS.map((b) => ({ key: b.name, color: b.color, n: SR.counts[b.name], act: SR.actByChannel?.[b.name] })).filter((r) => r.n > 0),
    { key: SR_INVITED.name, sub: SR.perSignup || INVITE_DAILY ? 'User Invitation Completed fired — never asked' : 'available after the next pull-data', color: SR_INVITED.color, n: SR.invited, act: SR.actInvited || SR.actJoined, actCombined: !SR.actInvited },
    { key: SR_JOINED.name, sub: 'joined an existing company without an invite — never asked', color: SR_JOINED.color, n: SR.joined, act: SR.actTeammate || SR.actJoined, actCombined: !SR.actTeammate },
  ].sort((a, b) => b.n - a.n);
  rows.push({ key: 'No answer', color: C.lightGrey, n: SR.noAnswer, parent: true });
  rows.push(...[
    { key: SR_NEVER.name, sub: 'never finished onboarding · click to see who', color: SR_NEVER.color, n: SR.never, act: SR.actNever, child: true, onClick: () => openNever(SR.neverList, `signed up ${rangeLabel(START, END)}, never finished onboarding`) },
    { key: 'Other', sub: SR.otherList ? 'click to see who' : null, color: SR_OTHER.color, n: SR.other, act: SR.actOther, child: true, ...(SR.otherList ? { onClick: () => openUsers({ ...NEVER_MODAL, title: 'Other (no answer)', subtitle: `signed up ${rangeLabel(START, END)}, created a company but no answer or invite in Amplitude`, users: SR.otherList }) } : {}) },
  ].sort((a, b) => b.n - a.n));
  const maxN = Math.max(...rows.map((r) => r.n || 0), 1);

  const weekly = SELF_REPORTED_WEEKLY.map((w) => ({
    ...w, ...w.counts, [SR_INVITED.name]: w.invited, [SR_JOINED.name]: w.joined, [SR_NEVER.name]: w.never, [SR_OTHER.name]: w.other,
  }));
  const th = { ...eyebrow, fontSize: 10, padding: '10px 14px', textAlign: 'right', whiteSpace: 'nowrap', borderBottom: `1px solid ${C.black}`, background: C.paper };
  const td = { ...tabular, fontFamily: FONT_BODY, fontSize: 13.5, padding: '11px 14px', textAlign: 'right', borderBottom: `1px solid ${C.lightGrey}`, whiteSpace: 'nowrap' };
  const soon = <span style={{ color: '#B5B5B5' }}>—</span>;
  return (
    <div className="full">
      <Card
        accent={C.purple}
        title="Sign ups and conversion by channel"
        question={`Self-reported “How did you hear about us?” · ${view === 'chart' ? `weekly, ${rangeLabel(weekly[0]?.start || START, END)}` : view === 'growth' ? `${rangeLabel(START, END)} vs ${rangeLabel(M.PRIOR_START, M.PRIOR_END)}` : `${M.label} · ${rangeLabel(START, END)}`}`}
        footnote={`${SR.perSignup ? `Every signup in the period (Metabase) is looked up in Amplitude by user id and put in exactly one row: its own “How did you hear about us?” answer (referral_source, bucketed with the same rules as the live dashboard's “User signups by Channel”); otherwise Accepted an invite (fired “User Invitation Completed”); otherwise Joined a teammate's company (its company already had a signup, no invite event); otherwise Never completed (no workspace, or one never named; click the row to list them); otherwise Other (created a company but no answer in Amplitude). Only company setup asks the question, so joiners are never asked. Rows add up to Overall. Internal (@mutinyhq.com) signups are left out, like the rest of this page.` : `Channel = the signup's self-reported answer (Amplitude referral_source daily totals), bucketed with the same rules as the live dashboard's “User signups by Channel”. Only company setup asks the question. Accepted an invite = Amplitude “User Invitation Completed” (daily unique users). Joined a teammate's company = signups on a company that already had an earlier signup (Metabase), minus the accepted invites. No answer is split into Never completed (no workspace, or one never named; click the row to list them) and Other (what's left). Answers are daily totals here, not per person, so the split is approximate — run npm run pull-amp-events for exact per-signup rows.`} Overall = all Metabase signups in the window, matching the rest of this page.${view === 'table' ? ` Sign up → activated = share of the row's signups in the period that have activated (email sent/drafted or asset published) so far, same as the funnel. ${SR.perSignup ? `Every row is exact: it's the share of that row's signups that have activated (hover a cell for the count).` : `It's filled in only where we know each signup's group: the two joiner rows share one rate (${fmtPct(SR.actJoined.rate, 1)}, ${fmtInt(SR.actJoined.k)} of ${fmtInt(SR.actJoined.n)}) because invites vs teammates is only an Amplitude total; channel rows need each person's answer (run npm run pull-amp-events) — together, company creators (the people who were asked) activated at ${fmtPct(SR.actCreators.rate, 1)} (${fmtInt(SR.actCreators.k)} of ${fmtInt(SR.actCreators.n)}).`}` : ''}${view === 'growth' ? ` Growth: each row's signups this period vs the period before, sorted by the size of the change. Rows with fewer than ${GROWTH_MIN} signups in both periods are greyed out — their % change swings too much to read. Trend = the last 12 complete weeks.` : view === 'chart' ? ' Faintly striped = week in progress.' : ' Activated → paid comes from stripe-dash.'}`}
      >
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
          <ViewToggle value={view} onChange={setView} options={[{ value: 'table', label: 'Table' }, { value: 'chart', label: 'Weekly chart' }, { value: 'growth', label: 'Growth' }]} />
        </div>
        {view === 'growth' ? <ChannelGrowthTable M={M} th={th} td={td} /> : view === 'chart' ? (
          <>
            <Legend
              style={{ margin: '10px 0 6px' }}
              items={[...SR_STACK].reverse().map((b) => ({ label: b.name, color: b.color }))}
            />
            <ResponsiveContainer width="100%" height={320}>
              <BarChart data={weekly} margin={chartMargin} barCategoryGap="22%">
                {hatchDefs(SR_STACK.map((b) => b.color))}
                {grid}
                <XAxis {...xAxis} />
                <YAxis {...yAxis} allowDecimals={false} />
                <Tooltip cursor={cursor} content={({ active, payload }) => active && payload?.length ? (
                  <TooltipBox
                    title={weekTitle(payload[0].payload)}
                    rows={[...SR_STACK].reverse().filter((b) => payload[0].payload[b.name]).map((b) => ({
                      label: b.name, color: b.color,
                      value: `${fmtInt(payload[0].payload[b.name])} · ${fmtPct(pct(payload[0].payload[b.name], payload[0].payload.total), 1)}`,
                    }))}
                    note={`${fmtInt(payload[0].payload.total)} sign ups`}
                  />
                ) : null} />
                {SR_STACK.map((b) => (
                  <Bar key={b.name} dataKey={b.name} stackId="sr" stroke={C.black} strokeWidth={0.5} isAnimationActive={false}>
                    {weekly.map((w) => <Cell key={w.start} fill={w.partial ? `url(#${hatchId(b.color)})` : b.color} />)}
                  </Bar>
                ))}
              </BarChart>
            </ResponsiveContainer>
          </>
        ) : (
          <div style={{ overflowX: 'auto', margin: '12px -22px 0' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 720 }}>
              <thead>
                <tr>
                  <th style={{ ...th, textAlign: 'left', paddingLeft: 22 }}>Channel (self-reported)</th>
                  <th style={{ ...th, textAlign: 'left', width: '34%' }}>Sign ups</th>
                  <th style={th}>% of sign ups</th>
                  <th style={th}>Sign up → activated</th>
                  <th style={{ ...th, paddingRight: 22 }}>Activated → paid</th>
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
                    <td style={{ ...td, paddingRight: 22 }}>{soon}</td>
                  </tr>
                ))}
                <tr style={{ background: C.paper }}>
                  <td style={{ ...td, textAlign: 'left', paddingLeft: 22, fontWeight: 700, borderBottom: 'none' }}>Overall</td>
                  <td style={{ ...td, textAlign: 'left', fontWeight: 700, borderBottom: 'none' }}>{fmtInt(total)}</td>
                  <td style={{ ...td, fontWeight: 700, borderBottom: 'none' }}>100%</td>
                  <td style={{ ...td, fontWeight: 700, borderBottom: 'none' }}>{fmtPct(WINDOW.actConv, 1)} <span style={{ fontSize: 12, fontWeight: 400, color: C.muted }}>({fmtInt(WINDOW.activated)})</span></td>
                  <td style={{ ...td, paddingRight: 22, borderBottom: 'none' }}>{soon}</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
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
        allTime="Since Feb 16"
        question="Are we on pace?"
        footnote={`Running total of every signup (incl. repeats by the same person) since ${monDay(SIGNUP_COUNT_START)}, ${SIGNUP_COUNT_START.slice(0, 4)}, the same start as the live dashboard, shown for the last ${WEEKS.length} weeks. Last point includes the week in progress. No goal set yet — the dashed goal line will be added once we have one.`}
      >
        <StatRow>
          <Stat label={`Actual · since ${monDay(SIGNUP_COUNT_START)}`} value={fmtInt(total)} explain={`${fmtInt(total)} signups in total since ${monDay(SIGNUP_COUNT_START)} (someone signing up to two companies counts twice).`} />
          <Stat label="Goal" value="—" muted />
          <Stat label="Vs goal" value="—" muted />
        </StatRow>
        <Legend items={[{ label: 'Cumulative actual', color: C.black, line: true }, { label: 'Cumulative goal (not set)', color: '#9A9A9A', line: true, dashed: true }]} />
        <ResponsiveContainer width="100%" height={220}>
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
        </ResponsiveContainer>
      </Card>
    </div>
  );
}

function NewSignupsCard() {
  const M = useModel();
  const { WEEKLY, WINDOW } = M;
  return (
    <Card
      title="New signups"
      question="Are we converting intent into accounts?"
      footnote="Visitor → signup = signups ÷ GA4 engaged sessions for the same days. Every signup counts, including repeat signups by the same person; internal (@mutinyhq.com) signups are left out. Faintly striped bar = week in progress."
    >
      <StatRow delta={<Delta value={ptsDiff(WINDOW.conv, WINDOW.convPrev)} suffix=" pts" />}>
        <Stat label="Visitor → signup" value={fmtPct(WINDOW.conv, 2)} explain={`About ${fmtPct(WINDOW.conv, 1)} of engaged visits turned into a signup from ${rangeLabel(M.START, M.END)}.`} />
        <Stat label={`Signups · ${rangeLabel(M.START, M.END)}`} value={fmtInt(WINDOW.signups)} explain={`${fmtInt(WINDOW.signups)} signups from ${rangeLabel(M.START, M.END)}.`} sub={<Delta value={pctChange(WINDOW.signups, WINDOW.signupsPrev)} size={12} />} />
      </StatRow>
      <Legend items={[{ label: 'Signups (bars)', color: C.purple }, { label: 'Visitor → signup % (line)', color: C.black, line: true }]} />
      <ResponsiveContainer width="100%" height={190}>
        <ComposedChart data={WEEKLY} margin={chartMargin}>
          {hatchDefs([C.purple])}
          {grid}
          <XAxis {...xAxis} />
          <YAxis yAxisId="n" {...yAxis} />
          <YAxis yAxisId="p" orientation="right" {...yAxis} tickFormatter={(v) => `${v}%`} />
          <Tooltip cursor={cursor} content={({ active, payload }) => active && payload?.length ? (
            <TooltipBox
              title={weekTitle(payload[0].payload)}
              rows={[
                { label: 'Signups', value: fmtInt(payload[0].payload.signups), color: C.purple },
                { label: 'Engaged sessions', value: fmtInt(payload[0].payload.visitors) },
                { label: 'Visitor → signup', value: fmtPct(payload[0].payload.conv, 2) },
              ]}
            />
          ) : null} />
          <Bar yAxisId="n" dataKey="signups" stroke={C.black} strokeWidth={1} isAnimationActive={false}>
            {WEEKLY.map((w) => <Cell key={w.start} fill={w.partial ? `url(#${hatchId(C.purple)})` : C.purple} />)}
          </Bar>
          <Line yAxisId="p" dataKey="conv" stroke={C.black} strokeWidth={2} dot={{ r: 3, fill: C.black }} isAnimationActive={false} />
        </ComposedChart>
      </ResponsiveContainer>
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
        <Stat label={`Signups · ${rangeLabel(M.START, M.END)}`} value={fmtInt(total)} explain={`${fmtInt(total)} signups from ${rangeLabel(M.START, M.END)}, split by the role they picked.`} />
      </StatRow>
      <div style={{ ...eyebrow, marginTop: 16 }}>By role · share of signups, {rangeLabel(M.START, M.END)}</div>
      <Legend
        style={{ margin: '8px 0 6px' }}
        items={ROLES.map((r) => ({ label: r.label, color: r.color, value: fmtPct(pct(WINDOW.roleCounts[r.key], total), 0) }))}
      />
      <ResponsiveContainer width="100%" height={190}>
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
      </ResponsiveContainer>
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
        <Stat label="Signup → completed setup" value={fmtPct(allRate, 1)} sub={`${s.all} of ${s.n} signups · ${rangeLabel(M.START, M.END)}`} />
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
      <ResponsiveContainer width="100%" height={190}>
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
      </ResponsiveContainer>
    </Card>
  );
}

function ActivationCard({ stepKey, title, question, rateLabel, cohortNoun, convNoun, footnote, extra, accent }) {
  const M = useModel();
  const { ACT } = M;
  const { curr, prev, weekly } = ACT[stepKey];
  const Cohort = cohortNoun[0].toUpperCase() + cohortNoun.slice(1);
  return (
    <Card title={title} question={question} footnote={footnote} accent={accent}>
      <StatRow delta={<Delta value={ptsDiff(curr.rate, prev.rate)} suffix=" pts" />}>
        <Stat label={rateLabel} value={fmtPct(curr.rate, 1)} sub={`${curr.conv} of ${curr.n} ${cohortNoun} · ${rangeLabel(M.START, M.END)}`} />
      </StatRow>
      {extra}
      <Legend items={[{ label: 'Conversion % (line)', color: C.black, line: true }, { label: `${Cohort} (cohort size, bars)`, color: C.lightPurple }]} />
      <ResponsiveContainer width="100%" height={190}>
        <ComposedChart data={weekly} margin={chartMargin}>
          {hatchDefs([C.purple])}
          {grid}
          <XAxis {...xAxis} />
          <YAxis yAxisId="p" {...yAxis} domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} tickFormatter={(v) => `${v}%`} />
          <YAxis yAxisId="n" orientation="right" {...yAxis} allowDecimals={false} />
          <Tooltip cursor={cursor} content={({ active, payload }) => active && payload?.length ? (
            <TooltipBox
              title={weekTitle(payload[0].payload)}
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
      </ResponsiveContainer>
    </Card>
  );
}

// Shared "Sign up → X" 7-day-by-signup-day card.
function Daily7Card({ seriesKey, title, question, accent, verb, milestone, modal = {}, extraNote = '' }) {
  const M = useModel();
  const [CONV_WINDOW_DAYS] = useConvWindow();
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
  const periodLabel = rangeLabel(M.START, M.END);
  return (
    <Card
      accent={accent}
      title={title}
      question={question}
      footnote={`For each signup day, the share of that day's signups that ${milestone} on the signup day or within the next ${CONV_WINDOW_DAYS} days. Dots = each day; line = rolling 7 signup days (pooled). Signups from the last ${CONV_WINDOW_DAYS} days are still inside their window, so they're faded. The headline covers signups in the reporting period (${periodLabel}); only signups whose ${CONV_WINDOW_DAYS} days are up count toward the rate${open ? ` — ${fmtInt(open)} signups from the last ${CONV_WINDOW_DAYS} days are still open and left out` : ''}. Compared with the same for ${rangeLabel(M.PRIOR_START, M.PRIOR_END)}.${extraNote} Signups count from ${monDay(SIGNUP_COUNT_START)}. Click a day to list who ${verb}. No goal set yet.`}
    >
      <StatRow delta={<Delta value={delta} suffix=" pts" />}>
        <Stat
          label={`${CONV_WINDOW_DAYS}-day conversion · signups ${periodLabel}`}
          value={curr.n ? fmtPct(curr.rate, 1) : '—'}
          sub={curr.n ? `${fmtInt(curr.a)} of ${fmtInt(curr.n)} signups${open ? ` · ${fmtInt(open)} still in their ${CONV_WINDOW_DAYS} days` : ''}` : `All ${fmtInt(open)} signups are still in their ${CONV_WINDOW_DAYS}-day window`}
          explain={curr.n ? `Of the ${fmtInt(curr.n)} people who signed up ${rangeLabel(curr.from, curr.to)} (the part of ${periodLabel} whose ${CONV_WINDOW_DAYS} days are up), ${fmtInt(curr.a)} (${fmtPct(curr.rate, 1)}) ${verb} within ${CONV_WINDOW_DAYS} days of signing up.${open ? ` ${fmtInt(open)} later signups are still in their window.` : ''}` : null}
        />
        <Stat label="Goal" value="—" muted />
      </StatRow>
      <ListUsersButton n={curr.a} label={`${verb} within ${CONV_WINDOW_DAYS} days`} onClick={() => openUsers({ ...modal, title: `${title} within ${CONV_WINDOW_DAYS} days`, subtitle: `signed up ${curr.n ? rangeLabel(curr.from, curr.to) : periodLabel} · ${fmtInt(curr.a)} of ${fmtInt(curr.n)} signups`, users: curr.list })} />
      <Legend items={[
        { label: '7-day rolling %', color: C.black, line: true, weight: 3 },
        { label: 'Daily %', color: 'rgba(154,154,154,0.3)' },
        { label: 'Goal % (not set)', color: '#9A9A9A', line: true, dashed: true },
      ]} />
      <ResponsiveContainer width="100%" height={210}>
        <LineChart data={series.daily.filter((x) => x.d >= M.WEEKS[0].start)} margin={chartMargin} style={{ cursor: 'pointer' }} onClick={onWeekClick(openUsers, (x) => ({ ...modal, title: dayTitle(x), subtitle: `${fmtInt(x.a)} of ${fmtInt(x.n)} signups ${verb} within ${CONV_WINDOW_DAYS} days${x.mature ? '' : ' (window still open)'}`, users: x.list }))}>
          {grid}
          <XAxis {...xAxis} dataKey="d" ticks={series.ticks.filter((t) => t >= M.WEEKS[0].start)} tickFormatter={monDay} />
          <YAxis {...yAxis} domain={[0, 'auto']} tickFormatter={(v) => `${v}%`} />
          <Tooltip content={({ active, payload }) => active && payload?.length ? (
            <TooltipBox title={dayTitle(payload[0].payload)} rows={payload[0].payload.tracked ? [
              { label: `${verb[0].toUpperCase()}${verb.slice(1)} within ${CONV_WINDOW_DAYS} days`, value: fmtPct(payload[0].payload.mature ? payload[0].payload.rate : payload[0].payload.rateImm, 1), color: '#9A9A9A' },
              { label: '7-day rolling', value: fmtPct(payload[0].payload.roll, 1), color: C.black },
              { label: 'Signups that day', value: fmtInt(payload[0].payload.n) },
              { label: `${verb[0].toUpperCase()}${verb.slice(1)}`, value: fmtInt(payload[0].payload.a) },
            ] : [{ label: 'Signups that day', value: fmtInt(payload[0].payload.n) }]} note={!payload[0].payload.tracked ? 'Not tracked yet for this signup day' : payload[0].payload.mature ? `Click to list who ${verb}` : `Still inside the ${CONV_WINDOW_DAYS}-day window · click to list`} />
          ) : null} />
          <Line dataKey="rate" stroke="transparent" dot={{ r: 2.5, fill: '#9A9A9A', fillOpacity: 0.3, stroke: 'none' }} activeDot={{ r: 4, fill: accent, stroke: C.black }} isAnimationActive={false} legendType="none" />
          <Line dataKey="rateImm" stroke="transparent" dot={{ r: 2.5, fill: '#9A9A9A', fillOpacity: 0.12, stroke: 'none' }} activeDot={{ r: 4, fill: '#D9D9D9', stroke: C.black }} isAnimationActive={false} legendType="none" />
          <Line dataKey="roll" stroke={C.black} strokeWidth={2.5} dot={false} activeDot={{ r: 4, fill: accent, stroke: C.black }} connectNulls={false} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
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

function ActivatedUsersCard() {
  const M = useModel();
  const { ACTIVATED, END, START } = M;
  const A = ACTIVATED;
  const openUsers = useUsersModal();
  return (
    <Card
      accent={C.green}
      title="Total activated users (cumulative)"
      allTime="To date"
      question="Are we on pace?"
      footnote={`Running total of activated users since ${monDay(FIRST_ACT_TRACKED || END)}, ${(FIRST_ACT_TRACKED || END).slice(0, 4)} (when asset data starts; email sends start Sep 4). Activated = sent (or drafted) an email or published an asset, counted once, in the week they first did either, whatever their signup date. Asset publishes carry no company, so each is credited to the user's latest signup at the time; publishes with no user are left out. Click a week to list who activated that week. No goal set yet.`}
    >
      <StatRow>
        <Stat label="Actual · to date" value={fmtInt(A.now.cum)} explain={`${fmtInt(A.now.cum)} users have activated so far (sent an email or published an asset), ${fmtInt(A.curr)} of them from ${rangeLabel(M.START, M.END)}.`} sub={<>+{fmtInt(A.curr)} in {rangeLabel(M.START, M.END)} <Delta value={pctChange(A.curr, A.prev)} size={12} /></>} />
        <Stat label="Goal" value="—" muted />
        <Stat label="Vs goal" value="—" muted />
      </StatRow>
      <ListUsersButton n={A.curr} label={`activated in the ${M.long}`} onClick={() => openUsers({ title: 'Activated users', subtitle: `activated ${rangeLabel(START, END)}`, users: A.currList })} />
      <Legend items={[{ label: 'Cumulative actual', color: C.black, line: true }, { label: 'Cumulative goal (not set)', color: '#9A9A9A', line: true, dashed: true }]} />
      <ResponsiveContainer width="100%" height={190}>
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
      </ResponsiveContainer>
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
  const openUsers = useUsersModal();
  return (
    <div className="full">
      <Card
        accent={C.green}
        title="Activated by type of first send"
        question="Do users activate by sending an email or by publishing an asset?"
        footnote={`Users who activated in each week, split by what they did first: sent (or drafted) an email, or published an asset. If both happened on the same day, it counts as email. Email sends are only tracked from Sep 4, so earlier weeks are all assets. Faintly striped bar = week in progress. Click a bar to list that week's users.`}
      >
        <StatRow delta={<Delta value={pctChange(A.curr, A.prev)} />}>
          <Stat label={`Activated · ${rangeLabel(M.START, M.END)}`} value={fmtInt(A.curr)} explain={`${fmtInt(A.curr)} users activated for the first time from ${rangeLabel(START, END)}: ${fmtInt(A.email)} by sending an email, ${fmtInt(A.asset)} by publishing an asset.`} />
        </StatRow>
        <ListUsersButton n={A.curr} label={`activated in the ${M.long}`} onClick={() => openUsers({ title: 'Activated users', subtitle: `activated ${rangeLabel(START, END)}`, users: A.currList })} />
        <div style={{ ...eyebrow, marginTop: 16 }}>By type of first send · {rangeLabel(M.START, M.END)}</div>
        <Legend
          style={{ margin: '8px 0 6px' }}
          items={ACT_TYPES.map((t) => ({ label: t.label, color: t.color, value: fmtPct(pct(A[t.key], A.curr), 0) }))}
        />
        <ResponsiveContainer width="100%" height={240}>
          <BarChart data={A.weekly} margin={chartMargin} barCategoryGap="22%" style={{ cursor: 'pointer' }} onClick={onWeekClick(openUsers, (row) => ({ title: 'Activated users', subtitle: `activated week of ${row.range}`, users: row.list }))}>
            {hatchDefs(ACT_TYPES.map((t) => t.color))}
            {grid}
            <XAxis {...xAxis} />
            <YAxis {...yAxis} allowDecimals={false} />
            <Tooltip cursor={cursor} content={({ active, payload }) => active && payload?.length ? (
              <TooltipBox
                title={weekTitle(payload[0].payload)}
                rows={[...ACT_TYPES].reverse().map((t) => ({
                  label: t.label, color: t.color,
                  value: `${fmtInt(payload[0].payload[t.key])} · ${fmtPct(pct(payload[0].payload[t.key], payload[0].payload.n), 0)}`,
                }))}
                note={`${fmtInt(payload[0].payload.n)} activated · click to list users`}
              />
            ) : null} />
            {ACT_TYPES.map((t) => (
              <Bar key={t.key} dataKey={t.key} stackId="type" stroke={C.black} strokeWidth={0.5} isAnimationActive={false}>
                {A.weekly.map((w) => <Cell key={w.start} fill={w.partial ? `url(#${hatchId(t.color)})` : t.color} />)}
              </Bar>
            ))}
          </BarChart>
        </ResponsiveContainer>
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
      milestone="completed onboarding (installed the call recorder and connected Gmail and Google Calendar, dated by the last of the three)"
      modal={ONB_MODAL}
      extraNote={` Recorder installs are only tracked from ${monDay(FIRST_REC_TRACKED || DATA_END)}, so earlier signup days have no point and the prior-period comparison is hidden until it's fully tracked.`}
    />
  );
}

// Lever 1 detail: each onboarding step on its own, same 7-day-by-signup-day logic.
const stepModal = (noun, dateLabel, key) => ({ noun: `user ${noun}`, nounPlural: `users ${noun}`, dateLabel, dateOf: (s) => s[key], showVia: false });
const trackedNote = (d) => ` This step is only tracked from ${monDay(d || DATA_END)}, ${(d || DATA_END).slice(0, 4)}, so earlier signup days have no point.`;
function SignupToRecorderCard() {
  return (
    <Daily7Card seriesKey="REC" accent={C.purple}
      title="Signed up → downloaded call recorder"
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
      title="Signed up → connected email"
      question="Of each day's signups, what share connect email within the window?"
      verb="connected email"
      milestone="connected Gmail (any status, including failed or pending)"
      modal={stepModal('connected email', 'Email connected', 'em')}
      extraNote={trackedNote(FIRST_EM_TRACKED)} />
  );
}
function SignupToCalendarCard() {
  return (
    <Daily7Card seriesKey="CAL" accent={C.purple}
      title="Signed up → connected calendar"
      question="Of each day's signups, what share connect their calendar within the window?"
      verb="connected calendar"
      milestone="connected Google Calendar (any status, including failed or pending)"
      modal={stepModal('connected calendar', 'Calendar connected', 'cal')}
      extraNote={trackedNote(FIRST_CAL_TRACKED)} />
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
      allTime="To date"
      question="Are we on pace?"
      footnote={`Running total of users who completed onboarding (recorder installed + Gmail + Google Calendar connected) since ${monDay(FIRST_ONB_TRACKED || END)}, ${(FIRST_ONB_TRACKED || END).slice(0, 4)}, counted once, in the week they finished the last of the three, whatever their signup date. Click a week to list who completed that week. No goal set yet.`}
    >
      <StatRow>
        <Stat label="Actual · to date" value={fmtInt(O.now.cum)} explain={`${fmtInt(O.now.cum)} users have completed onboarding so far (recorder + Gmail + Google Calendar), ${fmtInt(O.curr)} of them from ${rangeLabel(M.START, M.END)}.`} sub={<>+{fmtInt(O.curr)} in {rangeLabel(M.START, M.END)} <Delta value={FIRST_ONB_TRACKED && M.PRIOR_START >= FIRST_ONB_TRACKED ? pctChange(O.curr, O.prev) : null} size={12} /></>} />
        <Stat label="Goal" value="—" muted />
        <Stat label="Vs goal" value="—" muted />
      </StatRow>
      <ListUsersButton n={O.curr} label={`completed onboarding in the ${M.long}`} onClick={() => openUsers({ ...ONB_MODAL, title: 'Completed onboarding', subtitle: `completed ${rangeLabel(START, END)}`, users: O.currList })} />
      <Legend items={[{ label: 'Cumulative actual', color: C.black, line: true }, { label: 'Cumulative goal (not set)', color: '#9A9A9A', line: true, dashed: true }]} />
      <ResponsiveContainer width="100%" height={190}>
        <LineChart data={O.weekly} margin={chartMargin} style={{ cursor: 'pointer' }} onClick={onWeekClick(openUsers, (row) => ({ ...ONB_MODAL, title: 'Completed onboarding', subtitle: `completed week of ${row.range}`, users: row.list }))}>
          {grid}
          <XAxis {...xAxis} />
          <YAxis {...yAxis} domain={[0, 'auto']} allowDecimals={false} />
          <Tooltip content={({ active, payload }) => active && payload?.length ? (
            <TooltipBox title={`To end of ${weekTitle(payload[0].payload).replace('Week of', 'week of')}`} rows={[
              { label: 'Completed to date', value: fmtInt(payload[0].payload.cum), color: C.black },
              { label: 'Change vs prior week', value: fmtSigned(payload[0].payload.cumWoW, '%', 1) },
              { label: 'Completed this week', value: fmtInt(payload[0].payload.n) },
            ]} note="Click to list this week's users" />
          ) : null} />
          <Line dataKey="cum" stroke={C.black} strokeWidth={2.5} dot={false} activeDot={{ r: 4, fill: C.purple, stroke: C.black }} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
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
    <Card
      accent={C.blue}
      title="Activated → returned"
      question="Do activated users come back the following week?"
      footnote={`${RET_DEF} Weekly points group users by the week they activated. The headline covers users who activated in the reporting period (${periodLabel}); only those whose ${RETURN_DAYS}-day window has closed count${R.curr.open ? ` — ${fmtInt(R.curr.open)} who activated in the last ${RETURN_DAYS} days are still open and left out` : ''}. Compared with the same for ${rangeLabel(M.PRIOR_START, M.PRIOR_END)}. Dotted = weeks whose windows are still open. ${RET_SOURCES} Click a week to list who returned. No goal set yet.`}
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
      <ListUsersButton n={R.curr.k} label={`returned within ${RETURN_DAYS} days`} onClick={() => openUsers({ ...RET_MODAL, title: 'Returned users', subtitle: `activated ${rangeLabel(R.curr.from, R.curr.to)} · ${fmtInt(R.curr.k)} of ${fmtInt(R.curr.n)} returned`, users: R.curr.retList })} />
      <Legend items={[{ label: 'Actual %', color: C.black, line: true }, { label: 'Goal % (not set)', color: '#9A9A9A', line: true, dashed: true }]} />
      <ResponsiveContainer width="100%" height={210}>
        <LineChart data={R.weekly} margin={chartMargin} style={{ cursor: 'pointer' }} onClick={onWeekClick(openUsers, (row) => ({ ...RET_MODAL, title: 'Returned users', subtitle: `activated week of ${row.range} · ${fmtInt(row.k)} of ${fmtInt(row.n)} returned${row.mature ? '' : ' (window still open)'}`, users: row.retList }))}>
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
      </ResponsiveContainer>
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
    <Card
      accent={C.blue}
      title="Weekly returned users"
      question="How many activated users come back each week?"
      footnote={`${RET_DEF} Chart: weekly count, not cumulative, by the week they activated; dotted = weeks whose windows are still open. Headline: returned users among those who activated in the reporting period (${periodLabel}) whose ${RETURN_DAYS}-day window has closed, vs the same for ${rangeLabel(M.PRIOR_START, M.PRIOR_END)}. ${RET_SOURCES} Click a week to list who returned. No goal set yet.`}
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
      {c.n > 0 && <ListUsersButton n={c.k} label={`returned (activated ${periodLabel})`} onClick={() => openUsers({ ...RET_MODAL, title: 'Returned users', subtitle: `activated ${rangeLabel(c.from, c.to)} · ${fmtInt(c.k)} of ${fmtInt(c.n)} returned`, users: c.retList })} />}
      <Legend items={[{ label: 'Actual', color: C.black, line: true }, { label: 'Goal (not set)', color: '#9A9A9A', line: true, dashed: true }]} />
      <ResponsiveContainer width="100%" height={210}>
        <LineChart data={R.weekly} margin={chartMargin} style={{ cursor: 'pointer' }} onClick={onWeekClick(openUsers, (row) => ({ ...RET_MODAL, title: 'Returned users', subtitle: `activated week of ${row.range} · ${fmtInt(row.k)} of ${fmtInt(row.n)} returned${row.mature ? '' : ' (window still open)'}`, users: row.retList }))}>
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
      </ResponsiveContainer>
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
      <Card title={title} question={question} accent={C.lightGrey}>
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
  // Day each company had its 2nd activated user (any of its signups, any signup date).
  const secondActByCo = new Map();
  {
    const acts = new Map();
    for (const s of SIGNUPS) { const a = s.co && actDate(s); if (a) (acts.get(s.co) || acts.set(s.co, []).get(s.co)).push(a); }
    for (const [co, l] of acts) if (l.length >= 2) secondActByCo.set(co, l.sort()[1]);
  }
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
    // 2+ activated → paid: companies that have had 2+ activated users by `day`,
    // and how many of them are paying that day.
    let act2 = 0;
    for (const d2 of secondActByCo.values()) if (d2 <= day) act2 += 1;
    const act2Paying = list.filter((c) => c.co && secondActByCo.has(c.co) && secondActByCo.get(c.co) <= day).length;
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
    <Card
      accent={C.green}
      title="Sign up → paid"
      question="What share of companies that sign up end up paying?"
      footnote={`Paying companies ÷ individual companies that have signed up, as of the end of each week. Signed up = a distinct company id whose first signup is on or after ${monDay(SIGNUP_COUNT_START)}, ${SIGNUP_COUNT_START.slice(0, 4)} (same start as the signup counts), plus older companies once they've started paying (e.g. accounts from before ${monDay(SIGNUP_COUNT_START)} that converted later), so every paying PLG company counts. Paying = PLG Stripe customer with MRR above $0 (revenue dashboard definition). No goal set yet.`}
    >
      <StatRow delta={<Delta value={ptsDiff(now.conv, prev.conv)} suffix=" pts" />} deltaLabel={`vs ${monDay(addDays(M.START, -1))}`}>
        <Stat label={`Conversion · as of ${monDay(now.day)}`} value={fmtPct(now.conv, 1)} explain={`Of the ${fmtInt(now.cohort)} companies that signed up since ${monDay(SIGNUP_COUNT_START)} (plus older ones that started paying), ${fmtInt(now.cohortPaying)} (${fmtPct(now.conv, 1)}) were paying on ${monDay(now.day)}.`} sub={<span style={{ fontSize: 12, color: C.muted }}>{fmtInt(now.cohortPaying)} of {fmtInt(now.cohort)} companies</span>} />
        <Stat label="Goal" value="—" muted />
      </StatRow>
      <Legend items={[{ label: 'Actual %', color: C.black, line: true }, { label: 'Goal % (not set)', color: '#9A9A9A', line: true, dashed: true }]} />
      <ResponsiveContainer width="100%" height={200}>
        <LineChart data={weeks} margin={chartMargin}>
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
      </ResponsiveContainer>
    </Card>
  );
}

function Act2ToPaidCard() {
  const M = useModel();
  const weeks = payingWeekly(M);
  const now = PAYING.asOf(M.END);
  const prev = PAYING.asOf(addDays(M.START, -1));
  return (
    <Card
      accent={C.purple}
      title="2+ activated users → paid"
      question="Of companies with 2 or more activated users, what share are paying?"
      footnote={`Paying companies ÷ companies that have had at least 2 activated users (sent or drafted an email, or published an asset), as of the end of each week. Paying = PLG Stripe customer with MRR above $0 (revenue dashboard definition). The dashed line is Sign up → paid for all signed-up companies, for comparison. This is a point-in-time share, not a prediction: some companies were already paying before their 2nd user activated — the Activation section's "Does activation predict paid" card handles that. No goal set yet.`}
    >
      <StatRow delta={<Delta value={ptsDiff(now.act2Conv, prev.act2Conv)} suffix=" pts" />} deltaLabel={`vs ${monDay(addDays(M.START, -1))}`}>
        <Stat
          label={`Conversion · as of ${monDay(now.day)}`}
          value={fmtPct(now.act2Conv, 1)}
          sub={<span style={{ fontSize: 12, color: C.muted }}>{fmtInt(now.act2Paying)} of {fmtInt(now.act2)} companies</span>}
          explain={`Of the ${fmtInt(now.act2)} companies that have had 2 or more activated users, ${fmtInt(now.act2Paying)} (${fmtPct(now.act2Conv, 1)}) were paying on ${monDay(now.day)} — vs ${fmtPct(now.conv, 1)} of all signed-up companies.`}
        />
        <Stat label="Goal" value="—" muted />
      </StatRow>
      <Legend items={[{ label: '2+ activated → paid', color: C.black, line: true }, { label: 'All companies (sign up → paid)', color: '#9A9A9A', line: true, dashed: true }]} />
      <ResponsiveContainer width="100%" height={200}>
        <LineChart data={weeks} margin={chartMargin}>
          {grid}
          <XAxis {...xAxis} />
          <YAxis {...yAxis} tickFormatter={(v) => `${v}%`} domain={[0, 'auto']} />
          <Tooltip content={({ active, payload }) => active && payload?.length ? (
            <TooltipBox title={weekTitle(payload[0].payload)} rows={[
              { label: '2+ activated → paid', value: fmtPct(payload[0].payload.act2Conv, 2), color: C.black },
              { label: 'Paying (2+ activated)', value: fmtInt(payload[0].payload.act2Paying) },
              { label: 'Companies with 2+ activated', value: fmtInt(payload[0].payload.act2) },
              { label: 'All companies (sign up → paid)', value: fmtPct(payload[0].payload.conv, 2) },
            ]} />
          ) : null} />
          <Line dataKey="act2Conv" stroke={C.black} strokeWidth={2.5} dot={false} activeDot={{ r: 4, fill: C.purple, stroke: C.black }} isAnimationActive={false} />
          <Line dataKey="conv" stroke="#9A9A9A" strokeWidth={2} strokeDasharray="5 4" dot={false} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </Card>
  );
}

function PayingCompaniesCard() {
  const M = useModel();
  const weeks = payingWeekly(M);
  const now = PAYING.asOf(M.END);
  const prev = PAYING.asOf(addDays(M.START, -1));
  return (
    <Card
      accent={C.green}
      title="Paying companies (PLG)"
      question="How many self-serve companies are paying?"
      footnote={`Same definition as the revenue dashboard's Paying logos: one Stripe customer = one company, paying when its MRR (rebuilt from invoices) is above $0 at the end of each week. Enterprise customers are excluded; accounts that graduated to enterprise count only until their graduation date. Scheduled-to-cancel and past-due still count. Last point includes the week in progress.`}
    >
      <StatRow delta={<Delta value={pctChange(now.companies, prev.companies)} />} deltaLabel={`vs ${monDay(addDays(M.START, -1))} (${fmtInt(prev.companies)})`}>
        <Stat label={`Paying · as of ${monDay(now.day)}`} value={fmtInt(now.companies)} explain={`${fmtInt(now.companies)} self-serve companies were paying on ${monDay(now.day)} (enterprise not included).`} />
        <Stat label="PLG ARR" value={`$${fmtInt(Math.round(now.arr))}`} explain={`Those companies pay $${fmtInt(Math.round(now.arr / 12))} a month in total, so $${fmtInt(Math.round(now.arr))} a year.`} />
      </StatRow>
      <Legend items={[{ label: 'Paying companies (end of week)', color: C.black, line: true }]} />
      <ResponsiveContainer width="100%" height={200}>
        <LineChart data={weeks} margin={chartMargin}>
          {grid}
          <XAxis {...xAxis} />
          <YAxis {...yAxis} allowDecimals={false} domain={[0, 'auto']} />
          <Tooltip content={({ active, payload }) => active && payload?.length ? (
            <TooltipBox title={weekTitle(payload[0].payload)} rows={[
              { label: 'Paying companies', value: fmtInt(payload[0].payload.companies), color: C.black },
              { label: 'PLG ARR', value: `$${fmtInt(Math.round(payload[0].payload.arr))}` },
            ]} />
          ) : null} />
          <Line dataKey="companies" stroke={C.black} strokeWidth={2.5} dot={false} activeDot={{ r: 4, fill: C.green, stroke: C.black }} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
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
      <ResponsiveContainer width="100%" height={220}>
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
      </ResponsiveContainer>
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
        <div style={{ overflowX: 'auto', margin: '16px -22px 0' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 160 + (R.maxK + 1) * 64 }}>
            <thead>
              <tr>
                <th style={{ ...th, textAlign: 'left', paddingLeft: 22 }}>Cohort</th>
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
        <ResponsiveContainer width="100%" height={220}>
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
        </ResponsiveContainer>
      </Card>
    </div>
  );
}

// --- Does activation predict paid and retention? (company level) -----------------
// Nick, Oct 7. Same leading-indicator rules as the returning card:
//   2+ activated: companies with at least 2 activated users (actDate);
//     anchor = the day the 2nd user activated.
//   1 activated: companies with exactly 1 activated user (Nick, Oct 7 — not
//     companies with 0, which would inflate the lift); anchor = that activation.
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
    if (!acts.length) continue; // compare 2+ against exactly 1 activated user
    const grp = acts.length >= 2 ? 'T' : 'C';
    const anchor = grp === 'T' ? acts[1] : acts[0];
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
        if (!nAct) continue; // nobody activated before they started paying
        const g = nAct >= 2 ? 'T' : 'C';
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
    { key: 'T', label: '2+ activated users', color: C.black, text: C.black },
    { key: 'C', label: '1 activated user', color: '#CFCFCF', text: C.black },
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
      <Card
        accent={C.purple}
        title="Does activation predict paid and retention?"
        allTime="Since Feb 16"
        question="Companies with 2+ activated users vs companies with 1: do they convert to paid, and keep paying?"
        footnote={`Company level, companies with a signup since ${monDay(SIGNUP_COUNT_START)}. Activated user = sent (or drafted) an email or published an asset. Converted to paid: 2+ activated = companies with at least 2 activated users, measured from the day the 2nd one activated; 1 activated user = companies with exactly one, measured from the day it activated (companies with none are left out). Converted = first paid (PLG Stripe, MRR above $0) within ${PAID_WINDOW} days after that day. Companies already paying by then are left out (${fmtInt(P.excluded)}), and companies whose ${PAID_WINDOW} days aren't up yet aren't counted (${fmtInt(P.open)}). Retention rate: of the companies that started paying, the share still paying at the end of the month after their first paid month (month 1, same as the cohort heat map), grouped by how many activated users they had when they started paying (2+ vs exactly 1); only companies whose month 1 has finished count. Small numbers — read as directional.`}
      >
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 36, marginTop: 18 }}>
          <LiftBars eyebrowLabel={`Converted to paid (within ${PAID_WINDOW} days)`} verb="convert to paid" data={P.paid} explain={(d) => `${fmtPct(d.T.rate, 1)} of companies with 2+ activated users started paying within ${PAID_WINDOW} days, vs ${fmtPct(d.C.rate, 1)} of companies with 1 — ${d.lift.toFixed(1)} times as likely.`} />
          <LiftBars eyebrowLabel="Retention rate (month 1)" verb="retain" data={P.ret} explain={(d) => `Of paying companies, ${fmtPct(d.T.rate, 1)} of those with 2+ activated users were still paying a month later, vs ${fmtPct(d.C.rate, 1)} of those with 1 — ${d.lift.toFixed(1)} times as likely.`} />
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
  if (running.length) columns.push({ key: 'current', label: 'Current', title: `Cycles in progress (usage to ${monDay(cut)})`, current: true, rows: running, ...cycleSummary(running) });
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
      <Card
        accent={C.purple}
        title="Credits used per billing cycle"
        question="How much of each billing cycle's credits do paying companies use?"
        footnote={`One point per paying self-serve (PLG) company per billing cycle (from its Stripe renewal invoices). % used = credits used during the cycle ÷ the cycle's allowance (credits per $ × what the cycle was billed, incl. credit packs bought mid-cycle). Credits per $ comes from today's allowance export (includes manual / reward credits); companies not paying today use the typical ${D.typical.toFixed(1)} credits per $. Each column counts the cycles that ENDED in that month; "Current" = cycles still running (usage so far ÷ the full allowance, so it reads low — faded). Columns = how many company cycles fall in each usage band; the line = the average company % used (each company counts equally). Cycles that began before credit usage is tracked (${monDay(D.usageStart)}) are left out. The headline covers cycles that ended in the reporting period, vs the period before. Click a column (or one band of it) to see each company's cycle, billing, allowance and usage.`}
      >
        {L.n > 0 && (
          <StatRow delta={<Delta value={P.n ? ptsDiff(L.avg, P.avg) : null} suffix=" pts" />} deltaLabel={`vs cycles ending ${rangeLabel(M.PRIOR_START, M.PRIOR_END)}`}>
            <Stat label={`Average · cycles ending ${lastLabel}`} value={fmtPct(L.avg, 1)} sub={`${fmtInt(L.n)} company cycles · median ${fmtPct(L.median, 1)}`} explain={`For billing cycles that ended ${lastLabel}, paying companies used ${fmtPct(L.avg, 1)} of that cycle's credits on average (each company counts equally; a few heavy users pull it above the median of ${fmtPct(L.median, 1)}).`} />
            <Stat label={`All credits used · ${lastLabel}`} value={fmtPct(L.pooled, 1)} sub={`${fmtInt(L.used)} of ${fmtInt(L.allowed)} credits`} explain={`Across the ${fmtInt(L.n)} cycles that ended ${lastLabel}, companies used ${fmtInt(L.used)} of the ${fmtInt(L.allowed)} credits they had — ${fmtPct(L.pooled, 1)}.`} />
            <Stat label={`Used under 10% · ${lastLabel}`} value={fmtInt(L.b0)} sub={`of ${fmtInt(L.n)} company cycles`} explain={`${fmtInt(L.b0)} of the ${fmtInt(L.n)} cycles that ended ${lastLabel} used less than a tenth of their credits.`} />
          </StatRow>
        )}
        <Legend style={{ margin: '14px 0 6px' }} items={[...CREDIT_BANDS.map((b) => ({ label: b.label, color: b.color })), { label: 'Average % (line)', color: C.black, line: true }]} />
        <ResponsiveContainer width="100%" height={260}>
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
        </ResponsiveContainer>
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
        <div style={{ overflowX: 'auto', margin: '16px -22px 0' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 160 + (D.maxK + 1) * 64 }}>
            <thead>
              <tr>
                <th style={{ ...th, textAlign: 'left', paddingLeft: 22 }}>Started paying</th>
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

// Conversion-window dropdown (Stage 3 header); drives every "Sign up → X" chart.
function ConvWindowSelect() {
  const [days, setDays] = useConvWindow();
  return (
    <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontFamily: FONT_BODY, fontSize: 12, fontWeight: 600 }}>
      <span style={{ ...eyebrow, fontSize: 10 }}>Conversion window</span>
      <select
        value={days}
        onChange={(e) => setDays(Number(e.target.value))}
        style={{ fontFamily: FONT_BODY, fontSize: 13, fontWeight: 600, padding: '5px 28px 5px 10px', border: `1px solid ${C.black}`, borderRadius: 999, background: C.white, cursor: 'pointer' }}
      >
        {CONV_WINDOWS.map((w) => <option key={w} value={w}>{w}-day window</option>)}
      </select>
    </label>
  );
}

// Collapsible detail section (closed by default). Children only mount when
// open, so hidden charts don't render.
function Collapsible({ title, children, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section style={{ margin: '28px 0 0' }}>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        style={{ display: 'inline-flex', alignItems: 'center', gap: 8, border: `1px solid ${C.black}`, borderRadius: 4, background: C.white, cursor: 'pointer', fontFamily: FONT_BODY, fontSize: 14, fontWeight: 700, padding: '8px 14px', boxShadow: `2px 2px 0 ${C.black}` }}
      >
        <span aria-hidden="true" style={{ display: 'inline-block', transition: 'transform 120ms', transform: open ? 'rotate(90deg)' : 'none' }}>›</span>
        {title}
      </button>
      {open && <div style={{ marginTop: 14 }}>{children}</div>}
    </section>
  );
}

// --- Sections per funnel view -------------------------------------------------
function SectionsFor({ view }) {
  if (view === 'signup') {
    return (
      <>
        <StageHeader n={1} title="Website visitors" subtitle="Top of the funnel: people who reach the site." />
        <Grid>
          <div className="full"><WebsiteVisitorsCard /></div>
          <VisitorToSignupCard />
          <HighIntentCard accent={C.blue} title="Website visitor → high-intent visitor" question="What share of visitors show real buying intent?" />
        </Grid>
        <StageHeader n={2} title="Sign up" subtitle="Visitors who create an account. The gate between anonymous and known." />
        <Grid>
          <HighIntentCard accent={C.purple} title="High-intent visitor → sign up" question="Do high-intent visitors create an account?" />
          <CumulativeSignupsCard />
        </Grid>
        <StageHeader title="Channel deep dive" subtitle="Which channels bring visitors, and which of them convert." />
        <Grid>
          <VisitorsByChannelCard />
          <SignupsByChannelCard />
        </Grid>
      </>
    );
  }
  if (view === 'activation') {
    return (
      <>
        <StageHeader n={3} title="Activation" subtitle="First real value. The aha moment: a meeting captured and a first send." right={<ConvWindowSelect />} />
        <Grid>
          <SignupToActivatedCard />
          <ActivatedUsersCard />
          {ACT_PREDICT && <ActivationPredictsCard />}
          <ActivatedByTypeCard />
          {/* Hidden for now (Nick, Oct 6) — components kept, re-add to show:
              <CompletedSetupCard /> <FirstMeetingCard /> <FirstSendCard /> */}
        </Grid>
        <StageHeader prefix="Lever 1" title="Onboarding" subtitle="Users who installed the call recorder and connected email and Google Calendar. Conversion charts use the window set at Stage 3." />
        <Grid>
          <SignupToOnboardedCard />
          <OnboardedUsersCard />
        </Grid>
        <Collapsible title="Onboarding steps in detail">
          <p style={{ fontFamily: FONT_BODY, fontSize: 13, color: C.muted, margin: '0 0 14px', maxWidth: 820, lineHeight: 1.5 }}>
            Completed onboarding needs all three steps. Here's each one on its own: of each day's signups, the share that did that step within the selected window. Use these to see which step people stall on.
          </p>
          <Grid cols={3}>
            <SignupToRecorderCard />
            <SignupToEmailCard />
            <SignupToCalendarCard />
          </Grid>
        </Collapsible>
        <StageHeader prefix="Lever 2" title="A1: Magic moment" subtitle="The moment a new user first gets real value from Mutiny." />
        <Grid>
          <ComingSoonCard
            title="A1: Magic moment"
            question="What is the magic moment, and how many users reach it?"
            heading="Definition coming"
            body="We still need to determine exactly what the magic moment is. We'll work with Product on this."
          />
        </Grid>
        <StageHeader prefix="Lever 3" title="A2: First customer send" subtitle="The first time a user sends something to a real customer." />
        <Grid>
          <ComingSoonCard
            title="A2: First customer send"
            question="What counts as a first customer send, and how many users reach it?"
            heading="Definition coming"
            body="We still need to determine exactly what the first customer send is. We'll work with Product on this."
          />
        </Grid>
        <StageHeader title="Returned" subtitle={`Activated users who come back within ${RETURN_DAYS} days of activating and do something meaningful.`} />
        <Grid>
          <ActivatedToReturnedCard />
          <WeeklyReturnedUsersCard />
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
            <Grid cols={3}>
              <SignupToPaidCard />
              <PayingCompaniesCard />
              <Act2ToPaidCard />
            </Grid>
            <div style={{ marginTop: 20 }}><Grid><div className="full"><TotalPayingUsersCard /></div></Grid></div>
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
  const gaLast = Object.keys(ENGAGED_BY_DATE).filter((d) => ENGAGED_BY_DATE[d] != null).sort().pop() || null;
  const ampLast = betaSignups.ampEvents?.lastDay
    || (() => { const days = (dataJson.amplitude?.referralSources || []).flatMap((e) => Object.keys(e.daily || {})).sort(); const d = days.pop(); return d ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6)}` : null; })();
  return [
    { name: 'Signups', day: DATA_END },
    { name: 'Website', day: gaLast },
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

export default function BetaDashboard() {
  const [view, setViewState] = useState(readHashView);
  // Reporting period toggle (remembered per browser).
  const [mode, setModeState] = useState(() => {
    try { const m = window.localStorage.getItem('beta-mode'); return MODES[m] ? m : DEFAULT_MODE; } catch (e) { return DEFAULT_MODE; }
  });
  const setMode = (m) => {
    setModeState(m);
    try { window.localStorage.setItem('beta-mode', m); } catch (e) { /* ignore */ }
  };
  const M = MODELS[mode];
  const { START, END, WEEKS } = M;
  const [usersModal, setUsersModal] = useState(null);
  // Conversion window for the "Sign up → X" charts (remembered per browser).
  const [convWindow, setConvWindowState] = useState(() => {
    try { const w = Number(window.localStorage.getItem('beta-conv-window')); return CONV_WINDOWS.includes(w) ? w : DEFAULT_CONV_WINDOW; } catch (e) { return DEFAULT_CONV_WINDOW; }
  });
  const setConvWindow = (w) => {
    setConvWindowState(w);
    try { window.localStorage.setItem('beta-conv-window', String(w)); } catch (e) { /* ignore */ }
  };
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

  const currentUrl = (() => {
    if (typeof window === 'undefined') return '/';
    const u = new URL(window.location.href);
    u.searchParams.delete('beta');
    u.hash = '';
    return u.pathname + u.search;
  })();

  return (
    <ModelCtx.Provider value={M}>
    <UsersModalCtx.Provider value={setUsersModal}>
    <ConvWindowCtx.Provider value={[convWindow, setConvWindow]}>
    <div style={{ background: C.paper, minHeight: '100vh', fontFamily: FONT_BODY, color: C.black }}>
      <style>{PAGE_CSS}</style>
      <header style={{ borderBottom: `1px solid ${C.black}`, background: C.white }}>
        <div style={{ maxWidth: 1400, margin: '0 auto', padding: '26px 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' }}>
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
            <a href={currentUrl} style={{ border: `1px solid ${C.black}`, borderRadius: 4, background: C.white, padding: '7px 12px', fontSize: 13, fontWeight: 600, color: C.black, textDecoration: 'none', boxShadow: `2px 2px 0 ${C.black}` }}>
              View current dashboard
            </a>
            <div style={{ border: `1px solid ${C.black}`, borderRadius: 4, background: C.lightBlue, padding: '9px 14px', fontSize: 13, lineHeight: 1.45 }}>
              <div style={{ color: C.muted }}>Reporting period</div>
              <div role="group" aria-label="Reporting period" style={{ display: 'inline-flex', marginTop: 6, border: `1px solid ${C.black}`, borderRadius: 999, overflow: 'hidden', background: C.white }}>
                {Object.entries(MODES).map(([id, m]) => (
                  <button
                    key={id}
                    type="button"
                    aria-pressed={mode === id}
                    onClick={() => setMode(id)}
                    style={{ padding: '5px 14px', border: 'none', background: mode === id ? C.black : 'transparent', color: mode === id ? C.white : C.black, cursor: mode === id ? 'default' : 'pointer', fontFamily: FONT_BODY, fontSize: 12, fontWeight: 600 }}
                  >
                    {MODELS[id].label}
                  </button>
                ))}
              </div>
              <div style={{ fontWeight: 700, marginTop: 6 }}>{rangeLabel(START, END)}, {END.slice(0, 4)} <span style={{ fontWeight: 400 }}>· {M.noPrior ? 'no prior-year data to compare' : `vs ${rangeLabel(M.PRIOR_START, M.PRIOR_END)}`}</span></div>
              {M.WTD && <div style={{ color: C.muted, marginTop: 2 }}>Week to date: {rangeLabel(M.WTD.start, M.WTD.end)} (not in totals)</div>}
              <DataAsOf />
            </div>
          </div>
        </div>
      </header>

      <main style={{ maxWidth: 1400, margin: '0 auto', padding: '28px 24px 64px' }}>

        <PlgFunnel view={view} setView={setView} />
        <ViewingBar view={view} />
        <SectionsFor view={view} />

        <div style={{ fontFamily: FONT_CAPTION, fontStyle: 'italic', fontSize: 12, color: C.muted, marginTop: 28 }}>
          Signups export: {betaSignups.source} · {SIGNUPS.length.toLocaleString()} signup rows · {monDay(DATA_START)} {DATA_START.slice(0, 4)} – {monDay(betaSignups.lastDate)} {betaSignups.lastDate.slice(0, 4)} ({COUNTED_SIGNUPS.toLocaleString()} counted as signups from {monDay(SIGNUP_COUNT_START)}, {SIGNUP_COUNT_START.slice(0, 4)}){betaSignups.internalExcluded ? `; ${betaSignups.internalExcluded.toLocaleString()} internal @mutinyhq.com signups excluded` : ''}.
          GA4 pulled {dataJson.ga4.pulledAt?.slice(0, 10)}.
        </div>
      </main>
      <UsersModal data={usersModal} onClose={closeUsersModal} />
    </div>
    </ConvWindowCtx.Provider>
    </UsersModalCtx.Provider>
    </ModelCtx.Provider>
  );
}
