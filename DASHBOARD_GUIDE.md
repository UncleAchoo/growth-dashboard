# Mutiny Growth Dashboard — Guide

A plain-English guide to what this dashboard shows, how to refresh it, and the quirks worth knowing before you trust a number. Paste this straight into Notion (it imports Markdown natively).

---

## What it is

A single-page dashboard tracking Mutiny's marketing/growth funnel — website visitors → signups → sales meetings, plus channel attribution and AI-engine visibility (Peec).

- **Lives at:** `github.com/UncleAchoo/growth-dashboard`, deployed to GitHub Pages.
- **All numbers come from** one committed file, `src/data.json`, which is regenerated from GA4, Amplitude, HubSpot, and Peec.
- **Data sources:** GA4 (sessions/traffic, manual CSV export), Amplitude (signups), HubSpot (sales meetings / Talk to Sales), Peec AI (AI-engine visibility).

---

## How to refresh the data (daily)

Do these in order. Steps marked **Cowork** are things you ask Cowork to do; the rest are terminal or GA4.

> **Changed Jul 17 2026:** signups switched to **raw USC event totals** — the dashboard no longer dedupes. The old "regenerate dedup + role windows" step is **gone** (the dashboard ignores `amplitude.dedup` and `amplitude.roles.windows` now). One fewer step.

1. **Sync first, while your tree is clean** (avoids merge conflicts):
   ```sh
   git pull --rebase
   ```

2. **Export the 3 GA4 CSVs and drop them in `data/`:**
   - GA4 Dashboard Feed → Extensions → Apps Script → switch function to `refreshGA4()` → **Run**
   - Download each of the 3 tabs as CSV individually
   - Drop all 3 CSVs into the project's `data/` folder
   - ⚠️ Use the **"Session Mutiny - With AI Referrals"** channel group when exporting — not the default one (only the custom group breaks out the AI Referrals bucket).

3. **Refresh Peec** — tell Cowork: *"refresh data/peec.json"* **(Cowork)**
   *Cowork refreshes only up to the last **full** day (today's partial day is excluded, since Peec's prompts run through the day and a partial day misstates visibility).*

4. **Pull the data** (rolls the reporting window, ingests GA4 + Peec, refreshes role periods + MTD via REST):
   ```sh
   npm run pull-data
   ```

5. **Build WITHOUT re-pulling** (a second `pull-data` would re-roll the window; just build what's there):
   ```sh
   npm run build:nodata
   ```

6. **Commit & push** to deploy (GitHub Pages rebuilds in ~60–90s):
   ```sh
   git add . && git commit -m "data refresh" && git push
   ```
   ⚠️ **If the push is rejected** with *"Updates were rejected… fetch first"*, an automated **logos bot** pushed to `main` while you were working (it edits `src/data.json` too). Your data is newer, so keep your version:
   ```sh
   cp src/data.json /tmp/data.mine.json
   git pull --rebase origin main
   # if it stops on a conflict in src/data.json:
   cp /tmp/data.mine.json src/data.json && git add -A && git rebase --continue
   git push
   ```
   To avoid the race, run `git pull --rebase` again *right before* `git push` (not just at the start) — shrinks the collision window to seconds.

---

## What counts as a "Signup"

A signup = a **completed** signup: a unique user who fired the Amplitude event **`[Onboarding] User Setup Complete`** (internal `mutiny` emails excluded). This is the step where both onboarding paths — creating an org and being invited — converge and the person actually makes it into the app.

Two things to know:

- **The event only started firing ~Feb 16, 2026.** So January and early February read **zero** signups. That's an instrumentation start date, not a real drop.
- **Signups are deduped.** A user is counted once per window, even if they appear on multiple days.

There's also an older definition still shown for comparison — **Company signups (previous method)** — which counts `[Onboarding] Company Setup Complete` (org creators only), summed daily without dedup. It's kept only so historical trends line up; the headline metric is **User Signups**.

---

## How the charts are configured

- **Window toggle (top of page):** `Last 30 days` / `MTD` / `YTD`. KPI tiles and pies use a strict window; weekly bar charts expand to full Mon–Sun weeks, so their date range can be up to ~12 days wider than the KPI window.
- **Hatched (striped) bars** = the current in-progress week or a period clipped by the window. Treat them as partial.
- **Signups by Channel:** driven by the `referral_source` property. Sources with no value split at the **May 7, 2026 cutoff** (when the field became required): before → "Not Specified", on/after → "Invited / Referred".
- **Signups by Team:** driven by the `user_work_role` property stamped at signup completion (Sales / Marketing / Other / No role).
- **AEO section (Peec):** AI-engine visibility vs. competitors; deltas shown as percentage-points for visibility/retrieved.

---

## Gotchas — read before trusting a number

**Signups are raw USC event totals — not deduped (since Jul 17 2026).** A user who re-onboards (fires `User Setup Complete` on more than one day) is counted each time, so window totals run ~14–20% above the true deduped unique count. This is intentional: it makes the KPI, weekly bars, cumulative line, and Team split all tie out on one raw basis with no scaling. The `amplitude.dedup` and `amplitude.roles.windows` blocks are still written into `data.json` by `pull-data` but are **deliberately not read** — don't waste time regenerating them. (If dedup is ever revived, define a signup as "first USC per user" so summing days equals the unique count.)

**Don't run `pull-data` twice.** Running it again re-rolls the reporting window. After the single pull, build with `build:nodata`.

**GA4 data before May 13, 2026 is unreliable** (attribution instrumentation started then). **`referral_source` capture started May 8, 2026** — earlier signups have no channel and aren't a real "unknown."

**Per-role counts sum slightly above the deduped total.** A user who completes setup more than once with different role answers is counted in each role. The team chart scales the mix so segments still add up to the true total; the raw stored numbers won't.

---

## Why some numbers don't line up (and shouldn't)

**KPI tile "Visitor → User Signup" vs. the "Weekly visitor conversion rate" chart.** These are *supposed* to differ:

- The **KPI tile** is one aggregate ratio over the whole selected window (e.g. last 30 days) — **deduped** signups ÷ total sessions — and it runs through **today**, including the partial current week.
- The **weekly chart** is a per-week trend: each point is *that single week's* signups ÷ that week's sessions. It uses a **fixed trailing 12 weeks** independent of the toggle, and it stops at the **last complete week** (drops the in-progress one).

They diverge for three compounding reasons: different spans (a 30-day aggregate vs. a single week), different end dates (through today vs. last complete week), and a blended ratio-of-sums will never equal any one week's ratio.

**Other places totals differ by design:**

- **Deduped (KPI/tiles) vs. summed-daily (some trend lines)** — summing days double-counts repeat users.
- **KPI window vs. weekly bar charts** — weekly charts expand to whole Mon–Sun weeks, so their range is wider.
- **User Signups vs. Company signups** — two different events (User Setup Complete vs. Company Setup Complete) and dedup vs. summed.
- **Per-role sums vs. the signup total** — repeat completions inflate per-role counts.

---

## Quick reference

| Item | Value |
|---|---|
| Repo | `github.com/UncleAchoo/growth-dashboard` |
| Signup event | `[Onboarding] User Setup Complete` (excl. internal `mutiny` emails) |
| Signups start firing | ~Feb 16, 2026 |
| GA4 reliable from | May 13, 2026 |
| `referral_source` capture from | May 8, 2026 (required May 7) |
| Refresh command | `npm run pull-data` → `npm run build:nodata` (no dedup step since Jul 17 2026) |
| Deploy | `git push` to `main` (Pages rebuilds ~60–90s) |
