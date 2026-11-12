import { cp, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { runDemo } from "../demo.js";

const root = fileURLToPath(new URL("..", import.meta.url));
const temporales: string[] = [];
async function fixtureRoot() { const directory = await mkdtemp(join(tmpdir(), "reto-demo-")); temporales.push(directory); await cp(join(root, "fixtures"), join(directory, "fixtures"), { recursive: true }); return directory; }
afterEach(async () => { await Promise.all(temporales.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))); });

describe("demo sin modelo LLM", () => {
  it("procesa los seis casos, crea solo las OCs permitidas y conserva auditoría", async () => {
    const directory = await fixtureRoot();
    const results = await runDemo(directory);
    expect(results).toHaveLength(6);
    expect(results.find(({ caso }) => caso === "sol-001")).toMatchObject({ apta: true, resultadoCreacion: "creada", numeroOc: "4500000001" });
    expect(results.find(({ caso }) => caso === "sol-002")).toMatchObject({ bloqueos: ["RC1"], numeroOc: null });
    expect(results.find(({ caso }) => caso === "sol-003")).toMatchObject({ bloqueos: ["RC2", "RC3"], numeroOc: null });
    expect(results.find(({ caso }) => caso === "sol-004")).toMatchObject({ confirmaciones: ["RC5"], resultadoCreacion: "creada", numeroOc: "4500000002" });
    expect(results.find(({ caso }) => caso === "sol-005")).toMatchObject({ retroactiva: true, resultadoCreacion: "pendiente_confirmacion" });
    expect(results.find(({ caso }) => caso === "sol-006")).toMatchObject({ confirmaciones: ["RC6"], resultadoCreacion: "pendiente_confirmacion" });
    const control = await readFile(join(directory, "out", "control.csv"), "utf8");
    const orders = (await readFile(join(directory, "out", "sap", "ordenes.jsonl"), "utf8")).trim().split(/\r?\n/);
    expect(control.split(/\r?\n/)[0]).toBe("solicitud_id,resultado,numero_oc,retroactiva,bloqueos,confirmaciones,ts");
    expect(orders).toHaveLength(2);
    expect(await readFile(join(directory, "out", "sol-001", "aprobacion.txt"), "utf8")).toContain("Aprobado");
    expect(await readFile(join(directory, "out", "sol-004", "trazabilidad.json"), "utf8")).toContain("descripcion_original");
  });

  it("es determinista salvo timestamps entre ejecuciones", async () => {
    const directory = await fixtureRoot();
    const first = await runDemo(directory);
    const second = await runDemo(directory);
    expect(second.map(({ caso, resultadoCreacion, numeroOc, bloqueos, confirmaciones }) => ({ caso, resultadoCreacion, numeroOc, bloqueos, confirmaciones }))).toEqual(first.map(({ caso, resultadoCreacion, numeroOc, bloqueos, confirmaciones }) => ({ caso, resultadoCreacion, numeroOc, bloqueos, confirmaciones })));
  });
});
