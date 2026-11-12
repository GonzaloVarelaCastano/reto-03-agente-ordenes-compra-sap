import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { ZodType } from "zod";
import {
  maestrosSchema,
  paqueteSchema,
  solicitudSchema,
  type Maestros,
  type Paquete,
} from "../schemas/solicitud.js";
import { analizarMontoColombiano, extraerTotalCotizacion } from "./normalizacion.js";

const correoFixtureSchema = paqueteSchema.shape.correo.extend({
  para: zString(),
  cuerpo: zString(),
  adjuntos: stringArray(),
  nota_fixture: zString(),
});

export const aprobacionFixtureSchema = paqueteSchema.shape.aprobacion.unwrap().omit({ aprobado: true, texto: true }).extend({
  para: zString(),
  cc: stringArray(),
  asunto: zString(),
  cuerpo: zString(),
});

function zString() {
  return solicitudSchema.shape.solicitud_id;
}

function stringArray() {
  return zString().array();
}

export function parsearJson<T>(texto: string, schema: ZodType<T>, origen: string): T {
  let valor: unknown;
  try {
    valor = JSON.parse(texto);
  } catch {
    throw new Error(`JSON inválido: ${origen}`);
  }
  return schema.parse(valor);
}

async function leerJson<T>(ruta: string, schema: ZodType<T>): Promise<T> {
  return parsearJson(await readFile(ruta, "utf8"), schema, ruta);
}

function extraer(texto: string, patron: RegExp, campo: string): string {
  const valor = texto.match(patron)?.[1]?.trim();
  if (valor === undefined || valor.length === 0) {
    throw new Error(`No se pudo extraer ${campo}`);
  }
  return valor;
}

export function aprobacionAfirmativa(cuerpo: string): boolean {
  const normalizado = cuerpo.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLocaleLowerCase("es-CO");
  const negada = /\b(?:no|sin)\b[^.!?\n]{0,40}\baprobado\b/.test(normalizado);
  const revocada = /\baprobado\b[\s\S]*\b(?:revocad[oa]|revoco|anulad[oa]|anulo|cancelad[oa]|cancelo)\b/.test(normalizado);
  return /\baprobado\b/.test(normalizado) && !negada && !revocada;
}

export type AdjuntoFaltante = "cotizacion" | "aprobacion" | "factura";

export type LecturaPaquete = {
  paquete: Paquete;
  faltantes: AdjuntoFaltante[];
};

function esArchivoAusente(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

async function leerOpcional<T>(lector: () => Promise<T>): Promise<T | null> {
  try {
    return await lector();
  } catch (error) {
    if (esArchivoAusente(error)) {
      return null;
    }
    throw error;
  }
}

export async function leerMaestros(directory: string): Promise<Maestros> {
  const raiz = join(directory, "fixtures", "reto-03", "maestros");
  return maestrosSchema.parse({
    proveedores: await leerJson(join(raiz, "proveedores.json"), maestrosSchema.shape.proveedores),
    centrosCosto: await leerJson(join(raiz, "centros-costo.json"), maestrosSchema.shape.centrosCosto),
    indicadoresIva: await leerJson(join(raiz, "indicadores-iva.json"), maestrosSchema.shape.indicadoresIva),
    condicionesPago: await leerJson(join(raiz, "condiciones-pago.json"), maestrosSchema.shape.condicionesPago),
  });
}

export async function leerPaqueteConFaltantes(directory: string, caso: string): Promise<LecturaPaquete> {
  if (!/^sol-00[1-6]$/.test(caso)) {
    throw new Error("Caso de fixture inválido");
  }
  const raiz = join(directory, "fixtures", "reto-03", "solicitudes", caso);
  const correo = await leerJson(join(raiz, "correo.json"), correoFixtureSchema);
  const solicitud = await leerJson(join(raiz, "solicitud.json"), solicitudSchema);
  const aprobacion = await leerOpcional(() => leerJson(join(raiz, "aprobacion.json"), aprobacionFixtureSchema));
  const cotizacionTexto = await leerOpcional(() => readFile(join(raiz, "cotizacion.txt"), "utf8"));
  const faltantes: AdjuntoFaltante[] = [];
  if (cotizacionTexto === null) faltantes.push("cotizacion");
  if (aprobacion === null) faltantes.push("aprobacion");
  const cotizacion = cotizacionTexto === null ? null : {
    proveedor: extraer(cotizacionTexto, /^Proveedor:\s*(.+)$/im, "proveedor de cotización"),
    nit: extraer(cotizacionTexto, /^NIT:\s*(.+)$/im, "NIT de cotización"),
    total: extraerTotalCotizacion(cotizacionTexto),
    moneda: extraer(cotizacionTexto, /^TOTAL \(IVA incluido\):\s*(COP|USD)\s+/im, "moneda"),
    validez_hasta: null,
    texto: cotizacionTexto,
  };
  let factura: Paquete["factura"] = null;
  if (correo.adjuntos.includes("factura.pdf")) {
    const facturaTexto = await leerOpcional(() => readFile(join(raiz, "factura.txt"), "utf8"));
    if (facturaTexto === null) {
      faltantes.push("factura");
    } else {
      factura = {
        numero: extraer(facturaTexto, /^FACTURA ELECTRÓNICA DE VENTA No\.\s*(.+)$/im, "número de factura"),
        fecha: extraer(facturaTexto, /^Fecha de emisión:\s*(\d{4}-\d{2}-\d{2})$/im, "fecha de factura"),
        total: analizarMontoColombiano(extraer(facturaTexto, /^TOTAL:\s*(?:COP|USD)\s+(.+)$/im, "total de factura")),
      };
    }
  }
  const paquete = paqueteSchema.parse({
    correo: { id: correo.id, de: correo.de, asunto: correo.asunto, fecha: correo.fecha },
    solicitud,
    cotizacion,
    aprobacion: aprobacion === null ? null : {
      de: aprobacion.de,
      fecha: aprobacion.fecha,
      aprobado: aprobacionAfirmativa(aprobacion.cuerpo),
      texto: aprobacion.cuerpo,
    },
    factura,
  });
  return { paquete, faltantes };
}

export async function leerPaqueteFixture(directory: string, caso: string): Promise<Paquete> {
  return (await leerPaqueteConFaltantes(directory, caso)).paquete;
}
