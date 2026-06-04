# Cowork thread handoff — Mutiny Growth Dashboard

Read this first when starting a fresh Cowork thread on this project. It captures the **current state** and the **working patterns** that have evolved since `CONTEXT.md` was written (CONTEXT.md is now partially stale on KPI numbers and line counts — treat it as historical methodology reference).

---

## What this is

A single-file React/Recharts dashboard tracking Mutiny's marketing/growth funnel. Lives at `mutiny_growth_dashboard.jsx` (~5,800 lines now, up from 2,900 in CONTEXT.md). Built with Vite + vite-plugin-singlefile, deploys to GitHub Pages on every push to `main` via `.github/workflows/deploy.yml`. Repo: `github.com/UncleAchoo/growth-dashboard`.

The build output is a single self-contained `dist/index.html` (~1.7 MB), no external assets except Google Fonts.

---

## File layout (the only files that matter)

| Path | Role |
|---|---|
| `mutiny_growth_dashboard.jsx` | The dashboard component (everything renders from here) |
| `index.html` | HTML entry, loads `src/main.jsx` |
| `src/main.jsx` | React root that mounts the dashboard |
| `src/data.json` | All runtime data. **Generated** by `scripts/pull-data.mjs`. Committed. |
| `scripts/pull-data.mjs` | Pulls GA4 (CSV), Amplitude, HubSpot, Peec → writes `src/data.json` |
| `data/peec.json` | Peec AI snapshot, read by `pull-data` (manually refreshed) |
| `data/GA4 Dashboard Feed - GA4 - File {1,2,3} (1).csv` | GA4 CSV inputs (manual export from GA4 UI) |
| `vite.config.js` | Build config. Note `emptyOutDir: false` — sandbox can't unlink files in the mount |
| `.github/workflows/deploy.yml` | CI. Runs `npm run build:nodata`, NOT `npm run build` |
| `.env.local` | API keys (HubSpot, Amplitude, Peec). Gitignored. |
| `CONTEXT.md` | Original source-of-truth doc. Methodology still valid; KPI numbers stale. |
| `KICKOFF_PROMPT.md` | Cowork session-start scaffold |
| `HANDOFF.md` | This file. |

Everything else is gitignored or cruft.

---

## Build & deploy

```sh
npm run dev         # vite dev server (HMR), localhost:5173
npm run preview     # serves built dist/, localhost:4173
npm run build       # pull-data + vite build (needs .env.local)
npm run build:nodata # vite build only — CI uses this
npm run pull-data   # refresh src/data.json from APIs + data/ CSVs
```

**Deploy:** `git push` to `main`. CI does `npm ci` → `npm run build:nodata` → upload `dist/` → deploy to Pages. ~60–90s end-to-end. Watch at `github.com/UncleAchoo/growth-dashboard/actions`.

**CI uses `build:nodata` (NOT `build`)** because CI has no API keys — running `pull-data` would wipe Amplitude/HubSpot to empty fallbacks. `src/data.json` is committed and CI uses what's there.

---

## Data pipeline

`scripts/pull-data.mjs` orchestrates all data ingestion. It runs four fetchers in parallel:

- **GA4** — reads three CSVs from `data/`. File-name sniffing + content sniffing identifies which is which (engaged sessions / signup clicks / channel mix). Use the **"Session Mutiny - With AI Referrals"** custom channel group when exporting (NOT "Session default channel group" — the custom one breaks out the AI Referrals bucket).
- **Amplitude** — REST API (`amplitude.com/api/2/events/segmentation`). Two queries: daily uniques for the Signups KPI, and a `group_by referral_source` query for the pie. Filter: `email does not contain "mutiny"` (excludes internal accounts).
- **HubSpot** — Private App API. Queries Talk to Sales form contacts. 4 internal/test accounts hard-excluded by email.
- **Peec AI** — reads `data/peec.json`. This file is hand-built via the Peec MCP (see refresh flow below).

Each fetcher uses `preserve()` on failure — if one source errors, its previous values are kept rather than wiped. So a partial pull-data run won't destroy data.

---

## The Peec refresh workflow (do this often)

When the user says "refresh peec data":

1. Check today's date (via bash `date` if needed)
2. Use Peec MCP tools (`mcp__ea390ee6-dd25-4f24-aa39-9c55a308a830__*`):
   - `get_brand_report` for window-aggregate (Mutiny visibility, mention count, position, competitor ranking)
   - `get_brand_report` with `dimensions: ["date"]` for the new days only
   - `get_brand_report` with `dimensions: ["topic_id"]` for per-topic window agg
   - `get_brand_report` with `dimensions: ["date", "topic_id"]` for new days × topics
   - `get_domain_report` for mutinyhq.com window agg + per-day + per-(date,topic) breakdowns
3. **Project ID:** `or_0887d1ed-129a-4dcd-a14c-d5fd9905d06c`
4. **Mutiny brand ID:** `kw_7af93fc0-d981-4f63-86d5-0fc3348809b3`
5. Write a small Node script in `/tmp/peecbuild/` that appends new days to `data/peec.json` without losing prior days. **Don't regenerate from scratch** — only append the missing days.
6. Recompute window aggregates (visibility, mentionCount, avgPosition, competitorRank, topCompetitor, topics[]).
7. Run `npm run pull-data && npx vite build`. Amplitude/HubSpot will fail in the sandbox — that's expected, their data is preserved.

**Chat count derivation** (for mutinyhq.com daily): `chats_with_domain = retrieved_pct × (retrieval_count / retrieval_rate)`. This matches Peec UI's "retrievals" semantics.

The dashboard's AEO section now compares window-to-prior-window with **percentage-point** deltas for Visibility and Retrieved (not relative %), matching Peec UI. Relative % is used for the chat-count delta. See `AEOSection` in JSX.

---

## Sharp edges & gotchas

1. **Sandbox can't unlink files in `/Users/.../growth-dashboard/`.** This affects:
   - `rm` of any file the user actually wants deleted — give them the command, don't try to run it
   - `vite build` with `emptyOutDir: true` — config has it set to `false` for this reason
   - `git index.lock` from interrupted git commands — user must `rm -f .git/index.lock` from their terminal
   - File tools (Read/Write/Edit) work fine — only `rm` is blocked

2. **GitHub Actions push pattern:** When you've made changes, give the user the three commands to commit and push from their terminal. Don't try to run git from the sandbox (the lock issue above).

3. **`vite.config.js.timestamp-*.mjs` files** — Vite leaves these as a runtime cache. They're gitignored but accumulate on disk. Periodically have the user `rm vite.config.js.timestamp-*.mjs`.

4. **Categorization rules** (`CATEGORIZATION_RULES` near line 670) — these were heavily reworked. The philosophy: be charitable. Anything implying a real-world human encounter → Word of Mouth. Reserve Joke/Invalid for actual jokes, blanks, single-char noise. Test with `node -e` against `src/data.json` before changing. Current categorization rate: ~100% across 419 distinct historical responses.

5. **`referral_source` instrumentation gap**: Amplitude wasn't reliably capturing this property until **May 8, 2026**. Signups before that have no entry in `referralSources`. The pie's alert banner reflects this. Don't try to "fix" the gap by adding a Not Specified slice — it's an instrumentation artifact, not user behavior.

6. **Color tokens** (`C` object near line 14): `purple #A73BF5`, `green #B2FF14`, `red #FB5A3D`, `blue #96ECFF`, `linkedinBlue #0A66C2` (LinkedIn brand-specific only — Search uses `blue`), light variants, plus `paper #FAF8F4` for the page background. New components must use these — no ad-hoc colors.

7. **Hatched bars for partial weeks:** `makeHatchedBarShape(color, opts)` helper near the top of the JSX. Apply via Recharts `<Bar shape={...}>`. Reads `payload.partial` or `payload.trailingPartial`. Every weekly column chart in the dashboard uses this for the current (in-progress) week.

8. **Window logic:** Three modes — `Last 30 days` / `MTD` / `YTD` — toggled at the top. The 30-day mode uses a Mon-Sun-expanded variant for weekly charts (so the leftmost bar is a full week). Helper sets: `STRICT_WINDOW_DATES_SET`, `MTD_DATES_SET`, `YTD_DATES_SET`.

9. **Two GA4 alert banners** still in the JSX (Signup Form Clicks section + LinkedIn section). They both say "Reliable programmatic GA4 data begins **Wednesday, May 13, 2026**." Don't change this without checking with the user.

---

## Current state snapshot (as of Jun 3, 2026)

- **Peec window:** Apr 23 → Jun 3 (42 days)
- **Mutiny visibility:** 17.98% (rank 2 of 9, 6sense leads at 18.45%)
- **Topics:** Competitor Comparisons, ABM, Modern GTM tech stack, AI Sales Tools, AI Sales Enablement, Outbound tools (new)
- **`src/data.json` size:** ~2 MB. Built `dist/index.html`: ~1.7 MB.
- **GA4 attribution start:** May 13, 2026 (plg_signup_click instrumentation)
- **Referral source capture start:** May 8, 2026
- **mutinyhq.com retrieved:** 15% (2,881 retrievals, 1.76 citation rate)

The categorization buckets for the self-reported signup pie:
Word of Mouth, Search, AEO, Influencer / Community, YC, LinkedIn, Social, Joke / Invalid, Other / Unparseable.

---

## Recent significant changes (in this thread)

- LinkedIn color changed to `#0A66C2` (brand blue) — applied wherever LinkedIn is referenced, not the generic `lightBlue`
- Renamed pie bucket `LLM` → `AEO` everywhere for consistency
- Removed all four eyebrow section dividers ("Signup Form Clicks by Channel", "Website Visitors", etc.) — sections now stand alone
- Removed the engaged-sessions KPI block from Website Visitors section header
- Removed the "Sources · [date range] · Engaged sessions by channel" table title
- LinkedIn and AEO+Search sections renamed to "LinkedIn Signup Attribution" and "AEO + Search Signup Attribution"
- Removed the per-chart titles "Signup clicks · weekly" and the right-chart titles in those sections
- Two GA4 alert banners changed to "Reliable programmatic GA4 data begins **Wednesday, May 13, 2026**" with the rest of the explanation text removed
- Customer signups pie alert: "Reliable data begins after **May 7, 2026** (made required field)"
- **Major:** rewrote `CATEGORIZATION_RULES` with normalization step (URL host extraction), typo-tolerant patterns, multi-language support, expanded employer mentions, charitable WoM defaults. Now ~100% categorization.
- AEO section now shows pp / relative-% deltas vs prior window for Visibility, Retrieved, # of retrievals
- 4 Peec data refreshes (May 26 → Jun 3)

---

## Working preferences (from prior sessions)

- **Show the math before changing code.** Per-channel-per-week tables, regex match output, before/after delta. The user wants to verify the numbers, not just trust the diff.
- **Refactor vs patch:** declare which one before starting.
- **Don't fabricate data.** If a data source isn't available, say so. Don't make up numbers to fill gaps.
- **Build to verify.** Always run `npx vite build` after JSX changes — the user will catch syntax errors otherwise.
- **Keep prose conversational.** This isn't a formal doc. Bullets/headers only where they clarify.
- **Sources cited inline.** When showing data, cite the file or API source.

---

## Quick commands cheat-sheet

```sh
# Refresh peec data flow
# (no manual command — happens via MCP + node /tmp/peecbuild/*.mjs script)

# Local build & view
npm run build:nodata
npm run preview   # open localhost:4173

# Commit & deploy
git add . && git commit -m "..." && git push

# Clear stale git locks (when sandbox interrupted git)
rm -f .git/index.lock .git/HEAD.lock

# Clear vite timestamp cruft
rm vite.config.js.timestamp-*.mjs
rm -f .DS_Store data/.DS_Store
```

---

## Where to look next

- `mutiny_growth_dashboard.jsx` lines 14-30 — color tokens
- `mutiny_growth_dashboard.jsx` lines 670-720 — categorization rules
- `mutiny_growth_dashboard.jsx` lines ~5000-5300 — AEOSection (Peec rendering)
- `scripts/pull-data.mjs` lines 279-363 — Amplitude fetch logic
- `data/peec.json` — top of file has `pulledAt`, `windowStart`, `windowEnd`
- `CONTEXT.md` — original methodology doc (still valid for "why")
