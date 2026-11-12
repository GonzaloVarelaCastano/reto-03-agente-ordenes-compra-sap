import { describe, expect, it } from "vitest";
import { crearGeminiDesdeEntorno, GeminiAdapter } from "../src/llm/gemini.js";

describe("protocolo Gemini", () => {
  it("usa modelo vigente por defecto y respeta configuración de entorno", () => {
    expect(crearGeminiDesdeEntorno({})).toBeNull();
    const adapter = crearGeminiDesdeEntorno({ GEMINI_API_KEY: "server-key", LLM_MODEL: "hosting-model" });
    expect(adapter?.model).toBe("hosting-model");
    expect(crearGeminiDesdeEntorno({ GEMINI_API_KEY: "server-key" })?.model).toBe("gemini-flash-latest");
    expect(crearGeminiDesdeEntorno({ GEMINI_API_KEY: "server-key", LLM_PROVIDER: "other" })).toBeNull();
  });
  it("envía functionCall previo y functionResponse asociado en el siguiente turno", async () => {
    const bodies: unknown[] = []; const headers: Headers[] = [];
    const adapter = new GeminiAdapter("gemini-test", "secret", 1000, async (_url, init) => {
      bodies.push(JSON.parse(String(init?.body))); headers.push(new Headers(init?.headers));
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "final" }] } }] }), { status: 200 });
    });
    await adapter.enviar([
      { role: "system", content: "system" },
      { role: "user", content: "procesa" },
      { role: "assistant", content: "", parts: [{ functionCall: { id: "call-1", name: "oc_validar", args: { caso: "sol-001" }, thoughtSignature: "sig" } }] },
      { role: "tool", content: "{\"ok\":true}", parts: [{ functionResponse: { id: "call-1", name: "oc_validar", response: { output: "{\"ok\":true}" } } }] },
    ], [{ name: "oc_validar", description: "validar", parameters: { type: "object" } }]);
    const body = bodies[0] as { contents: Array<{ role: string; parts: unknown[] }> };
    expect(body.contents[1]?.parts[0]).toMatchObject({ functionCall: { id: "call-1", name: "oc_validar" } });
    expect(body.contents[2]?.parts[0]).toMatchObject({ functionResponse: { id: "call-1", name: "oc_validar" } });
    expect(headers[0]?.get("x-goog-api-key")).toBe("secret");
  });

  it("conserva el orden de múltiples functionResponse", async () => {
    const bodies: unknown[] = [];
    const adapter = new GeminiAdapter("gemini-test", "secret", 1000, async (_url, init) => {
      bodies.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "final" }] } }] }), { status: 200 });
    });
    await adapter.enviar([
      { role: "system", content: "system" },
      { role: "assistant", content: "", parts: [{ functionCall: { id: "a", name: "oc_leer_paquete", args: {} } }, { functionCall: { id: "b", name: "oc_validar", args: {} } }] },
      { role: "tool", content: "a", parts: [{ functionResponse: { id: "a", name: "oc_leer_paquete", response: { output: "a" } } }] },
      { role: "tool", content: "b", parts: [{ functionResponse: { id: "b", name: "oc_validar", response: { output: "b" } } }] },
    ], []);
    const contents = (bodies[0] as { contents: Array<{ parts: unknown[] }> }).contents;
    expect(contents[1]?.parts[0]).toMatchObject({ functionResponse: { id: "a" } });
    expect(contents[2]?.parts[0]).toMatchObject({ functionResponse: { id: "b" } });
  });
});
