# Tracking gaps (troubleshooting log)

Known cases where PostHog and the sign up export (Metabase CSVs in `data/data-queries/`) disagree. Use this file to check whether a mismatch is a known issue before digging in, and add new cases as they come up.

## 1. Org creators with no `[Activation] Organization Created` event

**Found:** Oct 26, 2026, while comparing the Activation funnel's org creators (79) with the New onboarding PostHog card (76) for Oct 21–25.

**What happens:** someone in the sign up export is the first person on a new company, but PostHog never recorded `[Activation] Organization Created` for them. It seems to happen when an **existing user creates another company**, and sometimes for new users too. Their other onboarding events do fire.

**How the dashboard handles it:** these people are counted as org creators on the New onboarding cards too.

- `npm run pull-posthog` pulls their PostHog milestones (flagged `viaExport`).
- The dashboard fills in anyone the pull doesn't have yet from their sign up row.
- They're named only in the footnote (the ⓘ at the bottom of each card), in a sentence that starts with "Tracking gap:". Nothing on the card itself points them out (Nick, Oct 26).
- Their "Organization created at" shows the sign up day from the export, with no time. Hover the date to see why.

**Cases so far:**

| User | Sign up day (export) | User id | Notes |
|---|---|---|---|
| nick.mueller@material.security | Oct 22, 2026 | 6a5c0558-0d2e-43bb-9f73-a1928a8e00a5 | Existing user (since Apr 2026), new company. No onboarding steps yet. |
| aileen@cowboy.vc | Oct 23, 2026 | 4c8e999e-a0a2-4723-ac1d-82ef2f47ba0c | Onboarded into a new workspace. No `User Created` either. Recorder signed in Oct 23. |
| carson.west@livekit.io | Oct 25, 2026 | ee154c94-73ab-4ae2-b287-49ffedc58cc9 | Existing user (since Jun 11, 2026), new company. Fired Company Setup Complete. Gmail + Recorder signed in Oct 25, A1 Magic Moment Oct 25. |

**Person IDs:** the dashboard only has PostHog person IDs for these people once `npm run pull-posthog` has run with the export-creator lookup (added Oct 26). Until then their rows come from the sign up export, which has no person ID. That's why Person ID showed "—" for them.

## 2. Staff events carrying a customer's user id

**Found:** Oct 26, 2026. carson.west@livekit.io's user id (`ee154c94-…`) also appears on two Mutiny staff PostHog persons, kyle@mutinyhq.com and nikhil@mutinyhq.com. That's most likely staff logging in as him.

**Impact:** looking someone up by user id alone can pick up staff activity. The pull now keeps only the PostHog person whose own email matches the user. Staff are also excluded by the Internal / Test cohort (257060) and the @mutinyhq.com filter.

**Ask for engineering:** fire `[Activation] Organization Created` every time a company is created, including by an existing user.

**To check for new cases:** the "Tracking gap:" sentence in the New onboarding cards' footnotes updates on every refresh. Copy any new names into the table above.
