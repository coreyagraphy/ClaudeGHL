import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";

import { MENTAL_VISION_CONTEXT } from "./context.js";
import { generateWebsitePrompt } from "./generators/website.js";
import { generateBusinessOSPrompt } from "./generators/business-os.js";
import { generateAutomationPrompt } from "./generators/automation.js";
import { runProspectResearch } from "./research/index.js";
import { generateContentForProspect } from "./content/index.js";

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

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  if (!cmd) {
    console.error(
      `Usage:
  node src/index.js <ghl-target>          Generate one GHL prompt
    targets: ${Object.keys(GHL_TARGETS).join(", ")}, all
  node src/index.js research --company ... --domain ... --city ... --niche ...
                                          Research + score one prospect
  node src/index.js content --input <session-1-json> [--campaign-id <id>]
                                          Generate full content stack for one prospect`,
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
