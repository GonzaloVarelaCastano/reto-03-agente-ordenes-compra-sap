export type LlmMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  parts?: unknown[];
};

export type LlmTool = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
};

export type LlmToolCall = {
  id: string;
  name: string;
  args: unknown;
};

export type LlmResponse = {
  text: string;
  toolCalls: LlmToolCall[];
  inputTokens: number;
  outputTokens: number;
  assistantParts?: unknown[];
};

export interface LlmAdapter {
  readonly provider: string;
  readonly model: string;
  enviar(messages: LlmMessage[], tools: LlmTool[]): Promise<LlmResponse>;
}
