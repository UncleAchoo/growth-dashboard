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

if (src.endsWith('.csv')) {
  // --- Legacy: one master CSV with first_* columns already computed ---------
  const rows = readTable(src, ['created_at', 'self_selected_role', 'recorder_first_installed_at', 'calendar_first_connected_at', 'email_first_connected_at', 'first_meeting_recorded_at', 'first_email_or_asset_sent_at']);
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
  const base = readTable(T.signups, ['user_id', 'company_id', 'created_at', 'self_selected_role']);
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
    if (s.snd || s.pub || s.rec || s.cal || s.em) {
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
  signups,
};
fs.writeFileSync(out, JSON.stringify(json));
const n = (k) => signups.filter((s) => s[k]).length;
console.log(`beta-signups: ${signups.length} signups ${json.firstDate} → ${json.lastDate} · rec ${n('rec')} cal ${n('cal')} em ${n('em')} mt ${n('mt')} snd ${n('snd')} pub ${n('pub')} ret ${n('ret')} ints ${n('ints')} → ${path.relative(root, out)}`);
