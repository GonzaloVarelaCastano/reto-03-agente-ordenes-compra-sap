import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { SessionStore } from "../src/agent/sessions.js";
import { construir_payload, validar } from "../src/tools/oc.js";

const root = fileURLToPath(new URL("..", import.meta.url));
const temp: string[] = [];
async function setup() { const dir = await mkdtemp(join(tmpdir(), "reto-summary-")); temp.push(dir); await cp(join(root, "fixtures"), join(dir, "fixtures"), { recursive: true }); return dir; }
afterEach(async () => { await Promise.all(temp.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))); });

describe("resumen estructurado de sesión", () => {
  it("expone bloqueos luego de validar y datos luego de previsualizar", async () => {
    const dir = await setup(); const sessions = new SessionStore(dir); const context = { directory: dir, sessionId: "summary", sessions };
    await validar.execute({ caso: "sol-002", paquete: {} }, context);
    const blocked = sessions.publicView("summary");
    expect(blocked?.orderSummary).toMatchObject({ solicitudId: "SOL-2026-002", bloqueos: ["RC1"], codigoSap: null });
    await construir_payload.execute({ caso: "sol-001", paquete: {}, derivados: {} }, context);
    const preview = sessions.publicView("summary");
    expect(preview?.orderSummary).toMatchObject({ solicitudId: "SOL-2026-001", proveedor: "TecnoSuministros S.A.S.", importe: 11400000, numeroOc: null });
  });
});
