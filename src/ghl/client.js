// GHL LeadConnector v2 HTTP client.
// Docs: https://highlevel.stoplight.io/docs/integrations/
// Auth: Bearer token (PIT or Location Access Token) + Version header.

const BASE_URL = "https://services.leadconnectorhq.com";
const API_VERSION = "2021-07-28";

class GHLError extends Error {
  constructor(status, body, requestPath) {
    super(`GHL ${status} on ${requestPath}: ${typeof body === "string" ? body : JSON.stringify(body)}`);
    this.status = status;
    this.body = body;
    this.requestPath = requestPath;
  }
}

function getAuth() {
  const token = process.env.GHL_API_KEY;
  const locationId = process.env.GHL_LOCATION_ID;
  if (!token) {
    throw new Error("GHL_API_KEY not set (Private Integration Token or Location Access Token).");
  }
  if (!locationId) {
    throw new Error("GHL_LOCATION_ID not set.");
  }
  return { token, locationId };
}

async function request({ method, path: reqPath, body, query }) {
  const { token } = getAuth();
  const url = new URL(BASE_URL + reqPath);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    }
  }

  const headers = {
    Authorization: `Bearer ${token}`,
    Version: API_VERSION,
    Accept: "application/json",
  };
  if (body !== undefined) headers["Content-Type"] = "application/json";

  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
      const text = await res.text();
      let parsed = text;
      try {
        parsed = text ? JSON.parse(text) : null;
      } catch {
        // leave as text
      }
      if (!res.ok) {
        // Retry on 429 + 5xx; fail fast on 4xx
        if (res.status === 429 || res.status >= 500) {
          lastErr = new GHLError(res.status, parsed, reqPath);
          await sleep(1000 * 2 ** attempt);
          continue;
        }
        throw new GHLError(res.status, parsed, reqPath);
      }
      return parsed;
    } catch (err) {
      if (err instanceof GHLError) throw err;
      lastErr = err;
      await sleep(1000 * 2 ** attempt);
    }
  }
  throw lastErr;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

export async function upsertContact(payload) {
  const { locationId } = getAuth();
  return request({
    method: "POST",
    path: "/contacts/upsert",
    body: { ...payload, locationId },
  });
}

export async function addContactTags(contactId, tags) {
  return request({
    method: "POST",
    path: `/contacts/${contactId}/tags`,
    body: { tags },
  });
}

export async function createOpportunity(payload) {
  const { locationId } = getAuth();
  return request({
    method: "POST",
    path: "/opportunities/",
    body: { ...payload, locationId },
  });
}

export async function addContactToWorkflow(contactId, workflowId) {
  return request({
    method: "POST",
    path: `/contacts/${contactId}/workflow/${workflowId}`,
  });
}

export async function getPipelines() {
  const { locationId } = getAuth();
  return request({
    method: "GET",
    path: "/opportunities/pipelines",
    query: { locationId },
  });
}

export { GHLError };
