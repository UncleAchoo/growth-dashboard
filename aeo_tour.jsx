// ---------------------------------------------------------------------------
// AEO interactive walkthrough (Nick, Oct 27 2026; updated Oct 28 for Matt's
// AEO model and Jon's Peec reset). A beginner tour of the ?aeo page, started
// from the "New to AEO? Take the tour" button.
//
// Each step spotlights one element (data-tour="<id>" in aeo_section.jsx) with
// a tooltip anchored beside, below or above it (pointer arrow included), and
// carries three layers:
//   1. How to read it   plain English for someone new to AEO
//   2. What this means  a live insight computed from src/aeo.json, so it stays
//                       true after every refresh
//   3. Do this          one-click actions that act on the page: filter the
//                       backlog, open the top brief, copy a brief or the Jaleh
//                       update, open the page to beat, jump to a related step
// plus three quick knowledge checks. The page stays clickable during the tour.
// Steps whose target isn't rendered are skipped. Never compares topics with
// each other (Matt): topic insights compare Mutiny with that topic's leader.
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

// --- Live facts ---------------------------------------------------------------------
function facts() {
  const brands = aeo.brands || [];
  const me = brands.find((b) => b.own) || {};
  const m = aeo.mutiny?.cur || {};
  const L = aeo.mutiny?.ladder || {};
  const topics = aeo.topics || [];
  // Priority topic: the one named for AI sales assistants if present, else the
  // first topic where Mutiny isn't named. No cross-topic ranking.
  const focus = topics.find((t) => /assistant/i.test(t.name)) || topics.find((t) => !t.mutiny) || topics[0];
  const channels = (aeo.channels || []).filter((c) => c.cur);
  const engines = [...channels].sort((a, b) => b.cur.visibility - a.cur.visibility);
  const prompts = aeo.backlog?.prompts || [];
  const count = (s) => prompts.filter((x) => x.status === s).length;
  const O = aeo.outreach || {};
  const firstTarget = (O.targets || [])[0];
  const croTop = (aeo.cro?.rows || []).filter((r) => r.framing === 'cro').sort((a, b) => b.retrievals - a.retrievals)[0];
  const J = aeo.jaleh || {}; const w = J.weeks || [];
  return {
    me, m, L, brands, leader: brands[0],
    answers: channels.reduce((s, c) => s + (c.cur?.responses || 0), 0),
    focus, topEngine: engines[0], lowEngine: engines[engines.length - 1],
    own: aeo.domains?.own,
    firstUrl: (aeo.topCitedUrls || [])[0],
    briefs: aeo.backlog?.briefs || [],
    wins: aeo.backlog?.wins || [],
    nPrompts: aeo.backlog?.evaluated,
    absent: count('absent'), weak: count('weak'), present: count('present'), winning: count('winning'),
    heads: prompts.filter((x) => x.head).length,
    opp: aeo.opportunities?.items?.[0],
    takeaway: aeo.narrative?.takeaways?.[0],
    O, firstTarget, croTop, croCount: aeo.cro?.cro || 0,
    lastWeek: w[w.length - 1], prevWeek: w[w.length - 2],
    reset: aeo.promptSet,
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
    'Pages to beat (top 5 AI reads for this question):',
    ...b.top5.map((u, i) => `${i + 1}. ${u.title || u.url} - ${u.url} (${u.retrievals} reads, ${u.citations} citations)`),
    '',
    `Winning shape: ${p.summary || 'n/a'}`,
    `Structure: H1 = the exact question. A 40-60 word answer right under it. Fan-out H2s that go deeper, each opening with a direct answer. About ${p.targetWords?.toLocaleString?.() || '?'} words. ${p.withTable >= Math.ceil((p.analyzed || 1) / 2) ? 'Include a comparison table. ' : ''}End with an FAQ (up to 9 Q&As). Verifiable specifics: at least ${Math.max(5, p.medianStats || 0)} sourced stats, named sources, expert quotes.`,
    p.sharedSources?.length ? `Sources the winners cite: ${p.sharedSources.map((s) => s.domain).join(', ')}` : null,
    '',
    'Internal Mutiny links:',
    ...(b.internalLinks || []).slice(0, 5).map((l) => `- ${l.title}: ${l.url}`),
    lean ? `\nMutiny lean: ${lean}` : null,
    '\nRules: position Mutiny as an AI sales assistant (never website personalization / CRO); no invented stats, customers or quotes (use [PLACEHOLDER: ...]); no em or en dashes.',
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
      <div style={box}><b>2. AI engine</b><br />searches + reads</div>{arrow}
      <div style={box}><b>3. Answer</b><br />names brands</div>{arrow}
      <div style={{ ...box, background: C.lightPurple }}><b>4. Peec logs</b><br />mentions + sources</div>
    </div>
  );
}

// --- Steps ----------------------------------------------------------------------------------
// target: data-tour id (null = centered). read: how to read it. insight: what it
// means now. actions: [{label, icon, run(ctx) | href, done}]. check: quiz.
function buildSteps(f, ctx) {
  const brief = ctx.brief;
  return [
    {
      id: 'welcome', target: null, kicker: 'Welcome', title: 'What is AEO?',
      read: <>
        <P><Term>AEO</Term> means answer engine optimization: getting Mutiny <b>named inside the answer</b> when a buyer asks ChatGPT, Perplexity or Google's AI Overview something like “what's the best AI sales assistant?”.</P>
        <P>SEO is about ranking in Google's list of links. AEO is about being in the AI's answer. Someone asking that question is already shopping, so being named is a high-intent moment.</P>
        <P style={{ margin: 0 }}>A fair warning from Matt, who ran AEO before: it compounds slowly and stalls when the work stops. It's a long game. This walkthrough takes about 4 minutes.</P>
      </>,
    },
    {
      id: 'how', target: null, kicker: 'How it works', title: 'Where these numbers come from',
      read: <>
        <P>To answer a question, an AI runs several searches, reads pages and looks for agreement across sources. Our tool, <b>Peec</b>, asks three AI engines the same buyer questions every day. Each question is a <Term>prompt</Term>.</P>
        <Flow />
        <P style={{ margin: 0 }}>For every answer Peec logs which brands were named (and in what order) and which pages the AI read. Everything on this page comes from those two records.</P>
      </>,
      insight: <>{f.reset ? <>Peec was reset on {f.reset.since.slice(5).replace('-', '/')} with {f.reset.prompts} new prompts across {f.reset.topics} topics, so we're on day one of a new baseline. </> : null}So far that's <b>{f.answers.toLocaleString()} AI answers</b>.</>,
    },
    {
      id: 'summary', target: 'summary', kicker: 'Read the week', title: 'Start with the summary',
      read: <P style={{ margin: 0 }}>The state of play in plain English, written from the numbers below. Short on time? Read only this. Arrows appear once there's a full comparable week to compare against.</P>,
    },
    {
      id: 'ladder', target: 'ladder', kicker: 'Read the week', title: 'The ladder: read, linked, named',
      read: <>
        <P>Matt's three steps, from easiest to hardest:</P>
        <P><b>1. Retrieved</b>: the AI <i>read</i> one of our pages while researching. We're in the game.</P>
        <P><b>2. Cited</b>: the AI <i>linked</i> our page in its answer. Our content is specific enough to use.</P>
        <P style={{ margin: 0 }}><b>3. Visible</b>: the AI <i>named</i> Mutiny. That's the goal and the hardest step to move.</P>
      </>,
      insight: <>The AI reads mutinyhq.com in <b>{pct(f.L.retrieved)}</b> of chats, links it in <b>{pct(f.L.cited)}</b>, and names Mutiny in <b>{pct(f.L.visibility)}</b> of answers. The biggest drop is the step to focus on.</>,
      check: {
        q: 'Which step tells you a buyer heard the name Mutiny?',
        options: ['Visible (named)', 'Retrieved (read)', 'Cited (linked)'], answer: 0,
        why: 'Retrieved and cited are about our pages. Visible means the answer itself recommends Mutiny by name.',
      },
    },
    {
      id: 'kpis', target: 'kpis', kicker: 'Read the week', title: 'The supporting scores',
      read: <>
        <P><b>Mentions</b>: how many times we were named. <b>Share of voice</b>: our slice of all brand mentions.</P>
        <P><b>Sentiment</b>: how positively we're described. About 50 is neutral; higher is better. It mostly comes from reviews and community posts like G2.</P>
        <P style={{ margin: 0 }}><b>Avg position</b>: where we appear in the answer's list. <b>Lower is better</b> (1 = named first).</P>
      </>,
      insight: <>When Mutiny is named, it's at position <b>{f.m.position?.toFixed(1)}</b> on average, and sentiment is <b>{f.m.sentiment}</b>{f.m.sentiment >= 50 ? ' (above neutral)' : ' (below neutral)'}.</>,
      check: {
        q: 'Brand A has avg position 1.5, Brand B has 3.0. Which is usually named earlier?',
        options: ['Brand A (1.5)', 'Brand B (3.0)'], answer: 0,
        why: 'Position is a rank, so lower is better. Brand A usually comes first or second.',
      },
    },
    {
      id: 'ask', target: 'ask', kicker: 'Learning', title: 'Ask Claude anytime',
      read: <P style={{ margin: 0 }}>Stuck on a number or a term? Type a question here, or use the <b>Ask Claude</b> button on any card. Claude opens in a new tab with a short AEO primer and that section's numbers already attached, so you can keep asking follow-ups there. Cards with an <b>Open in Peec</b> link jump to the same view in Peec, so you can match what you see here to the source.</P>,
    },
    {
      id: 'jaleh', target: 'jaleh', kicker: 'Reporting', title: 'The weekly update for Jaleh',
      read: <P style={{ margin: 0 }}>Matt's format for the exec update: what we did, how visibility moved, a directional read on signups from AI, and what's next. Signups are self-reported because AI tools rarely pass referral data, so treat them as direction, never as exact attribution.</P>,
      insight: f.lastWeek ? <>Last full week, <b>{f.lastWeek.aeo}</b> people said they found us through an AI tool and <b>{f.lastWeek.searchAeo}</b> said search or AI{f.prevWeek ? ` (prior week ${f.prevWeek.aeo} and ${f.prevWeek.searchAeo})` : ''}.</> : null,
      actions: [{ label: 'Jump to the update card', icon: CornerDownRight, run: () => document.querySelector('[data-tour="jaleh"]')?.scrollIntoView({ behavior: 'smooth', block: 'start' }) }],
    },
    {
      id: 'landscape', target: 'landscape', kicker: 'Competition', title: 'Who AI engines name',
      read: <P style={{ margin: 0 }}>Every tracked brand, ranked by visibility. The overall list mixes categories (call recording tools next to sales enablement tools), so use the topic buttons to compare like with like. Mutiny's row is purple.</P>,
      insight: <>Overall, {f.leader?.name} leads at {pct(f.leader?.visibility)} and Mutiny is <b>#{f.me.rank}</b> at {pct(f.me.visibility)}. Click a topic button to see the race that matters.</>,
      check: {
        q: 'Mutiny is at 30% in Topic A and 5% in Topic B. Can you say Topic A is going better?',
        options: ['Not from that alone: compare each with its own leader', 'Yes, 30% beats 5%'], answer: 0,
        why: 'Matt\'s rule: topics name different numbers of brands, so raw visibility across topics misleads. Compare Mutiny with the leader inside each topic.',
      },
    },
    {
      id: 'engines', target: 'engines', kicker: 'Competition', title: 'Each AI engine behaves differently',
      read: <P style={{ margin: 0 }}>ChatGPT, Google's AI Overview and Perplexity read different sources, so the same brand can score very differently on each. Green tile = the engine that names us most.</P>,
      insight: f.topEngine ? <>{f.topEngine.name} names Mutiny most ({pct(f.topEngine.cur.visibility)}), {f.lowEngine.name} least ({pct(f.lowEngine.cur.visibility)}).</> : null,
    },
    {
      id: 'topics', target: 'topics', kicker: 'Where to focus', title: 'Topics: one race each',
      read: <P style={{ margin: 0 }}>Prompts are grouped into <Term>topics</Term>, the conversations we want to own. Each card shows Mutiny against that topic's leader and the gap to close. The “What to do” line says where to start.</P>,
      insight: f.focus ? <>In <b>{f.focus.name}</b>, {f.focus.leader?.brand} leads at {pct(f.focus.leader?.visibility)} and Mutiny {f.focus.mutiny ? <>is #{f.focus.mutiny.rank} at {pct(f.focus.mutiny.visibility)}</> : 'isn\'t named yet'}.</> : null,
      actions: f.focus ? [{ label: `Show the content gaps for ${f.focus.name}`, icon: Filter, run: () => { ctx.filterBacklog({ topic: f.focus.key, status: 'gaps' }); ctx.goTo('backlog'); } }] : [],
    },
    {
      id: 'cro', target: 'cro', kicker: 'Priority 1', title: 'Fix how the web describes us',
      read: <P style={{ margin: 0 }}>AI repeats what it reads. Some sites still describe Mutiny as a website personalization / A/B testing tool, its old product. Until those are fixed, AI keeps putting us in the wrong category. Matt calls this the biggest risk and priority 1.</P>,
      insight: f.croTop ? <><b>{f.croCount}</b> pages still use the old framing. The most read is {f.croTop.title} ({f.croTop.retrievals} reads).</> : null,
      actions: f.croTop ? [{ label: 'Open the most read one', icon: ExternalLink, href: f.croTop.url }] : [],
    },
    {
      id: 'domains', target: 'domains', kicker: 'Sources', title: 'The websites AI reads',
      read: <>
        <P>The sites AI pulls from most for our topics. Labels: <b>You</b> = us, <b>Competitor</b> = a tracked rival, <b>UGC</b> = community and review sites (G2, YouTube, Reddit, LinkedIn), <b>Corporate</b> = other companies.</P>
        <P style={{ margin: 0 }}>Matt: almost all citations come from a tiny slice of the internet. This table is that slice.</P>
      </>,
      insight: <>mutinyhq.com is the <b>#{f.own?.rank}</b> most read domain ({f.own?.cur?.chats?.toLocaleString()} chats) and cited in {pct(f.own?.cur?.cited)} of chats.</>,
      check: {
        q: 'A page is read a lot but rarely cited. What does that mean?',
        options: ['The AI uses it for research but seldom links it', 'The AI links it in almost every answer', 'The page is broken'], answer: 0,
        why: 'Read = used while researching. Cited = linked for the reader. A 40 to 60 word direct answer under each heading makes a page easier to cite.',
      },
    },
    {
      id: 'urls', target: 'urls', kicker: 'Sources', title: 'The exact pages being cited',
      read: <P style={{ margin: 0 }}>The individual pages AI links most. Notice the shapes that win: “best X tools” lists and “X alternatives” pages. Each row says whether Mutiny is on it.</P>,
      actions: f.firstUrl ? [{ label: 'Open the most cited page', icon: ExternalLink, href: f.firstUrl.url }] : [],
    },
    {
      id: 'outreach', target: 'outreach', kicker: 'Off-site', title: 'Get onto the top 50',
      read: <P style={{ margin: 0 }}>Matt's “currency exchange”: our best pages are the currency. Ask the sites behind the most read lists to include Mutiny, and offer to include them in ours. Smaller <b>challenger</b> sites usually say yes; incumbents rarely do. Once we're on enough of these, new AI-written lists start including us on their own.</P>,
      insight: <>Mutiny is on <b>{f.O.top50With} of the top 50</b>. {f.firstTarget ? <>First swap to pitch: {f.firstTarget.domain} (#{f.firstTarget.rank}).</> : null}</>,
      actions: f.firstTarget ? [{ label: `Open ${f.firstTarget.domain}'s list`, icon: ExternalLink, href: f.firstTarget.url }] : [],
    },
    {
      id: 'opps', target: 'opps', kicker: 'Next steps', title: "Peec's recommended actions",
      read: <P style={{ margin: 0 }}>Peec suggests actions where competitors get cited and we don't. <b>Owned</b> = work on our site. <b>UGC</b> = review and community sites. Each card adds a line tying it to the current numbers.</P>,
      insight: f.opp ? <>Top suggestion: “{f.opp.title}”.</> : null,
      actions: [{ label: 'Open Peec Actions', icon: ExternalLink, href: 'https://app.peec.ai/actions/recommendations' }],
    },
    {
      id: 'takeaways', target: 'takeaways', kicker: 'Next steps', title: 'What to focus on',
      read: <P style={{ margin: 0 }}>The state of play turned into 3 to 5 priorities. If you share one thing with your team, share this list.</P>,
      insight: f.takeaway ? <>#1: {f.takeaway}</> : null,
    },
    {
      id: 'backlog', target: 'backlog', kicker: 'Content backlog', title: 'The to-do list',
      read: <>
        <P>Every tracked prompt gets a <Term>status</Term>: <b>Absent</b> (Mutiny in none of the answers), <b>Weak</b> (under 10%), <b>Present</b> (10 to 49%), <b>Winning</b> (half or more).</P>
        <P style={{ margin: 0 }}>Gaps get a <Term>score</Term>: higher when rival brands own the question, when many buyers ask it, and when the buyer is shopping. Broad <b>head terms</b> lose a point because Matt found they barely move; niche questions are where to win.</P>
      </>,
      insight: <>{f.absent} of {f.nPrompts} prompts are Absent. {brief ? <>Top priority{ctx.topic !== 'all' ? ' in this topic' : ''}: “{brief.text}” (score {brief.score}).</> : null}</>,
      actions: [
        brief && { label: 'Open the top brief', icon: FileText, run: () => { ctx.openBrief(brief.id); ctx.goTo('brief'); } },
        ctx.topic !== 'all' && { label: 'Show all topics again', icon: RotateCcw, run: () => ctx.filterBacklog({ topic: 'all' }) },
      ].filter(Boolean),
      check: {
        q: 'A prompt is “Absent” with a high score. What should we do?',
        options: ['Prioritize it: rivals own a question buyers ask', 'Nothing, we already win it', 'Delete the prompt'], answer: 0,
        why: 'Absent = the AI never names us there. A high score = rivals do and many buyers ask it.',
      },
    },
    {
      id: 'brief', target: 'brief', kicker: 'Content backlog', title: 'Turn a brief into a page',
      read: <>
        <P style={{ margin: '0 0 4px' }}>Each brief has what a writer needs:</P>
        <ul style={{ margin: '0 0 8px', paddingLeft: 18 }}>
          <li><b>Top 5 pages</b> the AI reads for this question: the ones to beat.</li>
          <li><b>Winning shape</b>: length, tables, FAQ, stats.</li>
          <li><b>Matt's structure</b>: H1 = the exact question, a 40 to 60 word answer right under it, deeper H2s, verifiable specifics.</li>
          <li><b>Mutiny lean</b>: how to mention us without sounding like an ad.</li>
        </ul>
        <P style={{ margin: 0 }}>Recency matters: AI favors fresh content, so a steady publishing cadence beats one big push.</P>
      </>,
      insight: brief ? <>To win “{brief.text}”, aim for about <b>{brief.pattern?.targetWords?.toLocaleString()} words</b>. {brief.pattern?.summary}</> : null,
      actions: brief ? [
        { label: 'Copy this brief for a writer', icon: Copy, run: () => ctx.copy(briefText(brief)), done: 'Copied to clipboard' },
        brief.top5?.[0] && { label: 'Open the #1 page to beat', icon: ExternalLink, href: brief.top5[0].url },
      ].filter(Boolean) : [],
    },
    {
      id: 'prompts', target: 'prompts', kicker: 'Content backlog', title: 'Every prompt in one table',
      read: <P style={{ margin: 0 }}>All tracked prompts with status, who owns each one, and the score. The dropdown switches between gaps, wins and everything. A “head” tag marks broad prompts that are hard to move.</P>,
      insight: <>Mutiny already shows up on <b>{f.wins.length}</b> prompts{f.wins[0] ? <>, best on “{f.wins[0].text}” ({Math.round(f.wins[0].mutinyVis * 100)}% of answers)</> : null}. Protect those pages and link new content to them.</>,
      actions: [{ label: 'Show only where we show up', icon: Filter, run: () => ctx.filterBacklog({ topic: 'all', status: 'present' }) }],
    },
    {
      id: 'done', target: null, kicker: 'You made it', title: "You're ready to use this page",
      read: <>
        <P><b>Weekly routine:</b> read the summary, check the ladder, fix one CRO page, pitch one swap from the outreach list, ship briefs from the backlog, then copy the Jaleh update.</P>
        <div style={{ display: 'grid', gridTemplateColumns: 'max-content 1fr', gap: '3px 12px', fontSize: 12.5, margin: '0 0 10px' }}>
          <b>AEO</b><span>Getting Mutiny named in AI answers.</span>
          <b>Prompt</b><span>A buyer question Peec asks the AI daily.</span>
          <b>Retrieved</b><span>The AI read our page.</span>
          <b>Cited</b><span>The AI linked our page.</span>
          <b>Visible</b><span>The AI named Mutiny.</span>
          <b>Position</b><span>Where we appear. Lower is better.</span>
          <b>Head term</b><span>A broad prompt that barely moves.</span>
          <b>Top 50</b><span>The pages AI reads most; get on them.</span>
        </div>
        <P style={{ margin: 0 }}>Replay anytime from the “Take the tour” button.</P>
      </>,
      actions: [
        f.focus && { label: `Start: gaps in ${f.focus.name}`, icon: Filter, run: () => { ctx.filterBacklog({ topic: f.focus.key, status: 'gaps' }); ctx.finish(); setTimeout(() => document.querySelector('[data-tour="backlog"]')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50); } },
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
