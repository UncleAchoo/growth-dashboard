// ---------------------------------------------------------------------------
// AEO interactive walkthrough (Nick, Oct 27 2026). A beginner tour of the ?aeo
// page, started from the "New to AEO? Take the tour" button.
//
// Each step spotlights one element (data-tour="<id>" in aeo_section.jsx) with
// a tooltip anchored beside, below or above it (pointer arrow included), and
// carries three layers:
//   1. How to read it   plain English for someone new to AEO
//   2. What this means  a live insight computed from src/aeo.json, so it stays
//                       true after every refresh
//   3. Do this          one-click actions that act on the page: filter the
//                       backlog, open the top brief, copy a brief for a writer,
//                       open the page to beat, jump to a related step
// plus three quick knowledge checks. The page stays clickable during the tour.
// Steps whose target isn't rendered are skipped.
// ---------------------------------------------------------------------------
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, X, Lightbulb, MousePointerClick, Copy, ExternalLink, Filter, FileText, CornerDownRight, RotateCcw } from 'lucide-react';
import aeo from './src/aeo.json';

const C = {
  purple: '#A73BF5', green: '#B2FF14', lightPurple: '#F2D1FC', lightGreen: '#D2FD78', lightRed: '#FF9987', lightBlue: '#BCEEFD',
  black: '#000000', white: '#FFFFFF', paper: '#FAF8F4', lightGrey: '#EFEFEF', muted: 'rgba(0,0,0,0.6)', up: '#1E8A3A', down: '#E0401F',
};
const FONT_DISPLAY = "'Fraunces', 'Reckless Condensed S', Georgia, serif";
const FONT_BODY = "'Manrope', 'KMR Waldenburg', Arial, sans-serif";
export const TOUR_DONE_KEY = 'aeo-tour-done-v1';

const pct = (v) => (v == null ? '?' : `${(v * 100).toFixed(1)}%`);
const ptsAbs = (d) => `${Math.abs(d * 100).toFixed(1)} pts`;
const upDown = (d) => (d >= 0 ? 'up' : 'down');
const TOPIC_KEYS = ['AISE', 'ABM', 'AST', 'MGTM', 'CC'];

// --- Live facts ---------------------------------------------------------------------
function facts() {
  const brands = aeo.brands || [];
  const me = brands.find((b) => b.own) || {};
  const m = aeo.mutiny?.cur || {};
  const p = aeo.mutiny?.prev || {};
  const movers = brands.filter((b) => b.prev).map((b) => ({ ...b, d: b.visibility - b.prev.visibility })).sort((a, b) => Math.abs(b.d) - Math.abs(a.d));
  const topics = (aeo.topics || []).filter((t) => t.mutiny && TOPIC_KEYS.includes(t.key));
  const byVis = [...topics].sort((a, b) => b.mutiny.visibility - a.mutiny.visibility);
  const topicMoves = topics.filter((t) => t.mutiny.prev).map((t) => ({ t, d: t.mutiny.visibility - t.mutiny.prev.visibility })).sort((a, b) => b.d - a.d);
  const channels = aeo.channels || [];
  const engineMoves = channels.map((c) => ({ c, d: c.cur.visibility - c.prev.visibility })).sort((a, b) => Math.abs(b.d) - Math.abs(a.d));
  const engines = [...channels].sort((a, b) => b.cur.visibility - a.cur.visibility);
  const prompts = aeo.backlog?.prompts || [];
  const count = (s) => prompts.filter((x) => x.status === s).length;
  const thirdParty = (aeo.domains?.top || []).find((d) => d.cls === 'UGC') || (aeo.domains?.top || []).find((d) => d.cls !== 'You' && d.cls !== 'Competitor');
  const cited = aeo.topCitedUrls || [];
  return {
    me, m, p, brands, movers,
    above: brands[me.rank - 2], below: brands[me.rank],
    answers: channels.reduce((s, c) => s + (c.cur?.responses || 0), 0),
    best: byVis[0], worst: byVis[byVis.length - 1], riser: topicMoves[0], faller: topicMoves[topicMoves.length - 1],
    engineMove: engineMoves[0], topEngine: engines[0], lowEngine: engines[engines.length - 1],
    own: aeo.domains?.own, thirdParty,
    firstUrl: cited[0], citedWithoutUs: cited.filter((u) => !(u.brands || []).includes('Mutiny')).length, citedTotal: cited.length,
    briefs: aeo.backlog?.briefs || [],
    wins: aeo.backlog?.wins || [],
    nPrompts: aeo.backlog?.evaluated,
    absent: count('absent'), weak: count('weak'), present: count('present'), winning: count('winning'),
    opp: aeo.opportunities?.items?.[0],
    takeaway: aeo.narrative?.takeaways?.[0],
  };
}

// Plain-text brief for a writer (Docs, Notion, Slack). Hyphens only, no dashes.
function briefText(b) {
  if (!b) return '';
  const p = b.pattern || {};
  const lean = aeo.narrative?.lean?.[b.topic];
  return [
    `AEO brief: "${b.text}"`,
    `Topic: ${b.topicName} | Score ${b.score} | ${b.role === 'anchor' ? 'Anchor piece' : `Supplementary (link back to "${b.anchor}")`} | ${b.volume} volume, ${b.intent}`,
    `Why: ${b.signal}.`,
    '',
    'Pages to beat (top 5 cited, last 30 days):',
    ...b.top5.map((u, i) => `${i + 1}. ${u.title || u.url} - ${u.url} (${u.retrievals} retrievals, ${u.citations} citations)`),
    '',
    `Winning shape: ${p.summary || 'n/a'}`,
    `Target: about ${p.targetWords?.toLocaleString?.() || '?'} words. H1 = the literal question. Open every H2 with a 40-60 word direct answer. ${p.withTable >= Math.ceil((p.analyzed || 1) / 2) ? 'Include a comparison table. ' : ''}End with an FAQ (up to 9 Q&As). At least ${Math.max(5, p.medianStats || 0)} sourced stats.`,
    p.sharedSources?.length ? `Sources the winners cite: ${p.sharedSources.map((s) => s.domain).join(', ')}` : null,
    '',
    'Internal Mutiny links (already cited by AI):',
    ...(b.internalLinks || []).slice(0, 5).map((l) => `- ${l.title}: ${l.url}`),
    lean ? `\nMutiny lean: ${lean}` : null,
    '\nRules: no invented stats, customers or quotes (use [PLACEHOLDER: ...]); no em or en dashes.',
  ].filter((x) => x != null).join('\n');
}

const P = ({ children, style }) => <p style={{ margin: '0 0 8px', ...style }}>{children}</p>;
const Term = ({ children }) => <b style={{ background: C.lightGreen, padding: '0 3px', borderRadius: 2 }}>{children}</b>;

function Flow() {
  const box = { flex: 1, minWidth: 0, border: `1px solid ${C.black}`, borderRadius: 4, padding: '7px 6px', background: C.white, fontSize: 11.5, lineHeight: 1.3, textAlign: 'center' };
  const arrow = <ArrowRight size={13} style={{ flexShrink: 0 }} />;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 3, margin: '4px 0 10px' }}>
      <div style={box}><b>1. Prompt</b><br />a buyer question</div>{arrow}
      <div style={box}><b>2. AI engine</b><br />reads the web</div>{arrow}
      <div style={box}><b>3. Answer</b><br />names brands</div>{arrow}
      <div style={{ ...box, background: C.lightPurple }}><b>4. Peec logs</b><br />mentions + sources</div>
    </div>
  );
}

// --- Steps ----------------------------------------------------------------------------------
// target: data-tour id (null = centered). read: how to read it. insight: what it
// means this week. actions: [{label, icon, run(ctx) | href, done}]. check: quiz.
function buildSteps(f, ctx) {
  const brief = ctx.brief;
  const visD = (f.m.visibility ?? 0) - (f.p.visibility ?? 0);
  return [
    {
      id: 'welcome', target: null, kicker: 'Welcome', title: 'What is AEO?',
      read: <>
        <P><Term>AEO</Term> means answer engine optimization: getting your brand <b>named inside the answer</b> when a buyer asks ChatGPT, Perplexity or Google's AI Overview something like “what are the best AI sales tools?”.</P>
        <P>SEO is about ranking in Google's list of links. AEO is about being in the AI's answer, because more and more buyers build their shortlist there and never click a link.</P>
        <P style={{ margin: 0 }}>This walkthrough takes about 4 minutes. You'll learn to read each section, see what it means for Mutiny this week, and get one-click next steps. The page stays clickable the whole time.</P>
      </>,
    },
    {
      id: 'how', target: null, kicker: 'How it works', title: 'Where these numbers come from',
      read: <>
        <P>Our tracking tool, <b>Peec</b>, asks three AI engines the same buyer questions every day. Each question is a <Term>prompt</Term>.</P>
        <Flow />
        <P style={{ margin: 0 }}>For every answer Peec records <b>which brands were mentioned</b> (and in what order) and <b>which web pages the AI read</b> to write it. Everything on this page comes from those two records.</P>
      </>,
      insight: <>In the last 7 days that was <b>{f.answers.toLocaleString()} AI answers</b>. One prompt we track: “{f.briefs[0]?.text}”.</>,
    },
    {
      id: 'summary', target: 'summary', kicker: 'Read the week', title: 'Start with the summary',
      read: <P style={{ margin: 0 }}>The week in plain English, written from the numbers below. “This week” is the last 7 full days, compared with the 7 days before. Short on time? Read only this.</P>,
      insight: <>Mutiny's visibility is {upDown(visD)} {ptsAbs(visD)} to <b>{pct(f.m.visibility)}</b>. {f.riser && f.faller && f.riser.t.key !== f.faller.t.key ? <>Biggest topic gain: {f.riser.t.name} ({f.riser.d >= 0 ? '+' : ''}{(f.riser.d * 100).toFixed(1)} pts). Biggest drop: {f.faller.t.name} ({(f.faller.d * 100).toFixed(1)} pts).</> : null}</>,
    },
    {
      id: 'kpis', target: 'kpis', kicker: 'Read the week', title: 'The five scores',
      read: <>
        <P><Term>Visibility</Term>: share of AI answers that mention Mutiny. The headline number.</P>
        <P><b>Mentions</b>: how many times we came up. <b>Share of voice</b>: our slice of all brand mentions. <b>Sentiment</b> (0 to 100): how positively we're described; 65 to 85 is typical.</P>
        <P style={{ margin: 0 }}><b>Avg position</b>: where we appear in the answer's list. <b>Lower is better</b> (1 = named first). Green arrow = good move, red = bad. “pts” = percentage points.</P>
      </>,
      insight: <>About <b>1 in {Math.max(1, Math.round(1 / (f.m.visibility || 1)))}</b> AI answers mentions Mutiny. Avg position is {f.m.position?.toFixed(1)} (was {f.p.position?.toFixed(1)}){f.m.sentiment < 65 ? <>, and sentiment at {f.m.sentiment} is below the typical 65 to 85 range, worth watching</> : null}.</>,
      actions: [{ label: 'Which topic drove the change?', icon: CornerDownRight, run: () => ctx.goTo('topics') }],
      check: {
        q: 'Brand A has avg position 1.5, Brand B has 3.0. Which is usually named earlier?',
        options: ['Brand A (1.5)', 'Brand B (3.0)'], answer: 0,
        why: 'Position is a rank, so lower is better. Brand A usually appears first or second.',
      },
    },
    {
      id: 'landscape', target: 'landscape', kicker: 'Competition', title: 'Who is winning overall',
      read: <P style={{ margin: 0 }}>Every brand Peec tracks for us, ranked by visibility. Mutiny's row is purple. ▲ or ▼ next to a name = moved up or down since last week. “Flags” calls out the moves that matter.</P>,
      insight: <>Mutiny is <b>#{f.me.rank}</b>. {f.above ? <>{f.above.name} is just above, {ptsAbs(f.above.visibility - f.me.visibility)} ahead. </> : <>Nobody is above us. </>}{f.below ? <>{f.below.name} is right behind, {ptsAbs(f.me.visibility - f.below.visibility)} back. </> : null}{f.movers[0] ? <>Biggest mover: {f.movers[0].name} ({f.movers[0].d >= 0 ? '+' : ''}{(f.movers[0].d * 100).toFixed(1)} pts).</> : null}</>,
      actions: [{ label: 'See where they beat us, topic by topic', icon: CornerDownRight, run: () => ctx.goTo('topics') }],
    },
    {
      id: 'engines', target: 'engines', kicker: 'Competition', title: 'Each AI engine behaves differently',
      read: <P style={{ margin: 0 }}>ChatGPT, Google's AI Overview and Perplexity read different sources, so the same brand can score very differently on each. Green tile = the engine that treats us best. The chart shows 14 days; the dashed line is all three combined.</P>,
      insight: <>{f.topEngine?.name} mentions us most ({pct(f.topEngine?.cur.visibility)}), {f.lowEngine?.name} least ({pct(f.lowEngine?.cur.visibility)}). {f.engineMove ? <>Biggest swing this week: {f.engineMove.c.name}, {upDown(f.engineMove.d)} {ptsAbs(f.engineMove.d)}.</> : null}</>,
    },
    {
      id: 'topics', target: 'topics', kicker: 'Where to focus', title: 'Topics: strong and weak spots',
      read: <P style={{ margin: 0 }}>Prompts are grouped into five <Term>topics</Term>, the conversations we want to own. Each card shows Mutiny's five scores in that topic and who leads it. The weakest topic is where new content pays off most.</P>,
      insight: <>Strongest: <b>{f.best?.name}</b> ({pct(f.best?.mutiny.visibility)}, #{f.best?.mutiny.rank}). Weakest: <b>{f.worst?.name}</b> ({pct(f.worst?.mutiny.visibility)}, #{f.worst?.mutiny.rank}), led by {f.worst?.brands?.[0]?.brand} at {pct(f.worst?.brands?.[0]?.visibility)}.</>,
      actions: f.worst ? [{ label: `Show the content gaps for ${f.worst.name}`, icon: Filter, run: () => { ctx.filterBacklog({ topic: f.worst.key, status: 'gaps' }); ctx.goTo('backlog'); } }] : [],
    },
    {
      id: 'domains', target: 'domains', kicker: 'Sources', title: 'The websites AI reads',
      read: <>
        <P>Before answering, an AI searches the web. Reading a page = a <Term>retrieval</Term>. Linking it in the answer = a <Term>citation</Term>.</P>
        <P style={{ margin: 0 }}>Labels: <b>You</b> = us, <b>Competitor</b> = a tracked rival, <b>UGC</b> = community and review sites (Reddit, G2, YouTube, LinkedIn), <b>Corporate</b> = other companies. AI repeats what it reads, so getting onto these sites gets us mentioned.</P>
      </>,
      insight: <>mutinyhq.com was read in <b>{f.own?.cur?.chats?.toLocaleString()} chats</b> (was {f.own?.prev?.chats?.toLocaleString()}). {f.thirdParty ? <>The biggest community site is {f.thirdParty.domain} ({pct(f.thirdParty.retrieved)} of chats): being featured or discussed there puts Mutiny in front of the AI.</> : null}</>,
      actions: [{ label: 'See the exact pages AI links to', icon: CornerDownRight, run: () => ctx.goTo('urls') }],
      check: {
        q: 'A page is retrieved a lot but rarely cited. What does that mean?',
        options: ['The AI reads it but seldom links it in the answer', 'The AI links it in almost every answer', 'The page is broken'], answer: 0,
        why: 'Retrieved = read while researching. Cited = link shown to the reader. Both shape the answer; citations also send traffic.',
      },
    },
    {
      id: 'urls', target: 'urls', kicker: 'Sources', title: 'The exact pages being cited',
      read: <P style={{ margin: 0 }}>The individual pages AI links most, with citation counts. “Pos” = order the link appeared (1 = first). Notice the type: “best X tools” lists and “X alternatives” pages win a lot, which tells us what to write.</P>,
      insight: <><b>{f.citedWithoutUs} of the top {f.citedTotal}</b> cited pages don't mention Mutiny. Each one is a page to get added to, or to out-write.</>,
      actions: f.firstUrl ? [{ label: 'Open the #1 cited page', icon: ExternalLink, href: f.firstUrl.url }] : [],
    },
    {
      id: 'opps', target: 'opps', kicker: 'Next steps', title: "Peec's recommended actions",
      read: <P style={{ margin: 0 }}>Peec suggests actions where competitors get cited and we don't. <b>Owned</b> = work on our own site. <b>UGC</b> = show up on review and community sites. Each card adds a line tying it to this week's numbers.</P>,
      insight: f.opp ? <>Top suggestion: “{f.opp.title}” ({f.opp.impact?.toLowerCase()} impact, {f.opp.topic || 'sitewide'}).</> : null,
      actions: [
        { label: 'Open Peec Actions', icon: ExternalLink, href: 'https://app.peec.ai/actions/recommendations' },
        ...(f.opp?.topic ? (() => { const t = (aeo.topics || []).find((x) => x.name === f.opp.topic); return t ? [{ label: `Show our ${t.name} gaps`, icon: Filter, run: () => { ctx.filterBacklog({ topic: t.key, status: 'gaps' }); ctx.goTo('backlog'); } }] : []; })() : []),
      ],
    },
    {
      id: 'takeaways', target: 'takeaways', kicker: 'Next steps', title: 'What to focus on',
      read: <P style={{ margin: 0 }}>The week turned into 3 to 5 priorities. If you share one thing with your team, share this list.</P>,
      insight: f.takeaway ? <>#1 this week: {f.takeaway}</> : null,
    },
    {
      id: 'backlog', target: 'backlog', kicker: 'Content backlog', title: 'The to-do list',
      read: <>
        <P>Every tracked prompt gets a <Term>status</Term> from the last 30 days: <b>Absent</b> (we're on none of the 5 pages AI cites most), <b>Weak</b> (on one, but in under 10% of answers), <b>Present</b> (sometimes), <b>Winning</b> (half the answers or more).</P>
        <P style={{ margin: 0 }}>Gaps get a <Term>score</Term>: higher when competitors are cited instead of us, when many buyers ask it, and when the buyer is shopping (“best”, “alternatives”). Use the topic chips to filter.</P>
      </>,
      insight: <>{f.absent} of {f.nPrompts} prompts are Absent and {f.weak} are Weak. {brief ? <>Top priority{ctx.topic !== 'all' ? ' in this topic' : ''}: “{brief.text}” (score {brief.score}).</> : null}</>,
      actions: [
        brief && { label: 'Open the top brief', icon: FileText, run: () => { ctx.openBrief(brief.id); ctx.goTo('brief'); } },
        ctx.topic !== 'all' && { label: 'Show all topics again', icon: RotateCcw, run: () => ctx.filterBacklog({ topic: 'all' }) },
      ].filter(Boolean),
      check: {
        q: 'A prompt is “Absent” with score 7. What should we do?',
        options: ['Prioritize it: competitors own a popular question', 'Nothing, we already win it', 'Delete the prompt'], answer: 0,
        why: 'Absent = off the pages AI relies on. A high score = competitors are there and many buyers ask it. Top content priority.',
      },
    },
    {
      id: 'brief', target: 'brief', kicker: 'Content backlog', title: 'Turn a brief into a page',
      read: <>
        <P style={{ margin: '0 0 4px' }}>Click a card to open its brief. Everything a writer needs:</P>
        <ul style={{ margin: '0 0 8px', paddingLeft: 18 }}>
          <li><b>Top 5 cited URLs</b>: the pages to beat.</li>
          <li><b>Winning shape</b>: length, tables, FAQ, stats.</li>
          <li><b>Internal links</b>: Mutiny pages AI already cites.</li>
          <li><b>Mutiny lean</b>: how to mention us without sounding like an ad.</li>
        </ul>
        <P style={{ margin: 0 }}><b>Anchor</b> = the main piece for a topic. <b>Supplementary</b> pieces link back to it.</P>
      </>,
      insight: brief ? <>To win “{brief.text}”, aim for about <b>{brief.pattern?.targetWords?.toLocaleString()} words</b> shaped like the winners: {brief.pattern?.summary}</> : null,
      actions: brief ? [
        { label: 'Copy this brief for a writer', icon: Copy, run: () => ctx.copy(briefText(brief)), done: 'Copied to clipboard' },
        brief.top5?.[0] && { label: 'Open the #1 page to beat', icon: ExternalLink, href: brief.top5[0].url },
      ].filter(Boolean) : [],
    },
    {
      id: 'prompts', target: 'prompts', kicker: 'Content backlog', title: 'Every prompt in one table',
      read: <P style={{ margin: 0 }}>All tracked prompts with status and score. The dropdown switches between gaps, wins and everything. “Comp” = how many of the top 5 pages mention a competitor.</P>,
      insight: <>Mutiny is already winning <b>{f.winning}</b> prompts{f.wins[0] ? <>, best of all “{f.wins[0].text}” ({Math.round(f.wins[0].mutinyVis * 100)}% of answers)</> : null}. Protect those pages and link new content to them.</>,
      actions: [{ label: 'Show only our wins', icon: Filter, run: () => ctx.filterBacklog({ topic: 'all', status: 'winning' }) }],
    },
    {
      id: 'done', target: null, kicker: 'You made it', title: "You're ready to use this page",
      read: <>
        <P><b>Weekly routine:</b> read the summary, check the visibility arrow, find the weakest topic, then copy its top brief to a writer.</P>
        <div style={{ display: 'grid', gridTemplateColumns: 'max-content 1fr', gap: '3px 12px', fontSize: 12.5, margin: '0 0 10px' }}>
          <b>AEO</b><span>Getting your brand named in AI answers.</span>
          <b>Prompt</b><span>A buyer question Peec asks the AI daily.</span>
          <b>Visibility</b><span>Share of AI answers that mention us.</span>
          <b>Share of voice</b><span>Our share of all brand mentions.</span>
          <b>Position</b><span>Where we appear. Lower is better.</span>
          <b>Retrieval</b><span>The AI read a page.</span>
          <b>Citation</b><span>The AI linked that page in its answer.</span>
          <b>Backlog</b><span>Prompts we're losing, ranked by priority.</span>
        </div>
        <P style={{ margin: 0 }}>Replay anytime from the “Take the tour” button.</P>
      </>,
      actions: [
        f.worst && { label: `Start: gaps in ${f.worst.name}`, icon: Filter, run: () => { ctx.filterBacklog({ topic: f.worst.key, status: 'gaps' }); ctx.finish(); setTimeout(() => document.querySelector('[data-tour="backlog"]')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50); } },
        { label: 'Restart the tour', icon: RotateCcw, run: () => ctx.goTo('welcome') },
      ].filter(Boolean),
    },
  ];
}

function QuickCheck({ check }) {
  const [pick, setPick] = useState(null);
  const right = pick === check.answer;
  return (
    <div style={{ marginTop: 10, border: `1px solid ${C.black}`, borderRadius: 4, padding: '9px 11px', background: C.white }}>
      <div style={{ ...label, marginBottom: 3 }}>Quick check</div>
      <div style={{ fontWeight: 700, fontSize: 12.5, marginBottom: 7 }}>{check.q}</div>
      <div style={{ display: 'grid', gap: 5 }}>
        {check.options.map((o, i) => {
          const chosen = pick === i;
          const bg = pick == null ? C.white : i === check.answer ? C.lightGreen : chosen ? C.lightRed : C.white;
          return (
            <button key={o} type="button" onClick={() => setPick(i)} disabled={pick != null}
              style={{ all: 'unset', boxSizing: 'border-box', cursor: pick == null ? 'pointer' : 'default', border: `1px solid ${C.black}`, borderRadius: 6, padding: '5px 9px', fontSize: 12.5, background: bg, display: 'flex', alignItems: 'center', gap: 6 }}>
              {pick != null && i === check.answer && <Check size={13} strokeWidth={3} />}
              {pick != null && chosen && i !== check.answer && <X size={13} strokeWidth={3} />}
              {o}
            </button>
          );
        })}
      </div>
      {pick != null && <div role="status" style={{ fontSize: 12.5, marginTop: 7, lineHeight: 1.5 }}><b style={{ color: right ? C.up : C.down }}>{right ? 'Correct. ' : 'Not quite. '}</b>{check.why}</div>}
    </div>
  );
}

const label = { fontSize: 10.5, fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase', color: C.muted };

function ActionButton({ a, onDone }) {
  const [done, setDone] = useState(false);
  const Icon = a.icon || MousePointerClick;
  const style = { all: 'unset', boxSizing: 'border-box', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, width: '100%', border: `1px solid ${C.black}`, borderRadius: 6, padding: '7px 10px', fontSize: 12.5, fontWeight: 700, background: done ? C.lightGreen : C.white, boxShadow: `2px 2px 0 ${C.black}` };
  const inner = <><Icon size={14} strokeWidth={2.3} style={{ flexShrink: 0 }} /><span style={{ flex: 1 }}>{done && a.done ? a.done : a.label}</span>{done && <Check size={14} strokeWidth={3} />}</>;
  if (a.href) return <a className="aeo-tour-act" href={a.href} target="_blank" rel="noopener noreferrer" style={{ ...style, color: C.black, textDecoration: 'none' }}>{inner}</a>;
  return <button className="aeo-tour-act" type="button" style={style} onClick={() => { a.run(); setDone(true); onDone?.(); }}>{inner}</button>;
}

// --- Placement -------------------------------------------------------------------------------
const GAP = 16; const EDGE = 12; const W = 400;
function place(rect, size, vw, vh) {
  if (vw < 720) return { mode: 'sheet' };
  const h = size.h || 360;
  const r = { ...rect, right: rect.left + rect.width, bottom: rect.top + rect.height };
  const visTop = Math.max(r.top, 0); const visBot = Math.min(r.bottom, vh);
  const midY = (visTop + visBot) / 2;
  const clampTop = (t) => Math.min(Math.max(t, EDGE), vh - h - EDGE);
  const clampLeft = (l) => Math.min(Math.max(l, EDGE), vw - W - EDGE);
  if (vw - r.right >= W + GAP + EDGE) {
    const top = clampTop(midY - h / 2);
    return { mode: 'right', top, left: r.right + GAP, arrow: Math.min(Math.max(midY - top, 22), h - 22) };
  }
  if (r.left >= W + GAP + EDGE) {
    const top = clampTop(midY - h / 2);
    return { mode: 'left', top, left: r.left - GAP - W, arrow: Math.min(Math.max(midY - top, 22), h - 22) };
  }
  const anchorX = r.left + Math.min(r.width / 2, 120);
  if (vh - r.bottom >= h + GAP + EDGE) {
    const left = clampLeft(anchorX - 60);
    return { mode: 'below', top: r.bottom + GAP, left, arrow: Math.min(Math.max(anchorX - left, 22), W - 22) };
  }
  if (r.top >= h + GAP + EDGE) {
    const left = clampLeft(anchorX - 60);
    return { mode: 'above', top: r.top - GAP - h, left, arrow: Math.min(Math.max(anchorX - left, 22), W - 22) };
  }
  return { mode: 'corner' };
}

function Arrow({ pos }) {
  if (!['right', 'left', 'below', 'above'].includes(pos.mode)) return null;
  const base = { position: 'absolute', width: 14, height: 14, background: C.paper, transform: 'rotate(45deg)' };
  const b = `1px solid ${C.black}`;
  const s = {
    right: { left: -8, top: pos.arrow - 7, borderLeft: b, borderBottom: b },
    left: { right: -8, top: pos.arrow - 7, borderRight: b, borderTop: b },
    below: { top: -8, left: pos.arrow - 7, borderLeft: b, borderTop: b },
    above: { bottom: -8, left: pos.arrow - 7, borderRight: b, borderBottom: b },
  }[pos.mode];
  return <span aria-hidden style={{ ...base, ...s }} />;
}

// --- Tour ------------------------------------------------------------------------------------
export default function AeoTour({ open, onClose }) {
  const f = useMemo(facts, []);
  const [topic, setTopic] = useState('all');
  const [i, setI] = useState(0);
  const [rect, setRect] = useState(null);
  const [size, setSize] = useState({ w: W, h: 360 });
  const [view, setView] = useState({ w: typeof window !== 'undefined' ? window.innerWidth : 1200, h: typeof window !== 'undefined' ? window.innerHeight : 800 });
  const [toast, setToast] = useState(null);
  const cardRef = useRef(null);

  const briefForTopic = (f.briefs.find((b) => topic === 'all' || b.topic === topic)) || f.briefs[0];
  const finish = useCallback(() => {
    try { window.localStorage.setItem(TOUR_DONE_KEY, '1'); } catch (e) { /* ignore */ }
    onClose();
  }, [onClose]);

  const stepsRef = useRef([]);
  const ctx = {
    topic, brief: briefForTopic, finish,
    goTo: (id) => { const k = stepsRef.current.findIndex((s) => s.id === id); if (k >= 0) setI(k); },
    filterBacklog: (d) => { window.dispatchEvent(new CustomEvent('aeo:backlog', { detail: d })); if (d.topic) setTopic(d.topic); },
    openBrief: (id) => window.dispatchEvent(new CustomEvent('aeo:open-brief', { detail: id })),
    copy: (text) => {
      const ok = () => setToast('Brief copied. Paste it into a doc for your writer.');
      try { navigator.clipboard.writeText(text).then(ok, () => setToast('Copy blocked by the browser. Open the brief and copy it by hand.')); } catch (e) { setToast('Copy blocked by the browser.'); }
    },
  };
  const all = buildSteps(f, ctx);
  // Drop steps whose target isn't on the page (checked when the tour opens).
  const [present, setPresent] = useState(null);
  useEffect(() => {
    if (!open) return;
    setPresent(new Set(all.filter((s) => !s.target || document.querySelector(`[data-tour="${s.target}"]`)).map((s) => s.id)));
    setI(0); setTopic('all');
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const steps = present ? all.filter((s) => present.has(s.id)) : all;
  stepsRef.current = steps;
  const step = steps[Math.min(i, steps.length - 1)];

  const measure = useCallback(() => {
    setView({ w: window.innerWidth, h: window.innerHeight });
    const el = step?.target && document.querySelector(`[data-tour="${step.target}"]`);
    if (!el) { setRect(null); return; }
    const r = el.getBoundingClientRect();
    setRect({ top: r.top, left: r.left, width: r.width, height: r.height });
  }, [step?.target]);

  useLayoutEffect(() => {
    if (!open || !step) return undefined;
    setToast(null);
    const el = step.target && document.querySelector(`[data-tour="${step.target}"]`);
    if (el) {
      const y = el.getBoundingClientRect().top + window.scrollY - 28;
      const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      window.scrollTo({ top: Math.max(0, y), behavior: reduce ? 'auto' : 'smooth' });
    }
    measure();
    const ts = [200, 450, 900].map((ms) => setTimeout(measure, ms));
    window.addEventListener('scroll', measure, { passive: true });
    window.addEventListener('resize', measure);
    cardRef.current?.focus({ preventScroll: true });
    return () => { ts.forEach(clearTimeout); window.removeEventListener('scroll', measure); window.removeEventListener('resize', measure); };
  }, [open, step?.id, measure]); // eslint-disable-line react-hooks/exhaustive-deps

  useLayoutEffect(() => {
    if (!cardRef.current) return;
    const h = cardRef.current.offsetHeight; const w = cardRef.current.offsetWidth;
    if (Math.abs(h - size.h) > 2 || Math.abs(w - size.w) > 2) setSize({ w, h });
  });

  const next = useCallback(() => (i >= steps.length - 1 ? finish() : setI((v) => v + 1)), [i, steps.length, finish]);
  const back = useCallback(() => setI((v) => Math.max(0, v - 1)), []);
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.target?.tagName === 'SELECT' || e.target?.tagName === 'INPUT') return;
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowRight') next();
      else if (e.key === 'ArrowLeft') back();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, next, back, onClose]);

  if (!open || !step) return null;
  const centered = !step.target || !rect;
  const pos = centered ? { mode: 'center' } : place(rect, size, view.w, view.h);
  const pad = 8;
  const hole = rect && !centered && {
    top: rect.top - pad, left: rect.left - pad, width: rect.width + pad * 2, height: rect.height + pad * 2,
  };
  const last = i === steps.length - 1;
  const cardPos = {
    center: { top: '50%', left: '50%', transform: 'translate(-50%, -50%)', width: view.w < 720 ? 'calc(100vw - 24px)' : 520, maxHeight: 'calc(100vh - 32px)' },
    sheet: { left: 12, right: 12, bottom: 12, maxHeight: '60vh' },
    corner: { right: 24, bottom: 24, width: W, maxHeight: 'calc(100vh - 48px)' },
  }[pos.mode] || { top: pos.top, left: pos.left, width: W, maxHeight: `calc(100vh - ${EDGE * 2}px)` };

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 3000, pointerEvents: 'none', fontFamily: FONT_BODY, color: C.black }}>
      <style>{'.aeo-tour-act:hover{box-shadow:3px 3px 0 #000!important;background:#F2D1FC!important}.aeo-tour-act:focus-visible{outline:2px solid #000;outline-offset:2px}'}</style>
      {centered
        ? <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', pointerEvents: 'auto' }} />
        : hole && <div style={{ position: 'fixed', ...hole, borderRadius: 6, boxShadow: '0 0 0 9999px rgba(0,0,0,0.45)', outline: `3px solid ${C.purple}`, transition: 'top 200ms ease, left 200ms ease, width 200ms ease, height 200ms ease' }} />}
      <div ref={cardRef} tabIndex={-1} role="dialog" aria-modal="false" aria-labelledby="aeo-tour-title"
        style={{ position: 'fixed', ...cardPos, overflow: 'visible', pointerEvents: 'auto', background: C.paper, border: `1px solid ${C.black}`, borderRadius: 6, boxShadow: `4px 4px 0 ${C.black}`, outline: 'none', fontSize: 13, lineHeight: 1.5, transition: pos.mode === 'center' ? undefined : 'top 200ms ease, left 200ms ease' }}>
        <Arrow pos={pos} />
        <div style={{ maxHeight: 'inherit', overflowY: 'auto', padding: '16px 18px 14px', boxSizing: 'border-box' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            <span style={label}>{step.kicker} · {i + 1} of {steps.length}</span>
            <button type="button" onClick={onClose} aria-label="Close tour" style={{ all: 'unset', cursor: 'pointer', display: 'inline-flex', padding: 2, borderRadius: 999 }}><X size={16} /></button>
          </div>
          <div style={{ display: 'flex', gap: 3, margin: '8px 0 10px' }} aria-hidden>
            {steps.map((s, k) => (
              <button key={s.id} type="button" tabIndex={-1} onClick={() => setI(k)} title={s.title}
                style={{ all: 'unset', cursor: 'pointer', flex: 1, height: 5, borderRadius: 2, background: k < i ? C.purple : k === i ? C.black : C.lightGrey }} />
            ))}
          </div>
          <h2 id="aeo-tour-title" aria-live="polite" style={{ fontFamily: FONT_DISPLAY, fontWeight: 400, fontSize: 22, letterSpacing: '-0.02em', lineHeight: 1.15, margin: '0 0 8px' }}>{step.title}</h2>
          {step.target && <div style={{ ...label, marginBottom: 3 }}>How to read it</div>}
          <div>{step.read}</div>
          {step.insight && (
            <div style={{ marginTop: 10, padding: '8px 11px', background: C.lightPurple, border: `1px solid ${C.black}`, borderRadius: 4 }}>
              <div style={{ ...label, color: C.black, display: 'flex', alignItems: 'center', gap: 5, marginBottom: 2 }}><Lightbulb size={12} strokeWidth={2.5} /> What this means{step.target ? ' this week' : ''}</div>
              <div style={{ fontSize: 12.5 }}>{step.insight}</div>
            </div>
          )}
          {step.actions?.length > 0 && (
            <div style={{ marginTop: 10 }}>
              <div style={{ ...label, display: 'flex', alignItems: 'center', gap: 5, marginBottom: 5 }}><MousePointerClick size={12} strokeWidth={2.5} /> Do this</div>
              <div style={{ display: 'grid', gap: 6 }}>{step.actions.map((a) => <ActionButton key={`${step.id}-${a.label}`} a={a} onDone={() => setTimeout(measure, 300)} />)}</div>
              {toast && <div role="status" style={{ fontSize: 12, marginTop: 6, color: C.up, fontWeight: 700 }}>{toast}</div>}
            </div>
          )}
          {step.check && <QuickCheck key={step.id} check={step.check} />}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginTop: 14 }}>
            {i === 0
              ? <button type="button" onClick={onClose} style={{ all: 'unset', cursor: 'pointer', fontSize: 12.5, fontWeight: 700, color: C.muted, textDecoration: 'underline' }}>Skip tour</button>
              : <button type="button" onClick={back} style={btn(C.white)}><ArrowLeft size={14} /> Back</button>}
            <span style={{ fontSize: 11, color: C.muted }}>{view.w >= 720 ? '← → keys work' : ''}</span>
            <button type="button" onClick={next} style={btn(C.black, C.white)}>{i === 0 ? 'Start the tour' : last ? 'Finish' : 'Next'} {!last && <ArrowRight size={14} />}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function btn(bg, color = C.black) {
  return { all: 'unset', boxSizing: 'border-box', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6, border: `1px solid ${C.black}`, borderRadius: 6, padding: '7px 14px', fontSize: 13, fontWeight: 700, background: bg, color };
}

// For scripts that check every step renders (no effect on the page).
export const __tourInternals = { facts, buildSteps, briefText };
