import Anthropic from "@anthropic-ai/sdk";

let client;

export function getClient() {
  if (!client) {
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new Error(
        "ANTHROPIC_API_KEY is not set. Copy .env.example to .env and fill it in.",
      );
    }
    client = new Anthropic();
  }
  return client;
}

export async function generateText({
  model,
  systemPrompt,
  userPrompt,
  maxTokens = 16000,
  thinking,
}) {
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

// Structured JSON output via output_config.format. Returns parsed object.
export async function generateJSON({
  model,
  systemPrompt,
  userPrompt,
  schema,
  maxTokens = 8000,
}) {
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

// Run a request with the server-side web_search tool. Handles pause_turn
// by re-sending until end_turn or a hard iteration cap. Returns the final
// text response (Claude's research notes).
export async function generateWithWebSearch({
  model,
  systemPrompt,
  userPrompt,
  maxTokens = 8000,
  maxContinuations = 5,
}) {
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

    // Server-side tool loop hit its cap; re-send to continue
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
