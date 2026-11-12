import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { ordenCompraSchema, type OrdenCompra } from "../schemas/orden-compra.js";
import type { Maestros, Paquete } from "../schemas/solicitud.js";
import type { ResultadoValidacion } from "./validar-orden.js";
import { normalizarTexto } from "./normalizacion.js";

export type TrazabilidadCampo = {
  origen: "solicitud" | "correo" | "cotizacion" | "aprobacion" | "maestro" | "derivado" | "autorizacion_servidor";
  ruta: string;
  regla?: string;
};

export type ConstruccionPayload = {
  payload: OrdenCompra;
  trazabilidad: Record<string, TrazabilidadCampo>;
  rutaTrazabilidad: string;
};

type ArchivoTrazabilidad = {
  descripcion_original: string;
  campos: Record<string, TrazabilidadCampo>;
};

function extraerReferenciaCotizacion(texto: string | null): string | null {
  if (texto === null) return null;
  return texto.match(/^COTIZACIÓN\s+([^\r\n]+)$/im)?.[1]?.trim() ?? null;
}

function derivarUnidad(descripcion: string): "H" | "UN" {
  return /\bhoras?\b/.test(normalizarTexto(descripcion)) ? "H" : "UN";
}

function descripcionSap(descripcion: string): string {
  return descripcion.slice(0, 40);
}

function origenSolicitud(caso: string, campo: string): TrazabilidadCampo {
  return { origen: "solicitud", ruta: `fixtures/reto-03/solicitudes/${caso}/solicitud.json#/${campo}` };
}

function indiceProveedor(maestros: Maestros, codigoSap: string): number {
  const indice = maestros.proveedores.findIndex(({ codigo_sap }) => codigo_sap === codigoSap);
  if (indice < 0) throw new Error("Proveedor de trazabilidad ausente");
  return indice;
}

function indiceIndicadorIva(maestros: Maestros, codigo: string): number {
  const indice = maestros.indicadoresIva.findIndex((actual) => actual.codigo === codigo);
  if (indice < 0) throw new Error("Indicador IVA de trazabilidad ausente");
  return indice;
}

function indiceCondicionPago(maestros: Maestros, codigo: string): number {
  const indice = maestros.condicionesPago.findIndex((actual) => actual.codigo === codigo);
  if (indice < 0) throw new Error("Condición de pago de trazabilidad ausente");
  return indice;
}

export function construirPayloadSinPersistir(
  directory: string,
  caso: string,
  paquete: Paquete,
  maestros: Maestros,
  validacion: ResultadoValidacion,
  evidenciaSha256: string,
): ConstruccionPayload {
  if (validacion.bloqueos.length > 0) throw new Error("No se puede construir el payload con bloqueos");
  const proveedor = validacion.derivados.proveedor;
  if (proveedor === undefined) throw new Error("Proveedor validado ausente");
  const indicadorIva = paquete.solicitud.indicador_iva ?? validacion.derivados.indicador_iva;
  const condicionesPago = paquete.solicitud.condiciones_pago ?? validacion.derivados.condiciones_pago;
  if (indicadorIva === undefined || !maestros.indicadoresIva.some(({ codigo }) => codigo === indicadorIva)) throw new Error("Indicador de IVA inválido");
  if (condicionesPago === undefined || !maestros.condicionesPago.some(({ codigo }) => codigo === condicionesPago)) throw new Error("Condición de pago inválida");
  if (paquete.aprobacion === null || !paquete.aprobacion.aprobado) throw new Error("Aprobación válida ausente");
  const cotizacionRef = extraerReferenciaCotizacion(paquete.cotizacion?.texto ?? null);
  const payload = ordenCompraSchema.parse({
    referencia: { solicitud_id: paquete.solicitud.solicitud_id, correo_id: paquete.correo.id, cotizacion_ref: cotizacionRef },
    sociedad: "1000",
    organizacion_compras: "1000",
    proveedor: { codigo_sap: proveedor.codigo_sap, nit: proveedor.nit, nombre: proveedor.nombre },
    moneda: paquete.solicitud.moneda,
    condiciones_pago: condicionesPago,
    aprobador: { email: paquete.aprobacion.de, fecha_aprobacion: paquete.aprobacion.fecha, evidencia_sha256: evidenciaSha256 },
    posiciones: [{
      numero: 10,
      descripcion: descripcionSap(paquete.solicitud.descripcion),
      cantidad: paquete.solicitud.cantidad,
      unidad: derivarUnidad(paquete.solicitud.descripcion),
      precio_unitario: paquete.solicitud.valor_unitario,
      centro_costo: paquete.solicitud.centro_costo,
      subarea: paquete.solicitud.subarea,
      indicador_iva: indicadorIva,
    }],
    excepciones: validacion.confirmaciones.map(({ codigo, detalle }) => ({ codigo, detalle, confirmado_por: null })),
  });
  const proveedorIndice = indiceProveedor(maestros, proveedor.codigo_sap);
  const indicadorIndice = indiceIndicadorIva(maestros, indicadorIva);
  const pagoIndice = indiceCondicionPago(maestros, condicionesPago);
  const proveedorRuta = `fixtures/reto-03/maestros/proveedores.json#/${proveedorIndice}`;
  const aprobacionRuta = `fixtures/reto-03/solicitudes/${caso}/aprobacion.json`;
  const trazabilidad: Record<string, TrazabilidadCampo> = {
    "referencia.solicitud_id": origenSolicitud(caso, "solicitud_id"),
    "referencia.correo_id": { origen: "correo", ruta: `fixtures/reto-03/solicitudes/${caso}/correo.json#/id` },
    "referencia.cotizacion_ref": cotizacionRef === null
      ? { origen: "derivado", ruta: `fixtures/reto-03/solicitudes/${caso}/cotizacion.txt`, regla: "Referencia no extraíble; se preserva null" }
      : { origen: "cotizacion", ruta: `fixtures/reto-03/solicitudes/${caso}/cotizacion.txt#COTIZACIÓN` },
    sociedad: { origen: "derivado", ruta: "PRD#7.4", regla: "Literal 1000" },
    organizacion_compras: { origen: "derivado", ruta: "PRD#7.4", regla: "Literal 1000" },
    "proveedor.codigo_sap": { origen: "maestro", ruta: `${proveedorRuta}/codigo_sap`, regla: `RC1 por ${proveedor.origen}` },
    "proveedor.nit": { origen: "maestro", ruta: `${proveedorRuta}/nit`, regla: "RC1" },
    "proveedor.nombre": { origen: "maestro", ruta: `${proveedorRuta}/nombre`, regla: "RC1" },
    moneda: origenSolicitud(caso, "moneda"),
    condiciones_pago: paquete.solicitud.condiciones_pago === undefined
      ? { origen: "derivado", ruta: `${proveedorRuta}/condiciones_pago_default`, regla: "RC7" }
      : origenSolicitud(caso, "condiciones_pago"),
    "condiciones_pago.validacion_catalogo": { origen: "maestro", ruta: `fixtures/reto-03/maestros/condiciones-pago.json#/${pagoIndice}/codigo`, regla: "RC7: código validado en catálogo" },
    "aprobador.email": { origen: "aprobacion", ruta: `${aprobacionRuta}#/de` },
    "aprobador.fecha_aprobacion": { origen: "aprobacion", ruta: `${aprobacionRuta}#/fecha` },
    "aprobador.evidencia_sha256": { origen: "derivado", ruta: `out/${caso}/aprobacion.txt`, regla: "SHA-256 UTF-8 del contenido canónico" },
    "posiciones[0].numero": { origen: "derivado", ruta: "PRD#7.4", regla: "Primera posición 10" },
    "posiciones[0].descripcion": { origen: "solicitud", ruta: `fixtures/reto-03/solicitudes/${caso}/solicitud.json#/descripcion`, regla: "Texto SAP truncado a 40 caracteres; original conservado en descripcion_original" },
    "posiciones[0].cantidad": origenSolicitud(caso, "cantidad"),
    "posiciones[0].unidad": { origen: "derivado", ruta: `fixtures/reto-03/solicitudes/${caso}/solicitud.json#/descripcion`, regla: "H si contiene hora(s); UN por defecto" },
    "posiciones[0].precio_unitario": origenSolicitud(caso, "valor_unitario"),
    "posiciones[0].centro_costo": origenSolicitud(caso, "centro_costo"),
    "posiciones[0].subarea": origenSolicitud(caso, "subarea"),
    "posiciones[0].indicador_iva": paquete.solicitud.indicador_iva === undefined
      ? { origen: "derivado", ruta: `${proveedorRuta}/indicador_iva_default`, regla: "RC6" }
      : origenSolicitud(caso, "indicador_iva"),
    "posiciones[0].indicador_iva.validacion_catalogo": { origen: "maestro", ruta: `fixtures/reto-03/maestros/indicadores-iva.json#/${indicadorIndice}/codigo`, regla: "RC6: código validado en catálogo" },
  };
  payload.excepciones.forEach((excepcion, indice) => {
    trazabilidad[`excepciones[${indice}].codigo`] = { origen: "derivado", ruta: "src/domain/validar-orden.ts", regla: excepcion.codigo };
    trazabilidad[`excepciones[${indice}].detalle`] = { origen: "derivado", ruta: "src/domain/validar-orden.ts", regla: excepcion.codigo };
    trazabilidad[`excepciones[${indice}].confirmado_por`] = { origen: "derivado", ruta: "estado de autorización pendiente", regla: "Pendiente de confirmación humana" };
  });
  return { payload, trazabilidad, rutaTrazabilidad: join(directory, "out", caso, "trazabilidad.json") };
}

export async function escribirTrazabilidad(construccion: ConstruccionPayload, descripcionOriginal: string): Promise<void> {
  await mkdir(dirname(construccion.rutaTrazabilidad), { recursive: true });
  await writeFile(construccion.rutaTrazabilidad, `${JSON.stringify({ descripcion_original: descripcionOriginal, campos: construccion.trazabilidad }, null, 2)}\n`, "utf8");
}

export async function construirPayload(
  directory: string,
  caso: string,
  paquete: Paquete,
  maestros: Maestros,
  validacion: ResultadoValidacion,
  evidenciaSha256: string,
): Promise<ConstruccionPayload> {
  const construccion = construirPayloadSinPersistir(directory, caso, paquete, maestros, validacion, evidenciaSha256);
  await escribirTrazabilidad(construccion, paquete.solicitud.descripcion);
  return construccion;
}

export async function registrarConfirmacionTrazabilidad(
  rutaTrazabilidad: string,
  confirmadoPor: string,
  sessionId: string,
): Promise<void> {
  const archivo = JSON.parse(await readFile(rutaTrazabilidad, "utf8")) as ArchivoTrazabilidad;
  Object.keys(archivo.campos)
    .filter((campo) => campo.endsWith(".confirmado_por"))
    .forEach((campo) => {
      archivo.campos[campo] = {
        origen: "autorizacion_servidor",
        ruta: `session:${sessionId}`,
        regla: `Confirmación explícita consumida; actor=${confirmadoPor}`,
      };
    });
  await writeFile(rutaTrazabilidad, `${JSON.stringify(archivo, null, 2)}\n`, "utf8");
}
