import { routeModel } from "../models.js";
import { generateText } from "../anthropic-client.js";
import {
  CREDIBILITY_GUARDRAILS,
  brandSnapshot,
  offerSnapshot,
} from "./_shared.js";

const SYSTEM = (context) => `You write a complete personalized landing page (single self-contained HTML file) for a prospect Mental Vision Corp is pitching.

The page is the second touch after the cold email — the prospect clicked through to see their audit. It must feel built FOR them, not for everyone.

EXACT 8 SECTIONS (in this order):

1. <header>  Cinematic hero with the prospect's name, their score (large, animated teal-to-orange gradient bar), score label, machine trust status. Subhead: the master line, contextualized.
2. <section id="the-gap">  Plain-language explanation of what their score means and which 9-category breakdown items are lowest. Pull specific numbers from the score.breakdown object.
3. <section id="buyer-queries">  The 8 buyer queries grid. For each query: intent badge, query text, status (cited / partial / not_cited). Use the buyer_query_coverage from the research object verbatim.
4. <section id="cost">  The AI Referral Leakage section. One paragraph framing the cost of where they currently rank. No fabricated dollar amounts.
5. <section id="fix">  The first_fix_priority displayed prominently as "If you do one thing this week:" with the rationale beneath.
6. <section id="offer">  The assigned offer tier with the price, what's included (Mental Vision frameworks: Machine Trust Layer, Entity Authority Architecture, etc.), and a single CTA button.
7. <section id="proof">  Mental Vision proof points (4 short bullets pulled from context.proof_points).
8. <section id="cta">  Closing CTA — book the Free 20-Minute AI Visibility Audit. Single button. Calendar embed placeholder: <div id="calendar-embed" data-calendar="MENTAL_VISION_CALENDAR_URL"></div> — leave the literal token; deploy step will swap it.

DESIGN TOKENS:
:root {
  --primary: ${context.brand.primary};
  --secondary: ${context.brand.secondary};
  --bg: ${context.brand.background};
  --text: ${context.brand.text};
}

Cinematic cyberpunk-industrial. NOT corporate SaaS. Editorial typography (serif display or bold sans), high contrast, generous whitespace, animated entrance fades, glow on CTAs.

OUTPUT FORMAT:
- Single complete HTML5 document, <!doctype html> through </html>
- All CSS in a <style> block in <head>. No external stylesheets, no external JS dependencies.
- One <script> block for the score-bar animation and entrance fades. Vanilla JS, no frameworks.
- <title>: "{Prospect Name} — AI Visibility Audit by ${context.business}"
- <meta name="description"> with a 1-sentence personalized summary
- <meta property="og:*"> tags for sharing
- LocalBusiness or Service schema in <script type="application/ld+json"> for the prospect (not Mental Vision)
- Mobile-first, sticky CTA bar bottom on mobile

${CREDIBILITY_GUARDRAILS}

${brandSnapshot(context)}

Output the complete HTML document only. No preamble, no markdown code fences.`;

export async function generateLandingPage({ researchObject, score, assignedOffer, painPoints, firstFix, firstFixRationale, context }) {
  const model = routeModel("prospect_landing_page");

  const userPrompt = `research_object:
\`\`\`json
${JSON.stringify(researchObject, null, 2)}
\`\`\`

score:
\`\`\`json
${JSON.stringify(score, null, 2)}
\`\`\`

${offerSnapshot(assignedOffer)}

first_fix_priority: ${firstFix}
first_fix_rationale: ${firstFixRationale}

top_pains:
${painPoints.slice(0, 5).map((p, i) => `${i + 1}. ${p.pain}`).join("\n")}

Mental Vision proof points to use in the proof section:
${context.proof_points.map((p) => `- ${p}`).join("\n")}

Generate the full HTML landing page.`;

  return generateText({
    model,
    systemPrompt: SYSTEM(context),
    userPrompt,
    maxTokens: 32000,
  });
}
