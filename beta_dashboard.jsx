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
const rangeLabel = (a, b) => `${monDay(a)} – ${monDay(b)}`;
const daysBetweenISO = (a, b) => Math.round((toDate(b) - toDate(a)) / 86400000);

// --- Source data --------------------------------------------------------------
const SIGNUPS = betaSignups.signups;
const ENGAGED_BY_DATE = Object.fromEntries(
  dataJson.ga4.file1.map((r) => [`${r.date.slice(0, 4)}-${r.date.slice(4, 6)}-${r.date.slice(6)}`, r.engagedSessions]),
);

const DATA_START = betaSignups.firstDate;
const DATA_END = betaSignups.lastDate;
const inRange = (d, a, b) => d >= a && d <= b;

// Reporting windows (toggle, top right). Both end on the export's last day.
//   30d — last 30 days; prior = the 30 days before. Weekly charts show the
//         trailing CHART_WEEKS Mon–Sun weeks (export carries full history).
//   4w  — last 4 complete Mon–Sun weeks + the week in progress (Monday of the
//         current week − 28d → last day), same as the live dashboard /
//         Amplitude "Last 4 weeks"; prior = the same-length span just before.
//         Weekly charts show just those weeks.
const CHART_WEEKS = 12;
const MODES = {
  '30d': { label: 'Last 30 days', short: '30d', long: 'last 30 days', prior: 'prior 30d' },
  '4w': { label: 'Last 4 weeks', short: '4w', long: 'last 4 weeks', prior: 'prior 4w' },
};
function makeWindow(mode) {
  const END = DATA_END;
  const START = mode === '4w' ? addDays(mondayOf(END), -28) : addDays(END, -29);
  const span = daysBetweenISO(START, END) + 1;
  const PRIOR_END = addDays(START, -1);
  const PRIOR_START = addDays(START, -span);
  const firstWeek = mode === '4w' ? START : addDays(mondayOf(END), -7 * (CHART_WEEKS - 1));
  const WEEKS = [];
  for (let w = firstWeek < mondayOf(DATA_START) ? mondayOf(DATA_START) : firstWeek; w <= END; w = addDays(w, 7)) {
    const sun = addDays(w, 6);
    WEEKS.push({ start: w, end: sun, label: monDay(w), partial: sun > END, range: rangeLabel(w, sun > END ? END : sun) });
  }
  return { mode, ...MODES[mode], END, START, PRIOR_START, PRIOR_END, WEEKS };
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
  function recent(span) {
    const to = lastMature;
    const from = addDays(to, -(span - 1));
    return { curr: pooled(from, to), prev: pooled(addDays(from, -span), addDays(from, -1)) };
  }
  // Daily series: trailing CHART_WEEKS weeks regardless of the toggle.
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
      const end = w.partial ? END : w.end;
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
    weekly: WEEKS.map((w) => ({ ...w, ...activationStats(step, w.start, w.partial ? END : w.end) })),
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
      const end = w.partial ? END : w.end;
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
      now: cumAsOf(END),
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
      const end = w.partial ? END : w.end;
      const list = onboardedIn(w.start, end);
      const cur = cumAsOf(end);
      const before = cumAsOf(addDays(w.start, -1));
      return { ...w, n: list.length, list, ...cur, cumPctWoW: ptsDiff(cur.cumPct, before.cumPct), cumWoW: pctChange(cur.cum, before.cum) };
    });
    return { curr: curr.length, currList: curr, prev: onboardedIn(PRIOR_START, PRIOR_END).length, now: cumAsOf(END), atPriorEnd: cumAsOf(PRIOR_END), weekly };
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
      const end = w.partial ? END : w.end;
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
    // Headline conversion: the latest `span` activation days whose window has
    // closed, vs the `span` before (same idea as Stage 3).
    const span = daysBetweenISO(START, END) + 1;
    const to = RET_LAST_MATURE;
    const from = addDays(to, -(span - 1));
    const curr = { ...cohort(from, to), from, to };
    const prev = cohort(addDays(from, -span), addDays(from, -1));
    // Weekly headline: the latest week whose windows have all closed.
    const matureWeeks = weekly.filter((w) => w.mature && !w.partial);
    const lastWeek = matureWeeks[matureWeeks.length - 1] || null;
    const prevWeek = matureWeeks[matureWeeks.length - 2] || null;
    return { weekly, curr, prev, lastWeek, prevWeek };
  })();

  const CHANNEL_WEEKLY = WEEKS.map((w) => {
    const s = sumByChannel(GA_SESSIONS, w.start, w.partial ? END : w.end);
    return { ...w, ...s, total: sumVals(s) };
  });

  const CH30 = (() => {
    const sessions = sumByChannel(GA_SESSIONS, START, END);
    const sessionsPrev = sumByChannel(GA_SESSIONS, PRIOR_START, PRIOR_END);
    return { sessions, total: sumVals(sessions), totalPrev: sumVals(sessionsPrev) };
  })();

  const SELF_REPORTED = (() => {
    const a = START.replaceAll('-', '');
    const b = END.replaceAll('-', '');
    const counts = Object.fromEntries(SELF_REPORTED_BUCKETS.map((x) => [x.name, 0]));
    for (const e of dataJson.amplitude?.referralSources || []) {
      let n = 0;
      for (const [d, v] of Object.entries(e.daily || {})) if (d >= a && d <= b) n += v || 0;
      if (n) counts[categorizeReferralSource(e.source)] += n;
    }
    const answered = sumVals(counts);
    const noAnswer = Math.max(0, WINDOW.signups - answered);
    // Split of "No answer" (Nick, Oct 7). Answers are Amplitude daily totals,
    // not per user, so the split is aggregate: No company name (Metabase, per
    // signup) and Accepted an invite (Amplitude User Invitation Completed daily
    // uniques) are counted directly; Other is what's left. Approximate — a few
    // people can land in both groups, or be in a group yet still have answered.
    const noName = signupsIn(START, END).filter((s) => s.nc).length;
    const invDaily = dataJson.amplitude?.inviteAcceptedDaily;
    let invited = null;
    if (invDaily) {
      invited = 0;
      for (const [d, v] of Object.entries(invDaily)) if (d >= a && d <= b) invited += v || 0;
    }
    const other = Math.max(0, noAnswer - noName - (invited || 0));
    return { counts, answered, noAnswer, noName, invited, other };
  })();

  const VISITOR_LINE = WEEKLY.map((w, i) => {
    const next = WEEKLY[i + 1];
    return {
      ...w,
      visitorsFull: w.partial ? null : w.visitors,
      visitorsPartial: w.partial || next?.partial ? w.visitors : null,
    };
  });

  return { ...W, WINDOW, WEEKLY, ACT, MEETING_ANY_30D, ACTIVATED, ONBOARDED, RETURNED, CHANNEL_WEEKLY, CH30, SELF_REPORTED, VISITOR_LINE };
}
const MODELS = { '30d': buildModel('30d'), '4w': buildModel('4w') };
const ModelCtx = React.createContext(MODELS['30d']);
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
                  <th style={th}>{dateLabel}</th>
                  {showVia && <th style={th}>Via</th>}
                </tr>
              </thead>
              <tbody>
                {rows.map((u, i) => (
                  <tr key={`${u.uid}-${u.co}-${i}`}>
                    <td style={td}>
                      {u.uid ? (
                        <a href={`${ADMIN_USER_URL}${u.uid}`} target="_blank" rel="noopener noreferrer" title={u.uid} style={u.email ? { color: C.black } : { fontFamily: "'Geist Mono', 'SF Mono', Consolas, monospace", fontSize: 12, color: C.black }}>{u.email || u.uid}</a>
                      ) : <span style={{ color: C.muted }}>unknown</span>}
                    </td>
                    <td style={{ ...td, ...tabular }}>{monDay(u.d)} {u.d.slice(0, 4)}</td>
                    <td style={{ ...td, ...tabular }}>{monDay(dateOf(u))}</td>
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

function Stat({ label, value, muted, sub }) {
  return (
    <div>
      <div style={eyebrow}>{label}</div>
      <div style={{ ...tabular, fontFamily: FONT_DISPLAY, fontSize: 34, lineHeight: 1.05, letterSpacing: '-0.03em', marginTop: 4, color: muted ? C.muted : C.black }}>{value}</div>
      {sub && <div style={{ fontFamily: FONT_BODY, fontSize: 12, color: C.muted, marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

function StatRow({ children, delta, deltaLabel }) {
  const M = useModel();
  deltaLabel = deltaLabel || `vs ${M.prior}`;
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

function Card({ title, question, notice, footnote, children, accent = C.purple }) {
  return (
    <article style={{
      display: 'flex', flexDirection: 'column', background: C.white, border: `1px solid ${C.black}`,
      borderRadius: 4, padding: '20px 22px 18px', minWidth: 0, position: 'relative',
      boxShadow: `4px 4px 0 ${accent}`,
    }}>
      <h3 style={{ fontFamily: FONT_BODY, fontSize: 16, lineHeight: 1.35, fontWeight: 700, margin: 0 }}>{title}</h3>
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
const xAxis = { dataKey: 'label', tick, tickLine: false, axisLine: { stroke: C.black }, tickMargin: 6, interval: 0 };
const yAxis = { tick, tickLine: false, axisLine: false, width: 44 };
const grid = <CartesianGrid vertical={false} stroke={C.grid} />;
const chartMargin = { top: 6, right: 4, left: -6, bottom: 0 };
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
const weekTitle = (w) => `Week of ${w.range}${w.partial ? ' (in progress)' : ''}`;
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
                ? <FunnelNode label="Paying companies (PLG)" value={fmtInt(PAYING.asOf(M.END).companies)} sub={`${fmtInt(PAYING.asOf(M.END).users)} paying users · ${fmtPct(PAYING.asOf(M.END).conv, 1)} sign up → paid`} dim={view !== s.id} />
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
        <Stat label={`Actual · ${M.short}`} value={fmtInt(WINDOW.visitors)} />
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
        <Stat label={`Conversion · ${M.short}`} value={fmtPct(WINDOW.conv, 2)} />
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
        <Stat label={`Actual · since ${monDay(WEEKS[0].start)}`} value={fmtInt(total)} />
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
        <Stat label={`Conversion · ${M.short}`} value="—" muted />
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
  const { CH30, CHANNEL_WEEKLY } = M;
  const order = [...CHANNELS].sort((a, b) => CH30.sessions[b.key] - CH30.sessions[a.key]);
  return (
    <div className="full">
      <Card
        accent={C.blue}
        title="Website visitors by channel"
        question="Where are visitors coming from?"
        footnote="GA4 engaged sessions by channel, bucketed with the same rules as the live dashboard (LinkedIn split out from Social, AI referrals → AEO). Totals can differ slightly from the Website visitors card because GA4 samples the channel breakdown. Faintly striped bars = week in progress."
      >
        <StatRow delta={<Delta value={pctChange(CH30.total, CH30.totalPrev)} />}>
          <Stat label={`Actual · ${M.short}`} value={fmtInt(CH30.total)} />
        </StatRow>
        <div style={{ ...eyebrow, marginTop: 16 }}>By channel · share of visitors, {M.short}</div>
        <Legend
          style={{ margin: '8px 0 6px' }}
          items={order.map((c) => ({ label: c.key, color: c.color, value: fmtPct(pct(CH30.sessions[c.key], CH30.total), 0) }))}
        />
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={CHANNEL_WEEKLY} margin={chartMargin} barCategoryGap="22%">
            {hatchDefs(CHANNELS.map((c) => c.color))}
            {grid}
            <XAxis {...xAxis} />
            <YAxis {...yAxis} tickFormatter={fmtK} />
            <Tooltip cursor={cursor} content={({ active, payload }) => active && payload?.length ? (
              <TooltipBox
                title={weekTitle(payload[0].payload)}
                rows={[...CHANNELS].reverse().filter((c) => payload[0].payload[c.key]).map((c) => ({
                  label: c.key, color: c.color,
                  value: `${fmtInt(payload[0].payload[c.key])} · ${fmtPct(pct(payload[0].payload[c.key], payload[0].payload.total), 0)}`,
                }))}
                note={`${fmtInt(payload[0].payload.total)} engaged sessions`}
              />
            ) : null} />
            {CHANNELS.map((c) => (
              <Bar key={c.key} dataKey={c.key} stackId="ch" stroke={C.black} strokeWidth={0.5} isAnimationActive={false}>
                {CHANNEL_WEEKLY.map((w) => <Cell key={w.start} fill={w.partial ? `url(#${hatchId(c.color)})` : c.color} />)}
              </Bar>
            ))}
          </BarChart>
        </ResponsiveContainer>
      </Card>
    </div>
  );
}

function SignupsByChannelCard() {
  const M = useModel();
  const { END, SELF_REPORTED, START, WINDOW } = M;
  const SR = SELF_REPORTED;
  const total = WINDOW.signups;
  const rows = SELF_REPORTED_BUCKETS
    .map((b) => ({ key: b.name, color: b.color, n: SR.counts[b.name] }))
    .filter((r) => r.n > 0)
    .sort((a, b) => b.n - a.n);
  rows.push({ key: 'No answer', color: C.lightGrey, n: SR.noAnswer, parent: true });
  rows.push({ key: 'No company name', sub: 'never finished onboarding', color: '#BDBDBD', n: SR.noName, child: true });
  rows.push({ key: 'Accepted an invite', sub: SR.invited == null ? 'available after the next data pull' : null, color: '#D5D5D5', n: SR.invited, child: true });
  rows.push({ key: 'Other', sub: 'joined an existing company, skipped setup, etc.', color: C.lightGrey, n: SR.other, child: true });
  const maxN = Math.max(...rows.map((r) => r.n || 0), 1);
  const th = { ...eyebrow, fontSize: 10, padding: '10px 14px', textAlign: 'right', whiteSpace: 'nowrap', borderBottom: `1px solid ${C.black}`, background: C.paper };
  const td = { ...tabular, fontFamily: FONT_BODY, fontSize: 13.5, padding: '11px 14px', textAlign: 'right', borderBottom: `1px solid ${C.lightGrey}`, whiteSpace: 'nowrap' };
  const soon = <span style={{ color: '#B5B5B5' }}>—</span>;
  return (
    <div className="full">
      <Card
        accent={C.purple}
        title="Sign ups and conversion by channel"
        question={`Self-reported “How did you hear about us?” · ${M.long} · ${rangeLabel(START, END)}`}
        footnote={`Channel = the signup's self-reported answer (Amplitude referral_source), bucketed with the same rules as the live dashboard's “User signups by Channel”. Only company setup asks the question, so ${fmtInt(SR.noAnswer)} of ${fmtInt(total)} signups have no answer. No answer is split into: No company name (Metabase — signup has no workspace, or one that was never named, i.e. never finished onboarding), Accepted an invite (Amplitude “User Invitation Completed”, daily unique users), and Other (what's left). Answers only exist as daily totals, not per person, so the split is approximate — someone can be in both of the first two groups, or in one and still have answered. Overall = all Metabase signups in the window, matching the rest of this page. Sign up → activated needs the answer on each signup in the Metabase export; Activated → paid comes from stripe-dash.`}
      >
        <div style={{ overflowX: 'auto', margin: '16px -22px 0' }}>
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
                <tr key={r.key} style={r.child ? { background: C.paper } : undefined}>
                  <td style={{ ...td, textAlign: 'left', paddingLeft: r.child ? 44 : 22, fontWeight: r.child ? 500 : 600, fontSize: r.child ? 13 : td.fontSize }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                      {r.child
                        ? <span style={{ color: C.muted }}>↳</span>
                        : <span style={{ width: 10, height: 10, borderRadius: 2, background: r.color, border: `1px solid ${C.black}` }} />}
                      {r.key}
                      {r.sub && <span style={{ fontWeight: 400, fontSize: 12, color: C.muted }}>{r.sub}</span>}
                    </span>
                  </td>
                  <td style={{ ...td, textAlign: 'left' }}>
                    {r.n == null ? soon : (
                      <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ height: r.child ? 9 : 12, width: `${Math.max((r.n / maxN) * 75, 1)}%`, background: r.color, border: `1px solid ${C.black}`, borderRadius: 2 }} />
                        <span>{fmtInt(r.n)}</span>
                      </span>
                    )}
                  </td>
                  <td style={td}>{r.n == null ? soon : fmtPct(pct(r.n, total), 1)}</td>
                  <td style={td}>{soon}</td>
                  <td style={{ ...td, paddingRight: 22 }}>{soon}</td>
                </tr>
              ))}
              <tr style={{ background: C.paper }}>
                <td style={{ ...td, textAlign: 'left', paddingLeft: 22, fontWeight: 700, borderBottom: 'none' }}>Overall</td>
                <td style={{ ...td, textAlign: 'left', fontWeight: 700, borderBottom: 'none' }}>{fmtInt(total)}</td>
                <td style={{ ...td, fontWeight: 700, borderBottom: 'none' }}>100%</td>
                <td style={{ ...td, fontWeight: 700, borderBottom: 'none' }}>{fmtPct(WINDOW.actConv, 1)}</td>
                <td style={{ ...td, paddingRight: 22, borderBottom: 'none' }}>{soon}</td>
              </tr>
            </tbody>
          </table>
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
        footnote={`Running total of every signup (incl. repeats by the same person) since ${monDay(SIGNUP_COUNT_START)}, ${SIGNUP_COUNT_START.slice(0, 4)}, the same start as the live dashboard, shown for the last ${WEEKS.length} weeks. Last point includes the week in progress. No goal set yet — the dashed goal line will be added once we have one.`}
      >
        <StatRow>
          <Stat label={`Actual · since ${monDay(SIGNUP_COUNT_START)}`} value={fmtInt(total)} />
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
      footnote="Visitor → signup = signups ÷ GA4 engaged sessions for the same days. Every signup counts, including repeat signups by the same person and internal/test accounts. Faintly striped bar = week in progress."
    >
      <StatRow delta={<Delta value={ptsDiff(WINDOW.conv, WINDOW.convPrev)} suffix=" pts" />}>
        <Stat label="Visitor → signup" value={fmtPct(WINDOW.conv, 2)} />
        <Stat label={`Signups · ${M.short}`} value={fmtInt(WINDOW.signups)} sub={<Delta value={pctChange(WINDOW.signups, WINDOW.signupsPrev)} size={12} />} />
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
        <Stat label={`Signups · ${M.short}`} value={fmtInt(total)} />
      </StatRow>
      <div style={{ ...eyebrow, marginTop: 16 }}>By role · share of signups, {M.short}</div>
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
        <Stat label="Signup → completed setup" value={fmtPct(allRate, 1)} sub={`${s.all} of ${s.n} signups · ${M.short}`} />
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
        <Stat label={rateLabel} value={fmtPct(curr.rate, 1)} sub={`${curr.conv} of ${curr.n} ${cohortNoun} · ${M.short}`} />
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
  // Headline = the most recent mature signup days, same length as the
  // selected reporting period (30d / 4w), vs the same length before.
  const span = daysBetweenISO(M.START, M.END) + 1;
  const { curr, prev } = series.recent(span);
  const openUsers = useUsersModal();
  const dayTitle = (x) => `Signed up ${monDay(x.d)}, ${x.d.slice(0, 4)}`;
  // No delta when the prior window starts before the milestone was trackable.
  const delta = prev.fullyTracked ? ptsDiff(curr.rate, prev.rate) : null;
  return (
    <Card
      accent={accent}
      title={title}
      question={question}
      footnote={`For each signup day, the share of that day's signups that ${milestone} on the signup day or within the next ${CONV_WINDOW_DAYS} days. Dots = each day; line = rolling 7 signup days (pooled). Signups from the last ${CONV_WINDOW_DAYS} days are still inside their window, so they're faded. The headline uses the latest ${span} signup days that have had their full window (${monDay(curr.from)} – ${monDay(curr.to)}) vs the ${span} days before.${extraNote} Signups count from ${monDay(SIGNUP_COUNT_START)}. Click a day to list who ${verb}. No goal set yet.`}
    >
      <StatRow delta={<Delta value={delta} suffix=" pts" />}>
        <Stat label={`${CONV_WINDOW_DAYS}-day conversion · ${span} signup days`} value={fmtPct(curr.rate, 1)} sub={`${fmtInt(curr.a)} of ${fmtInt(curr.n)} signups`} />
        <Stat label="Goal" value="—" muted />
      </StatRow>
      <ListUsersButton n={curr.a} label={`${verb} within ${CONV_WINDOW_DAYS} days`} onClick={() => openUsers({ ...modal, title: `${title} within ${CONV_WINDOW_DAYS} days`, subtitle: `signed up ${rangeLabel(curr.from, curr.to)} · ${fmtInt(curr.a)} of ${fmtInt(curr.n)} signups`, users: curr.list })} />
      <Legend items={[
        { label: '7-day rolling %', color: C.black, line: true, weight: 3 },
        { label: 'Daily %', color: 'rgba(154,154,154,0.3)' },
        { label: 'Goal % (not set)', color: '#9A9A9A', line: true, dashed: true },
      ]} />
      <ResponsiveContainer width="100%" height={210}>
        <LineChart data={series.daily} margin={chartMargin} style={{ cursor: 'pointer' }} onClick={onWeekClick(openUsers, (x) => ({ ...modal, title: dayTitle(x), subtitle: `${fmtInt(x.a)} of ${fmtInt(x.n)} signups ${verb} within ${CONV_WINDOW_DAYS} days${x.mature ? '' : ' (window still open)'}`, users: x.list }))}>
          {grid}
          <XAxis {...xAxis} dataKey="d" ticks={series.ticks} tickFormatter={monDay} interval={0} />
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
      question="Are we on pace?"
      footnote={`Running total of activated users since ${monDay(FIRST_ACT_TRACKED || END)}, ${(FIRST_ACT_TRACKED || END).slice(0, 4)} (when asset data starts; email sends start Sep 4). Activated = sent (or drafted) an email or published an asset, counted once, in the week they first did either, whatever their signup date. Asset publishes carry no company, so each is credited to the user's latest signup at the time; publishes with no user are left out. Click a week to list who activated that week. No goal set yet.`}
    >
      <StatRow>
        <Stat label="Actual · to date" value={fmtInt(A.now.cum)} sub={<>+{fmtInt(A.curr)} in the {M.long} <Delta value={pctChange(A.curr, A.prev)} size={12} /></>} />
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
          <Stat label={`Activated · ${M.short}`} value={fmtInt(A.curr)} />
        </StatRow>
        <ListUsersButton n={A.curr} label={`activated in the ${M.long}`} onClick={() => openUsers({ title: 'Activated users', subtitle: `activated ${rangeLabel(START, END)}`, users: A.currList })} />
        <div style={{ ...eyebrow, marginTop: 16 }}>By type of first send · {M.short}</div>
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
      question="Are we on pace?"
      footnote={`Running total of users who completed onboarding (recorder installed + Gmail + Google Calendar connected) since ${monDay(FIRST_ONB_TRACKED || END)}, ${(FIRST_ONB_TRACKED || END).slice(0, 4)}, counted once, in the week they finished the last of the three, whatever their signup date. Click a week to list who completed that week. No goal set yet.`}
    >
      <StatRow>
        <Stat label="Actual · to date" value={fmtInt(O.now.cum)} sub={<>+{fmtInt(O.curr)} in the {M.long} <Delta value={FIRST_ONB_TRACKED && M.PRIOR_START >= FIRST_ONB_TRACKED ? pctChange(O.curr, O.prev) : null} size={12} /></>} />
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
  const span = daysBetweenISO(M.START, M.END) + 1;
  return (
    <Card
      accent={C.blue}
      title="Activated → returned"
      question="Do activated users come back the following week?"
      footnote={`${RET_DEF} Weekly points group users by the week they activated. The headline uses the latest ${span} activation days whose ${RETURN_DAYS}-day window has closed (${rangeLabel(R.curr.from, R.curr.to)}) vs the ${span} days before. Dotted = weeks whose windows are still open. ${RET_SOURCES} Click a week to list who returned. No goal set yet.`}
    >
      <StatRow delta={<Delta value={ptsDiff(R.curr.rate, R.prev.rate)} suffix=" pts" />}>
        <Stat label={`Conversion · ${span} activation days`} value={fmtPct(R.curr.rate, 1)} sub={`${fmtInt(R.curr.k)} of ${fmtInt(R.curr.n)} activated`} />
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
  const w = R.lastWeek;
  return (
    <Card
      accent={C.blue}
      title="Weekly returned users"
      question="How many activated users come back each week?"
      footnote={`${RET_DEF} Weekly count, not cumulative, by the week they activated. The headline is the latest week whose ${RETURN_DAYS}-day windows have all closed${w ? ` (${w.range})` : ''}, vs the week before. Dotted = weeks whose windows are still open. ${RET_SOURCES} Click a week to list who returned. No goal set yet.`}
    >
      <StatRow delta={<Delta value={w && R.prevWeek ? pctChange(w.k, R.prevWeek.k) : null} />} deltaLabel="vs prior week">
        <Stat label={w ? `Actual · week of ${monDay(w.start)}` : 'Actual'} value={fmtInt(w?.k)} sub={w ? `of ${fmtInt(w.n)} activated that week` : null} />
        <Stat label="Goal" value="—" muted />
        <Stat label="Vs goal" value="—" muted />
      </StatRow>
      {w && <ListUsersButton n={w.k} label={`returned (week of ${monDay(w.start)})`} onClick={() => openUsers({ ...RET_MODAL, title: 'Returned users', subtitle: `activated week of ${w.range} · ${fmtInt(w.k)} of ${fmtInt(w.n)} returned`, users: w.retList })} />}
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
          <span style={{ fontFamily: FONT_BODY, fontSize: 12, color: C.muted, marginLeft: 8 }}>{MEETING_ANY_30D} of {WINDOW.signups} signups · {M.short}, setup or not</span>
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

function ComingSoonCard({ title, question, body }) {
  return (
    <div className="full">
      <Card title={title} question={question} accent={C.lightGrey}>
        <div style={{ marginTop: 16, border: `1px dashed ${C.black}`, borderRadius: 4, background: C.paper, padding: '28px 20px', textAlign: 'center' }}>
          <div style={{ fontFamily: FONT_DISPLAY, fontSize: 24, letterSpacing: '-0.02em' }}>Coming from stripe-dash</div>
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
  const inCohort = (co, day) => { const f = co && firstDayByCo.get(co); return Boolean(f && f >= SIGNUP_COUNT_START && f <= day); };
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
    const r = {
      day, companies: list.length, arr: mrr * 12, users, noCo,
      perCo: list.length - noCo ? users / (list.length - noCo) : null,
      cohort, cohortPaying, conv: pct(cohortPaying, cohort),
    };
    cache.set(day, r);
    return r;
  };
  return { asOf, last, pulledAt: betaPaying.pulledAt, custs, mrrAtTs };
})();
const payingWeekly = (M) => M.WEEKS.map((w) => ({ ...w, ...PAYING.asOf(w.partial ? M.END : w.end) }));
const stripeAsOf = () => (PAYING.pulledAt ? monDay(PAYING.pulledAt.slice(0, 10)) : '—');

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
  return (
    <Card
      accent={C.green}
      title="Sign up → paid"
      question="What share of companies that sign up end up paying?"
      footnote={`Paying companies ÷ individual companies that have signed up, as of the end of each week. Signed up = a distinct company id whose first signup is on or after ${monDay(SIGNUP_COUNT_START)}, ${SIGNUP_COUNT_START.slice(0, 4)} (same start as the signup counts); only those companies count as paying here, so older customers are left out. Paying = PLG Stripe customer with MRR above $0 (revenue dashboard definition). Stripe data as of ${stripeAsOf()}. No goal set yet.`}
    >
      <StatRow>
        <Stat label="Conversion" value={fmtPct(now.conv, 1)} sub={<span style={{ fontSize: 12, color: C.muted }}>{fmtInt(now.cohortPaying)} of {fmtInt(now.cohort)} companies</span>} />
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
              { label: 'Paying (signed up since Feb 16)', value: fmtInt(payload[0].payload.cohortPaying) },
              { label: 'Companies signed up', value: fmtInt(payload[0].payload.cohort) },
              { label: 'All paying PLG companies', value: fmtInt(payload[0].payload.companies) },
            ]} />
          ) : null} />
          <Line dataKey="conv" stroke={C.black} strokeWidth={2.5} dot={false} activeDot={{ r: 4, fill: C.green, stroke: C.black }} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </Card>
  );
}

function PayingCompaniesCard() {
  const M = useModel();
  const weeks = payingWeekly(M);
  const now = PAYING.asOf(M.END);
  const prev = PAYING.asOf(M.PRIOR_END);
  return (
    <Card
      accent={C.green}
      title="Paying companies (PLG)"
      question="How many self-serve companies are paying?"
      footnote={`Same definition as the revenue dashboard's Paying logos: one Stripe customer = one company, paying when its MRR (rebuilt from invoices) is above $0 at the end of each week. Enterprise customers are excluded; accounts that graduated to enterprise count only until their graduation date. Scheduled-to-cancel and past-due still count. Last point includes the week in progress. Stripe data as of ${stripeAsOf()}.`}
    >
      <StatRow delta={<Delta value={pctChange(now.companies, prev.companies)} />}>
        <Stat label={`Paying · ${monDay(now.day)}`} value={fmtInt(now.companies)} />
        <Stat label="PLG ARR" value={`$${fmtInt(Math.round(now.arr))}`} />
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
  return (
    <Card
      title="Total paying users (cumulative)"
      question="How many people sit inside paying companies?"
      footnote={`Users that are part of a paying PLG company at the end of each week: every signup (user + company, not deduped) on that company, made by then. Joined on the Mutiny company id (Stripe customer metadata.company_id = Metabase company_id). Uses today's company membership, so people removed from a company drop out of past weeks too. Drops when a company stops paying.${now.noCo ? ` ${now.noCo} paying Stripe customer${now.noCo === 1 ? ' has' : 's have'} no company id in Stripe, so their users can't be counted.` : ''} Stripe data as of ${stripeAsOf()}. No goal set yet — the dashed goal line will be added once we have one.`}
    >
      <StatRow>
        <Stat label={`Actual · ${monDay(now.day)}`} value={fmtInt(now.users)} sub={<span style={{ fontSize: 12, color: C.muted }}>{now.perCo == null ? '' : `${now.perCo.toFixed(1)} per paying company`}</span>} />
        <Stat label="Goal" value="—" muted />
        <Stat label="Vs goal" value="—" muted />
      </StatRow>
      <Legend items={[{ label: 'Cumulative actual', color: C.black, line: true }, { label: 'Cumulative goal (not set)', color: '#9A9A9A', line: true, dashed: true }]} />
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
        question="Of the companies that started paying in a month, how many are still paying in the months after?"
        footnote={`Cohort = the month a self-serve (PLG) company first started paying in Stripe. Month 1 = still paying at the end of the next month, Month 2 = the month after that, and so on (paying = MRR above $0 at month end, revenue dashboard definition). Month 0 = still paying at the end of the month they started. Companies that graduated to enterprise count as retained while they keep paying. Faded italic cells are the current month, measured as of ${monDay(PAYING.last)}. Cohorts start when Stripe went live (${monDay(betaPaying.historyStart || '2026-03-26')}).`}
      >
        <StatRow>
          <Stat label="Month-1 retention" value={fmtPct(R.m1Rate, 1)} sub={<span style={{ fontSize: 12, color: C.muted }}>{fmtInt(R.m1Kept)} of {fmtInt(R.m1Base)} companies, all complete cohorts</span>} />
          <Stat label="Cohorts" value={fmtInt(R.cohorts.length)} />
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
        <StageHeader title="Returned" subtitle={`Activated users who come back within ${RETURN_DAYS} days of activating and do something meaningful.`} />
        <Grid>
          <ActivatedToReturnedCard />
          <WeeklyReturnedUsersCard />
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
        </Grid>
      </>
    );
  }
  if (view === 'paid') {
    return (
      <>
        <StageHeader n={4} title="Paid companies" subtitle="Self-serve (PLG) companies paying in Stripe, and the users inside them." />
        <Grid>
          {PAYING ? (
            <>
              <SignupToPaidCard />
              <PayingCompaniesCard />
              <div className="full"><TotalPayingUsersCard /></div>
            </>
          ) : <PaidEmptyCard />}
        </Grid>
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
export default function BetaDashboard() {
  const [view, setViewState] = useState(readHashView);
  // Reporting window toggle (remembered per browser; falls back to 30d).
  const [mode, setModeState] = useState(() => {
    try { const m = window.localStorage.getItem('beta-mode'); return MODES[m] ? m : '30d'; } catch (e) { return '30d'; }
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
                {Object.entries(MODES).map(([id, m]) => {
                  const active = mode === id;
                  return (
                    <button
                      key={id}
                      type="button"
                      aria-pressed={active}
                      onClick={() => setMode(id)}
                      style={{ padding: '5px 14px', border: 'none', background: active ? C.black : 'transparent', color: active ? C.white : C.black, cursor: active ? 'default' : 'pointer', fontFamily: FONT_BODY, fontSize: 12, fontWeight: 600 }}
                    >
                      {m.label}
                    </button>
                  );
                })}
              </div>
              <div style={{ fontWeight: 700, marginTop: 6 }}>{rangeLabel(START, END)}, {END.slice(0, 4)}</div>
            </div>
          </div>
        </div>
      </header>

      <main style={{ maxWidth: 1400, margin: '0 auto', padding: '28px 24px 64px' }}>
        <div style={{ marginBottom: 24, border: `1px solid ${C.black}`, borderRadius: 4, background: C.lightGreen, padding: '10px 16px', fontSize: 13, lineHeight: 1.5 }}>
          <strong>Beta:</strong> sections are being rebuilt one at a time. Weekly charts cover {rangeLabel(WEEKS[0].start, END)} (Mon–Sun weeks). {PAYING ? 'Paid and retained companies come from Stripe; expanding is still to come.' : 'The Companies line (paid, retained, expanding) will be connected from stripe-dash.'}
        </div>

        <PlgFunnel view={view} setView={setView} />
        <ViewingBar view={view} />
        <SectionsFor view={view} />

        <div style={{ fontFamily: FONT_CAPTION, fontStyle: 'italic', fontSize: 12, color: C.muted, marginTop: 28 }}>
          Signups export: {betaSignups.source} · {SIGNUPS.length.toLocaleString()} signup rows · {monDay(DATA_START)} {DATA_START.slice(0, 4)} – {monDay(betaSignups.lastDate)} {betaSignups.lastDate.slice(0, 4)} ({COUNTED_SIGNUPS.toLocaleString()} counted as signups from {monDay(SIGNUP_COUNT_START)}, {SIGNUP_COUNT_START.slice(0, 4)}).
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
