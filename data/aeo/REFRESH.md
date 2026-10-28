# AEO refresh (?aeo section)

Say **"refresh AEO"** to Cowork during the daily refresh. Peec's REST API isn't reachable headlessly, so Claude
pulls via the Peec MCP, writes compact raw files to `data/aeo/raw/`, then `npm run build-aeo` does every
calculation and writes `src/aeo.json`. Framing rules come from Matt's handoff (see memory `aeo-matt-handoff`).

Project `or_0887d1ed-129a-4dcd-a14c-d5fd9905d06c`, Mutiny brand `kw_7af93fc0-d981-4f63-86d5-0fc3348809b3`.
Engines: ChatGPT (`openai-0`), Google AI Overview (`google-0`), Perplexity (`perplexity-0`).

## Prompt set
Jon reset Peec on **Oct 28 2026**: 145 prompts, 6 topics, 29 brands. Old prompts are archived and their
topics deleted. Always filter reports with `topic_id in meta.topicFilter` (the 6 topic ids), which keeps
archived prompts out. If topics change again, rebuild `topics.json` keys, `meta.topicFilter`,
`site_config.json` (`competitorDomains`, `mutinyPages`) and the `lean`/`topics` blocks in `narrative.json`.
`legacy.json` holds the old set's final week for reference.

## Windows
- **cur** = the 7 complete days ending yesterday (until Nov 3: Oct 28 to yesterday). Never include today.
- **prev** = the 7 days before cur, only once it lies fully inside the new set (first: Oct 28 to Nov 3,
  compared at the Nov 11 refresh). Until then `meta.prev = null` and `*_prev`/`prev` arrays stay empty,
  so the page shows no arrows.
- **backlog** = up to the last 30 days, never before Oct 28.

## Pulls (all with the topic filter)
| File | Peec call |
|---|---|
| `brands_cur.json` (+ `brands_prev.json` once prev exists) | `get_brand_report`, no dimensions (raw output) |
| `topics.json` | `get_brand_report` dims `[topic_id]`, having visibility > 0, compacted, cur (+ prev) |
| `mutiny_daily_channel.json` | `get_brand_report` dims `[date, model_channel_id]`, having brand = Mutiny |
| `domains.json` | `get_domain_report` limit 30 by `retrieval_count` |
| `urls.json` | `get_url_report` filtered to domain `mutinyhq.com`, top 10 (topCited is derived) |
| `top_urls.json` | `get_url_report` top 60 by `retrieval_count`; keep `mutinyMentioned` |
| `prompts.json` | `list_prompts` (text, topic, volume, tags) + `get_brand_report` dims `[prompt_id]` having Mutiny, and having visibility >= 0.5 (owners) |
| `domains.json` → `byTopic` | `get_domain_report` filtered to ONE topic, top 10 (6 calls) |
| `urls.json` → `byTopic` | `get_url_report` filtered to ONE topic, top 8 by `citation_count` (6 calls) |
| `actions.json` | `list_actions` + `get_action` on the top 5 (Peec text only) |

Weekly (or after a reset):
- Picks: run `scorePrompt`/`pickBacklog` from `scripts/lib/aeo-score.mjs` on `prompts.json`; for each pick
  `get_url_report` filtered to the prompt, top 5 → `prompt_urls.json`; write `picks.json` (urls list).
- Page snapshots: `get_url_content` for each pick URL → `data/aeo/content/<i>.json` (gitignored). Subagents can
  do this one; **pass no `max_length`**. Subagents can't run calls with numbers/arrays (the Peec schema loads
  untyped there), so every filtered report must run in the main session.
- `cro_watch.json`: `get_url_report` with `mentioned_brand_id = Mutiny` and CRO/personalization/martech domains,
  then pull the verbatim sentences about Mutiny with `get_url_content`; plus brand perception attribute terms.
- Jaleh signals (self-reported AEO signups, AI referral visitors) are computed from `src/beta-signups.json` and
  `src/framer.json`, so run `pull-data` first.

## Peec links + Ask Claude
- `peec_links.json` holds the Peec app URL for each card (overview, brands, models, topics per key, domains, urls,
  prompts, actions). null = no "Open in Peec" button. Fill from the browser while signed in to app.peec.ai.
- "Ask Claude" (aeo_ask.jsx) needs no refresh: it builds its prompt from src/aeo.json at click time and opens
  claude.ai/new?q=… (prompt capped at 5,000 characters).

## Then
1. `npm run build-aeo` prints every number.
2. Rewrite `data/aeo/narrative.json` from those numbers only (summary, brandFlags, topics, channels, domains,
   outreach, cro, opportunityContext, takeaways, lean, backlogNote, jaleh did/next/ask).
   Rules: no em or en dashes, no "not X but Y", no invented stats or recommendations, never rank topics against
   each other on raw visibility, Mutiny never framed as website personalization/CRO.
3. `npm run build-aeo` again, then the normal `build:nodata` → commit → push.
