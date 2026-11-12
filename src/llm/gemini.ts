import type { LlmAdapter, LlmMessage, LlmResponse, LlmTool } from "./adapter.js";

type FetchLike = typeof fetch;

export class GeminiAdapter implements LlmAdapter {
  public readonly provider = "gemini";

  public constructor(
    public readonly model: string,
    private readonly apiKey: string,
    private readonly timeoutMs: number,
    private readonly fetcher: FetchLike = fetch,
  ) {}

  public async enviar(messages: LlmMessage[], tools: LlmTool[]): Promise<LlmResponse> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const contents = messages.filter(({ role }) => role !== "system").map(({ role, content, parts }) => ({
        role: role === "assistant" ? "model" : role === "tool" ? "user" : "user",
        parts: parts ?? [{ text: content }],
      }));
      const response = await this.fetcher(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(this.model)}:generateContent`,
        {
          method: "POST",
          headers: { "content-type": "application/json", "x-goog-api-key": this.apiKey },
          signal: controller.signal,
          body: JSON.stringify({
            contents,
            systemInstruction: { parts: [{ text: messages.find(({ role }) => role === "system")?.content ?? "" }] },
            tools: [{ functionDeclarations: tools.map((tool) => ({ name: tool.name, description: tool.description, parametersJsonSchema: tool.parameters })) }],
          }),
        },
      );
      if (!response.ok) throw new Error(`Gemini respondió HTTP ${response.status}`);
      const payload = await response.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string; functionCall?: { id?: string; name?: string; args?: unknown; thoughtSignature?: string } }> } }>; usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number } };
      const parts = payload.candidates?.[0]?.content?.parts ?? [];
      return {
        text: parts.map(({ text }) => text ?? "").join(""),
        toolCalls: parts.flatMap((part, index) => part.functionCall?.name === undefined ? [] : [{ id: part.functionCall.id ?? `gemini-${index}`, name: part.functionCall.name, args: part.functionCall.args ?? {} }]),
        inputTokens: payload.usageMetadata?.promptTokenCount ?? 0,
        outputTokens: payload.usageMetadata?.candidatesTokenCount ?? 0,
        assistantParts: parts,
      };
    } finally {
      clearTimeout(timer);
    }
  }
}

export function crearGeminiDesdeEntorno(environment = process.env): GeminiAdapter | null {
  if (environment.LLM_PROVIDER !== undefined && environment.LLM_PROVIDER !== "gemini") return null;
  const key = environment.GEMINI_API_KEY;
  if (key === undefined || key.length === 0) return null;
  return new GeminiAdapter(environment.LLM_MODEL ?? "gemini-flash-latest", key, Number(environment.LLM_TIMEOUT_MS ?? 15_000));
}
