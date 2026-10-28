// ---------------------------------------------------------------------------
// "Ask Claude" for the ?aeo page (Nick, Oct 28 2026). The dashboard is a static
// GitHub Pages site, so there's no server to hold an AI key. Instead each
// section gets an "Ask Claude" button: the viewer types (or picks) a question,
// and we open claude.ai in a new tab with a prompt that already contains
// 1) a short AEO primer in Matt Ratchford's model, 2) the numbers behind that
// section from src/aeo.json, and 3) the question. Needs a Claude account.
// claude.ai/new?q= prefills the composer; prompts are capped so the URL stays
// a safe length.
// ---------------------------------------------------------------------------
import React, { useEffect, useRef, useState } from 'react';
import { MessageCircle, X, ExternalLink } from 'lucide-react';
import aeo from './src/aeo.json';

const C = { black: '#000', white: '#fff', paper: '#FAF8F4', purple: '#A73BF5', lightPurple: '#F2D1FC', muted: 'rgba(0,0,0,0.55)', lightGrey: '#EFEFEF' };
const FONT_BODY = "'Manrope', 'KMR Waldenburg', Arial, sans-serif";
const pct = (v) => (v == null ? 'n/a' : `${(v * 100).toFixed(1)}%`);
const MAX_PROMPT = 5000; // keeps the claude.ai URL comfortably short once encoded

const PRIMER = [
  'You are helping a Mutiny teammate who is new to AEO (answer engine optimization) understand our AEO dashboard. Explain in plain English, be concrete, and suggest a next step when it helps.',
  'Context: Mutiny (mutinyhq.com) sells an AI sales assistant for B2B AEs that builds personalized sales assets, deal rooms and business cases. It used to sell website personalization / A/B testing, and part of the web still describes it that way, which we are fixing.',
  'Data comes from Peec AI, which asks ChatGPT, Google AI Overview and Perplexity the same buyer questions (prompts) every day and logs which brands each answer names and which web pages it read.',
  'How we read it (from Matt Ratchford, who led AEO before): retrieval = the AI read our page; citation = it linked our page; visibility = it named Mutiny (the goal, hardest to move). Compare Mutiny only within a topic, never topic against topic. Sentiment around 50 is neutral. Broad head terms barely move; niche prompts are where to win. Best on-site structure: H1 = the exact question, a 40 to 60 word answer under it, deeper H2s, an FAQ, verifiable stats and sources. Off-site: get onto the most-read lists by swapping inclusions with smaller challenger sites; reviews (G2), YouTube, Reddit (real UGC only) and LinkedIn carry weight. AI favors recent content, so cadence matters. AEO compounds slowly; it is a long game.',
  aeo.promptSet ? `Note: Peec was reset on ${aeo.promptSet.since} to ${aeo.promptSet.prompts} prompts across ${aeo.promptSet.topics} topics, so the data is a new baseline with no week-over-week comparison yet.` : null,
  `Data window: ${aeo.windows?.cur?.start} to ${aeo.windows?.cur?.end}.`,
].filter(Boolean).join('\n\n');

function buildPrompt(section, context, question) {
  const head = `${PRIMER}\n\nThe viewer is looking at the "${section}" section. Here is its data:\n`;
  const tail = `\n\nTheir question: ${question || '(no question yet: explain what this section shows and what we should do about it)'}`;
  const room = MAX_PROMPT - head.length - tail.length;
  const ctx = context.length > room ? `${context.slice(0, Math.max(0, room - 20))}\n[truncated]` : context;
  return head + ctx + tail;
}

export function openClaude(section, context, question) {
  const url = `https://claude.ai/new?q=${encodeURIComponent(buildPrompt(section, context, question))}`;
  window.open(url, '_blank', 'noopener,noreferrer');
}

// Compact text versions of each section's data, for the prompt.
export const ctx = {
  summary() {
    const m = aeo.mutiny.cur; const L = aeo.mutiny.ladder;
    return [`Summary: ${aeo.narrative?.summary || ''}`,
      `Ladder: retrieved ${pct(L.retrieved)} of chats, cited ${pct(L.cited)}, visible (named) ${pct(L.visibility)}. mutinyhq.com is the #${L.domainRank} most-read domain.`,
      `Mentions ${m.mentions}, share of voice ${pct(m.sov)}, sentiment ${m.sentiment}, avg position ${m.position}, rank #${m.rank} of ${aeo.brands.length} tracked brands.`].join('\n');
  },
  jaleh() {
    const w = aeo.jaleh?.weeks || [];
    return ['Weekly signups (self-reported "how did you hear about us"), per week: start, signups, named an AI tool, search or AI, AI referral visitors:',
      ...w.map((x) => `${x.start}: ${x.signups} signups, ${x.aeo} AI, ${x.searchAeo} search+AI, ${x.aiVisitors ?? '?'} AI referral visitors`),
      `What we did: ${(aeo.jaleh?.did || []).join(' | ')}`, `Next: ${(aeo.jaleh?.next || []).join(' | ')}`].join('\n');
  },
  landscape(topicKey) {
    const t = aeo.topics.find((x) => x.key === topicKey);
    const rows = t ? t.brands.map((b) => `${b.rank}. ${b.brand} ${pct(b.visibility)} (SoV ${pct(b.sov)}, pos ${b.position ?? 'n/a'})`)
      : aeo.brands.map((b) => `${b.rank}. ${b.name} ${pct(b.visibility)} (SoV ${pct(b.sov)}, pos ${b.position ?? 'n/a'}, strongest in ${b.bestTopic?.key || 'n/a'})`);
    return [`Brand visibility${t ? ` in topic "${t.name}"` : ' across all six topics'}:`, ...rows].join('\n');
  },
  engines() {
    return aeo.channels.map((c) => `${c.name}: visibility ${pct(c.cur?.visibility)}, position ${c.cur?.position}, mentions ${c.cur?.mentions}, SoV ${pct(c.cur?.sov)}`).join('\n') + `\n${aeo.narrative?.channels || ''}`;
  },
  topic(t) {
    const n = aeo.narrative?.topics?.[t.key] || {};
    return [`Topic "${t.name}" (${t.responses} answers). Mutiny: ${t.mutiny ? `#${t.mutiny.rank}, ${pct(t.mutiny.visibility)}, SoV ${pct(t.mutiny.sov)}, position ${t.mutiny.position}` : 'not named'}. Leader ${t.leader?.brand} ${pct(t.leader?.visibility)}.`,
      'Brands:', ...t.brands.slice(0, 10).map((b) => `${b.rank}. ${b.brand} ${pct(b.visibility)}`),
      `Notes: ${n.competitive || ''} ${n.trend || ''}`].join('\n');
  },
  cro() {
    const X = aeo.cro || { rows: [] };
    return [`AI brand profile terms for Mutiny that point to the old product: ${(X.perceptionAttributes?.terms || []).join(', ')}`,
      'Pages AI reads that describe Mutiny the old way (framing, reads, url, sentence):',
      ...X.rows.map((r) => `${r.framing}, ${r.retrievals} reads, ${r.url}: ${(r.snippet || '').replace(/\*\*/g, '').slice(0, 260)}`)].join('\n');
  },
  domains(topicKey) {
    const D = topicKey && topicKey !== 'all' ? aeo.domains.byTopic?.[topicKey]?.top : aeo.domains.top;
    return [`Most read domains${topicKey && topicKey !== 'all' ? ` in topic ${topicKey}` : ''} (chats that read it, % retrieved, % cited):`,
      ...(D || []).map((d) => `${d.rank}. ${d.domain} [${d.cls}] ${d.chats} chats, retrieved ${pct(d.retrieved)}, cited ${pct(d.cited)}`)].join('\n');
  },
  urls(rows) {
    return ['Most cited pages (citations, reads, Mutiny listed?):', ...rows.map((u) => `${u.title} (${u.url}): ${u.citations} citations, ${u.retrievals} reads${u.mutiny != null ? `, Mutiny ${u.mutiny ? 'listed' : 'missing'}` : ''}`)].join('\n');
  },
  outreach() {
    const O = aeo.outreach;
    return [`Mutiny is on ${O.top50With} of the top 50 most-read pages (${O.top50Own} own, ${O.top50ThirdParty} third-party).`,
      ...O.rows.filter((r) => r.rank <= 50).map((r) => `#${r.rank} ${r.domain} [${r.owner}] ${r.mutiny ? 'LISTED' : 'missing'}: ${r.title}`)].join('\n');
  },
  opps() {
    return (aeo.opportunities?.items || []).map((a) => `${a.title} (${a.impact} impact, ${a.group}): ${a.text}`).join('\n');
  },
  brief(b) {
    return [`Prompt "${b.text}" (topic ${b.topicName}, score ${b.score}, ${b.volume} volume, Mutiny in ${pct(b.mutinyVis)} of answers). ${b.signal}.`,
      'Top pages AI reads for it:', ...b.top5.map((u) => `- ${u.title} (${u.url}): ${u.retrievals} reads, ${u.citations} citations`),
      `Winning shape: ${b.pattern?.summary || 'n/a'}`, `Mutiny lean: ${aeo.narrative?.lean?.[b.topic] || ''}`].join('\n');
  },
  backlog() {
    return ['Top content gaps (score, prompt, topic, owners):',
      ...aeo.backlog.prompts.slice(0, 40).map((p) => `${p.score} | ${p.text} | ${p.topic} | ${p.owners.join(', ') || 'none'} | Mutiny ${pct(p.mutinyVis)}${p.head ? ' | head term' : ''}`)].join('\n');
  },
  page() {
    return [ctx.summary(), '', 'Topics:', ...aeo.topics.map((t) => `${t.name}: Mutiny ${t.mutiny ? `#${t.mutiny.rank} ${pct(t.mutiny.visibility)}` : 'not named'}, leader ${t.leader?.brand} ${pct(t.leader?.visibility)}`),
      '', `Takeaways: ${(aeo.narrative?.takeaways || []).join(' | ')}`].join('\n');
  },
};

// Button + small popover: pick a suggested question or type one, then open Claude.
export function AskClaude({ section, context, suggestions = [], compact }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const esc = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', close); document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc); };
  }, [open]);
  const go = (question) => { openClaude(section, typeof context === 'function' ? context() : context, question); setOpen(false); };
  return (
    <span ref={ref} style={{ position: 'relative', display: 'inline-flex' }}>
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} title="Ask Claude about this section"
        style={{ all: 'unset', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 5, border: `1px solid ${C.black}`, borderRadius: 999, padding: compact ? '3px 9px' : '4px 11px', fontFamily: FONT_BODY, fontSize: 12, fontWeight: 700, background: open ? C.lightPurple : C.white }}>
        <MessageCircle size={13} strokeWidth={2.4} /> Ask Claude
      </button>
      {open && (
        <div role="dialog" aria-label={`Ask Claude about ${section}`}
          style={{ position: 'absolute', right: 0, top: 'calc(100% + 6px)', zIndex: 50, width: 340, maxWidth: 'calc(100vw - 32px)', background: C.paper, border: `1px solid ${C.black}`, borderRadius: 6, boxShadow: `3px 3px 0 ${C.black}`, padding: 12, fontFamily: FONT_BODY, textAlign: 'left' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
            <b style={{ fontSize: 13 }}>Ask about “{section}”</b>
            <button type="button" onClick={() => setOpen(false)} aria-label="Close" style={{ all: 'unset', cursor: 'pointer', display: 'inline-flex' }}><X size={14} /></button>
          </div>
          {suggestions.length > 0 && (
            <div style={{ display: 'grid', gap: 5, marginBottom: 8 }}>
              {suggestions.map((s) => (
                <button key={s} type="button" onClick={() => go(s)}
                  style={{ all: 'unset', boxSizing: 'border-box', cursor: 'pointer', border: `1px solid ${C.black}`, borderRadius: 6, padding: '5px 8px', fontSize: 12, background: C.white, lineHeight: 1.35 }}>{s}</button>
              ))}
            </div>
          )}
          <textarea value={q} onChange={(e) => setQ(e.target.value)} rows={3} placeholder="Or type your own question…"
            onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) go(q); }}
            style={{ width: '100%', boxSizing: 'border-box', fontFamily: FONT_BODY, fontSize: 12.5, border: `1px solid ${C.black}`, borderRadius: 6, padding: 8, resize: 'vertical' }} />
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginTop: 8 }}>
            <span style={{ fontSize: 11, color: C.muted, lineHeight: 1.4 }}>Opens Claude in a new tab with this section's numbers attached.</span>
            <button type="button" onClick={() => go(q)}
              style={{ all: 'unset', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 5, background: C.black, color: C.white, borderRadius: 6, padding: '6px 10px', fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap' }}>
              Ask <ExternalLink size={12} />
            </button>
          </div>
        </div>
      )}
    </span>
  );
}

// Page-level box: ask anything about AEO or this page.
export function PageAsk() {
  const [q, setQ] = useState('');
  const ideas = ['What is AEO and why should a sales tool company care?', 'What should we work on first this week, and why?', 'Explain the ladder numbers like I am new to this.'];
  return (
    <div data-tour="ask" style={{ border: `1px solid ${C.black}`, borderRadius: 4, background: C.white, padding: '14px 16px', fontFamily: FONT_BODY }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700, fontSize: 14 }}><MessageCircle size={16} strokeWidth={2.4} /> Ask Claude about AEO or anything on this page</div>
      <div style={{ fontSize: 12.5, color: 'rgba(0,0,0,0.6)', margin: '4px 0 10px', lineHeight: 1.5 }}>Your question opens in Claude with a short AEO primer and this page's key numbers attached, so you can keep the conversation going there. Every section below also has its own “Ask Claude” button.</div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && q.trim()) openClaude('Whole page', ctx.page(), q); }}
          placeholder="e.g. Why does a low citation rate matter if AI reads our pages?" aria-label="Your AEO question"
          style={{ flex: '1 1 320px', minWidth: 0, fontFamily: FONT_BODY, fontSize: 13, border: `1px solid ${C.black}`, borderRadius: 6, padding: '8px 10px' }} />
        <button type="button" disabled={!q.trim()} onClick={() => openClaude('Whole page', ctx.page(), q)}
          style={{ all: 'unset', cursor: q.trim() ? 'pointer' : 'default', opacity: q.trim() ? 1 : 0.5, display: 'inline-flex', alignItems: 'center', gap: 6, background: C.black, color: C.white, borderRadius: 6, padding: '8px 14px', fontSize: 13, fontWeight: 700 }}>
          Ask Claude <ExternalLink size={13} />
        </button>
      </div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
        {ideas.map((s) => (
          <button key={s} type="button" onClick={() => openClaude('Whole page', ctx.page(), s)}
            style={{ all: 'unset', cursor: 'pointer', border: `1px solid ${C.black}`, borderRadius: 999, padding: '3px 10px', fontSize: 11.5, background: C.paper }}>{s}</button>
        ))}
      </div>
    </div>
  );
}
