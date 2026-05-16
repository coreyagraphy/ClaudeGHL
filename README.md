# Mental Vision — Outbound Pipeline

Model-routed Claude pipeline that takes a list of local businesses and produces, per prospect:
1. **Research + AI-visibility score** (Sonnet + web search)
2. **Content stack** — entity brief, buyer journey, 4 email variants with a Haiku judge picking the best angle, landing page, Meta ads, social posts (parallelized)
3. **Visuals** — Higgsfield image + video with a Haiku model router (cinematic / UGC / talking head)
4. **GoHighLevel ingestion** — contact with 35 custom fields, opportunity in the right pipeline stage, enrollment in the tier-matched workflow
5. **Campaign report** — Markdown rollup with tier distribution, recurring pain themes, recommended actions

Plus the three GHL infrastructure prompts (Vibe Coder website, Ask AI business OS, Automation Builder) that build the receiving end.

## Setup

```bash
git clone <repo>
cd ClaudeGHL
npm install
cp .env.example .env
```

Edit `.env` and pick a backend:

| Backend | When | Set |
| --- | --- | --- |
| Claude subscription (OAuth via the `claude` CLI) | You're logged into Claude Code on the same machine; small/medium runs | `LLM_BACKEND=claude-cli`, leave `ANTHROPIC_API_KEY` blank |
| Anthropic API key | Batch jobs of 50+, automated environments | Paste `ANTHROPIC_API_KEY=sk-ant-…`, leave `LLM_BACKEND` blank |

For ingestion into GoHighLevel, also set `GHL_API_KEY`, `GHL_LOCATION_ID`, the three pipeline stage IDs, and the four workflow IDs. Without them, ingest still runs (contact + tags) but skips opportunity + workflow steps with a clear "skipped" reason.

## Quick tour

```bash
# Verify env + backend + GHL connectivity in 5 seconds before any real run
node src/index.js doctor

# Generate the 3 GHL infrastructure prompts (run once per workspace)
npm run ghl:all

# Validate one prospect end-to-end (research -> content)
npm run prospect -- --company "Williams Comfort Air" --domain "williamscomfortair.com" \
  --city "Indianapolis" --state "Indiana" --niche "HVAC" --campaign-id "validate-1"

# Prepare the visual brief for that prospect (no network calls yet)
npm run visuals -- --input output/campaigns/validate-1/research/williams-comfort-air.json \
  --campaign-id validate-1
# Then ask Claude Code to generate via Higgsfield MCP — see "Generating visuals" below

# Dry-run the GHL ingestion to inspect the exact payload
npm run ingest -- --campaign-id validate-1 --slug williams-comfort-air

# Push to GHL for real (requires GHL_* env vars)
npm run ingest -- --campaign-id validate-1 --slug williams-comfort-air --live

# Aggregate a full campaign into a report
npm run report -- --campaign-id validate-1
```

## Generating visuals

Higgsfield is integrated **via MCP**, not via an HTTP API key. That means
the Node.js pipeline can prepare a per-prospect visual brief, but the
actual image + video generation has to happen inside a Claude Code
session where the Higgsfield MCP tools are reachable.

The workflow:

```bash
# Step 1 (Node.js): prepare briefs. Runs in batch or one-off, no network.
npm run batch -- --input prospects.csv --campaign-id hvac-2026 --steps research,content,visuals

# Step 2 (Claude Code): in any Claude Code session targeting this repo,
# ask: "Generate visuals for campaign hvac-2026 via MCP."
# I'll list the pending briefs, call MCP generate_image / generate_video
# for each, then finalize the manifests back.

# Step 3 (Node.js): verify and ingest as normal.
npm run visuals-pending -- --campaign-id hvac-2026   # should list nothing
npm run batch -- --input prospects.csv --campaign-id hvac-2026 --steps ingest
```

Under the hood, Claude Code calls `npm run visuals-finalize -- --campaign-id X
--slug Y --image-url <url> --video-url <url>` per prospect — same Node.js
code path that downloads files locally and writes the manifest.

Want unattended visuals (cron, overnight runs)? Add an HTTPS-based Higgsfield
client back in `src/visuals/` and have it consume the same brief shape.

## Batch mode

For more than one prospect at a time, write a CSV:

```csv
company,domain,city,state,niche
Williams Comfort Air,williamscomfortair.com,Indianapolis,Indiana,HVAC
ACME Plumbing,acmeplumbing.com,Carmel,Indiana,Plumbing
Zenith Roofing,zenithroofing.com,Fishers,Indiana,Roofing
```

Then:

```bash
npm run batch -- --input prospects.csv --campaign-id hvac-may-2026 \
  --concurrency 3 --steps research,content,visuals,ingest
```

Defaults: 3 parallel, all four steps, dry-run for ingest. Add `--live-ingest` to actually push to GHL. Re-runs skip already-completed steps unless `--force`. One prospect failing doesn't break the batch — failures are captured in `output/campaigns/<id>/batch_manifest.json`.

## Architecture

```
src/
  anthropic-client.js   Routes between Anthropic SDK and `claude` CLI backends
  models.js             Task -> model routing (opus/sonnet/haiku per task type)
  context.js            Mental Vision brand + offer context
  scoring.js            V5 AI-visibility scoring (0-100, tier bands)
  generators/           Session 0 — GHL prompt generators (website/business-os/automation)
  research/             Session 1 — prospect research, buyer queries, pain points, first-fix
  content/              Session 2 — entity brief, journey, email + Haiku angle judge, landing, meta, social
  visuals/              Session 3 — Higgsfield image + video with Haiku model router
  ghl/                  Session 4 — LeadConnector v2 client, field map, ingestion orchestrator
  batch/                Session 5 — bounded-concurrency orchestrator with resume-safe caching
  report/               Session 6 — campaign rollup + Markdown report
  index.js              Single CLI entrypoint
```

The pipeline is intentionally a set of layered, independently-runnable modules. Each session can be invoked alone (see `node src/index.js` for the full command list) or chained via `batch`.

## Model routing

| Task | Model | Why |
| --- | --- | --- |
| GHL automation prompts | Opus | Deep reasoning over 11 workflow branches |
| Business OS prompts | Opus | Reasoning over the full 35-field CRM schema |
| Landing page, email, entity brief, journey, research scoring, website prompt | Sonnet | Balanced generation |
| Meta ads, social posts, campaign report, email angle judge, first-fix priority | Haiku | Fast structured judgments |

See `src/models.js` to retune the routing table.

## Output layout

```
output/
  ghl_prompts/                              # Three copy-paste-ready GHL prompts
  campaigns/<campaign-id>/
    research/<slug>.json                    # Session 1
    content_bundles/<slug>_bundle.json      # Session 2 manifest (includes judge's pick)
    entity_briefs/<slug>_entity.md
    buyer_journeys/<slug>_journey.json
    emails/<slug>_email.json
    landing_pages/<slug>.html
    meta_copy/<slug>_meta.json
    social_posts/<slug>_social.json
    visuals/<slug>_brief.json               # Session 3 brief (Node.js writes)
    visuals/<slug>_visuals.json             # Session 3 manifest (Claude Code writes after MCP)
    visuals/<slug>_hero.png
    visuals/<slug>_video.mp4
    batch_manifest.json                     # Session 5 (when batch was used)
    campaign_report.md                      # Session 6
    campaign_state.json                     # Session 6 (machine-readable companion)
```

## Running this in a notebook or CI

`LLM_BACKEND=api` + `ANTHROPIC_API_KEY` is the right choice. The CLI backend depends on a logged-in `claude` and is slower per call due to subprocess startup.

## See also

- [VALIDATION.md](./VALIDATION.md) — step-by-step instructions for a 5-minute live validation run
- `.env.example` — every env var the pipeline understands, with comments
