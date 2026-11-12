import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { aprobacionAfirmativa, leerMaestros, leerPaqueteFixture } from "../src/domain/leer-fixture.js";
import { validarOrden, type CodigoRegla } from "../src/domain/validar-orden.js";
import type { Maestros, Paquete } from "../src/schemas/solicitud.js";

const directory = fileURLToPath(new URL("..", import.meta.url));
const maestros = await leerMaestros(directory);
const base = await leerPaqueteFixture(directory, "sol-001");

function codigos(hallazgos: ReadonlyArray<{ codigo: CodigoRegla }>): CodigoRegla[] {
  return hallazgos.map(({ codigo }) => codigo);
}

function copiarPaquete(cambios: Partial<Paquete> = {}): Paquete {
  return structuredClone({ ...base, ...cambios });
}

function copiarMaestros(cambios: Partial<Maestros> = {}): Maestros {
  return structuredClone({ ...maestros, ...cambios });
}

describe("seis fixtures oficiales", () => {
  it("sol-001 queda apta y sin excepciones", async () => {
    const resultado = validarOrden(await leerPaqueteFixture(directory, "sol-001"), maestros);
    expect(resultado).toMatchObject({ apta: true, bloqueos: [], confirmaciones: [], retroactiva: false });
  });

  it("sol-002 bloquea por RC1", async () => {
    const resultado = validarOrden(await leerPaqueteFixture(directory, "sol-002"), maestros);
    expect(codigos(resultado.bloqueos)).toEqual(["RC1"]);
  });

  it("sol-003 bloquea por RC2 y RC3", async () => {
    const resultado = validarOrden(await leerPaqueteFixture(directory, "sol-003"), maestros);
    expect(codigos(resultado.bloqueos)).toEqual(["RC2", "RC3"]);
  });

  it("sol-004 solicita RC5 con diferencia de 6 % sin modificar el importe", async () => {
    const paquete = await leerPaqueteFixture(directory, "sol-004");
    const resultado = validarOrden(paquete, maestros);
    expect(codigos(resultado.confirmaciones)).toEqual(["RC5"]);
    expect(resultado.confirmaciones[0]?.detalle).toContain("6.00 %");
    expect(paquete.solicitud.valor_total).toBe(25_000_000);
  });

  it("sol-005 solicita RC8 y marca retroactividad", async () => {
    const resultado = validarOrden(await leerPaqueteFixture(directory, "sol-005"), maestros);
    expect(codigos(resultado.confirmaciones)).toEqual(["RC8"]);
    expect(resultado.retroactiva).toBe(true);
  });

  it("sol-006 resuelve proveedor por nombre y deriva IVA y pago", async () => {
    const resultado = validarOrden(await leerPaqueteFixture(directory, "sol-006"), maestros);
    expect(resultado.derivados.proveedor?.origen).toBe("nombre");
    expect(resultado.derivados.indicador_iva).toBe("C1");
    expect(resultado.derivados.condiciones_pago).toBe("Z030");
    expect(codigos(resultado.confirmaciones)).toEqual(["RC6"]);
  });
});

describe("escenarios sintéticos RC1–RC10", () => {
  it("RC1 bloquea proveedor inactivo", () => {
    const paquete = copiarPaquete({
      solicitud: { ...base.solicitud, proveedor_nit: "901777888", proveedor_nombre: "Consultores Ágiles S.A.S." },
    });
    expect(codigos(validarOrden(paquete, maestros).bloqueos)).toContain("RC1");
  });

  it("RC1 no usa nombre conocido si se informó un NIT desconocido", () => {
    const paquete = copiarPaquete({
      solicitud: { ...base.solicitud, proveedor_nit: "999999999", proveedor_nombre: "TecnoSuministros S.A.S." },
    });
    expect(codigos(validarOrden(paquete, maestros).bloqueos)).toContain("RC1");
  });

  it("RC1 rechaza un NIT con dígito de verificación explícito inválido", () => {
    const paquete = copiarPaquete({
      solicitud: { ...base.solicitud, proveedor_nit: "900.555.111-9" },
    });
    expect(codigos(validarOrden(paquete, maestros).bloqueos)).toContain("RC1");
  });

  it("RC1 rechaza coincidencias ambiguas por nombre", () => {
    const paquete = copiarPaquete({ solicitud: { ...base.solicitud, proveedor_nit: undefined } });
    const duplicado = { ...maestros.proveedores[0]!, codigo_sap: "duplicado", nit: "999999999" };
    const resultado = validarOrden(paquete, copiarMaestros({ proveedores: [...maestros.proveedores, duplicado] }));
    expect(codigos(resultado.bloqueos)).toContain("RC1");
  });

  it("RC2 bloquea aprobación negada sin falso positivo", () => {
    expect(aprobacionAfirmativa("No aprobado")).toBe(false);
    expect(aprobacionAfirmativa("No está aprobado")).toBe(false);
    expect(aprobacionAfirmativa("No fue aprobado.")).toBe(false);
    expect(aprobacionAfirmativa("Aprobado anteriormente, pero fue revocado.")).toBe(false);
    expect(aprobacionAfirmativa("Aprobado. Después se revocó.")).toBe(false);
    expect(aprobacionAfirmativa("Aprobado.")).toBe(true);
    expect(aprobacionAfirmativa("Aprobado, proceder con la orden de compra.")).toBe(true);
    const paquete = copiarPaquete({
      aprobacion: { ...base.aprobacion!, aprobado: false, texto: "No aprobado" },
    });
    expect(codigos(validarOrden(paquete, maestros).bloqueos)).toContain("RC2");
  });

  it("RC2 y RC3 bloquean aprobador de otro centro", () => {
    const paquete = copiarPaquete({
      aprobacion: { ...base.aprobacion!, de: "fvargas@periferia-ficticia.com" },
    });
    expect(codigos(validarOrden(paquete, maestros).bloqueos)).toEqual(["RC2", "RC3"]);
  });

  it("RC3 bloquea monto superior al tope autorizado", () => {
    const paquete = copiarPaquete({
      solicitud: { ...base.solicitud, cantidad: 600, valor_total: 57_000_000 },
      cotizacion: { ...base.cotizacion!, total: 57_000_000 },
    });
    expect(codigos(validarOrden(paquete, maestros).bloqueos)).toContain("RC3");
  });

  it("RC4 bloquea subárea inválida", () => {
    const paquete = copiarPaquete({ solicitud: { ...base.solicitud, subarea: "Compras" } });
    expect(codigos(validarOrden(paquete, maestros).bloqueos)).toContain("RC4");
  });

  it("RC5 no exige confirmación con diferencia exactamente de 2 %", () => {
    const paquete = copiarPaquete({ cotizacion: { ...base.cotizacion!, total: 11_628_000 } });
    expect(codigos(validarOrden(paquete, maestros).confirmaciones)).not.toContain("RC5");
  });

  it("RC5 exige confirmación con diferencia superior a 2 %", () => {
    const paquete = copiarPaquete({ cotizacion: { ...base.cotizacion!, total: 11_628_001 } });
    expect(codigos(validarOrden(paquete, maestros).confirmaciones)).toContain("RC5");
  });

  it("RC5 exige confirmación si falta cotización", () => {
    const paquete = copiarPaquete({ cotizacion: null });
    expect(codigos(validarOrden(paquete, maestros).confirmaciones)).toContain("RC5");
  });

  it("RC6 deriva IVA válido y exige confirmación", () => {
    const solicitud = structuredClone(base.solicitud);
    delete solicitud.indicador_iva;
    const resultado = validarOrden(copiarPaquete({ solicitud }), maestros);
    expect(resultado.derivados.indicador_iva).toBe("C1");
    expect(codigos(resultado.confirmaciones)).toContain("RC6");
  });

  it("RC7 deriva pago válido e informa mediante derivados", () => {
    const solicitud = structuredClone(base.solicitud);
    delete solicitud.condiciones_pago;
    const resultado = validarOrden(copiarPaquete({ solicitud }), maestros);
    expect(resultado.derivados.condiciones_pago).toBe("Z030");
    expect(codigos(resultado.confirmaciones)).not.toContain("RC7");
  });

  it("RC6 bloquea IVA explícito inexistente", () => {
    const paquete = copiarPaquete({ solicitud: { ...base.solicitud, indicador_iva: "C99" } });
    expect(codigos(validarOrden(paquete, maestros).bloqueos)).toContain("RC6");
  });

  it("RC7 bloquea pago explícito inexistente", () => {
    const paquete = copiarPaquete({ solicitud: { ...base.solicitud, condiciones_pago: "Z999" } });
    expect(codigos(validarOrden(paquete, maestros).bloqueos)).toContain("RC7");
  });

  it("RC6 bloquea IVA derivado inexistente", () => {
    const solicitud = structuredClone(base.solicitud);
    delete solicitud.indicador_iva;
    const proveedores = maestros.proveedores.map((proveedor, indice) =>
      indice === 0 ? { ...proveedor, indicador_iva_default: "C99" } : proveedor,
    );
    const resultado = validarOrden(copiarPaquete({ solicitud }), copiarMaestros({ proveedores }));
    expect(codigos(resultado.bloqueos)).toContain("RC6");
    expect(resultado.derivados.indicador_iva).toBeUndefined();
  });

  it("RC7 bloquea pago derivado inexistente", () => {
    const solicitud = structuredClone(base.solicitud);
    delete solicitud.condiciones_pago;
    const proveedores = maestros.proveedores.map((proveedor, indice) =>
      indice === 0 ? { ...proveedor, condiciones_pago_default: "Z999" } : proveedor,
    );
    const resultado = validarOrden(copiarPaquete({ solicitud }), copiarMaestros({ proveedores }));
    expect(codigos(resultado.bloqueos)).toContain("RC7");
    expect(resultado.derivados.condiciones_pago).toBeUndefined();
  });

  it("RC9 exige confirmación si la aprobación es anterior", () => {
    const paquete = copiarPaquete({
      aprobacion: { ...base.aprobacion!, fecha: "2026-08-19T23:59:59-05:00" },
    });
    expect(codigos(validarOrden(paquete, maestros).confirmaciones)).toContain("RC9");
  });

  it("RC10 bloquea diferencia aritmética superior a uno", () => {
    const paquete = copiarPaquete({ solicitud: { ...base.solicitud, valor_total: 11_400_002 } });
    expect(codigos(validarOrden(paquete, maestros).bloqueos)).toContain("RC10");
  });

  it.each([
    [0.99, false],
    [1, false],
    [1.1, true],
    [1.5, true],
  ])("RC10 evalúa diferencia real %s", (diferencia, bloqueada) => {
    const paquete = copiarPaquete({
      solicitud: { ...base.solicitud, valor_total: base.solicitud.valor_total + diferencia },
    });
    expect(codigos(validarOrden(paquete, maestros).bloqueos).includes("RC10")).toBe(bloqueada);
  });
});
