// ---------------------------------------------------------------------------
// AEO section (Nick, Oct 27 2026). Only rendered with ?aeo (see
// beta_dashboard.jsx). Two parts, both from Peec (project "Mutiny 2.0"):
//   1. Weekly AI visibility report: last 7 complete days vs the 7 before,
//      replacing the Friday Slack DM (summary, brand ranking, topics, engines,
//      domains, Peec actions, takeaways).
//   2. Content backlog: every tracked prompt in the 5 AEO topics scored for
//      where Mutiny is losing citations, with a brief (gap, top 5 cited URLs,
//      winning page shape, internal links, Mutiny lean) for the top picks.
// Data: src/aeo.json, built by scripts/build-aeo.mjs from data/aeo/raw/*
// (pulled via the Peec MCP during the daily refresh) + data/aeo/narrative.json.
// ---------------------------------------------------------------------------
import React, { useMemo, useState } from 'react';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';
import { ArrowUpRight, ArrowDownRight, ChevronDown, ExternalLink, Info, GraduationCap } from 'lucide-react';
import AeoTour, { TOUR_DONE_KEY } from './aeo_tour.jsx';
import aeo from './src/aeo.json';

const C = {
  purple: '#A73BF5', green: '#B2FF14', red: '#FB5A3D', blue: '#96ECFF',
  lightPurple: '#F2D1FC', lightBlue: '#BCEEFD', lightRed: '#FF9987', lightGreen: '#D2FD78',
  black: '#000000', lightGrey: '#EFEFEF', white: '#FFFFFF', paper: '#FAF8F4',
  muted: 'rgba(0,0,0,0.55)', grid: '#E6E6E6', up: '#1E8A3A', down: '#E0401F',
};
const FONT_DISPLAY = "'Fraunces', 'Reckless Condensed S', Georgia, serif";
const FONT_BODY = "'Manrope', 'KMR Waldenburg', Arial, sans-serif";
const FONT_CAPTION = "'Fraunces', 'Affix', Georgia, serif";
const tabular = { fontVariantNumeric: 'tabular-nums' };
const eyebrow = { fontFamily: FONT_BODY, fontSize: 10.5, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: C.muted };

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const md = (iso) => { const d = new Date(`${iso}T00:00:00Z`); return `${MON[d.getUTCMonth()]} ${d.getUTCDate()}`; };
const span = (w) => `${md(w.start)} to ${md(w.end)}`;
const pct = (v, dp = 1) => (v == null ? '·' : `${(v * 100).toFixed(dp)}%`);
const num = (v) => (v == null ? '·' : v.toLocaleString());
const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch (e) { return u; } };
const shortUrl = (u) => { try { const x = new URL(u); return `${x.hostname.replace(/^www\./, '')}${x.pathname === '/' ? '' : x.pathname}`; } catch (e) { return u; } };
const TOPIC_ORDER = ['AISE', 'ABM', 'AST', 'MGTM', 'CC'];
const TOPIC_COLOR = { AISE: C.lightPurple, ABM: C.lightGreen, AST: C.lightBlue, MGTM: '#FFE3A3', CC: C.lightRed };
const N = aeo.narrative || {};

// Delta chip. kind: 'pts' (ratio → percentage points), 'num', 'pos' (lower is better).
function Delta({ cur, prev, kind = 'pts', size = 12.5 }) {
  if (cur == null || prev == null) return <span style={{ color: C.muted, fontSize: size }}>new</span>;
  let d = cur - prev;
  if (kind === 'pts') d *= 100;
  const shown = kind === 'num' ? Math.abs(Math.round(d)).toLocaleString() : Math.abs(d).toFixed(1);
  if (Math.abs(d) < (kind === 'num' ? 0.5 : 0.05)) return <span style={{ ...tabular, color: C.muted, fontSize: size, fontWeight: 700 }}>flat</span>;
  const good = kind === 'pos' ? d < 0 : d > 0;
  const Icon = d > 0 ? ArrowUpRight : ArrowDownRight;
  return (
    <span style={{ ...tabular, display: 'inline-flex', alignItems: 'center', gap: 1, fontSize: size, fontWeight: 700, color: good ? C.up : C.down, whiteSpace: 'nowrap' }}>
      <Icon size={size + 2} strokeWidth={2.5} />{shown}{kind === 'pts' ? ' pts' : ''}
    </span>
  );
}

function Card({ title, sub, children, footnote, style, right, tour }) {
  const [note, setNote] = useState(false);
  return (
    <article data-tour={tour} style={{ background: C.white, border: `1px solid ${C.black}`, borderRadius: 4, padding: '24px 26px 20px', minWidth: 0, display: 'flex', flexDirection: 'column', ...style }}>
      {(title || right) && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
          <div style={{ minWidth: 0 }}>
            {title && <h3 style={{ fontFamily: FONT_BODY, fontSize: 16, fontWeight: 700, lineHeight: 1.35, margin: 0 }}>{title}</h3>}
            {sub && <div style={{ color: C.muted, fontSize: 12.5, marginTop: 4 }}>{sub}</div>}
          </div>
          {right}
        </div>
      )}
      <div style={{ flex: 1 }}>{children}</div>
      {footnote && (
        <>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
            <button type="button" className="beta-note-btn" onClick={() => setNote((v) => !v)} aria-expanded={note} title="About this card" style={{ opacity: note ? 0.7 : 0.35 }}>
              <Info size={14} strokeWidth={2} />
            </button>
          </div>
          {note && <div style={{ fontFamily: FONT_CAPTION, fontStyle: 'italic', fontSize: 11.5, lineHeight: 1.5, opacity: 0.55 }}>{footnote}</div>}
        </>
      )}
    </article>
  );
}

function SectionTitle({ kicker, title, sub }) {
  return (
    <div style={{ margin: '48px 0 16px' }}>
      {kicker && <div style={eyebrow}>{kicker}</div>}
      <h2 style={{ fontFamily: FONT_DISPLAY, fontWeight: 400, fontSize: 30, letterSpacing: '-0.03em', lineHeight: 1.1, margin: '4px 0 0' }}>{title}</h2>
      {sub && <div style={{ color: C.muted, fontSize: 13.5, marginTop: 6, maxWidth: 820, lineHeight: 1.5 }}>{sub}</div>}
    </div>
  );
}

const Chip = ({ children, bg = C.white, title, style }) => (
  <span title={title} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, border: `1px solid ${C.black}`, borderRadius: 999, padding: '2px 9px', fontSize: 11.5, fontWeight: 700, background: bg, whiteSpace: 'nowrap', ...style }}>{children}</span>
);

const Bar = ({ value, max, color = C.purple }) => (
  <div style={{ height: 8, background: C.lightGrey, borderRadius: 2, overflow: 'hidden', minWidth: 60 }}>
    <div style={{ width: `${Math.min(100, (value / max) * 100)}%`, height: '100%', background: color }} />
  </div>
);

const th = { textAlign: 'left', fontSize: 10.5, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: C.muted, padding: '0 10px 8px 0', borderBottom: `1px solid ${C.black}`, whiteSpace: 'nowrap' };
const td = { padding: '8px 10px 8px 0', borderBottom: `1px solid ${C.lightGrey}`, fontSize: 13, verticalAlign: 'top' };
const tdNum = { ...td, ...tabular, textAlign: 'right', whiteSpace: 'nowrap' };
const thNum = { ...th, textAlign: 'right' };

const A = ({ href, children, style }) => (
  <a href={href} target="_blank" rel="noopener noreferrer" style={{ color: C.black, textDecorationColor: '#9A9A9A', textUnderlineOffset: 3, ...style }}>{children}</a>
);

// --- 1. Summary ------------------------------------------------------------------
const KPIS = [
  { key: 'visibility', label: 'Visibility', kind: 'pts', fmt: pct, help: 'Share of AI answers that mention Mutiny.' },
  { key: 'mentions', label: 'Mentions', kind: 'num', fmt: num, help: 'Times Mutiny was mentioned across all answers.' },
  { key: 'sov', label: 'Share of voice', kind: 'pts', fmt: pct, help: "Mutiny's share of all tracked-brand mentions." },
  { key: 'sentiment', label: 'Sentiment', kind: 'num', fmt: (v) => v, help: '0 to 100. Most brands score 65 to 85; under 65 needs work.' },
  { key: 'position', label: 'Avg position', kind: 'pos', fmt: (v) => v?.toFixed(1), help: 'Rank when mentioned. Lower is better (1 = named first).' },
];

function Summary() {
  const m = aeo.mutiny.cur; const p = aeo.mutiny.prev;
  return (
    <Card style={{ padding: '28px 30px 22px' }}>
      <div style={eyebrow}>Executive summary</div>
      <p data-tour="summary" style={{ fontFamily: FONT_DISPLAY, fontSize: 21, lineHeight: 1.4, letterSpacing: '-0.01em', margin: '10px 0 22px', maxWidth: 1080 }}>{N.summary}</p>
      <div data-tour="kpis" className="aeo-kpis" style={{ display: 'grid', gridTemplateColumns: 'repeat(5, minmax(0,1fr))', gap: 12 }}>
        {KPIS.map((k) => (
          <div key={k.key} title={k.help} style={{ border: `1px solid ${C.black}`, borderRadius: 4, padding: '14px 16px', background: k.key === 'visibility' ? C.lightPurple : C.paper }}>
            <div style={eyebrow}>{k.label}</div>
            <div style={{ ...tabular, fontFamily: FONT_DISPLAY, fontSize: 34, letterSpacing: '-0.03em', lineHeight: 1.05, margin: '8px 0 6px' }}>{k.fmt(m[k.key])}</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: C.muted, flexWrap: 'wrap' }}>
              <span style={tabular}>was {k.fmt(p[k.key])}</span>
              <Delta cur={m[k.key]} prev={p[k.key]} kind={k.kind} />
            </div>
          </div>
        ))}
      </div>
      <div style={{ color: C.muted, fontSize: 12, marginTop: 12 }}>Avg position: lower is better (1 = Mutiny named first). Win rate {pct(m.winRate)} (was {pct(p.winRate)}): share of answers where Mutiny is named before every other brand.</div>
    </Card>
  );
}

// --- 2. Competitive landscape ---------------------------------------------------------
function Landscape() {
  const max = Math.max(...aeo.brands.map((b) => b.visibility));
  return (
    <Card tour="landscape" title="Competitive landscape" sub={`Ranked by visibility, ${span(aeo.windows.cur)}`}
      footnote="Visibility = share of AI answers (ChatGPT, Google AI Overview, Perplexity) across every tracked prompt that mention the brand. Change is in percentage points vs the previous 7 days.">
      <div style={{ overflowX: 'auto', marginTop: 14 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr><th style={th}>#</th><th style={th}>Brand</th><th style={{ ...th, width: '34%' }}>Visibility</th><th style={thNum}>Last wk</th><th style={thNum}>Change</th><th style={thNum}>SoV</th><th style={thNum}>Pos</th></tr></thead>
          <tbody>
            {aeo.brands.map((b) => {
              const moved = b.prev && b.prev.rank !== b.rank;
              return (
                <tr key={b.id} style={{ background: b.own ? C.lightPurple : undefined }}>
                  <td style={{ ...td, ...tabular, fontWeight: 700 }}>{b.rank}</td>
                  <td style={{ ...td, fontWeight: b.own ? 800 : 600, whiteSpace: 'nowrap' }}>
                    {b.name}
                    {moved && <span title={`Was #${b.prev.rank}`} style={{ marginLeft: 6, fontSize: 11, fontWeight: 700, color: b.prev.rank > b.rank ? C.up : C.down }}>{b.prev.rank > b.rank ? '▲' : '▼'}{Math.abs(b.prev.rank - b.rank)}</span>}
                  </td>
                  <td style={td}><div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><span style={{ ...tabular, width: 44, fontWeight: 700 }}>{pct(b.visibility)}</span><div style={{ flex: 1 }}><Bar value={b.visibility} max={max} color={b.own ? C.purple : '#BDBDBD'} /></div></div></td>
                  <td style={{ ...tdNum, color: C.muted }}>{pct(b.prev?.visibility)}</td>
                  <td style={tdNum}><Delta cur={b.visibility} prev={b.prev?.visibility} /></td>
                  <td style={tdNum}>{pct(b.sov)}</td>
                  <td style={tdNum}>{b.position?.toFixed(1)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {N.brandFlags && <div style={{ marginTop: 14, padding: '12px 14px', background: C.paper, border: `1px solid ${C.black}`, borderRadius: 4, fontSize: 13.5, lineHeight: 1.55 }}><b>Flags: </b>{N.brandFlags}</div>}
    </Card>
  );
}

// --- 3. Daily trend + engines ----------------------------------------------------------
const ENG_COLOR = { 'openai-0': C.purple, 'google-0': C.red, 'perplexity-0': '#2BB6D6' };
function Engines() {
  const data = aeo.daily.map((d) => ({ ...d, label: md(d.date) }));
  const best = [...aeo.channels].sort((a, b) => a.cur.position - b.cur.position || b.cur.sov - a.cur.sov)[0];
  return (
    <Card tour="engines" title="By AI engine" sub={`Mutiny, ${span(aeo.windows.cur)} vs ${span(aeo.windows.prev)}`}
      footnote="Daily visibility per engine over both weeks (left half = previous week). Engine totals sum Peec's daily rows; share of voice is rebuilt from each day's mentions.">
      <div className="aeo-eng" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0,1fr))', gap: 10, marginTop: 14 }}>
        {aeo.channels.map((c) => (
          <div key={c.id} style={{ border: `1px solid ${C.black}`, borderRadius: 4, padding: '12px 14px', background: c.id === best.id ? C.lightGreen : C.paper }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 700, fontSize: 13 }}>
              <span style={{ width: 10, height: 10, borderRadius: 2, background: ENG_COLOR[c.id], border: `1px solid ${C.black}` }} />{c.name}
            </div>
            <div style={{ ...tabular, fontFamily: FONT_DISPLAY, fontSize: 28, letterSpacing: '-0.03em', margin: '6px 0 4px' }}>{pct(c.cur.visibility)}</div>
            <div style={{ fontSize: 12, color: C.muted, lineHeight: 1.7 }}>
              <div>Visibility <Delta cur={c.cur.visibility} prev={c.prev.visibility} size={11.5} /></div>
              <div style={tabular}>Position {c.cur.position?.toFixed(1)} <Delta cur={c.cur.position} prev={c.prev.position} kind="pos" size={11.5} /></div>
              <div style={tabular}>Mentions {num(c.cur.mentions)} <Delta cur={c.cur.mentions} prev={c.prev.mentions} kind="num" size={11.5} /></div>
              <div style={tabular}>SoV {pct(c.cur.sov)}</div>
            </div>
          </div>
        ))}
      </div>
      <div style={{ height: 190, marginTop: 16 }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 6, right: 8, left: -12, bottom: 0 }}>
            <CartesianGrid stroke={C.grid} vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 10.5, fontFamily: FONT_BODY }} interval={1} tickLine={false} axisLine={{ stroke: C.black }} />
            <YAxis tickFormatter={(v) => `${Math.round(v * 100)}%`} tick={{ fontSize: 10.5, fontFamily: FONT_BODY }} tickLine={false} axisLine={false} domain={[0, 'auto']} />
            <Tooltip formatter={(v, n) => [pct(v), n]} labelStyle={{ fontWeight: 700 }} contentStyle={{ border: `1px solid ${C.black}`, borderRadius: 4, fontFamily: FONT_BODY, fontSize: 12 }} />
            <Line dataKey="openai-0" name="ChatGPT" stroke={ENG_COLOR['openai-0']} strokeWidth={2} dot={false} />
            <Line dataKey="perplexity-0" name="Perplexity" stroke={ENG_COLOR['perplexity-0']} strokeWidth={2} dot={false} />
            <Line dataKey="google-0" name="Google AI Overview" stroke={ENG_COLOR['google-0']} strokeWidth={2} dot={false} />
            <Line dataKey="visibility" name="All engines" stroke={C.black} strokeWidth={2.5} strokeDasharray="4 3" dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      {N.channels && <p style={{ fontSize: 13.5, lineHeight: 1.55, margin: '12px 0 0' }}>{N.channels}</p>}
    </Card>
  );
}

// --- 4. Topics ---------------------------------------------------------------------------
const TOPIC_METRICS = [
  ['visibility', 'Visibility', 'pts', pct], ['mentions', 'Mentions', 'num', num], ['sov', 'Share of voice', 'pts', pct],
  ['sentiment', 'Sentiment', 'num', (v) => v], ['position', 'Avg position', 'pos', (v) => v?.toFixed(1)],
];
function TopicCard({ t, tour }) {
  const m = t.mutiny; const note = N.topics?.[t.key] || {};
  const top = t.brands.slice(0, 5);
  const max = Math.max(...top.map((b) => b.visibility), m?.visibility || 0);
  const showMutinyRow = m && m.rank > 5;
  return (
    <Card tour={tour} title={<span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}><span style={{ width: 12, height: 12, background: TOPIC_COLOR[t.key], border: `1px solid ${C.black}`, borderRadius: 2 }} />{t.name}</span>}
      sub={`Mutiny #${m?.rank ?? '·'} of ${t.brands.length} · ${num(t.responses)} answers this week`}>
      <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 12 }}>
        <thead><tr><th style={th}>Mutiny</th><th style={thNum}>Last wk</th><th style={thNum}>This wk</th><th style={thNum}>Change</th></tr></thead>
        <tbody>
          {TOPIC_METRICS.map(([k, label, kind, fmt]) => (
            <tr key={k}><td style={td}>{label}</td><td style={{ ...tdNum, color: C.muted }}>{fmt(m?.prev?.[k])}</td><td style={{ ...tdNum, fontWeight: 700 }}>{fmt(m?.[k])}</td><td style={tdNum}><Delta cur={m?.[k]} prev={m?.prev?.[k]} kind={kind} /></td></tr>
          ))}
        </tbody>
      </table>
      <div style={{ ...eyebrow, marginTop: 16, marginBottom: 6 }}>Top brands by visibility</div>
      {[...top, ...(showMutinyRow ? [m] : [])].map((b) => (
        <div key={b.brand} style={{ display: 'grid', gridTemplateColumns: '92px 1fr 46px 62px', alignItems: 'center', gap: 8, fontSize: 12.5, padding: '3px 0', fontWeight: b.brand === 'Mutiny' ? 800 : 500 }}>
          <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{b.rank}. {b.brand}</span>
          <Bar value={b.visibility} max={max} color={b.brand === 'Mutiny' ? C.purple : '#BDBDBD'} />
          <span style={{ ...tabular, textAlign: 'right' }}>{pct(b.visibility, 0)}</span>
          <span style={{ textAlign: 'right' }}><Delta cur={b.visibility} prev={b.prev?.visibility} size={11} /></span>
        </div>
      ))}
      {(note.competitive || note.trend) && (
        <div style={{ marginTop: 14, fontSize: 13, lineHeight: 1.55 }}>
          {note.competitive && <p style={{ margin: '0 0 6px' }}><b>Competitive context: </b>{note.competitive}</p>}
          {note.trend && <p style={{ margin: 0 }}><b>Trend: </b>{note.trend}</p>}
        </div>
      )}
    </Card>
  );
}

// --- 5. Domains & sources ------------------------------------------------------------------
const CLS_BG = { You: C.lightPurple, Competitor: C.lightRed, UGC: C.lightBlue, Corporate: C.lightGrey, Editorial: C.lightGreen, Other: C.white };
function Domains() {
  const own = aeo.domains.own;
  return (
    <Card tour="domains" title="Most retrieved source domains" sub={`Chats that pulled at least one URL from the domain, ${span(aeo.windows.cur)}`}
      footnote="Retrieved = share of chats that pulled a URL from the domain. Cited = share of chats that cite it inline. Last week's rank is within last week's top 40.">
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', margin: '14px 0 12px' }}>
        <Chip bg={C.lightPurple}>mutinyhq.com: {num(own.cur?.chats)} chats <Delta cur={own.cur?.chats} prev={own.prev?.chats} kind="num" size={11} /></Chip>
        <Chip>Cited in {pct(own.cur?.cited)} of chats (was {pct(own.prev?.cited)})</Chip>
        <Chip bg={aeo.domains.newCompetitors.length ? C.lightRed : C.white}>New competitor domains: {aeo.domains.newCompetitors.length ? aeo.domains.newCompetitors.join(', ') : 'none'}</Chip>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr><th style={th}>#</th><th style={th}>Domain</th><th style={thNum}>Chats</th><th style={thNum}>Last wk</th><th style={thNum}>Retrieved</th><th style={thNum}>Cited</th></tr></thead>
          <tbody>
            {aeo.domains.top.map((d) => (
              <tr key={d.domain} style={{ background: d.cls === 'You' ? C.lightPurple : undefined }}>
                <td style={{ ...td, ...tabular }}>{d.rank}{d.prev && d.prev.rank !== d.rank && <span style={{ marginLeft: 4, fontSize: 10.5, fontWeight: 700, color: d.prev.rank > d.rank ? C.up : C.down }}>{d.prev.rank > d.rank ? '▲' : '▼'}{Math.abs(d.prev.rank - d.rank)}</span>}</td>
                <td style={{ ...td, whiteSpace: 'nowrap' }}>{d.domain} <Chip bg={CLS_BG[d.cls] || C.white} style={{ fontSize: 10, padding: '0 6px', marginLeft: 4 }}>{d.cls}</Chip></td>
                <td style={{ ...tdNum, fontWeight: 700 }}>{num(d.chats)}</td>
                <td style={{ ...tdNum, color: C.muted }}>{num(d.prev?.chats)}</td>
                <td style={tdNum}>{pct(d.retrieved)}</td>
                <td style={tdNum}>{pct(d.cited)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {N.domains && <p style={{ fontSize: 13.5, lineHeight: 1.55, margin: '12px 0 0' }}>{N.domains}</p>}
    </Card>
  );
}

function UrlList({ title, sub, rows, showBrands, tour }) {
  return (
    <Card tour={tour} title={title} sub={sub} footnote="Citations = inline citations across all chats this week. Pos = average rank among the sources an answer cites (1 = cited first).">
      <ol style={{ listStyle: 'none', padding: 0, margin: '12px 0 0' }}>
        {rows.map((u, i) => (
          <li key={u.url} style={{ display: 'grid', gridTemplateColumns: '22px 1fr auto', gap: 8, padding: '8px 0', borderBottom: `1px solid ${C.lightGrey}`, fontSize: 13 }}>
            <span style={{ ...tabular, fontWeight: 700 }}>{i + 1}</span>
            <span style={{ minWidth: 0 }}>
              <A href={u.url} style={{ fontWeight: 600 }}>{u.title || shortUrl(u.url)}</A>
              <div style={{ color: C.muted, fontSize: 11.5, marginTop: 2 }}>{host(u.url)} · {u.type}{showBrands && u.brands?.length ? ` · mentions ${u.brands.join(', ')}` : ''}</div>
            </span>
            <span style={{ ...tabular, textAlign: 'right', whiteSpace: 'nowrap' }}><b>{u.citations}</b> <span style={{ color: C.muted, fontSize: 11.5 }}>cites · pos {u.position?.toFixed(1)}</span></span>
          </li>
        ))}
      </ol>
    </Card>
  );
}

// --- 6. Opportunities + takeaways -------------------------------------------------------------
function Opportunities() {
  const o = aeo.opportunities;
  return (
    <div className="aeo-g3" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 16 }}>
      {o.items.map((a, k) => (
        <Card key={a.id} tour={k === 0 ? 'opps' : undefined}>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
            <Chip bg={C.green}>{a.impact} impact</Chip><Chip>{a.group} · {a.format}</Chip>{a.topic && <Chip bg={C.lightGrey}>{a.topic}</Chip>}
          </div>
          <div style={{ fontWeight: 700, fontSize: 15, lineHeight: 1.35 }}>{a.title}</div>
          <p style={{ fontSize: 13, lineHeight: 1.55, margin: '8px 0' }}>{a.text}</p>
          {N.opportunityContext?.[a.id] && <p style={{ fontSize: 13, lineHeight: 1.55, margin: '0 0 8px', padding: '8px 10px', background: C.paper, borderLeft: `3px solid ${C.purple}` }}>{N.opportunityContext[a.id]}</p>}
          {a.sources?.length > 0 && <div style={{ fontSize: 11.5, color: C.muted, lineHeight: 1.5 }}>Sources: {a.sources.join(' · ')}</div>}
        </Card>
      ))}
      <div style={{ fontSize: 12, color: C.muted, gridColumn: '1 / -1' }}>Top {o.items.length} of {o.totalOpen} open Peec actions, ranked by Peec's impact. Text is Peec's; full list in <A href="https://app.peec.ai/actions/recommendations">Peec Actions</A>.</div>
    </div>
  );
}

// --- 7. Backlog --------------------------------------------------------------------------------
const STATUS = {
  absent: { label: 'Absent', bg: C.lightRed, help: 'Mutiny is on none of the top 5 cited pages for this prompt.' },
  weak: { label: 'Weak', bg: '#FFE3A3', help: 'Mutiny appears on a top-5 page but in under 10% of answers.' },
  present: { label: 'Present', bg: C.lightBlue, help: 'Mutiny appears on a top-5 page and in 10% to 50% of answers.' },
  winning: { label: 'Winning', bg: C.lightGreen, help: 'Mutiny is in at least half of the answers for this prompt.' },
};
const SHAPE = { listicle: 'a listicle', alternative: 'an alternatives page', article: 'an article', 'how to guide': 'a how-to guide', comparison: 'a comparison page', 'product page': 'a product page', 'category page': 'a category page', homepage: 'a homepage', other: 'a page' };
const GAP_LABEL = { attack: 'Direct attack (+4)', mild: 'Mild attack (+3)', capture: 'Capture (+2)', weak: 'Weak presence (+1)', present: 'Mutiny cited (+0)' };
const topicName = (k) => aeo.topics.find((t) => t.key === k)?.name || k;

function TopicFilter({ value, onChange, counts }) {
  const opts = [['all', 'All topics'], ...TOPIC_ORDER.map((k) => [k, topicName(k)])];
  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
      {opts.map(([k, label]) => (
        <button key={k} type="button" onClick={() => onChange(k)} aria-pressed={value === k}
          style={{ border: `1px solid ${C.black}`, borderRadius: 999, padding: '5px 12px', fontFamily: FONT_BODY, fontSize: 12.5, fontWeight: 700, cursor: 'pointer', background: value === k ? C.black : (k === 'all' ? C.white : TOPIC_COLOR[k]), color: value === k ? C.white : C.black }}>
          {label}{counts?.[k] != null ? ` · ${counts[k]}` : ''}
        </button>
      ))}
    </div>
  );
}

function Brief({ b, rank }) {
  const [open, setOpen] = useState(rank === 1);
  // The tour can open a brief: window event 'aeo:open-brief' with detail = prompt id.
  React.useEffect(() => {
    const on = (e) => { if (e.detail === b.id) setOpen(true); };
    window.addEventListener('aeo:open-brief', on);
    return () => window.removeEventListener('aeo:open-brief', on);
  }, [b.id]);
  const p = b.pattern || {};
  const missing = b.pages.filter((x) => x.missing);
  return (
    <article data-tour={rank === 1 ? 'brief' : undefined} style={{ background: C.white, border: `1px solid ${C.black}`, borderRadius: 4, overflow: 'hidden' }}>
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open}
        style={{ all: 'unset', boxSizing: 'border-box', width: '100%', cursor: 'pointer', display: 'grid', gridTemplateColumns: '54px 1fr auto', gap: 14, alignItems: 'center', padding: '16px 20px' }}>
        <div style={{ ...tabular, textAlign: 'center', border: `1px solid ${C.black}`, borderRadius: 4, background: C.purple, padding: '6px 0' }}>
          <div style={{ fontFamily: FONT_DISPLAY, fontSize: 24, lineHeight: 1 }}>{b.score}</div>
          <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.08em' }}>SCORE</div>
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 15.5, lineHeight: 1.35 }}>“{b.text}”</div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
            <Chip bg={TOPIC_COLOR[b.topic]}>{b.topicName}</Chip>
            <Chip bg={b.role === 'anchor' ? C.black : C.white} style={{ color: b.role === 'anchor' ? C.white : C.black }}>{b.role === 'anchor' ? 'Anchor' : 'Supplementary'}</Chip>
            <Chip>{b.volume} volume</Chip><Chip>{b.intent}</Chip>
            <Chip bg={STATUS[b.status].bg} title={STATUS[b.status].help}>Mutiny {pct(b.mutinyVis, 0)} of answers</Chip>
          </div>
          <div style={{ fontSize: 12.5, color: C.muted, marginTop: 6 }}>{b.signal}</div>
        </div>
        <ChevronDown size={20} style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 120ms' }} />
      </button>
      {open && (
        <div style={{ borderTop: `1px solid ${C.black}`, padding: '18px 20px 20px', background: C.paper }}>
          <div className="aeo-brief" style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.25fr) minmax(0,1fr)', gap: 20 }}>
            <div style={{ minWidth: 0 }}>
              <div style={eyebrow}>Top 5 cited URLs (30 days)</div>
              <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 6 }}>
                <thead><tr><th style={th}>Page</th><th style={thNum}>Retrievals</th><th style={thNum}>Cites</th></tr></thead>
                <tbody>
                  {b.top5.map((u) => (
                    <tr key={u.url}>
                      <td style={{ ...td, minWidth: 0 }}>
                        <A href={u.url} style={{ fontWeight: 600 }}>{u.title || shortUrl(u.url)}</A>
                        <div style={{ fontSize: 11.5, color: C.muted, marginTop: 2 }}>{host(u.url)} · {u.type}{u.competitors.length ? ` · ${u.competitors.slice(0, 5).join(', ')}` : ''}{u.mutiny ? ' · Mutiny' : ''}</div>
                      </td>
                      <td style={tdNum}>{u.retrievals}</td><td style={tdNum}>{u.citations}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div style={{ ...eyebrow, marginTop: 18 }}>Page by page</div>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 6, fontSize: 12 }}>
                  <thead><tr><th style={th}>Domain</th><th style={thNum}>Words</th><th style={thNum}>H2</th><th style={thNum}>Q-heads</th><th style={thNum}>Stats</th><th style={thNum}>Out links</th><th style={th}>Table</th><th style={th}>FAQ</th><th style={th}>Updated</th></tr></thead>
                  <tbody>
                    {b.pages.map((x) => (x.missing ? (
                      <tr key={x.url}><td style={{ ...td, fontSize: 12 }}>{host(x.url)}</td><td colSpan={8} style={{ ...td, fontSize: 12, color: C.muted }}>Skipped: {x.missing}</td></tr>
                    ) : (
                      <tr key={x.url}>
                        <td style={{ ...td, fontSize: 12, whiteSpace: 'nowrap' }} title={x.h1 ? `H1: ${x.h1}` : ''}>{x.domain}</td>
                        <td style={{ ...tdNum, fontSize: 12 }}>{num(x.wordCount)}{x.truncated ? '+' : ''}</td>
                        <td style={{ ...tdNum, fontSize: 12 }}>{x.h2}</td>
                        <td style={{ ...tdNum, fontSize: 12 }}>{x.questionHeadings}/{x.subHeadings}</td>
                        <td style={{ ...tdNum, fontSize: 12 }}>{x.stats}</td>
                        <td style={{ ...tdNum, fontSize: 12 }}>{x.extLinks}</td>
                        <td style={{ ...td, fontSize: 12 }}>{x.tables ? 'Yes' : '·'}</td>
                        <td style={{ ...td, fontSize: 12 }}>{x.hasFAQ ? 'Yes' : '·'}</td>
                        <td style={{ ...td, fontSize: 12, whiteSpace: 'nowrap' }}>{x.lastUpdated || '·'}</td>
                      </tr>
                    )))}
                  </tbody>
                </table>
              </div>
              <div style={{ fontSize: 11, color: C.muted, marginTop: 6 }}>Measured on Peec's stored snapshot of each page; word counts include some site chrome. “+” = snapshot cut at 60k characters.</div>
            </div>
            <div style={{ minWidth: 0, fontSize: 13, lineHeight: 1.55 }}>
              <div style={eyebrow}>Why this prompt</div>
              <p style={{ margin: '4px 0 12px' }}>{b.signal}. Score {b.score} = {GAP_LABEL[b.gapType]}{b.parts.volPts ? ` + ${b.parts.volPts} volume` : ''}{b.parts.intentPts ? ' + 1 commercial intent' : ''}. {b.gapUrlCount >= 100 ? '100+' : b.gapUrlCount} cited URLs in 30 days mention a competitor and not Mutiny.</p>
              <div style={eyebrow}>Winning shape</div>
              <p style={{ margin: '4px 0 8px' }}>{p.summary}</p>
              {p.analyzed > 0 && (
                <ul style={{ margin: '0 0 12px', paddingLeft: 18 }}>
                  <li>Target about <b>{num(p.targetWords)} words</b>, shaped as {SHAPE[p.dominantType] || 'a page'} with the H1 phrased as the query.</li>
                  <li>Open every H2 with a 40 to 60 word direct answer ({p.directAnswerOpeners} of {p.analyzed} winners do this consistently{p.directAnswerOpeners <= p.analyzed / 2 ? ', so it is an edge' : ''}).</li>
                  <li>{p.withTable >= Math.ceil(p.analyzed / 2) ? 'Include a comparison table.' : 'A comparison table is optional here.'} {p.withFAQ >= Math.ceil(p.analyzed / 2) ? 'Close with an FAQ (up to 9 Q&As).' : 'Add an FAQ to beat the pack (most winners skip it).'}</li>
                  <li>At least {Math.max(5, p.medianStats || 0)} sourced stats and {Math.max(5, p.medianExtLinks || 0)} outbound citations.</li>
                </ul>
              )}
              {p.sharedSources?.length > 0 && (<><div style={eyebrow}>Sources the winners cite</div><p style={{ margin: '4px 0 12px' }}>{p.sharedSources.map((s) => `${s.domain} (${s.pages})`).join(' · ')}</p></>)}
              <div style={eyebrow}>Internal Mutiny links (already cited by AI)</div>
              <ul style={{ margin: '4px 0 12px', paddingLeft: 18 }}>
                {b.internalLinks.slice(0, 5).map((l) => <li key={l.url}><A href={l.url}>{l.title}</A> <span style={{ color: C.muted, fontSize: 11.5 }}>{l.citations} cites</span></li>)}
              </ul>
              {N.lean?.[b.topic] && (<><div style={eyebrow}>Mutiny lean</div><p style={{ margin: '4px 0 12px' }}>{N.lean[b.topic]}</p></>)}
              <div style={eyebrow}>{b.role === 'anchor' ? 'Anchor piece' : 'Supplementary piece'}</div>
              <p style={{ margin: '4px 0 0' }}>
                {b.role === 'anchor'
                  ? (b.supplementary?.length ? <>Link out to: {b.supplementary.map((s) => `“${s}”`).join(', ')}.</> : 'First piece for this topic; future pieces link back here.')
                  : <>Link back to the anchor: “{b.anchor}”.</>}
              </p>
              {missing.length > 0 && <p style={{ margin: '10px 0 0', fontSize: 12, color: C.muted }}>{missing.length} of 5 top pages not analyzed ({missing.map((x) => `${host(x.url)}: ${x.missing}`).join('; ')}).</p>}
            </div>
          </div>
        </div>
      )}
    </article>
  );
}

function Backlog() {
  const B = aeo.backlog;
  const [topic, setTopic] = useState('all');
  const [status, setStatus] = useState('gaps');
  // The tour can set filters: window event 'aeo:backlog' with detail {topic?, status?}.
  React.useEffect(() => {
    const on = (e) => { const d = e.detail || {}; if (d.topic) setTopic(d.topic); if (d.status) setStatus(d.status); };
    window.addEventListener('aeo:backlog', on);
    return () => window.removeEventListener('aeo:backlog', on);
  }, []);
  const briefs = B.briefs.filter((b) => topic === 'all' || b.topic === topic);
  const counts = useMemo(() => {
    const c = { all: B.briefs.length };
    TOPIC_ORDER.forEach((k) => { c[k] = B.briefs.filter((b) => b.topic === k).length; });
    return c;
  }, [B]);
  const rows = B.prompts.filter((p) => (topic === 'all' || p.topic === topic) && (status === 'all' || (status === 'gaps' ? p.status === 'absent' || p.status === 'weak' : p.status === status)));
  const st = B.prompts.reduce((a, p) => { a[p.status] = (a[p.status] || 0) + 1; return a; }, {});
  const wins = B.wins.filter((w) => topic === 'all' || w.topic === topic);
  return (
    <>
      <div data-tour="backlog" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
        <TopicFilter value={topic} onChange={setTopic} counts={counts} />
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {Object.entries(STATUS).map(([k, s]) => <Chip key={k} bg={s.bg} title={s.help}>{s.label} {st[k] || 0}</Chip>)}
        </div>
      </div>
      <div style={{ display: 'grid', gap: 12 }}>
        {briefs.length ? briefs.map((b, i) => <Brief key={b.id} b={b} rank={i + 1} />) : <Card><span style={{ color: C.muted }}>No backlog picks for this topic this week.</span></Card>}
      </div>

      <div className="aeo-g2" style={{ display: 'grid', gridTemplateColumns: 'minmax(0,2fr) minmax(0,1fr)', gap: 16, marginTop: 16 }}>
        <Card tour="prompts" title="Every tracked prompt" sub={`${B.evaluated} prompts scored on the last 30 days (${span(aeo.windows.backlog)})`}
          right={
            <select value={status} onChange={(e) => setStatus(e.target.value)} style={{ fontFamily: FONT_BODY, fontSize: 12.5, fontWeight: 700, border: `1px solid ${C.black}`, borderRadius: 6, padding: '4px 6px', background: C.white }}>
              <option value="gaps">Gaps (absent + weak)</option><option value="all">All statuses</option>
              {Object.entries(STATUS).map(([k, s]) => <option key={k} value={k}>{s.label}</option>)}
            </select>
          }
          footnote="Score (spec Step 5): +4 Mutiny absent from the top 5 cited URLs with 2+ citing competitors, +3 with 1, +2 with none (capture); +1 if Mutiny is on a top-5 page but in under 10% of answers; +2 high or very high volume, +1 medium; +1 commercial intent (Peec tag). Comp = top-5 URLs that mention a tracked competitor.">
          <div style={{ overflowX: 'auto', marginTop: 12, maxHeight: 520, overflowY: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead style={{ position: 'sticky', top: 0, background: C.white }}><tr><th style={th}>Prompt</th><th style={th}>Topic</th><th style={th}>Volume</th><th style={thNum}>Mutiny</th><th style={th}>Status</th><th style={thNum}>Comp</th><th style={thNum}>Score</th></tr></thead>
              <tbody>
                {rows.map((p) => (
                  <tr key={p.id}>
                    <td style={{ ...td, minWidth: 220 }}>{p.text}{B.briefs.some((b) => b.id === p.id) && <Chip bg={C.purple} style={{ marginLeft: 6, fontSize: 10, padding: '0 6px' }}>brief</Chip>}</td>
                    <td style={{ ...td, whiteSpace: 'nowrap', fontSize: 12 }}>{topicName(p.topic)}</td>
                    <td style={{ ...td, whiteSpace: 'nowrap', fontSize: 12 }}>{p.volume}</td>
                    <td style={tdNum}>{pct(p.mutinyVis, 0)}</td>
                    <td style={td}><Chip bg={STATUS[p.status].bg} title={STATUS[p.status].help} style={{ fontSize: 10.5 }}>{STATUS[p.status].label}</Chip></td>
                    <td style={tdNum}>{p.compUrls}/5</td>
                    <td style={{ ...tdNum, fontWeight: 800 }}>{p.score}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
        <Card tour="wins" title="Where Mutiny is winning" sub="Mentioned in at least half of AI answers (30 days)">
          <ol style={{ listStyle: 'none', padding: 0, margin: '12px 0 0' }}>
            {wins.map((w) => (
              <li key={w.id} style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 8, padding: '8px 0', borderBottom: `1px solid ${C.lightGrey}`, fontSize: 13 }}>
                <span>{w.text}<div style={{ fontSize: 11.5, color: C.muted }}>{topicName(w.topic)} · {w.volume} volume · position {w.mutinyPos?.toFixed(1)}</div></span>
                <b style={{ ...tabular, color: C.up }}>{pct(w.mutinyVis, 0)}</b>
              </li>
            ))}
            {!wins.length && <li style={{ color: C.muted, fontSize: 13, padding: '8px 0' }}>No prompt above 50% in this topic.</li>}
          </ol>
          {N.backlogNote && <p style={{ fontSize: 12, color: C.muted, lineHeight: 1.5, margin: '14px 0 0' }}>{N.backlogNote}</p>}
        </Card>
      </div>
    </>
  );
}

// --- Page --------------------------------------------------------------------------------------
const AEO_CSS = `
.aeo-tour-btn:hover{box-shadow:4px 4px 0 #000!important}.aeo-tour-btn:focus-visible{outline:2px solid #000;outline-offset:2px}
@media (max-width: 1100px){.aeo-kpis{grid-template-columns:repeat(3,minmax(0,1fr))!important}.aeo-g2,.aeo-brief{grid-template-columns:minmax(0,1fr)!important}}
@media (max-width: 760px){.aeo-kpis{grid-template-columns:repeat(2,minmax(0,1fr))!important}.aeo-eng{grid-template-columns:minmax(0,1fr)!important}.aeo-topics{grid-template-columns:minmax(0,1fr)!important}}
`;

export default function AeoSection() {
  const W = aeo.windows;
  const pulled = aeo.pulledAt ? md(aeo.pulledAt.slice(0, 10)) : '·';
  // Beginner tour (Nick, Oct 27): button in the viewing bar; "Start here" badge until finished once.
  const [tourOpen, setTourOpen] = useState(false);
  const [tourDone, setTourDone] = useState(() => { try { return window.localStorage.getItem(TOUR_DONE_KEY) === '1'; } catch (e) { return false; } });
  const closeTour = React.useCallback(() => { setTourOpen(false); try { setTourDone(window.localStorage.getItem(TOUR_DONE_KEY) === '1'); } catch (e) { /* ignore */ } }, []);
  return (
    <div style={{ fontFamily: FONT_BODY, color: C.black }}>
      <style>{AEO_CSS}</style>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', padding: '16px 24px', border: `1px solid ${C.black}`, borderRadius: 4, background: C.lightPurple }}>
        <span style={{ background: C.black, color: C.white, borderRadius: 999, padding: '4px 12px', fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' }}>Viewing</span>
        <span style={{ fontFamily: FONT_DISPLAY, fontSize: 26, letterSpacing: '-0.03em', lineHeight: 1.1 }}>AEO: AI search visibility</span>
        <span style={{ marginLeft: 'auto', fontSize: 13, fontWeight: 600 }}>{span(W.cur)} vs {span(W.prev)} · Peec, pulled {pulled}</span>
        <button type="button" onClick={() => setTourOpen(true)} className="aeo-tour-btn"
          style={{ all: 'unset', boxSizing: 'border-box', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 8, border: `1px solid ${C.black}`, borderRadius: 999, padding: '7px 14px', background: C.green, fontSize: 13, fontWeight: 800, boxShadow: `2px 2px 0 ${C.black}` }}>
          <GraduationCap size={16} strokeWidth={2.2} /> New to AEO? Take the tour
          {!tourDone && <span style={{ background: C.black, color: C.white, borderRadius: 999, padding: '1px 7px', fontSize: 10.5, letterSpacing: '0.06em', textTransform: 'uppercase' }}>Start here</span>}
        </button>
      </div>
      <AeoTour open={tourOpen} onClose={closeTour} />

      <div style={{ marginTop: 24 }}><Summary /></div>

      <SectionTitle kicker="Weekly report" title="Who AI engines mention" sub="Visibility across ChatGPT, Google AI Overview and Perplexity for every tracked prompt. This week is the last 7 complete days; last week is the 7 days before." />
      <div className="aeo-g2" style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.15fr) minmax(0,1fr)', gap: 16 }}>
        <Landscape />
        <Engines />
      </div>

      <SectionTitle kicker="Weekly report" title="Topic by topic" sub="Mutiny's numbers in each of the five tracked topics, with the brands leading it." />
      <div className="aeo-topics" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))', gap: 16 }}>
        {TOPIC_ORDER.map((k) => aeo.topics.find((t) => t.key === k)).filter(Boolean).map((t, k) => <TopicCard key={t.key} t={t} tour={k === 0 ? 'topics' : undefined} />)}
      </div>

      <SectionTitle kicker="Weekly report" title="Domains and sources" sub="Which sites AI engines pull from, and which pages they cite." />
      <div className="aeo-g2" style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)', gap: 16 }}>
        <Domains />
        <div style={{ display: 'grid', gap: 16 }}>
          <UrlList tour="urls" title="Most cited URLs" sub={span(W.cur)} rows={aeo.topCitedUrls.slice(0, 10)} showBrands />
        </div>
      </div>
      <div style={{ marginTop: 16 }}>
        <UrlList title="Mutiny's most cited pages" sub={`mutinyhq.com, ${span(W.cur)}`} rows={aeo.mutinyTopUrls} />
      </div>

      <SectionTitle kicker="Weekly report" title="Opportunities" sub="Peec's highest-impact open actions, with how each ties to this week's numbers." />
      <Opportunities />

      {N.takeaways?.length > 0 && (
        <>
          <SectionTitle kicker="Weekly report" title="Key takeaways and focus" />
          <Card tour="takeaways" style={{ background: C.white }}>
            <ol style={{ margin: 0, paddingLeft: 22, fontSize: 14.5, lineHeight: 1.6 }}>
              {N.takeaways.map((t) => <li key={t} style={{ marginBottom: 8 }}>{t}</li>)}
            </ol>
          </Card>
        </>
      )}

      <SectionTitle kicker="Content backlog" title="Prompts where Mutiny is losing"
        sub={`${aeo.backlog.evaluated} tracked prompts across the five topics, scored on the last 30 days. The top ${aeo.backlog.briefs.length} get a brief: why the prompt, the top 5 cited URLs, the shape of the pages that win, and how to position Mutiny. One anchor per topic; the rest are supplementary pieces that link back to it.`} />
      <Backlog />

      <div style={{ fontFamily: FONT_CAPTION, fontStyle: 'italic', fontSize: 12, color: C.muted, marginTop: 40, lineHeight: 1.6 }}>
        Source: Peec AI project “Mutiny 2.0” ({aeo.projectId}), engines ChatGPT, Google AI Overview and Perplexity. Weekly report {span(W.cur)} vs {span(W.prev)}; backlog {span(W.backlog)}. Pulled {pulled}. Written notes: {N.asOf || 'not refreshed'}.
        {' '}<A href="https://app.peec.ai" style={{ fontStyle: 'normal' }}>Open Peec <ExternalLink size={11} style={{ verticalAlign: '-1px' }} /></A>
      </div>
    </div>
  );
}
