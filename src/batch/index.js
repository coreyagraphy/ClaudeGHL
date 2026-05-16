import fs from "node:fs/promises";
import path from "node:path";

import { runProspectResearch } from "../research/index.js";
import { generateContentForProspect } from "../content/index.js";
import { prepareVisualBrief } from "../visuals/index.js";
import { ingestProspect } from "../ghl/ingest.js";

const DEFAULT_STEPS = ["research", "content", "visuals", "ingest"];
const VALID_STEPS = new Set(DEFAULT_STEPS);

function slugify(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

// --- Input parsing ---

// CSV parser that handles quoted fields containing commas, escaped quotes
// (""), and CRLF/LF line endings — the minimum a real-world prospect list
// needs ("Williams Comfort Air, Inc." is a real Indianapolis HVAC company).
function parseCSVLine(line) {
  const cells = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') { inQuotes = false; }
      else { cur += ch; }
    } else {
      if (ch === ',') { cells.push(cur); cur = ""; }
      else if (ch === '"' && cur === "") { inQuotes = true; }
      else { cur += ch; }
    }
  }
  cells.push(cur);
  return cells.map((c) => c.trim());
}

function parseCSV(text) {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const header = parseCSVLine(lines[0]);
  return lines.slice(1).map((line) => {
    const cells = parseCSVLine(line);
    const row = {};
    header.forEach((h, i) => (row[h] = cells[i]));
    return row;
  });
}

async function loadProspects(inputPath) {
  const text = await fs.readFile(inputPath, "utf8");
  const ext = path.extname(inputPath).toLowerCase();
  let rows;
  if (ext === ".json") {
    rows = JSON.parse(text);
    if (!Array.isArray(rows)) {
      throw new Error(`JSON input must be an array of prospect objects.`);
    }
  } else {
    rows = parseCSV(text);
  }
  // Validate required fields
  for (const [i, r] of rows.entries()) {
    for (const f of ["company", "domain", "city", "niche"]) {
      if (!r[f]) {
        throw new Error(`Prospect row ${i + 1} missing required field "${f}". Row: ${JSON.stringify(r)}`);
      }
    }
  }

  // Detect slug collisions before any work starts. Every per-prospect file
  // (research, content_bundle, visuals) is keyed by slug(company), and the
  // ingest step looks up the bundle by that same slug. Two rows with the
  // same slug would silently overwrite each other under concurrent writes
  // and push the wrong prospect's content to GHL. Fail loudly at load
  // time — the user should rename the row or split into two campaigns
  // rather than have us guess.
  const bySlug = new Map();
  for (const [i, r] of rows.entries()) {
    const slug = slugify(r.company);
    if (bySlug.has(slug)) {
      const prev = bySlug.get(slug);
      throw new Error(
        `Duplicate slug "${slug}" derived from company name in rows ${prev.i + 1} and ${i + 1}:\n` +
        `  row ${prev.i + 1}: ${prev.r.company} (${prev.r.city}, ${prev.r.domain})\n` +
        `  row ${i + 1}: ${r.company} (${r.city}, ${r.domain})\n` +
        `Rename one (e.g. "ACME HVAC — Indianapolis" vs "ACME HVAC — Carmel") or split into separate campaigns.`,
      );
    }
    bySlug.set(slug, { i, r });
  }
  return rows;
}

// --- Concurrency primitive: bounded parallelism over an async task list ---

async function runWithConcurrency(items, limit, taskFn) {
  const results = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (true) {
      const idx = cursor++;
      if (idx >= items.length) return;
      try {
        results[idx] = await taskFn(items[idx], idx);
      } catch (err) {
        // Use the same shape the per-prospect lambda uses on failure so the
        // manifest's `failed` counter (which reads r.error) sees this too.
        // This is a belt-and-suspenders fallback — the lambda has its own
        // try/catch — but if anyone refactors and removes that, errors
        // still surface correctly instead of becoming invisible.
        results[idx] = { slug: null, company: null, error: err.message || String(err) };
      }
    }
  }
  const workers = Array.from({ length: Math.min(limit, items.length) }, worker);
  await Promise.all(workers);
  return results;
}

// --- Per-step runners that share the campaign output layout with the single
// commands so re-running a step alone (or piecewise) just works.

async function readJSONIfExists(p) {
  try { return JSON.parse(await fs.readFile(p, "utf8")); }
  catch (e) { if (e.code === "ENOENT") return null; throw e; }
}

async function runOneProspect({ prospect, campaignId, steps, force, dryIngest, outputRoot }) {
  const slug = slugify(prospect.company);
  const campaignDir = path.join(outputRoot, campaignId);
  const researchPath = path.join(campaignDir, "research", `${slug}.json`);
  const bundlePath = path.join(campaignDir, "content_bundles", `${slug}_bundle.json`);
  const visualsPath = path.join(campaignDir, "visuals", `${slug}_visuals.json`);
  const visualsBriefPath = path.join(campaignDir, "visuals", `${slug}_brief.json`);

  const log = [];
  const result = {
    slug,
    company: prospect.company,
    steps: {},
    skipped_steps: [],
  };

  // Step: research
  let research;
  if (steps.includes("research")) {
    research = await readJSONIfExists(researchPath);
    if (research && !force) {
      log.push(`research: cached (${researchPath})`);
      result.steps.research = { status: "cached" };
    } else {
      const t0 = Date.now();
      research = await runProspectResearch({
        company: prospect.company,
        domain: prospect.domain,
        city: prospect.city,
        state: prospect.state,
        niche: prospect.niche,
      });
      await fs.mkdir(path.dirname(researchPath), { recursive: true });
      await fs.writeFile(researchPath, JSON.stringify(research, null, 2), "utf8");
      result.steps.research = {
        status: "ok",
        elapsed_s: ((Date.now() - t0) / 1000).toFixed(1),
        score: research.score?.total,
        confidence: research.confidence,
        eligible: research.content_eligible,
      };
    }
  } else {
    research = await readJSONIfExists(researchPath);
    if (!research) {
      result.steps.research = { status: "missing", error: `No research at ${researchPath}; include 'research' step or pre-populate.` };
      return result;
    }
  }

  if (!research.content_eligible) {
    result.skipped_steps.push("content", "visuals", "ingest");
    result.steps.gate = { status: "blocked_by_confidence", confidence: research.confidence };
    return result;
  }

  // Step: content
  if (steps.includes("content")) {
    const have = await readJSONIfExists(bundlePath);
    if (have && !force) {
      result.steps.content = { status: "cached" };
    } else {
      const t0 = Date.now();
      const r = await generateContentForProspect({ session1Result: research, campaignId });
      result.steps.content = {
        status: r.skipped ? "skipped" : "ok",
        elapsed_s: ((Date.now() - t0) / 1000).toFixed(1),
        reason: r.reason,
      };
    }
  }

  // Step: visuals — prepare brief only. Actual MCP generation is a separate
  // step driven by Claude Code (`visuals-pending` to list, then per-prospect
  // generate_image + generate_video + `visuals-finalize` to write the
  // manifest). Briefs are cheap to regenerate, so we use the manifest's
  // presence as the cache key — if the manifest exists, the visuals are
  // already done; otherwise we (re)prepare the brief.
  if (steps.includes("visuals")) {
    const haveManifest = await readJSONIfExists(visualsPath);
    if (haveManifest && !force) {
      result.steps.visuals = { status: "cached" };
    } else {
      const haveBrief = await readJSONIfExists(visualsBriefPath);
      if (haveBrief && !force) {
        result.steps.visuals = { status: "brief_ready" };
      } else {
        const t0 = Date.now();
        const r = await prepareVisualBrief({
          session1Result: research,
          campaignId,
          videoIntent: prospect.intent || "cinematic_hero",
        });
        result.steps.visuals = {
          status: "brief_ready",
          elapsed_s: ((Date.now() - t0) / 1000).toFixed(1),
          image_model: r.brief.image.model,
          video_model: r.brief.video.model,
          brief_path: r.brief_path,
        };
      }
    }
  }

  // Step: ingest
  if (steps.includes("ingest")) {
    const t0 = Date.now();
    const r = await ingestProspect({ campaignId, slug, dryRun: dryIngest });
    result.steps.ingest = {
      status: r.mode === "dry-run" ? "dry-run" : "ok",
      elapsed_s: ((Date.now() - t0) / 1000).toFixed(1),
      contact_id: r.executed?.contact?.id,
      opportunity_id: r.executed?.opportunity?.opportunity?.id || r.executed?.opportunity?.id,
      tier: r.plan?.tier,
    };
  }

  return result;
}

// --- Public entrypoint ---

export async function runBatch({
  inputPath,
  campaignId,
  steps = DEFAULT_STEPS,
  concurrency = 3,
  force = false,
  dryIngest = true,
  outputRoot = "output/campaigns",
}) {
  for (const s of steps) {
    if (!VALID_STEPS.has(s)) {
      throw new Error(`Unknown step "${s}". Valid: ${[...VALID_STEPS].join(", ")}`);
    }
  }

  const prospects = await loadProspects(inputPath);

  console.log(
    `[batch] ${prospects.length} prospects | campaign=${campaignId} | steps=[${steps.join(",")}] | concurrency=${concurrency} | dryIngest=${dryIngest}`,
  );

  const wallStart = Date.now();
  const results = await runWithConcurrency(prospects, concurrency, async (p, i) => {
    const tag = `[${i + 1}/${prospects.length}] ${p.company}`;
    console.log(`${tag} starting…`);
    try {
      const r = await runOneProspect({
        prospect: p,
        campaignId,
        steps,
        force,
        dryIngest,
        outputRoot,
      });
      const status = Object.entries(r.steps)
        .map(([k, v]) => `${k}=${v.status}`)
        .join(" ");
      console.log(`${tag} done — ${status}`);
      return r;
    } catch (err) {
      console.log(`${tag} FAILED: ${err.message}`);
      return { slug: slugify(p.company), company: p.company, error: err.message };
    }
  });

  const wallElapsed = ((Date.now() - wallStart) / 1000).toFixed(1);

  const manifest = {
    campaign_id: campaignId,
    started_at: new Date(wallStart).toISOString(),
    elapsed_s: wallElapsed,
    concurrency,
    steps,
    dry_ingest: dryIngest,
    total: results.length,
    failed: results.filter(
      (r) => r.error || Object.values(r.steps || {}).some((s) => s.error || s.status === "missing"),
    ).length,
    blocked_by_confidence: results.filter((r) => r.steps?.gate?.status === "blocked_by_confidence").length,
    results,
  };

  const manifestPath = path.join(outputRoot, campaignId, "batch_manifest.json");
  await fs.mkdir(path.dirname(manifestPath), { recursive: true });
  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2), "utf8");

  console.log(
    `\n[batch] Done in ${wallElapsed}s | ${results.length} processed, ${manifest.failed} failed, ${manifest.blocked_by_confidence} blocked by confidence gate`,
  );
  console.log(`[batch] Manifest → ${manifestPath}`);

  return { manifest, manifestPath };
}
