export type ToolCall = { name: string; args: Record<string, unknown>; result: string; id?: string };
export type ChatResponse = { reply: string; toolCalls: ToolCall[]; needsConfirmation: boolean };
export type SessionMessage = { role: "user" | "assistant" | "tool"; content: string; ts: string };
export type OrderSummary = { solicitudId: string; proveedor: string | null; codigoSap: string | null; moneda: string | null; importe: number | null; centroCosto: string | null; subarea: string | null; aprobador: string | null; condicionesPago: string | null; indicadorIva: string | null; bloqueos: string[]; confirmaciones: string[]; retroactiva: boolean; numeroOc: string | null };
export type SessionView = { id: string; history: SessionMessage[]; toolCalls: Array<{ ts: string; name: string; args: Record<string, unknown>; ok: boolean; summary: string }>; processing: boolean; tokensUsed: number; confirmation: { estado: string; motivos: string[]; solicitudId: string } | null; orderSummary: OrderSummary | null };
export type Health = { ok: boolean; provider: string; model: string };
export type CaseItem = { id: string };
