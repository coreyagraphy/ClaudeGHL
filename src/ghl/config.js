// GHL location-specific config: pipeline/stage IDs and workflow IDs.
// In production these are looked up once via getPipelines() and persisted to
// a JSON file. For now we read from env vars (or a JSON file pointed to by
// GHL_CONFIG_FILE) so the ingestion code stays portable.

import fs from "node:fs";

let cached;

export function loadGHLConfig() {
  if (cached) return cached;

  const file = process.env.GHL_CONFIG_FILE;
  if (file && fs.existsSync(file)) {
    cached = JSON.parse(fs.readFileSync(file, "utf8"));
    return cached;
  }

  cached = {
    pipelineId: process.env.GHL_PIPELINE_ID || null,
    stages: {
      sprint: process.env.GHL_STAGE_SPRINT || null,
      stay_found: process.env.GHL_STAGE_STAY_FOUND || null,
      foundation: process.env.GHL_STAGE_FOUNDATION || null,
    },
    workflows: {
      sprint: process.env.GHL_WORKFLOW_SPRINT || null,
      stay_found: process.env.GHL_WORKFLOW_STAY_FOUND || null,
      foundation: process.env.GHL_WORKFLOW_FOUNDATION || null,
      default: process.env.GHL_WORKFLOW_DEFAULT || null,
    },
  };
  return cached;
}
