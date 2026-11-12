import { createHash, randomUUID } from "node:crypto";
import type { OrdenCompra } from "../schemas/orden-compra.js";
import type { SapAdapter } from "../sap/adapter.js";
import { construirPayloadSinPersistir, escribirTrazabilidad, registrarConfirmacionTrazabilidad } from "./construir-payload.js";
import { escribirEvidenciaAprobacion, prepararEvidenciaAprobacion } from "./evidencia.js";
import { leerMaestros, leerPaqueteFixture } from "./leer-fixture.js";
import { registrarControl } from "./auditoria.js";
import { validarOrden, type ResultadoValidacion } from "./validar-orden.js";

export type PreparacionOrden = {
  caso: string;
  payload: OrdenCompra;
  huellaPayload: string;
  validacion: ResultadoValidacion;
};

type Autorizacion = {
  sessionId: string;
  solicitudId: string;
  huellaPayload: string;
  confirmaciones: string[];
  confirmadoPor: string;
};

export type ConfirmacionBackend = {
  sessionId: string;
  confirmadoPor: string;
  origen: "backend_confirmation";
};

export class AutorizacionesInternas {
  private readonly autorizaciones = new Map<string, Autorizacion>();

  public constructor(private readonly actorAutorizado: (actor: string) => boolean = (actor) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(actor)) {}

  public autorizar(preparacion: PreparacionOrden, confirmacion: ConfirmacionBackend): string {
    if (preparacion.validacion.bloqueos.length > 0 || preparacion.validacion.confirmaciones.length === 0) {
      throw new Error("La orden no requiere una autorización de confirmación válida");
    }
    if (confirmacion.sessionId.trim().length === 0 || confirmacion.origen !== "backend_confirmation" || !this.actorAutorizado(confirmacion.confirmadoPor)) {
      throw new Error("Confirmación de backend inválida o actor no autorizado");
    }
    const id = randomUUID();
    this.autorizaciones.set(id, {
      sessionId: confirmacion.sessionId,
      solicitudId: preparacion.payload.referencia.solicitud_id,
      huellaPayload: preparacion.huellaPayload,
      confirmaciones: preparacion.validacion.confirmaciones.map(({ codigo }) => codigo),
      confirmadoPor: confirmacion.confirmadoPor,
    });
    return id;
  }

  public consumir(id: string, sessionId: string, solicitudId: string, huellaPayload: string, confirmaciones: string[]): string | null {
    const autorizacion = this.autorizaciones.get(id);
    if (autorizacion === undefined) return null;
    this.autorizaciones.delete(id);
    const coincidenConfirmaciones = autorizacion.confirmaciones.length === confirmaciones.length
      && autorizacion.confirmaciones.every((codigo, indice) => codigo === confirmaciones[indice]);
    if (autorizacion.sessionId !== sessionId || autorizacion.solicitudId !== solicitudId || autorizacion.huellaPayload !== huellaPayload || !coincidenConfirmaciones) {
      return null;
    }
    return autorizacion.confirmadoPor;
  }
}

function huellaPayload(payload: OrdenCompra): string {
  return createHash("sha256").update(JSON.stringify(payload), "utf8").digest("hex");
}

function serializarCanonico(valor: unknown): string {
  if (Array.isArray(valor)) return `[${valor.map(serializarCanonico).join(",")}]`;
  if (valor !== null && typeof valor === "object") {
    const registro = valor as Record<string, unknown>;
    return `{${Object.keys(registro).sort().map((clave) => `${JSON.stringify(clave)}:${serializarCanonico(registro[clave])}`).join(",")}}`;
  }
  return JSON.stringify(valor);
}

function huellaNegocio(payload: OrdenCompra): string {
  const canonico = {
    referencia: payload.referencia,
    sociedad: payload.sociedad,
    organizacion_compras: payload.organizacion_compras,
    proveedor: payload.proveedor,
    moneda: payload.moneda,
    condiciones_pago: payload.condiciones_pago,
    aprobador: payload.aprobador,
    posiciones: payload.posiciones,
    excepciones: payload.excepciones.map(({ confirmado_por: _confirmadoPor, ...excepcion }) => excepcion),
  };
  return createHash("sha256").update(serializarCanonico(canonico), "utf8").digest("hex");
}

type SapConConsultaCompleta = SapAdapter & {
  obtenerOrdenPorReferencia?: (solicitudId: string) => Promise<OrdenCompra | null>;
  crearOrdenAtomica?: (orden: OrdenCompra) => Promise<{ numero_oc: string; fecha: string; idempotente: boolean; orden: OrdenCompra }>;
};

export async function prepararOrden(directory: string, caso: string): Promise<PreparacionOrden> {
  const [paquete, maestros] = await Promise.all([leerPaqueteFixture(directory, caso), leerMaestros(directory)]);
  const validacion = validarOrden(paquete, maestros);
  if (validacion.bloqueos.length > 0) {
    throw new Error("La orden tiene bloqueos y no puede prepararse");
  }
  const evidencia = await prepararEvidenciaAprobacion(directory, caso);
  const construccion = construirPayloadSinPersistir(directory, caso, paquete, maestros, validacion, evidencia.sha256);
  return { caso, payload: construccion.payload, huellaPayload: huellaPayload(construccion.payload), validacion };
}

export type ResultadoCreacion = {
  resultado: "creada" | "idempotente" | "conflicto_existente" | "bloqueada" | "pendiente_confirmacion" | "autorizacion_invalida";
  numero_oc: string | null;
  preparacion?: PreparacionOrden;
};

export async function crearOrdenControlada(
  directory: string,
  caso: string,
  sap: SapAdapter,
  autorizaciones: AutorizacionesInternas,
  autorizacionId?: string,
  sessionId = "fase-2-interna",
): Promise<ResultadoCreacion> {
  const [paquete, maestros] = await Promise.all([leerPaqueteFixture(directory, caso), leerMaestros(directory)]);
  const validacion = validarOrden(paquete, maestros);
  const baseRegistro = {
    solicitud_id: paquete.solicitud.solicitud_id,
    retroactiva: validacion.retroactiva,
    bloqueos: validacion.bloqueos.map(({ codigo }) => codigo),
    confirmaciones: validacion.confirmaciones.map(({ codigo }) => codigo),
    ts: new Date().toISOString(),
  };
  if (validacion.bloqueos.length > 0) {
    await registrarControl(directory, { ...baseRegistro, resultado: "bloqueada", numero_oc: "" });
    return { resultado: "bloqueada", numero_oc: null };
  }
  const evidencia = await prepararEvidenciaAprobacion(directory, caso);
  const construccion = construirPayloadSinPersistir(directory, caso, paquete, maestros, validacion, evidencia.sha256);
  const preparacion: PreparacionOrden = {
    caso,
    payload: construccion.payload,
    huellaPayload: huellaPayload(construccion.payload),
    validacion,
  };
  const existente = await sap.buscarOrdenPorReferencia(paquete.solicitud.solicitud_id);
  if (existente !== null) {
    const sapExtendido = sap as SapConConsultaCompleta;
    const ordenExistente = await sapExtendido.obtenerOrdenPorReferencia?.(paquete.solicitud.solicitud_id);
    if (ordenExistente !== undefined && ordenExistente !== null && huellaNegocio(ordenExistente) !== huellaNegocio(preparacion.payload)) {
      await registrarControl(directory, { ...baseRegistro, resultado: "conflicto_existente", numero_oc: existente.numero_oc });
      return { resultado: "conflicto_existente", numero_oc: existente.numero_oc, preparacion };
    }
    await registrarControl(directory, { ...baseRegistro, resultado: "idempotente", numero_oc: existente.numero_oc });
    return { resultado: "idempotente", numero_oc: existente.numero_oc };
  }
  let payload = preparacion.payload;
  let confirmadoPor: string | null = null;
  if (validacion.confirmaciones.length > 0) {
    if (autorizacionId === undefined) {
      await registrarControl(directory, { ...baseRegistro, resultado: "pendiente_confirmacion", numero_oc: "" });
      return { resultado: "pendiente_confirmacion", numero_oc: null, preparacion };
    }
    confirmadoPor = autorizaciones.consumir(
      autorizacionId,
      sessionId,
      payload.referencia.solicitud_id,
      preparacion.huellaPayload,
      validacion.confirmaciones.map(({ codigo }) => codigo),
    );
    if (confirmadoPor === null) {
      await registrarControl(directory, { ...baseRegistro, resultado: "autorizacion_invalida", numero_oc: "" });
      return { resultado: "autorizacion_invalida", numero_oc: null, preparacion };
    }
    payload = {
      ...payload,
      excepciones: payload.excepciones.map((excepcion) => ({ ...excepcion, confirmado_por: confirmadoPor })),
    };
  }
  const sapExtendido = sap as SapConConsultaCompleta;
  const atomica = sapExtendido.crearOrdenAtomica === undefined
    ? null
    : await sapExtendido.crearOrdenAtomica(payload);
  if (atomica !== null && atomica.idempotente) {
    const resultado = huellaNegocio(atomica.orden) === huellaNegocio(preparacion.payload) ? "idempotente" : "conflicto_existente";
    await registrarControl(directory, { ...baseRegistro, resultado, numero_oc: atomica.numero_oc });
    if (resultado === "conflicto_existente") return { resultado, numero_oc: atomica.numero_oc, preparacion };
    return { resultado, numero_oc: atomica.numero_oc };
  }
  const creada = atomica ?? await sap.crearOrden(payload);
  await escribirEvidenciaAprobacion(evidencia);
  await escribirTrazabilidad(construccion, paquete.solicitud.descripcion);
  if (confirmadoPor !== null) await registrarConfirmacionTrazabilidad(construccion.rutaTrazabilidad, confirmadoPor, sessionId);
  await registrarControl(directory, { ...baseRegistro, resultado: "creada", numero_oc: creada.numero_oc });
  return { resultado: "creada", numero_oc: creada.numero_oc };
}
