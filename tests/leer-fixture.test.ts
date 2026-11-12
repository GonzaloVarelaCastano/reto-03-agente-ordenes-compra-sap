import { cp, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { leerMaestros, leerPaqueteConFaltantes } from "../src/domain/leer-fixture.js";
import { validarOrden } from "../src/domain/validar-orden.js";

const directory = fileURLToPath(new URL("..", import.meta.url));
const temporales: string[] = [];

async function copiarProyectoFixture(): Promise<string> {
  const temporal = await mkdtemp(join(tmpdir(), "reto-03-"));
  temporales.push(temporal);
  await cp(join(directory, "fixtures"), join(temporal, "fixtures"), { recursive: true });
  return temporal;
}

afterEach(async () => {
  await Promise.all(temporales.splice(0).map((ruta) => rm(ruta, { recursive: true, force: true })));
});

describe("lectura de adjuntos opcionales", () => {
  it("representa cotización ausente como null e informa el faltante", async () => {
    const temporal = await copiarProyectoFixture();
    await rm(join(temporal, "fixtures", "reto-03", "solicitudes", "sol-001", "cotizacion.txt"));
    const lectura = await leerPaqueteConFaltantes(temporal, "sol-001");
    const maestros = await leerMaestros(temporal);
    expect(lectura.faltantes).toEqual(["cotizacion"]);
    expect(lectura.paquete.cotizacion).toBeNull();
    expect(validarOrden(lectura.paquete, maestros).confirmaciones.map(({ codigo }) => codigo)).toContain("RC5");
  });

  it("representa aprobación ausente como null e informa el faltante", async () => {
    const temporal = await copiarProyectoFixture();
    await rm(join(temporal, "fixtures", "reto-03", "solicitudes", "sol-001", "aprobacion.json"));
    const lectura = await leerPaqueteConFaltantes(temporal, "sol-001");
    const maestros = await leerMaestros(temporal);
    expect(lectura.faltantes).toEqual(["aprobacion"]);
    expect(lectura.paquete.aprobacion).toBeNull();
    expect(validarOrden(lectura.paquete, maestros).bloqueos.map(({ codigo }) => codigo)).toContain("RC2");
  });

  it("representa factura adjunta ausente como null e informa el faltante", async () => {
    const temporal = await copiarProyectoFixture();
    await rm(join(temporal, "fixtures", "reto-03", "solicitudes", "sol-005", "factura.txt"));
    const lectura = await leerPaqueteConFaltantes(temporal, "sol-005");
    expect(lectura.faltantes).toEqual(["factura"]);
    expect(lectura.paquete.factura).toBeNull();
  });

  it("no confunde factura corrupta con archivo ausente", async () => {
    const temporal = await copiarProyectoFixture();
    await writeFile(
      join(temporal, "fixtures", "reto-03", "solicitudes", "sol-005", "factura.txt"),
      "contenido no válido",
      "utf8",
    );
    await expect(leerPaqueteConFaltantes(temporal, "sol-005")).rejects.toThrow("No se pudo extraer");
  });

  it("no confunde aprobación corrupta con archivo ausente", async () => {
    const temporal = await copiarProyectoFixture();
    await writeFile(
      join(temporal, "fixtures", "reto-03", "solicitudes", "sol-001", "aprobacion.json"),
      "{invalido",
      "utf8",
    );
    await expect(leerPaqueteConFaltantes(temporal, "sol-001")).rejects.toThrow("JSON inválido");
  });
});
