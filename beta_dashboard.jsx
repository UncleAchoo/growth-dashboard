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

// --- Source data --------------------------------------------------------------
const SIGNUPS = betaSignups.signups;
const ENGAGED_BY_DATE = Object.fromEntries(
  dataJson.ga4.file1.map((r) => [`${r.date.slice(0, 4)}-${r.date.slice(4, 6)}-${r.date.slice(6)}`, r.engagedSessions]),
);

// Reporting window: last 30 days ending on the signup export's last day.
const END = betaSignups.lastDate;
const START = addDays(END, -29);
const PRIOR_END = addDays(START, -1);
const PRIOR_START = addDays(START, -30);
const DATA_START = betaSignups.firstDate;
const inRange = (d, a, b) => d >= a && d <= b;

// Weekly buckets (Mon–Sun) from the first export week through the week holding END.
const WEEKS = (() => {
  const out = [];
  for (let w = mondayOf(DATA_START); w <= END; w = addDays(w, 7)) {
    const sun = addDays(w, 6);
    out.push({ start: w, end: sun, label: monDay(w), partial: sun > END, range: rangeLabel(w, sun > END ? END : sun) });
  }
  return out;
})();

const sumEngaged = (a, b) => {
  let s = 0;
  for (let d = a; d <= b; d = addDays(d, 1)) s += ENGAGED_BY_DATE[d] || 0;
  return s;
};
const signupsIn = (a, b) => SIGNUPS.filter((s) => inRange(s.d, a, b));
const pctChange = (curr, prev) => (prev ? ((curr - prev) / prev) * 100 : null);
const pct = (n, d) => (d ? (n / d) * 100 : null);
const ptsDiff = (a, b) => (a != null && b != null ? a - b : null);

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

// --- Derived series -----------------------------------------------------------
const WINDOW = (() => {
  const curr = signupsIn(START, END);
  const prev = signupsIn(PRIOR_START, PRIOR_END);
  const visitors = sumEngaged(START, END);
  const visitorsPrev = sumEngaged(PRIOR_START, PRIOR_END);
  const roleCounts = Object.fromEntries(ROLES.map((r) => [r.key, 0]));
  curr.forEach((s) => { roleCounts[roleKey(s)] += 1; });
  // Funnel "Activated" = A2 for now: signups in the window that have sent
  // their first email/asset (any time so far). Switch to A3 once the export
  // carries a send count.
  const activated = curr.filter((s) => s.snd).length;
  const activatedPrev = prev.filter((s) => s.snd).length;
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
  return WEEKS.map((w) => {
    const end = w.partial ? END : w.end;
    const list = signupsIn(w.start, end);
    const visitors = sumEngaged(w.start, end);
    cumVisitors += visitors;
    const row = { ...w, signups: list.length, visitors, cumVisitors, conv: pct(list.length, visitors) };
    ROLES.forEach((r) => { row[r.key] = 0; });
    list.forEach((s) => { row[roleKey(s)] += 1; });
    ROLES.forEach((r) => { row[`${r.key}_pct`] = list.length ? (row[r.key] / list.length) * 100 : 0; });
    const st = setupStats(list);
    row.setupAll = pct(st.all, st.n);
    row.setupAllN = st.all;
    STEPS.forEach((x) => { row[`setup_${x.key}`] = pct(st[x.key], st.n); row[`setup_${x.key}N`] = st[x.key]; });
    return row;
  });
})();

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
const ACT = Object.fromEntries(ACTIVATION.map((step) => [step.key, {
  curr: activationStats(step, START, END),
  prev: activationStats(step, PRIOR_START, PRIOR_END),
  weekly: WEEKS.map((w) => ({ ...w, ...activationStats(step, w.start, w.partial ? END : w.end) })),
}]));
const MEETING_ANY_30D = signupsIn(START, END).filter((s) => s.mt).length;

// ===========================================================================
// UI primitives
// ===========================================================================
const fmtInt = (n) => (n == null ? '—' : Math.round(n).toLocaleString());
const fmtPct = (n, p = 1) => (n == null ? '—' : `${n.toFixed(p)}%`);
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

function StatRow({ children, delta, deltaLabel = 'vs prior 30d' }) {
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

function StageHeader({ n, title, subtitle }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: '4px 16px', borderBottom: `1px solid ${C.black}`, paddingBottom: 10, margin: '32px 0 20px' }}>
      <h2 style={{ fontFamily: FONT_DISPLAY, fontWeight: 400, fontSize: 28, lineHeight: 1.15, letterSpacing: '-0.03em', margin: 0 }}>
        {n != null && <span style={{ color: C.purple }}>Stage {n}: </span>}{title}
      </h2>
      {subtitle && <p style={{ fontFamily: FONT_BODY, fontSize: 13.5, color: C.muted, margin: 0 }}>{subtitle}</p>}
    </div>
  );
}

// Two columns like the blueprint; one column on narrow screens.
const PAGE_CSS = `.beta-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:20px;align-items:stretch}
.beta-grid > .full{grid-column:1 / -1}
.beta-funnel-line{display:grid;align-items:stretch}
.beta-step{all:unset;box-sizing:border-box;cursor:pointer;display:flex;flex-direction:column;min-width:0}
.beta-step:focus-visible{outline:2px solid ${C.purple};outline-offset:3px}
.beta-step:hover .beta-step-bar{background:#BDBDBD}
.beta-step[aria-pressed="true"]:hover .beta-step-bar{background:${C.purple}}
@media (max-width: 900px){.beta-grid{grid-template-columns:minmax(0,1fr)}}
@media (max-width: 760px){.beta-funnel-line{grid-template-columns:minmax(0,1fr)!important;gap:14px!important}.beta-funnel-arrow{display:none!important}}`;
const Grid = ({ children }) => <div className="beta-grid">{children}</div>;

// Hatch pattern for the in-progress week.
const hatchId = (color) => `hatch-${color.replace('#', '')}`;
function HatchDefs({ colors }) {
  return (
    <defs>
      {colors.map((c) => (
        <pattern key={c} id={hatchId(c)} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="6" height="6" fill={c} opacity="0.35" />
          <line x1="0" y1="0" x2="0" y2="6" stroke={c} strokeWidth="3" />
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
  const W = WINDOW;
  return (
    <section style={{ background: C.white, border: `1px solid ${C.black}`, borderRadius: 4, padding: '20px 24px 22px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 18 }}>
        <div style={{ fontFamily: FONT_BODY, fontSize: 14, fontWeight: 700 }}>
          PLG funnel at a glance
          <span style={{ fontWeight: 400, color: C.muted, marginLeft: 10 }}>Last 30 days · {rangeLabel(START, END)}</span>
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
        <FunnelNode label="Activated" value={fmtInt(W.activated)} sub="A2: first send (A3 coming)" />
      </div>

      {/* Line 2 — companies (stripe-dash) */}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, margin: '26px 0 10px', paddingTop: 18, borderTop: `1px dashed #CFCFCF` }}>
        <span style={eyebrow}>Companies</span>
        <span style={{ fontFamily: FONT_CAPTION, fontStyle: 'italic', fontSize: 12, color: C.muted }}>From stripe-dash — coming soon</span>
      </div>
      <div className="beta-funnel-line" style={{ gridTemplateColumns: 'repeat(3, minmax(0,1fr))', gap: 20 }}>
        {[
          { id: 'paid', label: 'Paid companies' },
          { id: 'retained', label: 'Retained companies' },
          { id: 'expanding', label: 'Expanding companies' },
        ].map((s) => (
          <FunnelStep key={s.id} id={s.id} view={view} setView={setView} label={VIEWS[s.id].short}>
            <div style={{ alignSelf: 'stretch' }}>
              <FunnelNode label={s.label} value="—" sub="Not connected yet" dim={view !== s.id} />
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
function WebsiteVisitorsCard() {
  return (
    <Card
      accent={C.blue}
      title="Website visitors"
      question="How many people are we getting to the site?"
      footnote="GA4 engaged sessions (>10s, a conversion, or 2+ pageviews), same metric as the current dashboard. Used instead of total users because AI crawlers inflate that number. Hatched bar = week in progress."
    >
      <StatRow delta={<Delta value={pctChange(WINDOW.visitors, WINDOW.visitorsPrev)} />}>
        <Stat label="Engaged sessions · 30d" value={fmtInt(WINDOW.visitors)} />
      </StatRow>
      <Legend items={[{ label: 'Engaged sessions (weekly)', color: C.blue }]} />
      <ResponsiveContainer width="100%" height={190}>
        <BarChart data={WEEKLY} margin={chartMargin}>
          <HatchDefs colors={[C.blue]} />
          {grid}
          <XAxis {...xAxis} />
          <YAxis {...yAxis} tickFormatter={fmtK} />
          <Tooltip cursor={cursor} content={({ active, payload }) => active && payload?.length ? (
            <TooltipBox title={weekTitle(payload[0].payload)} rows={[{ label: 'Engaged sessions', value: fmtInt(payload[0].payload.visitors), color: C.blue }]} />
          ) : null} />
          <Bar dataKey="visitors" stroke={C.black} strokeWidth={1} isAnimationActive={false}>
            {WEEKLY.map((w) => <Cell key={w.start} fill={w.partial ? `url(#${hatchId(C.blue)})` : C.blue} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </Card>
  );
}

function CumulativeVisitorsCard() {
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

function NewSignupsCard() {
  return (
    <Card
      title="New signups"
      question="Are we converting intent into accounts?"
      footnote="Visitor → signup = signups ÷ GA4 engaged sessions for the same days. Every signup counts, including repeat signups by the same person and internal/test accounts. Hatched bar = week in progress."
    >
      <StatRow delta={<Delta value={ptsDiff(WINDOW.conv, WINDOW.convPrev)} suffix=" pts" />}>
        <Stat label="Visitor → signup" value={fmtPct(WINDOW.conv, 2)} />
        <Stat label="Signups · 30d" value={fmtInt(WINDOW.signups)} sub={<Delta value={pctChange(WINDOW.signups, WINDOW.signupsPrev)} size={12} />} />
      </StatRow>
      <Legend items={[{ label: 'Signups (bars)', color: C.purple }, { label: 'Visitor → signup % (line)', color: C.black, line: true }]} />
      <ResponsiveContainer width="100%" height={190}>
        <ComposedChart data={WEEKLY} margin={chartMargin}>
          <HatchDefs colors={[C.purple]} />
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
  const total = WINDOW.signups;
  return (
    <Card
      title="Who signs up (role mix)"
      question="Are the right people signing up — sales leaders, or mostly reps?"
      footnote="Role is the self-selected answer at signup (self_selected_role), shown as-is. Bars show each role's share of that week's signups; hover for counts."
    >
      <StatRow>
        <Stat label="Signups · 30d" value={fmtInt(total)} />
      </StatRow>
      <div style={{ ...eyebrow, marginTop: 16 }}>By role · share of signups, 30d</div>
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
  const s = WINDOW.setup;
  const p = WINDOW.setupPrev;
  const allRate = pct(s.all, s.n);
  return (
    <Card
      title="Completed setup (recorder + calendar + email)"
      question="Do new accounts finish all three setup steps?"
      notice="Coming soon: Product will help define the order of setup steps. We'll then add a view showing where people drop off between downloading the call recorder, connecting email and connecting calendar."
      footnote="Grouped by signup week: of signups that week, the share who have done each step so far. Completed setup requires all three: recorder installed, calendar connected and email connected. Recent weeks have had less time to finish, so they read low."
    >
      <StatRow delta={<Delta value={ptsDiff(allRate, pct(p.all, p.n))} suffix=" pts" />}>
        <Stat label="Signup → completed setup" value={fmtPct(allRate, 1)} sub={`${s.all} of ${s.n} signups · 30d`} />
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
  const { curr, prev, weekly } = ACT[stepKey];
  const Cohort = cohortNoun[0].toUpperCase() + cohortNoun.slice(1);
  return (
    <Card title={title} question={question} footnote={footnote} accent={accent}>
      <StatRow delta={<Delta value={ptsDiff(curr.rate, prev.rate)} suffix=" pts" />}>
        <Stat label={rateLabel} value={fmtPct(curr.rate, 1)} sub={`${curr.conv} of ${curr.n} ${cohortNoun} · 30d`} />
      </StatRow>
      {extra}
      <Legend items={[{ label: 'Conversion % (line)', color: C.black, line: true }, { label: `${Cohort} (cohort size, bars)`, color: C.lightPurple }]} />
      <ResponsiveContainer width="100%" height={190}>
        <ComposedChart data={weekly} margin={chartMargin}>
          <HatchDefs colors={[C.purple]} />
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

function FirstMeetingCard() {
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
          <span style={{ fontFamily: FONT_BODY, fontSize: 12, color: C.muted, marginLeft: 8 }}>{MEETING_ANY_30D} of {WINDOW.signups} signups · 30d, setup or not</span>
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
      convNoun="Sent first email/asset"
      footnote="Share of signups with a first recorded meeting that have sent their first email or asset (first_email_or_asset_sent_at). Grouped by the week of the first meeting. The export doesn't yet separate customer sends from internal ones, so all sends count for now."
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

// --- Sections per funnel view -------------------------------------------------
function SectionsFor({ view }) {
  if (view === 'signup') {
    return (
      <>
        <StageHeader n={1} title="Website visitors" subtitle="Top of the funnel: people who reach the site." />
        <Grid>
          <WebsiteVisitorsCard />
          <CumulativeVisitorsCard />
        </Grid>
        <StageHeader n={2} title="Sign up" subtitle="Visitors who create an account. The gate between anonymous and known." />
        <Grid>
          <NewSignupsCard />
          <RoleMixCard />
          <CompletedSetupCard />
        </Grid>
      </>
    );
  }
  if (view === 'activation') {
    return (
      <>
        <StageHeader n={3} title="Activation" subtitle="First real value. The aha moment: a meeting captured and a first send." />
        <Grid>
          <FirstMeetingCard />
          <FirstSendCard />
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
              <div style={{ fontWeight: 700 }}>Last 30 days · {rangeLabel(START, END)}</div>
            </div>
          </div>
        </div>
      </header>

      <main style={{ maxWidth: 1400, margin: '0 auto', padding: '28px 24px 64px' }}>
        <div style={{ marginBottom: 24, border: `1px solid ${C.black}`, borderRadius: 4, background: C.lightGreen, padding: '10px 16px', fontSize: 13, lineHeight: 1.5 }}>
          <strong>Beta:</strong> sections are being rebuilt one at a time. Weekly charts cover {rangeLabel(WEEKS[0].start, END)} (Mon–Sun weeks). The Companies line (paid, retained, expanding) will be connected from stripe-dash.
        </div>

        <PlgFunnel view={view} setView={setView} />
        <ViewingBar view={view} />
        <SectionsFor view={view} />

        <div style={{ fontFamily: FONT_CAPTION, fontStyle: 'italic', fontSize: 12, color: C.muted, marginTop: 28 }}>
          Signups export: {betaSignups.source} · {SIGNUPS.length.toLocaleString()} signups · {rangeLabel(DATA_START, betaSignups.lastDate)}.
          GA4 pulled {dataJson.ga4.pulledAt?.slice(0, 10)}.
        </div>
      </main>
    </div>
  );
}
