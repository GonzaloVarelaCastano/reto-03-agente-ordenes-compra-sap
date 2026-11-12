import { z } from "zod";
import { construirPayload, construirPayloadSinPersistir } from "../domain/construir-payload.js";
import { crearOrdenControlada } from "../domain/crear-orden.js";
import { generarEvidenciaAprobacion, prepararEvidenciaAprobacion } from "../domain/evidencia.js";
import { leerMaestros, leerPaqueteConFaltantes, leerPaqueteFixture } from "../domain/leer-fixture.js";
import { validarOrden } from "../domain/validar-orden.js";
import { SapMockAdapter } from "../sap/mock.js";
import { SessionStore } from "../agent/sessions.js";

const casoSchema = z.enum(["sol-001", "sol-002", "sol-003", "sol-004", "sol-005", "sol-006"]).describe("Identificador del caso oficial de fixture.");
const paqueteEntradaSchema = z.unknown().describe("Paquete previo; se ignora como fuente y se vuelve a leer el fixture.");
const derivadosEntradaSchema = z.unknown().describe("Valores derivados previos; se ignoran como fuente y se vuelve a validar el fixture.");
const payloadEntradaSchema = z.unknown().describe("Payload previo; se vuelve a construir y comparar desde fuentes confiables.");
const confirmadoSchema = z.boolean().optional().describe("Indicador informativo; no autoriza creación sin confirmación backend consumible.");

export type ToolContext = { directory: string; sessionId: string; sessions: SessionStore };
export type AgentTool = {
  description: string;
  args: Record<string, z.ZodType>;
  execute(args: unknown, ctx: ToolContext): Promise<string>;
};

function serializar(ok: boolean, value: unknown): string {
  return JSON.stringify(ok ? { ok: true, data: value } : { ok: false, error: String(value) });
}

function redactarArgs(args: unknown): Record<string, unknown> {
  if (args === null || typeof args !== "object" || Array.isArray(args)) return { valor_invalido: typeof args };
  const entrada = args as Record<string, unknown>;
  const seguro: Record<string, unknown> = {};
  if (typeof entrada.caso === "string") seguro.caso = entrada.caso;
  if (typeof entrada.confirmado === "boolean") seguro.confirmado = entrada.confirmado;
  return seguro;
}

async function seguro(name: string, args: unknown, ctx: ToolContext, execute: () => Promise<unknown>): Promise<string> {
  try {
    const data = await execute();
    const result = serializar(true, data);
    await ctx.sessions.addToolCall(ctx.sessionId, { ts: new Date().toISOString(), name, args: redactarArgs(args), ok: true, summary: result.slice(0, 800) });
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error de herramienta";
    const result = serializar(false, message);
    await ctx.sessions.addToolCall(ctx.sessionId, { ts: new Date().toISOString(), name, args: redactarArgs(args), ok: false, summary: message });
    return result;
  }
}

export const leer_paquete: AgentTool = {
  description: "Lee y normaliza el paquete de una solicitud oficial sin inventar datos.",
  args: { caso: casoSchema },
  async execute(args, ctx) {
    return seguro("oc_leer_paquete", args, ctx, async () => {
      const input = z.object({ caso: casoSchema }).strict().parse(args);
      const lectura = await leerPaqueteConFaltantes(ctx.directory, input.caso);
      return { ...lectura, caso: input.caso };
    });
  },
};

export const validar: AgentTool = {
  description: "Valida una solicitud oficial contra maestros aplicando RC1 a RC10 de forma determinista.",
  args: { caso: casoSchema, paquete: paqueteEntradaSchema },
  async execute(args, ctx) {
    return seguro("oc_validar", args, ctx, async () => {
      const input = z.object({ caso: casoSchema, paquete: paqueteEntradaSchema }).strict().parse(args);
      const [paquete, maestros] = await Promise.all([leerPaqueteFixture(ctx.directory, input.caso), leerMaestros(ctx.directory)]);
      const resultado = validarOrden(paquete, maestros);
      ctx.sessions.setValidationSummary(ctx.sessionId, paquete, resultado);
      return resultado;
    });
  },
};

export const construir_payload: AgentTool = {
  description: "Construye en memoria el payload SAP validado y su trazabilidad desde un caso oficial previamente validado.",
  args: { caso: casoSchema, paquete: paqueteEntradaSchema, derivados: derivadosEntradaSchema },
  async execute(args, ctx) {
    return seguro("oc_construir_payload", args, ctx, async () => {
      const input = z.object({ caso: casoSchema, paquete: paqueteEntradaSchema, derivados: derivadosEntradaSchema }).strict().parse(args);
      const [paquete, maestros, evidencia] = await Promise.all([
        leerPaqueteFixture(ctx.directory, input.caso),
        leerMaestros(ctx.directory),
        prepararEvidenciaAprobacion(ctx.directory, input.caso),
      ]);
      const validacion = validarOrden(paquete, maestros);
      const sap = new SapMockAdapter(ctx.directory);
      const existente = await sap.buscarOrdenPorReferencia(paquete.solicitud.solicitud_id);
      const construccion = existente === null
        ? await construirPayload(ctx.directory, input.caso, paquete, maestros, validacion, evidencia.sha256)
        : construirPayloadSinPersistir(ctx.directory, input.caso, paquete, maestros, validacion, evidencia.sha256);
      ctx.sessions.setValidationSummary(ctx.sessionId, paquete, validacion);
      return { payload: construccion.payload, rutaTrazabilidad: construccion.rutaTrazabilidad, trazabilidadPreservada: existente !== null };
    });
  },
};

export const generar_evidencia: AgentTool = {
  description: "Genera o prepara la evidencia TXT de una aprobación válida de un caso oficial.",
  args: { caso: casoSchema },
  async execute(args, ctx) {
    return seguro("oc_generar_evidencia", args, ctx, async () => {
      const input = z.object({ caso: casoSchema }).strict().parse(args);
      const sap = new SapMockAdapter(ctx.directory);
      if (await sap.buscarOrdenPorReferencia((await leerPaqueteFixture(ctx.directory, input.caso)).solicitud.solicitud_id) !== null) {
        return { ruta: `out/${input.caso}/aprobacion.txt`, preservada: true };
      }
      const evidencia = await generarEvidenciaAprobacion(ctx.directory, input.caso);
      return { ruta: evidencia.ruta, sha256: evidencia.sha256 };
    });
  },
};

export const crear: AgentTool = {
  description: "Intenta crear una OC validada; solo el backend puede aportar una confirmación humana de la sesión.",
  args: { caso: casoSchema, payload: payloadEntradaSchema, confirmado: confirmadoSchema },
  async execute(args, ctx) {
    return seguro("oc_crear", args, ctx, async () => {
      const input = z.object({ caso: casoSchema, payload: payloadEntradaSchema, confirmado: confirmadoSchema }).strict().parse(args);
      if (!ctx.sessions.canCreate(ctx.sessionId, input.caso)) return { resultado: "creacion_no_autorizada_por_intencion", numero_oc: null };
      const authorizationId = ctx.sessions.takeAuthorization(ctx.sessionId, input.caso);
      const result = await crearOrdenControlada(
        ctx.directory,
        input.caso,
        new SapMockAdapter(ctx.directory),
        ctx.sessions.autorizaciones,
        authorizationId ?? undefined,
        ctx.sessionId,
      );
      if (result.preparacion !== undefined) ctx.sessions.setOrderSummary(ctx.sessionId, result.preparacion, result.numero_oc);
      if (result.preparacion !== undefined && result.resultado === "pendiente_confirmacion") ctx.sessions.setPending(ctx.sessionId, result.preparacion);
      return result;
    });
  },
};

export const herramientasOC = {
  oc_leer_paquete: leer_paquete,
  oc_validar: validar,
  oc_construir_payload: construir_payload,
  oc_generar_evidencia: generar_evidencia,
  oc_crear: crear,
};
