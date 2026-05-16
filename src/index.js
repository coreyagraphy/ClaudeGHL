import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";

import { MENTAL_VISION_CONTEXT } from "./context.js";
import { generateWebsitePrompt } from "./generators/website.js";
import { generateBusinessOSPrompt } from "./generators/business-os.js";
import { generateAutomationPrompt } from "./generators/automation.js";

const OUTPUT_DIR = "output/ghl_prompts";

const TARGETS = {
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

async function runTarget(name) {
  const target = TARGETS[name];
  if (!target) {
    throw new Error(`Unknown target: ${name}. Valid: ${Object.keys(TARGETS).join(", ")}, all`);
  }

  console.log(`\n[${name}] Generating ${target.label}…`);
  const started = Date.now();

  const result = await target.fn(MENTAL_VISION_CONTEXT);

  await fs.mkdir(OUTPUT_DIR, { recursive: true });
  const outPath = path.join(OUTPUT_DIR, target.file);
  await fs.writeFile(outPath, result.text, "utf8");

  const elapsed = ((Date.now() - started) / 1000).toFixed(1);
  const inputT = result.usage?.input_tokens ?? 0;
  const outputT = result.usage?.output_tokens ?? 0;
  console.log(
    `[${name}] Done in ${elapsed}s — model=${result.model} stop=${result.stopReason} in=${inputT} out=${outputT}`,
  );
  console.log(`[${name}] Saved → ${outPath}`);
}

async function main() {
  const arg = process.argv[2];
  if (!arg) {
    console.error(
      `Usage: node src/index.js <target>\n  Targets: ${Object.keys(TARGETS).join(", ")}, all`,
    );
    process.exit(1);
  }

  const targets = arg === "all" ? Object.keys(TARGETS) : [arg];
  for (const name of targets) {
    await runTarget(name);
  }
}

main().catch((err) => {
  console.error("\nFailed:", err.message);
  if (err.stack && process.env.DEBUG) console.error(err.stack);
  process.exit(1);
});
