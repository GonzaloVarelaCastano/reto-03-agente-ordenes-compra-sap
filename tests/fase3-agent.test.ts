import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { AgentLoop } from "../src/agent/loop.js";
import { SessionStore } from "../src/agent/sessions.js";
import type { LlmAdapter, LlmMessage, LlmResponse, LlmTool } from "../src/llm/adapter.js";
import { crear, herramientasOC, leer_paquete, validar } from "../src/tools/oc.js";

const directory = fileURLToPath(new URL("..", import.meta.url));
const temporales: string[] = [];

async function entornoTemporal(): Promise<string> {
  const temporal = await mkdtemp(join(tmpdir(), "reto-03-fase3-"));
  temporales.push(temporal);
  await cp(join(directory, "fixtures"), join(temporal, "fixtures"), { recursive: true });
  await cp(join(directory, "agent"), join(temporal, "agent"), { recursive: true });
  return temporal;
}

afterEach(async () => {
  await Promise.all(temporales.splice(0).map((ruta) => rm(ruta, { recursive: true, force: true })));
});

class MockLlm implements LlmAdapter {
  public readonly provider = "mock";
  public readonly model = "mock-model";
  public constructor(private readonly responses: LlmResponse[]) {}
  public async enviar(_messages: LlmMessage[], _tools: LlmTool[]): Promise<LlmResponse> {
    return this.responses.shift() ?? { text: "fin", toolCalls: [], inputTokens: 1, outputTokens: 1 };
  }
}

describe("herramientas OC", () => {
  it("expone exactamente las cinco herramientas esperadas", () => {
    expect(Object.keys(herramientasOC)).toEqual(["oc_leer_paquete", "oc_validar", "oc_construir_payload", "oc_generar_evidencia", "oc_crear"]);
    Object.values(herramientasOC).forEach((tool) => expect(Object.values(tool.args).every((schema) => schema.description !== undefined)).toBe(true));
  });

  it("serializa errores sin lanzar para caso inexistente y path traversal", async () => {
    const temporal = await entornoTemporal();
    const sessions = new SessionStore(temporal);
    await expect(leer_paquete.execute({ caso: "../sol-001" }, { directory: temporal, sessionId: "s1", sessions })).resolves.toMatch(/"ok":false/);
  });

  it("valida sol-002 bloqueada y sol-004 pendiente por creación sin autorización", async () => {
    const temporal = await entornoTemporal();
    const sessions = new SessionStore(temporal);
    const bloqueada = await validar.execute({ caso: "sol-002", paquete: {} }, { directory: temporal, sessionId: "s1", sessions });
    sessions.setCreationPolicy("s1", true, "sol-004");
    const pendiente = await crear.execute({ caso: "sol-004", payload: {}, confirmado: true }, { directory: temporal, sessionId: "s1", sessions });
    expect(bloqueada).toContain("RC1");
    expect(pendiente).toContain("pendiente_confirmacion");
  });
});

describe("ciclo y sesiones", () => {
  it("ejecuta herramienta visible con adaptador simulado y conserva historial", async () => {
    const temporal = await entornoTemporal();
    const sessions = new SessionStore(temporal);
    const loop = new AgentLoop(temporal, sessions, new MockLlm([
      { text: "", toolCalls: [{ id: "1", name: "oc_leer_paquete", args: { caso: "sol-001" } }], inputTokens: 2, outputTokens: 2 },
      { text: "Paquete leído", toolCalls: [], inputTokens: 2, outputTokens: 2 },
    ]), 3, 100);
    const resultado = await loop.run("s1", "Procesa sol-001");
    expect(resultado.reply).toBe("Paquete leído");
    expect(resultado.toolCalls).toHaveLength(1);
    expect(sessions.get("s1").toolCalls).toHaveLength(1);
  });

  it("impone límite de iteraciones y de tokens", async () => {
    const temporal = await entornoTemporal();
    const sessions = new SessionStore(temporal);
    const repetitivo = new MockLlm([{ text: "", toolCalls: [{ id: "1", name: "oc_leer_paquete", args: { caso: "sol-001" } }], inputTokens: 1, outputTokens: 1 }]);
    const loop = new AgentLoop(temporal, sessions, repetitivo, 1, 100);
    await expect(loop.run("s1", "procesa")).resolves.toMatchObject({ reply: expect.stringContaining("límite de iteraciones") });
    const tokens = new AgentLoop(temporal, new SessionStore(temporal), new MockLlm([{ text: "texto", toolCalls: [], inputTokens: 100, outputTokens: 1 }]), 2, 10);
    await expect(tokens.run("s2", "procesa")).resolves.toMatchObject({ reply: expect.stringContaining("límite de tokens") });
  });

  it("registra aprobación explícita, rechaza otra sesión y consume una sola vez", async () => {
    const temporal = await entornoTemporal();
    const sessions = new SessionStore(temporal);
    sessions.setCreationPolicy("s1", true, "sol-004");
    const pendiente = await crear.execute({ caso: "sol-004", payload: {}, confirmado: false }, { directory: temporal, sessionId: "s1", sessions });
    expect(pendiente).toContain("pendiente_confirmacion");
    expect(sessions.approve("s2")).toBeNull();
    const id = sessions.approve("s1");
    expect(id).not.toBeNull();
    expect(sessions.takeAuthorization("s1", "sol-004")).toBe(id);
    expect(sessions.takeAuthorization("s1", "sol-004")).toBeNull();
  });

  it("maneja timeout o error del proveedor sin destruir la sesión", async () => {
    const temporal = await entornoTemporal();
    const adapter: LlmAdapter = { provider: "mock", model: "mock", enviar: async () => { throw new Error("timeout"); } };
    const sessions = new SessionStore(temporal);
    const loop = new AgentLoop(temporal, sessions, adapter, 2, 100);
    await expect(loop.run("s1", "procesa")).resolves.toMatchObject({ reply: expect.stringContaining("No fue posible") });
    expect(sessions.get("s1").id).toBe("s1");
  });
});
