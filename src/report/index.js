import fs from "node:fs/promises";
import path from "node:path";

import { routeModel } from "../models.js";
import { generateText } from "../anthropic-client.js";
import { bandFromScore } from "../ghl/field-map.js";

// Sum a usage object across all per-call usage records.
function sumUsage(records) {
  const out = { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 };
  for (const u of records) {
    if (!u) continue;
    out.input_tokens += u.input_tokens || 0;
    out.output_tokens += u.output_tokens || 0;
    out.cache_creation_input_tokens += u.cache_creation_input_tokens || 0;
    out.cache_read_input_tokens += u.cache_read_input_tokens || 0;
  }
  return out;
}

// Walk a campaign dir and aggregate everything we need to summarize it.
async function gatherCampaign({ campaignId, outputRoot = "output/campaigns" }) {
  const dir = path.join(outputRoot, campaignId);

  let researchFiles = [];
  try {
    researchFiles = (await fs.readdir(path.join(dir, "research")))
      .filter((f) => f.endsWith(".json"))
      .map((f) => path.join(dir, "research", f));
  } catch (err) {
    if (err.code !== "ENOENT") throw err;
  }

  const prospects = [];
  for (const file of researchFiles) {
    const slug = path.basename(file, ".json");
    const research = JSON.parse(await fs.readFile(file, "utf8"));

    let contentBundle = null;
    try {
      contentBundle = JSON.parse(
        await fs.readFile(path.join(dir, "content_bundles", `${slug}_bundle.json`), "utf8"),
      );
    } catch (err) {
      if (err.code !== "ENOENT") throw err;
    }

    let visualsManifest = null;
    try {
      visualsManifest = JSON.parse(
        await fs.readFile(path.join(dir, "visuals", `${slug}_visuals.json`), "utf8"),
      );
    } catch (err) {
      if (err.code !== "ENOENT") throw err;
    }

    const band = research.score ? bandFromScore(research.score.total) : null;

    prospects.push({
      slug,
      company: research.research_object?.company_name,
      city: research.research_object?.city,
      score: research.score?.total ?? null,
      tier: band?.tier ?? null,
      content_eligible: !!research.content_eligible,
      confidence: research.confidence,
      first_fix: research.first_fix_priority,
      pain_points: research.pain_points || [],
      offer: research.assigned_offer?.name,
      has_content: !!contentBundle,
      has_visuals: !!visualsManifest,
      video_job_id: visualsManifest?.video?.job_id || null,
      // local_path is set when sync video download succeeded; null when an
      // async job was kicked off and not yet polled to completion.
      video_local_path: visualsManifest?.video?.local_path || null,
      usage_content: contentBundle?.usage || null,
    });
  }

  // Try batch manifest for cross-campaign metadata
  let batchManifest = null;
  try {
    batchManifest = JSON.parse(await fs.readFile(path.join(dir, "batch_manifest.json"), "utf8"));
  } catch (err) {
    if (err.code !== "ENOENT") throw err;
  }

  return { campaignId, dir, prospects, batchManifest };
}

function summarize(gathered) {
  const { prospects } = gathered;
  const byTier = { sprint: 0, stay_found: 0, diagnostic: 0, none: 0 };
  const byScoreBand = { "0-54": 0, "55-79": 0, "80-100": 0 };
  let blocked = 0;
  let totalScore = 0;
  let scored = 0;
  const allPain = [];

  for (const p of prospects) {
    if (!p.content_eligible) blocked++;
    if (p.tier) byTier[p.tier]++;
    else byTier.none++;
    if (p.score !== null) {
      scored++;
      totalScore += p.score;
      const band = bandFromScore(p.score);
      byScoreBand[band.band]++;
    }
    for (const pp of p.pain_points) {
      allPain.push(typeof pp === "string" ? pp : pp.headline || JSON.stringify(pp));
    }
  }

  // Top recurring pain themes (very rough — just count substrings of common keywords)
  const keywords = ["robots", "schema", "llms", "content", "fresh", "social", "GBP", "review", "AI"];
  const keywordCounts = {};
  for (const k of keywords) {
    keywordCounts[k] = allPain.filter((p) => p.toLowerCase().includes(k.toLowerCase())).length;
  }

  // Cost rollup — sum content-generation usage across prospects
  const contentUsageSum = sumUsage(
    prospects.flatMap((p) => (p.usage_content ? Object.values(p.usage_content) : [])),
  );

  return {
    total: prospects.length,
    scored,
    blocked,
    avg_score: scored ? Math.round((totalScore / scored) * 10) / 10 : null,
    by_tier: byTier,
    by_band: byScoreBand,
    // Async video job kicked off (manifest exists, has a job_id) but the
    // file isn't on disk yet (poll-video hasn't been run, or it's still
    // queued/processing).
    pending_visuals: prospects.filter((p) => p.video_job_id && !p.video_local_path).length,
    content_generated: prospects.filter((p) => p.has_content).length,
    visuals_generated: prospects.filter((p) => p.has_visuals).length,
    pain_themes: keywordCounts,
    content_token_usage: contentUsageSum,
  };
}

const REPORT_SYSTEM = `You are a campaign analyst for Mental Vision Corp. Given a structured summary of a prospect campaign, write a concise, actionable Markdown report for the operator.

Tone: direct, factual, no hype. Lead with the headline number and what it means. Use bullet points where structure helps; full sentences where context matters.

Required sections (in order):
1. **Headline** (1-2 sentences) — total prospects processed, avg score, headline distribution.
2. **Distribution** (table or bulleted breakdown) — by tier and score band.
3. **Recurring pain themes** — which AI visibility gaps showed up most across the cohort.
4. **Recommended actions** — 3-5 concrete next moves for the operator (e.g. "Top 4 sprint candidates are ready for outreach this week — pull their email subjects from the content bundles").
5. **Pipeline state** — how many have content / visuals / are still pending.

Do not invent metrics. If a number is null or zero, say so. No emoji.`;

export async function generateCampaignReport({ campaignId, outputRoot = "output/campaigns" }) {
  const gathered = await gatherCampaign({ campaignId, outputRoot });
  if (gathered.prospects.length === 0) {
    throw new Error(`No prospects found in ${gathered.dir}/research/. Run a batch first.`);
  }

  const summary = summarize(gathered);

  const userPrompt = `Campaign: ${campaignId}

SUMMARY:
${JSON.stringify(summary, null, 2)}

PROSPECT LIST (slug | company | score | tier | content_eligible):
${gathered.prospects
  .map((p) => `- ${p.slug} | ${p.company} | ${p.score ?? "n/a"} | ${p.tier ?? "n/a"} | ${p.content_eligible}`)
  .join("\n")}

Write the campaign report.`;

  const model = routeModel("campaign_report");
  const result = await generateText({
    model,
    systemPrompt: REPORT_SYSTEM,
    userPrompt,
    maxTokens: 4000,
  });

  const reportPath = path.join(gathered.dir, "campaign_report.md");
  const stateJsonPath = path.join(gathered.dir, "campaign_state.json");
  await fs.writeFile(reportPath, result.text, "utf8");
  await fs.writeFile(
    stateJsonPath,
    JSON.stringify({ campaign_id: campaignId, generated_at: new Date().toISOString(), summary, prospects: gathered.prospects }, null, 2),
    "utf8",
  );

  return {
    report_path: reportPath,
    state_path: stateJsonPath,
    summary,
    report_text: result.text,
    usage: result.usage,
  };
}
