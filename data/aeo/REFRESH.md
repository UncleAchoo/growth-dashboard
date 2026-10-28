# AEO refresh (?aeo section)

Runs during the daily refresh, alongside the `data/peec.json` step. Say **"refresh AEO"** to Cowork.
Peec's REST API isn't reachable headlessly, so Claude pulls via the Peec MCP, writes compact raw files,
then `npm run build-aeo` does every calculation and writes `src/aeo.json`.

Project `or_0887d1ed-129a-4dcd-a14c-d5fd9905d06c`, Mutiny brand `kw_7af93fc0-d981-4f63-86d5-0fc3348809b3`.
Engines: ChatGPT (`openai-0`), Google AI Overview (`google-0`), Perplexity (`perplexity-0`).

## Windows
- **This week** = the 7 complete days ending yesterday. **Last week** = the 7 days before. Never include today (partial day).
- **Backlog** = the 30 days ending yesterday.
- Update `data/aeo/raw/meta.json` (`pulledAt`, `cur`, `prev`).

## Daily: weekly report (about 10 MCP calls)
Formats are documented in each file's `_note`. Overwrite, don't append.

| File | Peec call |
|---|---|
| `brands_cur.json`, `brands_prev.json` | `get_brand_report`, no dimensions, each window (raw output) |
| `topics.json` | `get_brand_report` dims `[topic_id]` limit 200, each window; compact rows, drop zero rows + Assets |
| `mutiny_daily_channel.json` | `get_brand_report` dims `[date, model_channel_id]`, having brand = Mutiny, both weeks in one call |
| `domains.json` | `get_domain_report` limit 40 ordered by `retrieval_count`, each window |
| `urls.json` | `get_url_report` top 10 by `citation_count` (all) + same filtered to `mutinyhq.com` |
| `actions.json` | `list_actions` (PENDING/ACCEPTED/PLANNED, by impact) + `get_action` on the top 5 distinct ones. Use Peec's text; never invent |

## Weekly (Mondays, or when `prompts.json` window is 7+ days old): backlog
1. `prompts.json`: `list_prompts` + `get_brand_report` dims `[prompt_id]` having Mutiny over the 30-day window.
2. `prompt_urls_{AST_CC,ABM_MGTM,AISE}.json`: per prompt, `get_url_report` top 5 by retrievals + gap (`gap >= 1`, limit 100, keep rowCount). Use 3 parallel subagents.
3. Picks: run the scoring (`scripts/lib/aeo-score.mjs` → `pickBacklog`) and write `picks.json` (`prompts`, `urls`).
4. `data/aeo/content/<i>.json`: `get_url_content` (max_length 60000) for each pick URL, saved byte-for-byte via script (gitignored). 2 parallel subagents.
5. `mutiny_pages_by_topic.json`: `get_url_report` domain `mutinyhq.com`, dims `[topic_id]`, top 40 by citations.

## Then
1. `npm run build-aeo` prints every number.
2. Rewrite `data/aeo/narrative.json` from those numbers only: summary, brand flags, per-topic competitive + trend notes,
   engines, domains, opportunity context (keyed by action id), 3 to 5 takeaways, per-topic Mutiny lean.
   Rules: no em or en dashes, no "not X but Y" contrasts, no invented stats or recommendations, Mutiny never framed as website personalization/CRO (ABM 1:1 pages is the one exception).
3. `npm run build-aeo` again, then the normal `build:nodata` → commit → push.
