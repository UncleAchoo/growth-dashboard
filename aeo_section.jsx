// ---------------------------------------------------------------------------
// AEO section (Nick, Oct 27 2026; reworked Oct 28 after Matt's handoff and
// Jon's Peec reset). Only rendered with ?aeo (see beta_dashboard.jsx).
//
// Framing follows Matt Ratchford's AEO model:
//   * Retrieval → citation → visibility ladder (read → linked → named)
//   * Compare Mutiny within a topic, never topics against each other
//   * Sentiment ~50 is neutral; head terms barely move, niche prompts do
//   * Priority 1 = fix CRO / website-personalization positioning
//   * Off-site "currency exchange": get onto the top 50 retrieved URLs
//   * Jaleh gets what we did, WoW visibility, directional signups, what's next
// Sections: summary + ladder, Jaleh summary, competition (by topic), engines,
// topic cards, CRO positioning watch, domains + URLs, outreach roadmap,
// Peec actions, takeaways, content backlog with briefs.
// Data: src/aeo.json (scripts/build-aeo.mjs from data/aeo/raw/* via the Peec
// MCP, see data/aeo/REFRESH.md) + data/aeo/narrative.json.
// ---------------------------------------------------------------------------
import React, { useMemo, useState } from 'react';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';
import { ArrowUpRight, ArrowDownRight, ChevronDown, ExternalLink, Info, GraduationCap, AlertTriangle, Copy, Check } from 'lucide-react';
import AeoTour, { TOUR_DONE_KEY } from './aeo_tour.jsx';
import aeo from './src/aeo.json';
import { AskClaude, PageAsk, ctx } from './aeo_ask.jsx';
// Deep links into the Peec app (src/aeo.json → peecLinks, from data/aeo/raw/peec_links.json).
const PEEC = aeo.peecLinks || {};

const C = {
  purple: '#A73BF5', green: '#B2FF14', red: '#FB5A3D', blue: '#96ECFF',
  lightPurple: '#F2D1FC', lightBlue: '#BCEEFD', lightRed: '#FF9987', lightGreen: '#D2FD78',
  black: '#000000', lightGrey: '#EFEFEF', white: '#FFFFFF', paper: '#FAF8F4',
  muted: 'rgba(0,0,0,0.55)', grid: '#E6E6E6', up: '#1E8A3A', down: '#E0401F', amber: '#FFE3A3',
};
const FONT_DISPLAY = "'Fraunces', 'Reckless Condensed S', Georgia, serif";
const FONT_BODY = "'Manrope', 'KMR Waldenburg', Arial, sans-serif";
const FONT_CAPTION = "'Fraunces', 'Affix', Georgia, serif";
const tabular = { fontVariantNumeric: 'tabular-nums' };
const eyebrow = { fontFamily: FONT_BODY, fontSize: 10.5, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: C.muted };

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const md = (iso) => { const d = new Date(`${iso}T00:00:00Z`); return `${MON[d.getUTCMonth()]} ${d.getUTCDate()}`; };
const span = (w) => (!w ? '' : w.start === w.end ? md(w.start) : `${md(w.start)} to ${md(w.end)}`);
const pct = (v, dp = 1) => (v == null ? '·' : `${(v * 100).toFixed(dp)}%`);
const num = (v) => (v == null ? '·' : v.toLocaleString());
const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch (e) { return u; } };
const shortUrl = (u) => { try { const x = new URL(u); return `${x.hostname.replace(/^www\./, '')}${x.pathname === '/' ? '' : x.pathname}`; } catch (e) { return u; } };
const TOPICS = aeo.topics || [];
const TOPIC_ORDER = TOPICS.map((t) => t.key);
const TOPIC_COLOR = Object.fromEntries(TOPICS.map((t) => [t.key, t.color]));
const topicName = (k) => TOPICS.find((t) => t.key === k)?.name || k;
const N = aeo.narrative || {};
const HAS_PREV = Boolean(aeo.windows?.prev);

// Delta chip. kind: 'pts' (ratio → percentage points), 'num', 'pos' (lower is better).
// Renders nothing when there is no comparable prior window yet.
function Delta({ cur, prev, kind = 'pts', size = 12.5 }) {
  if (cur == null || prev == null) return null;
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

function PeecLink({ href, label = 'Open in Peec' }) {
  if (!href) return null;
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" title="Open the matching view in Peec"
      style={{ display: 'inline-flex', alignItems: 'center', gap: 4, border: `1px solid ${C.black}`, borderRadius: 999, padding: '3px 10px', fontSize: 12, fontWeight: 700, color: C.black, textDecoration: 'none', background: C.white, whiteSpace: 'nowrap' }}>
      {label} <ExternalLink size={11} />
    </a>
  );
}

function Card({ title, sub, children, footnote, style, right, tour, ask, peec }) {
  const [note, setNote] = useState(false);
  return (
    <article data-tour={tour} style={{ background: C.white, border: `1px solid ${C.black}`, borderRadius: 4, padding: '24px 26px 20px', minWidth: 0, display: 'flex', flexDirection: 'column', ...style }}>
      {(title || right || ask || peec) && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ minWidth: 0, flex: '1 1 260px' }}>
            {title && <h3 style={{ fontFamily: FONT_BODY, fontSize: 16, fontWeight: 700, lineHeight: 1.35, margin: 0 }}>{title}</h3>}
            {sub && <div style={{ color: C.muted, fontSize: 12.5, marginTop: 4, lineHeight: 1.5 }}>{sub}</div>}
          </div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
            {right}
            {peec && <PeecLink href={peec} />}
            {ask && <AskClaude section={ask.section} context={ask.context} suggestions={ask.suggestions} compact />}
          </div>
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

// learn = { what, why, how }: short beginner notes under a section heading (Nick, Oct 28).
function SectionTitle({ kicker, title, sub, learn }) {
  return (
    <div style={{ margin: '48px 0 16px' }}>
      {kicker && <div style={eyebrow}>{kicker}</div>}
      <h2 style={{ fontFamily: FONT_DISPLAY, fontWeight: 400, fontSize: 30, letterSpacing: '-0.03em', lineHeight: 1.1, margin: '4px 0 0' }}>{title}</h2>
      {sub && <div style={{ color: C.muted, fontSize: 13.5, marginTop: 6, maxWidth: 900, lineHeight: 1.5 }}>{sub}</div>}
      {learn && (
        <div className="aeo-learn" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0,1fr))', gap: 10, marginTop: 12, maxWidth: 1200 }}>
          {[['What you\'re looking at', learn.what], ['Why it matters', learn.why], ['How to use it', learn.how]].filter(([, t]) => t).map(([h, t]) => (
            <div key={h} style={{ borderLeft: `3px solid ${C.purple}`, background: C.white, padding: '8px 12px', fontSize: 12.5, lineHeight: 1.5 }}>
              <div style={{ ...eyebrow, color: C.black, marginBottom: 2 }}>{h}</div>{t}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const Chip = ({ children, bg = C.white, title, style }) => (
  <span title={title} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, border: `1px solid ${C.black}`, borderRadius: 999, padding: '2px 9px', fontSize: 11.5, fontWeight: 700, background: bg, whiteSpace: 'nowrap', ...style }}>{children}</span>
);
const Bar = ({ value, max, color = C.purple }) => (
  <div style={{ height: 8, background: C.lightGrey, borderRadius: 2, overflow: 'hidden', minWidth: 60 }}>
    <div style={{ width: `${Math.min(100, max ? (value / max) * 100 : 0)}%`, height: '100%', background: color }} />
  </div>
);
const th = { textAlign: 'left', fontSize: 10.5, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: C.muted, padding: '0 10px 8px 0', borderBottom: `1px solid ${C.black}`, whiteSpace: 'nowrap' };
const td = { padding: '8px 10px 8px 0', borderBottom: `1px solid ${C.lightGrey}`, fontSize: 13, verticalAlign: 'top' };
const tdNum = { ...td, ...tabular, textAlign: 'right', whiteSpace: 'nowrap' };
const thNum = { ...th, textAlign: 'right' };
const A = ({ href, children, style }) => (
  <a href={href} target="_blank" rel="noopener noreferrer" style={{ color: C.black, textDecorationColor: '#9A9A9A', textUnderlineOffset: 3, ...style }}>{children}</a>
);
const Note = ({ children, bg = C.paper, icon }) => (
  <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '12px 14px', background: bg, border: `1px solid ${C.black}`, borderRadius: 4, fontSize: 13.5, lineHeight: 1.55 }}>
    {icon}<div>{children}</div>
  </div>
);
function Seg({ value, onChange, options }) {
  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
      {options.map(([k, label, bg]) => (
        <button key={k} type="button" onClick={() => onChange(k)} aria-pressed={value === k}
          style={{ border: `1px solid ${C.black}`, borderRadius: 999, padding: '4px 11px', fontFamily: FONT_BODY, fontSize: 12, fontWeight: 700, cursor: 'pointer', background: value === k ? C.black : (bg || C.white), color: value === k ? C.white : C.black }}>
          {label}
        </button>
      ))}
    </div>
  );
}
const topicOptions = (allLabel = 'All topics') => [['all', allLabel], ...TOPICS.map((t) => [t.key, t.name, t.color])];

// --- Reset banner ------------------------------------------------------------------------
function ResetBanner() {
  const L = aeo.legacy; const P = aeo.promptSet;
  if (!P) return null;
  return (
    <div style={{ marginTop: 16 }}>
      <Note bg={C.amber} icon={<AlertTriangle size={18} strokeWidth={2.2} style={{ flexShrink: 0, marginTop: 2 }} />}>
        <b>New Peec prompt set since {md(P.since)}.</b> {P.prompts} prompts across {P.topics} topics and {P.brands} brands, aligned to the AI sales assistant positioning. Everything below is the new baseline{aeo.partial ? ` (${span(aeo.windows.cur)}, first day of data)` : ''}, so there are no week-over-week arrows until a full comparable week exists.
        {L && <span style={{ display: 'block', marginTop: 6, color: C.muted, fontSize: 12.5 }}>For reference only: on the old {L.prompts}-prompt set ({span(L.window)}) Mutiny was #{L.rank} of {L.brands} at {pct(L.mutiny.visibility)} visibility. Different prompts, so not comparable.</span>}
      </Note>
    </div>
  );
}

// --- 1. Summary + ladder ---------------------------------------------------------------------
function Ladder() {
  const L = aeo.mutiny.ladder;
  const steps = [
    { key: 'retrieved', label: 'Retrieved', sub: 'AI read our pages', v: L.retrieved, p: L.retrievedPrev, help: `Share of AI chats that pulled at least one mutinyhq.com page while researching (Matt: "you're in the game"). mutinyhq.com is the #${L.domainRank} most-read domain.` },
    { key: 'cited', label: 'Cited', sub: 'AI linked our page', v: L.cited, p: L.citedPrev, help: 'Share of chats that link a mutinyhq.com page inside the answer (Matt: "you\'re relevant").' },
    { key: 'visibility', label: 'Visible', sub: 'AI named Mutiny', v: L.visibility, p: L.visibilityPrev, help: 'Share of AI answers that name Mutiny (Matt: "you\'re recommended"). The highest-intent outcome and the hardest to move.' },
  ];
  const max = Math.max(...steps.map((s) => s.v || 0), 0.0001);
  return (
    <div data-tour="ladder" className="aeo-ladder" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0,1fr))', gap: 0, border: `1px solid ${C.black}`, borderRadius: 4, overflow: 'hidden' }}>
      {steps.map((s, i) => (
        <div key={s.key} title={s.help} style={{ padding: '14px 18px', background: i === 2 ? C.lightPurple : C.paper, position: 'relative' }}>
          <div style={eyebrow}>{i + 1}. {s.label}</div>
          <div style={{ ...tabular, fontFamily: FONT_DISPLAY, fontSize: 34, letterSpacing: '-0.03em', lineHeight: 1.05, margin: '6px 0 4px' }}>{pct(s.v)}</div>
          <div style={{ fontSize: 12.5, color: C.muted, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>{s.sub} <Delta cur={s.v} prev={s.p} /></div>
          <div style={{ marginTop: 8 }}><Bar value={s.v || 0} max={max} color={i === 2 ? C.purple : '#9A9A9A'} /></div>
        </div>
      ))}
    </div>
  );
}

const KPIS = [
  { key: 'mentions', label: 'Mentions', kind: 'num', fmt: num, help: 'Times Mutiny was named across all answers.' },
  { key: 'sov', label: 'Share of voice', kind: 'pts', fmt: pct, help: "Mutiny's share of all tracked-brand mentions." },
  { key: 'sentiment', label: 'Sentiment', kind: 'num', fmt: (v) => v, help: 'About 50 is neutral; higher is more positive. Mostly driven by reviews and community posts (G2, Reddit).' },
  { key: 'position', label: 'Avg position', kind: 'pos', fmt: (v) => v?.toFixed(1), help: 'Where Mutiny appears when named. Lower is better (1 = named first).' },
  { key: 'rank', label: 'Rank (all brands)', kind: 'none', fmt: (v) => `#${v} of ${aeo.brands.length}`, help: 'Overall rank mixes categories; compare within topics below.' },
];
function Summary() {
  const m = aeo.mutiny.cur; const p = aeo.mutiny.prev;
  return (
    <Card style={{ padding: '28px 30px 22px' }} peec={PEEC.overview} ask={{ section: 'Executive summary', context: ctx.summary, suggestions: ['Explain these numbers like I am new to AEO.', 'Why is our cited rate so much lower than our retrieved rate, and how do we fix it?', 'Is 1.9% visibility bad? How should I think about it?'] }}>
      <div style={eyebrow}>Executive summary</div>
      <p data-tour="summary" style={{ fontFamily: FONT_DISPLAY, fontSize: 21, lineHeight: 1.4, letterSpacing: '-0.01em', margin: '10px 0 20px', maxWidth: 1080 }}>{N.summary}</p>
      <div style={{ ...eyebrow, marginBottom: 6 }}>The ladder: read → linked → named</div>
      <Ladder />
      <div data-tour="kpis" className="aeo-kpis" style={{ display: 'grid', gridTemplateColumns: 'repeat(5, minmax(0,1fr))', gap: 10, marginTop: 12 }}>
        {KPIS.map((k) => (
          <div key={k.key} title={k.help} style={{ border: `1px solid ${C.black}`, borderRadius: 4, padding: '10px 14px', background: C.white }}>
            <div style={eyebrow}>{k.label}</div>
            <div style={{ ...tabular, fontFamily: FONT_DISPLAY, fontSize: 24, letterSpacing: '-0.02em', margin: '4px 0 2px' }}>{k.fmt(m?.[k.key])}</div>
            {k.kind !== 'none' && p && <div style={{ fontSize: 12, color: C.muted }}>was {k.fmt(p[k.key])} <Delta cur={m[k.key]} prev={p[k.key]} kind={k.kind} size={11.5} /></div>}
            {k.key === 'sentiment' && <div style={{ fontSize: 11.5, color: C.muted }}>50 = neutral</div>}
          </div>
        ))}
      </div>
    </Card>
  );
}

// --- 2. Jaleh summary ---------------------------------------------------------------------------
function jalehText() {
  const J = aeo.jaleh || {}; const w = J.weeks || []; const last = w[w.length - 1]; const prev = w[w.length - 2];
  const m = aeo.mutiny.cur; const p = aeo.mutiny.prev;
  const vis = p ? `${pct(p.visibility)} to ${pct(m.visibility)}` : `${pct(m.visibility)} (new baseline, Peec reset ${md(aeo.promptSet?.since || aeo.windows.cur.start)})`;
  const lines = [
    `AEO update, week of ${last ? span(last) : span(aeo.windows.cur)}`,
    '',
    'What we did:', ...(J.did || []).map((x) => `- ${x}`),
    '',
    `Visibility: ${vis}. Mutiny is #${m.rank} of ${aeo.brands.length} tracked brands.`,
    last ? `Signups from AI (self-reported, directional): ${last.aeo} named an AI tool${prev ? ` (prior week ${prev.aeo})` : ''}; ${last.searchAeo} said search or AI${prev ? ` (prior week ${prev.searchAeo})` : ''}.${last.aiVisitors != null ? ` AI referral visitors: ${last.aiVisitors}${prev ? ` (prior week ${prev.aiVisitors})` : ''}.` : ''}` : null,
    '',
    "What's next:", ...(J.next || []).map((x) => `- ${x}`),
    J.ask ? `\nInput needed: ${J.ask}` : null,
  ].filter((x) => x != null);
  return lines.join('\n');
}
function JalehCard() {
  const J = aeo.jaleh || {}; const w = J.weeks || []; const last = w[w.length - 1]; const prev = w[w.length - 2];
  const [copied, setCopied] = useState(false);
  const copy = () => { try { navigator.clipboard.writeText(jalehText()).then(() => setCopied(true), () => {}); } catch (e) { /* ignore */ } };
  const max = Math.max(...w.map((x) => x.searchAeo), 1);
  return (
    <Card tour="jaleh" title="Weekly update for Jaleh" sub="Matt's format: what we did, how visibility moved, a directional read on signups from AI, and what's next. AI tools rarely pass referral data, so signups here are self-reported and show direction, never exact attribution." ask={{ section: 'Weekly update for Jaleh', context: ctx.jaleh, suggestions: ['Rewrite this update in three sentences for an exec.', 'What do the AI signup numbers tell us, and what can they not tell us?'] }}
      right={<button type="button" onClick={copy} style={{ all: 'unset', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6, border: `1px solid ${C.black}`, borderRadius: 6, padding: '6px 12px', fontSize: 12.5, fontWeight: 700, background: copied ? C.lightGreen : C.white, boxShadow: `2px 2px 0 ${C.black}` }}>{copied ? <Check size={14} /> : <Copy size={14} />}{copied ? 'Copied' : 'Copy as message'}</button>}
      footnote="Signups: self-reported 'How did you hear about us?' answers on counted sign ups (never-completed and internal accounts excluded), bucketed with the shared channel rules. AEO = named an AI tool; Search + AI = AEO plus search answers (Matt: combining them is the best proxy because AI tools rarely pass a referrer). AI referral visitors = Framer visitors in the AI Referrals channel. All directional.">
      <div className="aeo-g2" style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)', gap: 20, marginTop: 14, fontSize: 13.5, lineHeight: 1.55 }}>
        <div>
          <div style={eyebrow}>What we did</div>
          <ul style={{ margin: '4px 0 12px', paddingLeft: 18 }}>{(J.did || []).map((x) => <li key={x}>{x}</li>)}</ul>
          <div style={eyebrow}>What's next</div>
          <ul style={{ margin: '4px 0 12px', paddingLeft: 18 }}>{(J.next || []).map((x) => <li key={x}>{x}</li>)}</ul>
          {J.ask && <><div style={eyebrow}>Input needed from Jaleh</div><p style={{ margin: '4px 0 0' }}>{J.ask}</p></>}
        </div>
        <div>
          <div style={eyebrow}>Visibility</div>
          <p style={{ margin: '4px 0 12px' }}><b>{pct(aeo.mutiny.cur.visibility)}</b>{aeo.mutiny.prev ? <> (was {pct(aeo.mutiny.prev.visibility)}) <Delta cur={aeo.mutiny.cur.visibility} prev={aeo.mutiny.prev.visibility} /></> : <span style={{ color: C.muted }}> · new baseline since the Peec reset</span>}</p>
          <div style={eyebrow}>Signups from AI, self-reported (last 8 weeks)</div>
          <div style={{ display: 'grid', gridTemplateColumns: `repeat(${w.length}, minmax(0,1fr))`, gap: 4, alignItems: 'end', height: 90, marginTop: 8 }}>
            {w.map((x) => (
              <div key={x.start} title={`${span(x)}: ${x.aeo} named an AI tool, ${x.searchAeo} search or AI, ${x.aiVisitors ?? '?'} AI referral visitors, ${x.signups} sign ups`} style={{ display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', height: '100%' }}>
                <div style={{ background: C.lightBlue, height: `${(Math.max(0, x.searchAeo - x.aeo) / max) * 70}px`, borderTop: `1px solid ${C.black}` }} />
                <div style={{ background: C.purple, height: `${(x.aeo / max) * 70}px` }} />
                <div style={{ fontSize: 9.5, color: C.muted, textAlign: 'center', marginTop: 3 }}>{md(x.start)}</div>
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 12, fontSize: 11.5, color: C.muted, marginTop: 6, flexWrap: 'wrap' }}>
            <span><span style={{ display: 'inline-block', width: 9, height: 9, background: C.purple, marginRight: 4 }} />Named an AI tool</span>
            <span><span style={{ display: 'inline-block', width: 9, height: 9, background: C.lightBlue, border: '1px solid #000', marginRight: 4 }} />Search</span>
          </div>
          {last && <p style={{ margin: '8px 0 0', fontSize: 13 }}>Last full week ({span(last)}): <b>{last.aeo}</b> named an AI tool{prev ? ` (prior ${prev.aeo})` : ''}, <b>{last.searchAeo}</b> search or AI{prev ? ` (prior ${prev.searchAeo})` : ''}{last.aiVisitors != null ? <>, <b>{last.aiVisitors}</b> AI referral visitors{prev ? ` (prior ${prev.aiVisitors})` : ''}</> : null}.</p>}
        </div>
      </div>
    </Card>
  );
}

// --- 3. Competition (within topic) --------------------------------------------------------------
function Landscape() {
  const [topic, setTopic] = useState('all');
  const rows = topic === 'all'
    ? aeo.brands.map((b) => ({ name: b.name, own: b.own, visibility: b.visibility, sov: b.sov, position: b.position, rank: b.rank, prev: b.prev, best: b.bestTopic?.key }))
    : (TOPICS.find((t) => t.key === topic)?.brands || []).map((b) => ({ name: b.brand, own: b.brand === 'Mutiny', visibility: b.visibility, sov: b.sov, position: b.position, rank: b.rank, prev: b.prev }));
  const t = TOPICS.find((x) => x.key === topic);
  const mutinyMissing = topic !== 'all' && !rows.some((r) => r.own);
  const max = Math.max(...rows.map((b) => b.visibility), 0.0001);
  return (
    <Card tour="landscape" title="Who AI engines name" sub={topic === 'all' ? `Each brand's visibility: the share of AI answers that name it, across all six topics (${span(aeo.windows.cur)}). The overall list mixes categories, so pick a topic to compare like with like.` : `${t?.name}: brands named in at least one answer in this topic (${span(aeo.windows.cur)}). This is the race that matters for this conversation.`}
      peec={topic === 'all' ? PEEC.brands : (PEEC.topics?.[topic] || PEEC.brands)} ask={{ section: topic === 'all' ? 'Who AI engines name (all topics)' : `Who AI engines name: ${t?.name}`, context: () => ctx.landscape(topic === 'all' ? null : topic), suggestions: ['Who are our real competitors here, and why do they rank above us?', 'What would it take to move up two places?'] }}
      footnote="Visibility = share of AI answers (ChatGPT, Google AI Overview, Perplexity) that name the brand. Matt: compare within a topic, because topics differ in how many brands get named.">
      <div style={{ margin: '12px 0 4px' }}><Seg value={topic} onChange={setTopic} options={topicOptions('All brands')} /></div>
      <div style={{ overflowX: 'auto', marginTop: 10, maxHeight: 560, overflowY: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead style={{ position: 'sticky', top: 0, background: C.white }}><tr><th style={th}>#</th><th style={th}>Brand</th><th style={{ ...th, width: '38%' }}>Visibility</th>{HAS_PREV && <th style={thNum}>Change</th>}<th style={thNum}>SoV</th><th style={thNum}>Pos</th>{topic === 'all' && <th style={th}>Strongest in</th>}</tr></thead>
          <tbody>
            {rows.map((b) => (
              <tr key={b.name} style={{ background: b.own ? C.lightPurple : undefined }}>
                <td style={{ ...td, ...tabular, fontWeight: 700 }}>{b.rank}</td>
                <td style={{ ...td, fontWeight: b.own ? 800 : 600, whiteSpace: 'nowrap' }}>{b.name}</td>
                <td style={td}><div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><span style={{ ...tabular, width: 44, fontWeight: 700 }}>{pct(b.visibility)}</span><div style={{ flex: 1 }}><Bar value={b.visibility} max={max} color={b.own ? C.purple : '#BDBDBD'} /></div></div></td>
                {HAS_PREV && <td style={tdNum}><Delta cur={b.visibility} prev={b.prev?.visibility} /></td>}
                <td style={tdNum}>{pct(b.sov)}</td>
                <td style={tdNum}>{b.position?.toFixed(1) ?? '·'}</td>
                {topic === 'all' && <td style={{ ...td, fontSize: 12 }}>{b.best ? <Chip bg={TOPIC_COLOR[b.best]} style={{ fontSize: 10.5 }}>{topicName(b.best)}</Chip> : '·'}</td>}
              </tr>
            ))}
          </tbody>
        </table>
        {mutinyMissing && <p style={{ fontSize: 13, margin: '10px 0 0', fontWeight: 700 }}>Mutiny isn't named in any answer in this topic yet.</p>}
      </div>
      {topic === 'all' && N.brandFlags && <div style={{ marginTop: 14 }}><Note><b>Read this: </b>{N.brandFlags}</Note></div>}
    </Card>
  );
}

const ENG_COLOR = { 'openai-0': C.purple, 'google-0': C.red, 'perplexity-0': '#2BB6D6' };
function Engines() {
  const data = aeo.daily.map((d) => ({ ...d, label: md(d.date) }));
  const best = [...aeo.channels].filter((c) => c.cur).sort((a, b) => b.cur.visibility - a.cur.visibility)[0];
  return (
    <Card tour="engines" title="By AI engine" sub={`How often each AI engine names Mutiny (${span(aeo.windows.cur)}). Engines search and weigh sources differently, so the same content can do well on one and poorly on another.`}
      peec={PEEC.models} ask={{ section: 'By AI engine', context: ctx.engines, suggestions: ['Why would ChatGPT and Google AI Overview treat us differently?', 'Which engine should we focus on first?'] }}
      footnote="Each engine reads different sources. Totals add up Peec's daily rows per engine; share of voice is rebuilt from each day's mentions. The daily chart appears once there are 3 or more days.">
      <div className="aeo-eng" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0,1fr))', gap: 10, marginTop: 14 }}>
        {aeo.channels.map((c) => (
          <div key={c.id} style={{ border: `1px solid ${C.black}`, borderRadius: 4, padding: '12px 14px', background: c.id === best?.id ? C.lightGreen : C.paper }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 700, fontSize: 13 }}>
              <span style={{ width: 10, height: 10, borderRadius: 2, background: ENG_COLOR[c.id], border: `1px solid ${C.black}` }} />{c.name}
            </div>
            <div style={{ ...tabular, fontFamily: FONT_DISPLAY, fontSize: 28, letterSpacing: '-0.03em', margin: '6px 0 4px' }}>{pct(c.cur?.visibility)}</div>
            <div style={{ fontSize: 12, color: C.muted, lineHeight: 1.7 }}>
              <div>Visibility <Delta cur={c.cur?.visibility} prev={c.prev?.visibility} size={11.5} /></div>
              <div style={tabular}>Position {c.cur?.position?.toFixed(1) ?? '·'} <Delta cur={c.cur?.position} prev={c.prev?.position} kind="pos" size={11.5} /></div>
              <div style={tabular}>Mentions {num(c.cur?.mentions)} <Delta cur={c.cur?.mentions} prev={c.prev?.mentions} kind="num" size={11.5} /></div>
              <div style={tabular}>SoV {pct(c.cur?.sov)}</div>
            </div>
          </div>
        ))}
      </div>
      {data.length >= 3 && (
        <div style={{ height: 190, marginTop: 16 }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 6, right: 8, left: -12, bottom: 0 }}>
              <CartesianGrid stroke={C.grid} vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 10.5, fontFamily: FONT_BODY }} interval="preserveStartEnd" tickLine={false} axisLine={{ stroke: C.black }} />
              <YAxis tickFormatter={(v) => `${Math.round(v * 100)}%`} tick={{ fontSize: 10.5, fontFamily: FONT_BODY }} tickLine={false} axisLine={false} domain={[0, 'auto']} />
              <Tooltip formatter={(v, n) => [pct(v), n]} labelStyle={{ fontWeight: 700 }} contentStyle={{ border: `1px solid ${C.black}`, borderRadius: 4, fontFamily: FONT_BODY, fontSize: 12 }} />
              <Line dataKey="openai-0" name="ChatGPT" stroke={ENG_COLOR['openai-0']} strokeWidth={2} dot={false} />
              <Line dataKey="perplexity-0" name="Perplexity" stroke={ENG_COLOR['perplexity-0']} strokeWidth={2} dot={false} />
              <Line dataKey="google-0" name="Google AI Overview" stroke={ENG_COLOR['google-0']} strokeWidth={2} dot={false} />
              <Line dataKey="visibility" name="All engines" stroke={C.black} strokeWidth={2.5} strokeDasharray="4 3" dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
      {N.channels && <p style={{ fontSize: 13.5, lineHeight: 1.55, margin: '12px 0 0' }}>{N.channels}</p>}
    </Card>
  );
}

// --- 4. Topic cards ----------------------------------------------------------------------------
const TOPIC_METRICS = [
  ['visibility', 'Visibility', 'pts', pct], ['mentions', 'Mentions', 'num', num], ['sov', 'Share of voice', 'pts', pct],
  ['sentiment', 'Sentiment', 'num', (v) => v ?? '·'], ['position', 'Avg position', 'pos', (v) => v?.toFixed(1) ?? '·'],
];
function TopicCard({ t, tour }) {
  const m = t.mutiny; const note = N.topics?.[t.key] || {};
  const top = t.brands.slice(0, 5);
  const max = Math.max(...top.map((b) => b.visibility), m?.visibility || 0, 0.0001);
  return (
    <Card tour={tour} peec={PEEC.topics?.[t.key]} ask={{ section: `Topic: ${t.name}`, context: () => ctx.topic(t), suggestions: [`What content would move Mutiny up in ${t.name}?`, `Why does ${t.leader?.brand || 'the leader'} win this topic?`] }}
      title={<span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}><span style={{ width: 12, height: 12, background: t.color, border: `1px solid ${C.black}`, borderRadius: 2 }} />{t.name}</span>}
      sub={m ? `Mutiny #${m.rank} of ${t.mentionedBrands} brands named · ${num(t.responses)} answers` : `Mutiny not named yet · ${num(t.responses)} answers`}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'baseline', margin: '12px 0 8px', flexWrap: 'wrap' }}>
        <span style={{ ...tabular, fontFamily: FONT_DISPLAY, fontSize: 30, letterSpacing: '-0.03em' }}>{pct(m?.visibility || 0)}</span>
        <span style={{ fontSize: 12.5, color: C.muted }}>vs {t.leader?.brand} {pct(t.leader?.visibility)} (leader) · {pct(t.gapToLeader)} to close</span>
      </div>
      {m && (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr><th style={th}>Mutiny</th>{HAS_PREV && <th style={thNum}>Last wk</th>}<th style={thNum}>Now</th>{HAS_PREV && <th style={thNum}>Change</th>}</tr></thead>
          <tbody>
            {TOPIC_METRICS.map(([k, label, kind, fmt]) => (
              <tr key={k}><td style={td}>{label}</td>{HAS_PREV && <td style={{ ...tdNum, color: C.muted }}>{fmt(m?.prev?.[k])}</td>}<td style={{ ...tdNum, fontWeight: 700 }}>{fmt(m?.[k])}</td>{HAS_PREV && <td style={tdNum}><Delta cur={m?.[k]} prev={m?.prev?.[k]} kind={kind} /></td>}</tr>
            ))}
          </tbody>
        </table>
      )}
      <div style={{ ...eyebrow, marginTop: 14, marginBottom: 6 }}>Who this topic names</div>
      {[...top, ...(m && m.rank > 5 ? [m] : [])].map((b) => (
        <div key={b.brand} style={{ display: 'grid', gridTemplateColumns: '100px 1fr 46px', alignItems: 'center', gap: 8, fontSize: 12.5, padding: '3px 0', fontWeight: b.brand === 'Mutiny' ? 800 : 500 }}>
          <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{b.rank}. {b.brand}</span>
          <Bar value={b.visibility} max={max} color={b.brand === 'Mutiny' ? C.purple : '#BDBDBD'} />
          <span style={{ ...tabular, textAlign: 'right' }}>{pct(b.visibility, 0)}</span>
        </div>
      ))}
      {(note.competitive || note.trend) && (
        <div style={{ marginTop: 14, fontSize: 13, lineHeight: 1.55 }}>
          {note.competitive && <p style={{ margin: '0 0 6px' }}><b>Competitive context: </b>{note.competitive}</p>}
          {note.trend && <p style={{ margin: 0 }}><b>What to do: </b>{note.trend}</p>}
        </div>
      )}
    </Card>
  );
}

// --- 5. CRO positioning watch --------------------------------------------------------------------
const FRAMING = { cro: ['Old CRO framing', C.lightRed], mixed: ['Mixed', C.amber], current: ['Current', C.lightGreen], unclear: ['Unclear', C.lightGrey], 'no-content': ['No text', C.lightGrey] };
function CroWatch() {
  const X = aeo.cro || { rows: [] };
  return (
    <Card tour="cro" title="Pages that still call Mutiny a website personalization tool" sub={`Pages AI engines read (${span(X.window)}) that mention Mutiny, with the exact sentence they use. When AI reads these, it files Mutiny under the wrong category, so it leaves us out of AI sales assistant answers.`}
      ask={{ section: 'Positioning watch', context: ctx.cro, suggestions: ['Draft a short, friendly email asking one of these sites to update how they describe Mutiny.', 'Which of these pages should we fix first, and why?'] }}
      footnote="Found by scanning Peec's URL report for pages on CRO, personalization and martech sites that mention Mutiny, then pulling the sentences about Mutiny from Peec's stored copy of each page. Retrievals = AI chats that read the page. The fix is outreach to the site owner plus correct on-site positioning.">
      {X.perceptionAttributes?.terms?.length > 0 && (
        <div style={{ margin: '12px 0 10px', fontSize: 13, lineHeight: 1.6 }}>
          <b>How AI describes Mutiny today</b> (Peec brand profile) still includes: {X.perceptionAttributes.terms.map((t) => <Chip key={t} bg={C.lightRed} style={{ margin: '0 4px 4px 0', fontSize: 11 }}>{t}</Chip>)}
        </div>
      )}
      <div style={{ display: 'grid', gap: 10, marginTop: 8 }}>
        {X.rows.map((r) => (
          <div key={r.url} style={{ border: `1px solid ${C.black}`, borderRadius: 4, padding: '10px 12px', background: C.white, display: 'grid', gridTemplateColumns: '1fr auto', gap: 10 }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                <Chip bg={FRAMING[r.framing]?.[1]} style={{ fontSize: 10.5 }}>{FRAMING[r.framing]?.[0] || r.framing}</Chip>
                <A href={r.url} style={{ fontWeight: 700, fontSize: 13 }}>{r.title || shortUrl(r.url)}</A>
              </div>
              {r.snippet && <div style={{ fontFamily: FONT_CAPTION, fontStyle: 'italic', fontSize: 13, lineHeight: 1.5, marginTop: 6 }}>“{r.snippet.replace(/\*\*/g, '').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').split(' | ')[0]}”</div>}
              {r.note && <div style={{ fontSize: 12, color: C.muted, marginTop: 4 }}>{r.note}</div>}
              <div style={{ fontSize: 11.5, color: C.muted, marginTop: 4 }}>{host(r.url)} · {r.type}</div>
            </div>
            <div style={{ ...tabular, textAlign: 'right', fontSize: 12 }}><b style={{ fontSize: 16 }}>{r.retrievals}</b><div style={{ color: C.muted }}>retrievals</div></div>
          </div>
        ))}
      </div>
      {N.cro && <div style={{ marginTop: 12 }}><Note bg={C.lightRed}>{N.cro}</Note></div>}
    </Card>
  );
}

// --- 6. Domains, URLs ---------------------------------------------------------------------------------
const CLS_BG = { You: C.lightPurple, Competitor: C.lightRed, UGC: C.lightBlue, Corporate: C.lightGrey, Editorial: C.lightGreen, Other: C.white };
function Domains({ topic = 'all' }) {
  const byT = topic !== 'all' ? aeo.domains.byTopic?.[topic] : null;
  const list = byT ? byT.top : aeo.domains.top;
  const own = byT ? { cur: byT.own, rank: byT.own?.rank } : aeo.domains.own;
  const tName = topic !== 'all' ? topicName(topic) : null;
  return (
    <Card tour="domains" title="Most read source domains" sub={`${tName ? `${tName} only` : 'All six topics combined'}, ${span(aeo.windows.cur)}. Chats = AI answers that read at least one page from the site while researching.`}
      peec={PEEC.domains} ask={{ section: `Most read source domains${tName ? `: ${tName}` : ''}`, context: () => ctx.domains(topic), suggestions: ['Which of these sites should we try to get onto first?', 'Why does a high "retrieved" with a low "cited" matter?'] }}
      footnote="Retrieved = share of chats that read a page from the domain. Cited = share that link it inside the answer. Matt: 99% of citations come from about 1% of the internet, so these few sites are the map.">
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: '14px 0 12px' }}>
        {own?.cur ? <>
          <Chip bg={C.lightPurple}>mutinyhq.com: #{own.rank} · {num(own.cur?.chats)} chats</Chip>
          <Chip>Read in {pct(own.cur?.retrieved)} · cited in {pct(own.cur?.cited)}</Chip>
        </> : <Chip bg={C.lightRed}>mutinyhq.com isn't in this topic's top 10</Chip>}
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr><th style={th}>#</th><th style={th}>Domain</th><th style={thNum}>Chats</th><th style={thNum}>Retrieved</th><th style={thNum}>Cited</th></tr></thead>
          <tbody>
            {list.map((d) => (
              <tr key={d.domain} style={{ background: d.cls === 'You' ? C.lightPurple : undefined }}>
                <td style={{ ...td, ...tabular }}>{d.rank}</td>
                <td style={{ ...td, whiteSpace: 'nowrap' }}>{d.domain} <Chip bg={CLS_BG[d.cls] || C.white} style={{ fontSize: 10, padding: '0 6px', marginLeft: 4 }}>{d.cls}</Chip></td>
                <td style={{ ...tdNum, fontWeight: 700 }}>{num(d.chats)}</td>
                <td style={tdNum}>{pct(d.retrieved)}</td>
                <td style={tdNum}>{pct(d.cited)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {N.domains && topic === 'all' && <p style={{ fontSize: 13.5, lineHeight: 1.55, margin: '12px 0 0' }}>{N.domains}</p>}
    </Card>
  );
}

function UrlList({ title, sub, rows, tour, showMutiny, peec, askSection }) {
  return (
    <Card tour={tour} title={title} sub={sub} peec={peec} footnote="Citations = links inside answers. Retrievals = chats that read the page."
      ask={{ section: askSection || title, context: () => ctx.urls(rows), suggestions: ['What do these pages have in common that makes AI cite them?', 'Which of these could we realistically get Mutiny added to?'] }}>
      <ol style={{ listStyle: 'none', padding: 0, margin: '12px 0 0' }}>
        {rows.map((u, i) => (
          <li key={u.url} style={{ display: 'grid', gridTemplateColumns: '22px 1fr auto', gap: 8, padding: '8px 0', borderBottom: `1px solid ${C.lightGrey}`, fontSize: 13 }}>
            <span style={{ ...tabular, fontWeight: 700 }}>{i + 1}</span>
            <span style={{ minWidth: 0 }}>
              <A href={u.url} style={{ fontWeight: 600 }}>{u.title || shortUrl(u.url)}</A>
              <div style={{ color: C.muted, fontSize: 11.5, marginTop: 2 }}>{host(u.url)} · {u.type}{showMutiny ? (u.mutiny ? ' · Mutiny listed' : ' · Mutiny missing') : ''}</div>
            </span>
            <span style={{ ...tabular, textAlign: 'right', whiteSpace: 'nowrap' }}><b>{u.citations}</b> <span style={{ color: C.muted, fontSize: 11.5 }}>cites · {u.retrievals} reads</span></span>
          </li>
        ))}
      </ol>
    </Card>
  );
}

function Sources() {
  const [topic, setTopic] = useState('all');
  const urlRows = topic === 'all' ? aeo.topCitedUrls : (aeo.topCitedByTopic?.[topic] || []);
  return (
    <>
      <div style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 13, fontWeight: 700 }}>Show:</span>
        <Seg value={topic} onChange={setTopic} options={topicOptions('All six topics')} />
      </div>
      <div className="aeo-g2" style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)', gap: 16 }}>
        <Domains topic={topic} />
        <UrlList tour="urls" title="Most cited pages" peec={PEEC.urls} showMutiny askSection={`Most cited pages${topic !== 'all' ? `: ${topicName(topic)}` : ''}`}
          sub={topic === 'all' ? `The pages AI links to most, among the 60 most-read pages across all six topics (${span(aeo.windows.cur)}). Look at their format: that's what AI likes to cite.` : `The pages AI links to most in ${topicName(topic)} (${span(aeo.windows.cur)}). Look at their format: that's what AI likes to cite.`}
          rows={urlRows} />
      </div>
    </>
  );
}

// --- 7. Outreach roadmap (Matt's currency exchange) -------------------------------------------------
const OWNER_BG = { Challenger: C.lightGreen, Incumbent: C.lightGrey, Competitor: C.lightRed, 'Review site': C.lightBlue, Community: C.lightBlue, You: C.lightPurple };
function Outreach() {
  const O = aeo.outreach || { rows: [] };
  const [owner, setOwner] = useState('targets');
  const rows = O.rows.filter((r) => r.rank <= 50 && (owner === 'all' || (owner === 'targets' ? r.owner === 'Challenger' && !r.mutiny : owner === 'listed' ? r.mutiny : r.owner === owner)));
  return (
    <Card tour="outreach" title="Get onto the top 50" sub={`The 50 pages AI reads most across our six topics (${span(O.window)}), whether Mutiny is on each, and who owns it. A handful of pages shape most AI answers, so getting listed on them moves visibility more than almost anything else.`}
      peec={PEEC.urls} ask={{ section: 'Outreach roadmap (top 50)', context: ctx.outreach, suggestions: ['Write a short swap-pitch email to the #1 challenger site.', 'Which five pages should we go after first, and why?'] }}
      footnote="Owner types: Challenger = smaller site likely to swap inclusions; Incumbent = big site with no incentive (Matt: Highspot, Zapier, Qualified); Competitor = a tracked rival; Review site = earn it with reviews; Community = real UGC only. Matt: once you pass a critical threshold, new AI-written lists start including you on their own.">
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, margin: '14px 0 10px', flexWrap: 'wrap' }}>
        <div style={{ ...tabular, fontFamily: FONT_DISPLAY, fontSize: 34, letterSpacing: '-0.03em' }}>{O.top50With}<span style={{ fontSize: 18, color: C.muted }}> / 50</span></div>
        <div style={{ flex: 1, minWidth: 180 }}>
          <div style={{ display: 'flex', height: 12, border: `1px solid ${C.black}`, borderRadius: 3, overflow: 'hidden' }}>
            {Array.from({ length: 50 }, (_, i) => { const r = O.rows.find((x) => x.rank === i + 1); return <span key={i} title={r ? `#${r.rank} ${r.domain}` : ''} style={{ flex: 1, background: r?.mutiny ? C.purple : C.white, borderLeft: i ? '1px solid #E6E6E6' : 'none' }} />; })}
          </div>
          <div style={{ fontSize: 12, color: C.muted, marginTop: 4 }}>Mutiny is on {O.top50With} of the top 50 ({O.top50Own} our own pages, {O.top50ThirdParty} third-party). Purple = listed.</div>
        </div>
      </div>
      <Seg value={owner} onChange={setOwner} options={[['targets', `Pitch a swap · ${O.byOwner?.Challenger ?? 0}`, C.lightGreen], ['listed', `Already listed · ${O.top50With}`, C.lightPurple], ['Incumbent', 'Incumbents'], ['Competitor', 'Competitors'], ['Review site', 'Review sites'], ['Community', 'Community'], ['all', 'All 50']]} />
      <div style={{ overflowX: 'auto', marginTop: 10, maxHeight: 520, overflowY: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead style={{ position: 'sticky', top: 0, background: C.white }}><tr><th style={th}>#</th><th style={th}>Page</th><th style={th}>Owner</th><th style={thNum}>Reads</th><th style={thNum}>Cites</th><th style={th}>Mutiny</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.url}>
                <td style={{ ...td, ...tabular, fontWeight: 700 }}>{r.rank}</td>
                <td style={{ ...td, minWidth: 240 }}><A href={r.url} style={{ fontWeight: 600 }}>{r.title}</A><div style={{ fontSize: 11.5, color: C.muted, marginTop: 2 }}>{r.domain} · {r.play}</div></td>
                <td style={td}><Chip bg={OWNER_BG[r.owner]} style={{ fontSize: 10.5 }}>{r.owner}</Chip></td>
                <td style={tdNum}>{r.retrievals}</td>
                <td style={tdNum}>{r.citations}</td>
                <td style={{ ...td, fontWeight: 700, color: r.mutiny ? C.up : C.down }}>{r.mutiny ? 'Listed' : 'Missing'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {N.outreach && <p style={{ fontSize: 13.5, lineHeight: 1.55, margin: '12px 0 0' }}>{N.outreach}</p>}
    </Card>
  );
}

// --- 8. Peec actions + takeaways ---------------------------------------------------------------------
function Opportunities() {
  const o = aeo.opportunities;
  return (
    <>
      {N.opportunityContext?._all && <div style={{ marginBottom: 12 }}><Note>{N.opportunityContext._all}</Note></div>}
      <div className="aeo-g3" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 16 }}>
        {o.items.map((a, k) => (
          <Card key={a.id} tour={k === 0 ? 'opps' : undefined}>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
              <Chip bg={C.green}>{a.impact} impact</Chip><Chip>{a.group} · {a.format}</Chip>{a.topic && <Chip bg={C.lightGrey}>{a.topic} (old set)</Chip>}
            </div>
            <div style={{ fontWeight: 700, fontSize: 15, lineHeight: 1.35 }}>{a.title}</div>
            <p style={{ fontSize: 13, lineHeight: 1.55, margin: '8px 0' }}>{a.text}</p>
            {N.opportunityContext?.[a.id] && <p style={{ fontSize: 13, lineHeight: 1.55, margin: '0 0 8px', padding: '8px 10px', background: C.paper, borderLeft: `3px solid ${C.purple}` }}>{N.opportunityContext[a.id]}</p>}
            {a.sources?.length > 0 && <div style={{ fontSize: 11.5, color: C.muted, lineHeight: 1.5 }}>Sources: {a.sources.join(' · ')}</div>}
          </Card>
        ))}
        <div style={{ fontSize: 12, color: C.muted, gridColumn: '1 / -1' }}>Top {o.items.length} of {o.totalOpen} open Peec actions, ranked by Peec's impact. Text is Peec's; full list in <A href="https://app.peec.ai/actions/recommendations">Peec Actions</A>.</div>
      </div>
    </>
  );
}

// --- 9. Backlog -----------------------------------------------------------------------------------------
const STATUS = {
  absent: { label: 'Absent', bg: C.lightRed, help: 'Mutiny is in none of the AI answers for this prompt.' },
  weak: { label: 'Weak', bg: C.amber, help: 'Mutiny is in under 10% of answers.' },
  present: { label: 'Present', bg: C.lightBlue, help: 'Mutiny is in 10% to 49% of answers.' },
  winning: { label: 'Winning', bg: C.lightGreen, help: 'Mutiny is in at least half of the answers.' },
};
const SHAPE = { listicle: 'a listicle', alternative: 'an alternatives page', article: 'an article', 'how to guide': 'a how-to guide', comparison: 'a comparison page', 'product page': 'a product page', 'category page': 'a category page', homepage: 'a homepage', other: 'a page' };
const GAP_LABEL = { attack: 'Direct attack (+4)', mild: 'Mild attack (+3)', capture: 'Capture (+2)', present: 'Mutiny already named (+0)' };

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
            {b.head && <Chip bg={C.amber} title="Matt: generic head terms barely move; niche prompts are easier wins">Head term</Chip>}
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
              <div style={eyebrow}>Top 5 pages AI reads for this prompt</div>
              {b.top5.length ? (
                <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 6 }}>
                  <thead><tr><th style={th}>Page</th><th style={thNum}>Reads</th><th style={thNum}>Cites</th></tr></thead>
                  <tbody>
                    {b.top5.map((u) => (
                      <tr key={u.url}>
                        <td style={{ ...td, minWidth: 0 }}>
                          <A href={u.url} style={{ fontWeight: 600 }}>{u.title || shortUrl(u.url)}</A>
                          <div style={{ fontSize: 11.5, color: C.muted, marginTop: 2 }}>{host(u.url)} · {u.type}{u.competitors.length ? ` · ${u.competitors.slice(0, 5).join(', ')}` : ''}{u.mutiny ? ' · Mutiny listed' : ''}</div>
                        </td>
                        <td style={tdNum}>{u.retrievals}</td><td style={tdNum}>{u.citations}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : <p style={{ fontSize: 12.5, color: C.muted }}>Top pages not pulled yet for this prompt.</p>}
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
              <div style={{ fontSize: 11, color: C.muted, marginTop: 6 }}>Measured on Peec's stored copy of each page; word counts include some site chrome.</div>
            </div>
            <div style={{ minWidth: 0, fontSize: 13, lineHeight: 1.55 }}>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
                <AskClaude section={`Brief: ${b.text}`} context={() => ctx.brief(b)} suggestions={['Outline this page for me: H1, the 40 to 60 word answer, H2s and FAQ.', 'What angle would make Mutiny stand out on this page?']} compact />
                <PeecLink href={b.peecUrl || PEEC.prompts} label="See this prompt in Peec" />
              </div>
              <div style={eyebrow}>Why this prompt</div>
              <p style={{ margin: '4px 0 12px' }}>{b.signal}. Score {b.score} = {GAP_LABEL[b.gapType]}{b.parts.volPts ? ` + ${b.parts.volPts} volume` : ''}{b.parts.intentPts ? ' + 1 commercial intent' : ''}{b.parts.headPts ? ' - 1 head term' : ''}.</p>
              <div style={eyebrow}>Winning shape</div>
              <p style={{ margin: '4px 0 8px' }}>{p.summary}</p>
              {p.analyzed > 0 && (
                <ul style={{ margin: '0 0 12px', paddingLeft: 18 }}>
                  <li>H1 = the exact question, then a <b>40 to 60 word answer</b> right below it (Matt's TLDR rule).</li>
                  <li>Target about <b>{num(p.targetWords)} words</b>, shaped as {SHAPE[p.dominantType] || 'a page'}, with fan-out H2s that go deeper.</li>
                  <li>{p.withTable >= Math.ceil(p.analyzed / 2) ? 'Include a comparison table.' : 'A comparison table is optional here.'} Close with an FAQ (up to 9 Q&As).</li>
                  <li>Verifiable specifics: at least {Math.max(5, p.medianStats || 0)} sourced stats, named sources and expert quotes.</li>
                </ul>
              )}
              {p.sharedSources?.length > 0 && (<><div style={eyebrow}>Sources the winners cite</div><p style={{ margin: '4px 0 12px' }}>{p.sharedSources.map((s) => `${s.domain} (${s.pages})`).join(' · ')}</p></>)}
              <div style={eyebrow}>Internal Mutiny links</div>
              <ul style={{ margin: '4px 0 12px', paddingLeft: 18 }}>
                {b.internalLinks.slice(0, 5).map((l) => <li key={l.url}><A href={l.url}>{l.title}</A>{l.citations ? <span style={{ color: C.muted, fontSize: 11.5 }}> {l.citations} cites</span> : null}</li>)}
              </ul>
              {N.lean?.[b.topic] && (<><div style={eyebrow}>Mutiny lean</div><p style={{ margin: '4px 0 12px' }}>{N.lean[b.topic]}</p></>)}
              <div style={eyebrow}>{b.role === 'anchor' ? 'Anchor piece' : 'Supplementary piece'}</div>
              <p style={{ margin: '4px 0 0' }}>
                {b.role === 'anchor'
                  ? (b.supplementary?.length ? <>Link out to: {b.supplementary.map((s) => `“${s}”`).join(', ')}.</> : 'First piece for this topic; future pieces link back here.')
                  : <>Link back to the anchor: “{b.anchor}”.</>}
              </p>
              {missing.length > 0 && <p style={{ margin: '10px 0 0', fontSize: 12, color: C.muted }}>{missing.length} of {b.pages.length} top pages not analyzed.</p>}
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
        <Seg value={topic} onChange={setTopic} options={topicOptions().map(([k, l, bg]) => [k, `${l}${counts[k] != null ? ` · ${counts[k]}` : ''}`, bg])} />
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {Object.entries(STATUS).map(([k, s]) => <Chip key={k} bg={s.bg} title={s.help}>{s.label} {st[k] || 0}</Chip>)}
        </div>
      </div>
      {N.backlogNote && <div style={{ marginBottom: 12 }}><Note>{N.backlogNote}</Note></div>}
      <div style={{ display: 'grid', gap: 12 }}>
        {briefs.length ? briefs.map((b, i) => <Brief key={b.id} b={b} rank={i + 1} />) : <Card><span style={{ color: C.muted }}>No backlog picks for this topic this week.</span></Card>}
      </div>
      <div className="aeo-g2" style={{ display: 'grid', gridTemplateColumns: 'minmax(0,2fr) minmax(0,1fr)', gap: 16, marginTop: 16 }}>
        <Card tour="prompts" title="Every tracked prompt" sub={`All ${B.evaluated} buyer questions Peec tracks, scored on ${span(aeo.windows.backlog)}. Higher score = bigger, more winnable gap.`}
          peec={PEEC.prompts} ask={{ section: 'Content backlog', context: ctx.backlog, suggestions: ['Which three prompts should we write for first, and what should each page be?', 'Why are head terms hard to win?'] }}
          right={
            <select value={status} onChange={(e) => setStatus(e.target.value)} style={{ fontFamily: FONT_BODY, fontSize: 12.5, fontWeight: 700, border: `1px solid ${C.black}`, borderRadius: 6, padding: '4px 6px', background: C.white }}>
              <option value="gaps">Gaps (absent + weak)</option><option value="all">All statuses</option>
              {Object.entries(STATUS).map(([k, s]) => <option key={k} value={k}>{s.label}</option>)}
            </select>
          }
          footnote="Score: +4 Mutiny absent and 2+ brands named in at least half the answers, +3 with one such brand, +2 with none (capture, needs medium+ volume to be picked); +2 high or very high volume, +1 medium; +1 commercial intent (Peec tag); -1 head term. Owners = brands named in at least half the answers.">
          <div style={{ overflowX: 'auto', marginTop: 12, maxHeight: 520, overflowY: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead style={{ position: 'sticky', top: 0, background: C.white }}><tr><th style={th}>Prompt</th><th style={th}>Topic</th><th style={th}>Volume</th><th style={thNum}>Mutiny</th><th style={th}>Status</th><th style={th}>Owned by</th><th style={thNum}>Score</th></tr></thead>
              <tbody>
                {rows.map((p) => (
                  <tr key={p.id}>
                    <td style={{ ...td, minWidth: 220 }}>{p.text}{p.head && <Chip bg={C.amber} style={{ marginLeft: 6, fontSize: 10, padding: '0 6px' }}>head</Chip>}{B.briefs.some((b) => b.id === p.id) && <Chip bg={C.purple} style={{ marginLeft: 6, fontSize: 10, padding: '0 6px' }}>brief</Chip>}</td>
                    <td style={{ ...td, whiteSpace: 'nowrap', fontSize: 12 }}>{topicName(p.topic)}</td>
                    <td style={{ ...td, whiteSpace: 'nowrap', fontSize: 12 }}>{p.volume}</td>
                    <td style={tdNum}>{pct(p.mutinyVis, 0)}</td>
                    <td style={td}><Chip bg={STATUS[p.status].bg} title={STATUS[p.status].help} style={{ fontSize: 10.5 }}>{STATUS[p.status].label}</Chip></td>
                    <td style={{ ...td, fontSize: 12 }}>{p.owners.slice(0, 3).join(', ') || '·'}</td>
                    <td style={{ ...tdNum, fontWeight: 800 }}>{p.score}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
        <Card tour="wins" title="Where Mutiny already shows up" sub="Prompts where AI names Mutiny in at least 10% of answers. Protect these pages and link new content to them.">
          <ol style={{ listStyle: 'none', padding: 0, margin: '12px 0 0' }}>
            {wins.map((w) => (
              <li key={w.id} style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 8, padding: '8px 0', borderBottom: `1px solid ${C.lightGrey}`, fontSize: 13 }}>
                <span>{w.text}<div style={{ fontSize: 11.5, color: C.muted }}>{topicName(w.topic)} · {w.volume} volume</div></span>
                <b style={{ ...tabular, color: w.status === 'winning' ? C.up : C.black }}>{pct(w.mutinyVis, 0)}</b>
              </li>
            ))}
            {!wins.length && <li style={{ color: C.muted, fontSize: 13, padding: '8px 0' }}>Nothing above 10% in this topic yet.</li>}
          </ol>
        </Card>
      </div>
    </>
  );
}

// --- Page ------------------------------------------------------------------------------------------
const AEO_CSS = `
.aeo-tour-btn:hover{box-shadow:4px 4px 0 #000!important}.aeo-ladder>div+div{border-left:1px solid #000}.aeo-tour-btn:focus-visible{outline:2px solid #000;outline-offset:2px}
@media (max-width: 900px){.aeo-learn{grid-template-columns:minmax(0,1fr)!important}}
@media (max-width: 1100px){.aeo-kpis{grid-template-columns:repeat(3,minmax(0,1fr))!important}.aeo-g2,.aeo-brief{grid-template-columns:minmax(0,1fr)!important}}
@media (max-width: 760px){.aeo-kpis{grid-template-columns:repeat(2,minmax(0,1fr))!important}.aeo-eng,.aeo-ladder{grid-template-columns:minmax(0,1fr)!important}.aeo-ladder>div+div{border-left:none!important;border-top:1px solid #000}.aeo-topics{grid-template-columns:minmax(0,1fr)!important}}
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
        <span style={{ marginLeft: 'auto', fontSize: 13, fontWeight: 600 }}>{span(W.cur)}{W.prev ? ` vs ${span(W.prev)}` : ''} · Peec, pulled {pulled}</span>
        <button type="button" onClick={() => setTourOpen(true)} className="aeo-tour-btn"
          style={{ all: 'unset', boxSizing: 'border-box', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 8, border: `1px solid ${C.black}`, borderRadius: 999, padding: '7px 14px', background: C.green, fontSize: 13, fontWeight: 800, boxShadow: `2px 2px 0 ${C.black}` }}>
          <GraduationCap size={16} strokeWidth={2.2} /> New to AEO? Take the tour
          {!tourDone && <span style={{ background: C.black, color: C.white, borderRadius: 999, padding: '1px 7px', fontSize: 10.5, letterSpacing: '0.06em', textTransform: 'uppercase' }}>Start here</span>}
        </button>
      </div>
      <AeoTour open={tourOpen} onClose={closeTour} />
      <ResetBanner />

      <SectionTitle kicker="The big picture" title="Where Mutiny stands"
        learn={{
          what: 'A plain-English summary, then the ladder: how often AI reads our pages, links them, and names Mutiny in its answer.',
          why: 'Being named is what puts Mutiny on a buyer\'s shortlist. Reading and linking are the steps that lead there, so the biggest drop on the ladder is where to work.',
          how: 'Read the summary first. Then find the step with the biggest drop: low citations means our pages need clearer answers; low visibility means we need more pages and mentions in the places AI trusts.',
        }} />
      <Summary />
      <div style={{ marginTop: 16 }}><PageAsk /></div>
      <div style={{ marginTop: 16 }}><JalehCard /></div>

      <SectionTitle kicker="Competition" title="Who AI engines name" sub="Overall ranking plus a like-for-like view inside each topic, and how each engine treats Mutiny."
        learn={{
          what: 'Every brand Peec tracks, ranked by visibility (share of AI answers that name it). The buttons switch to a single topic.',
          why: 'AI answers usually name 3 to 5 brands. If rivals fill those slots, buyers never hear about Mutiny, whatever our product does.',
          how: 'Pick a topic to compare Mutiny with the brands it actually meets there. Note who leads and how far ahead they are; that\'s the bar to clear.',
        }} />
      <div className="aeo-g2" style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.15fr) minmax(0,1fr)', gap: 16 }}>
        <Landscape />
        <Engines />
      </div>

      <SectionTitle kicker="Competition" title="Topic by topic" sub="Each topic is its own race. Compare Mutiny with that topic's leader, never one topic with another."
        learn={{
          what: 'One card per topic, the groups of buyer questions we track. Each shows Mutiny\'s scores, the brands named most, and the gap to the leader.',
          why: 'Topics name different numbers of brands, so 5% in one can be a stronger spot than 30% in another. The leader in each topic sets the bar.',
          how: 'Read "What to do" on each card. Start with the topic closest to how we sell (AI sales assistants), then the one where we\'re nearest the leader.',
        }} />
      <div className="aeo-topics" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))', gap: 16 }}>
        {TOPICS.map((t, k) => <TopicCard key={t.key} t={t} tour={k === 0 ? 'topics' : undefined} />)}
      </div>

      <SectionTitle kicker="Priority 1" title="Positioning watch" sub="The biggest risk Matt flagged: parts of the web still describe Mutiny as an A/B testing / CRO tool, and AI repeats what it reads."
        learn={{
          what: 'Pages AI reads that still describe Mutiny\'s old website personalization product, with the exact sentence they use.',
          why: 'AI builds answers from consensus across sources. While these pages say "website personalization", AI keeps Mutiny out of AI sales assistant answers.',
          how: 'Work top down by reads: ask each site owner to update the description, and make sure our own pages say AI sales assistant clearly.',
        }} />
      <CroWatch />

      <SectionTitle kicker="Sources" title="What AI reads" sub="The sites and pages AI engines pull from for our topics. Use the buttons to see all six topics combined or one topic at a time."
        learn={{
          what: 'The websites and individual pages AI reads and links when answering our buyers\' questions.',
          why: 'Most citations come from a small set of sites. If Mutiny is described well on those, AI repeats it; if we\'re missing, AI can\'t name us.',
          how: 'Find the sites that matter for each topic, check whether Mutiny is on their pages, and copy the format of the pages that get cited most.',
        }} />
      <Sources />
      <div style={{ marginTop: 16 }}>
        <UrlList title="Mutiny's most read pages" askSection="Mutiny's most read pages" peec={PEEC.urls} sub={`Our own pages AI reads most, across all six topics (${span(W.cur)}). Many reads with few citations means the page is useful for research but isn't quotable enough yet: add a direct answer up top, an FAQ and sourced stats.`} rows={aeo.mutinyTopUrls} />
      </div>

      <SectionTitle kicker="Off-site" title="Outreach roadmap" sub="Matt's currency exchange: use our best pages as currency to get onto the lists AI reads most. Smaller challenger sites swap; incumbents rarely do."
        learn={{
          what: 'The 50 pages AI reads most across our topics, who owns each one, and whether Mutiny is listed.',
          why: 'Getting onto these lists is the fastest way to get named. Past a tipping point, new AI-written lists start including Mutiny on their own.',
          how: 'Start with the green "Pitch a swap" pages: offer to include their product in one of our lists in exchange for a spot in theirs.',
        }} />
      <Outreach />

      <SectionTitle kicker="Next steps" title="Peec's recommended actions" sub="Peec's highest-impact open actions, with how each ties to the current numbers."
        learn={{
          what: 'Actions Peec generates by comparing where rivals get cited and we don\'t: pages to write, pages to improve, sites to get onto.',
          why: 'They\'re ranked by expected impact, so they\'re a good second opinion next to our own backlog.',
          how: 'Open the full list in Peec to see steps and briefs. Mark what you take on there so its recommendations improve.',
        }} />
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 10 }}><PeecLink href={PEEC.actions || 'https://app.peec.ai/actions/recommendations'} label="Open Peec Actions" /></div>
      <Opportunities />

      {N.takeaways?.length > 0 && (
        <>
          <SectionTitle kicker="Next steps" title="Key takeaways and focus" sub="The current numbers turned into a short priority list. Share this with the team." />
          <Card tour="takeaways" ask={{ section: 'Key takeaways', context: ctx.page, suggestions: ['Turn these takeaways into a one-week plan.', 'Which takeaway matters most and why?'] }}>
            <ol style={{ margin: 0, paddingLeft: 22, fontSize: 14.5, lineHeight: 1.6 }}>
              {N.takeaways.map((t) => <li key={t} style={{ marginBottom: 8 }}>{t}</li>)}
            </ol>
          </Card>
        </>
      )}

      <SectionTitle kicker="Content backlog" title="Prompts where Mutiny is losing"
        learn={{
          what: 'Every tracked buyer question, scored for how big and winnable the gap is. The top ones get a writing brief.',
          why: 'Each page we publish is a new chance to be read, cited and named. Focused pages on niche questions win faster than broad "best X" pages.',
          how: 'Open a brief, check the pages to beat, then copy the brief to a writer. Publish steadily: AI favors recent content.',
        }}
        sub={`${aeo.backlog.evaluated} tracked prompts across ${TOPICS.length} topics. The top ${aeo.backlog.briefs.length} get a brief: why the prompt, the pages to beat, the shape that wins, and how to position Mutiny. One anchor per topic; the rest link back to it. Niche prompts beat head terms.`} />
      <Backlog />

      <div style={{ fontFamily: FONT_CAPTION, fontStyle: 'italic', fontSize: 12, color: C.muted, marginTop: 40, lineHeight: 1.6 }}>
        Source: Peec AI project “Mutiny 2.0” ({aeo.projectId}), engines ChatGPT, Google AI Overview and Perplexity; prompt set since {aeo.promptSet ? md(aeo.promptSet.since) : '·'}. Report {span(W.cur)}; backlog {span(W.backlog)}. Pulled {pulled}. Written notes: {N.asOf || 'not refreshed'}. Framing follows Matt Ratchford's AEO handoff (Oct 27).
        {' '}<A href="https://app.peec.ai" style={{ fontStyle: 'normal' }}>Open Peec <ExternalLink size={11} style={{ verticalAlign: '-1px' }} /></A>
      </div>
    </div>
  );
}
