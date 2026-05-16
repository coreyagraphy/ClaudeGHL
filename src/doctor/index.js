// Preflight diagnostics. Catches config errors in seconds instead of
// 30 minutes into a batch run. No state mutation — all probes are GETs
// or trivial round-trips. Exits 0 if pipeline can run end-to-end, 1 if
// any required component is broken.

import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

import { getBackend, generateText } from "../anthropic-client.js";
import { getPipelines } from "../ghl/client.js";

const REQUIRED_GHL_FOR_FULL_INGEST = [
  "GHL_API_KEY",
  "GHL_LOCATION_ID",
  "GHL_PIPELINE_ID",
  "GHL_STAGE_SPRINT",
  "GHL_STAGE_STAY_FOUND",
  "GHL_STAGE_DIAGNOSTIC",
  "GHL_WORKFLOW_SPRINT",
  "GHL_WORKFLOW_STAY_FOUND",
  "GHL_WORKFLOW_DIAGNOSTIC",
];

function record(results, level, component, detail) {
  results.push({ level, component, detail });
}

async function checkNode(results) {
  const v = process.versions.node;
  const major = Number(v.split(".")[0]);
  if (major >= 20) {
    record(results, "OK", "Node runtime", `v${v} (>= 20, native fetch)`);
  } else {
    record(results, "FAIL", "Node runtime", `v${v} — need >= 20 (native fetch)`);
  }
}

async function checkClaudeCli() {
  return new Promise((resolve) => {
    const proc = spawn("claude", ["--version"], { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    proc.stdout.on("data", (c) => (out += c.toString()));
    proc.on("error", () => resolve({ present: false }));
    proc.on("close", (code) => {
      if (code === 0) resolve({ present: true, version: out.trim() });
      else resolve({ present: false });
    });
  });
}

async function checkAnthropicBackend(results) {
  const backend = getBackend();
  record(results, "INFO", "LLM backend", `resolved: ${backend}`);

  if (backend === "api") {
    if (!process.env.ANTHROPIC_API_KEY) {
      record(results, "FAIL", "Anthropic auth", "LLM_BACKEND=api but ANTHROPIC_API_KEY is empty");
      return;
    }
    try {
      const r = await generateText({
        model: "claude-haiku-4-5",
        systemPrompt: "You are a connectivity probe. Reply with one word.",
        userPrompt: "Reply OK.",
        maxTokens: 20,
      });
      const txt = (r.text || "").trim();
      record(results, "OK", "Anthropic API", `round-trip succeeded: "${txt.slice(0, 30)}" (${r.usage?.input_tokens || 0}/${r.usage?.output_tokens || 0} in/out)`);
    } catch (err) {
      record(results, "FAIL", "Anthropic API", `round-trip failed: ${err.message}`);
    }
    return;
  }

  // claude-cli backend
  const cli = await checkClaudeCli();
  if (!cli.present) {
    record(results, "FAIL", "claude CLI", "`claude` not on PATH (install from https://claude.com/code or set LLM_BACKEND=api)");
    return;
  }
  record(results, "OK", "claude CLI", cli.version || "present");
  try {
    const r = await generateText({
      model: "claude-haiku-4-5",
      systemPrompt: "You are a connectivity probe. Reply with one word.",
      userPrompt: "Reply OK.",
      maxTokens: 20,
    });
    // Any successful round-trip is sufficient — the request reached the
    // model and a response came back. We don't gate on response content
    // because the CLI backend may strip or reformat short replies.
    const txt = (r.text || "").trim();
    record(results, "OK", "Claude subscription", `CLI round-trip succeeded: "${txt.slice(0, 30)}"`);
  } catch (err) {
    record(results, "FAIL", "Claude subscription", `CLI round-trip failed: ${err.message}`);
  }
}

async function checkGHL(results) {
  const missing = REQUIRED_GHL_FOR_FULL_INGEST.filter((k) => !process.env[k]);
  if (missing.length === REQUIRED_GHL_FOR_FULL_INGEST.length) {
    record(results, "WARN", "GHL config", "no GHL_* env vars set — ingest will be disabled");
    return;
  }
  if (missing.length > 0) {
    record(results, "WARN", "GHL config", `missing for full ingest: ${missing.join(", ")}`);
  } else {
    record(results, "OK", "GHL config", "all required env vars set");
  }

  if (!process.env.GHL_API_KEY || !process.env.GHL_LOCATION_ID) {
    record(results, "WARN", "GHL connectivity", "skipped (need at least GHL_API_KEY + GHL_LOCATION_ID)");
    return;
  }
  try {
    const pipelines = await getPipelines();
    const count = Array.isArray(pipelines?.pipelines) ? pipelines.pipelines.length : 0;
    record(results, "OK", "GHL connectivity", `auth succeeded, ${count} pipeline(s) visible in location`);

    if (process.env.GHL_PIPELINE_ID && Array.isArray(pipelines?.pipelines)) {
      const found = pipelines.pipelines.find((p) => p.id === process.env.GHL_PIPELINE_ID);
      if (!found) {
        record(results, "WARN", "GHL pipeline ID", `GHL_PIPELINE_ID=${process.env.GHL_PIPELINE_ID} not found in this location`);
      } else {
        record(results, "OK", "GHL pipeline ID", `matches "${found.name}" (${found.stages?.length || 0} stages)`);
      }
    }
  } catch (err) {
    record(results, "FAIL", "GHL connectivity", err.message.slice(0, 200));
  }
}

async function checkHiggsfield(results) {
  if (!process.env.HIGGSFIELD_API_KEY) {
    record(results, "WARN", "Higgsfield", "HIGGSFIELD_API_KEY not set — visuals step will fail");
    return;
  }
  record(results, "OK", "Higgsfield", "key present (MCP layer probes at call time)");
}

async function checkOutputDirs(results) {
  const dirs = ["output", "output/ghl_prompts", "output/campaigns"];
  for (const d of dirs) {
    const p = path.resolve(d);
    try {
      await fs.mkdir(p, { recursive: true });
      const probe = path.join(p, ".doctor-probe");
      await fs.writeFile(probe, "");
      await fs.unlink(probe);
      record(results, "OK", `output/${path.basename(p)}`, `writable: ${p}`);
    } catch (err) {
      record(results, "FAIL", `output/${path.basename(p)}`, err.message);
    }
  }
}

function render(results) {
  const widthComp = Math.max(...results.map((r) => r.component.length), 12);
  console.log("");
  console.log("=== Doctor report ===");
  for (const r of results) {
    const tag = r.level.padEnd(4);
    const comp = r.component.padEnd(widthComp);
    console.log(`  [${tag}] ${comp}  ${r.detail}`);
  }
  const fails = results.filter((r) => r.level === "FAIL").length;
  const warns = results.filter((r) => r.level === "WARN").length;
  const oks = results.filter((r) => r.level === "OK").length;
  console.log("");
  console.log(`Summary: ${oks} OK, ${warns} warnings, ${fails} failures`);
  if (fails > 0) {
    console.log("Fix FAIL items before running batch jobs.");
    return 1;
  }
  if (warns > 0) {
    console.log("Pipeline can run, but some optional steps are disabled. Resolve warnings to enable them.");
  } else {
    console.log("Ready to run.");
  }
  return 0;
}

export async function runDoctor() {
  const results = [];
  await checkNode(results);
  await checkAnthropicBackend(results);
  await checkGHL(results);
  await checkHiggsfield(results);
  await checkOutputDirs(results);
  const code = render(results);
  return code;
}
