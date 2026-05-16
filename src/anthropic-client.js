import Anthropic from "@anthropic-ai/sdk";
import { spawn } from "node:child_process";
import os from "node:os";

let client;

function getBackend() {
  const explicit = process.env.LLM_BACKEND;
  if (explicit === "claude-cli" || explicit === "api") return explicit;
  return process.env.ANTHROPIC_API_KEY ? "api" : "claude-cli";
}

export { getBackend };

export function getClient() {
  if (!client) {
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new Error(
        "ANTHROPIC_API_KEY is not set. Copy .env.example to .env and fill it in, or set LLM_BACKEND=claude-cli to use the Claude Code subscription.",
      );
    }
    client = new Anthropic();
  }
  return client;
}

// ---------- CLI backend (uses Claude Code subscription via OAuth) ----------

function thinkingToEffort(thinking) {
  if (!thinking || thinking.type !== "enabled") return null;
  const budget = thinking.budget_tokens || 0;
  if (budget >= 24000) return "xhigh";
  if (budget >= 12000) return "high";
  if (budget >= 6000) return "medium";
  return "low";
}

function normalizeModel(model) {
  return (model || "").replace(/\[\dm\]$/i, "");
}

function runClaudeCli({ args, stdin, timeoutMs = 600000 }) {
  return new Promise((resolve, reject) => {
    const child = spawn("claude", args, {
      stdio: ["pipe", "pipe", "pipe"],
      env: process.env,
      cwd: os.tmpdir(),
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, timeoutMs);

    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (timedOut) {
        return reject(new Error(`claude CLI timed out after ${timeoutMs}ms`));
      }
      if (code !== 0) {
        return reject(
          new Error(`claude CLI exited ${code}\nstderr: ${stderr.slice(0, 2000)}`),
        );
      }
      try {
        const parsed = JSON.parse(stdout);
        if (parsed.is_error || parsed.subtype !== "success") {
          return reject(
            new Error(
              `claude CLI returned error: ${parsed.api_error_status || parsed.subtype}\n${parsed.result || ""}`,
            ),
          );
        }
        resolve(parsed);
      } catch (err) {
        reject(
          new Error(
            `Failed to parse claude CLI output: ${err.message}\nstdout head: ${stdout.slice(0, 500)}`,
          ),
        );
      }
    });

    if (stdin) {
      child.stdin.write(stdin);
    }
    child.stdin.end();
  });
}

function cliResultToUsage(parsed) {
  const u = parsed.usage || {};
  return {
    input_tokens: u.input_tokens || 0,
    output_tokens: u.output_tokens || 0,
    cache_creation_input_tokens: u.cache_creation_input_tokens || 0,
    cache_read_input_tokens: u.cache_read_input_tokens || 0,
  };
}

async function generateTextViaCli({ model, systemPrompt, userPrompt, thinking }) {
  const args = [
    "-p",
    "--output-format", "json",
    "--model", normalizeModel(model),
    "--tools", "",
    "--no-session-persistence",
  ];
  if (systemPrompt) args.push("--system-prompt", systemPrompt);
  const effort = thinkingToEffort(thinking);
  if (effort) args.push("--effort", effort);

  const parsed = await runClaudeCli({ args, stdin: userPrompt });
  return {
    text: parsed.result || "",
    usage: cliResultToUsage(parsed),
    model: model,
    stopReason: parsed.stop_reason || "end_turn",
  };
}

async function generateJSONViaCli({ model, systemPrompt, userPrompt, schema }) {
  const args = [
    "-p",
    "--output-format", "json",
    "--model", normalizeModel(model),
    "--tools", "",
    "--json-schema", JSON.stringify(schema),
    "--no-session-persistence",
  ];
  if (systemPrompt) args.push("--system-prompt", systemPrompt);

  const parsed = await runClaudeCli({ args, stdin: userPrompt });
  const data = parsed.structured_output;
  if (data === undefined || data === null) {
    throw new Error(
      `claude CLI returned no structured_output. result head: ${(parsed.result || "").slice(0, 300)}`,
    );
  }
  return {
    data,
    usage: cliResultToUsage(parsed),
    model,
    stopReason: parsed.stop_reason || "end_turn",
  };
}

async function generateWithWebSearchViaCli({ model, systemPrompt, userPrompt }) {
  const args = [
    "-p",
    "--output-format", "json",
    "--model", normalizeModel(model),
    "--tools", "WebSearch,WebFetch",
    "--allowed-tools", "WebSearch,WebFetch",
    "--settings", JSON.stringify({ permissions: { allow: ["WebSearch", "WebFetch"] } }),
    "--no-session-persistence",
  ];
  if (systemPrompt) args.push("--system-prompt", systemPrompt);

  const parsed = await runClaudeCli({ args, stdin: userPrompt, timeoutMs: 900000 });
  return {
    text: parsed.result || "",
    usage: cliResultToUsage(parsed),
    model,
    stopReason: parsed.stop_reason || "end_turn",
  };
}

// ---------- Public API: routes to API or CLI backend ----------

export async function generateText({
  model,
  systemPrompt,
  userPrompt,
  maxTokens = 16000,
  thinking,
}) {
  if (getBackend() === "claude-cli") {
    return generateTextViaCli({ model, systemPrompt, userPrompt, thinking });
  }
  const c = getClient();
  const params = {
    model,
    max_tokens: maxTokens,
    system: systemPrompt,
    messages: [{ role: "user", content: userPrompt }],
  };
  if (thinking) {
    params.thinking = thinking;
  }

  const stream = c.messages.stream(params);
  const message = await stream.finalMessage();

  const text = message.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("");

  return {
    text,
    usage: message.usage,
    model: message.model,
    stopReason: message.stop_reason,
  };
}

export async function generateJSON({
  model,
  systemPrompt,
  userPrompt,
  schema,
  maxTokens = 8000,
}) {
  if (getBackend() === "claude-cli") {
    return generateJSONViaCli({ model, systemPrompt, userPrompt, schema });
  }
  const c = getClient();
  const stream = c.messages.stream({
    model,
    max_tokens: maxTokens,
    system: systemPrompt,
    messages: [{ role: "user", content: userPrompt }],
    output_config: { format: { type: "json_schema", schema } },
  });
  const message = await stream.finalMessage();
  const textBlock = message.content.find((b) => b.type === "text");
  if (!textBlock) {
    throw new Error(`No text block in response. stop_reason=${message.stop_reason}`);
  }
  return {
    data: JSON.parse(textBlock.text),
    usage: message.usage,
    model: message.model,
    stopReason: message.stop_reason,
  };
}

export async function generateWithWebSearch({
  model,
  systemPrompt,
  userPrompt,
  maxTokens = 8000,
  maxContinuations = 5,
}) {
  if (getBackend() === "claude-cli") {
    return generateWithWebSearchViaCli({ model, systemPrompt, userPrompt });
  }
  const c = getClient();
  const tools = [{ type: "web_search_20260209", name: "web_search" }];

  let messages = [{ role: "user", content: userPrompt }];
  let response;

  for (let i = 0; i <= maxContinuations; i++) {
    const stream = c.messages.stream({
      model,
      max_tokens: maxTokens,
      system: systemPrompt,
      tools,
      messages,
    });
    response = await stream.finalMessage();

    if (response.stop_reason !== "pause_turn") break;

    messages = [
      { role: "user", content: userPrompt },
      { role: "assistant", content: response.content },
    ];
  }

  const text = response.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("");

  return {
    text,
    usage: response.usage,
    model: response.model,
    stopReason: response.stop_reason,
  };
}
