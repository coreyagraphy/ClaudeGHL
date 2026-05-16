const HIGGSFIELD_BASE_URL =
  process.env.HIGGSFIELD_BASE_URL || "https://api.higgsfield.ai/v1";

const DEFAULT_POLL_INTERVAL_MS = 5000;
const DEFAULT_POLL_TIMEOUT_MS = 10 * 60 * 1000;

function authHeaders() {
  const key = process.env.HIGGSFIELD_API_KEY;
  if (!key) {
    throw new Error(
      "HIGGSFIELD_API_KEY is not set. Add it to .env to generate visuals.",
    );
  }
  return {
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
  };
}

async function postJson(path, body) {
  const res = await fetch(`${HIGGSFIELD_BASE_URL}${path}`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(
      `Higgsfield POST ${path} failed: ${res.status} ${res.statusText}\n${text.slice(0, 500)}`,
    );
  }
  return res.json();
}

async function getJson(path) {
  const res = await fetch(`${HIGGSFIELD_BASE_URL}${path}`, {
    method: "GET",
    headers: authHeaders(),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(
      `Higgsfield GET ${path} failed: ${res.status} ${res.statusText}\n${text.slice(0, 500)}`,
    );
  }
  return res.json();
}

export async function generateImage({ model = "nano_banana_2", prompt, negative_prompt, aspect_ratio = "16:9" }) {
  const job = await postJson("/generations/image", {
    model,
    prompt,
    negative_prompt,
    aspect_ratio,
  });
  if (job.status === "succeeded" && job.result?.url) {
    return { job_id: job.id, url: job.result.url, model };
  }
  const final = await pollJob(job.id, { kind: "image" });
  return { job_id: job.id, url: final.url, model };
}

export async function kickoffVideo({ model, prompt, camera_motion, duration_sec, aspect_ratio }) {
  const job = await postJson("/generations/video", {
    model,
    prompt,
    camera_motion,
    duration_sec,
    aspect_ratio,
  });
  return { job_id: job.id, status: job.status, model };
}

export async function pollJob(jobId, {
  kind = "video",
  intervalMs = DEFAULT_POLL_INTERVAL_MS,
  timeoutMs = DEFAULT_POLL_TIMEOUT_MS,
  onTick,
} = {}) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const status = await getJson(`/generations/${kind}/${jobId}`);
    if (onTick) onTick(status);
    if (status.status === "succeeded") {
      if (!status.result?.url) {
        throw new Error(`Higgsfield job ${jobId} succeeded but result.url missing`);
      }
      return { url: status.result.url, raw: status };
    }
    if (status.status === "failed") {
      throw new Error(
        `Higgsfield job ${jobId} failed: ${status.error?.message || "no error message"}`,
      );
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`Higgsfield job ${jobId} timed out after ${timeoutMs}ms`);
}

export async function generateVideoSync(params) {
  const { job_id, model } = await kickoffVideo(params);
  const final = await pollJob(job_id, { kind: "video" });
  return { job_id, url: final.url, model };
}
