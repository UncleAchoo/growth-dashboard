// Build src/aeo.json for the ?aeo page (Nick, Oct 27 2026; reworked Oct 28
// for Jon's new Peec prompt set and Matt's AEO handoff).
//
// Peec's REST API isn't reachable headlessly (see pull-data.mjs), so the raw
// pulls come from the Peec MCP during the refresh and land compacted in
// data/aeo/raw/*.json (see data/aeo/REFRESH.md). This script does every
// calculation deterministically: rankings, the retrieval → citation →
// visibility ladder, within-topic comparisons (Matt: never rank topics against
// each other), per-engine roll-ups, the outreach list (top 50 URLs), the CRO
// positioning watch, the Jaleh summary signals (self-reported AEO signups +
// AI referral visitors) and backlog scoring + page analysis. Week-over-week
// fields fill in automatically once a comparable prior window exists (raw
// *_prev files / meta.prev). Written parts live in data/aeo/narrative.json.
//
//   node scripts/build-aeo.mjs [--print]
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { scorePrompt, pickBacklog, MUTINY_ID } from './lib/aeo-score.mjs';
import { analyzePage, synthesize } from './lib/aeo-content.mjs';
import { categorizeReferralSource } from '../channel-categorization.js';

const RAW = 'data/aeo/raw';
const read = (f, dflt) => (existsSync(`${RAW}/${f}`) ? JSON.parse(readFileSync(`${RAW}/${f}`, 'utf8')) : dflt);
const r4 = (n) => (n == null || Number.isNaN(n) ? null : Math.round(n * 10000) / 10000);
const r1 = (n) => (n == null || Number.isNaN(n) ? null : Math.round(n * 10) / 10);

const meta = read('meta.json');
const legacy = read('legacy.json', null);
const brandsCur = read('brands_cur.json');
const brandsPrev = read('brands_prev.json', null);
const topicsRaw = read('topics.json');
const daily = read('mutiny_daily_channel.json');
const domains = read('domains.json');
const urls = read('urls.json');
const topUrls = read('top_urls.json', { rows: [] });
const actions = read('actions.json');
const prompts = read('prompts.json');
const promptUrls = read('prompt_urls.json', { prompts: {} });
const cro = read('cro_watch.json', { rows: [] });
const cfg = read('site_config.json');
const peecLinks = read('peec_links.json', {});
const narrative = existsSync('data/aeo/narrative.json') ? JSON.parse(readFileSync('data/aeo/narrative.json', 'utf8')) : {};

// --- Topics (dynamic: whatever Peec is configured with) -------------------------
const PALETTE = ['#F2D1FC', '#D2FD78', '#BCEEFD', '#FFE3A3', '#FF9987', '#D9D2FF', '#C9F2E4', '#FFD1E8'];
const TOPIC_LIST = Object.entries(topicsRaw.topicKeys).map(([key, t], i) => ({ key, id: t.id, name: t.name, responses: t.responsesCur, color: PALETTE[i % PALETTE.length] }));
const TOPIC_KEYS = TOPIC_LIST.map((t) => t.key);

// --- Brands ------------------------------------------------------------------------
const idx = (cols) => Object.fromEntries(cols.map((c, i) => [c, i]));
function brandRows(rep) {
  if (!rep?.rows?.length) return [];
  const c = idx(rep.columns);
  return rep.rows.map((r) => ({
    id: r[c.brand_id], name: r[c.brand_name], visibility: r[c.visibility], mentions: r[c.mention_count],
    sov: r[c.share_of_voice], winRate: r[c.win_rate], sentiment: r[c.sentiment], position: r[c.position],
  }));
}
const bc = brandRows(brandsCur).sort((a, b) => b.visibility - a.visibility);
const bp = brandRows(brandsPrev).sort((a, b) => b.visibility - a.visibility);
const prevById = Object.fromEntries(bp.map((b, i) => [b.id, { ...b, rank: i + 1 }]));
const toObj = (r) => ({ brand: r[0], visibility: r[2], mentions: r[3], sov: r[4], sentiment: r[5], position: r[6] });
const topicRows = (rows, key) => rows.filter((r) => r[1] === key).map(toObj).sort((a, b) => b.visibility - a.visibility);
const bestTopicOf = (name) => {
  const rows = topicsRaw.cur.filter((r) => r[0] === name).sort((a, b) => b[2] - a[2]);
  return rows[0] ? { key: rows[0][1], visibility: rows[0][2] } : null;
};
const brands = bc.map((b, i) => ({ ...b, rank: i + 1, own: b.id === MUTINY_ID, prev: prevById[b.id] || null, bestTopic: bestTopicOf(b.name) }));
const mutiny = brands.find((b) => b.own);

const topics = TOPIC_LIST.map((t) => {
  const cur = topicRows(topicsRaw.cur, t.key);
  const prev = topicRows(topicsRaw.prev || [], t.key);
  const pm = Object.fromEntries(prev.map((p, i) => [p.brand, { ...p, rank: i + 1 }]));
  const ranked = cur.map((b, i) => ({ ...b, rank: i + 1, prev: pm[b.brand] || null }));
  const m = ranked.find((b) => b.brand === 'Mutiny') || null;
  const leader = ranked[0] || null;
  return {
    ...t, mutiny: m, brands: ranked, leader,
    gapToLeader: leader ? r4(leader.visibility - (m?.visibility || 0)) : null,
    mentionedBrands: ranked.length,
  };
});

// --- Engines ---------------------------------------------------------------------------
const inWin = (d, w) => w && d >= w.start && d <= w.end;
function rollup(rows) {
  if (!rows.length) return null;
  const s = rows.reduce((a, r) => {
    const [, , vc, vt, men, sov, sent, sc, ps, pc] = r;
    a.vc += vc; a.vt += vt; a.men += men; a.tot += sov ? men / sov : 0; a.sw += sent * sc; a.sc += sc; a.ps += ps; a.pc += pc;
    return a;
  }, { vc: 0, vt: 0, men: 0, tot: 0, sw: 0, sc: 0, ps: 0, pc: 0 });
  return { visibility: r4(s.vc / s.vt), mentions: s.men, sov: s.tot ? r4(s.men / s.tot) : null, sentiment: s.sc ? r1(s.sw / s.sc) : null, position: s.pc ? r1(s.ps / s.pc) : null, responses: s.vt };
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
  const per = Object.fromEntries(Object.keys(CHANNELS).map((id) => [id, rollup(daily.rows.filter((r) => r[0] === d && r[1] === id))?.visibility ?? null]));
  return { date: d, visibility: t.visibility, mentions: t.mentions, ...per };
});

// --- Domains ---------------------------------------------------------------------------
const domObj = (r) => ({ domain: r[0], cls: r[1], chats: r[2], retrieved: r[3], cited: r[4], citations: r[5] });
const dc = domains.cur.map(domObj).sort((a, b) => b.chats - a.chats);
const dp = (domains.prev || []).map(domObj).sort((a, b) => b.chats - a.chats);
const dpm = Object.fromEntries(dp.map((d, i) => [d.domain, { ...d, rank: i + 1 }]));
const topDomains = dc.slice(0, 15).map((d, i) => ({ ...d, rank: i + 1, prev: dpm[d.domain] || null }));
const ownCur = dc.find((d) => d.cls === 'You') || null;
const ownPrev = dp.find((d) => d.cls === 'You') || null;
const ownRank = ownCur ? dc.indexOf(ownCur) + 1 : null;

// --- Outreach (Matt's "currency exchange"): top retrieved URLs ---------------------------
const baseDomain = (u) => { try { const h = new URL(u).hostname.replace(/^www\./, ''); const p = h.split('.'); return p.slice(-2).join('.'); } catch { return u; } };
function ownerType(url) {
  const d = baseDomain(url);
  if (d === 'mutinyhq.com') return 'You';
  if (cfg.competitorDomains.includes(d)) return 'Competitor';
  if (/gartner\.com\/reviews|g2\.com|capterra|trustradius/.test(url)) return 'Review site';
  if (cfg.community.includes(d)) return 'Community';
  if (cfg.incumbents.includes(d)) return 'Incumbent';
  return 'Challenger';
}
const OUTREACH_PLAY = {
  Challenger: 'Pitch a swap: include Mutiny in theirs, Mutiny includes them in ours.',
  Incumbent: 'Hard to get into (no incentive). Out-write it instead.',
  Competitor: 'A rival\'s page. Out-write it; never pitch.',
  'Review site': 'Earn it: reviews and category placement.',
  Community: 'Real UGC only (Reddit blocks self-promotion).',
  You: 'Our page. Keep it fresh; link new pieces to it.',
};
const outreachRows = topUrls.rows.map(([rank, url, type, title, retrievals, citations, m]) => ({
  rank, url, type, title, retrievals, citations, mutiny: !!m, domain: baseDomain(url), owner: ownerType(url),
}));
outreachRows.forEach((r) => { r.play = OUTREACH_PLAY[r.owner]; });
const top50 = outreachRows.filter((r) => r.rank <= 50);
const outreach = {
  window: topUrls.window,
  top50With: top50.filter((r) => r.mutiny).length,
  top50Own: top50.filter((r) => r.mutiny && r.owner === 'You').length,
  top50ThirdParty: top50.filter((r) => r.mutiny && r.owner !== 'You').length,
  targets: outreachRows.filter((r) => !r.mutiny && r.owner === 'Challenger'),
  rows: outreachRows,
  byOwner: Object.fromEntries(Object.keys(OUTREACH_PLAY).map((k) => [k, outreachRows.filter((r) => r.owner === k && r.rank <= 50 && !r.mutiny).length])),
  plays: OUTREACH_PLAY,
};

// --- Jaleh summary signals: directional channel signups + AI referral visitors ----------------
function jalehSignals() {
  const signups = existsSync('src/beta-signups.json') ? JSON.parse(readFileSync('src/beta-signups.json', 'utf8')) : null;
  const framer = existsSync('src/framer.json') ? JSON.parse(readFileSync('src/framer.json', 'utf8')) : null;
  if (!signups) return null;
  const lastData = [signups.lastDate, framer?.lastDate].filter(Boolean).sort()[0];
  const toD = (s) => new Date(`${s}T00:00:00Z`);
  const iso = (d) => d.toISOString().slice(0, 10);
  const last = toD(lastData);
  const lastSunday = new Date(last); lastSunday.setUTCDate(last.getUTCDate() - ((last.getUTCDay() + 0) % 7));
  if (iso(lastSunday) > lastData) lastSunday.setUTCDate(lastSunday.getUTCDate() - 7);
  const weeks = [];
  for (let k = 7; k >= 0; k--) {
    const end = new Date(lastSunday); end.setUTCDate(end.getUTCDate() - 7 * k);
    const start = new Date(end); start.setUTCDate(end.getUTCDate() - 6);
    weeks.push({ start: iso(start), end: iso(end) });
  }
  const rows = signups.signups.filter((s) => !s.nc && s.d >= '2026-02-16');
  return weeks.map((w) => {
    const inW = rows.filter((s) => s.d >= w.start && s.d <= w.end);
    const b = inW.map((s) => (s.ref ? categorizeReferralSource(s.ref) : null));
    const ai = (framer?.channels || []).filter((c) => c.d >= w.start && c.d <= w.end && c.channelGroup === 'AI Referrals').reduce((a, c) => a + (c.visitors || 0), 0);
    return {
      ...w,
      signups: inW.length,
      answered: b.filter(Boolean).length,
      aeo: b.filter((x) => x === 'AEO').length,
      searchAeo: b.filter((x) => x === 'AEO' || x === 'Search').length,
      aiVisitors: framer ? ai : null,
    };
  });
}
const jaleh = { weeks: jalehSignals(), ...(narrative.jaleh || {}) };

// --- Backlog --------------------------------------------------------------------------------
const tracked = prompts.rows.filter((p) => TOPIC_KEYS.includes(p[2]));
const scored = tracked.map(scorePrompt);
const picks = pickBacklog(scored, TOPIC_KEYS);
const picksFile = read('picks.json', { urls: [] });
const snapByUrl = {};
picksFile.urls.forEach((u, i) => {
  const f = `data/aeo/content/${i}.json`;
  if (existsSync(f)) snapByUrl[u] = JSON.parse(readFileSync(f, 'utf8'));
});
const topicName = Object.fromEntries(TOPIC_LIST.map((t) => [t.key, t.name]));
const anchorFor = {};
const briefs = picks.map((p) => {
  const raw = promptUrls.prompts[p.id] || [];
  const top5 = raw.map(([url, type, title, retrievals, citations, m, names]) => ({ url, type, title, retrievals, citations, mutiny: !!m, competitors: names || [] }));
  const pages = raw.map(([url]) => (snapByUrl[url] ? analyzePage(snapByUrl[url], p.text) : { url, missing: 'not fetched yet' }));
  const pattern = synthesize(pages);
  const role = anchorFor[p.topic] ? 'supplementary' : 'anchor';
  if (!anchorFor[p.topic]) anchorFor[p.topic] = p.text;
  const ownOnTop = top5.find((u) => baseDomain(u.url) === 'mutinyhq.com');
  const vis = Math.round((p.mutinyVis || 0) * 100);
  const owners = p.owners.slice(0, 4).join(', ');
  const signal = (p.status === 'absent' ? 'Mutiny is in none of the answers' : `Mutiny is in only ${vis}% of answers`)
    + (owners ? `; ${owners} ${p.owners.length > 1 ? 'are' : 'is'} named in at least half` : '; no tracked brand owns it yet')
    + (ownOnTop ? `. Our page "${ownOnTop.title}" is already a top-5 source but isn't getting us named` : '');
  return {
    ...p, topicName: topicName[p.topic], role, anchor: role === 'supplementary' ? anchorFor[p.topic] : null,
    signal, competitorsCited: [...new Set(top5.flatMap((u) => u.competitors))],
    top5, pages, pattern, ownOnTop: !!ownOnTop, missingUrls: !raw.length,
    internalLinks: (cfg.mutinyPages[p.topic] || []).map(([url, title, citations]) => ({ url, title, citations })),
  };
});
briefs.forEach((b) => { if (b.role === 'anchor') b.supplementary = briefs.filter((x) => x.topic === b.topic && x.role === 'supplementary').map((x) => x.text); });
const wins = scored.filter((s) => s.status === 'winning' || s.status === 'present').sort((a, b) => b.mutinyVis - a.mutinyVis);

const topCited = [...outreachRows].sort((a, b) => b.citations - a.citations).slice(0, 10);

const out = {
  pulledAt: meta.pulledAt,
  projectId: meta.projectId,
  promptSet: meta.promptSet,
  partial: !!meta.partialCur,
  windows: { cur: meta.cur, prev: meta.prev, backlog: prompts.window },
  legacy,
  mutiny: {
    cur: mutiny, prev: mutiny?.prev || null,
    ladder: {
      retrieved: ownCur?.retrieved ?? null, cited: ownCur?.cited ?? null, visibility: mutiny?.visibility ?? null,
      retrievedPrev: ownPrev?.retrieved ?? null, citedPrev: ownPrev?.cited ?? null, visibilityPrev: mutiny?.prev?.visibility ?? null,
      chats: ownCur?.chats ?? null, domainRank: ownRank,
    },
  },
  brands,
  topics,
  channels,
  daily: dailySeries,
  domains: {
    top: topDomains, own: { cur: ownCur, prev: ownPrev, rank: ownRank },
    // Per-topic view (Nick, Oct 28): same report filtered to one topic.
    byTopic: Object.fromEntries(Object.entries(domains.byTopic || {}).map(([k, rows]) => {
      const list = rows.map(domObj).sort((a, b) => b.chats - a.chats).map((d, i) => ({ ...d, rank: i + 1 }));
      return [k, { top: list, own: list.find((d) => d.cls === 'You') || null }];
    })),
  },
  topCitedByTopic: Object.fromEntries(Object.entries(urls.byTopic || {}).map(([k, rows]) => [k, rows.map((r) => ({ url: r[0], type: r[1], title: r[2], citations: r[3], retrievals: r[4], mutiny: !!r[5] }))])),
  topCitedUrls: topCited,
  mutinyTopUrls: urls.mutinyTop.map((r) => ({ url: r[0], type: r[1], title: r[2], citations: r[3], retrievals: r[4], position: r[5] })),
  outreach,
  cro: { ...cro, cro: cro.rows.filter((r) => r.framing === 'cro').length },
  jaleh,
  opportunities: actions,
  backlog: {
    evaluated: scored.length, trackedPrompts: tracked.length,
    prompts: scored.sort((a, b) => b.score - a.score || b.compUrls - a.compUrls),
    briefs, wins: wins.map((w) => ({ id: w.id, text: w.text, topic: w.topic, mutinyVis: w.mutinyVis, volume: w.volume, status: w.status })),
  },
  peecLinks: Object.fromEntries(Object.entries(peecLinks).filter(([k]) => !k.startsWith('_'))),
  narrative,
};
writeFileSync('src/aeo.json', JSON.stringify(out));
console.log(`aeo.json: ${brands.length} brands, ${topics.length} topics, ${scored.length} prompts, ${briefs.length} briefs, outreach ${outreach.rows.length} urls (Mutiny on ${outreach.top50With} of top 50), cro ${out.cro.cro}, narrative ${narrative.asOf || 'missing'}`);

if (process.argv.includes('--print')) {
  const pct = (v) => (v == null ? '-' : `${(v * 100).toFixed(1)}%`);
  console.log('\nMUTINY', `#${mutiny.rank}/${brands.length}`, 'vis', pct(mutiny.visibility), 'mentions', mutiny.mentions, 'sov', pct(mutiny.sov), 'sent', mutiny.sentiment, 'pos', mutiny.position);
  console.log('LADDER retrieved', pct(out.mutiny.ladder.retrieved), 'cited', pct(out.mutiny.ladder.cited), 'visible', pct(mutiny.visibility), 'domain rank', ownRank, 'chats', ownCur?.chats);
  console.log('\nBRANDS'); brands.slice(0, 12).forEach((b) => console.log(` ${b.rank}. ${b.name} ${pct(b.visibility)} best topic ${b.bestTopic?.key}`));
  console.log('\nTOPICS'); topics.forEach((t) => console.log(` ${t.name}: Mutiny ${t.mutiny ? `#${t.mutiny.rank} ${pct(t.mutiny.visibility)}` : 'not mentioned'} of ${t.mentionedBrands} brands; leader ${t.leader?.brand} ${pct(t.leader?.visibility)}; gap ${pct(t.gapToLeader)} | ${t.brands.slice(0, 4).map((b) => `${b.brand} ${pct(b.visibility)}`).join(', ')}`));
  console.log('\nCHANNELS'); channels.forEach((c) => console.log(` ${c.name}: vis ${pct(c.cur?.visibility)} pos ${c.cur?.position} mentions ${c.cur?.mentions} sov ${pct(c.cur?.sov)}`));
  console.log('\nDOMAINS'); topDomains.forEach((x) => console.log(` ${x.rank}. ${x.domain} [${x.cls}] ${x.chats} retrieved ${pct(x.retrieved)} cited ${pct(x.cited)}`));
  console.log('\nOUTREACH top50 with Mutiny', outreach.top50With, '(own', outreach.top50Own, ', 3rd party', outreach.top50ThirdParty, ') challengers to pitch:', outreach.targets.length, 'byOwner', outreach.byOwner);
  outreach.targets.slice(0, 8).forEach((r) => console.log(`  #${r.rank} ${r.domain} ${r.title}`));
  console.log('\nCRO'); cro.rows.forEach((r) => console.log(` ${r.framing} ${r.retrievals} ${r.url}`));
  console.log('\nJALEH'); (jaleh.weeks || []).forEach((w) => console.log(` ${w.start}..${w.end} signups ${w.signups} answered ${w.answered} AEO ${w.aeo} Search+AEO ${w.searchAeo} AI visitors ${w.aiVisitors}`));
  console.log('\nBRIEFS'); briefs.forEach((b) => console.log(` [${b.score}] ${b.topic} ${b.role} ${b.text} | ${b.signal} | ${b.pattern.summary}`));
  console.log('\nWINS'); wins.forEach((w) => console.log(` ${w.text} ${pct(w.mutinyVis)}`));
  console.log('\nSTATUS', Object.entries(scored.reduce((a, s) => { a[s.status] = (a[s.status] || 0) + 1; return a; }, {})), 'heads', scored.filter((s) => s.head).length);
}
