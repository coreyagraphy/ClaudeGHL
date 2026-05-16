import { routeModel } from "../models.js";
import { generateText } from "../anthropic-client.js";

const SYSTEM = `You are a senior conversion copywriter and brand designer producing a complete Vibe Coder website builder prompt for GoHighLevel.

Your output is the FINAL prompt that the user will paste directly into GHL's Vibe Coder. It must be:
- Operationally ready, copy-paste with zero additional editing
- Concrete (specific sections, copy, design tokens, schema requirements)
- Faithful to the brand context provided (cinematic cyberpunk-industrial, NOT corporate SaaS)
- Structured so GHL's Vibe Coder can build it correctly in one pass

Do NOT include any preamble, meta-commentary, or "here is the prompt" framing. Output only the prompt body.`;

export async function generateWebsitePrompt(context) {
  const model = routeModel("ghl_website_prompt");

  const userPrompt = `Generate a complete Vibe Coder website builder prompt for ${context.business}.

BRAND: ${context.brand.style} Primary ${context.brand.primary}. Secondary ${context.brand.secondary}. Background ${context.brand.background}. Text ${context.brand.text}. Typography: ${context.brand.typography}. Motion: ${context.brand.motion}.

MASTER LINE: "${context.master_line}"

PRIMARY OFFER: ${context.primary_offer}. CTA "${context.cta}" appears in every section.

SITE ARCHITECTURE:
- Home (hero + score bar animation + 3 buckets framework: ${context.frameworks.three_buckets.join(" / ")} + proof + CTA)
- Services (${context.services.join(" / ")})
- How It Works (3-step: Audit → Build → Dominate)
- Proof (${context.proof_points.slice(0, 4).join("; ")})
- Pricing:
  - ${context.tiers.diagnostic.name} $${context.tiers.diagnostic.price} (${context.tiers.diagnostic.notes})
  - ${context.tiers.sprint.name} $${context.tiers.sprint.price}
  - ${context.tiers.stay_found.name} $${context.tiers.stay_found.price_monthly}/mo (or $${context.tiers.stay_found.price_90day}/mo for first 90 days)
  - ${context.tiers.foundation.name} $${context.tiers.foundation.price}
- Book Audit (embedded calendar + intake form)
- About ${context.owner} (visual storyteller, AI pioneer, not a marketer)

SEO REQUIREMENTS:
- LocalBusiness schema on homepage
- Service pages targeting: AI visibility ${context.location.split(",")[0]}, AEO agency ${context.location.split(",")[0]}, local business AI search
- H1/H2 structure optimized for local commercial intent
- Internal linking across all service pages and the booking page
- Meta descriptions under 160 characters per page
- Mobile-first, sticky CTA bar on mobile with "${context.cta}" button

FORMS COLLECT: Name, business name, website, phone, email, primary service needed, city, how they heard about ${context.business}.

DESIGN RULES:
- Score bar animation (teal-to-orange gradient fill on load)
- Glow pulse effects on CTA buttons
- Cinematic section transitions (opacity fade, stagger entrance)
- NO stock photography — AI-generated cinematic imagery or none
- Luna chat widget embedded bottom-right on all pages

PRIMARY HOOK to weave through copy: ${context.frameworks.primary_hook}
METAPHOR available: ${context.frameworks.metaphor}

Generate the complete Vibe Coder prompt now. Structured, specific, copy-paste ready.`;

  return generateText({
    model,
    systemPrompt: SYSTEM,
    userPrompt,
    maxTokens: 16000,
  });
}
