# Cowork kickoff prompt

Paste the block below as your first message in Cowork after pointing it at this folder.
First time: it loads context and confirms. Subsequent sessions: just describe the change.

---

```
This folder is the Mutiny Growth Dashboard project. Before doing any work,
load the project context in this order:

1. Read CONTEXT.md fully — it's the source of truth for the dashboard's
   current state, data sources, methodology decisions, categorization rules,
   the layout, and my working preferences.

2. Skim mutiny_growth_dashboard.jsx to understand the live artifact's
   structure. Don't memorize it — just know what's there.

3. Note the data/ folder. It contains the raw daily-grain pulls (3× GA4
   CSVs, 1× Amplitude, 1× HubSpot) backing the current KPIs and pies.

Don't make any changes yet. Just confirm you've loaded the context, then
summarize back to me in 3 short bullets:
  - What this dashboard is
  - The current reporting window
  - The most important "decisions not to relitigate" item to keep in mind

Then ask what I'd like to work on.
```

---

## Tips for ongoing Cowork sessions

**Refresh weekly data:** drop new dated CSVs in `data/`, then say _"refresh the dashboard from the new files in data/ — show the per-channel-per-week tables before changing the JSX."_ The CONTEXT.md working preferences cover the rest.

**Add a new chart:** describe the chart + the data source. Cowork should refuse if the data isn't available locally — that's correct behavior. Don't let it fabricate data.

**Brand styling:** the `C` color tokens, fonts, and card pattern are in CONTEXT.md. New components should use these without asking.

**Refactor vs patch:** ask Cowork to declare which one it's doing before it starts. Refactors should have a scope summary first.

**Stuck on something:** ask it to show you the math (per-channel-per-week tables, regex matches, etc.) before changing the JSX.
