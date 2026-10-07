// Beta dashboard (?beta): builds src/beta-signups.json from the Metabase exports.
//
//   npm run ingest-signups                      (reads data/data-queries/)
//   npm run ingest-signups -- path/to/folder    (another folder of split tables)
//   npm run ingest-signups -- path/to/file.csv  (legacy single "master" CSV)
//
// Split-table mode (default) reads the newest file for each table in the folder
// (Metabase appends a timestamp to each filename):
//   user_signups_*                    one row per signup = user + company (work role). Backbone.
//   recorder_install_events_*         one row per recorder install
//   integration_connection_events_*   one row per integration connection (any toolkit)
//   recorder_meeting_events_*         one row per finalized meeting capture
//   email_delivery_events_*           one row per email delivery (send or draft)
//   assets_published_*                (optional) one row per asset publish, since Feb 16 2026.
//                                     Keyed by created_by_user_id only (no company_id) —
//                                     see the pub rule below.
// All event tables carry user_id + company_id, so every milestone is attached to
// the specific signup (user + company) it happened in.
//
// Rules (agreed with Nick, Oct 6 2026):
//   rec  = first recorder install
//   cal  = first google_calendar connection, ANY status (failed/pending count:
//          we only care that they tried to integrate)
//   em   = first gmail connection, ANY status
//   mt   = first finalized meeting capture, any outcome (complete or partial)
//   snd  = first email delivery, action 'send' OR 'create_draft'
//   pub  = first asset publish (published_at_utc, any current_state). The asset
//          export has no company_id, so a user's first publish is attached to
//          that user's latest signup created on or before the publish (or their
//          first signup if all are later). Rows with no created_by_user_id
//          can't be attributed and are skipped.
//   Activated (dashboard) = snd OR pub, whichever came first.
//   ret  = first day AFTER the activation day with any "return" activity
//          (Nick, Oct 6): used credits (_customer_health__all_credit_usage_*,
//          credits_used > 0), created an asset (assets_created_*), published an
//          asset (assets_published_*), or sent/drafted an email. The activation
//          day itself never counts. retVia = what they did that day
//          (c = credits, a = asset, e = email). The dashboard applies the
//          7-day window (ret ≤ activation + 7). Credits are matched to the
//          signup by email + company_id (falls back to email only); assets have
//          no company, so they're attached like pub (latest signup on/before).
//   ints = every integration connected, by toolkit name (blank toolkit →
//          'custom_integration'). Shared (org-wide) connections count for every
//          signup at that company, dated from the later of the connection and
//          the signup.
//   Connections with no connected_at (some pending/failed rows) can't be dated
//   and are skipped; the count is logged.
//
// Only the fields the charts need are kept — names are dropped, and emails +
// user ids are kept ONLY for activated signups (for the activated-users list
// with admin-profile links). NOTE: those emails end up in the committed JSON
// and the deployed bundle.
// Every signup row counts (no internal/test filtering, no dedupe).
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const arg = process.argv[2] || 'data/data-queries';
const src = path.resolve(root, arg);
const out = path.join(root, 'src/beta-signups.json');

// Minimal RFC-4180 parser (handles quoted fields with commas / newlines).
function parseCsv(text) {
  const rows = [];
  let row = [], field = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') q = false;
      else field += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((v) => v !== ''));
}
function readTable(file, required = []) {
  const [header, ...rows] = parseCsv(fs.readFileSync(file, 'utf8').replace(/^﻿/, ''));
  const names = header.map((h) => h.trim());
  for (const k of required) if (!names.includes(k)) throw new Error(`${path.basename(file)} missing column: ${k}`);
  return rows.map((r) => Object.fromEntries(names.map((h, i) => [h, (r[i] || '').trim()])));
}

const day = (v) => (v ? v.slice(0, 10) : null); // YYYY-MM-DD (timestamps are UTC)
const minDay = (a, b) => (!a ? b : !b ? a : a < b ? a : b);
const maxDay = (a, b) => (!a ? b : !b ? a : a > b ? a : b);
const key = (userId, companyId) => `${userId}|${companyId}`;

let signups;
let source;
let HAS_CO_NAME = false; // user_signups export carries company_name
let AMP_EVENTS = null; // coverage of data/amplitude/signup_events.json, if pulled
let INTERNAL_EXCLUDED = 0; // @mutinyhq.com signups dropped

if (src.endsWith('.csv')) {
  // --- Legacy: one master CSV with first_* columns already computed ---------
  const rows = readTable(src, ['created_at', 'self_selected_role', 'recorder_first_installed_at', 'calendar_first_connected_at', 'email_first_connected_at', 'first_meeting_recorded_at', 'first_email_or_asset_sent_at'])
    .filter((r) => !/@mutinyhq\.com$/i.test((r.email || '').trim())); // no internal signups
  signups = rows.map((r) => ({
    d: day(r.created_at),
    role: r.self_selected_role || null,
    co: r.company_id || null,
    rec: day(r.recorder_first_installed_at),
    cal: day(r.calendar_first_connected_at),
    em: day(r.email_first_connected_at),
    mt: day(r.first_meeting_recorded_at),
    snd: day(r.first_email_or_asset_sent_at),
    ...(r.company_id ? {} : { nc: 1 }),
  }));
  source = path.basename(src);
} else {
  // --- Split tables ------------------------------------------------------------
  const files = fs.readdirSync(src).filter((f) => f.endsWith('.csv'));
  const newest = (prefix) => {
    const hits = files.filter((f) => f.startsWith(prefix)).sort();
    if (!hits.length) throw new Error(`No ${prefix}*.csv in ${path.relative(root, src)}`);
    return path.join(src, hits[hits.length - 1]);
  };
  const T = {
    signups: newest('user_signups_'),
    installs: newest('recorder_install_events_'),
    connections: newest('integration_connection_events_'),
    meetings: newest('recorder_meeting_events_'),
    emails: newest('email_delivery_events_'),
  };
  const assetFile = files.filter((f) => f.startsWith('assets_published_')).sort().pop();
  // Internal signups are left out everywhere (Nick, Oct 7): any user whose
  // email domain is @mutinyhq.com. Done before anything else, so internal
  // users also don't count as a company's first signup, a paying user, etc.
  const allRows = readTable(T.signups, ['user_id', 'company_id', 'created_at', 'self_selected_role', 'email']);
  const isInternal = (r) => /@mutinyhq\.com$/i.test((r.email || '').trim());
  const base = allRows.filter((r) => !isInternal(r));
  INTERNAL_EXCLUDED = allRows.length - base.length;
  console.log(`  excluded ${INTERNAL_EXCLUDED} internal signups (@mutinyhq.com)`);
  HAS_CO_NAME = base.length > 0 && 'company_name' in base[0];
  const installs = readTable(T.installs, ['user_id', 'company_id', 'installed_at']);
  const connections = readTable(T.connections, ['user_id', 'company_id', 'toolkit', 'connection_scope', 'connected_at']);
  const meetings = readTable(T.meetings, ['user_id', 'company_id', 'occurred_at']);
  const emails = readTable(T.emails, ['user_id', 'company_id', 'action', 'completed_at']);

  // First date per signup (user + company) for a list of events.
  const firstBy = (rows, tsCol, keep = () => true) => {
    const m = new Map();
    for (const r of rows) {
      if (!keep(r) || !r[tsCol]) continue;
      const k = key(r.user_id, r.company_id);
      m.set(k, minDay(m.get(k), day(r[tsCol])));
    }
    return m;
  };
  const REC = firstBy(installs, 'installed_at');
  const CAL = firstBy(connections, 'connected_at', (r) => r.toolkit === 'google_calendar');
  const EM = firstBy(connections, 'connected_at', (r) => r.toolkit === 'gmail');
  const MT = firstBy(meetings, 'occurred_at');
  const SND = firstBy(emails, 'completed_at', (r) => r.action === 'send' || r.action === 'create_draft');

  // A user-level event (no company) is attached to that user's latest signup
  // created on or before the event day (or their first signup if all are later).
  const signupsByUser = new Map();
  for (const r of base) (signupsByUser.get(r.user_id) || signupsByUser.set(r.user_id, []).get(r.user_id)).push(r);
  for (const list of signupsByUser.values()) list.sort((a, b) => a.created_at.localeCompare(b.created_at));
  const signupKeyFor = (uid, d) => {
    const list = signupsByUser.get(uid);
    if (!list?.length) return null;
    const before = list.filter((r) => day(r.created_at) <= d);
    const target = before.length ? before[before.length - 1] : list[0];
    return key(target.user_id, target.company_id);
  };

  // Return activity per signup: key -> Map(day -> Set of c|a|e).
  const ACTIVITY = new Map();
  const addAct = (k, d, type) => {
    if (!k || !d) return;
    const m = ACTIVITY.get(k) || ACTIVITY.set(k, new Map()).get(k);
    (m.get(d) || m.set(d, new Set()).get(d)).add(type);
  };
  for (const r of emails) {
    if ((r.action === 'send' || r.action === 'create_draft') && r.completed_at) addAct(key(r.user_id, r.company_id), day(r.completed_at), 'e');
  }

  // First asset publish per USER, then attached to one of that user's signups.
  const PUB = new Map(); // signup key -> day
  let unattributedPublishes = 0;
  if (assetFile) {
    const assets = readTable(path.join(src, assetFile), ['created_by_user_id', 'published_at_utc']);
    const firstPubByUser = new Map();
    for (const r of assets) {
      if (!r.published_at_utc) continue;
      if (!r.created_by_user_id) { unattributedPublishes += 1; continue; }
      const d = day(r.published_at_utc);
      firstPubByUser.set(r.created_by_user_id, minDay(firstPubByUser.get(r.created_by_user_id), d));
      addAct(signupKeyFor(r.created_by_user_id, d), d, 'a');
    }
    for (const [uid, d] of firstPubByUser) {
      const k = signupKeyFor(uid, d);
      if (k) PUB.set(k, d);
    }
    T.assets = path.join(src, assetFile);
  } else {
    console.log('  no assets_published_*.csv — activation = email only');
  }

  // Assets created (return activity only).
  const createdFile = files.filter((f) => f.startsWith('assets_created_')).sort().pop();
  if (createdFile) {
    const created = readTable(path.join(src, createdFile), ['created_by_user_id', 'created_at_utc']);
    for (const r of created) {
      if (!r.created_by_user_id || !r.created_at_utc) continue;
      const d = day(r.created_at_utc);
      addAct(signupKeyFor(r.created_by_user_id, d), d, 'a');
    }
    T.assetsCreated = path.join(src, createdFile);
  } else {
    console.log('  no assets_created_*.csv — return activity excludes asset creation');
  }

  // Credit usage by user + day (return activity only). Keyed by email +
  // company_id; if that pair isn't a signup, fall back to the user by email.
  const creditFile = files.filter((f) => f.startsWith('_customer_health__all_credit_usage')).sort().pop();
  let unmatchedCredits = 0;
  if (creditFile) {
    const credits = readTable(path.join(src, creditFile), ['email', 'company_id', 'usage_date', 'credits_used']);
    const byEmailCo = new Map();
    const uidByEmail = new Map();
    for (const r of base) {
      if (!r.email) continue;
      const e = r.email.toLowerCase();
      byEmailCo.set(`${e}|${r.company_id}`, key(r.user_id, r.company_id));
      if (!uidByEmail.has(e)) uidByEmail.set(e, r.user_id);
    }
    for (const r of credits) {
      if (!(Number(r.credits_used) > 0) || !r.usage_date) continue;
      const e = r.email.toLowerCase();
      const d = day(r.usage_date);
      const k = byEmailCo.get(`${e}|${r.company_id}`) || (uidByEmail.has(e) ? signupKeyFor(uidByEmail.get(e), d) : null);
      if (k) addAct(k, d, 'c'); else unmatchedCredits += 1;
    }
    T.credits = path.join(src, creditFile);
  } else {
    console.log('  no _customer_health__all_credit_usage_*.csv — return activity excludes credits');
  }

  // Integrations by toolkit: personal per signup, shared per company.
  const toolkitOf = (r) => r.toolkit || 'custom_integration';
  const personal = new Map(); // signup key -> { toolkit: day }
  const shared = new Map(); // company_id -> { toolkit: day }
  let undated = 0;
  for (const r of connections) {
    if (!r.connected_at) { undated += 1; continue; }
    const tk = toolkitOf(r);
    const d = day(r.connected_at);
    if (r.connection_scope === 'shared') {
      const o = shared.get(r.company_id) || {};
      o[tk] = minDay(o[tk], d);
      shared.set(r.company_id, o);
    } else {
      const k = key(r.user_id, r.company_id);
      const o = personal.get(k) || {};
      o[tk] = minDay(o[tk], d);
      personal.set(k, o);
    }
  }

  // Creator of each company = its earliest signup row (by created_at). Every
  // later signup on that company "joined an existing company" (invited or not).
  const creatorRow = new Map(); // company_id -> row
  for (const r of base) {
    if (!r.company_id) continue;
    const cur = creatorRow.get(r.company_id);
    if (!cur || r.created_at < cur.created_at) creatorRow.set(r.company_id, r);
  }

  // Per-person Amplitude events (npm run pull-amp-events): attach each Company
  // Setup Complete (with its "How did you hear about us?" answer) and each
  // accepted invite to the user's signup row closest in time (Amplitude
  // user_id = Metabase user id; a user can have several company signups).
  const ampFile = path.join(root, 'data/amplitude/signup_events.json');
  const AMP_MATCH_DAYS = 3;
  const evByRow = new Map(); // row -> { ref, csc, inv }
  if (fs.existsSync(ampFile)) {
    const amp = JSON.parse(fs.readFileSync(ampFile, 'utf8'));
    const rowsByUid = new Map();
    for (const r of base) (rowsByUid.get(r.user_id) || rowsByUid.set(r.user_id, []).get(r.user_id)).push(r);
    const ms = (v) => Date.parse(String(v).replace(' ', 'T') + (/[zZ]|[+-]\d\d:?\d\d$/.test(v) ? '' : 'Z'));
    // Metabase timestamps are US Pacific wall-clock time (Amplitude's are UTC):
    // matched events sit ~7h (PDT) / 8h (PST) after the signup. Convert first.
    const laOffsetMs = (utcMs) => {
      const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(new Date(utcMs)).map((x) => [x.type, x.value]));
      return Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second) - Math.floor(utcMs / 1000) * 1000;
    };
    const pacificToUtc = (v) => { const wall = ms(v); return wall - laOffsetMs(wall - laOffsetMs(wall)); };
    // Which signup row an event belongs to (Nick's Oct 7 test, vince@rdy.vc:
    // his answer landed on the company he JOINED, so he showed twice). A
    // Company Setup Complete belongs to a company the user CREATED (first
    // signup on it); an accepted invite to one they JOINED. Prefer those rows,
    // then the closest in time.
    const attach = (uid, t, kind, fn) => {
      const rows = rowsByUid.get(uid);
      if (!rows) return false;
      const et = ms(t);
      const fits = (r) => {
        const isCreator = r.company_id && creatorRow.get(r.company_id) === r;
        return kind === 'csc' ? isCreator : kind === 'inv' ? Boolean(r.company_id) && !isCreator : true;
      };
      let best = null;
      let bestScore = Infinity;
      for (const r of rows) {
        const gap = Math.abs(et - pacificToUtc(r.created_at));
        if (gap > AMP_MATCH_DAYS * 86400000) continue;
        const score = (fits(r) ? 0 : 1e15) + gap; // role fit first, then time
        if (score < bestScore) { best = r; bestScore = score; }
      }
      if (!best) return false;
      fn(evByRow.get(best) || evByRow.set(best, {}).get(best));
      return true;
    };
    let cscN = 0, cscHit = 0, invN = 0, invHit = 0;
    const days = Object.keys(amp.days || {}).sort();
    for (const d of days) {
      for (const e of amp.days[d].csc || []) {
        cscN += 1;
        const ref = e.ref && e.ref !== '(none)' ? String(e.ref).trim() : null;
        if (attach(e.uid, e.t, 'csc', (o) => { o.csc = 1; if (ref) o.ref = ref; })) cscHit += 1;
      }
      for (const e of amp.days[d].inv || []) {
        invN += 1;
        if (attach(e.uid, e.t, 'inv', (o) => { o.inv = 1; })) invHit += 1;
      }
    }
    AMP_EVENTS = { firstDay: days[0] || null, lastDay: days[days.length - 1] || null, pulledAt: amp.pulledAt || null };
    console.log(`  Amplitude per-person events ${days[0]} → ${days[days.length - 1]}: matched ${cscHit}/${cscN} company setups, ${invHit}/${invN} accepted invites to signups`);
  }

  signups = base.map((r) => {
    const k = key(r.user_id, r.company_id);
    const d = day(r.created_at);
    const ints = { ...(personal.get(k) || {}) };
    for (const [tk, cd] of Object.entries((r.company_id && shared.get(r.company_id)) || {})) {
      ints[tk] = minDay(ints[tk], maxDay(cd, d)); // inherited from the day both exist
    }
    const s = {
      d,
      role: r.self_selected_role || null,
      co: r.company_id || null,
      rec: REC.get(k) || null,
      cal: CAL.get(k) || null,
      em: EM.get(k) || null,
      mt: MT.get(k) || null,
      snd: SND.get(k) || null,
      pub: PUB.get(k) || null,
    };
    if (Object.keys(ints).length) s.ints = ints;
    // No company name = never finished onboarding (no workspace, or a workspace
    // that was never named). Used to split the "No answer" row of the
    // self-reported channel table. Uses the optional company_name column when
    // the user_signups export has it; otherwise only "no company at all".
    if (!r.company_id || (HAS_CO_NAME && !r.company_name)) s.nc = 1;
    // Joined an existing company = the company already had an earlier signup
    // (Nick, Oct 7: covers accepted invites AND joiners with no invite event).
    else if (creatorRow.get(r.company_id) !== r) s.jx = 1;
    // Per-person Amplitude: the signup's own answer + whether they accepted an invite.
    const amp = evByRow.get(r);
    if (amp?.ref) s.ref = amp.ref;
    if (amp?.csc) s.csc = 1;
    if (amp?.inv) s.inv = 1;
    // First return activity after the activation day (any distance; the
    // dashboard applies the 7-day window).
    const act = s.snd && s.pub ? minDay(s.snd, s.pub) : s.snd || s.pub;
    if (act && ACTIVITY.has(k)) {
      let best = null;
      for (const d of ACTIVITY.get(k).keys()) if (d > act && (!best || d < best)) best = d;
      if (best) { s.ret = best; s.retVia = [...ACTIVITY.get(k).get(best)].sort().join(''); }
    }
    // Activated signups keep their user id + email so the dashboard's
    // "activated users" list can show who they are and link to the admin
    // profile (Nick, Oct 6). Nobody else's email is kept.
    // Same for signups that did any onboarding step (recorder, calendar, email),
    // so the per-step "who did it" lists can name them.
    // And "Never completed" signups since Feb 16 (signup counts start then),
    // for the clickable row in the channel table (Nick, Oct 7).
    // ... and "Other" (created a company but no answer / invite in Amplitude),
    // the channel table's other clickable row (Nick, Oct 7).
    const otherRow = !s.nc && !s.jx && !s.ref && !s.inv && AMP_EVENTS;
    if (s.snd || s.pub || s.rec || s.cal || s.em || ((s.nc || otherRow) && d >= '2026-02-16')) {
      s.uid = r.user_id;
      if (r.email) s.email = r.email;
    }
    return s;
  });
  source = `${path.relative(root, src)}/ (${Object.values(T).map((f) => path.basename(f).replace(/_\d{4}-\d{2}-\d{2}T.*$/, '')).join(', ')})`;
  if (undated) console.log(`  skipped ${undated} integration connections with no connected_at (can't be dated)`);
  if (unattributedPublishes) console.log(`  skipped ${unattributedPublishes} asset publishes with no created_by_user_id (can't be attributed)`);
  if (unmatchedCredits) console.log(`  skipped ${unmatchedCredits} credit-usage rows whose email isn't in user_signups`);
}

signups = signups.filter((s) => s.d).sort((a, b) => a.d.localeCompare(b.d));
const json = {
  pulledAt: new Date().toISOString(),
  source,
  firstDate: signups[0]?.d,
  lastDate: signups[signups.length - 1]?.d,
  hasCompanyName: HAS_CO_NAME,
  ampEvents: AMP_EVENTS,
  internalExcluded: INTERNAL_EXCLUDED,
  signups,
};
fs.writeFileSync(out, JSON.stringify(json));

// --- Credits (Nick, Oct 7): monthly credit usage per company + each company's
// current credit allowance, for the "monthly credits used" chart under the
// retention heat map. Written to src/beta-credits.json (no names/emails).
// Only companies that buy credits (business / enterprise / trial plan, or an
// add-on pack) are kept, to keep the file small.
{
  const qdir = src.endsWith('.csv') ? path.join(root, 'data/data-queries') : src;
  const qfiles = fs.existsSync(qdir) ? fs.readdirSync(qdir).filter((f) => f.endsWith('.csv')) : [];
  const usageFile = qfiles.filter((f) => f.startsWith('_customer_health__all_credit_usage')).sort().pop();
  const allowFile = qfiles.filter((f) => f.startsWith('_customer_health__credit_allowance')).sort().pop();
  const creditsOut = path.join(root, 'src/beta-credits.json');
  if (usageFile && allowFile) {
    const allowance = {};
    // Every company that has ever paid through Stripe (src/beta-paying.json) is
    // kept too — otherwise companies that later churned (now on the free plan,
    // no add-on pack) lose their usage history and their past cycles read 0%.
    const stripeCos = new Set();
    try {
      for (const c of JSON.parse(fs.readFileSync(path.join(root, 'src/beta-paying.json'), 'utf8')).customers || []) if (c.co) stripeCos.add(c.co);
    } catch { /* no Stripe pull yet */ }
    for (const r of readTable(path.join(qdir, allowFile), ['company_id', 'plan', 'active_allowance', 'addon_pack'])) {
      const keep = ['business', 'enterprise', 'trial'].includes(r.plan) || Number(r.addon_pack) > 0 || stripeCos.has(r.company_id);
      if (!r.company_id || !keep) continue;
      // n = company name, for the credits details modal (company names only, no people).
      allowance[r.company_id] = {
        a: Number(r.active_allowance) || 0, plan: r.plan, n: r.company || null,
        // Today's snapshot, for QA in the details modal.
        u30: r.used_last_30d === '' ? null : Number(r.used_last_30d),
        pctNow: r.pct_allowance_used === '' ? null : Number(r.pct_allowance_used),
        exp: r.next_expiry || null,
        man: r.manual_adjustment === '' ? null : Number(r.manual_adjustment), // one-off manual credits (in the allowance)
        rew: r.reward_bonus === '' ? null : Number(r.reward_bonus),
      };
    }
    // Stripe companies missing from the allowance export (e.g. deleted
    // workspaces) still keep their usage; no allowance today (a: 0).
    for (const co of stripeCos) if (!allowance[co]) allowance[co] = { a: 0, plan: null, n: null, missingFromAllowanceExport: true };
    const usage = {};
    const daily = {};
    let lastDay = null;
    for (const r of readTable(path.join(qdir, usageFile), ['company_id', 'usage_date', 'credits_used'])) {
      if (/@mutinyhq\.com$/i.test((r.email || '').trim())) continue; // internal users' usage doesn't count (Nick, Oct 7)
      const d = day(r.usage_date);
      if (d && (!lastDay || d > lastDay)) lastDay = d;
      if (!allowance[r.company_id] || !d) continue;
      if (!allowance[r.company_id].n && r.company_name) allowance[r.company_id].n = r.company_name;
      const m = d.slice(0, 7);
      const u = usage[r.company_id] || (usage[r.company_id] = {});
      u[m] = Math.round(((u[m] || 0) + (Number(r.credits_used) || 0)) * 100) / 100;
      // Daily too, so usage can be summed per billing cycle (cycle-based charts).
      const dd = daily[r.company_id] || (daily[r.company_id] = {});
      dd[d] = Math.round(((dd[d] || 0) + (Number(r.credits_used) || 0)) * 100) / 100;
    }
    for (const dd of Object.values(daily)) for (const k of Object.keys(dd)) if (!dd[k]) delete dd[k];
    const usageFirstDay = Object.values(daily).flatMap((dd) => Object.keys(dd)).sort()[0] || null;
    fs.writeFileSync(creditsOut, JSON.stringify({ pulledAt: new Date().toISOString(), usageFile, allowanceFile: allowFile, usageFirstDay, usageLastDay: lastDay, allowance, usage, daily }));
    console.log(`beta-credits: ${Object.keys(allowance).length} companies with an allowance, usage through ${lastDay} → ${path.relative(root, creditsOut)}`);
  } else if (!fs.existsSync(creditsOut)) {
    fs.writeFileSync(creditsOut, JSON.stringify({ pulledAt: null, allowance: {}, usage: {} }));
    console.log('  no credit usage / allowance CSVs — wrote an empty src/beta-credits.json');
  }
}
const n = (k) => signups.filter((s) => s[k]).length;
console.log(`beta-signups: ${signups.length} signups ${json.firstDate} → ${json.lastDate} · rec ${n('rec')} cal ${n('cal')} em ${n('em')} mt ${n('mt')} snd ${n('snd')} pub ${n('pub')} ret ${n('ret')} ints ${n('ints')} → ${path.relative(root, out)}`);
