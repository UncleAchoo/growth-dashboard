// AEO backlog scoring (Nick, Oct 27 2026; reworked Oct 28 for Jon's new Peec
// prompt set and Matt's handoff). Shared by build-aeo.mjs and the pick step of
// the refresh so the deep-analysis list and the page agree.
//
// Per prompt (rows of data/aeo/raw/prompts.json):
//   status   absent (Mutiny in 0% of answers) · weak (<10%) · present (10-49%)
//            · winning (>=50%)
//   owners   tracked competitors in at least half of the answers
//   score    +4 Mutiny absent/weak and 2+ owners (direct attack)
//            +3 absent/weak and 1 owner (mild attack)
//            +2 absent/weak and no owner (capture; needs medium+ volume to be picked)
//            +0 present or winning
//            +2 high/very high volume, +1 medium
//            +1 commercial or transactional intent (Peec tag)
//            -1 head term (Matt: generic "best X" heads barely move; go niche)
// The original spec scored gaps from the top 5 cited URLs per prompt; the
// owners signal replaces it because it comes from one Peec call instead of
// ~290. The top 5 URLs are still pulled for the picked prompts' briefs.
export const MUTINY_ID = 'kw_7af93fc0-d981-4f63-86d5-0fc3348809b3';
const VOL_RANK = { 'very high': 4, high: 3, medium: 2, low: 1, 'very low': 0 };
const QUALIFIER = /\b(for|with|vs|versus|alternatives?|integrates?|pricing|cost|ai-native|enterprise|startups?|b2b|mid-market|managers?|revops|executives|marketing|follow-up|prep|one-pagers|multithreading|template|features|analytics|collateral|personalized)\b/i;

export const isHeadTerm = (text, intent) => intent !== 'informational'
  && /^(best|top|new)\b/i.test(text.trim())
  && text.trim().split(/\s+/).length <= 6
  && !QUALIFIER.test(text);

export function scorePrompt(p) {
  const [id, text, topic, volume, intent, vis, owners = []] = p;
  const v = vis ?? 0;
  const status = v >= 0.5 ? 'winning' : v >= 0.1 ? 'present' : v > 0 ? 'weak' : 'absent';
  const gap = status === 'absent' || status === 'weak';
  const n = owners.length;
  const gapType = !gap ? 'present' : n >= 2 ? 'attack' : n === 1 ? 'mild' : 'capture';
  const base = { attack: 4, mild: 3, capture: 2, present: 0 }[gapType];
  const volPts = volume === 'high' || volume === 'very high' ? 2 : volume === 'medium' ? 1 : 0;
  const intentPts = intent === 'commercial' || intent === 'transactional' ? 1 : 0;
  const head = isHeadTerm(text, intent);
  const headPts = head ? -1 : 0;
  return {
    id, text, topic, volume, intent, mutinyVis: v, owners, head,
    status, gapType, compUrls: n,
    score: base + volPts + intentPts + headPts,
    parts: { base, volPts, intentPts, headPts },
    volRank: VOL_RANK[volume] ?? 0,
  };
}

export function rank(a, b) {
  return b.score - a.score || b.compUrls - a.compUrls || b.volRank - a.volRank || a.mutinyVis - b.mutinyVis;
}

// 5 to 10 picks: top 10 by score, max 3 per topic, every topic with a gap gets
// at least one. Capture prompts (nobody owns it) only qualify at medium+ volume.
export function pickBacklog(scored, topicKeys, max = 10, perTopic = 3) {
  const eligible = scored.filter((s) => s.gapType !== 'present' && !(s.gapType === 'capture' && s.volRank < 2)).sort(rank);
  const picks = []; const count = {};
  for (const t of topicKeys) {
    const best = eligible.find((s) => s.topic === t);
    if (best) { picks.push(best); count[t] = 1; }
  }
  for (const s of eligible) {
    if (picks.length >= max) break;
    if (picks.includes(s) || (count[s.topic] || 0) >= perTopic) continue;
    picks.push(s); count[s.topic] = (count[s.topic] || 0) + 1;
  }
  return picks.sort(rank);
}
