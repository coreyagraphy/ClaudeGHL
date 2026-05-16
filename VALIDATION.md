# Local Validation Run

Step-by-step to validate the pipeline end-to-end on one real prospect.
**Total time: ~5 minutes** (mostly waiting on web search + content generation).

## Prerequisites
- Node.js 20+
- An Anthropic API key with credits

## 1. Clone and install

```bash
git clone <your-repo-url> ClaudeGHL
cd ClaudeGHL
git checkout claude/review-and-proceed-qXy29
npm install
```

## 2. Pick a backend

You have two choices — both produce identical output, they just bill differently.

### Option A — Claude subscription (no API key needed) ✨

If you have Claude Pro / Max / Teams, the pipeline can run through your existing
`claude` CLI login (OAuth). Nothing to copy, nothing to paste.

```bash
cp .env.example .env
# Edit .env, set: LLM_BACKEND=claude-cli
# Leave ANTHROPIC_API_KEY blank.
```

Make sure you're logged in: `claude` once interactively, then exit.

**Tradeoffs:** subscription rate limits are tighter than API spend limits, so
this is great for validation runs (1–10 prospects) but for daily batches of 50+
you'll likely want Option B. Each call is also a few seconds slower (subprocess
startup overhead, ~2–3s per call).

### Option B — Anthropic API key

```bash
cp .env.example .env
# Edit .env, paste your ANTHROPIC_API_KEY=sk-ant-...
# Leave LLM_BACKEND blank (or set LLM_BACKEND=api).
```

Faster per-call, no rate-limit pain for batch jobs. Billed at standard API rates.

## 3. Validate Session 0 (GHL prompts)

```bash
npm run ghl:all
```

**Expect:** ~60–90s. Three files in `output/ghl_prompts/`:
- `vibe_coder_prompt.txt` (Sonnet)
- `ask_ai_prompt.txt` (Opus + adaptive thinking)
- `automation_builder_prompt.txt` (Opus + adaptive thinking)

**What to check:** open each file. The brief says they must be "copy-paste ready with zero additional editing." Look for:
- Placeholder text Claude left in (e.g. `[insert your...]`) — should be none
- Section structure matches the brief (8-section site, all 35 CRM fields, all 11 workflow branches)
- Brand voice — direct, peer-level, NOT corporate SaaS

## 4. Validate Sessions 1 + 2 on one prospect (end-to-end)

```bash
npm run prospect -- \
  --company "Williams Comfort Air" \
  --domain "williamscomfortair.com" \
  --city "Indianapolis" \
  --state "Indiana" \
  --niche "HVAC" \
  --campaign-id "validation-2026-05"
```

Replace with any real local business if you'd like.

**Expect:** 2–5 minutes total.

```
[prospect] Session 1: research + scoring…
[prospect]   ↳ 45s | score=62/100 (Building) | confidence=85/100 | status=qualified
[prospect]   ↳ Saved → output/campaigns/validation-2026-05/research/williams-comfort-air.json
[prospect] Session 2: content stack (6 generators, parallel)…
[prospect]   ↳ 75s
[prospect]   ↳ Bundle → output/campaigns/validation-2026-05/content_bundles/williams-comfort-air_bundle.json
[prospect]   ↳ Landing page → output/campaigns/validation-2026-05/landing_pages/williams-comfort-air.html
[prospect]   ↳ Email angle → building_partial_visibility
```

## 5. Inspect the output

```bash
# Research object + score breakdown + buyer query coverage
cat output/campaigns/validation-2026-05/research/williams-comfort-air.json | jq '.research_object, .score, .pain_points, .first_fix_priority'

# Selected email
cat output/campaigns/validation-2026-05/emails/williams-comfort-air_email.json | jq '.variants[] | select(.angle == .recommended_angle)'

# Landing page in your browser
open output/campaigns/validation-2026-05/landing_pages/williams-comfort-air.html
```

## What to look for / what to flag back to me

### Research (Session 1)
- [ ] Is `research_object.email` real? `email_source: "site_scrape"` is the high-confidence case.
- [ ] Is `owner_first` actually the owner's name (not a random staff member)?
- [ ] Does `ai_bots_blocked` reflect their real robots.txt?
- [ ] Does `buyer_query_coverage` reflect what you'd see if you ran those queries yourself?

### Score
- [ ] Does `score.total` feel right vs. your gut sense of their AI visibility?
- [ ] Is `assigned_offer` the right tier for that score?

### Content (Session 2)
- [ ] Entity brief — markdown clean, no invented metrics
- [ ] Email — voice matches Luna persona (direct, peer-level), subject under 9 words, no emoji
- [ ] Landing page — opens in browser, 8 sections present, score bar animates, calendar placeholder visible
- [ ] Meta ads — 5 headlines, 3 primary texts, all under character limits
- [ ] Social posts — 5 platforms, each respects platform length norms

### Anything broken
- Stack traces, schema errors (especially 400s on structured output), rate limits, garbled HTML, missing sections, fabricated facts.

Paste failures back to me. I can iterate on prompts, schemas, or routing without you re-running prerequisites.

## Skipping ahead

If you want to skip Session 1 and only test Session 2 with hand-curated input,
you can write a research JSON file by hand and run:

```bash
npm run content -- --input path/to/your-test.json --campaign-id test
```

The schema is in `src/research/prospect.js` (`RESEARCH_SCHEMA`). The Session 1
result wrapper must include `content_eligible: true`, `score`, `assigned_offer`,
`pain_points`, `first_fix_priority`, `first_fix_rationale`.
