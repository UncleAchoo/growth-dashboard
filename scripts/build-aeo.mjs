// Build src/aeo.json for the ?aeo page (Nick, Oct 27 2026).
//
// Peec's REST API isn't reachable headlessly (see pull-data.mjs), so the raw
// pulls come from the Peec MCP during the daily refresh and land compacted in
// data/aeo/raw/*.json. This script does every calculation deterministically:
// week-over-week deltas, rankings, per-engine roll-ups, backlog scoring and
// the page-structure analysis of top-cited URLs. The written parts (summary,
// flags, takeaways, trend notes) live in data/aeo/narrative.json and are
// re-written by Claude at refresh time from the numbers this script prints.
//
//   node scripts/build-aeo.mjs            → writes src/aeo.json
//   node scripts/build-aeo.mjs --print    → also prints the computed numbers
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { scorePrompt, pickBacklog, TOPIC_KEYS, MUTINY_ID } from './lib/aeo-score.mjs';
import { analyzePage, synthesize } from './lib/aeo-content.mjs';

const RAW = 'data/aeo/raw';
const read = (f) => JSON.parse(readFileSync(`${RAW}/${f}`, 'utf8'));
const r4 = (n) => (n == null || Number.isNaN(n) ? null : Math.round(n * 10000) / 10000);
const r1 = (n) => (n == null || Number.isNaN(n) ? null : Math.round(n * 10) / 10);

const meta = read('meta.json');
const brandsCur = read('brands_cur.json');
const brandsPrev = read('brands_prev.json');
const topicsRaw = read('topics.json');
const daily = read('mutiny_daily_channel.json');
const domains = read('domains.json');
const urls = read('urls.json');
const actions = read('actions.json');
const prompts = read('prompts.json');
const mutinyPages = read('mutiny_pages_by_topic.json');
const narrative = existsSync('data/aeo/narrative.json') ? JSON.parse(readFileSync('data/aeo/narrative.json', 'utf8')) : {};

// --- Brands -------------------------------------------------------------------
const idx = (cols) => Object.fromEntries(cols.map((c, i) => [c, i]));
function brandRows(rep) {
  const c = idx(rep.columns);
  return rep.rows.map((r) => ({
    id: r[c.brand_id], name: r[c.brand_name], visibility: r[c.visibility], mentions: r[c.mention_count],
    sov: r[c.share_of_voice], winRate: r[c.win_rate], sentiment: r[c.sentiment], position: r[c.position],
  }));
}
const bc = brandRows(brandsCur).sort((a, b) => b.visibility - a.visibility);
const bp = brandRows(brandsPrev).sort((a, b) => b.visibility - a.visibility);
const prevById = Object.fromEntries(bp.map((b, i) => [b.id, { ...b, rank: i + 1 }]));
const NAME = Object.fromEntries(bc.map((b) => [b.id, b.name]));
const brands = bc.map((b, i) => ({ ...b, rank: i + 1, own: b.id === MUTINY_ID, prev: prevById[b.id] || null }));
const mutiny = brands.find((b) => b.own);

// --- Topics -------------------------------------------------------------------
const topics = TOPIC_KEYS.map((k) => {
  const tk = topicsRaw.topicKeys[k];
  const toObj = (r) => ({ brand: r[0], visibility: r[2], mentions: r[3], sov: r[4], sentiment: r[5], position: r[6] });
  const cur = topicsRaw.cur.filter((r) => r[1] === k).map(toObj).sort((a, b) => b.visibility - a.visibility);
  const prev = topicsRaw.prev.filter((r) => r[1] === k).map(toObj).sort((a, b) => b.visibility - a.visibility);
  const pm = Object.fromEntries(prev.map((p, i) => [p.brand, { ...p, rank: i + 1 }]));
  const ranked = cur.map((b, i) => ({ ...b, rank: i + 1, prev: pm[b.brand] || null }));
  const m = ranked.find((b) => b.brand === 'Mutiny') || null;
  return { key: k, id: tk.id, name: tk.name, responses: tk.responsesCur, mutiny: m, brands: ranked };
});

// --- Engines (sum the daily x channel rows) --------------------------------------
const inWin = (d, w) => d >= w.start && d <= w.end;
function rollup(rows) {
  const s = rows.reduce((a, r) => {
    const [, , vc, vt, men, sov, sent, sc, ps, pc] = r;
    a.vc += vc; a.vt += vt; a.men += men; a.tot += sov ? men / sov : 0; a.sw += sent * sc; a.sc += sc; a.ps += ps; a.pc += pc;
    return a;
  }, { vc: 0, vt: 0, men: 0, tot: 0, sw: 0, sc: 0, ps: 0, pc: 0 });
  return { visibility: r4(s.vc / s.vt), mentions: s.men, sov: r4(s.men / s.tot), sentiment: r1(s.sw / s.sc), position: r1(s.ps / s.pc), responses: s.vt };
}
const CHANNELS = { 'openai-0': 'ChatGPT', 'google-0': 'Google AI Overview', 'perplexity-0': 'Perplexity' };
const channels = Object.entries(CHANNELS).map(([id, name]) => ({
  id, name,
  cur: rollup(daily.rows.filter((r) => r[1] === id && inWin(r[0], meta.cur))),
  prev: rollup(daily.rows.filter((r) => r[1] === id && inWin(r[0], meta.prev))),
}));
const days = [...new Set(daily.rows.map((r) => r[0]))].sort();
const dailySeries = days.map((d) => {
  const t = rollup(daily.rows.filter((r) => r[0] === d));
  const per = Object.fromEntries(Object.keys(CHANNELS).map((id) => [id, rollup(daily.rows.filter((r) => r[0] === d && r[1] === id)).visibility]));
  return { date: d, visibility: t.visibility, mentions: t.mentions, ...per, week: inWin(d, meta.cur) ? 'cur' : 'prev' };
});

// --- Domains ------------------------------------------------------------------
const domObj = (r) => ({ domain: r[0], cls: r[1], chats: r[2], retrieved: r[3], cited: r[4], citations: r[5] });
const dc = domains.cur.map(domObj).sort((a, b) => b.chats - a.chats);
const dp = domains.prev.map(domObj).sort((a, b) => b.chats - a.chats);
const dpm = Object.fromEntries(dp.map((d, i) => [d.domain, { ...d, rank: i + 1 }]));
const topDomains = dc.slice(0, 15).map((d, i) => ({ ...d, rank: i + 1, prev: dpm[d.domain] || null }));
const compCur = dc.filter((d) => d.cls === 'Competitor').map((d) => d.domain);
const compPrev = dp.filter((d) => d.cls === 'Competitor').map((d) => d.domain);
const ownCur = dc.find((d) => d.cls === 'You');
const ownPrev = dp.find((d) => d.cls === 'You');

// --- Backlog ------------------------------------------------------------------
const urlFiles = ['prompt_urls_AST_CC.json', 'prompt_urls_ABM_MGTM.json', 'prompt_urls_AISE.json'];
const U = {};
urlFiles.forEach((f) => Object.assign(U, read(f).prompts));
const tracked = prompts.rows.filter((p) => TOPIC_KEYS.includes(p[2]));
const missingData = tracked.filter((p) => !U[p[0]] || U[p[0]].error || !U[p[0]].top5?.length).map((p) => p[1]);
const scored = tracked.filter((p) => U[p[0]]?.top5?.length).map((p) => scorePrompt(p, U[p[0]]));
const picks = pickBacklog(scored);
const picksFile = existsSync(`${RAW}/picks.json`) ? read('picks.json') : { urls: [] };
const snapByUrl = {};
picksFile.urls.forEach((u, i) => {
  const f = `data/aeo/content/${i}.json`;
  if (existsSync(f)) snapByUrl[u] = JSON.parse(readFileSync(f, 'utf8'));
});
const topicName = Object.fromEntries(topics.map((t) => [t.key, t.name]));
const anchorFor = {};
const briefs = picks.map((p) => {
  const top5 = U[p.id].top5.map((r) => ({
    url: r[0], type: r[1], title: r[2], retrievals: r[3], citations: r[4],
    mutiny: (r[5] || []).includes(MUTINY_ID),
    competitors: (r[5] || []).filter((b) => b !== MUTINY_ID).map((b) => NAME[b] || b),
  }));
  const pages = U[p.id].top5.map((r) => (snapByUrl[r[0]] ? analyzePage(snapByUrl[r[0]], p.text) : { url: r[0], missing: 'not fetched this run' }));
  const pattern = synthesize(pages);
  const compNames = [...new Set(top5.flatMap((u) => u.competitors))];
  const role = anchorFor[p.topic] ? 'supplementary' : 'anchor';
  if (!anchorFor[p.topic]) anchorFor[p.topic] = p.text;
  const pool = (mutinyPages[p.topic] || []).map(([url, title, cites]) => ({ url, title, citations: cites }));
  return {
    ...p, topicName: topicName[p.topic], role, anchor: role === 'supplementary' ? anchorFor[p.topic] : null,
    signal: p.present
      ? `Mutiny is on a top-5 page but in only ${Math.round((p.mutinyVis || 0) * 100)}% of answers; ${compNames.slice(0, 4).join(', ') || 'no tracked competitor'} cited alongside`
      : `Mutiny is on none of the top 5 cited pages${(p.mutinyVis || 0) >= 0.05 ? ` (named in ${Math.round(p.mutinyVis * 100)}% of answers anyway)` : ''}; ${compNames.length ? `${compNames.slice(0, 4).join(', ')} cited there` : 'no tracked competitor owns them yet'}`,
    competitorsCited: compNames,
    top5, pages, pattern,
    internalLinks: pool.slice(0, 5),
  };
});
// supplementary pieces listed on each anchor
briefs.forEach((b) => { if (b.role === 'anchor') b.supplementary = briefs.filter((x) => x.topic === b.topic && x.role === 'supplementary').map((x) => x.text); });

const wins = scored.filter((s) => s.status === 'winning').sort((a, b) => b.mutinyVis - a.mutinyVis);

const out = {
  pulledAt: meta.pulledAt,
  projectId: meta.projectId,
  windows: { cur: meta.cur, prev: meta.prev, backlog: prompts.window },
  mutiny: { cur: mutiny, prev: mutiny.prev },
  brands,
  topics,
  channels,
  daily: dailySeries,
  domains: {
    top: topDomains,
    own: { cur: ownCur, prev: ownPrev },
    newCompetitors: compCur.filter((d) => !compPrev.includes(d)),
    droppedCompetitors: compPrev.filter((d) => !compCur.includes(d)),
  },
  topCitedUrls: urls.topCited.map((r) => ({ url: r[0], type: r[1], title: r[2], citations: r[3], retrievals: r[4], position: r[5], brands: r[6] })),
  mutinyTopUrls: urls.mutinyTop.map((r) => ({ url: r[0], type: r[1], title: r[2], citations: r[3], retrievals: r[4], position: r[5] })),
  opportunities: actions,
  backlog: {
    evaluated: scored.length, trackedPrompts: tracked.length, missingData,
    prompts: scored.sort((a, b) => b.score - a.score || b.compUrls - a.compUrls),
    briefs,
    wins: wins.map((w) => ({ id: w.id, text: w.text, topic: w.topic, mutinyVis: w.mutinyVis, mutinyPos: w.mutinyPos, volume: w.volume })),
  },
  narrative,
};
writeFileSync('src/aeo.json', JSON.stringify(out));
console.log(`aeo.json: ${brands.length} brands, ${topics.length} topics, ${scored.length} prompts scored, ${briefs.length} briefs, ${wins.length} wins, narrative ${narrative.asOf || 'missing'}`);

if (process.argv.includes('--print')) {
  const pct = (v) => (v == null ? '-' : `${(v * 100).toFixed(1)}%`);
  const d = (a, b, s = 1) => (a == null || b == null ? '' : `(${((a - b) * s) >= 0 ? '+' : ''}${((a - b) * s).toFixed(1)})`);
  console.log('\nMUTINY', `vis ${pct(mutiny.prev.visibility)} -> ${pct(mutiny.visibility)} ${d(mutiny.visibility, mutiny.prev.visibility, 100)}`, `mentions ${mutiny.prev.mentions} -> ${mutiny.mentions}`, `sov ${pct(mutiny.prev.sov)} -> ${pct(mutiny.sov)}`, `sent ${mutiny.prev.sentiment} -> ${mutiny.sentiment}`, `pos ${mutiny.prev.position} -> ${mutiny.position}`);
  console.log('\nBRANDS'); brands.forEach((b) => console.log(` ${b.rank}. ${b.name} ${pct(b.visibility)} (was ${pct(b.prev?.visibility)}, rank ${b.prev?.rank}) ${d(b.visibility, b.prev?.visibility, 100)}`));
  console.log('\nTOPICS'); topics.forEach((t) => { const m = t.mutiny; console.log(` ${t.name}: Mutiny #${m?.rank} ${pct(m?.prev?.visibility)} -> ${pct(m?.visibility)} ${d(m?.visibility, m?.prev?.visibility, 100)} sov ${pct(m?.prev?.sov)}->${pct(m?.sov)} pos ${m?.prev?.position}->${m?.position} sent ${m?.prev?.sentiment}->${m?.sentiment} | ${t.brands.slice(0, 4).map((b) => `${b.brand} ${pct(b.visibility)} (${pct(b.prev?.visibility)})`).join(', ')}`); });
  console.log('\nCHANNELS'); channels.forEach((c) => console.log(` ${c.name}: vis ${pct(c.prev.visibility)} -> ${pct(c.cur.visibility)} pos ${c.prev.position}->${c.cur.position} mentions ${c.prev.mentions}->${c.cur.mentions} sov ${pct(c.prev.sov)}->${pct(c.cur.sov)}`));
  console.log('\nDOMAINS'); topDomains.forEach((x) => console.log(` ${x.rank}. ${x.domain} [${x.cls}] ${x.chats} chats (prev ${x.prev?.chats}, #${x.prev?.rank}) retrieved ${pct(x.retrieved)} cited ${pct(x.cited)}`));
  console.log(' own', ownPrev?.chats, '->', ownCur?.chats, pct(ownPrev?.cited), '->', pct(ownCur?.cited), 'new comp', out.domains.newCompetitors, 'dropped', out.domains.droppedCompetitors);
  console.log('\nBRIEFS'); briefs.forEach((b) => console.log(` [${b.score}] ${b.topic} ${b.role} ${b.text} | ${b.signal} | ${b.pattern.summary}`));
  console.log('\nWINS'); wins.forEach((w) => console.log(` ${w.text} ${pct(w.mutinyVis)}`));
  console.log('\nSTATUS', Object.entries(scored.reduce((a, s) => { a[s.status] = (a[s.status] || 0) + 1; return a; }, {})));
}
