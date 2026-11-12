import { rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { SessionStore } from "./src/agent/sessions.js";
import { crear, construir_payload, generar_evidencia, leer_paquete, validar } from "./src/tools/oc.js";

export type DemoCaseResult = {
  caso: string;
  apta: boolean;
  bloqueos: string[];
  confirmaciones: string[];
  derivados: Record<string, unknown>;
  retroactiva: boolean;
  resultadoCreacion: string;
  numeroOc: string | null;
  motivo: string | null;
};

type ToolResult = { ok: boolean; data?: unknown; error?: string };
type ValidationData = { apta: boolean; bloqueos: Array<{ codigo: string }>; confirmaciones: Array<{ codigo: string }>; derivados: Record<string, unknown>; retroactiva: boolean };
type CreationData = { resultado?: string; numero_oc?: string | null };
function parse(result: string): ToolResult { return JSON.parse(result) as ToolResult; }
function codigos(items: Array<{ codigo: string }> | undefined): string[] { return (items ?? []).map(({ codigo }) => codigo); }

export async function runDemo(directory: string): Promise<DemoCaseResult[]> {
  await rm(join(directory, "out"), { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  const sessions = new SessionStore(directory);
  const cases = ["sol-001", "sol-002", "sol-003", "sol-004", "sol-005", "sol-006"] as const;
  const output: DemoCaseResult[] = [];
  for (const caso of cases) {
    const sessionId = `demo-${caso}`;
    const paquete = parse(await leer_paquete.execute({ caso }, { directory, sessionId, sessions }));
    const validation = parse(await validar.execute({ caso, paquete: paquete.data ?? {} }, { directory, sessionId, sessions }));
    const data = validation.data as ValidationData | undefined;
    if (data?.apta) {
      await construir_payload.execute({ caso, paquete: paquete.data ?? {}, derivados: data.derivados }, { directory, sessionId, sessions });
      await generar_evidencia.execute({ caso }, { directory, sessionId, sessions });
    }
    sessions.setCreationPolicy(sessionId, true, caso);
    let creation = parse(await crear.execute({ caso, payload: {}, confirmado: false }, { directory, sessionId, sessions }));
    if (caso === "sol-004" && (creation.data as CreationData | undefined)?.resultado === "pendiente_confirmacion") {
      sessions.approve(sessionId, "demo@local.invalid");
      creation = parse(await crear.execute({ caso, payload: {}, confirmado: true }, { directory, sessionId, sessions }));
    }
    if (caso === "sol-001") {
      const repeat = parse(await crear.execute({ caso, payload: {}, confirmado: false }, { directory, sessionId, sessions }));
      if ((repeat.data as CreationData | undefined)?.resultado !== "idempotente") throw new Error("Idempotencia de sol-001 no cumplida");
    }
    const result = creation.data as CreationData | undefined;
    output.push({
      caso,
      apta: data?.apta ?? false,
      bloqueos: codigos(data?.bloqueos),
      confirmaciones: codigos(data?.confirmaciones),
      derivados: data?.derivados ?? {},
      retroactiva: data?.retroactiva ?? false,
      resultadoCreacion: result?.resultado ?? "error",
      numeroOc: result?.numero_oc ?? null,
      motivo: creation.error ?? null,
    });
  }
  return output;
}

async function main() {
  const directory = fileURLToPath(new URL(".", import.meta.url));
  const results = await runDemo(directory);
  for (const result of results) console.log(JSON.stringify(result));
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) void main();
