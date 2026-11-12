import { cp, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { construirPayload } from "../src/domain/construir-payload.js";
import { generarEvidenciaAprobacion } from "../src/domain/evidencia.js";
import { leerMaestros, leerPaqueteFixture } from "../src/domain/leer-fixture.js";
import { validarOrden } from "../src/domain/validar-orden.js";
import { SapMockAdapter } from "../src/sap/mock.js";

const directory = fileURLToPath(new URL("..", import.meta.url));
const temporales: string[] = [];

async function entornoTemporal(): Promise<string> {
  const temporal = await mkdtemp(join(tmpdir(), "reto-03-sap-"));
  temporales.push(temporal);
  await cp(join(directory, "fixtures"), join(temporal, "fixtures"), { recursive: true });
  return temporal;
}

async function ordenSol001(temporal: string) {
  const [paquete, maestros] = await Promise.all([leerPaqueteFixture(temporal, "sol-001"), leerMaestros(temporal)]);
  const validacion = validarOrden(paquete, maestros);
  const evidencia = await generarEvidenciaAprobacion(temporal, "sol-001");
  return (await construirPayload(temporal, "sol-001", paquete, maestros, validacion, evidencia.sha256)).payload;
}

afterEach(async () => {
  await Promise.all(temporales.splice(0).map((ruta) => rm(ruta, { recursive: true, force: true })));
});

describe("SAP mock", () => {
  it("consulta proveedor mediante el maestro", async () => {
    const temporal = await entornoTemporal();
    const sap = new SapMockAdapter(temporal);
    await expect(sap.consultarProveedor("900.555.111-2")).resolves.toEqual({ codigo_sap: "100234", activo: true });
    await expect(sap.consultarProveedor("999999999")).resolves.toBeNull();
  });

  it("asigna 4500000001, es idempotente y persiste al reinstanciar", async () => {
    const temporal = await entornoTemporal();
    const orden = await ordenSol001(temporal);
    const sap = new SapMockAdapter(temporal);
    const primera = await sap.crearOrden(orden);
    const repetida = await sap.crearOrden(orden);
    const reinstanciado = await new SapMockAdapter(temporal).buscarOrdenPorReferencia("SOL-2026-001");
    expect(primera.numero_oc).toBe("4500000001");
    expect(repetida.numero_oc).toBe(primera.numero_oc);
    expect(reinstanciado).toEqual({ numero_oc: primera.numero_oc });
  });

  it("no duplica ante dos creaciones concurrentes en una instancia", async () => {
    const temporal = await entornoTemporal();
    const sap = new SapMockAdapter(temporal);
    const orden = await ordenSol001(temporal);
    const [primera, segunda] = await Promise.all([sap.crearOrden(orden), sap.crearOrden(orden)]);
    const lineas = (await readFile(join(temporal, "out", "sap", "ordenes.jsonl"), "utf8")).trim().split(/\r?\n/);
    expect(primera.numero_oc).toBe("4500000001");
    expect(segunda.numero_oc).toBe(primera.numero_oc);
    expect(lineas).toHaveLength(1);
  });

  it("no duplica entre dos instancias sobre el mismo directorio", async () => {
    const temporal = await entornoTemporal();
    const orden = await ordenSol001(temporal);
    const [primera, segunda] = await Promise.all([
      new SapMockAdapter(temporal).crearOrden(orden),
      new SapMockAdapter(temporal).crearOrden(orden),
    ]);
    const lineas = (await readFile(join(temporal, "out", "sap", "ordenes.jsonl"), "utf8")).trim().split(/\r?\n/);
    expect(primera.numero_oc).toBe("4500000001");
    expect(segunda.numero_oc).toBe(primera.numero_oc);
    expect(lineas).toHaveLength(1);
  });

  it("asigna consecutivos a solicitudes distintas entre instancias", async () => {
    const temporal = await entornoTemporal();
    const primera = await ordenSol001(temporal);
    const segunda = structuredClone(primera);
    segunda.referencia.solicitud_id = "SOL-2026-OTRA";
    const [creadaPrimera, creadaSegunda] = await Promise.all([
      new SapMockAdapter(temporal).crearOrden(primera),
      new SapMockAdapter(temporal).crearOrden(segunda),
    ]);
    expect([creadaPrimera.numero_oc, creadaSegunda.numero_oc].sort()).toEqual(["4500000001", "4500000002"]);
  });

  it("valida la orden antes de persistir", async () => {
    const temporal = await entornoTemporal();
    const orden = await ordenSol001(temporal);
    const invalida = { ...orden, sociedad: "2000" };
    await expect(new SapMockAdapter(temporal).crearOrden(invalida as never)).rejects.toThrow();
  });
});
