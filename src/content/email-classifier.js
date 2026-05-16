import { routeModel } from "../models.js";
import { generateJSON } from "../anthropic-client.js";
import { brandSnapshot } from "./_shared.js";

const SYSTEM = (context) => `You are an outbound email reviewer for Mental Vision Corp. Given a prospect's research and four cold email variants written by another writer, pick the one most likely to get a reply.

You are NOT the writer. You don't rewrite. You judge.

Pick on these criteria, in priority order:
1. Specificity — does the body cite a real, verifiable fact from the prospect's research (not a generic line that could apply to anyone)?
2. Pain match — does the angle match what's actually broken for this prospect (look at first_fix_priority and the top pain), not just what their score band defaults to?
3. Owner respect — uses the owner's first name naturally; doesn't sound templated.
4. Voice fit — direct, peer-level, no SaaS cliches, no emoji, no exclamation marks.
5. CTA clarity — Free 20-Minute AI Visibility Audit, low-friction calendar ask.

If two variants are close, prefer the one whose angle matches the actual pain over the one whose angle matches the score band. The writer was instructed to default to score band — your job is to override when the pain disagrees.

Return your pick, a 1-2 sentence rationale (concrete reference to which line clinched it), and a confidence score 0-100.

${brandSnapshot(context)}`;

const SCHEMA = {
  type: "object",
  properties: {
    chosen_angle: {
      type: "string",
      enum: [
        "invisible_urgency",
        "thin_cost_of_inaction",
        "building_partial_visibility",
        "strong_ceiling_and_competitor",
      ],
    },
    rationale: { type: "string" },
    confidence: { type: "integer", minimum: 0, maximum: 100 },
    agreed_with_writer: { type: "boolean" },
  },
  required: ["chosen_angle", "rationale", "confidence", "agreed_with_writer"],
  additionalProperties: false,
};

export async function classifyEmailAngle({
  researchObject,
  score,
  painPoints,
  firstFix,
  emailResult,
  context,
}) {
  const model = routeModel("dedup_check"); // Haiku — fast, structured judgment
  const writerPick = emailResult.recommended_angle;

  const variantsForReview = emailResult.variants.map((v) => ({
    angle: v.angle,
    subject: v.subject,
    hook: v.hook,
    body: v.body,
  }));

  const userPrompt = `Prospect snapshot:
- Company: ${researchObject.company_name}
- Owner: ${researchObject.owner_first || "(unknown)"}
- Domain: ${researchObject.domain}
- Score: ${score.total}/100 (${score.label})
- First fix priority: ${firstFix}
- Top pains: ${(painPoints || []).slice(0, 3).map((p) => (typeof p === "string" ? p : p.pain || p.headline)).join(" | ")}
- AI bots blocked: ${researchObject.ai_bots_blocked}
- Email source: ${researchObject.email_source}

Writer's own recommendation: ${writerPick}

Variants under review:
${JSON.stringify(variantsForReview, null, 2)}

Pick the strongest. Set agreed_with_writer based on whether your pick matches the writer's recommendation.`;

  const result = await generateJSON({
    model,
    systemPrompt: SYSTEM(context),
    userPrompt,
    schema: SCHEMA,
    maxTokens: 1200,
  });

  return {
    ...result.data,
    writer_pick: writerPick,
    usage: result.usage,
    model: result.model,
  };
}
