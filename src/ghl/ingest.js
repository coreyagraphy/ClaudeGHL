import fs from "node:fs/promises";
import path from "node:path";

import {
  upsertContact,
  addContactTags,
  createOpportunity,
  addContactToWorkflow,
} from "./client.js";
import {
  buildContactPayload,
  buildOpportunityPayload,
  selectWorkflowId,
  bandFromScore,
} from "./field-map.js";
import { loadGHLConfig } from "./config.js";

// Try to read a JSON file, returning null if absent.
async function readJSONIfExists(p) {
  try {
    const text = await fs.readFile(p, "utf8");
    return JSON.parse(text);
  } catch (err) {
    if (err.code === "ENOENT") return null;
    throw err;
  }
}

// Locate the three artifact files for one prospect in a campaign.
async function loadProspectArtifacts({ campaignId, slug, outputRoot = "output/campaigns" }) {
  const dir = path.join(outputRoot, campaignId);

  const researchPath = path.join(dir, "research", `${slug}.json`);
  const research = await readJSONIfExists(researchPath);
  if (!research) {
    throw new Error(
      `No research file at ${researchPath}. Run: node src/index.js research --company "..." (or 'prospect' for end-to-end)`,
    );
  }

  const bundlePath = path.join(dir, "content_bundles", `${slug}_bundle.json`);
  const contentBundle = await readJSONIfExists(bundlePath);

  const visualsPath = path.join(dir, "visuals", `${slug}_visuals.json`);
  const visualsManifest = await readJSONIfExists(visualsPath);

  return { research, contentBundle, visualsManifest, paths: { researchPath, bundlePath, visualsPath } };
}

// Orchestrate a single-prospect GHL ingestion.
// dryRun=true returns the planned actions + payloads WITHOUT touching GHL.
export async function ingestProspect({ campaignId, slug, dryRun = true, outputRoot = "output/campaigns" }) {
  const { research, contentBundle, visualsManifest, paths } = await loadProspectArtifacts({
    campaignId,
    slug,
    outputRoot,
  });

  const config = loadGHLConfig();
  const contactPayload = buildContactPayload({
    research,
    score: research.score,
    assignedOffer: research.assigned_offer,
    painPoints: research.pain_points,
    firstFix: research.first_fix_priority,
    firstFixRationale: research.first_fix_rationale,
    contentBundle,
    visualsManifest,
    campaignId,
  });

  const workflowId = selectWorkflowId({ score: research.score, workflows: config.workflows });
  const band = bandFromScore(research.score.total);

  // Build the planned action list — for dry-run output and as the execution
  // contract for live mode.
  const plan = {
    campaign_id: campaignId,
    prospect_slug: slug,
    company: research.research_object?.company_name,
    score: research.score.total,
    tier: band.tier,
    artifacts_loaded: {
      research: !!research,
      content_bundle: !!contentBundle,
      visuals_manifest: !!visualsManifest,
    },
    artifact_paths: paths,
    actions: [
      { kind: "upsert_contact", payload: contactPayload },
      {
        kind: "create_opportunity",
        payload_preview: {
          name: `${research.research_object.company_name} — ${research.assigned_offer?.name || band.label}`,
          tier: band.tier,
          monetary_value: research.assigned_offer?.price || research.assigned_offer?.price_monthly || null,
          pipeline_id: config.pipelineId || "(set GHL_PIPELINE_ID)",
          pipeline_stage_id: config.stages?.[band.tier] || `(set GHL_STAGE_${band.tier.toUpperCase()})`,
        },
      },
      {
        kind: "add_to_workflow",
        workflow_id: workflowId || `(set GHL_WORKFLOW_${band.tier.toUpperCase()} or _DEFAULT)`,
      },
    ],
  };

  if (dryRun) {
    return { mode: "dry-run", plan, executed: null };
  }

  // --- LIVE EXECUTION ---
  // Each step is sequential because step N+1 needs the contact ID from step 1.
  const executed = {};

  const contactRes = await upsertContact(contactPayload);
  const contactId = contactRes?.contact?.id || contactRes?.id;
  if (!contactId) {
    throw new Error(`upsertContact returned no contact id: ${JSON.stringify(contactRes)}`);
  }
  executed.contact = { id: contactId, raw: contactRes };

  // Tags are part of upsert payload but we re-apply explicitly in case the
  // upsert path doesn't merge (varies by GHL plan/version).
  if (contactPayload.tags?.length) {
    try {
      await addContactTags(contactId, contactPayload.tags);
      executed.tags_applied = contactPayload.tags;
    } catch (err) {
      executed.tags_error = err.message;
    }
  }

  if (config.pipelineId && config.stages?.[band.tier]) {
    const oppPayload = buildOpportunityPayload({
      contactId,
      research,
      score: research.score,
      assignedOffer: research.assigned_offer,
      campaignId,
      pipelineConfig: config,
    });
    const oppRes = await createOpportunity(oppPayload);
    executed.opportunity = oppRes;
  } else {
    executed.opportunity_skipped = "GHL_PIPELINE_ID or stage IDs not configured";
  }

  if (workflowId) {
    const wfRes = await addContactToWorkflow(contactId, workflowId);
    executed.workflow = { id: workflowId, raw: wfRes };
  } else {
    executed.workflow_skipped = `No workflow configured for tier=${band.tier}`;
  }

  return { mode: "live", plan, executed };
}
