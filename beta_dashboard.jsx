// ---------------------------------------------------------------------------
// Beta growth dashboard — rendered only when the URL has ?beta (see
// src/main.jsx). Rebuild of the dashboard following the Lovable blueprint
// (styling mirrors it: warm neutrals, Instrument Serif + DM Sans); sections
// are added here one at a time. The current dashboard is untouched.
//
// Data:
//   Website visitors  ← GA4 engaged sessions (src/data.json → ga4.file1), same
//                       metric as the current dashboard's "Website Visitors".
//   Signups           ← signups CSV export → src/beta-signups.json
//                       (npm run ingest-signups). One row = one signup.
// ---------------------------------------------------------------------------
import React from 'react';
import {
  ResponsiveContainer, ComposedChart, BarChart, LineChart, Bar, Line, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip,
} from 'recharts';
import { ArrowUpRight, ArrowDownRight } from 'lucide-react';
import dataJson from './src/data.json';
import betaSignups from './src/beta-signups.json';

// --- Design tokens (from the Lovable blueprint) -------------------------------
const T = {
  bg: '#FAF6EF',
  fg: '#261E16',
  card: '#FEFCF8',
  muted: '#74685C',
  border: '#E0D9CD',
  surface: '#F5F0E5',
  secondary: '#F0EADE',
  chart1: '#402F22', // dark brown — primary series
  chart2: '#EDA041', // amber
  chart3: '#3C8353', // green
  chart4: '#C53B38', // red
  chart5: '#928375', // taupe (also the "goal" colour)
  chart1Soft: '#958B82', // chart1 55% over card
  chart2Soft: '#F5C993', // chart2 55% over card
  positive: '#3C8353',
  negative: '#C53B38',
};
const SERIF = "'Instrument Serif', ui-serif, Georgia, serif";
const SANS = "'DM Sans', ui-sans-serif, system-ui, sans-serif";

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

// Reporting window: last 30 days ending on the signup export's last day
// (GA4 includes today's partial day; the export doesn't).
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

// --- Roles (CSV self_selected_role, as-is) ----------------------------------
const ROLES = [
  { key: 'ae', label: 'Account executive', color: T.chart2 },
  { key: 'bdr_sdr', label: 'SDR / BDR', color: T.chart1 },
  { key: 'founder', label: 'Founder', color: T.chart3 },
  { key: 'demand_gen', label: 'Demand gen', color: T.chart4 },
  { key: 'product_marketing', label: 'Product marketing', color: T.chart2Soft },
  { key: 'abm', label: 'ABM', color: T.chart1Soft },
  { key: 'other', label: 'Other', color: T.chart5 },
  { key: '__none', label: 'No answer', color: T.border },
];
const roleKey = (s) => (ROLES.some((r) => r.key === s.role) ? s.role : s.role ? 'other' : '__none');

// --- Setup steps ------------------------------------------------------------
const STEPS = [
  { key: 'rec', label: 'Recorder installed', color: T.chart2 },
  { key: 'cal', label: 'Calendar connected', color: T.chart3 },
  { key: 'em', label: 'Email connected', color: T.chart5 },
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
  return {
    signups: curr.length,
    signupsPrev: prev.length,
    visitors,
    visitorsPrev,
    conv: pct(curr.length, visitors),
    convPrev: pct(prev.length, visitorsPrev),
    roleCounts,
    setup: setupStats(curr),
    setupPrev: setupStats(prev),
  };
})();

const WEEKLY = WEEKS.map((w) => {
  const end = w.partial ? END : w.end;
  const list = signupsIn(w.start, end);
  const visitors = sumEngaged(w.start, end);
  const row = { ...w, signups: list.length, visitors, conv: pct(list.length, visitors) };
  ROLES.forEach((r) => { row[r.key] = 0; });
  list.forEach((s) => { row[roleKey(s)] += 1; });
  ROLES.forEach((r) => { row[`${r.key}_pct`] = list.length ? (row[r.key] / list.length) * 100 : 0; });
  const st = setupStats(list);
  row.setupAll = pct(st.all, st.n);
  row.setupAllN = st.all;
  STEPS.forEach((x) => { row[`setup_${x.key}`] = pct(st[x.key], st.n); row[`setup_${x.key}N`] = st[x.key]; });
  return row;
});

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
  {
    key: 'mt',
    enteredOn: setupDate,
    converted: (s) => Boolean(s.mt && daysBetween(setupDate(s), s.mt) <= 7),
  },
  {
    key: 'snd',
    enteredOn: (s) => s.mt,
    converted: (s) => Boolean(s.snd),
  },
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
const eyebrow = { fontFamily: SANS, fontSize: 12, lineHeight: '16px', letterSpacing: '0.025em', textTransform: 'uppercase', color: T.muted };

function Delta({ value, suffix = '%' }) {
  if (value == null || !isFinite(value)) return <span style={{ color: T.muted, fontSize: 14 }}>—</span>;
  const up = value >= 0;
  const Icon = up ? ArrowUpRight : ArrowDownRight;
  return (
    <span style={{ ...tabular, display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 14, fontWeight: 500, color: up ? T.positive : T.negative }}>
      <Icon size={16} strokeWidth={2} />
      {Math.abs(value).toFixed(1)}{suffix}
    </span>
  );
}

function Stat({ label, value, muted, sub }) {
  return (
    <div>
      <div style={eyebrow}>{label}</div>
      <div style={{ ...tabular, fontFamily: SANS, fontSize: 30, lineHeight: '36px', fontWeight: 600, color: muted ? T.muted : T.fg }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: T.muted, marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

// Stats on the left, a single comparison delta right-aligned (as in the blueprint).
function StatRow({ children, delta, deltaLabel = 'vs prior 30d' }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16, marginTop: 16 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px 40px', flex: 1 }}>{children}</div>
      {delta !== undefined && (
        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          <div style={eyebrow}>{deltaLabel}</div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 2 }}>{delta}</div>
        </div>
      )}
    </div>
  );
}

function Card({ title, question, notice, footnote, children }) {
  return (
    <article style={{
      display: 'flex', flexDirection: 'column', background: T.card, border: `1px solid ${T.border}`,
      borderRadius: 20, padding: 20, boxShadow: '0 1px 2px rgba(0,0,0,0.04)', minWidth: 0,
    }}>
      <h3 style={{ fontFamily: SANS, fontSize: 16, lineHeight: '24px', fontWeight: 600, margin: 0, color: T.fg }}>{title}</h3>
      {question && <p style={{ fontSize: 14, lineHeight: '20px', color: T.muted, margin: '2px 0 0' }}>{question}</p>}
      {notice && (
        <div style={{ marginTop: 12, borderRadius: 12, border: `1px solid ${T.border}`, background: T.surface, padding: '8px 12px', fontSize: 12, lineHeight: 1.6, color: T.fg }}>
          {notice}
        </div>
      )}
      <div style={{ flex: 1 }}>{children}</div>
      {footnote && (
        <div style={{ marginTop: 16, borderTop: `1px solid ${T.border}`, paddingTop: 12, fontSize: 12, lineHeight: '19.5px', color: T.muted }}>
          {footnote}
        </div>
      )}
    </article>
  );
}

function Legend({ items, style }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 14px', fontSize: 11, lineHeight: '14px', color: T.muted, margin: '16px 0 6px', ...style }}>
      {items.map((it) => (
        <span key={it.label} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          {it.line ? (
            <span style={{ width: 14, borderTop: `${it.weight || 2}px ${it.dashed ? 'dashed' : 'solid'} ${it.color}` }} />
          ) : (
            <span style={{ width: 8, height: 8, borderRadius: 3, background: it.color }} />
          )}
          {it.label}
          {it.value != null && <span style={{ ...tabular, color: T.fg, marginLeft: 2 }}>{it.value}</span>}
        </span>
      ))}
    </div>
  );
}

function SectionHeader({ title, subtitle }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: '4px 16px', borderBottom: `1px solid ${T.border}`, paddingBottom: 12, margin: '32px 0 20px' }}>
      <h2 style={{ fontFamily: SERIF, fontWeight: 400, fontSize: 24, lineHeight: '32px', letterSpacing: '-0.01em', margin: 0, color: T.fg }}>{title}</h2>
      {subtitle && <p style={{ fontSize: 14, lineHeight: '20px', color: T.muted, margin: 0 }}>{subtitle}</p>}
    </div>
  );
}

// Two columns like the blueprint; one column on narrow screens.
const GRID_CSS = `.beta-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px;align-items:stretch}
@media (max-width: 900px){.beta-grid{grid-template-columns:minmax(0,1fr)}}`;
const Grid = ({ children }) => <div className="beta-grid">{children}</div>;

// Hatch pattern for the in-progress week.
const hatchId = (color) => `hatch-${color.replace('#', '')}`;
function HatchDefs({ colors }) {
  return (
    <defs>
      {colors.map((c) => (
        <pattern key={c} id={hatchId(c)} width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="5" height="5" fill={c} opacity="0.25" />
          <line x1="0" y1="0" x2="0" y2="5" stroke={c} strokeWidth="2" opacity="0.8" />
        </pattern>
      ))}
    </defs>
  );
}

const tick = { fontFamily: SANS, fontSize: 11, fill: T.fg };
const xAxis = { dataKey: 'label', tick, tickLine: false, axisLine: false, tickMargin: 6, interval: 0 };
const yAxis = { tick, tickLine: false, axisLine: false, width: 40 };
const grid = <CartesianGrid vertical={false} stroke={T.border} />;
const chartMargin = { top: 6, right: 4, left: -6, bottom: 0 };

function TooltipBox({ title, rows, note }) {
  return (
    <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 12, padding: '8px 12px', fontFamily: SANS, fontSize: 12, minWidth: 190, boxShadow: '0 4px 12px rgba(38,30,22,0.08)', color: T.fg }}>
      <div style={{ fontWeight: 600, marginBottom: 4 }}>{title}</div>
      {rows.map((r) => (
        <div key={r.label} style={{ display: 'flex', justifyContent: 'space-between', gap: 16, lineHeight: 1.7 }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: T.muted }}>
            {r.color && <span style={{ width: 8, height: 8, borderRadius: 3, background: r.color }} />}
            {r.label}
          </span>
          <span style={{ ...tabular, fontWeight: 500 }}>{r.value}</span>
        </div>
      ))}
      {note && <div style={{ marginTop: 4, color: T.muted }}>{note}</div>}
    </div>
  );
}
const weekTitle = (w) => `Week of ${w.range}${w.partial ? ' (in progress)' : ''}`;
const cursor = { fill: 'rgba(38,30,22,0.04)' };

// ===========================================================================
// Charts
// ===========================================================================
function WebsiteVisitorsCard() {
  return (
    <Card
      title="Website visitors"
      question="How many people are we getting to the site?"
      footnote="GA4 engaged sessions (>10s, a conversion, or 2+ pageviews), same metric as the current dashboard. Used instead of total users because AI crawlers inflate that number. Hatched bar = week in progress."
    >
      <StatRow delta={<Delta value={pctChange(WINDOW.visitors, WINDOW.visitorsPrev)} />}>
        <Stat label="Engaged sessions · 30d" value={fmtInt(WINDOW.visitors)} />
      </StatRow>
      <Legend items={[{ label: 'Engaged sessions', color: T.chart1 }]} />
      <ResponsiveContainer width="100%" height={180}>
        <BarChart data={WEEKLY} margin={chartMargin}>
          <HatchDefs colors={[T.chart1]} />
          {grid}
          <XAxis {...xAxis} />
          <YAxis {...yAxis} />
          <Tooltip cursor={cursor} content={({ active, payload }) => active && payload?.length ? (
            <TooltipBox title={weekTitle(payload[0].payload)} rows={[{ label: 'Engaged sessions', value: fmtInt(payload[0].payload.visitors), color: T.chart1 }]} />
          ) : null} />
          <Bar dataKey="visitors" fillOpacity={0.85} isAnimationActive={false}>
            {WEEKLY.map((w) => <Cell key={w.start} fill={w.partial ? `url(#${hatchId(T.chart1)})` : T.chart1} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </Card>
  );
}

function NewSignupsCard() {
  return (
    <Card
      title="New signups"
      question="Are we converting intent into accounts?"
      footnote="Visitor → signup = signups ÷ GA4 engaged sessions for the same days. Every row of the signups export counts (internal/test accounts and repeat emails included). Hatched bar = week in progress."
    >
      <StatRow delta={<Delta value={WINDOW.conv - WINDOW.convPrev} suffix=" pts" />}>
        <Stat label="Visitor → signup" value={fmtPct(WINDOW.conv, 2)} />
        <Stat label="Signups · 30d" value={fmtInt(WINDOW.signups)} muted sub={<Delta value={pctChange(WINDOW.signups, WINDOW.signupsPrev)} />} />
      </StatRow>
      <Legend items={[{ label: 'Visitor → signup %', color: T.chart1, line: true }, { label: 'Signups', color: T.secondary }]} />
      <ResponsiveContainer width="100%" height={180}>
        <ComposedChart data={WEEKLY} margin={chartMargin}>
          <HatchDefs colors={[T.chart5]} />
          {grid}
          <XAxis {...xAxis} />
          <YAxis yAxisId="p" {...yAxis} tickFormatter={(v) => `${v}%`} />
          <YAxis yAxisId="n" orientation="right" {...yAxis} />
          <Tooltip cursor={cursor} content={({ active, payload }) => active && payload?.length ? (
            <TooltipBox
              title={weekTitle(payload[0].payload)}
              rows={[
                { label: 'Visitor → signup', value: fmtPct(payload[0].payload.conv, 2), color: T.chart1 },
                { label: 'Signups', value: fmtInt(payload[0].payload.signups), color: T.secondary },
                { label: 'Engaged sessions', value: fmtInt(payload[0].payload.visitors) },
              ]}
            />
          ) : null} />
          <Bar yAxisId="n" dataKey="signups" isAnimationActive={false}>
            {WEEKLY.map((w) => <Cell key={w.start} fill={w.partial ? `url(#${hatchId(T.chart5)})` : T.secondary} />)}
          </Bar>
          <Line yAxisId="p" dataKey="conv" stroke={T.chart1} strokeWidth={2} dot={false} activeDot={{ r: 3 }} isAnimationActive={false} />
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
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', gap: '4px 14px', margin: '16px 0 6px' }}>
        <span style={{ ...eyebrow, fontSize: 11, lineHeight: '14px', marginRight: 'auto' }}>By role · share of signups, 30d</span>
        <Legend
          style={{ margin: 0, justifyContent: 'flex-end' }}
          items={ROLES.map((r) => ({ label: r.label, color: r.color, value: fmtPct(pct(WINDOW.roleCounts[r.key], total), 0) }))}
        />
      </div>
      <ResponsiveContainer width="100%" height={180}>
        <BarChart data={WEEKLY} margin={chartMargin} barCategoryGap="22%">
          {grid}
          <XAxis {...xAxis} />
          <YAxis {...yAxis} domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} tickFormatter={(v) => `${v}%`} />
          <Tooltip cursor={cursor} content={({ active, payload }) => active && payload?.length ? (
            <TooltipBox
              title={weekTitle(payload[0].payload)}
              rows={ROLES.map((r) => ({
                label: r.label, color: r.color,
                value: `${fmtPct(payload[0].payload[`${r.key}_pct`], 0)} · ${payload[0].payload[r.key]}`,
              }))}
              note={`${payload[0].payload.signups} signups`}
            />
          ) : null} />
          {ROLES.map((r) => (
            <Bar key={r.key} dataKey={`${r.key}_pct`} stackId="role" fill={r.color} isAnimationActive={false} />
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
      footnote="Grouped by signup week: of people who signed up that week, the share who have done each step so far. Completed setup requires all three: recorder installed, calendar connected and email connected. Recent weeks have had less time to finish, so they read low."
    >
      <StatRow delta={<Delta value={allRate - pct(p.all, p.n)} suffix=" pts" />}>
        <Stat label="Signup → completed setup" value={fmtPct(allRate, 1)} sub={`${s.all} of ${s.n} signups · 30d`} />
      </StatRow>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px 32px', marginTop: 14 }}>
        {STEPS.map((st) => (
          <div key={st.key}>
            <div style={{ ...eyebrow, fontSize: 11 }}>{st.label}</div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
              <span style={{ ...tabular, fontSize: 18, fontWeight: 600, color: T.fg }}>{fmtPct(pct(s[st.key], s.n), 1)}</span>
              <Delta value={pct(s[st.key], s.n) - pct(p[st.key], p.n)} suffix=" pts" />
            </div>
          </div>
        ))}
      </div>
      <Legend items={[
        { label: 'All 3 steps', color: T.chart1, line: true, weight: 2 },
        ...STEPS.map((st) => ({ label: st.label, color: st.color, line: true, dashed: true })),
      ]} />
      <ResponsiveContainer width="100%" height={180}>
        <LineChart data={WEEKLY} margin={chartMargin}>
          {grid}
          <XAxis {...xAxis} />
          <YAxis {...yAxis} tickFormatter={(v) => `${v}%`} />
          <Tooltip content={({ active, payload }) => active && payload?.length ? (
            <TooltipBox
              title={`Signed up ${weekTitle(payload[0].payload).replace('Week of', 'week of')}`}
              rows={[
                { label: 'All 3 steps', color: T.chart1, value: `${fmtPct(payload[0].payload.setupAll)} · ${payload[0].payload.setupAllN}` },
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
          <Line dataKey="setupAll" stroke={T.chart1} strokeWidth={2} dot={false} activeDot={{ r: 3 }} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </Card>
  );
}

function ActivationCard({ stepKey, title, question, rateLabel, cohortNoun, convNoun, footnote, extra }) {
  const { curr, prev, weekly } = ACT[stepKey];
  return (
    <Card title={title} question={question} footnote={footnote}>
      <StatRow delta={<Delta value={curr.rate != null && prev.rate != null ? curr.rate - prev.rate : null} suffix=" pts" />}>
        <Stat label={rateLabel} value={fmtPct(curr.rate, 1)} sub={`${curr.conv} of ${curr.n} ${cohortNoun} · 30d`} />
      </StatRow>
      {extra}
      <Legend items={[{ label: 'Actual %', color: T.chart1, line: true }, { label: `${cohortNoun[0].toUpperCase()}${cohortNoun.slice(1)} (cohort size)`, color: T.secondary }]} />
      <ResponsiveContainer width="100%" height={180}>
        <ComposedChart data={weekly} margin={chartMargin}>
          <HatchDefs colors={[T.chart5]} />
          {grid}
          <XAxis {...xAxis} />
          <YAxis yAxisId="p" {...yAxis} domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} tickFormatter={(v) => `${v}%`} />
          <YAxis yAxisId="n" orientation="right" {...yAxis} allowDecimals={false} />
          <Tooltip cursor={cursor} content={({ active, payload }) => active && payload?.length ? (
            <TooltipBox
              title={weekTitle(payload[0].payload)}
              rows={[
                { label: 'Conversion', value: fmtPct(payload[0].payload.rate), color: T.chart1 },
                { label: convNoun, value: fmtInt(payload[0].payload.conv) },
                { label: cohortNoun[0].toUpperCase() + cohortNoun.slice(1), value: fmtInt(payload[0].payload.n), color: T.secondary },
              ]}
            />
          ) : null} />
          <Bar yAxisId="n" dataKey="n" isAnimationActive={false}>
            {weekly.map((w) => <Cell key={w.start} fill={w.partial ? `url(#${hatchId(T.chart5)})` : T.secondary} />)}
          </Bar>
          <Line yAxisId="p" dataKey="rate" stroke={T.chart1} strokeWidth={2} dot={{ r: 3, fill: T.chart1 }} activeDot={{ r: 4 }} connectNulls={false} isAnimationActive={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </Card>
  );
}

function FirstMeetingCard() {
  return (
    <ActivationCard
      stepKey="mt"
      title="First meeting recorded"
      question="Do set-up users capture a real meeting?"
      rateLabel="Completed setup → first meeting"
      cohortNoun="completed setup"
      convNoun="Recorded a meeting ≤7d"
      extra={
        <div style={{ marginTop: 14 }}>
          <div style={{ ...eyebrow, fontSize: 11 }}>Any signup → first meeting</div>
          <span style={{ ...tabular, fontSize: 18, fontWeight: 600 }}>{fmtPct(pct(MEETING_ANY_30D, WINDOW.signups), 1)}</span>
          <span style={{ fontSize: 12, color: T.muted, marginLeft: 8 }}>{MEETING_ANY_30D} of {WINDOW.signups} signups · 30d, setup or not</span>
        </div>
      }
      footnote="Share of users who completed setup and recorded at least one meeting within 7 days. Grouped by the week they completed setup (the last of recorder, calendar and email). Users who finished setup in the last 7 days are still inside their window. Line gaps = weeks where nobody completed setup."
    />
  );
}

function FirstSendCard() {
  return (
    <ActivationCard
      stepKey="snd"
      title="First customer send (A2)"
      question="Did the user send an email or asset to a customer using Mutiny?"
      rateLabel="First meeting → first customer send"
      cohortNoun="with a first meeting"
      convNoun="Sent first email/asset"
      footnote="Share of users with a first recorded meeting who have sent their first email or asset (first_email_or_asset_sent_at). Grouped by the week of their first meeting. The export doesn't say whether a send went to a customer or internally, so all sends count for now."
    />
  );
}

// ===========================================================================
// Page
// ===========================================================================
export default function BetaDashboard() {
  const currentUrl = (() => {
    const u = new URL(window.location.href);
    u.searchParams.delete('beta');
    return u.pathname + u.search + u.hash;
  })();
  return (
    <div style={{ background: T.bg, minHeight: '100vh', fontFamily: SANS, color: T.fg, fontSize: 16, lineHeight: '24px' }}>
      <style>{GRID_CSS}</style>
      <header style={{ borderBottom: `1px solid ${T.border}` }}>
        <div style={{ maxWidth: 1400, margin: '0 auto', padding: '24px 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.18em', color: T.muted }}>Mutiny · Growth · Beta</div>
            <h1 style={{ fontFamily: SERIF, fontWeight: 400, fontSize: 36, lineHeight: '40px', letterSpacing: '-0.01em', margin: '8px 0 0' }}>Funnel performance</h1>
            <p style={{ fontSize: 14, lineHeight: '20px', color: T.muted, margin: '8px 0 0', maxWidth: 672 }}>
              Every stage is measured once and only once, and the stages add up to the whole journey.
            </p>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 12 }}>
            <a href={currentUrl} style={{ borderRadius: 12, border: `1px solid ${T.border}`, background: T.card, padding: '8px 12px', fontSize: 14, fontWeight: 500, color: T.fg, textDecoration: 'none' }}>
              View current dashboard
            </a>
            <div style={{ borderRadius: 16, border: `1px solid ${T.border}`, background: T.card, padding: '12px 16px', fontSize: 14, lineHeight: '20px' }}>
              <div style={{ color: T.muted }}>Reporting period</div>
              <div>Last 30 days · {rangeLabel(START, END)}</div>
            </div>
          </div>
        </div>
      </header>

      <main style={{ maxWidth: 1400, margin: '0 auto', padding: '32px 24px 64px' }}>
        <div style={{ marginBottom: 24, borderRadius: 16, border: `1px dashed ${T.border}`, background: T.surface, padding: '12px 16px', fontSize: 14, lineHeight: '20px', color: T.muted }}>
          <strong style={{ color: T.fg, fontWeight: 600 }}>Note:</strong> Beta — sections are being rebuilt one at a time. Weekly charts cover {rangeLabel(WEEKS[0].start, END)} (Mon–Sun weeks).
        </div>

        <SectionHeader title="Website visitors" subtitle="Top of the funnel: people who reach the site." />
        <Grid>
          <WebsiteVisitorsCard />
        </Grid>

        <SectionHeader title="1. Signup" subtitle="Visitors who create an account. The gate between anonymous and known." />
        <Grid>
          <NewSignupsCard />
          <RoleMixCard />
          <CompletedSetupCard />
        </Grid>

        <SectionHeader title="2. Activation" subtitle="First real value. The aha moment: a meeting captured and a usable note." />
        <Grid>
          <FirstMeetingCard />
          <FirstSendCard />
        </Grid>

        <div style={{ fontSize: 12, color: T.muted, marginTop: 24 }}>
          Signups export: {betaSignups.source} · {SIGNUPS.length.toLocaleString()} rows · {rangeLabel(DATA_START, betaSignups.lastDate)}.
          GA4 pulled {dataJson.ga4.pulledAt?.slice(0, 10)}.
        </div>
      </main>
    </div>
  );
}
