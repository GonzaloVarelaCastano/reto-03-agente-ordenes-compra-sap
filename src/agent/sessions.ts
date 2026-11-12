import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { AutorizacionesInternas, type PreparacionOrden } from "../domain/crear-orden.js";
import type { Paquete } from "../schemas/solicitud.js";
import type { ResultadoValidacion } from "../domain/validar-orden.js";
import type { LlmMessage } from "../llm/adapter.js";

export const sessionIdSchema = z.string().trim().min(1).max(128).regex(/^[a-zA-Z0-9_-]+$/);

export type ToolCallRecord = { ts: string; name: string; args: Record<string, unknown>; ok: boolean; summary: string };
export type SessionMessage = { role: "user" | "assistant" | "tool"; content: string; ts: string };
type PendingConfirmation = { preparacion: PreparacionOrden; motivos: string[]; estado: "pendiente" | "autorizada" | "rechazada" | "consumida"; autorizacionId?: string };
export type OrderSummary = { solicitudId: string; proveedor: string | null; codigoSap: string | null; moneda: string | null; importe: number | null; centroCosto: string | null; subarea: string | null; aprobador: string | null; condicionesPago: string | null; indicadorIva: string | null; bloqueos: string[]; confirmaciones: string[]; retroactiva: boolean; numeroOc: string | null };
export type AgentSession = { id: string; history: SessionMessage[]; providerHistory: LlmMessage[]; toolCalls: ToolCallRecord[]; processing: boolean; tokensUsed: number; pending: PendingConfirmation | null; createAllowed: boolean; authorizedCase: string | null; orderSummary: OrderSummary | null };

type StoredSession = { value: AgentSession; touchedAt: number };
export class SessionStore {
  private readonly sessions = new Map<string, StoredSession>();
  public readonly autorizaciones = new AutorizacionesInternas();

  public constructor(private readonly directory: string, private readonly maxSessions = 500, private readonly ttlMs = 3_600_000) {}

  private purge(now = Date.now()): void {
    for (const [id, stored] of this.sessions) if (now - stored.touchedAt > this.ttlMs) this.sessions.delete(id);
  }

  private evictForCapacity(): void {
    while (this.sessions.size >= this.maxSessions) {
      const oldest = this.sessions.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.sessions.delete(oldest);
    }
  }

  public get(sessionId: string): AgentSession {
    const id = sessionIdSchema.parse(sessionId); this.purge();
    const existing = this.sessions.get(id);
    if (existing !== undefined) { existing.touchedAt = Date.now(); return existing.value; }
    this.evictForCapacity();
    const session: AgentSession = { id, history: [], providerHistory: [], toolCalls: [], processing: false, tokensUsed: 0, pending: null, createAllowed: false, authorizedCase: null, orderSummary: null };
    this.sessions.set(id, { value: session, touchedAt: Date.now() });
    return session;
  }

  public find(sessionId: string): AgentSession | null {
    const id = sessionIdSchema.parse(sessionId); this.purge();
    const stored = this.sessions.get(id);
    if (stored === undefined) return null;
    stored.touchedAt = Date.now(); return stored.value;
  }

  public publicView(sessionId: string) {
    const session = this.find(sessionId); if (session === null) return null;
    return {
      id: session.id,
      history: session.history,
      toolCalls: session.toolCalls,
      processing: session.processing,
      tokensUsed: session.tokensUsed,
      confirmation: session.pending === null ? null : { estado: session.pending.estado, motivos: session.pending.motivos, solicitudId: session.pending.preparacion.payload.referencia.solicitud_id },
      orderSummary: session.orderSummary,
    };
  }

  public addMessage(sessionId: string, role: SessionMessage["role"], content: string): void {
    this.get(sessionId).history.push({ role, content, ts: new Date().toISOString() });
  }

  public addProviderMessage(sessionId: string, message: LlmMessage): void { this.get(sessionId).providerHistory.push(message); }
  public providerMessages(sessionId: string): LlmMessage[] { return this.get(sessionId).providerHistory; }
  public setCreationPolicy(sessionId: string, allowed: boolean, caso: string | null): void {
    const session = this.get(sessionId);
    session.createAllowed = allowed;
    session.authorizedCase = allowed ? caso : null;
  }
  public canCreate(sessionId: string, caso: string): boolean {
    const session = this.get(sessionId);
    return session.createAllowed && session.authorizedCase === caso;
  }

  public async addToolCall(sessionId: string, record: ToolCallRecord): Promise<void> {
    const session = this.get(sessionId);
    session.toolCalls.push(record);
    try {
      await mkdir(join(this.directory, "out"), { recursive: true });
      await appendFile(join(this.directory, "out", "log.jsonl"), `${JSON.stringify({ sessionId, ...record })}\n`, "utf8");
    } catch { }
  }

  public setValidationSummary(sessionId: string, paquete: Paquete, validacion: ResultadoValidacion): void {
    const session = this.get(sessionId);
    session.orderSummary = {
      solicitudId: paquete.solicitud.solicitud_id,
      proveedor: validacion.derivados.proveedor?.nombre ?? paquete.solicitud.proveedor_nombre ?? null,
      codigoSap: validacion.derivados.proveedor?.codigo_sap ?? null,
      moneda: paquete.solicitud.moneda ?? null,
      importe: paquete.solicitud.valor_total ?? null,
      centroCosto: paquete.solicitud.centro_costo ?? null,
      subarea: paquete.solicitud.subarea ?? null,
      aprobador: paquete.aprobacion?.de ?? null,
      condicionesPago: paquete.solicitud.condiciones_pago ?? validacion.derivados.condiciones_pago ?? null,
      indicadorIva: paquete.solicitud.indicador_iva ?? validacion.derivados.indicador_iva ?? null,
      bloqueos: validacion.bloqueos.map(({ codigo }) => codigo),
      confirmaciones: validacion.confirmaciones.map(({ codigo }) => codigo),
      retroactiva: validacion.retroactiva,
      numeroOc: null,
    };
  }

  public setOrderSummary(sessionId: string, preparacion: PreparacionOrden, numeroOc: string | null = null): void {
    const { payload, validacion } = preparacion;
    const position = payload.posiciones[0];
    const session = this.get(sessionId);
    session.orderSummary = {
      solicitudId: payload.referencia.solicitud_id,
      proveedor: payload.proveedor.nombre,
      codigoSap: payload.proveedor.codigo_sap,
      moneda: payload.moneda,
      importe: position === undefined ? null : position.cantidad * position.precio_unitario,
      centroCosto: position?.centro_costo ?? null,
      subarea: position?.subarea ?? null,
      aprobador: payload.aprobador.email,
      condicionesPago: payload.condiciones_pago,
      indicadorIva: position?.indicador_iva ?? null,
      bloqueos: validacion.bloqueos.map(({ codigo }) => codigo),
      confirmaciones: validacion.confirmaciones.map(({ codigo }) => codigo),
      retroactiva: validacion.retroactiva,
      numeroOc,
    };
  }

  public setPending(sessionId: string, preparacion: PreparacionOrden): void {
    this.setOrderSummary(sessionId, preparacion);
    this.get(sessionId).pending = { preparacion, motivos: preparacion.validacion.confirmaciones.map(({ codigo }) => codigo), estado: "pendiente" };
  }
  public pending(sessionId: string): PendingConfirmation | null { return this.get(sessionId).pending; }

  public approve(sessionId: string, actor = "demo-user@local.invalid"): string | null {
    const session = this.get(sessionId);
    const pending = session.pending;
    if (pending === null || pending.estado !== "pendiente") return null;
    const autorizacionId = this.autorizaciones.autorizar(pending.preparacion, { sessionId, confirmadoPor: actor, origen: "backend_confirmation" });
    pending.autorizacionId = autorizacionId;
    pending.estado = "autorizada";
    return autorizacionId;
  }

  public reject(sessionId: string): boolean {
    const pending = this.get(sessionId).pending;
    if (pending === null || pending.estado !== "pendiente") return false;
    pending.estado = "rechazada";
    return true;
  }

  public takeAuthorization(sessionId: string, caso: string): string | null {
    const pending = this.get(sessionId).pending;
    if (pending === null || pending.estado !== "autorizada" || pending.preparacion.caso !== caso || pending.autorizacionId === undefined) return null;
    pending.estado = "consumida";
    return pending.autorizacionId;
  }
}
