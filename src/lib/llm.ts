import OpenAI from "openai";

// ============================================================
// LLM CLIENT — provider-agnostic via the OpenAI-compatible API
// ============================================================
// Defaults to Google Gemini's OpenAI-compatible endpoint. Switching
// to DeepSeek (or any OpenAI-compatible provider) is env-only:
//   AI_BASE_URL, AI_API_KEY, AI_MODEL
// ============================================================

export const AI_MODEL = process.env.AI_MODEL || "gemini-2.5-flash-lite";

export const AI_BASE_URL =
  process.env.AI_BASE_URL || "https://generativelanguage.googleapis.com/v1beta/openai/";

export const llm = new OpenAI({
  apiKey: process.env.AI_API_KEY || process.env.GEMINI_API_KEY || "",
  baseURL: AI_BASE_URL,
});

// Adapt Anthropic-style tool defs ({name, description, input_schema})
// to the OpenAI function-tool shape.
export function toOpenAITools(
  anthTools: { name: string; description: string; input_schema: any }[]
): OpenAI.Chat.Completions.ChatCompletionTool[] {
  return anthTools.map((t) => ({
    type: "function",
    function: {
      name: t.name,
      description: t.description,
      parameters: t.input_schema,
    },
  }));
}
