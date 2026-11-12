import { cp, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { AgentLoop } from "../src/agent/loop.js";
import { SessionStore } from "../src/agent/sessions.js";
import type { LlmAdapter, LlmMessage, LlmResponse, LlmTool } from "../src/llm/adapter.js";

const root = fileURLToPath(new URL("..", import.meta.url));
const temporales: string[] = [];
async function setup() { const dir = await mkdtemp(join(tmpdir(), "reto-f3-reg-")); temporales.push(dir); await cp(join(root, "fixtures"), join(dir, "fixtures"), { recursive: true }); await cp(join(root, "agent"), join(dir, "agent"), { recursive: true }); return dir; }
afterEach(async () => { await Promise.all(temporales.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))); });

class CaptureLlm implements LlmAdapter {
  public readonly provider = "mock"; public readonly model = "mock"; public calls: LlmMessage[][] = [];
  public constructor(private readonly responses: LlmResponse[]) {}
  async enviar(messages: LlmMessage[], _tools: LlmTool[]) { this.calls.push(structuredClone(messages)); return this.responses.shift() ?? { text: "final", toolCalls: [], inputTokens: 1, outputTokens: 1 }; }
}

describe("regresiones conversacionales", () => {
  it("rechaza crear un caso diferente al solicitado por el usuario", async () => {
    const dir = await setup(); const sessions = new SessionStore(dir);
    const llm = new CaptureLlm([{ text: "", toolCalls: [{ id: "bad", name: "oc_crear", args: { caso: "sol-001", payload: {} } }], inputTokens: 1, outputTokens: 1 }, { text: "fin", toolCalls: [], inputTokens: 1, outputTokens: 1 }]);
    const result = await new AgentLoop(dir, sessions, llm, 3, 100).run("s-case", "Procesa sol-002");
    expect(JSON.stringify(result)).toContain("creacion_no_autorizada_por_intencion");
  });

  it.each(["Procesa sol-001, no quiero que la crees", "Procesa sol-001, no emitas ninguna orden"])('prohíbe crear ante negación operativa: %s', async (message) => {
    const dir = await setup(); const sessions = new SessionStore(dir);
    const llm = new CaptureLlm([{ text: "", toolCalls: [{ id: "c", name: "oc_crear", args: { caso: "sol-001", payload: {} } }], inputTokens: 1, outputTokens: 1 }, { text: "fin", toolCalls: [], inputTokens: 1, outputTokens: 1 }]);
    const result = await new AgentLoop(dir, sessions, llm, 3, 100).run("s-neg", message);
    expect(JSON.stringify(result)).toContain("creacion_no_autorizada_por_intencion");
  });

  it("prepara confirmación diferida con el mensaje exacto de auditoría", async () => {
    const dir = await setup(); const sessions = new SessionStore(dir);
    const llm = new CaptureLlm([{ text: "¿Confirmas?", toolCalls: [{ id: "p", name: "oc_construir_payload", args: { caso: "sol-004", paquete: {}, derivados: {} } }], inputTokens: 1, outputTokens: 1 }, { text: "final", toolCalls: [], inputTokens: 1, outputTokens: 1 }]);
    const loop = new AgentLoop(dir, sessions, llm, 4, 100);
    const first = await loop.run("s-deferred", "Procesa sol-004, muéstrame la OC como quedaría en SAP y no la crees hasta que confirme");
    expect(first.needsConfirmation).toBe(true);
    expect(sessions.pending("s-deferred")?.estado).toBe("pendiente");
    expect(sessions.publicView("s-deferred")?.orderSummary?.numeroOc).toBeNull();
    const second = await loop.run("s-deferred", "confirmo");
    expect(second.reply).toContain("creada");
    expect(second.reply).toContain("4500000001");
  });

  it("previsualizar sol-004 deja pendiente y confirmo crea en segundo turno", async () => {
    const dir = await setup(); const sessions = new SessionStore(dir);
    const llm = new CaptureLlm([
      { text: "¿Confirmas?", toolCalls: [{ id: "p", name: "oc_construir_payload", args: { caso: "sol-004", paquete: {}, derivados: {} } }], inputTokens: 1, outputTokens: 1 },
      { text: "final", toolCalls: [], inputTokens: 1, outputTokens: 1 },
    ]);
    const loop = new AgentLoop(dir, sessions, llm, 4, 100);
    const preview = await loop.run("session-preview", "Previsualiza sol-004 y espera mi confirmación");
    expect(preview.needsConfirmation).toBe(true);
    expect(sessions.pending("session-preview")?.estado).toBe("pendiente");
    const confirmacion = await loop.run("session-preview", "confirmo");
    expect(confirmacion.reply).toContain("creada");
    expect(confirmacion.reply).toContain("4500000001");
  });

  it("confirmación de otro caso no crea la OC pendiente y un turno intermedio la invalida", async () => {
    const dir = await setup(); const sessions = new SessionStore(dir);
    const llm = new CaptureLlm([{ text: "", toolCalls: [{ id: "p", name: "oc_construir_payload", args: { caso: "sol-004", paquete: {}, derivados: {} } }], inputTokens: 1, outputTokens: 1 }, { text: "fin", toolCalls: [], inputTokens: 1, outputTokens: 1 }]);
    const loop = new AgentLoop(dir, sessions, llm, 3, 100);
    await loop.run("s-confirm", "Previsualiza sol-004 y espera mi confirmación");
    expect((await loop.run("s-confirm", "confirmo sol-005")).needsConfirmation).toBe(true);
    expect(sessions.pending("s-confirm")?.estado).toBe("pendiente");
    await loop.run("s-confirm", "¿cuál es el proveedor?");
    expect(sessions.pending("s-confirm")?.estado).toBe("rechazada");
    expect((await loop.run("s-confirm", "confirmo sol-004")).reply).toContain("No existe");
  });

  it("consulta sin deseo de crear no deja pendiente", async () => {
    const dir = await setup(); const sessions = new SessionStore(dir);
    const llm = new CaptureLlm([{ text: "", toolCalls: [{ id: "p", name: "oc_construir_payload", args: { caso: "sol-004", paquete: {}, derivados: {} } }], inputTokens: 1, outputTokens: 1 }, { text: "fin", toolCalls: [], inputTokens: 1, outputTokens: 1 }]);
    const result = await new AgentLoop(dir, sessions, llm, 3, 100).run("s-info", "Consulta sol-004, no deseo crear");
    expect(result.needsConfirmation).toBe(false);
    expect(sessions.pending("s-info")).toBeNull();
  });

  it("procesa sol-001 crea, pero una prohibición explícita impide crear", async () => {
    const dir = await setup();
    const llmA = new CaptureLlm([{ text: "", toolCalls: [{ id: "c", name: "oc_crear", args: { caso: "sol-001", payload: {} } }], inputTokens: 1, outputTokens: 1 }, { text: "final", toolCalls: [], inputTokens: 1, outputTokens: 1 }]);
    const first = new AgentLoop(dir, new SessionStore(dir), llmA, 3, 100);
    expect((await first.run("s-create", "Procesa sol-001")).toolCalls).toHaveLength(1);
    const llmB = new CaptureLlm([{ text: "", toolCalls: [{ id: "x", name: "oc_crear", args: { caso: "sol-001", payload: {} } }], inputTokens: 1, outputTokens: 1 }, { text: "final", toolCalls: [], inputTokens: 1, outputTokens: 1 }]);
    const sessions = new SessionStore(dir); const second = new AgentLoop(dir, sessions, llmB, 3, 100);
    const result = await second.run("s-no-create", "Procesa sol-001, pero no la crees");
    expect(JSON.stringify(result)).toContain("creacion_no_autorizada_por_intencion");
  });

  it("rechazo cancela y herramienta desconocida queda registrada", async () => {
    const dir = await setup(); const sessions = new SessionStore(dir);
    const llm = new CaptureLlm([{ text: "", toolCalls: [{ id: "u", name: "oc_desconocida", args: null }], inputTokens: 1, outputTokens: 1 }, { text: "fin", toolCalls: [], inputTokens: 1, outputTokens: 1 }]);
    const loop = new AgentLoop(dir, sessions, llm, 3, 100);
    const result = await loop.run("s-unknown", "Consulta sol-001");
    expect(JSON.stringify(result)).toContain("Herramienta desconocida");
    expect(sessions.get("s-unknown").toolCalls[0]).toMatchObject({ name: "oc_desconocida", ok: false });
    expect((await readFile(join(dir, "out", "log.jsonl"), "utf8"))).toContain("oc_desconocida");
  });

  it("mantiene providerHistory estructurado en dos turnos sin duplicar historial público", async () => {
    const dir = await setup(); const sessions = new SessionStore(dir);
    const llm = new CaptureLlm([
      { text: "", toolCalls: [{ id: "a", name: "oc_leer_paquete", args: { caso: "sol-001" } }], inputTokens: 1, outputTokens: 1, assistantParts: [{ functionCall: { id: "a", name: "oc_leer_paquete", args: { caso: "sol-001" }, thoughtSignature: "sig" } }] },
      { text: "ok", toolCalls: [], inputTokens: 1, outputTokens: 1 },
      { text: "segundo", toolCalls: [], inputTokens: 1, outputTokens: 1 },
    ]);
    const loop = new AgentLoop(dir, sessions, llm, 3, 100);
    await loop.run("s-history", "Consulta sol-001"); await loop.run("s-history", "¿y ahora?");
    expect(llm.calls[1]?.some((message) => message.parts?.some((part) => "functionResponse" in (part as object)))).toBe(true);
    expect(sessions.get("s-history").history.filter(({ role }) => role === "user")).toHaveLength(2);
  });
});
