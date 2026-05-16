import { generateJSON } from "../anthropic-client.js";
import { MODELS } from "../models.js";

// Model IDs MUST match Higgsfield's catalog (verify with the MCP tool
// `models_explore` action=list type=video). Earlier versions of this file
// used invented IDs like "higgsfield_studio_video" and "kling_3_0" that
// don't exist — generations would fail at the MCP boundary.
export const VIDEO_MODELS = {
  cinematic_studio_3_0: "cinematic_studio_3_0",
  kling3_0: "kling3_0",
  seedance_2_0: "seedance_2_0",
};

export const VIDEO_INTENTS = ["cinematic_hero", "social_ugc", "talking_head"];

const INTENT_TO_MODEL = {
  cinematic_hero: VIDEO_MODELS.cinematic_studio_3_0,
  social_ugc: VIDEO_MODELS.seedance_2_0,
  talking_head: VIDEO_MODELS.kling3_0,
};

const KEYWORD_SIGNALS = {
  [VIDEO_MODELS.seedance_2_0]: [
    /\bugc\b/i,
    /selfie/i,
    /phone shot/i,
    /tiktok/i,
    /vertical social/i,
    /meta ad creative/i,
    /casual/i,
  ],
  [VIDEO_MODELS.kling3_0]: [
    /talking head/i,
    /\bfounder\s+(speaks|says|talks)/i,
    /interview/i,
    /testimonial/i,
    /lip[\s-]?sync/i,
    /\bperson\b.*\bspeak/i,
  ],
  [VIDEO_MODELS.cinematic_studio_3_0]: [
    /cinematic/i,
    /tracking shot/i,
    /dolly/i,
    /\bpan\b/i,
    /establishing shot/i,
    /aerial/i,
    /camera moves?/i,
    /hero shot/i,
  ],
};

const ROUTER_SCHEMA = {
  type: "object",
  properties: {
    chosen_model: {
      type: "string",
      enum: Object.values(VIDEO_MODELS),
    },
    rationale: { type: "string" },
    confidence: { type: "integer", minimum: 0, maximum: 100 },
  },
  required: ["chosen_model", "rationale", "confidence"],
  additionalProperties: false,
};

const ROUTER_SYSTEM_PROMPT = `You are a video model routing agent. Choose ONE of three video models based on the prompt's needs.

cinematic_studio_3_0 — Higgsfield's flagship Cinema Studio model. Best for: cinematic camera motion (dolly/pan/tracking/aerial), branded hero shots, establishing shots, atmospheric brand-mood pieces, cyberpunk/industrial aesthetics. Default when ambiguous.

kling3_0 — Best for: photorealistic humans, talking heads, founder testimonials, lip sync, complex physics, long takes (8s+). Strongest at realistic people.

seedance_2_0 — Best for: UGC/TikTok aesthetic, short vertical 9:16 social ads, "for-you-page" energy, fast iteration, casual selfie-style. Use ONLY when prompt is explicitly social/UGC.

Output ONLY the JSON object. Bias toward cinematic_studio_3_0 unless the prompt clearly signals UGC or a talking head.`;

function matchByKeyword(prompt) {
  const scores = {};
  for (const [model, patterns] of Object.entries(KEYWORD_SIGNALS)) {
    scores[model] = patterns.reduce((n, re) => n + (re.test(prompt) ? 1 : 0), 0);
  }
  const winner = Object.entries(scores).sort((a, b) => b[1] - a[1])[0];
  return { model: winner[0], hits: winner[1], scores };
}

export async function routeVideoModel({ prompt, intent }) {
  if (intent && INTENT_TO_MODEL[intent]) {
    return {
      model: INTENT_TO_MODEL[intent],
      rationale: `Explicit intent: ${intent}`,
      classifier: "explicit",
      confidence: 100,
    };
  }

  const auto = await generateJSON({
    model: MODELS.haiku,
    systemPrompt: ROUTER_SYSTEM_PROMPT,
    userPrompt: `Prompt to classify:\n\n${prompt}\n\nReturn the chosen_model, a one-sentence rationale, and a confidence score 0-100.`,
    schema: ROUTER_SCHEMA,
  });
  return {
    model: auto.data.chosen_model,
    rationale: auto.data.rationale,
    confidence: auto.data.confidence,
    classifier: "haiku-auto",
  };
}

export function routeVideoModelSync({ prompt, intent }) {
  if (intent && INTENT_TO_MODEL[intent]) {
    return {
      model: INTENT_TO_MODEL[intent],
      rationale: `Explicit intent: ${intent}`,
      classifier: "explicit",
      confidence: 100,
    };
  }
  const kw = matchByKeyword(prompt);
  if (kw.hits >= 2) {
    return {
      model: kw.model,
      rationale: `Keyword signals (${kw.hits} hits) for ${kw.model}`,
      classifier: "keyword",
      confidence: 70,
    };
  }
  return {
    model: VIDEO_MODELS.cinematic_studio_3_0,
    rationale: "No clear signal; defaulting to Cinema Studio 3.0",
    classifier: "default",
    confidence: 40,
  };
}
