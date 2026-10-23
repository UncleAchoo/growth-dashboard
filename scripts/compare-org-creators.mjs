#!/usr/bin/env node
// Org creators: PostHog vs our signup data (Nick, Oct 23 2026).
//
// Daily check, run by `npm run pull-data` right after ingest-signups (or on
// its own: `npm run compare-orgs`). Compares, per Pacific day since the new
// onboarding launch (Oct 21):
//   PostHog    people whose first [Activation] Organization Created falls on
//              that day (src/beta-posthog.json — the "Organization created"
//              number on the New onboarding card)
//   Dashboard  org creator signup rows (not never-completed, not a joiner)
//              from src/beta-signups.json, split by where the company came
//              from: Metabase user_signups as-is / filled from all_users.csv /
//              added from PostHog (see ingest-signups.mjs, cf 'u' / 'p')
// Window ends at the newest user_signups row (lastSignupAt) so both sides
// cover the same time; PostHog creators after that are shown separately as
// "not in the Metabase export yet".
//
// Writes reports/org-creators-compare.html (open it in a browser) and
// appends one snapshot per day to reports/org-creators-history.json.
// reports/ is gitignored (it lists emails).

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';

const FROM = '2026-10-21';
const OUT_DIR = 'reports';
const OUT_HTML = `${OUT_DIR}/org-creators-compare.html`;
const OUT_HIST = `${OUT_DIR}/org-creators-history.json`;
const ADMIN = (uid) => `https://admin.mutinyhq.com/users/${uid}`; // same as the dashboard's ADMIN_USER_URL

const ph = JSON.parse(readFileSync('src/beta-posthog.json', 'utf8'));
const bs = JSON.parse(readFileSync('src/beta-signups.json', 'utf8'));
const cutoff = bs.lastSignupAt; // Pacific wall clock, e.g. 2026-10-22T19:34:07.242
if (!cutoff) { console.error('compare-org-creators: src/beta-signups.json has no lastSignupAt — re-run node scripts/ingest-signups.mjs'); process.exit(1); }

const ptFmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
const toPT = (iso) => { const p = Object.fromEntries(ptFmt.formatToParts(new Date(iso)).map((x) => [x.type, x.value])); return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}`; };
const nice = (pt) => { const d = new Date(`${pt.slice(0, 19)}Z`); return `${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })}, ${d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' })} PT`; };
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// --- PostHog side: one entry per person, at their first org creation.
const phPeople = (ph.creators || []).filter((c) => c.orgUtc).map((c) => {
  const at = toPT(c.orgUtc);
  return { uid: c.uid, email: c.email, at, d: at.slice(0, 10), co: c.orgs?.[0]?.co || null };
}).filter((p) => p.d >= FROM);
const phIn = phPeople.filter((p) => p.at <= cutoff.slice(0, 19));
const phLater = phPeople.filter((p) => p.at > cutoff.slice(0, 19));

// --- Dashboard side.
const rows = bs.signups.filter((s) => s.d >= FROM && s.d <= cutoff.slice(0, 10));
const creators = rows.filter((s) => !s.nc && !s.jx);
const SRC = { m: 'Metabase as-is', u: 'Filled from all_users', p: 'Added from PostHog' };
const srcOf = (s) => s.cf || 'm';

// --- Match by user id.
const phUids = new Set(phIn.map((p) => p.uid));
const crUids = new Set(creators.map((s) => s.uid));
const rowsByUid = new Map();
for (const s of rows) (rowsByUid.get(s.uid) || rowsByUid.set(s.uid, []).get(s.uid)).push(s);
const statusOf = (uid) => {
  const list = rowsByUid.get(uid) || bs.signups.filter((s) => s.uid === uid);
  if (!list.length) return 'No Metabase signup row';
  if (list.some((s) => s.jx)) return 'Joiner on the dashboard';
  if (list.some((s) => s.nc)) return 'Never completed on the dashboard';
  return 'Signup row outside the window';
};
const matched = creators.filter((s) => phUids.has(s.uid));
const phOnly = phIn.filter((p) => !crUids.has(p.uid)).map((p) => ({ ...p, why: statusOf(p.uid) }));
const dashOnly = creators.filter((s) => !phUids.has(s.uid));
const dayShift = matched.filter((s) => { const p = phIn.find((x) => x.uid === s.uid); return p && p.d !== s.d; });

// --- Per day.
const days = [];
for (let d = new Date(`${FROM}T00:00:00Z`); d.toISOString().slice(0, 10) <= cutoff.slice(0, 10); d.setUTCDate(d.getUTCDate() + 1)) days.push(d.toISOString().slice(0, 10));
const perDay = days.map((d) => {
  const c = creators.filter((s) => s.d === d);
  return {
    d,
    ph: phIn.filter((p) => p.d === d).length,
    m: c.filter((s) => srcOf(s) === 'm').length,
    u: c.filter((s) => srcOf(s) === 'u').length,
    p: c.filter((s) => srcOf(s) === 'p').length,
    dash: c.length,
    later: phLater.filter((p) => p.d === d).length,
  };
});
const tot = { ph: phIn.length, dash: creators.length, m: creators.filter((s) => srcOf(s) === 'm').length, u: creators.filter((s) => srcOf(s) === 'u').length, p: creators.filter((s) => srcOf(s) === 'p').length };

// --- History (one snapshot per run day; a re-run the same day replaces it).
mkdirSync(OUT_DIR, { recursive: true });
const hist = existsSync(OUT_HIST) ? JSON.parse(readFileSync(OUT_HIST, 'utf8')) : [];
const runDay = new Date().toISOString().slice(0, 10);
const snap = { run: runDay, runAt: new Date().toISOString(), cutoff, posthog: tot.ph, dashboard: tot.dash, matched: matched.length, posthogOnly: phOnly.length, dashboardOnly: dashOnly.length, fromMetabase: tot.m, fromAllUsers: tot.u, fromPosthog: tot.p, posthogAfterCutoff: phLater.length };
const history = [...hist.filter((h) => h.run !== runDay), snap].sort((a, b) => (a.run < b.run ? -1 : 1));
writeFileSync(OUT_HIST, `${JSON.stringify(history, null, 2)}\n`);

// --- Chart (inline SVG): per day, PostHog bar beside a stacked dashboard bar.
const W = 760; const H = 280; const padL = 36; const padB = 46; const padT = 16;
const maxV = Math.max(4, ...perDay.map((r) => Math.max(r.ph + r.later, r.dash)));
const step = Math.ceil(maxV / 4);
const top = step * 4;
const plotW = W - padL - 10; const plotH = H - padT - padB;
const gw = plotW / perDay.length; const bw = Math.min(46, gw * 0.3);
const y = (v) => padT + plotH - (v / top) * plotH;
let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Org creators per day, PostHog vs dashboard">`;
for (let v = 0; v <= top; v += step) svg += `<line x1="${padL}" x2="${W - 10}" y1="${y(v)}" y2="${y(v)}" class="grid"/><text x="${padL - 8}" y="${y(v) + 4}" class="ax" text-anchor="end">${v}</text>`;
perDay.forEach((r, i) => {
  const cx = padL + gw * i + gw / 2;
  const x1 = cx - bw - 3; const x2 = cx + 3;
  svg += `<rect x="${x1}" y="${y(r.ph)}" width="${bw}" height="${y(0) - y(r.ph)}" class="b-ph"><title>PostHog: ${r.ph}</title></rect>`;
  if (r.later) svg += `<rect x="${x1}" y="${y(r.ph + r.later)}" width="${bw}" height="${y(r.ph) - y(r.ph + r.later)}" class="b-later"><title>PostHog after the Metabase cutoff: ${r.later}</title></rect>`;
  let base = 0;
  for (const k of ['m', 'u', 'p']) {
    if (!r[k]) continue;
    svg += `<rect x="${x2}" y="${y(base + r[k])}" width="${bw}" height="${y(base) - y(base + r[k])}" class="b-${k}"><title>${SRC[k]}: ${r[k]}</title></rect>`;
    base += r[k];
  }
  svg += `<text x="${x1 + bw / 2}" y="${y(r.ph + r.later) - 5}" class="val" text-anchor="middle">${r.ph}${r.later ? `+${r.later}` : ''}</text>`;
  svg += `<text x="${x2 + bw / 2}" y="${y(r.dash) - 5}" class="val" text-anchor="middle">${r.dash}</text>`;
  const lbl = new Date(`${r.d}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
  svg += `<text x="${cx}" y="${H - padB + 18}" class="ax" text-anchor="middle">${lbl}</text>`;
  if (r.d === cutoff.slice(0, 10)) svg += `<text x="${cx}" y="${H - padB + 33}" class="ax small" text-anchor="middle">to ${nice(cutoff).split(', ')[1]}</text>`;
});
svg += '</svg>';

const personRow = (email, uid, when, note) => `<tr><td>${uid ? `<a href="${ADMIN(uid)}" target="_blank" rel="noopener">${esc(email)}</a>` : esc(email)}</td><td>${esc(when)}</td><td>${esc(note)}</td></tr>`;
const table = (title, desc, body, empty) => `<section><h2>${title}</h2><p class="sub">${desc}</p>${body.length ? `<table><thead><tr><th>Person</th><th>When</th><th>Why</th></tr></thead><tbody>${body.join('')}</tbody></table>` : `<p class="ok">${empty}</p>`}</section>`;
const histRows = history.slice(-30).reverse().map((h) => `<tr><td>${h.run}</td><td>${nice(h.cutoff)}</td><td>${h.posthog}</td><td>${h.dashboard}</td><td>${h.matched}</td><td>${h.posthogOnly}</td><td>${h.dashboardOnly}</td><td>${h.fromAllUsers}</td><td>${h.fromPosthog}</td></tr>`).join('');

const gap = tot.dash - tot.ph;
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Org Creators Check</title>
<style>
:root{--bg:#f8f6f1;--card:#fff;--ink:#111;--mute:#6b6b6b;--line:#e6e2d9;--ph:#111;--m:#9b30ff;--u:#c98bff;--p:#f2a93b;--later:#cfcfcf;--ok:#1f7a4d;--warn:#b54708}
@media (prefers-color-scheme:dark){:root{--bg:#141414;--card:#1d1d1d;--ink:#f2f2f2;--mute:#a3a3a3;--line:#333;--ph:#f2f2f2;--later:#555}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Inter,sans-serif;padding:24px 16px}
main{max-width:860px;margin:0 auto}h1{font-size:22px;margin:0 0 4px}h2{font-size:16px;margin:0 0 2px}.sub{color:var(--mute);margin:0 0 12px}
.card,section{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:16px 18px;margin:14px 0}
.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px}.kpi b{display:block;font-size:26px}.kpi span{color:var(--mute);font-size:12.5px}
.legend{display:flex;flex-wrap:wrap;gap:14px;margin:8px 0 0;font-size:12.5px;color:var(--mute)}.legend i{display:inline-block;width:11px;height:11px;border-radius:2px;margin-right:5px;vertical-align:-1px}
svg{width:100%;height:auto;display:block}.grid{stroke:var(--line)}.ax{fill:var(--mute);font-size:11.5px}.ax.small{font-size:10.5px}.val{fill:var(--ink);font-size:11.5px;font-weight:600}
.b-ph{fill:var(--ph)}.b-m{fill:var(--m)}.b-u{fill:var(--u)}.b-p{fill:var(--p)}.b-later{fill:var(--later)}
table{width:100%;border-collapse:collapse;font-size:13px}th,td{text-align:left;padding:6px 8px;border-bottom:1px solid var(--line);vertical-align:top}th{color:var(--mute);font-weight:600}
a{color:var(--m)}.ok{color:var(--ok);margin:0}.warn{color:var(--warn)}.scroll{overflow-x:auto}
</style></head><body><main>
<h1>Org creators: PostHog vs signup data</h1>
<p class="sub">Since ${FROM} (Pacific days) · Metabase export through <b>${nice(cutoff)}</b> · PostHog pulled ${esc(new Date(ph.pulledAt).toUTCString())} · generated ${esc(new Date().toUTCString())}</p>
<div class="card kpis">
  <div class="kpi"><b>${tot.ph}</b><span>PostHog "Organization created" (same window)</span></div>
  <div class="kpi"><b>${tot.dash}</b><span>Dashboard org creators</span></div>
  <div class="kpi"><b class="${gap ? 'warn' : ''}">${gap > 0 ? '+' : ''}${gap}</b><span>Difference (dashboard − PostHog)</span></div>
  <div class="kpi"><b>${tot.u + tot.p}</b><span>Org creators only counted thanks to fills (${tot.u} all_users · ${tot.p} PostHog)</span></div>
  <div class="kpi"><b>${phLater.length}</b><span>PostHog creators after the Metabase cutoff (not compared)</span></div>
</div>
<div class="card"><h2>Per day</h2><p class="sub">Left bar PostHog (grey = after the Metabase cutoff), right bar dashboard org creators by where the company came from.</p>
<div class="scroll">${svg}</div>
<div class="legend"><span><i style="background:var(--ph)"></i>PostHog</span><span><i style="background:var(--later)"></i>PostHog after cutoff</span><span><i style="background:var(--m)"></i>${SRC.m}</span><span><i style="background:var(--u)"></i>${SRC.u}</span><span><i style="background:var(--p)"></i>${SRC.p}</span></div></div>
${table('In PostHog, not a dashboard org creator', 'Fired Organization Created before the cutoff but has no org-creator signup row.', phOnly.map((p) => personRow(p.email, p.uid, nice(p.at), p.why)), 'None — every PostHog creator is a dashboard org creator.')}
${table('Dashboard org creator, not in PostHog', 'Created a company in Metabase without an Organization Created event (e.g. existing users adding a company).', dashOnly.map((s) => personRow(s.email || s.uid, s.uid, s.d, s.cf ? SRC[s.cf] : 'Metabase row; no PostHog event')), 'None.')}
${table('Counted only because of a fill', 'Metabase user_signups had no company for these — the new-onboarding gap. Should shrink to zero once engineering fixes it.', creators.filter((s) => s.cf).map((s) => personRow(s.email || s.uid, s.uid, s.d, SRC[s.cf])), 'None — Metabase had every company.')}
${dayShift.length ? table('Same person, different day', 'Matched, but the signup row and the PostHog event fall on different Pacific days.', dayShift.map((s) => personRow(s.email || s.uid, s.uid, `${s.d} (dashboard) vs ${phIn.find((p) => p.uid === s.uid).d} (PostHog)`, 'Signup row created before the org')), '') : ''}
<section><h2>History</h2><p class="sub">One snapshot per refresh day.</p><div class="scroll"><table><thead><tr><th>Run</th><th>Metabase through</th><th>PostHog</th><th>Dashboard</th><th>Matched</th><th>PostHog only</th><th>Dashboard only</th><th>all_users fills</th><th>PostHog fills</th></tr></thead><tbody>${histRows}</tbody></table></div></section>
</main></body></html>`;
writeFileSync(OUT_HTML, html);

console.log(`compare-org-creators: through ${cutoff} — PostHog ${tot.ph} vs dashboard ${tot.dash} org creators (matched ${matched.length}, PostHog only ${phOnly.length}, dashboard only ${dashOnly.length}; fills: all_users ${tot.u}, PostHog ${tot.p}; ${phLater.length} PostHog creators after the cutoff) → ${OUT_HTML}`);
for (const p of phOnly) console.log(`  PostHog only: ${p.email} (${p.why})`);
for (const s of dashOnly) console.log(`  dashboard only: ${s.email || s.uid}`);
