import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { LlmAdapter, LlmMessage, LlmTool } from "../llm/adapter.js";
import { crear, herramientasOC, type AgentTool } from "../tools/oc.js";
import { prepararOrden } from "../domain/crear-orden.js";
import { SessionStore } from "./sessions.js";

export type AgentTurnResult = { reply: string; toolCalls: unknown[]; needsConfirmation: boolean };

function schemaToJson(tool: AgentTool): Record<string, unknown> {
  const properties = Object.fromEntries(Object.entries(tool.args).map(([name, schema]) => {
    const description = schema.description ?? name;
    if (name === "caso") return [name, { type: "string", enum: ["sol-001", "sol-002", "sol-003", "sol-004", "sol-005", "sol-006"], description }];
    if (name === "confirmado") return [name, { type: "boolean", description }];
    return [name, { type: "object", description, additionalProperties: true }];
  }));
  return { type: "object", properties, required: Object.keys(tool.args).filter((name) => name !== "confirmado") };
}

const casos = ["sol-001", "sol-002", "sol-003", "sol-004", "sol-005", "sol-006"] as const;

function casosMencionados(message: string): string[] {
  return casos.filter((caso) => new RegExp(`\\b${caso}\\b`, "i").test(message));
}

function creationIntent(message: string): boolean {
  const prohibida = /\b(no\s+(?:quiero\s+que\s+)?(?:la\s+)?cre(?:es|ar)|no\s+emit(?:as|ir)|no\s+gener(?:es|ar)|ninguna\s+orden|sin\s+crear|no\s+env[ií]es|previsual|previsualiza|validar|consultar|consulta|rechazo|rechazar|cancelar)\b/i.test(message);
  return /\b(crea|crear|generar la oc|emitir|procesa|procesar)\b/i.test(message) && !prohibida;
}

function previewIntent(message: string): boolean {
  const confirmacionDiferida = /\b(no\s+(?:la\s+)?cre(?:es|ar)\s+hasta\s+que\s+confirm\w*|espera\s+mi\s+confirmaci[oó]n)\b/i.test(message);
  const prohibicionDefinitiva = /\b(no\s+quiero\s+crear|no\s+deseo\s+crear|no\s+crear|no\s+la\s+crees|no\s+env[ií]es)\b/i.test(message) && !confirmacionDiferida;
  return /\b(previsual|mu[ée]strame|como\s+quedar[ií]a|espera\s+mi\s+confirmaci[oó]n|hasta\s+que\s+confirm)\b/i.test(message) && !prohibicionDefinitiva;
}


export class AgentLoop {
  public constructor(private readonly directory: string, public readonly sessions: SessionStore, private readonly adapter: LlmAdapter, private readonly maxIterations: number, private readonly maxSessionTokens: number) {}

  public async run(sessionId: string, message: string): Promise<AgentTurnResult> {
    const normalized = message.trim().toLocaleLowerCase("es-CO");
    const pending = this.sessions.pending(sessionId);
    const mentioned = casosMencionados(message);
    if (pending?.estado !== "pendiente" && /^(confirmo|sí|si|aprobar|autorizo)\b/.test(normalized)) {
      this.sessions.addMessage(sessionId, "user", message);
      return { reply: "No existe una confirmación pendiente válida.", toolCalls: [], needsConfirmation: false };
    }
    if (pending?.estado === "pendiente" && /^(confirmo|sí|si|aprobar|autorizo)\b/.test(normalized)) {
      this.sessions.addMessage(sessionId, "user", message);
      if (mentioned.length > 1 || (mentioned.length === 1 && mentioned[0] !== pending.preparacion.caso)) {
        return { reply: "La confirmación no corresponde a la solicitud pendiente; no se creó ninguna OC.", toolCalls: [], needsConfirmation: true };
      }
      const authorizationId = this.sessions.approve(sessionId);
      if (authorizationId === null) return { reply: "No existe una confirmación pendiente válida.", toolCalls: [], needsConfirmation: false };
      this.sessions.setCreationPolicy(sessionId, true, pending.preparacion.caso);
      this.sessions.addProviderMessage(sessionId, { role: "user", content: message });
      const result = await crear.execute({ caso: pending.preparacion.caso, payload: {}, confirmado: true }, { directory: this.directory, sessionId, sessions: this.sessions });
      this.sessions.addProviderMessage(sessionId, { role: "tool", content: result, parts: [{ functionResponse: { id: "backend-confirmation", name: "oc_crear", response: { output: result } } }] });
      return { reply: result, toolCalls: [{ name: "oc_crear", result }], needsConfirmation: false };
    }
    if (pending?.estado === "pendiente" && /^(no crear|rechazo|cancelar|no)\b/.test(normalized)) {
      this.sessions.addMessage(sessionId, "user", message);
      this.sessions.reject(sessionId);
      this.sessions.setCreationPolicy(sessionId, false, null);
      const reply = "La creación pendiente fue cancelada por el usuario.";
      return { reply, toolCalls: [], needsConfirmation: false };
    }
    if (pending?.estado === "pendiente") {
      this.sessions.reject(sessionId);
    }
    const ambiguousCases = mentioned.length !== 1;
    this.sessions.setCreationPolicy(sessionId, !ambiguousCases && creationIntent(message), ambiguousCases ? null : mentioned[0] ?? null);
    const session = this.sessions.get(sessionId);
    if (session.tokensUsed >= this.maxSessionTokens) return { reply: "La sesión alcanzó el límite de tokens configurado.", toolCalls: [], needsConfirmation: pending?.estado === "pendiente" };
    this.sessions.addMessage(sessionId, "user", message);
    const prompt = await readFile(join(this.directory, "agent", "prompt.md"), "utf8");
    this.sessions.addProviderMessage(sessionId, { role: "user", content: message });
    const messages: LlmMessage[] = [{ role: "system", content: prompt }, ...this.sessions.providerMessages(sessionId)];
    const tools: LlmTool[] = Object.entries(herramientasOC).map(([name, tool]) => ({ name, description: tool.description, parameters: schemaToJson(tool) }));
    const calls: unknown[] = [];
    for (let iteration = 0; iteration < this.maxIterations; iteration += 1) {
      let response;
      try { response = await this.adapter.enviar(messages, tools); } catch { return { reply: "No fue posible comunicarse con el proveedor LLM. La sesión permanece disponible.", toolCalls: calls, needsConfirmation: this.sessions.pending(sessionId)?.estado === "pendiente" }; }
      session.tokensUsed += response.inputTokens + response.outputTokens;
      if (session.tokensUsed > this.maxSessionTokens) return { reply: "La sesión alcanzó el límite de tokens configurado.", toolCalls: calls, needsConfirmation: this.sessions.pending(sessionId)?.estado === "pendiente" };
      if (response.toolCalls.length === 0) {
        const finalMessage = response.assistantParts === undefined
          ? { role: "assistant" as const, content: response.text || "No hubo respuesta del modelo." }
          : { role: "assistant" as const, content: response.text || "No hubo respuesta del modelo.", parts: response.assistantParts };
        this.sessions.addProviderMessage(sessionId, finalMessage);
        return { reply: finalMessage.content, toolCalls: calls, needsConfirmation: this.sessions.pending(sessionId)?.estado === "pendiente" };
      }
      const assistantMessage = response.assistantParts === undefined
        ? { role: "assistant" as const, content: response.text }
        : { role: "assistant" as const, content: response.text, parts: response.assistantParts };
      messages.push(assistantMessage);
      this.sessions.addProviderMessage(sessionId, assistantMessage);
      for (const call of response.toolCalls) {
        const tool = herramientasOC[call.name as keyof typeof herramientasOC];
        const result = tool === undefined
          ? JSON.stringify({ ok: false, error: `Herramienta desconocida: ${call.name}` })
          : await tool.execute(call.args, { directory: this.directory, sessionId, sessions: this.sessions });
        if (tool === undefined) {
          await this.sessions.addToolCall(sessionId, {
            ts: new Date().toISOString(),
            name: call.name,
            args: call.args !== null && typeof call.args === "object" && !Array.isArray(call.args) ? call.args as Record<string, unknown> : { valor_invalido: typeof call.args },
            ok: false,
            summary: `Herramienta desconocida: ${call.name}`,
          });
        }
        calls.push({ id: call.id, name: call.name, args: call.args, result });
        if (call.name === "oc_construir_payload") {
          const caso = typeof call.args === "object" && call.args !== null && "caso" in call.args ? (call.args as { caso?: unknown }).caso : undefined;
          if (typeof caso === "string") {
            try {
              const preparacion = await prepararOrden(this.directory, caso);
              if (preparacion.validacion.confirmaciones.length > 0 && previewIntent(message)) this.sessions.setPending(sessionId, preparacion);
            } catch { }
          }
        }
        const toolMessage: LlmMessage = { role: "tool", content: result, parts: [{ functionResponse: { id: call.id, name: call.name, response: { output: result } } }] };
        messages.push(toolMessage);
        this.sessions.addProviderMessage(sessionId, toolMessage);
      }
    }
    return { reply: "Se alcanzó el límite de iteraciones de herramientas; revisa el estado disponible.", toolCalls: calls, needsConfirmation: this.sessions.pending(sessionId)?.estado === "pendiente" };
  }
}
