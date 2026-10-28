// AEO backlog scoring (Nick, Oct 27 2026). Shared by build-aeo.mjs and the
// pick step of the daily refresh so the deep-analysis list and the page agree.
// Rules follow the AEO Backlog Builder spec (Step 5), with one reading of
// "+0 if Mutiny is already cited in top 5 (skip unless ranked low)": when
// Mutiny shows up on a top-5 page but appears in under 10% of AI answers for
// the prompt, it counts as a weak presence (+1) instead of a win.
export const MUTINY_ID = 'kw_7af93fc0-d981-4f63-86d5-0fc3348809b3';
export const TOPIC_KEYS = ['AISE', 'ABM', 'AST', 'MGTM', 'CC'];
const VOL_RANK = { 'very high': 4, high: 3, medium: 2, low: 1, 'very low': 0 };

export function scorePrompt(p, urls) {
  const [id, text, topic, volume, intent, vis, pos] = p;
  const top5 = urls?.top5 || [];
  const present = top5.some((r) => (r[5] || []).includes(MUTINY_ID));
  const compUrls = top5.filter((r) => (r[5] || []).some((b) => b !== MUTINY_ID)).length;
  const weak = present && (vis ?? 0) < 0.1;
  let base = 0; let gapType;
  if (!present) {
    if (compUrls >= 2) { base = 4; gapType = 'attack'; }
    else if (compUrls === 1) { base = 3; gapType = 'mild'; }
    else { base = 2; gapType = 'capture'; }
  } else if (weak) { base = 1; gapType = 'weak'; }
  else { base = 0; gapType = 'present'; }
  const volPts = volume === 'high' || volume === 'very high' ? 2 : volume === 'medium' ? 1 : 0;
  const intentPts = intent === 'commercial' ? 1 : 0;
  const status = !present ? 'absent' : weak ? 'weak' : (vis ?? 0) >= 0.5 ? 'winning' : 'present';
  return {
    id, text, topic, volume, intent, mutinyVis: vis, mutinyPos: pos,
    present, compUrls, gapType, status,
    score: base + volPts + intentPts,
    parts: { base, volPts, intentPts },
    gapUrlCount: urls?.gapUrlCount ?? null,
    volRank: VOL_RANK[volume] ?? 0,
  };
}

export function rank(a, b) {
  return b.score - a.score || b.compUrls - a.compUrls || b.volRank - a.volRank || (a.mutinyVis ?? 0) - (b.mutinyVis ?? 0);
}

// 5 to 10 picks: top 10 by score, max 3 per topic, and every topic that has an
// absent/weak prompt gets at least one. Capture prompts (no competitor cited)
// only qualify with medium+ volume (spec failure-mode rule).
export function pickBacklog(scored, max = 10, perTopic = 3) {
  const eligible = scored.filter((s) => s.gapType !== 'present' && !(s.gapType === 'capture' && s.volRank < 2)).sort(rank);
  const picks = []; const count = {};
  for (const t of TOPIC_KEYS) {
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
