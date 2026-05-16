import fs from "node:fs/promises";
import path from "node:path";

import { MENTAL_VISION_CONTEXT } from "../context.js";
import { generateEntityBrief } from "./entity-brief.js";
import { generateBuyerJourneyMap } from "./buyer-journey.js";
import { generateEmailCopy } from "./email.js";
import { generateLandingPage } from "./landing-page.js";
import { generateMetaAdCopy } from "./meta-ads.js";
import { generateSocialPosts } from "./social-posts.js";

// Slugify a company name for filenames.
function slugify(s) {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

// Consume a Session 1 result file and run all 6 content generators in parallel.
// Writes outputs into the campaign directory in the brief's specified layout.
export async function generateContentForProspect({
  session1Result,
  campaignId,
  outputRoot = "output/campaigns",
  context = MENTAL_VISION_CONTEXT,
}) {
  if (!session1Result.content_eligible) {
    return {
      skipped: true,
      reason: `research_status=${session1Result.research_status} confidence=${session1Result.confidence}`,
    };
  }

  const {
    research_object: researchObject,
    score,
    assigned_offer: assignedOffer,
    pain_points: painPoints,
    first_fix_priority: firstFix,
    first_fix_rationale: firstFixRationale,
  } = session1Result;

  const args = {
    researchObject,
    score,
    assignedOffer,
    painPoints,
    firstFix,
    firstFixRationale,
    context,
  };

  // Six independent generators — parallelize.
  const [
    entityBrief,
    buyerJourney,
    email,
    landingPage,
    metaAds,
    socialPosts,
  ] = await Promise.all([
    generateEntityBrief(args),
    generateBuyerJourneyMap(args),
    generateEmailCopy(args),
    generateLandingPage(args),
    generateMetaAdCopy(args),
    generateSocialPosts(args),
  ]);

  // Write outputs in the brief's layout.
  const slug = slugify(researchObject.company_name);
  const campaignDir = path.join(outputRoot, campaignId);

  const paths = {
    entity_brief: path.join(campaignDir, "entity_briefs", `${slug}_entity.md`),
    buyer_journey: path.join(campaignDir, "buyer_journeys", `${slug}_journey.json`),
    email: path.join(campaignDir, "emails", `${slug}_email.json`),
    landing_page: path.join(campaignDir, "landing_pages", `${slug}.html`),
    meta_copy: path.join(campaignDir, "meta_copy", `${slug}_meta.json`),
    social_posts: path.join(campaignDir, "social_posts", `${slug}_social.json`),
  };

  for (const p of Object.values(paths)) {
    await fs.mkdir(path.dirname(p), { recursive: true });
  }

  await Promise.all([
    fs.writeFile(paths.entity_brief, entityBrief.text, "utf8"),
    fs.writeFile(paths.buyer_journey, JSON.stringify(buyerJourney.data, null, 2), "utf8"),
    fs.writeFile(paths.email, JSON.stringify(email.data, null, 2), "utf8"),
    fs.writeFile(paths.landing_page, landingPage.text, "utf8"),
    fs.writeFile(paths.meta_copy, JSON.stringify(metaAds.data, null, 2), "utf8"),
    fs.writeFile(paths.social_posts, JSON.stringify(socialPosts.data, null, 2), "utf8"),
  ]);

  // Landing page URL stays null until a deploy step runs (Session 2 deferred).
  const contentBundle = {
    campaign_id: campaignId,
    prospect_slug: slug,
    landing_page_local_path: paths.landing_page,
    landing_page_url: null,
    visual_asset_url: null,
    ugc_video_job_id: null,
    ugc_video_url: null,
    selected_email_angle: email.data.recommended_angle,
    selected_email_subject: email.data.variants.find(
      (v) => v.angle === email.data.recommended_angle,
    )?.subject,
    selected_email_body: email.data.variants.find(
      (v) => v.angle === email.data.recommended_angle,
    )?.body,
    paths,
    usage: {
      entity_brief: entityBrief.usage,
      buyer_journey: buyerJourney.usage,
      email: email.usage,
      landing_page: landingPage.usage,
      meta_ads: metaAds.usage,
      social_posts: socialPosts.usage,
    },
  };

  const bundlePath = path.join(campaignDir, "content_bundles", `${slug}_bundle.json`);
  await fs.mkdir(path.dirname(bundlePath), { recursive: true });
  await fs.writeFile(bundlePath, JSON.stringify(contentBundle, null, 2), "utf8");

  return {
    skipped: false,
    bundle_path: bundlePath,
    bundle: contentBundle,
  };
}
