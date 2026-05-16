import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";

import { MENTAL_VISION_CONTEXT } from "./context.js";
import { generateWebsitePrompt } from "./generators/website.js";
import { generateBusinessOSPrompt } from "./generators/business-os.js";
import { generateAutomationPrompt } from "./generators/automation.js";
import { runProspectResearch } from "./research/index.js";
import { generateContentForProspect } from "./content/index.js";
import { prepareVisualBrief, finalizeVisuals, listPendingBriefs } from "./visuals/index.js";
import { routeVideoModel } from "./visuals/router.js";
import { ingestProspect } from "./ghl/ingest.js";
import { runBatch } from "./batch/index.js";
import { generateCampaignReport } from "./report/index.js";
import { runDoctor } from "./doctor/index.js";

const GHL_OUTPUT_DIR = "output/ghl_prompts";
const CAMPAIGN_OUTPUT_DIR = "output/campaigns";

const GHL_TARGETS = {
  website: {
    fn: generateWebsitePrompt,
    file: "vibe_coder_prompt.txt",
    label: "Vibe Coder website prompt",
  },
  "business-os": {
    fn: generateBusinessOSPrompt,
    file: "ask_ai_prompt.txt",
    label: "GHL Ask AI Business OS prompt",
  },
  automation: {
    fn: generateAutomationPrompt,
    file: "automation_builder_prompt.txt",
    label: "GHL Automation Builder prompt",
  },
};

async function runGHLTarget(name) {
  const target = GHL_TARGETS[name];
  if (!target) {
    throw new Error(
      `Unknown GHL target: ${name}. Valid: ${Object.keys(GHL_TARGETS).join(", ")}, all`,
    );
  }

  console.log(`\n[${name}] Generating ${target.label}…`);
  const started = Date.now();

  const result = await target.fn(MENTAL_VISION_CONTEXT);

  await fs.mkdir(GHL_OUTPUT_DIR, { recursive: true });
  const outPath = path.join(GHL_OUTPUT_DIR, target.file);
  await fs.writeFile(outPath, result.text, "utf8");

  const elapsed = ((Date.now() - started) / 1000).toFixed(1);
  const inputT = result.usage?.input_tokens ?? 0;
  const outputT = result.usage?.output_tokens ?? 0;
  console.log(
    `[${name}] Done in ${elapsed}s — model=${result.model} stop=${result.stopReason} in=${inputT} out=${outputT}`,
  );
  console.log(`[${name}] Saved → ${outPath}`);
}

function parseFlags(argv) {
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (!next || next.startsWith("--")) {
        flags[key] = true;
      } else {
        flags[key] = next;
        i++;
      }
    }
  }
  return flags;
}

async function runResearch(argv) {
  const flags = parseFlags(argv);
  const required = ["company", "domain", "city", "niche"];
  for (const f of required) {
    if (!flags[f]) {
      throw new Error(
        `Missing --${f}. Usage:\n  node src/index.js research --company "ACME HVAC" --domain "acmehvac.com" --city "Indianapolis" --state "Indiana" --niche "HVAC" [--campaign-id "hvac-indy-2026-05"]`,
      );
    }
  }

  const campaignId = flags["campaign-id"] || "adhoc";
  const confidenceThreshold = flags["confidence-threshold"]
    ? Number(flags["confidence-threshold"])
    : 60;

  console.log(`\n[research] ${flags.company} (${flags.domain})`);
  const started = Date.now();

  const result = await runProspectResearch({
    company: flags.company,
    domain: flags.domain,
    city: flags.city,
    state: flags.state,
    niche: flags.niche,
    confidenceThreshold,
  });

  const slug = flags.company.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const outDir = path.join(CAMPAIGN_OUTPUT_DIR, campaignId, "research");
  await fs.mkdir(outDir, { recursive: true });
  const outPath = path.join(outDir, `${slug}.json`);
  await fs.writeFile(outPath, JSON.stringify(result, null, 2), "utf8");

  const elapsed = ((Date.now() - started) / 1000).toFixed(1);
  console.log(
    `[research] Done in ${elapsed}s — score=${result.score.total}/100 (${result.score.label}) confidence=${result.confidence}/100 status=${result.research_status}`,
  );
  if (result.assigned_offer) {
    console.log(`[research] Assigned offer: ${result.assigned_offer.name}`);
  }
  console.log(`[research] Saved → ${outPath}`);
}

async function runContent(argv) {
  const flags = parseFlags(argv);
  if (!flags.input) {
    throw new Error(
      `Missing --input. Usage:\n  node src/index.js content --input output/campaigns/<campaign-id>/research/<slug>.json [--campaign-id <id>]`,
    );
  }

  const inputPath = path.resolve(flags.input);
  const session1Result = JSON.parse(await fs.readFile(inputPath, "utf8"));

  // Default campaign-id from the input path: .../campaigns/<id>/research/<slug>.json
  const campaignId =
    flags["campaign-id"] ||
    path.basename(path.resolve(path.dirname(inputPath), "..")) ||
    "adhoc";

  console.log(
    `\n[content] ${session1Result.research_object?.company_name} | campaign=${campaignId}`,
  );
  const started = Date.now();

  const result = await generateContentForProspect({
    session1Result,
    campaignId,
  });

  const elapsed = ((Date.now() - started) / 1000).toFixed(1);
  if (result.skipped) {
    console.log(`[content] Skipped — ${result.reason}`);
    return;
  }
  console.log(`[content] Done in ${elapsed}s`);
  console.log(`[content] Bundle → ${result.bundle_path}`);
  console.log(`[content] Landing page → ${result.bundle.paths.landing_page}`);
  console.log(
    `[content] Selected email angle: ${result.bundle.selected_email_angle}`,
  );
  console.log(
    `[content] NOTE: landing_page_url is null until a deploy step runs.`,
  );
}

async function runProspect(argv) {
  const flags = parseFlags(argv);
  const required = ["company", "domain", "city", "niche"];
  for (const f of required) {
    if (!flags[f]) {
      throw new Error(
        `Missing --${f}. Usage:\n  node src/index.js prospect --company "ACME HVAC" --domain "acmehvac.com" --city "Indianapolis" --state "Indiana" --niche "HVAC" --campaign-id "hvac-indy-2026-05"`,
      );
    }
  }
  const campaignId = flags["campaign-id"] || "adhoc";
  const confidenceThreshold = flags["confidence-threshold"]
    ? Number(flags["confidence-threshold"])
    : 60;

  console.log(`\n[prospect] ${flags.company} | campaign=${campaignId}`);
  const wallStart = Date.now();

  // --- Session 1 ---
  console.log(`[prospect] Session 1: research + scoring…`);
  const s1Start = Date.now();
  const session1 = await runProspectResearch({
    company: flags.company,
    domain: flags.domain,
    city: flags.city,
    state: flags.state,
    niche: flags.niche,
    confidenceThreshold,
  });
  const s1Elapsed = ((Date.now() - s1Start) / 1000).toFixed(1);

  const slug = flags.company.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const s1Dir = path.join(CAMPAIGN_OUTPUT_DIR, campaignId, "research");
  await fs.mkdir(s1Dir, { recursive: true });
  const s1Path = path.join(s1Dir, `${slug}.json`);
  await fs.writeFile(s1Path, JSON.stringify(session1, null, 2), "utf8");

  console.log(
    `[prospect]   ↳ ${s1Elapsed}s | score=${session1.score.total}/100 (${session1.score.label}) | confidence=${session1.confidence}/100 | status=${session1.research_status}`,
  );
  console.log(`[prospect]   ↳ Saved → ${s1Path}`);

  if (!session1.content_eligible) {
    console.log(
      `[prospect] Stopping — confidence below threshold (${session1.confidence} < ${confidenceThreshold}). Manual review needed.`,
    );
    return;
  }

  // --- Session 2 ---
  console.log(`[prospect] Session 2: content stack (6 generators, parallel)…`);
  const s2Start = Date.now();
  const session2 = await generateContentForProspect({
    session1Result: session1,
    campaignId,
  });
  const s2Elapsed = ((Date.now() - s2Start) / 1000).toFixed(1);

  console.log(`[prospect]   ↳ ${s2Elapsed}s`);
  console.log(`[prospect]   ↳ Bundle → ${session2.bundle_path}`);
  console.log(`[prospect]   ↳ Landing page → ${session2.bundle.paths.landing_page}`);
  console.log(`[prospect]   ↳ Email angle → ${session2.bundle.selected_email_angle}`);

  const totalElapsed = ((Date.now() - wallStart) / 1000).toFixed(1);
  console.log(`\n[prospect] Done in ${totalElapsed}s total.`);
}

// MCP-driven visuals: this command prepares the per-prospect brief
// (model selection via Haiku router + image + video prompts) and writes
// it to disk. The actual generation happens in a Claude Code session
// via the Higgsfield MCP tools — see README "Generating visuals" — and
// is finalized back into the manifest via `visuals-finalize`.
async function runVisuals(argv) {
  const flags = parseFlags(argv);
  if (!flags.input) {
    throw new Error(
      `Missing --input. Usage:\n  node src/index.js visuals --input output/campaigns/<id>/research/<slug>.json [--campaign-id <id>] [--intent cinematic_hero|social_ugc|talking_head]`,
    );
  }
  const session1 = JSON.parse(await fs.readFile(flags.input, "utf8"));
  const campaignId = flags["campaign-id"] || session1.campaign_id || "adhoc";
  const intent = flags.intent || "cinematic_hero";

  console.log(
    `\n[visuals] ${session1.research_object.company_name} | campaign=${campaignId} intent=${intent}`,
  );
  const started = Date.now();

  const result = await prepareVisualBrief({
    session1Result: session1,
    campaignId,
    videoIntent: intent,
  });

  const elapsed = ((Date.now() - started) / 1000).toFixed(1);
  console.log(`[visuals] Brief prepared in ${elapsed}s`);
  console.log(`[visuals]   ↳ Image model: ${result.brief.image.model} (16:9)`);
  console.log(
    `[visuals]   ↳ Video model: ${result.brief.video.model} (router=${result.brief.video.router_classifier}, conf=${result.brief.video.router_confidence})`,
  );
  console.log(`[visuals]   ↳ Rationale: ${result.brief.video.router_rationale}`);
  console.log(`[visuals]   ↳ Brief → ${result.brief_path}`);
  console.log(`[visuals] Next: ask Claude Code to generate, e.g.:`);
  console.log(`[visuals]   "Generate visuals for campaign ${campaignId} via MCP."`);
}

async function runVisualsFinalize(argv) {
  const flags = parseFlags(argv);
  if (!flags["campaign-id"] || !flags.slug || !flags["image-url"]) {
    throw new Error(
      `Missing flags. Usage:\n  node src/index.js visuals-finalize --campaign-id <id> --slug <slug> --image-url <url> [--image-job-id <id>] [--video-url <url>] [--video-job-id <id>]`,
    );
  }
  console.log(`\n[visuals-finalize] ${flags.slug} | campaign=${flags["campaign-id"]}`);
  const result = await finalizeVisuals({
    campaignId: flags["campaign-id"],
    slug: flags.slug,
    imageUrl: flags["image-url"],
    imageJobId: flags["image-job-id"],
    videoUrl: flags["video-url"],
    videoJobId: flags["video-job-id"],
  });
  const img = result.manifest.image;
  if (img.local_path) {
    console.log(`[visuals-finalize]   ↳ Image → ${img.local_path}`);
  } else {
    console.log(`[visuals-finalize]   ↳ Image url-only: ${img.url}`);
    if (img.download_error) console.log(`[visuals-finalize]     download failed: ${img.download_error}`);
  }
  const vid = result.manifest.video;
  if (vid.local_path) {
    console.log(`[visuals-finalize]   ↳ Video → ${vid.local_path}`);
  } else if (vid.url) {
    console.log(`[visuals-finalize]   ↳ Video url-only: ${vid.url}`);
    if (vid.download_error) console.log(`[visuals-finalize]     download failed: ${vid.download_error}`);
  } else if (vid.job_id) {
    console.log(`[visuals-finalize]   ↳ Video job pending: ${vid.job_id}`);
  }
  console.log(`[visuals-finalize]   ↳ Manifest → ${result.manifest_path}`);
}

async function runVisualsPending(argv) {
  const flags = parseFlags(argv);
  if (!flags["campaign-id"]) {
    throw new Error(`Missing --campaign-id.`);
  }
  const pending = await listPendingBriefs({ campaignId: flags["campaign-id"] });
  if (pending.length === 0) {
    console.log(`No pending briefs for campaign ${flags["campaign-id"]} — all briefs have a matching visuals manifest.`);
    return;
  }
  console.log(`Pending visual briefs for campaign ${flags["campaign-id"]}: ${pending.length}`);
  for (const p of pending) {
    console.log(`  - ${p.slug}`);
    console.log(`      image: ${p.brief.image.model} | "${p.brief.image.prompt.slice(0, 80)}…"`);
    console.log(`      video: ${p.brief.video.model} | "${p.brief.video.prompt.slice(0, 80)}…"`);
  }
}

async function runReportCmd(argv) {
  const flags = parseFlags(argv);
  if (!flags["campaign-id"]) {
    throw new Error(`Missing --campaign-id. Usage:\n  node src/index.js report --campaign-id <id>`);
  }
  console.log(`\n[report] Generating campaign report for ${flags["campaign-id"]}…`);
  const t0 = Date.now();
  const r = await generateCampaignReport({ campaignId: flags["campaign-id"] });
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`[report]   ↳ ${elapsed}s`);
  console.log(`[report]   ↳ Report → ${r.report_path}`);
  console.log(`[report]   ↳ State  → ${r.state_path}`);
  console.log(`[report]   ↳ Summary: ${r.summary.total} prospects, ${r.summary.blocked} blocked, avg score ${r.summary.avg_score ?? "n/a"}`);
}

async function runBatchCmd(argv) {
  const flags = parseFlags(argv);
  if (!flags.input || !flags["campaign-id"]) {
    throw new Error(
      `Missing flags. Usage:\n  node src/index.js batch --input <prospects.csv|.json> --campaign-id <id> [--concurrency 3] [--steps research,content,visuals,ingest] [--force] [--live-ingest]`,
    );
  }
  const steps = flags.steps ? flags.steps.split(",").map((s) => s.trim()) : undefined;
  await runBatch({
    inputPath: flags.input,
    campaignId: flags["campaign-id"],
    steps,
    concurrency: flags.concurrency ? Number(flags.concurrency) : 3,
    force: !!flags.force,
    dryIngest: !flags["live-ingest"],
  });
}

async function runIngest(argv) {
  const flags = parseFlags(argv);
  if (!flags["campaign-id"] || !flags.slug) {
    throw new Error(
      `Missing flags. Usage:\n  node src/index.js ingest --campaign-id <id> --slug <prospect-slug> [--live]\n\nDefaults to dry-run. Add --live to actually push to GHL.`,
    );
  }
  const dryRun = !flags.live;
  console.log(
    `\n[ingest] ${flags.slug} | campaign=${flags["campaign-id"]} | mode=${dryRun ? "DRY-RUN" : "LIVE"}`,
  );

  const result = await ingestProspect({
    campaignId: flags["campaign-id"],
    slug: flags.slug,
    dryRun,
  });

  if (dryRun) {
    console.log(`\n[ingest] DRY-RUN plan:\n`);
    console.log(JSON.stringify(result.plan, null, 2));
    console.log(`\n[ingest] To execute for real, re-run with --live (requires GHL_API_KEY + GHL_LOCATION_ID in env).`);
    return;
  }

  console.log(`[ingest]   ↳ Contact created/updated: ${result.executed.contact?.id}`);
  if (result.executed.tags_applied) {
    console.log(`[ingest]   ↳ Tags applied (${result.executed.tags_applied.length})`);
  }
  if (result.executed.opportunity) {
    console.log(`[ingest]   ↳ Opportunity: ${result.executed.opportunity?.opportunity?.id || result.executed.opportunity?.id}`);
  } else if (result.executed.opportunity_skipped) {
    console.log(`[ingest]   ↳ Opportunity skipped: ${result.executed.opportunity_skipped}`);
  }
  if (result.executed.workflow) {
    console.log(`[ingest]   ↳ Added to workflow: ${result.executed.workflow.id}`);
  } else if (result.executed.workflow_skipped) {
    console.log(`[ingest]   ↳ Workflow skipped: ${result.executed.workflow_skipped}`);
  }
}

async function runRouteVideo(argv) {
  const flags = parseFlags(argv);
  if (!flags.prompt) {
    throw new Error(
      `Missing --prompt. Usage:\n  node src/index.js route-video --prompt "<text>" [--intent cinematic_hero|social_ugc|talking_head]`,
    );
  }
  const r = await routeVideoModel({ prompt: flags.prompt, intent: flags.intent });
  console.log(JSON.stringify(r, null, 2));
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  if (!cmd) {
    console.error(
      `Usage:
  node src/index.js <ghl-target>          Generate one GHL prompt
    targets: ${Object.keys(GHL_TARGETS).join(", ")}, all
  node src/index.js research --company ... --domain ... --city ... --niche ...
                                          Research + score one prospect (Session 1)
  node src/index.js content --input <session-1-json> [--campaign-id <id>]
                                          Generate full content stack (Session 2)
  node src/index.js prospect --company ... --domain ... --city ... --niche ...
                                          End-to-end: Session 1 + Session 2 in one command
  node src/index.js visuals --input <session-1-json> [--intent cinematic_hero|social_ugc|talking_head]
                                          Prepare visual brief (Session 3, MCP-driven).
                                          Actual generation happens in a Claude Code session
                                          via Higgsfield MCP tools — see README.
  node src/index.js visuals-pending --campaign-id <id>
                                          List briefs that have no matching manifest yet
                                          (i.e. the set Claude Code still needs to generate).
  node src/index.js visuals-finalize --campaign-id <id> --slug <slug>
                          --image-url <url> [--video-url <url>] [--image-job-id <id>] [--video-job-id <id>]
                                          Called by Claude Code after MCP generation:
                                          downloads files locally and writes the manifest.
  node src/index.js route-video --prompt "<text>" [--intent ...]
                                          Test the video model router (no generation)
  node src/index.js ingest --campaign-id <id> --slug <prospect-slug> [--live]
                                          Push a prospect's artifacts into GHL (dry-run by default, Session 4)
  node src/index.js batch --input <prospects.csv|.json> --campaign-id <id>
                          [--concurrency 3] [--steps research,content,visuals,ingest] [--force] [--live-ingest]
                                          Run all sessions over a list of prospects (Session 5)
  node src/index.js report --campaign-id <id>
                                          Aggregate one campaign and write a Markdown report (Session 6)
  node src/index.js doctor                Preflight: verify env, backend, GHL connectivity, output paths`,
    );
    process.exit(1);
  }

  if (cmd === "research") {
    await runResearch(rest);
    return;
  }

  if (cmd === "content") {
    await runContent(rest);
    return;
  }

  if (cmd === "prospect") {
    await runProspect(rest);
    return;
  }

  if (cmd === "visuals") {
    await runVisuals(rest);
    return;
  }

  if (cmd === "visuals-finalize") {
    await runVisualsFinalize(rest);
    return;
  }

  if (cmd === "visuals-pending") {
    await runVisualsPending(rest);
    return;
  }

  if (cmd === "route-video") {
    await runRouteVideo(rest);
    return;
  }

  if (cmd === "ingest") {
    await runIngest(rest);
    return;
  }

  if (cmd === "batch") {
    await runBatchCmd(rest);
    return;
  }

  if (cmd === "report") {
    await runReportCmd(rest);
    return;
  }

  if (cmd === "doctor") {
    const code = await runDoctor();
    process.exit(code);
  }

  if (cmd === "all") {
    for (const name of Object.keys(GHL_TARGETS)) {
      await runGHLTarget(name);
    }
    return;
  }

  await runGHLTarget(cmd);
}

main().catch((err) => {
  console.error("\nFailed:", err.message);
  if (err.stack && process.env.DEBUG) console.error(err.stack);
  process.exit(1);
});
