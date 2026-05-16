import { generateJSON } from "../anthropic-client.js";
import { MODELS } from "../models.js";
import { brandSnapshot } from "../content/_shared.js";
import { MENTAL_VISION_CONTEXT } from "../context.js";

const IMAGE_PROMPT_SCHEMA = {
  type: "object",
  properties: {
    prompt: { type: "string" },
    negative_prompt: { type: "string" },
    style_tags: { type: "array", items: { type: "string" } },
  },
  required: ["prompt", "negative_prompt", "style_tags"],
  additionalProperties: false,
};

const VIDEO_PROMPT_SCHEMA = {
  type: "object",
  properties: {
    prompt: { type: "string" },
    camera_motion: { type: "string" },
    duration_sec: { type: "integer", minimum: 3, maximum: 10 },
    aspect_ratio: { type: "string", enum: ["9:16", "16:9", "1:1"] },
    style_tags: { type: "array", items: { type: "string" } },
  },
  required: ["prompt", "camera_motion", "duration_sec", "aspect_ratio", "style_tags"],
  additionalProperties: false,
};

const IMAGE_SYSTEM_PROMPT = `You are a visual director generating an image prompt for a prospect's AI visibility audit deliverable.

The image is the hero visual for the prospect's personalized landing page. It must:
- Evoke the Mental Vision brand: cinematic, cyberpunk-industrial, dark with neon accents
- Reference the prospect's actual business (not generic stock imagery)
- Feel like a still from a high-end documentary, NOT a SaaS marketing graphic
- Avoid: stock-photo people, generic office shots, abstract gradient backgrounds, corporate handshakes, "team smiling at laptop"

Output a single image prompt suitable for nano_banana_2 (Higgsfield's flagship image model).`;

const VIDEO_SYSTEM_PROMPT = ({ intent }) => `You are a visual director generating a video prompt for a prospect's AI visibility audit deliverable.

INTENT: ${intent}

Intent definitions:
- cinematic_hero: branded establishing motion piece for landing page hero. Cinematic camera move, atmospheric, no human dialogue. 5-8 seconds, 16:9 or 9:16.
- social_ugc: Meta ads creative, vertical 9:16, UGC/phone-shot aesthetic, fast cuts feel, 3-6 seconds.
- talking_head: founder or representative speaking to camera, photorealistic human, 6-10 seconds, 9:16 or 16:9.

The video should:
- Evoke the Mental Vision brand: cinematic, cyberpunk-industrial
- Reference the prospect's actual business context (location, niche)
- For cinematic_hero: prioritize camera motion language (dolly, tracking, pan, push-in)
- For social_ugc: prioritize "phone selfie", "casual", "vertical", "TikTok energy"
- For talking_head: describe the person and setting in photoreal detail, keep dialogue brief

Output ONLY the JSON object.`;

export async function buildImagePrompt({ session1Result }) {
  const context = MENTAL_VISION_CONTEXT;
  const research = session1Result.research_object;
  const brand = brandSnapshot(context);

  const user = `PROSPECT:
- Business: ${research.company_name}
- Niche: ${research.niche}
- Location: ${research.city}, ${research.state}
- Owner: ${research.owner_first || "unknown"}
- Score: ${session1Result.score.total}/100 (${session1Result.score.label})
- First-fix priority: ${session1Result.first_fix_priority}

PAIN POINTS:
${session1Result.pain_points.slice(0, 3).map((p) => `- ${p}`).join("\n")}

${brand}

Generate an image prompt that visualizes this prospect's specific situation in the Mental Vision aesthetic.`;

  const { data } = await generateJSON({
    model: MODELS.haiku,
    systemPrompt: IMAGE_SYSTEM_PROMPT,
    userPrompt: user,
    schema: IMAGE_PROMPT_SCHEMA,
  });
  return data;
}

export async function buildVideoPrompt({ session1Result, intent = "cinematic_hero" }) {
  const context = MENTAL_VISION_CONTEXT;
  const research = session1Result.research_object;
  const brand = brandSnapshot(context);

  const user = `PROSPECT:
- Business: ${research.company_name}
- Niche: ${research.niche}
- Location: ${research.city}, ${research.state}
- Owner: ${research.owner_first || "unknown"}
- Score: ${session1Result.score.total}/100 (${session1Result.score.label})

${brand}

Generate a video prompt for intent=${intent} that visualizes this prospect's specific situation.`;

  const { data } = await generateJSON({
    model: MODELS.haiku,
    systemPrompt: VIDEO_SYSTEM_PROMPT({ intent }),
    userPrompt: user,
    schema: VIDEO_PROMPT_SCHEMA,
  });
  return data;
}
