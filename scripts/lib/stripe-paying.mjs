// Paying-company logic, copied from the stripe-dash revenue dashboard (as of
// Oct 7 2026) so this project's paying count + ARR match it to the dollar.
// Pure functions only — all I/O lives in scripts/pull-stripe.mjs.
// Don't "fix" the semantics here; they're deliberate (see the comments and
// the prompt this was built from). Corrections go in config/enterprise_customers.json.

export const EPS = 1e-9;

// --- MRR engine (stripe-dash lib/recurring-run-rate.js, verbatim) ------------
export function recurringRunRateTimeline(custInvoices, custSubs) {
  const isRenewal = (iv) => iv.billing_reason === 'subscription_cycle' || iv.billing_reason === 'subscription_create';
  const netOf = (iv) => ((iv.subtotal || 0) - (iv.discount_total || 0)) / 100;   // pre-tax, post-discount, dollars
  const subActiveAt = (s, ts) => {
    if (s.created > ts) return false;
    if (s.status === 'active' || s.status === 'past_due') return true;
    if (s.status === 'canceled' || s.status === 'unpaid') {
      if (s.ended_at) return ts < s.ended_at;
      if (s.canceled_at) return ts < s.canceled_at;
      return true;
    }
    return false;
  };
  const anyActiveAt = (ts) => (custSubs || []).some((s) => subActiveAt(s, ts));

  // Merged chronological stream: billing invoices + subscription-end markers.
  const stream = [];
  for (const iv of (custInvoices || [])) {
    if (iv.status !== 'paid' && iv.status !== 'open') continue;
    stream.push({ ts: iv.paid_at || iv.created, order: 0, iv });
  }
  for (const s of (custSubs || [])) {
    const endTs = s.ended_at || ((s.status === 'canceled' || s.status === 'unpaid') ? s.canceled_at : null);
    if (endTs) stream.push({ ts: endTs, order: 1, end: true });
  }
  stream.sort((a, b) => (a.ts - b.ts) || (a.order - b.order));

  const events = [];
  let rate = 0, firstPaidAt = null, lastAt = null;
  for (const node of stream) {
    if (node.end) {
      if (rate > EPS && !anyActiveAt(node.ts)) {          // last active sub ended -> churn
        events.push({ ts: node.ts, type: 'churn', delta: -rate, mrr_after: 0 });
        lastAt = node.ts; rate = 0;
      }
      continue;
    }
    const iv = node.iv, ts = node.ts, net = netOf(iv);
    let type = null, delta = 0;
    if (isRenewal(iv)) {                                   // renewal RESETS rate to what was billed
      const eff = Math.max(0, net);                        // a negative (credited) renewal = $0, not negative MRR
      delta = eff - rate;
      if (rate <= EPS) type = eff > EPS ? 'new' : null;
      else if (delta > EPS) type = 'expansion';
      else if (delta < -EPS) type = 'contraction';
      rate = eff;
    } else {                                               // mid-cycle charge (manual / credit pack) RAISES rate now
      if (Math.abs(net) <= EPS) continue;
      delta = net;
      type = rate <= EPS ? 'new' : 'expansion';
      rate += net;
    }
    if (type) {
      events.push({ ts, type, delta, mrr_after: rate });
      if (firstPaidAt == null) firstPaidAt = ts;
      lastAt = ts;
    }
  }
  return { events, current: rate, firstPaidAt, lastAt };
}

// MRR in effect at a unix-seconds instant = mrr_after of the last event on/before it.
export function mrrAt(events, atTs) {
  let mrr = 0;
  for (const e of events || []) { if (e.ts <= atTs) mrr = e.mrr_after; else break; }
  return mrr;
}

// --- Helpers -------------------------------------------------------------------
export const toUnix = (v) => {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return v > 1e11 ? Math.floor(v / 1000) : v; // ms → s
  if (/^\d+$/.test(String(v))) return toUnix(Number(v));
  const t = Date.parse(String(v).length === 10 ? `${v}T00:00:00Z` : v);
  return Number.isNaN(t) ? null : Math.floor(t / 1000);
};
export const isoDay = (ts) => (ts == null ? null : new Date(ts * 1000).toISOString().slice(0, 10));
const groupBy = (arr, k) => {
  const m = new Map();
  for (const x of arr) { const key = x[k]; if (!key) continue; if (!m.has(key)) m.set(key, []); m.get(key).push(x); }
  return m;
};
const STATUS_RANK = ['active', 'past_due', 'trialing', 'canceled'];
function bestStatus(subs) {
  let best = null;
  for (const s of subs) {
    const r = STATUS_RANK.indexOf(s.status);
    if (r < 0) continue;
    if (best == null || r < STATUS_RANK.indexOf(best)) best = s.status;
  }
  return best || (subs[0]?.status ?? null);
}

// --- Enterprise matching -------------------------------------------------------
// enterpriseSet: Map<appId, { rules: [{ rule, date (unix|null) }] }>
// config: { app_ids: [{ name, id }], stripe_customer_ids: [] }
// Returns null (PLG) or { matched_by, graduation (unix|null = always) }.
export function enterpriseMatch(customer, enterpriseSet, config) {
  const rules = [];
  const meta = customer?.metadata || {};
  const curated = new Set((config.app_ids || []).map((x) => x.id));
  for (const v of Object.values(meta)) {
    if (curated.has(v)) rules.push({ rule: `curated app id ${v}`, date: null });
    const hit = enterpriseSet.get(v);
    if (hit) for (const r of hit.rules) rules.push({ rule: `${r.rule} (${v})`, date: r.date });
  }
  if ((config.stripe_customer_ids || []).includes(customer?.id)) rules.push({ rule: 'manual stripe_customer_ids', date: null });
  if (meta.segment === 'enterprise') rules.push({ rule: "metadata.segment = 'enterprise'", date: null });
  if (!rules.length) return null;
  const undated = rules.some((r) => r.date == null);
  const dates = rules.map((r) => r.date).filter((d) => d != null);
  return {
    matched_by: [...new Set(rules.map((r) => r.rule))].join('; '),
    graduation: undated ? null : Math.min(...dates),
  };
}

// --- Build rows ----------------------------------------------------------------
// raw: { subscriptions, customers, invoices } (trimmed shapes from pull-stripe)
// Returns { rows, annualFlags, skippedPreIntegration }.
export function buildRows(raw, { enterpriseSet, config, historyStart }) {
  const subsBy = groupBy(raw.subscriptions, 'customer');
  const invBy = groupBy(raw.invoices, 'customer');
  const custById = new Map(raw.customers.map((c) => [c.id, c]));
  const ids = new Set([...subsBy.keys(), ...invBy.keys()]);
  const rows = [];
  const annualFlags = [];
  let skippedPreIntegration = 0;

  for (const id of ids) {
    const subs = subsBy.get(id) || [];
    const invs = invBy.get(id) || [];
    const tl = recurringRunRateTimeline(invs, subs);
    if (!tl.events.length) continue; // no MRR history at all (trials, never paid)
    if (tl.current <= EPS && tl.lastAt != null && tl.lastAt < historyStart) { skippedPreIntegration++; continue; }

    const cust = custById.get(id) || { id, metadata: {} };
    const ent = enterpriseMatch(cust, enterpriseSet, config);
    let segment = 'plg';
    let graduated_on = null;
    if (ent) {
      if (ent.graduation != null && tl.firstPaidAt != null && ent.graduation > tl.firstPaidAt) {
        segment = 'graduated';
        graduated_on = ent.graduation;
      } else segment = 'enterprise';
    }
    if (segment !== 'enterprise') {
      const annual = subs.some((s) => (s.items || []).some((it) => it.interval === 'year'));
      if (annual) annualFlags.push({ id, name: cust.name, segment });
    }

    const live = subs.filter((s) => s.status === 'active' || s.status === 'past_due' || s.status === 'trialing');
    const cancelSub = live.find((s) => s.cancel_at_period_end || s.cancel_at);
    const email = cust.email || null;
    rows.push({
      stripe_customer_id: id,
      company_id: cust.metadata?.company_id || null,
      name: cust.name || null,
      email,
      domain: email && email.includes('@') ? email.split('@')[1].toLowerCase() : null,
      segment,
      enterprise_matched_by: ent ? ent.matched_by : null,
      graduated_on: isoDay(graduated_on),
      graduated_ts: graduated_on,
      status: bestStatus(subs),
      current_mrr: tl.current,
      current_arr: tl.current * 12,
      is_paying: tl.current > EPS,
      scheduled_cancel: Boolean(cancelSub),
      cancel_at: cancelSub ? isoDay(cancelSub.cancel_at || cancelSub.current_period_end) : null,
      first_paid_at: isoDay(tl.firstPaidAt),
      last_paid_at: isoDay(tl.lastAt),
      stripe_url: `https://dashboard.stripe.com/customers/${id}`,
      mutiny_admin_url: cust.metadata?.company_id ? `https://admin.mutinyhq.com/companies/${cust.metadata.company_id}` : null,
      events: tl.events,
    });
  }
  rows.sort((a, b) => b.current_mrr - a.current_mrr || a.stripe_customer_id.localeCompare(b.stripe_customer_id));
  return { rows, annualFlags, skippedPreIntegration };
}

// Paying PLG at instant T (unix s): PLG rows with MRR > 0, plus graduated rows
// before their graduation date (graduation is not churn, but after it the
// account isn't a PLG logo).
export function payingPlgAt(row, ts) {
  if (row.segment === 'enterprise') return false;
  if (row.segment === 'graduated' && ts >= row.graduated_ts) return false;
  return mrrAt(row.events, ts) > EPS;
}

// --- Billing cycles (for the cycle-based credits charts, Oct 7) -------------------
// One entry per renewal invoice (subscription_create / subscription_cycle):
//   [start, end, renewalNet$, addsNet$]
// start/end = the main (non-proration, largest) line's service period; end is
// exclusive (= next cycle's start). If a later cycle starts before this one
// ends (plan change, cancel-and-restart), this one is cut at that start.
// addsNet$ = mid-cycle charges (credit packs / manual invoices) paid inside the
// cycle — they add credits to it. Amounts are pre-tax, post-discount dollars,
// same as the MRR engine.
export function billingCycles(custInvoices) {
  const netOf = (iv) => ((iv.subtotal || 0) - (iv.discount_total || 0)) / 100;
  const isRenewal = (iv) => iv.billing_reason === 'subscription_cycle' || iv.billing_reason === 'subscription_create';
  const live = (custInvoices || []).filter((iv) => iv.status === 'paid' || iv.status === 'open');
  const cycles = [];
  for (const iv of live.filter(isRenewal)) {
    const main = [...(iv.lines || [])].filter((l) => !l.proration).sort((a, b) => (b.amount || 0) - (a.amount || 0))[0];
    let start = main?.period_start || iv.paid_at || iv.created;
    let end = main?.period_end;
    if (!end || end <= start) { const d = new Date(start * 1000); d.setUTCMonth(d.getUTCMonth() + 1); end = Math.floor(d / 1000); }
    cycles.push([start, end, Math.max(0, netOf(iv)), 0]);
  }
  cycles.sort((a, b) => a[0] - b[0]);
  for (let i = 0; i < cycles.length - 1; i++) if (cycles[i + 1][0] < cycles[i][1]) cycles[i][1] = cycles[i + 1][0];
  for (const iv of live.filter((x) => !isRenewal(x))) {
    const net = netOf(iv);
    if (net <= 0) continue;
    const ts = iv.paid_at || iv.created;
    const c = cycles.find(([s, e]) => ts >= s && ts < e);
    if (c) c[3] += net;
  }
  return cycles.filter(([s, e]) => e > s).map(([s, e, r, a]) => [s, e, Math.round(r * 100) / 100, Math.round(a * 100) / 100]);
}
