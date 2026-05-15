# Mutiny Growth Dashboard — Context

This is the **source of truth** for the dashboard. Read it before touching anything.
The live artifact is `mutiny_growth_dashboard.jsx` at the folder root.

---

## What this is

Single-file React/Recharts dashboard, ~2,900 lines. Reviewed weekly.
Output path: `mutiny_growth_dashboard.jsx` (top of project folder).
Brand: Mutiny. Corp site: **mutinyhq.com**. App: **app.mutinyhq.com**.
**mutiny.com does NOT exist** — never reference it.

---

## Reporting window

**Last 30 days, rolling.** The Apr 27 anchor was retired May 14, 2026.

Two related windows in the JSX:

- **Strict 30-day** (KPI cards + pies): `today − 30 days` through `today`, inclusive. With today = May 14, that's Apr 14 – May 14 (31 days inclusive).
- **Expanded Mon-Sun** (weekly bar charts, Signups by Channel, LinkedIn deep-dive): the Mon-Sun week containing the strict-window start through the Mon-Sun week containing today. Always 5 full weekly buckets.

**Partial-week display rule:** only the *current* (last) week is hatched + footnoted as in-progress. The first weekly bucket is rendered as a full week even though its Monday slightly pre-dates the strict 30-day start.

**Data-availability caveats** (still apply within the rolling window):
- `plg_signup_click` events first reliably captured May 7, 2026 — weeks before that have session data but zero attributed signups by channel.
- GA4 cross-domain attribution shipped May 11, 2026 — pre-May-11 signups got over-bucketed as `(direct) / (none)`.
- Peec AEO data starts Apr 23 for Mutiny; the AEO daily chart shows Apr 23 → today (no synthetic gap-fill to Apr 14).

---

## Brand tokens

- Fonts: **Fraunces** (display), **Manrope** (body), **Geist Mono** (code)
- Colors (in `C` object at top of JSX):
  - `purple` #A73BF5, `green` #B2FF14, `red` #FB5A3D, `blue` #96ECFF
  - `lightPurple` #F2D1FC, `lightBlue` #BCEEFD, `lightRed` #FF9987, `lightGreen` #D6E7DA
  - `black`, `lightGrey` #EFEFEF, `white`, `paper` #FAF8F4
- Card pattern: `background: C.white`, `border: 1px solid C.black`, `borderRadius: 4`, on `C.paper` body

---

## Current KPIs (Apr 27 – May 13)

| KPI | Value | Source |
|---|---|---|
| Signups | **406** | Amplitude `[Onboarding] Company Setup Complete` uniques (was 423 in May 13 CSV header — MCP-based pull is now authoritative; CSV header was hand-calculated with a slightly different filter) |
| Engaged Sessions | **15,706** | GA4 File 1 daily totals (canonical) |
| Visitor → Signup | **2.59%** | derived: 406 ÷ 15,706 |
| Sales Meetings Requested | **15** | HubSpot Talk to Sales form fills, test-filtered (was 14 under the old createdate-based rule — see HubSpot section below) |

---

## Data sources

### Amplitude — Mutiny Production
- `appId`: **263360**, org Mutiny HQ
- Signups KPI event: `[Onboarding] Company Setup Complete` (metric: uniques, countGroup: User)
- Pie data chart: `iggyu2qz`, latest edit `sc3k9okv`
  - URL: `https://app.amplitude.com/analytics/mutiny/chart/iggyu2qz/edit/sc3k9okv`
  - Filters in chart: `referral_source != "(none)"` AND `email does not contain "mutiny"`
- Window timestamps used in queries (project timezone America/New_York):
  - start: `1777262400` (Apr 27 00:00 ET)
  - end: `1778731199` (May 13 23:59:59 ET)
- Daily signup counts (uniques): pulled live via MCP `query_dataset` (eventsSegmentation, daily interval) — see `data/2026-05-13_amplitude_referral_sources.csv` header for the May 13 manual snapshot
- **MCP-based pull (May 14, 2026):** 406 total unique signups in window (Wk1: 180, Wk2: 145, Wk3 partial: 81). 122 with referral_source set. Replaces the manual CSV pull going forward.

### HubSpot — Mutiny portal 6371341
- Talk to Sales form ID: `5edce853-8ac4-4290-b9d3-b5e54da40a89`
- Form full name (in HubSpot): `Talk to Sales: Talk to Sales (March 23, 2026)`
- Contact property: `how_did_you_discover_mutiny` (free-text)
- **Form-submission date logic:**
  - If `recent_conversion_event_name` contains "Talk to Sales" → use `recent_conversion_date`
  - Else (their recent is a Meetings Link booking, etc.) → use `first_conversion_date`
  - **Do NOT use `createdate`** — HubSpot can track contacts anonymously (cookie / web visit) before they submit any form, so `createdate` can predate the actual TtS submission. The original CSV-gen script used `createdate` here and undercounted by 1 (Jesse Parker, May 13 2026 pull, `createdate=Apr 24` vs `first_conversion_date=Apr 28`). The MCP-based automation uses `first_conversion_date` (correct).
- **Test filter:** exclude emails containing "mutiny", plus specifically `kedwardsfake@1mind.com`
- Pull result (corrected rule): 38 raw contacts → 4 test excluded → 19 outside-window excluded → **15 valid** (Wk1: 7, Wk2: 4, Wk3 partial: 4)

### GA4 — corp site
- Property: `G-N9X1B8RFVE` (measurement ID). Numeric Property ID for the Data API: `285971094`.
- GTM: `GTM-WQCCBQ82` (corp), installed on `app.mutinyhq.com` May 11, 2026
- **Pull mode: manual CSV export, ingested by `scripts/pull-data.mjs`.** Direct GA4 Data API access requires admin-side OAuth scope unblocking (Workspace policy blocks the `analytics.manage.users` scope from third-party apps), and the workaround chain isn't worth chasing for a once-weekly refresh. Workflow:
  1. In GA4, export each of the three free-form reports below as CSV.
  2. Drop them in `data/` (any filename works as long as the pattern matches).
  3. Run `npm run pull-data` — script picks the most recent CSV by lex sort, parses, combines with live Amplitude + HubSpot.
- 3 CSVs at daily grain in `data/` (filename patterns matched by the script):
  - **File 1** — `*engaged_sessions_by_date*.csv` — Daily totals (**canonical for KPI**)
  - **File 2** — `*signup_events_by_channel*.csv` — `plg_signup_click` events, day × channel × source/medium
  - **File 3** — `*all_engaged_sessions_by_channel*.csv` — all sessions, day × channel × source/medium
- Grand totals: File 1 = **15,706** (canonical), File 3 = 15,710 (4-session GA4 sampling discrepancy — flagged in dashboard, not blocking)
- **GA4 channel group dimension**: in the GA4 free-form reports, use **`Session Mutiny - With AI Referrals`** (custom channel group) instead of `Session default channel group`. The custom group is identical to the default group but adds an `AI Referrals` bucket (chatgpt.com / claude.ai / perplexity.ai / gemini, etc), which we then map to our `AEO` bucket in the JSX fallback. The CSV sniffer in `scripts/pull-data.mjs` accepts either header for backward compatibility, but new exports should use the Mutiny custom group.
- Channel bucketing logic (`SIGNUPS_BUCKETING_RULES` in JSX): splits **AEO** (chatgpt/claude/perplexity/gemini referrers) and **LinkedIn** from GA4's channel group. First match wins:
  1. AEO: `chatgpt.com|claude.com|claude.ai|perplexity.ai|gemini.google.com|bard.google.com|copilot.microsoft.com|poe.com|chatgpt|^claude$|perplexity` (case-insensitive)
  2. LinkedIn: `/linkedin/i`
  3. Social: `twitter|^x.com$|^t.co$|reddit|facebook|^fb.|instagram|^ig$`
  4. Search: strict `^google$|^bing$|^duckduckgo$|^yahoo$|^brave$|^ecosia$|^qwant$|^baidu$|^yandex$` (subdomain-strict so `mail.google.com` doesn't get caught)
  5. Email, Direct via `^email$|newsletter|mailchimp|^hs_email$` and `^\(direct\)$`
  - Fallback: GA4's channel group mapped to canonical names — including `AI Referrals → AEO` for the Mutiny custom group

### Peec AI
- Project ID: `or_0887d1ed-129a-4dcd-a14c-d5fd9905d06c`
- Brand ID: `kw_7af93fc0-d981-4f63-86d5-0fc3348809b3`
- AEO data covers Apr 23 onward. 5 topics tracked; **"Competitor Comparisons"** topic added to monitoring May 5 — pre-May-5 rows for that topic are `null` (chart shows a gap, not fake zeros)
- Window in current JSX: Apr 23 – May 12, 2026 — extend on next refresh

---

## Categorization rules — self-reported pies

9 buckets, regex-matched, **first match wins**. Used identically for the Signups pie (Amplitude) and the Sales Meetings pie (HubSpot).

| Bucket | Regex / logic |
|---|---|
| LinkedIn | `/linkedin/i` |
| LLM | `/chatgpt\|chat gpt\|claude\|perplexity\|gemini\|copilot\|\bai\b/i` |
| YC | `/y\s?combinator\|\byc\b/i` |
| Influencer / Community | `/mkt1\|hbs\|alumni\|community\|30\s?mpc\|podcast/i` |
| Word of Mouth | broad regex — friend / colleague (incl typo "collegaue") / coworker / manager / teacher / CEO / VP / boss / buddy / fan / hubby / wife / husband / spouse / investor / Ruben (specific named referrer, not staff) / WOM / recommendation / "word of mouth" / referred + `KNOWN_EMPLOYER_MENTIONS` (BMC, Homebase, Slack, calm, sequoia, Team, SWI, "we use it at X"). Spouse keywords + investor + Ruben added May 14, 2026. |
| Search | `/google\|googl\|search\|^web$\|^organic$/i` |
| Social | `/\bx post\b\|twitter\|reddit\|facebook\|^fb$\|^fb\b\|instagram/i` (FB shorthand added May 14, 2026) |
| Joke / Invalid | `\bfate\b` / `\bdestiny\b` (catches "fate", "It was fate", "fate...", etc.) / test / demo / empty / punctuation / "loved it" / joke phrases — separated from Other to keep Other meaningful. Fate-and-loved-it broadening added May 14, 2026. |
| Other / Unparseable | legit-looking but unclear (Newsletter, email, vague intent) — fallback |

**Word of Mouth signal: "heard from a real person, not a marketing channel."** Includes the abbreviation WOM and "(X) is a fan" phrasings. Be tolerant of typos.

### Pie sample sizes

- **Signups pie:** 122 users (corrected May 14 MCP pull — was 119 in the May 13 manual CSV). 3 net new entries since the snapshot: "chat gpt" (lowercase) → LLM, second "Linkedin" → LinkedIn, "FB" → Social (after rule extension).
- **Sales meetings pie:** 15 contacts (corrected `first_conversion_date` rule — see HubSpot section above. Was 14 under the old `createdate` rule.)

---

## Dashboard layout (top → bottom)

1. **Header** — "Growth Dashboard" + reporting window + asterisk note about source-specific start dates
2. **Four KPI cards** — Signups, Website Visitors, Visitor → Signup, Sales Meetings Requested
3. **Top of funnel · weekly trend** — 3-column bar charts: Signups (purple), Engaged Sessions (blue), Sales Meetings Requested (red). Partial week Wk 3 rendered with diagonal hatch pattern. Single y-axis per chart — no dual-axis.
4. **Self-reported channel mix** — 2-col: Customer signups pie (Amplitude) + Sales meeting requests pie (HubSpot). Both tagged `SelfReportedTag`.
5. **Signups by Channel** — 2-col: weekly stacked column (left) + Channel funnel table (right). Both tagged `ProgrammaticTag · GA4`. Data: `SIGNUPS_BY_CHANNEL_WEEKLY` (3 weeks).
6. **LinkedIn deep-dive** — uses `LINKEDIN_DEEP_DIVE` config + `ChannelDeepDive` component.
7. **AEO · Signups attribution** — 2-col: signups bars + `AEOVisibilityChart` (Peec daily data, 5 toggleable topic lines).
8. **Definitions panel** (collapsible).

---

## Decisions NOT to relitigate

- **No dual-axis charts.** Two y-axes let you fabricate any visual story — the chart becomes about scale choice, not data.
- **Channel funnel stays a table, not a stacked bar.** The table is doing real per-channel conversion-rate analytical work; bars obscure it.
- **No sparklines or rolling averages until ~6–8 weeks of history.** Currently 3 weeks; trend lines on 3 points are noise dressed up as signal.
- **KPI cards carry WoW deltas (added back May 14, 2026).** Comparison method is *option B — same days of week, cumulative*: this-week-Mon-through-today vs last-week-Mon-through-same-day-of-week. Caveat: a one-day spike in the prior week lingers in the comparison until the next Monday rolls over.
- **Mon-Sun weeks.** Matches Revenue Dashboard convention.
- **File 1 (15,706) is the canonical KPI number.** Per-channel breakdown uses File 3 (15,710). The 4-session discrepancy is from GA4 sampling.
- **Partial-week handling** = hatched bar pattern + footnote. Apply consistently to any new chart.
- **Other / Unparseable target ~20-30%.** Anything below means the bucketing absorbed noise; anything above means the categorization is too restrictive.

---

## Working preferences (Nick)

- **Validate CSV year header before ingesting** — there's a 2025 typo trap in raw GA4 exports
- **Show data math before locking in chart changes.** Per-channel-per-week tables in prose first; chart edits second.
- **Don't fabricate data.** If a series doesn't have detail, render a flat reference line and say so.
- **Keep syntax-check pattern on big edits** — brace/paren/bracket count via `node -e`.
- **Tell me when refactoring vs. just patching.** Refactor = restructure; patch = tweak.
- **Surface change scope before executing big refactors.** Don't dive into a 500-line rewrite without flagging it.
- **Concise > verbose.** Direct findings, no fluff.

---

## Open items

- **AEO data block** ends May 12 — refresh the Peec daily series on next pass
- **Visitor → Signup ratio is heavily partial pre-May-11** (cross-domain attribution only shipped May 11) — this is acknowledged in the KPI footnote
- **Free-text `referral_source` produces 26% Joke/Invalid** in the Signups pie — actionable finding: the form needs a dropdown
- **Sales Meetings KPI** is now form-fill count (clean), not the old deal-createdate proxy
- **WoW deltas added back** to KPI tiles (May 14, 2026) using option B (same-days-of-week cumulative); see "Decisions" section above for the lingering-spike caveat.

---

## Changelog

- **v2 (May 13, 2026)** — Apr 27 anchor, Mon-Sun weeks, 9-bucket categorization (added Social + Joke/Invalid), Top of Funnel weekly trend section (3-column bars), pie data refreshed, title changed to "Growth Dashboard"
- **v1 (earlier May 2026)** — original L4w/Sun-anchored version
