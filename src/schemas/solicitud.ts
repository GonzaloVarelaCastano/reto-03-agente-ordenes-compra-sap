import { z } from "zod";

const textoRequerido = z.string().trim().min(1);
const fechaIso = z.iso.date();
const fechaHoraIso = z.iso.datetime({ offset: true });
const montoPositivo = z.number().positive();
const correoSchema = z.string().trim().regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/u);

export const monedaSchema = z.enum(["COP", "USD"]);

export const proveedorSchema = z.strictObject({
  codigo_sap: textoRequerido,
  nit: textoRequerido,
  nombre: textoRequerido,
  condiciones_pago_default: textoRequerido,
  indicador_iva_default: textoRequerido,
  activo: z.boolean(),
});

export const aprobadorCentroSchema = z.strictObject({
  email: correoSchema,
  nombre: textoRequerido,
  tope: montoPositivo,
});

export const centroCostoSchema = z.strictObject({
  centro_costo: textoRequerido,
  nombre: textoRequerido,
  subareas: z.array(textoRequerido).min(1),
  aprobadores: z.array(aprobadorCentroSchema),
});

export const indicadorIvaSchema = z.strictObject({
  codigo: textoRequerido,
  descripcion: textoRequerido,
  tasa: z.number().min(0).max(1),
});

export const condicionPagoSchema = z.strictObject({
  codigo: textoRequerido,
  descripcion: textoRequerido,
  dias: z.number().int().nonnegative(),
});

export const solicitudSchema = z.strictObject({
  solicitud_id: textoRequerido,
  solicitante: textoRequerido,
  proveedor_nombre: textoRequerido,
  proveedor_nit: textoRequerido.optional(),
  descripcion: textoRequerido,
  centro_costo: textoRequerido,
  subarea: textoRequerido,
  cantidad: montoPositivo,
  valor_unitario: montoPositivo,
  valor_total: montoPositivo,
  moneda: monedaSchema,
  indicador_iva: textoRequerido.optional(),
  condiciones_pago: textoRequerido.optional(),
  fecha_solicitud: fechaIso,
});

export const correoPaqueteSchema = z.strictObject({
  id: textoRequerido,
  de: correoSchema,
  asunto: textoRequerido,
  fecha: fechaHoraIso,
});

export const cotizacionPaqueteSchema = z.strictObject({
  proveedor: textoRequerido,
  nit: textoRequerido.nullable(),
  total: montoPositivo,
  moneda: monedaSchema,
  validez_hasta: fechaIso.nullable(),
  texto: textoRequerido,
});

export const aprobacionPaqueteSchema = z.strictObject({
  de: correoSchema,
  fecha: fechaHoraIso,
  aprobado: z.boolean(),
  texto: textoRequerido,
});

export const facturaPaqueteSchema = z.strictObject({
  numero: textoRequerido,
  fecha: fechaIso,
  total: montoPositivo,
});

export const paqueteSchema = z.strictObject({
  correo: correoPaqueteSchema,
  solicitud: solicitudSchema,
  cotizacion: cotizacionPaqueteSchema.nullable(),
  aprobacion: aprobacionPaqueteSchema.nullable(),
  factura: facturaPaqueteSchema.nullable(),
});

export const maestrosSchema = z.strictObject({
  proveedores: z.array(proveedorSchema),
  centrosCosto: z.array(centroCostoSchema),
  indicadoresIva: z.array(indicadorIvaSchema),
  condicionesPago: z.array(condicionPagoSchema),
});

export type Moneda = z.infer<typeof monedaSchema>;
export type Proveedor = z.infer<typeof proveedorSchema>;
export type AprobadorCentro = z.infer<typeof aprobadorCentroSchema>;
export type CentroCosto = z.infer<typeof centroCostoSchema>;
export type IndicadorIva = z.infer<typeof indicadorIvaSchema>;
export type CondicionPago = z.infer<typeof condicionPagoSchema>;
export type Solicitud = z.infer<typeof solicitudSchema>;
export type CorreoPaquete = z.infer<typeof correoPaqueteSchema>;
export type CotizacionPaquete = z.infer<typeof cotizacionPaqueteSchema>;
export type AprobacionPaquete = z.infer<typeof aprobacionPaqueteSchema>;
export type FacturaPaquete = z.infer<typeof facturaPaqueteSchema>;
export type Paquete = z.infer<typeof paqueteSchema>;
export type Maestros = z.infer<typeof maestrosSchema>;
