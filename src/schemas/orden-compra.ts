import { z } from "zod";

const textoRequerido = z.string().trim().min(1);

export const excepcionOrdenSchema = z.strictObject({
  codigo: textoRequerido,
  detalle: textoRequerido,
  confirmado_por: textoRequerido.nullable(),
});

export const posicionOrdenSchema = z.strictObject({
  numero: z.number().int().positive().multipleOf(10),
  descripcion: textoRequerido.max(40),
  cantidad: z.number().positive(),
  unidad: z.enum(["UN", "H", "MES"]),
  precio_unitario: z.number().positive(),
  centro_costo: textoRequerido,
  subarea: textoRequerido,
  indicador_iva: textoRequerido,
});

export const ordenCompraSchema = z.strictObject({
  referencia: z.strictObject({
    solicitud_id: textoRequerido,
    correo_id: textoRequerido,
    cotizacion_ref: textoRequerido.nullable(),
  }),
  sociedad: z.literal("1000"),
  organizacion_compras: z.literal("1000"),
  proveedor: z.strictObject({
    codigo_sap: textoRequerido,
    nit: textoRequerido,
    nombre: textoRequerido,
  }),
  moneda: z.enum(["COP", "USD"]),
  condiciones_pago: textoRequerido,
  aprobador: z.strictObject({
    email: z.email(),
    fecha_aprobacion: z.iso.datetime({ offset: true }),
    evidencia_sha256: z.string().regex(/^[a-f0-9]{64}$/i),
  }),
  posiciones: z.array(posicionOrdenSchema).min(1),
  excepciones: z.array(excepcionOrdenSchema),
});

export type ExcepcionOrden = z.infer<typeof excepcionOrdenSchema>;
export type PosicionOrden = z.infer<typeof posicionOrdenSchema>;
export type OrdenCompra = z.infer<typeof ordenCompraSchema>;
