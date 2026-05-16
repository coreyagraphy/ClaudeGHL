# Session Handoff

For a fresh Claude Code session picking up this branch cold. Read top to bottom; do not re-investigate items marked "done".

## TL;DR

Mental Vision outbound pipeline, branch `claude/review-and-proceed-qXy29`, pushed. Sessions 0–6 implemented. Live validation in progress on prospect `williams-comfort-air` in campaign `live-validate-1`. Research + visuals + GHL dry-run all working with real data. Content step is retrying in the background after a CLI-timeout fix.

## Environment constraints

- **LLM backend: `LLM_BACKEND=claude-cli`** (user's Claude Code subscription, no `ANTHROPIC_API_KEY`). All Node-side LLM calls go through `claude -p` subprocess.
- **Higgsfield: MCP only** (no API key). Server prefix `mcp__8474aa46-0943-4939-b396-be4e0697949b__`. User has 7266 credits (Creator). Tools used: `generate_image`, `generate_video`, `job_display`, `models_explore`, `balance`, `list_workspaces`.
- **GHL: not yet configured.** No env vars set. `doctor` warns 1 (expected). Ingest works in dry-run; `--live` is blocked until user provides credentials.
- **Sandbox can't fetch Higgsfield CloudFront URLs** (`x-deny-reason: host_not_allowed` — ASN block). Manifests record URLs with `download_error`; user's machine will succeed. Don't waste time debugging this.

## Architecture

```
src/
  anthropic-client.js   API + CLI backends. CLI default timeout 20min, web search 30min.
  models.js             Task -> opus/sonnet/haiku routing.
  context.js            Brand + 4 tiers (diagnostic, sprint, stay_found, foundation).
  scoring.js            V5 scoring (0-100) + tier assignment (assignOffer).
  research/             Session 1: prospect.js + buyer-queries.js + pain-points.js + first-fix.js.
  content/              Session 2: entity-brief, buyer-journey, email, email-classifier (Haiku judge), landing-page, meta-ads, social-posts.
  visuals/              Session 3: MCP-driven. prepareVisualBrief -> Claude Code MCP -> finalizeVisuals.
  ghl/                  Session 4: client.js, field-map.js (35 custom fields), ingest.js.
  batch/                Session 5: bounded-concurrency orchestrator with resume-safe caching.
  report/               Session 6: gather + summary + Haiku-generated Markdown.
  doctor/               Preflight: node, backend round-trip, GHL connectivity, output dirs.
```

## Visuals flow (MCP)

`src/visuals/higgsfield-client.js` was deleted. Flow is split:

1. `node src/index.js visuals --input <session1.json> --campaign-id X` — writes `<campaign>/visuals/<slug>_brief.json` (model picks + prompts). No network.
2. Claude Code session: reads brief, calls `mcp__*__generate_image` + `mcp__*__generate_video`, polls with `job_display` until `status: completed`, captures result URLs.
3. `node src/index.js visuals-finalize --campaign-id X --slug Y --image-url ... [--video-url ...] [--video-job-id ...]` — downloads files (non-fatal on failure), writes `<slug>_visuals.json`.

Use `node src/index.js visuals-pending --campaign-id X` to list briefs without a manifest.

**Real Higgsfield model IDs** (verify with `mcp__*__models_explore action=list type=video`):
- cinematic_hero → `cinematic_studio_3_0`
- talking_head → `kling3_0`
- social_ugc → `seedance_2_0`
- image: `nano_banana_2` (text+4k) or `marketing_studio_image`

Earlier router used invented IDs (`higgsfield_studio_video`, `kling_3_0`) — fixed.

## Live validation state (campaign `live-validate-1`)

Prospect: **Williams Comfort Air**, Indianapolis HVAC, score 75/100, tier `stay_found`, $497/mo offer.

| Artifact | Path | Status |
| --- | --- | --- |
| Research | `output/campaigns/live-validate-1/research/williams-comfort-air.json` | ✅ 23KB, real data, 8 buyer queries, 6 pain points |
| Visual brief | `output/campaigns/live-validate-1/visuals/williams-comfort-air_brief.json` | ✅ 3.2KB |
| Visuals manifest | `output/campaigns/live-validate-1/visuals/williams-comfort-air_visuals.json` | ✅ both URLs, both `download_error` (sandbox-only) |
| Content bundle | `output/campaigns/live-validate-1/content_bundles/williams-comfort-air_bundle.json` | 🔄 retry running (bash task `bkkyp6zy6`) |
| Landing page | `output/campaigns/live-validate-1/landing_pages/williams-comfort-air.html` | 🔄 |
| Ingest dry-run | (computed on demand, no file) | ✅ payload correct |
| Campaign report | `output/campaigns/live-validate-1/campaign_report.md` | ⏳ waits on content |

**MCP jobs already paid for** (don't regenerate):
- Image: `ee337b5d-87cb-4796-85d1-c1b25fd40a2e` (URL in manifest, 2 credits)
- Video: `713fe82b-999f-43d1-a86e-b969c10c817e` (URL in manifest, 30 credits)

Credits used this session: 32 / 7266.

## What to do next (in order)

1. **Watch for content step completion.** Bash task `bkkyp6zy6`. When it lands, verify all 6 content files exist + the bundle JSON. Bundle should include `email_angle_writer_pick`, `email_angle_judge_pick`, `email_angle_writer_judge_agreed` from the Haiku classifier.
2. **Re-run ingest dry-run** to verify content fields (`selected_email_angle`, `selected_email_subject`, `landing_page_local_path`) populated.
3. **Generate campaign report**: `node src/index.js report --campaign-id live-validate-1`. Uses Haiku — fast (1–2 min).
4. **Send user the manifest + report paths** so they can inspect.

Stop after that. Don't do a batch run, don't push to GHL live — both need user input.

## What the user still needs to provide

| When | What | Why |
| --- | --- | --- |
| To enable `--live` ingest | `GHL_API_KEY`, `GHL_LOCATION_ID`, `GHL_PIPELINE_ID`, `GHL_STAGE_SPRINT`, `GHL_STAGE_STAY_FOUND`, `GHL_STAGE_FOUNDATION`, `GHL_WORKFLOW_SPRINT`, `GHL_WORKFLOW_STAY_FOUND`, `GHL_WORKFLOW_FOUNDATION`, `GHL_WORKFLOW_DEFAULT` | All ingest goes through LeadConnector v2 API |
| For a real outbound campaign | Prospect list (CSV or JSON), preferred batch concurrency, intent override per row if any | Drives `npm run batch` |
| Never | A Higgsfield API key | MCP is sufficient for interactive runs |

## Bugs fixed this session (do NOT re-investigate)

Each was real, reproduced, and committed. If you suspect a regression, check the commit message before rediscovering.

| # | Symptom | Commit |
| --- | --- | --- |
| 1 | `text` vs `data` field mismatch in doctor probe | f93d2e6 |
| 2 | Silent slug collisions in batch loader (would overwrite GHL contacts) | 8d9ee38 |
| 3 | Visuals crashed on `research_object.business` (field doesn't exist) | 7400784 |
| 4 | Visuals wrote `_manifest.json` but readers expected `_visuals.json` | 7400784 |
| 5 | "Business: undefined" leaked into Higgsfield prompts | 7400784 |
| 6 | `pending_visuals` counter mathematically always 0 | d394d92 |
| 7 | `String(undefined)` stored as literal "undefined" in GHL custom fields | 9111a8a |
| 8 | Unescaped regex in lastName derivation breaks on names like "J.R." | 9111a8a |
| 9 | Tier mismatch — `bandFromScore` said "diagnostic", `assignOffer` said "foundation" for 80+ | f6e6890 |
| 10 | CSV parser couldn't handle quoted commas (`"Williams Comfort Air, Inc."`) | 9cdbd00 |
| 11 | Async video flow dead-end (poll-video didn't write back to manifest) | 9cdbd00 |
| 12 | `__error` vs `error` shape inconsistency in batch concurrency primitive | 9cdbd00 |
| 13 | Refactored visuals module to MCP-driven (deleted higgsfield-client.js) | 56fb2af |
| 14 | Router used invented model IDs (`higgsfield_studio_video`, `kling_3_0`) | 22740cb |
| 15 | finalize crashed on download failure and lost the URL | 22740cb |
| 16 | Validator referenced stale model name constants after rename | ed9b9f3 |
| 17 | `pain_points_summary` GHL field received JSON-stringified objects | ce49b8e |
| 18 | Misleading `visuals-finalize` CLI output for url-only states | 466ce9b |
| 19 | CLI subprocess timeout 10min too tight for landing-page (32k tokens) | 55b8457 |

## Quick commands

```bash
# Preflight
LLM_BACKEND=claude-cli node src/index.js doctor

# Resume the live validation (after content lands)
node src/index.js ingest  --campaign-id live-validate-1 --slug williams-comfort-air
LLM_BACKEND=claude-cli node src/index.js report --campaign-id live-validate-1

# Inspect what's on disk
find output/campaigns/live-validate-1 -type f -printf '%s %p\n' | sort -n

# Check Higgsfield credits
# (call mcp__8474aa46-0943-4939-b396-be4e0697949b__balance)

# Full pipeline for ONE prospect (research + content + visuals brief)
LLM_BACKEND=claude-cli timeout 1800 node src/index.js prospect \
  --company "..." --domain "..." --city "..." --state "..." --niche "..." --campaign-id "..."

# Batch
node src/index.js batch --input prospects.csv --campaign-id X \
  --concurrency 3 --steps research,content,visuals,ingest
# add --live-ingest only after user explicitly approves and GHL_* env vars are set
```

## Hidden gotchas

- **`tail -N`** on `validate.js` output is misleading — the report ends with "All checks passed" only if errors.length === 0, but the tail might show stale content. Always run without `tail` or check the `Errors:` line specifically.
- **`generateText` returns `{text}`**, `generateJSON` returns `{data}`. Easy to confuse.
- **GHL contact upsert is keyed by email.** A duplicate slug collision (now caught at load time, but if bypassed) would overwrite real customer records.
- **Tier names must match** between `context.js` tiers, `bandFromScore`, `assignOffer`, and env var suffixes. If you rename one, grep for all of them.
- **The Node.js pipeline cannot call MCP tools.** Anything Higgsfield must go through a Claude Code session via `visuals` → MCP → `visuals-finalize`.

## Response style preference

User wants dense, low-token communication. Skip narration. Lead with results. One- or two-sentence updates beat paragraphs. Tables beat prose for structured info. Don't restate what's in commit messages — point to the SHA.
