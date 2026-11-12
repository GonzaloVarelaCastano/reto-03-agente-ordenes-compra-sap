import { describe, expect, it } from "vitest";
import { parsearJson } from "../src/domain/leer-fixture.js";
import { ordenCompraSchema } from "../src/schemas/orden-compra.js";
import { solicitudSchema } from "../src/schemas/solicitud.js";

const solicitudValida = {
  solicitud_id: "SOL-X",
  solicitante: "Solicitante",
  proveedor_nombre: "Proveedor",
  descripcion: "Servicio",
  centro_costo: "CC-1010",
  subarea: "Desarrollo",
  cantidad: 1,
  valor_unitario: 100,
  valor_total: 100,
  moneda: "COP",
  fecha_solicitud: "2026-08-20",
};

const ordenValida = {
  referencia: { solicitud_id: "SOL-X", correo_id: "correo-x", cotizacion_ref: null },
  sociedad: "1000",
  organizacion_compras: "1000",
  proveedor: { codigo_sap: "100", nit: "900", nombre: "Proveedor" },
  moneda: "COP",
  condiciones_pago: "Z030",
  aprobador: {
    email: "aprobador@example.com",
    fecha_aprobacion: "2026-08-20T10:00:00-05:00",
    evidencia_sha256: "a".repeat(64),
  },
  posiciones: [{
    numero: 10,
    descripcion: "Servicio",
    cantidad: 1,
    unidad: "UN",
    precio_unitario: 100,
    centro_costo: "CC-1010",
    subarea: "Desarrollo",
    indicador_iva: "C1",
  }],
  excepciones: [],
};

describe("schemas", () => {
  it("acepta opcionales ausentes y rechaza monto cero, negativo o no numérico", () => {
    expect(solicitudSchema.safeParse(solicitudValida).success).toBe(true);
    expect(solicitudSchema.safeParse({ ...solicitudValida, valor_total: 0 }).success).toBe(false);
    expect(solicitudSchema.safeParse({ ...solicitudValida, valor_total: -1 }).success).toBe(false);
    expect(solicitudSchema.safeParse({ ...solicitudValida, valor_total: "100" }).success).toBe(false);
  });

  it("rechaza fechas, monedas, propiedades, datos requeridos ausentes y JSON inválido", () => {
    expect(solicitudSchema.safeParse({ ...solicitudValida, fecha_solicitud: "20/08/2026" }).success).toBe(false);
    expect(solicitudSchema.safeParse({ ...solicitudValida, moneda: "EUR" }).success).toBe(false);
    expect(solicitudSchema.safeParse({ ...solicitudValida, extra: true }).success).toBe(false);
    const { descripcion: _descripcion, ...sinDescripcion } = solicitudValida;
    expect(solicitudSchema.safeParse(sinDescripcion).success).toBe(false);
    expect(() => parsearJson("{invalido", solicitudSchema, "sintético.json")).toThrow("JSON inválido: sintético.json");
  });

  it("valida el contrato exacto de OrdenCompra", () => {
    expect(ordenCompraSchema.safeParse(ordenValida).success).toBe(true);
    expect(ordenCompraSchema.safeParse({
      ...ordenValida,
      posiciones: [{ ...ordenValida.posiciones[0], descripcion: "x".repeat(41) }],
    }).success).toBe(false);
    expect(ordenCompraSchema.safeParse({ ...ordenValida, sociedad: "2000" }).success).toBe(false);
  });
});
