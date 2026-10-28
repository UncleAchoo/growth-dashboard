// AEO page-structure analyzer (Nick, Oct 27 2026). Reads a Peec
// get_url_content snapshot (markdown) and measures the things the AEO backlog
// spec asks about (Step 8): word count, H1 phrasing, heading hierarchy and
// question headings, direct-answer openers, stats and source links, quotes,
// tables, lists, FAQ, last-updated date. Deterministic so the daily refresh
// produces the same brief from the same snapshot. Numbers are approximate:
// Peec's markdown includes some site chrome (nav, footer), so the body is cut
// from the first H1 when there is one.

const STOP = new Set('a an the and or for of to in on at by with what which who how is are do does can should best top vs versus your you my our in 2025 2026 tools tool'.split(' '));
const words = (s) => (s.match(/[A-Za-z0-9][A-Za-z0-9'’.-]*/g) || []);
const contentWords = (s) => words(s.toLowerCase()).map((w) => w.replace(/[.'’-]+$/, '')).filter((w) => w.length > 1 && !STOP.has(w));

function stripMd(line) {
  return line
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')        // images
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')       // links → text
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[*_`>#|]/g, ' ');
}

const QUESTION_START = /^(what|how|why|which|who|when|where|is|are|can|does|do|should|will)\b/i;
const isQuestion = (h) => /\?\s*$/.test(h) || QUESTION_START.test(h.trim());
const STAT_RE = /(\b\d{1,3}(?:[.,]\d+)?\s?%)|(\$\s?\d[\d,.]*\s?(?:k|m|bn|b|million|billion)?\b)|(\b\d+(?:\.\d+)?x\b)|(\b\d[\d,.]*\s?(?:million|billion)\b)/gi;
const DATE_RE = /(last updated|updated(?: on)?|published(?: on)?|reviewed)[:\s]+([A-Z][a-z]+\.? \d{1,2},? \d{4}|\d{4}-\d{2}-\d{2}|\d{1,2} [A-Z][a-z]+ \d{4})/i;

export function analyzePage(snap, promptText) {
  const r = snap?.result;
  if (!r || snap.error) return { url: snap?.url, missing: 'not indexed by Peec (404)' };
  if (!r.content) return { url: snap.url, title: r.title, domain: r.domain, missing: 'not scraped yet (content null)' };
  const all = r.content.split('\n');
  const h1Idx = all.findIndex((l) => /^#\s+\S/.test(l));
  const lines = h1Idx >= 0 ? all.slice(h1Idx) : all;
  const body = lines.join('\n');

  const heads = lines.map((l, i) => ({ i, m: l.match(/^(#{1,4})\s+(.*)$/) })).filter((x) => x.m)
    .map((x) => ({ i: x.i, level: x.m[1].length, text: stripMd(x.m[2]).replace(/\s+/g, ' ').trim() }))
    .filter((h) => h.text);
  // de-dupe repeated tab/carousel headings
  const seen = new Set();
  const uniq = heads.filter((h) => { const k = `${h.level}|${h.text}`; if (seen.has(k)) return false; seen.add(k); return true; });
  const h1 = uniq.find((h) => h.level === 1)?.text || null;
  const h2 = uniq.filter((h) => h.level === 2);
  const h3 = uniq.filter((h) => h.level === 3);
  const sub = [...h2, ...h3];
  const qHeads = sub.filter((h) => isQuestion(h.text)).length;

  // Direct-answer openers: first prose paragraph after each H2.
  const openers = h2.map((h) => {
    for (let j = h.i + 1; j < lines.length && j < h.i + 15; j++) {
      const l = lines[j].trim();
      if (!l) continue;
      if (/^#/.test(l)) return 0;
      if (/^([-*+]|\d+\.|\||!\[|\[!\[)/.test(l)) continue;
      const w = words(stripMd(l)).length;
      if (w >= 8) return w;
    }
    return 0;
  });
  const directAnswer = openers.filter((w) => w >= 35 && w <= 75).length;

  const textLines = lines.filter((l) => !/^\s*(\[[^\]]*\]\([^)]*\)\s*)+$/.test(l)); // drop link-only nav lines
  const plain = textLines.map(stripMd).join(' ');
  const wordCount = words(plain).length;

  const statMatches = plain.match(STAT_RE) || [];
  const host = (r.domain || '').replace(/^www\./, '');
  const links = [...body.matchAll(/\]\((https?:\/\/[^)\s]+)\)/g)].map((m) => m[1]);
  const extLinks = links.filter((u) => { try { return !new URL(u).hostname.replace(/^www\./, '').endsWith(host); } catch { return false; } });
  const extDomains = [...new Set(extLinks.map((u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return null; } }).filter(Boolean))];
  const relLinks = [...body.matchAll(/\]\((\/[^)\s]*|\.\/[^)\s]*)\)/g)].length + links.length - extLinks.length;

  const tableSeps = lines.filter((l) => /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(l)).length;
  const listItems = lines.filter((l) => /^\s*([-*+]|\d+\.)\s+\S/.test(l) && !/^\s*([-*+]|\d+\.)\s+\[[^\]]*\]\([^)]*\)\s*$/.test(l)).length;
  const quotes = lines.filter((l) => /^>\s*\S/.test(l)).length + (plain.match(/[“"][^”"]{40,300}[”"]\s*[,.]?\s*(?:said|says|according to|—|-)\s*[A-Z]/g) || []).length;
  const hasFAQ = uniq.some((h) => /faq|frequently asked/i.test(h.text));
  const numberedH2 = h2.filter((h) => /^\d+[.)]\s/.test(h.text)).length;
  const dm = body.match(DATE_RE) || r.content.match(DATE_RE);

  const pw = contentWords(promptText || '');
  const hw = new Set(contentWords(h1 || ''));
  const h1Overlap = pw.length ? pw.filter((w) => hw.has(w)).length / pw.length : 0;

  const listWordShare = wordCount ? lines.filter((l) => /^\s*([-*+]|\d+\.)\s+/.test(l)).map((l) => words(stripMd(l)).length).reduce((a, b) => a + b, 0) / wordCount : 0;
  const format = numberedH2 >= 3 ? 'numbered listicle' : tableSeps >= 1 && listWordShare > 0.3 ? 'lists + tables' : listWordShare > 0.35 ? 'list-heavy' : 'prose-heavy';

  return {
    url: snap.url, title: r.title, domain: host, domainClass: r.classification, pageType: r.url_classification,
    snapshotAt: r.content_updated_at, truncated: !!r.truncated,
    wordCount, h1, h1Question: h1 ? isQuestion(h1) : false, h1Overlap: Math.round(h1Overlap * 100) / 100,
    h2: h2.length, h3: h3.length, questionHeadings: qHeads, subHeadings: sub.length,
    directAnswer, h2WithOpeners: openers.filter((w) => w > 0).length,
    stats: statMatches.length, extLinks: extLinks.length, extDomains: extDomains.slice(0, 25), intLinks: relLinks,
    quotes, tables: tableSeps, listItems, hasFAQ, numberedH2, format,
    lastUpdated: dm ? dm[2] : null,
  };
}

const median = (a) => { const s = a.filter((x) => x != null).sort((x, y) => x - y); if (!s.length) return null; const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2); };
const round = (n, to) => Math.round(n / to) * to;

// Synthesize the winning shape for a prompt from its analyzed top pages.
export function synthesize(pages) {
  const ok = pages.filter((p) => !p.missing);
  const n = ok.length;
  if (!n) return { analyzed: 0, summary: 'No top page has been scraped by Peec yet.' };
  const cnt = (f) => ok.filter(f).length;
  const types = {};
  ok.forEach((p) => { const t = (p.pageType || 'OTHER').toLowerCase().replace(/_/g, ' '); types[t] = (types[t] || 0) + 1; });
  const domType = Object.entries(types).sort((a, b) => b[1] - a[1])[0];
  const mw = median(ok.map((p) => p.wordCount));
  const ms = median(ok.map((p) => p.stats));
  const mx = median(ok.map((p) => p.extLinks));
  const tbl = cnt((p) => p.tables > 0);
  const faq = cnt((p) => p.hasFAQ);
  const qh = cnt((p) => p.subHeadings && p.questionHeadings / p.subHeadings >= 0.3);
  const h1q = cnt((p) => p.h1Overlap >= 0.6);
  const da = cnt((p) => p.h2 && p.directAnswer / p.h2 >= 0.4);
  const quotes = cnt((p) => p.quotes > 0);
  const dated = cnt((p) => p.lastUpdated);
  const mh2 = median(ok.map((p) => p.h2));
  const citedDomains = {};
  ok.forEach((p) => p.extDomains.forEach((d) => { if (!/(linkedin|twitter|x\.com|facebook|youtube|instagram|google|apple|g2\.com\/products\/[^/]+\/reviews)/.test(d)) citedDomains[d] = (citedDomains[d] || 0) + 1; }));
  const sharedSources = Object.entries(citedDomains).filter(([, c]) => c >= 2).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([d, c]) => ({ domain: d, pages: c }));

  const target = Math.max(800, round(mw * 1.1, 100));
  const summary = `${domType[1]} of ${n} are ${domType[0]}s. Median ${mw.toLocaleString()} words, ${mh2} H2s, ${ms} stats and ${mx} outbound links per page. `
    + `${tbl} of ${n} use a comparison table, ${faq} of ${n} close with an FAQ, ${qh} of ${n} phrase subheads as questions, ${h1q} of ${n} put the query in the H1.`;
  return {
    analyzed: n, dominantType: domType[0], medianWords: mw, medianH2: mh2, medianStats: ms, medianExtLinks: mx,
    withTable: tbl, withFAQ: faq, questionHeads: qh, h1MatchesQuery: h1q, directAnswerOpeners: da, withQuotes: quotes, dated,
    targetWords: target, sharedSources, summary,
  };
}
