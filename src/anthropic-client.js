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
