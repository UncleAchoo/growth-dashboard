#!/usr/bin/env node
// Paying companies from Stripe — same definitions + math as the stripe-dash
// revenue dashboard (copied Oct 7 2026). Feeds the ?beta "Paid companies"
// section (paying PLG companies + users in them, over time).
//
//   npm run pull-stripe              pull Stripe + HubSpot, then build outputs
//   npm run pull-stripe -- --offline rebuild outputs from the cached raw pulls
//
// Env (.env.local, gitignored):
//   STRIPE_API_KEY        restricted READ-ONLY live key (rk_live_…): Customers,
//                         Subscriptions, Invoices, Prices
//   STRIPE_HISTORY_START  default 2026-03-26 (Stripe went into the product)
//   HUBSPOT_TOKEN         (or HUBSPOT_PRIVATE_APP_TOKEN) companies + deals read;
//                         only for the enterprise exclusion
//
// Writes:
//   data/stripe/stripe_{subscriptions,customers,invoices}.json   raw (gitignored)
//   data/stripe/enterprise_set.json                              HubSpot enterprise app ids (cache)
//   data/stripe/paying_companies.{json,csv}                      one row per customer (gitignored — emails)
//   src/beta-paying.json                                         PLG MRR timelines keyed by company_id,
//                                                                no names/emails (committed, read by the dashboard)

import { writeFileSync, readFileSync, mkdirSync, existsSync } from 'node:fs';
import Stripe from 'stripe';
import { EPS, buildRows, payingPlgAt, toUnix, billingCycles } from './lib/stripe-paying.mjs';

// --- Tiny inline dotenv loader (same as pull-data.mjs) ---------------------
if (existsSync('.env.local')) {
  for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq < 0) continue;
    const key = t.slice(0, eq).trim();
    const val = t.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
    if (!process.env[key]) process.env[key] = val;
  }
}

const STRIPE_API_KEY = process.env.STRIPE_API_KEY;
const HISTORY_START_ISO = process.env.STRIPE_HISTORY_START || '2026-03-26';
const HISTORY_START = toUnix(HISTORY_START_ISO);
const HUBSPOT_TOKEN = process.env.HUBSPOT_TOKEN || process.env.HUBSPOT_PRIVATE_APP_TOKEN;
const OFFLINE = process.argv.includes('--offline');
const DIR = 'data/stripe';
const CONFIG_PATH = 'config/enterprise_customers.json';
const DASH_OUT = 'src/beta-paying.json';
const log = (...a) => console.log(...a);
const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
const writeJson = (p, v) => writeFileSync(p, JSON.stringify(v, null, 2));

// ===========================================================================
// 1. Raw Stripe pulls
// ===========================================================================
async function pullStripe() {
  if (!STRIPE_API_KEY) throw new Error('STRIPE_API_KEY not set (.env.local). Use a restricted read-only rk_live_ key.');
  const stripe = new Stripe(STRIPE_API_KEY);

  // a) Subscriptions — status 'all' (canceled ones are needed for churn).
  const subscriptions = [];
  for await (const s of stripe.subscriptions.list({ status: 'all', limit: 100, expand: ['data.items.data.price'] })) {
    const items = (s.items?.data || []).map((it) => ({
      price_id: it.price?.id ?? null,
      unit_amount: it.price?.unit_amount ?? null,
      currency: it.price?.currency ?? null,
      interval: it.price?.recurring?.interval ?? null,
      interval_count: it.price?.recurring?.interval_count ?? null,
      quantity: it.quantity ?? null,
      product: typeof it.price?.product === 'object' ? { id: it.price.product.id, name: it.price.product.name ?? null } : { id: it.price?.product ?? null, name: null },
    }));
    subscriptions.push({
      id: s.id,
      customer: typeof s.customer === 'object' ? s.customer?.id : s.customer,
      status: s.status,
      created: s.created,
      start_date: s.start_date,
      cancel_at_period_end: s.cancel_at_period_end,
      cancel_at: s.cancel_at,
      canceled_at: s.canceled_at,
      ended_at: s.ended_at,
      trial_start: s.trial_start,
      trial_end: s.trial_end,
      // Newer API versions moved the period onto the items.
      current_period_start: s.current_period_start ?? s.items?.data?.[0]?.current_period_start ?? null,
      current_period_end: s.current_period_end ?? s.items?.data?.[0]?.current_period_end ?? null,
      currency: s.currency,
      items,
    });
  }
  log(`  Stripe: ${subscriptions.length} subscriptions`);

  // b) Customers — required: metadata.company_id is the Mutiny app id.
  const customers = [];
  for await (const c of stripe.customers.list({ limit: 100 })) {
    customers.push({ id: c.id, name: c.name ?? null, email: c.email ?? null, created: c.created, metadata: c.metadata || {} });
  }
  log(`  Stripe: ${customers.length} customers`);

  // c) Invoices since the integration date — open + paid only.
  const invoices = [];
  let dropped = 0;
  for await (const iv of stripe.invoices.list({ limit: 100, created: { gte: HISTORY_START } })) {
    if (iv.status !== 'open' && iv.status !== 'paid') { dropped++; continue; }
    invoices.push({
      id: iv.id,
      customer: typeof iv.customer === 'object' ? iv.customer?.id : iv.customer,
      subscription: iv.parent?.subscription_details?.subscription ?? iv.subscription ?? null,
      status: iv.status,
      currency: iv.currency,
      created: iv.created,
      paid_at: iv.status_transitions?.paid_at ?? null,
      billing_reason: iv.billing_reason,
      subtotal: iv.subtotal,
      discount_total: (iv.total_discount_amounts || []).reduce((s, d) => s + (d.amount || 0), 0),
      total: iv.total,
      amount_paid: iv.amount_paid,
      lines: (iv.lines?.data || []).map((l) => ({
        amount: l.amount,
        proration: l.proration ?? l.parent?.subscription_item_details?.proration ?? l.parent?.invoice_item_details?.proration ?? false,
        period_start: l.period?.start ?? null,
        period_end: l.period?.end ?? null,
      })),
    });
  }
  log(`  Stripe: ${invoices.length} open/paid invoices since ${HISTORY_START_ISO} (${dropped} draft/void/uncollectible dropped)`);

  writeJson(`${DIR}/stripe_subscriptions.json`, subscriptions);
  writeJson(`${DIR}/stripe_customers.json`, customers);
  writeJson(`${DIR}/stripe_invoices.json`, invoices);
  return { subscriptions, customers, invoices };
}

// ===========================================================================
// 2. HubSpot enterprise set (app id → rules with graduation dates)
// ===========================================================================
async function hs(path, body) {
  const res = await fetch(`https://api.hubapi.com${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${HUBSPOT_TOKEN}` },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (res.status === 429) { await new Promise((r) => setTimeout(r, 1100)); return hs(path, body); }
  if (!res.ok) throw new Error(`HubSpot ${path} HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}
async function hsSearchAll(object, filterGroups, properties) {
  const out = [];
  let after;
  do {
    const j = await hs(`/crm/v3/objects/${object}/search`, { filterGroups, properties, limit: 100, ...(after ? { after } : {}) });
    out.push(...(j.results || []));
    after = j.paging?.next?.after;
  } while (after);
  return out;
}
async function pullEnterpriseSet() {
  if (!HUBSPOT_TOKEN) throw new Error('HUBSPOT_TOKEN / HUBSPOT_PRIVATE_APP_TOKEN not set');
  const set = {}; // appId -> { names:Set, rules:[{rule,date}] }
  const add = (appId, name, rule, date) => {
    if (!appId) return;
    (set[appId] ||= { names: [], rules: [] });
    if (name && !set[appId].names.includes(name)) set[appId].names.push(name);
    set[appId].rules.push({ rule, date });
  };

  // Closed-won deals created since 2026-01-01 → associated company's mutiny_app_id.
  // Graduation = EARLIEST closed-won closedate per app id.
  const deals = await hsSearchAll('deals', [{ filters: [
    { propertyName: 'hs_is_closed_won', operator: 'EQ', value: 'true' },
    { propertyName: 'createdate', operator: 'GTE', value: String(Date.UTC(2026, 0, 1)) },
  ] }], ['closedate', 'dealname', 'hs_is_closed_won']);
  const dealCompany = new Map(); // dealId -> [companyId]
  for (const d of deals) {
    const a = await hs(`/crm/v3/objects/deals/${d.id}/associations/companies`);
    dealCompany.set(d.id, (a.results || []).map((r) => r.id));
  }
  const companyIds = [...new Set([...dealCompany.values()].flat())];
  const companies = new Map();
  for (let i = 0; i < companyIds.length; i += 100) {
    const j = await hs('/crm/v3/objects/companies/batch/read', { properties: ['mutiny_app_id', 'name'], inputs: companyIds.slice(i, i + 100).map((id) => ({ id })) });
    for (const c of j.results || []) companies.set(c.id, c.properties || {});
  }
  const earliest = new Map(); // appId -> {date, name}
  for (const d of deals) {
    const ts = toUnix(d.properties?.closedate);
    for (const cid of dealCompany.get(d.id) || []) {
      const p = companies.get(cid);
      if (!p?.mutiny_app_id) continue;
      const cur = earliest.get(p.mutiny_app_id);
      if (!cur || (ts != null && (cur.date == null || ts < cur.date))) earliest.set(p.mutiny_app_id, { date: ts, name: p.name });
    }
  }
  for (const [appId, { date, name }] of earliest) add(appId, name, 'closed-won deal', date);

  // Enterprise revenue roster ("list 5010" definition). Graduation = start_date.
  const roster = await hsSearchAll('companies', [{ filters: [
    { propertyName: 'mutiny_app_plan', operator: 'EQ', value: 'enterprise' },
    { propertyName: 'active_mutiny_account', operator: 'EQ', value: 'true' },
    { propertyName: 'start_date', operator: 'GTE', value: String(Date.UTC(2026, 1, 1)) },
  ] }], ['mutiny_app_id', 'name', 'start_date']);
  for (const c of roster) add(c.properties?.mutiny_app_id, c.properties?.name, 'enterprise roster', toUnix(c.properties?.start_date));

  log(`  HubSpot: ${deals.length} closed-won deals → ${earliest.size} app ids; roster ${roster.length} companies; ${Object.keys(set).length} enterprise app ids total`);
  const out = { pulledAt: new Date().toISOString(), appIds: set };
  writeJson(`${DIR}/enterprise_set.json`, out);
  return out;
}

// ===========================================================================
// main
// ===========================================================================
async function main() {
  mkdirSync(DIR, { recursive: true });
  const config = readJson(CONFIG_PATH);

  let raw;
  if (OFFLINE) {
    raw = {
      subscriptions: readJson(`${DIR}/stripe_subscriptions.json`),
      customers: readJson(`${DIR}/stripe_customers.json`),
      invoices: readJson(`${DIR}/stripe_invoices.json`),
    };
    log('Offline: using cached raw Stripe pulls.');
  } else {
    log('Pulling Stripe…');
    raw = await pullStripe();
  }

  let ent;
  if (OFFLINE && existsSync(`${DIR}/enterprise_set.json`)) ent = readJson(`${DIR}/enterprise_set.json`);
  else {
    try { log('Pulling HubSpot enterprise set…'); ent = await pullEnterpriseSet(); }
    catch (err) {
      if (!existsSync(`${DIR}/enterprise_set.json`)) throw new Error(`HubSpot enterprise set failed and no cache exists: ${err.message}`);
      ent = readJson(`${DIR}/enterprise_set.json`);
      log(`  !! HubSpot pull failed (${err.message}). Using the CACHED enterprise set from ${ent.pulledAt} — paying counts may be off if enterprise deals changed since.`);
    }
  }
  const enterpriseSet = new Map(Object.entries(ent.appIds || {}));

  const { rows, annualFlags, skippedPreIntegration } = buildRows(raw, { enterpriseSet, config, historyStart: HISTORY_START });

  // Annual-billing guard: the engine doesn't normalize by interval. Any
  // non-enterprise customer on a yearly price must be looked at by a human.
  if (annualFlags.length) {
    console.error('\n!! STOP: non-enterprise customers with an annual (interval: year) subscription — the MRR engine would count a yearly invoice as MRR:');
    for (const f of annualFlags) console.error(`   ${f.id}  ${f.name || ''}  (${f.segment})`);
    console.error('Resolve (mark enterprise in config/Stripe, or confirm handling) before trusting these numbers. No outputs written.');
    process.exit(1);
  }

  // --- Outputs ------------------------------------------------------------------
  writeJson(`${DIR}/paying_companies.json`, { pulledAt: new Date().toISOString(), historyStart: HISTORY_START_ISO, rows });
  const cols = ['stripe_customer_id', 'company_id', 'name', 'email', 'domain', 'segment', 'enterprise_matched_by', 'graduated_on', 'status', 'current_mrr', 'current_arr', 'is_paying', 'scheduled_cancel', 'cancel_at', 'first_paid_at', 'last_paid_at', 'stripe_url', 'mutiny_admin_url'];
  const esc = (v) => (v == null ? '' : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  writeFileSync(`${DIR}/paying_companies.csv`, [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n') + '\n');

  // Dashboard file: PLG + graduated timelines only (enterprise never counts as
  // a paying PLG logo). No names/emails — joined to signups on company_id.
  const invByCus = new Map();
  for (const iv of raw.invoices) if (iv.customer) (invByCus.get(iv.customer) || invByCus.set(iv.customer, []).get(iv.customer)).push(iv);
  const dash = rows.filter((r) => r.segment !== 'enterprise').map((r) => ({
    co: r.company_id,
    cus: r.stripe_customer_id,
    ...(r.segment === 'graduated' ? { grad: r.graduated_ts } : {}),
    ev: r.events.map((e) => [e.ts, e.mrr_after]),
    cy: billingCycles(invByCus.get(r.stripe_customer_id)), // [start, end, renewal $, mid-cycle adds $]
  }));
  // --offline keeps the original Stripe pull time (the data didn't change).
  let pulledAt = new Date().toISOString();
  if (OFFLINE) {
    try { pulledAt = JSON.parse(readFileSync(DASH_OUT, 'utf8')).pulledAt || pulledAt; } catch { /* first run */ }
  }
  writeFileSync(DASH_OUT, JSON.stringify({ pulledAt, historyStart: HISTORY_START_ISO, customers: dash }));

  // --- Summary (compare with the revenue dashboard's tiles) ---------------------
  const plgPaying = rows.filter((r) => r.segment === 'plg' && r.is_paying);
  const plgArr = plgPaying.reduce((s, r) => s + r.current_arr, 0);
  const now = Math.floor(Date.now() / 1000);
  const check = rows.filter((r) => payingPlgAt(r, now)).length;
  log('\n=== Paying companies ===');
  log(`Paying PLG logos: ${plgPaying.length}   (timeline check: ${check})`);
  log(`PLG ARR:          $${plgArr.toLocaleString('en-US', { maximumFractionDigits: 2 })}`);
  log(`Scheduled to cancel (still counted): ${plgPaying.filter((r) => r.scheduled_cancel).length}`);
  log(`No company_id in Stripe metadata (can't join to users): ${plgPaying.filter((r) => !r.company_id).length}`);
  log(`Skipped pre-integration customers: ${skippedPreIntegration}`);
  const excluded = rows.filter((r) => r.segment !== 'plg');
  log(`\nExcluded from PLG (${excluded.length}):`);
  for (const r of excluded) {
    log(`  ${r.segment.padEnd(10)} ${r.stripe_customer_id}  ${(r.name || '').slice(0, 30).padEnd(30)} MRR $${r.current_mrr.toFixed(2).padStart(10)}  ${r.graduated_on ? `graduated ${r.graduated_on} · ` : ''}${r.enterprise_matched_by}`);
  }
  log(`\nWrote ${DIR}/paying_companies.{json,csv} and ${DASH_OUT} (${dash.length} PLG/graduated timelines).`);
  if (rows.some((r) => r.is_paying && r.current_mrr <= EPS)) log('!! sanity: is_paying/EPS mismatch');
}

main().catch((err) => { console.error(err); process.exit(1); });
