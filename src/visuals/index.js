import fs from "node:fs/promises";
import path from "node:path";
import { routeVideoModel } from "./router.js";
import { buildImagePrompt, buildVideoPrompt } from "./prompts.js";
import {
  generateImage,
  kickoffVideo,
  pollJob,
  generateVideoSync,
} from "./higgsfield-client.js";

const CAMPAIGN_OUTPUT_DIR = "output/campaigns";

function slugify(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

async function downloadTo(url, destPath) {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to download ${url}: ${res.status}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  await fs.mkdir(path.dirname(destPath), { recursive: true });
  await fs.writeFile(destPath, buf);
  return destPath;
}

export async function generateVisualsForProspect({
  session1Result,
  campaignId,
  videoIntent = "cinematic_hero",
  videoMode = "sync",
}) {
  const slug = slugify(session1Result.research_object.company_name);
  const visualsDir = path.join(CAMPAIGN_OUTPUT_DIR, campaignId, "visuals");
  await fs.mkdir(visualsDir, { recursive: true });

  const [imageSpec, videoSpec] = await Promise.all([
    buildImagePrompt({ session1Result }),
    buildVideoPrompt({ session1Result, intent: videoIntent }),
  ]);

  const routing = await routeVideoModel({
    prompt: videoSpec.prompt,
    intent: videoIntent,
  });

  const imageResult = await generateImage({
    model: "nano_banana_2",
    prompt: imageSpec.prompt,
    negative_prompt: imageSpec.negative_prompt,
    aspect_ratio: "16:9",
  });
  const imagePath = path.join(visualsDir, `${slug}_hero.png`);
  await downloadTo(imageResult.url, imagePath);

  const videoParams = {
    model: routing.model,
    prompt: videoSpec.prompt,
    camera_motion: videoSpec.camera_motion,
    duration_sec: videoSpec.duration_sec,
    aspect_ratio: videoSpec.aspect_ratio,
  };

  let videoBundle;
  if (videoMode === "async") {
    const kicked = await kickoffVideo(videoParams);
    videoBundle = {
      job_id: kicked.job_id,
      status: kicked.status,
      url: null,
      local_path: null,
    };
  } else {
    const synced = await generateVideoSync(videoParams);
    const videoPath = path.join(visualsDir, `${slug}_video.mp4`);
    await downloadTo(synced.url, videoPath);
    videoBundle = {
      job_id: synced.job_id,
      status: "succeeded",
      url: synced.url,
      local_path: videoPath,
    };
  }

  const manifest = {
    prospect: session1Result.research_object.company_name,
    campaign_id: campaignId,
    image: {
      model: "nano_banana_2",
      prompt: imageSpec.prompt,
      negative_prompt: imageSpec.negative_prompt,
      style_tags: imageSpec.style_tags,
      url: imageResult.url,
      local_path: imagePath,
      job_id: imageResult.job_id,
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
      ...videoBundle,
    },
  };

  // IMPORTANT: this filename must match the path the batch loader and GHL
  // ingest read from — both expect `${slug}_visuals.json` under visuals/.
  // Changing one without the other silently breaks visuals -> GHL linking.
  const manifestPath = path.join(visualsDir, `${slug}_visuals.json`);
  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2), "utf8");

  return {
    manifest_path: manifestPath,
    manifest,
    bundle_addendum: {
      visual_asset_url: imageResult.url,
      ugc_video_job_id: videoBundle.job_id,
      ugc_video_url: videoBundle.url,
    },
  };
}

export async function pollPendingVideo({ jobId, intervalMs, timeoutMs }) {
  return pollJob(jobId, { kind: "video", intervalMs, timeoutMs });
}

export { routeVideoModel } from "./router.js";
