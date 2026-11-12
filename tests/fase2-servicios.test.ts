import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { AutorizacionesInternas, crearOrdenControlada, prepararOrden } from "../src/domain/crear-orden.js";
import { construirPayload } from "../src/domain/construir-payload.js";
import { generarEvidenciaAprobacion } from "../src/domain/evidencia.js";
import { leerMaestros, leerPaqueteFixture } from "../src/domain/leer-fixture.js";
import { validarOrden } from "../src/domain/validar-orden.js";
import { SapMockAdapter } from "../src/sap/mock.js";

const directory = fileURLToPath(new URL("..", import.meta.url));
const temporales: string[] = [];

async function entornoTemporal(): Promise<string> {
  const temporal = await mkdtemp(join(tmpdir(), "reto-03-fase2-"));
  temporales.push(temporal);
  await cp(join(directory, "fixtures"), join(temporal, "fixtures"), { recursive: true });
  return temporal;
}

afterEach(async () => {
  await Promise.all(temporales.splice(0).map((ruta) => rm(ruta, { recursive: true, force: true })));
});

describe("evidencia, payload y control", () => {
  it("genera evidencia reproducible y trazabilidad para sol-001", async () => {
    const temporal = await entornoTemporal();
    const primera = await generarEvidenciaAprobacion(temporal, "sol-001");
    const segunda = await generarEvidenciaAprobacion(temporal, "sol-001");
    const [paquete, maestros] = await Promise.all([leerPaqueteFixture(temporal, "sol-001"), leerMaestros(temporal)]);
    const construccion = await construirPayload(temporal, "sol-001", paquete, maestros, validarOrden(paquete, maestros), primera.sha256);
    const trazabilidad = JSON.parse(await readFile(construccion.rutaTrazabilidad, "utf8")) as { descripcion_original: string; campos: Record<string, unknown> };
    expect(primera.sha256).toBe(segunda.sha256);
    expect((await readFile(primera.ruta, "utf8"))).toContain("De: mlopez@periferia-ficticia.com");
    expect(construccion.payload.proveedor.codigo_sap).toBe("100234");
    expect(construccion.payload.posiciones[0]?.precio_unitario).toBe(95_000);
    expect(trazabilidad.descripcion_original).toBe(paquete.solicitud.descripcion);
    expect(trazabilidad.campos["posiciones[0].descripcion"]).toBeDefined();
    const esperados = [
      "referencia.solicitud_id", "referencia.correo_id", "referencia.cotizacion_ref", "sociedad", "organizacion_compras",
      "proveedor.codigo_sap", "proveedor.nit", "proveedor.nombre", "moneda", "condiciones_pago",
      "aprobador.email", "aprobador.fecha_aprobacion", "aprobador.evidencia_sha256",
      "posiciones[0].numero", "posiciones[0].descripcion", "posiciones[0].cantidad", "posiciones[0].unidad",
      "posiciones[0].precio_unitario", "posiciones[0].centro_costo", "posiciones[0].subarea", "posiciones[0].indicador_iva",
    ];
    expect(esperados.every((campo) => trazabilidad.campos[campo] !== undefined)).toBe(true);
    const resolver = (documento: unknown, ruta: string): unknown => ruta.split("#")[1]!.split("/").slice(1).reduce<unknown>((actual, segmento) => {
      if (actual === null || typeof actual !== "object") return undefined;
      return (actual as Record<string, unknown>)[segmento];
    }, documento);
    const proveedores = JSON.parse(await readFile(join(temporal, "fixtures", "reto-03", "maestros", "proveedores.json"), "utf8"));
    const indicadores = JSON.parse(await readFile(join(temporal, "fixtures", "reto-03", "maestros", "indicadores-iva.json"), "utf8"));
    const pagos = JSON.parse(await readFile(join(temporal, "fixtures", "reto-03", "maestros", "condiciones-pago.json"), "utf8"));
    expect(resolver(proveedores, (trazabilidad.campos["proveedor.codigo_sap"] as { ruta: string }).ruta)).toBe(construccion.payload.proveedor.codigo_sap);
    expect(resolver(indicadores, (trazabilidad.campos["posiciones[0].indicador_iva.validacion_catalogo"] as { ruta: string }).ruta)).toBe(construccion.payload.posiciones[0]!.indicador_iva);
    expect(resolver(pagos, (trazabilidad.campos["condiciones_pago.validacion_catalogo"] as { ruta: string }).ruta)).toBe(construccion.payload.condiciones_pago);
  });

  it("no fabrica evidencia si la aprobación falta o fue revocada", async () => {
    const temporal = await entornoTemporal();
    await rm(join(temporal, "fixtures", "reto-03", "solicitudes", "sol-001", "aprobacion.json"));
    await expect(generarEvidenciaAprobacion(temporal, "sol-001")).rejects.toMatchObject({ code: "ENOENT" });
    await cp(join(directory, "fixtures", "reto-03", "solicitudes", "sol-001", "aprobacion.json"), join(temporal, "fixtures", "reto-03", "solicitudes", "sol-001", "aprobacion.json"));
    const ruta = join(temporal, "fixtures", "reto-03", "solicitudes", "sol-001", "aprobacion.json");
    const original = await readFile(ruta, "utf8");
    await import("node:fs/promises").then(({ writeFile }) => writeFile(ruta, original.replace("Gerente de Tecnología", "Gerente de Tecnología\\nAprobado. Después se revocó."), "utf8"));
    await expect(generarEvidenciaAprobacion(temporal, "sol-001")).rejects.toThrow("revocada");
  });

  it("sol-004 queda pendiente y se crea solo con autorización ligada al payload", async () => {
    const temporal = await entornoTemporal();
    const sap = new SapMockAdapter(temporal);
    const autorizaciones = new AutorizacionesInternas();
    const pendiente = await crearOrdenControlada(temporal, "sol-004", sap, autorizaciones);
    expect(pendiente.resultado).toBe("pendiente_confirmacion");
    const preparacion = pendiente.preparacion!;
    const id = autorizaciones.autorizar(preparacion, { sessionId: "sesion-004", confirmadoPor: "analista@example.com", origen: "backend_confirmation" });
    const creada = await crearOrdenControlada(temporal, "sol-004", sap, autorizaciones, id, "sesion-004");
    expect(creada.resultado).toBe("creada");
    expect(creada.numero_oc).toBe("4500000001");
    const trazabilidad = JSON.parse(await readFile(join(temporal, "out", "sol-004", "trazabilidad.json"), "utf8")) as { campos: Record<string, { origen: string; ruta: string }> };
    expect(trazabilidad.campos["excepciones[0].confirmado_por"]).toEqual({ origen: "autorizacion_servidor", ruta: "session:sesion-004", regla: "Confirmación explícita consumida; actor=analista@example.com" });
  });

  it("preserva la autorización de trazabilidad tras tres reintentos idempotentes", async () => {
    const temporal = await entornoTemporal();
    const sap = new SapMockAdapter(temporal);
    const autorizaciones = new AutorizacionesInternas();
    const pendiente = await crearOrdenControlada(temporal, "sol-004", sap, autorizaciones);
    const id = autorizaciones.autorizar(pendiente.preparacion!, { sessionId: "sesion-004", confirmadoPor: "analista@example.com", origen: "backend_confirmation" });
    const creada = await crearOrdenControlada(temporal, "sol-004", sap, autorizaciones, id, "sesion-004");
    const trazabilidadRuta = join(temporal, "out", "sol-004", "trazabilidad.json");
    const antes = await readFile(trazabilidadRuta, "utf8");
    const reintentos = await Promise.all([
      crearOrdenControlada(temporal, "sol-004", sap, autorizaciones),
      crearOrdenControlada(temporal, "sol-004", sap, autorizaciones),
      crearOrdenControlada(temporal, "sol-004", sap, autorizaciones),
    ]);
    expect(reintentos.every(({ resultado, numero_oc }) => resultado === "idempotente" && numero_oc === creada.numero_oc)).toBe(true);
    expect(await readFile(trazabilidadRuta, "utf8")).toBe(antes);
  });

  it("informa conflicto sin reemplazar una OC existente si cambian datos fuente", async () => {
    const temporal = await entornoTemporal();
    const sap = new SapMockAdapter(temporal);
    const autorizaciones = new AutorizacionesInternas();
    const primera = await crearOrdenControlada(temporal, "sol-001", sap, autorizaciones);
    const rutaSolicitud = join(temporal, "fixtures", "reto-03", "solicitudes", "sol-001", "solicitud.json");
    const solicitud = await readFile(rutaSolicitud, "utf8");
    await writeFile(rutaSolicitud, solicitud.replace('"valor_unitario": 95000', '"valor_unitario": 96000').replace('"valor_total": 11400000', '"valor_total": 11520000'), "utf8");
    const conflicto = await crearOrdenControlada(temporal, "sol-001", sap, autorizaciones);
    expect(primera.resultado).toBe("creada");
    expect(conflicto).toMatchObject({ resultado: "conflicto_existente", numero_oc: primera.numero_oc });
  });

  it("prepararOrden no altera artefactos históricos de una OC creada", async () => {
    const temporal = await entornoTemporal();
    const sap = new SapMockAdapter(temporal);
    const autorizaciones = new AutorizacionesInternas();
    const pendiente = await crearOrdenControlada(temporal, "sol-004", sap, autorizaciones);
    const id = autorizaciones.autorizar(pendiente.preparacion!, { sessionId: "sesion-004", confirmadoPor: "analista@example.com", origen: "backend_confirmation" });
    await crearOrdenControlada(temporal, "sol-004", sap, autorizaciones, id, "sesion-004");
    const trazabilidadRuta = join(temporal, "out", "sol-004", "trazabilidad.json");
    const evidenciaRuta = join(temporal, "out", "sol-004", "aprobacion.txt");
    const antes = await Promise.all([readFile(trazabilidadRuta, "utf8"), readFile(evidenciaRuta, "utf8")]);
    await prepararOrden(temporal, "sol-004");
    await expect(Promise.all([readFile(trazabilidadRuta, "utf8"), readFile(evidenciaRuta, "utf8")])).resolves.toEqual(antes);
  });

  it("conserva evidencia y trazabilidad de la creación que ganó una confirmación concurrente", async () => {
    const temporal = await entornoTemporal();
    const sap = new SapMockAdapter(temporal);
    const autorizaciones = new AutorizacionesInternas();
    const pendienteA = await crearOrdenControlada(temporal, "sol-004", sap, autorizaciones);
    const pendienteB = await crearOrdenControlada(temporal, "sol-004", sap, autorizaciones);
    const idA = autorizaciones.autorizar(pendienteA.preparacion!, { sessionId: "sesion-A", confirmadoPor: "a@example.com", origen: "backend_confirmation" });
    const idB = autorizaciones.autorizar(pendienteB.preparacion!, { sessionId: "sesion-B", confirmadoPor: "b@example.com", origen: "backend_confirmation" });
    const [resultadoA, resultadoB] = await Promise.all([
      crearOrdenControlada(temporal, "sol-004", sap, autorizaciones, idA, "sesion-A"),
      crearOrdenControlada(temporal, "sol-004", sap, autorizaciones, idB, "sesion-B"),
    ]);
    expect([resultadoA.resultado, resultadoB.resultado].sort()).toEqual(["creada", "idempotente"]);
    const trazabilidad = JSON.parse(await readFile(join(temporal, "out", "sol-004", "trazabilidad.json"), "utf8")) as { campos: Record<string, { ruta: string; regla: string }> };
    const registro = trazabilidad.campos["excepciones[0].confirmado_por"]!;
    expect(["session:sesion-A", "session:sesion-B"]).toContain(registro.ruta);
    expect(["Confirmación explícita consumida; actor=a@example.com", "Confirmación explícita consumida; actor=b@example.com"]).toContain(registro.regla);
  });

  it.each([
    ["fecha de aprobación", async (temporal: string) => {
      const ruta = join(temporal, "fixtures", "reto-03", "solicitudes", "sol-001", "aprobacion.json");
      const contenido = await readFile(ruta, "utf8");
      await writeFile(ruta, contenido.replace("2026-08-21T10:02:00-05:00", "2026-08-22T10:02:00-05:00"), "utf8");
    }],
    ["aprobador autorizado", async (temporal: string) => {
      const ruta = join(temporal, "fixtures", "reto-03", "solicitudes", "sol-001", "aprobacion.json");
      const contenido = await readFile(ruta, "utf8");
      await writeFile(ruta, contenido.replace("mlopez@periferia-ficticia.com", "dgarcia@periferia-ficticia.com"), "utf8");
    }],
    ["detalle de excepción", async (temporal: string) => {
      const ruta = join(temporal, "fixtures", "reto-03", "solicitudes", "sol-004", "cotizacion.txt");
      const contenido = await readFile(ruta, "utf8");
      await writeFile(ruta, contenido.replace("TOTAL (IVA incluido): COP 26.500.000", "TOTAL (IVA incluido): COP 27.000.000"), "utf8");
    }],
  ])("detecta conflicto por cambio de %s", async (_nombre, modificar) => {
    const temporal = await entornoTemporal();
    const sap = new SapMockAdapter(temporal);
    const autorizaciones = new AutorizacionesInternas();
    const caso = _nombre === "detalle de excepción" ? "sol-004" : "sol-001";
    if (caso === "sol-004") {
      const pendiente = await crearOrdenControlada(temporal, caso, sap, autorizaciones);
      const id = autorizaciones.autorizar(pendiente.preparacion!, { sessionId: "sesion-004", confirmadoPor: "analista@example.com", origen: "backend_confirmation" });
      await crearOrdenControlada(temporal, caso, sap, autorizaciones, id, "sesion-004");
    } else {
      await crearOrdenControlada(temporal, caso, sap, autorizaciones);
    }
    await modificar(temporal);
    const resultado = await crearOrdenControlada(temporal, caso, sap, autorizaciones);
    expect(resultado.resultado).toBe("conflicto_existente");
  });

  it("rechaza actores no autorizados para confirmar", async () => {
    const temporal = await entornoTemporal();
    const sap = new SapMockAdapter(temporal);
    const autorizaciones = new AutorizacionesInternas(() => false);
    const pendiente = await crearOrdenControlada(temporal, "sol-004", sap, autorizaciones);
    expect(() => autorizaciones.autorizar(pendiente.preparacion!, { sessionId: "sesion-004", confirmadoPor: "analista@example.com", origen: "backend_confirmation" })).toThrow("actor no autorizado");
  });

  it("rechaza autorización que no corresponde al payload validado", async () => {
    const temporal = await entornoTemporal();
    const sap = new SapMockAdapter(temporal);
    const autorizaciones = new AutorizacionesInternas();
    const pendiente = await crearOrdenControlada(temporal, "sol-004", sap, autorizaciones);
    const id = autorizaciones.autorizar(pendiente.preparacion!, { sessionId: "sesion-004", confirmadoPor: "analista@example.com", origen: "backend_confirmation" });
    const consumida = autorizaciones.consumir(id, "sesion-004", "SOL-2026-004", "huella-modificada", ["RC5"]);
    expect(consumida).toBeNull();
    const invalida = await crearOrdenControlada(temporal, "sol-004", sap, autorizaciones, id);
    expect(invalida.resultado).toBe("autorizacion_invalida");
  });

  it("bloquea sol-002 y sol-003 incluso ante autorización", async () => {
    const temporal = await entornoTemporal();
    const sap = new SapMockAdapter(temporal);
    const autorizaciones = new AutorizacionesInternas();
    expect((await crearOrdenControlada(temporal, "sol-002", sap, autorizaciones, "falsa")).resultado).toBe("bloqueada");
    expect((await crearOrdenControlada(temporal, "sol-003", sap, autorizaciones, "falsa")).resultado).toBe("bloqueada");
  });

  it("mantiene sol-005 y sol-006 pendientes y registra CSV con columnas exactas", async () => {
    const temporal = await entornoTemporal();
    const sap = new SapMockAdapter(temporal);
    const autorizaciones = new AutorizacionesInternas();
    const retroactiva = await crearOrdenControlada(temporal, "sol-005", sap, autorizaciones);
    const iva = await crearOrdenControlada(temporal, "sol-006", sap, autorizaciones);
    const lineas = (await readFile(join(temporal, "out", "control.csv"), "utf8")).trim().split(/\r?\n/);
    expect(retroactiva.resultado).toBe("pendiente_confirmacion");
    expect(retroactiva.preparacion?.validacion.retroactiva).toBe(true);
    expect(iva.resultado).toBe("pendiente_confirmacion");
    expect(lineas[0]).toBe("solicitud_id,resultado,numero_oc,retroactiva,bloqueos,confirmaciones,ts");
    expect(lineas[1]).toContain('"[""RC8""]"');
    expect(lineas[2]).toContain('"[""RC6""]"');
    expect(lineas).toHaveLength(3);
  });

  it("clasifica creación concurrente como creada e idempotente con un único encabezado CSV", async () => {
    const temporal = await entornoTemporal();
    const sap = new SapMockAdapter(temporal);
    const autorizaciones = new AutorizacionesInternas();
    const [primera, segunda] = await Promise.all([
      crearOrdenControlada(temporal, "sol-001", sap, autorizaciones),
      crearOrdenControlada(temporal, "sol-001", sap, autorizaciones),
    ]);
    const resultados = [primera.resultado, segunda.resultado].sort();
    const lineas = (await readFile(join(temporal, "out", "control.csv"), "utf8")).trim().split(/\r?\n/);
    expect(resultados).toEqual(["creada", "idempotente"]);
    expect(lineas.filter((linea) => linea === "solicitud_id,resultado,numero_oc,retroactiva,bloqueos,confirmaciones,ts")).toHaveLength(1);
  });

  it("registra reintento idempotente", async () => {
    const temporal = await entornoTemporal();
    const sap = new SapMockAdapter(temporal);
    const autorizaciones = new AutorizacionesInternas();
    const primera = await crearOrdenControlada(temporal, "sol-001", sap, autorizaciones);
    const segunda = await crearOrdenControlada(temporal, "sol-001", sap, autorizaciones);
    expect(primera.resultado).toBe("creada");
    expect(segunda.resultado).toBe("idempotente");
    expect(segunda.numero_oc).toBe(primera.numero_oc);
  });

  it("rechaza un payload con IVA inexistente antes de construir", async () => {
    const temporal = await entornoTemporal();
    const [paquete, maestros] = await Promise.all([leerPaqueteFixture(temporal, "sol-001"), leerMaestros(temporal)]);
    const alterado = { ...paquete, solicitud: { ...paquete.solicitud, indicador_iva: "C99" } };
    const evidencia = await generarEvidenciaAprobacion(temporal, "sol-001");
    await expect(construirPayload(temporal, "sol-001", alterado, maestros, validarOrden(alterado, maestros), evidencia.sha256)).rejects.toThrow("bloqueos");
  });
});
