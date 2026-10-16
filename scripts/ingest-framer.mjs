// Framer Analytics export → src/framer.json (website visitors + visitors by channel).
//
//   npm run ingest-framer                 (reads every *.csv in data/framer/)
//   npm run ingest-framer -- path/to/dir  (or a different folder)
//
// Input: Framer → Analytics → Export (one row per event: visitorId, timestamp,
// eventType, hostname, pathname, search, referrer, …). Exports can overlap in
// dates; that's fine — everything below is per visitorId, so repeats collapse.
//
// Visitor = one Framer visitorId. Framer rotates visitorIds daily (an id never
// spans more than 2 calendar days in the data), so a visitor here is "one person
// on one day", the same as Framer's own Visitors number. Each visitor is dated by
// its FIRST pageview (UTC) and gets exactly one channel, from that first
// pageview's referrer + utm params — so channels always add up to the total.
//
// Channel: each visitor gets a GA-style `sourceMedium` + `channelGroup`, so the
// dashboard can bucket it with the SAME channelOf() rules as the GA4 cards:
//   source = utm_source → search-engine name (google.com → google) → referrer host → (direct)
//   medium = utm_medium → organic / referral → (none)
// Only production hosts count (www.mutinyhq.com, mutinyhq.com, mutinyhq.co);
// *.framer.app preview/staging traffic is dropped. No bot filter: Framer
// doesn't flag bots, and bot-like ids (100s of pageviews/day) are only ~1% of
// visitors — they inflate pageviews, not visitor counts.
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const src = path.resolve(root, process.argv[2] || 'data/framer');
const out = path.join(root, 'src/framer.json');

const PROD_HOSTS = new Set(['www.mutinyhq.com', 'mutinyhq.com', 'mutinyhq.co']);

// Streaming RFC-4180 reader (quoted fields may hold commas / newlines).
async function* csvRows(file) {
  const rl = readline.createInterface({ input: fs.createReadStream(file, 'utf8'), crlfDelay: Infinity });
  let row = [], field = '', q = false;
  for await (const line of rl) {
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (q) {
        if (c === '"' && line[i + 1] === '"') { field += '"'; i++; }
        else if (c === '"') q = false;
        else field += c;
      } else if (c === '"') q = true;
      else if (c === ',') { row.push(field); field = ''; }
      else field += c;
    }
    if (q) { field += '\n'; continue; } // newline inside a quoted field
    row.push(field); yield row; row = []; field = '';
  }
}

// --- Channel inputs ------------------------------------------------------------
const hostOf = (ref) => String(ref || '').trim().replace(/^[a-z-]+:\/\//i, '').split(/[/?#]/)[0].toLowerCase().replace(/^www\./, '').replace(/^m\./, '');
const INTERNAL = /(^|\.)mutinyhq\.(com|co)$|\.framer\.app$|^localhost$|^127\.0\.0\.1$|translate\.goog$/;
// Search engines → GA source names (so CHANNEL_RULES' /^google$/ etc. match).
const SEARCH = [
  [/^google\.|\.google\.[a-z.]+$|^com\.google\.android\.googlequicksearchbox$/, 'google'],
  [/^bing\.com$|^cn\.bing\.com$/, 'bing'],
  [/duckduckgo\.com$/, 'duckduckgo'],
  [/yahoo\.(com|co\.[a-z]+)$/, 'yahoo'],
  [/baidu\.com$/, 'baidu'],
  [/^yandex\.|\.yandex\./, 'yandex'],
  [/ecosia\.org$/, 'ecosia'],
  [/search\.brave\.com$/, 'brave'],
  [/qwant\.com$/, 'qwant'],
  [/^msn\.com$/, 'msn'],
];
const AI = /^chatgpt\.com$|^chat\.openai\.com$|^claude\.ai$|^claude\.com$|^perplexity\.ai$|^gemini\.google\.com$|^copilot\.microsoft\.com$|^poe\.com$/;
const SOCIAL = /linkedin|^lnkd\.in$|^t\.co$|^x\.com$|twitter\.com$|reddit\.com$|facebook\.com$|^fb\.|instagram\.com$|youtube\.com$|^youtu\.be$|threads\.net$|bsky\.app$|^ycombinator\.com$|^news\.ycombinator\.com$/;
const EMAIL_HOST = /^mail\.google\.com$|^com\.google\.android\.gm$|outlook\.(live|office|office365)\.com$|^mail\.yahoo\.com$|sendibm|list-manage\.com$|hubspotlinks\.com$|^newsletter\./;

function classify(search, referrer) {
  const p = new URLSearchParams(String(search || '').replace(/^\?/, ''));
  const uSrc = (p.get('utm_source') || '').trim().toLowerCase();
  const uMed = (p.get('utm_medium') || '').trim().toLowerCase();
  let host = hostOf(referrer);
  if (INTERNAL.test(host)) host = '';
  const engine = host && !AI.test(host) && !EMAIL_HOST.test(host) ? SEARCH.find(([re]) => re.test(host))?.[1] : null;

  const source = uSrc || engine || host || '(direct)';
  const medium = uMed || (engine ? 'organic' : host ? 'referral' : '(none)');

  // GA4-style default channel group — only the fallback when CHANNEL_RULES
  // (in beta_dashboard.jsx) don't match source or medium.
  let group;
  if (/^(cpc|ppc|paid|paidsearch)$/.test(uMed)) group = engine || /google|bing/.test(uSrc) ? 'Paid Search' : 'Paid Social';
  else if (/paid_social|paidsocial/.test(uMed)) group = 'Paid Social';
  else if (/email|newsletter/.test(uMed) || EMAIL_HOST.test(host)) group = 'Email';
  else if (AI.test(host) || AI.test(uSrc)) group = 'AI Referrals';
  else if (/^social$|^video$/.test(uMed) || SOCIAL.test(host) || SOCIAL.test(uSrc)) group = 'Organic Social';
  else if (engine || uMed === 'organic') group = 'Organic Search';
  else if (source === '(direct)') group = 'Direct';
  else group = 'Referral';
  return { sourceMedium: `${source} / ${medium}`, channelGroup: group };
}

// High-intent pages — same filter as the GA4 Apps Script (Nick edits that one;
// keep in sync): pricing, customer stories, case studies, use cases. A visitor
// is high-intent if ANY of its pageviews matches (counted once, however many).
const HIGH_INTENT = /^\/(pricing|use-cases|customers|case-studies)(\/.*)?$/i;
const normPath = (p) => { const s = String(p || '').toLowerCase(); return s.length > 1 ? s.replace(/\/+$/, '') : s; };

// --- Read ----------------------------------------------------------------------
const files = (fs.statSync(src).isDirectory() ? fs.readdirSync(src).filter((f) => f.toLowerCase().endsWith('.csv')).map((f) => path.join(src, f)) : [src]).sort();
if (!files.length) throw new Error(`No Framer CSVs in ${path.relative(root, src)}`);

const first = new Map(); // visitorId → { ts, search, referrer }
let pageviews = 0, skippedHosts = 0;
for (const file of files) {
  let col = null, n = 0;
  for await (const r of csvRows(file)) {
    if (!col) { col = Object.fromEntries(r.map((h, i) => [h.replace(/^﻿/, ''), i])); continue; }
    if (r[col.eventType] !== 'pageview') continue;
    if (!PROD_HOSTS.has(r[col.hostname])) { skippedHosts++; continue; }
    n++;
    const id = r[col.visitorId];
    const ts = r[col.timestamp];
    let cur = first.get(id);
    if (!cur) first.set(id, (cur = { ts, search: r[col.search], referrer: r[col.referrer], hi: null }));
    else if (ts < cur.ts) Object.assign(cur, { ts, search: r[col.search], referrer: r[col.referrer] });
    const p = normPath(r[col.pathname]);
    if (HIGH_INTENT.test(p)) (cur.hi || (cur.hi = new Set())).add(p);
  }
  pageviews += n;
  console.log(`  ${path.basename(file)}: ${n.toLocaleString()} pageviews`);
}

// --- Aggregate: date × sourceMedium × channelGroup → visitors -----------------
// High-intent counts use the visitor's date too (first pageview), so they
// always sit inside the same day's visitor total.
const rows = new Map();
const daily = new Map();
const hiDaily = new Map();
const pages = new Map(); // date \t path → visitors who viewed it
for (const v of first.values()) {
  const d = v.ts.slice(0, 10);
  const { sourceMedium, channelGroup } = classify(v.search, v.referrer);
  const k = `${d}\t${sourceMedium}\t${channelGroup}`;
  rows.set(k, (rows.get(k) || 0) + 1);
  daily.set(d, (daily.get(d) || 0) + 1);
  if (v.hi) {
    hiDaily.set(d, (hiDaily.get(d) || 0) + 1);
    for (const p of v.hi) { const pk = `${d}\t${p}`; pages.set(pk, (pages.get(pk) || 0) + 1); }
  }
}
const dates = [...daily.keys()].sort();
const json = {
  source: 'Framer Analytics export',
  generatedAt: new Date().toISOString(),
  firstDate: dates[0],
  lastDate: dates[dates.length - 1],
  daily: dates.map((d) => ({ d, visitors: daily.get(d), highIntent: hiDaily.get(d) || 0 })),
  // Per page: visitors who viewed that URL (page-level; never sum for reach).
  pages: [...pages].map(([k, visitors]) => { const [d, path] = k.split('\t'); return { d, path, visitors }; })
    .sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : b.visitors - a.visitors)),
  channels: [...rows].map(([k, visitors]) => { const [d, sourceMedium, channelGroup] = k.split('\t'); return { d, sourceMedium, channelGroup, visitors }; })
    .sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : b.visitors - a.visitors)),
};
fs.writeFileSync(out, JSON.stringify(json));
console.log(`✓ ${path.relative(root, out)}: ${first.size.toLocaleString()} visitors, ${dates[0]} → ${json.lastDate}, ${json.channels.length.toLocaleString()} channel rows (${pageviews.toLocaleString()} pageviews read, ${skippedHosts.toLocaleString()} non-production pageviews skipped)`);
