import fs from "node:fs/promises";
import path from "node:path";
import { routeVideoModel } from "./router.js";
import { buildImagePrompt, buildVideoPrompt } from "./prompts.js";

const CAMPAIGN_OUTPUT_DIR = "output/campaigns";

function slugify(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export async function downloadTo(url, destPath) {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to download ${url}: ${res.status}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  await fs.mkdir(path.dirname(destPath), { recursive: true });
  await fs.writeFile(destPath, buf);
  return destPath;
}

// STEP 1 (Node.js): build the per-prospect visual brief.
// Pure prep work — picks the video model via the Haiku router, generates
// the image+video prompts, and writes a JSON brief that a Claude Code
// session can hand off to the Higgsfield MCP tools (or, for unattended
// runs with an API key, a future HTTP client could consume the same shape).
export async function prepareVisualBrief({
  session1Result,
  campaignId,
  videoIntent = "cinematic_hero",
  outputRoot = CAMPAIGN_OUTPUT_DIR,
}) {
  const slug = slugify(session1Result.research_object.company_name);
  const visualsDir = path.join(outputRoot, campaignId, "visuals");
  await fs.mkdir(visualsDir, { recursive: true });

  const [imageSpec, videoSpec] = await Promise.all([
    buildImagePrompt({ session1Result }),
    buildVideoPrompt({ session1Result, intent: videoIntent }),
  ]);

  const routing = await routeVideoModel({
    prompt: videoSpec.prompt,
    intent: videoIntent,
  });

  const brief = {
    prospect: session1Result.research_object.company_name,
    campaign_id: campaignId,
    slug,
    image: {
      model: "nano_banana_2",
      prompt: imageSpec.prompt,
      negative_prompt: imageSpec.negative_prompt,
      style_tags: imageSpec.style_tags,
      aspect_ratio: "16:9",
    },
    video: {
      model: routing.model,
      intent: videoIntent,
      router_rationale: routing.rationale,
      router_classifier: routing.classifier,
      router_confidence: routing.confidence,
      prompt: videoSpec.prompt,
      camera_motion: videoSpec.camera_motion,
      duration_sec: videoSpec.duration_sec,
      aspect_ratio: videoSpec.aspect_ratio,
      style_tags: videoSpec.style_tags,
    },
  };

  const briefPath = path.join(visualsDir, `${slug}_brief.json`);
  await fs.writeFile(briefPath, JSON.stringify(brief, null, 2), "utf8");

  return { brief_path: briefPath, brief };
}

// STEP 2 (Node.js, called by Claude Code after MCP returns):
// Take the image+video URLs from MCP, download the files locally, and
// write the visuals manifest in the shape the rest of the pipeline
// (batch cache, GHL ingest, campaign report) reads.
export async function finalizeVisuals({
  campaignId,
  slug,
  imageUrl,
  imageJobId,
  videoUrl,
  videoJobId,
  videoStatus = "succeeded",
  outputRoot = CAMPAIGN_OUTPUT_DIR,
}) {
  if (!campaignId || !slug) {
    throw new Error("finalizeVisuals requires campaignId and slug");
  }
  if (!imageUrl) {
    throw new Error("finalizeVisuals requires imageUrl");
  }

  const visualsDir = path.join(outputRoot, campaignId, "visuals");
  const briefPath = path.join(visualsDir, `${slug}_brief.json`);

  let brief;
  try {
    brief = JSON.parse(await fs.readFile(briefPath, "utf8"));
  } catch (err) {
    if (err.code === "ENOENT") {
      throw new Error(
        `No brief at ${briefPath} — run \`visuals\` to prepare the brief first.`,
      );
    }
    throw err;
  }

  // Download failures should NOT lose the URL — if we crash here, the
  // caller has to manually re-call us with the same URL or risk forgetting
  // it entirely. Record the URL in the manifest unconditionally; mark
  // local_path null if download failed (e.g. signed CloudFront URLs from a
  // restricted IP range). A later `visuals-finalize` run from a permitted
  // network can fill in the file.
  const imagePath = path.join(visualsDir, `${slug}_hero.png`);
  let imageLocalPath = imagePath;
  let imageDownloadError = null;
  try {
    await downloadTo(imageUrl, imagePath);
  } catch (err) {
    imageLocalPath = null;
    imageDownloadError = err.message;
  }

  let videoPath = null;
  let videoBundle;
  let videoDownloadError = null;
  if (videoUrl) {
    videoPath = path.join(visualsDir, `${slug}_video.mp4`);
    try {
      await downloadTo(videoUrl, videoPath);
    } catch (err) {
      videoPath = null;
      videoDownloadError = err.message;
    }
    videoBundle = {
      job_id: videoJobId || null,
      url: videoUrl,
      local_path: videoPath,
      status: videoPath ? "succeeded" : "url_only",
      ...(videoDownloadError && { download_error: videoDownloadError }),
    };
  } else if (videoJobId) {
    // Async kickoff with no URL yet — manifest tracks the pending job,
    // ingest will see local_path:null and skip until a later finalize fills it.
    videoBundle = {
      job_id: videoJobId,
      url: null,
      local_path: null,
      status: videoStatus,
    };
  } else {
    videoBundle = {
      job_id: null,
      url: null,
      local_path: null,
      status: "skipped",
    };
  }

  const manifest = {
    prospect: brief.prospect,
    campaign_id: campaignId,
    image: {
      ...brief.image,
      url: imageUrl,
      local_path: imageLocalPath,
      job_id: imageJobId || null,
      ...(imageDownloadError && { download_error: imageDownloadError }),
    },
    video: {
      ...brief.video,
      ...videoBundle,
    },
  };

  const manifestPath = path.join(visualsDir, `${slug}_visuals.json`);
  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2), "utf8");

  return { manifest_path: manifestPath, manifest };
}

// Convenience: list all briefs in a campaign that don't have a matching
// manifest yet — i.e., the set Claude Code needs to generate for.
export async function listPendingBriefs({ campaignId, outputRoot = CAMPAIGN_OUTPUT_DIR }) {
  const visualsDir = path.join(outputRoot, campaignId, "visuals");
  let files;
  try {
    files = await fs.readdir(visualsDir);
  } catch (err) {
    if (err.code === "ENOENT") return [];
    throw err;
  }

  const pending = [];
  for (const f of files) {
    if (!f.endsWith("_brief.json")) continue;
    const slug = f.replace(/_brief\.json$/, "");
    const briefPath = path.join(visualsDir, f);
    const manifestPath = path.join(visualsDir, `${slug}_visuals.json`);
    const hasManifest = await fs.stat(manifestPath).then(() => true).catch(() => false);
    if (!hasManifest) {
      const brief = JSON.parse(await fs.readFile(briefPath, "utf8"));
      pending.push({ slug, brief_path: briefPath, brief });
    }
  }
  return pending;
}

export { routeVideoModel } from "./router.js";
