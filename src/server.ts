import express from "express";
import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { AgentLoop } from "./agent/loop.js";
import { SessionStore, sessionIdSchema } from "./agent/sessions.js";
import { crearGeminiDesdeEntorno } from "./llm/gemini.js";

const chatSchema = z.object({ sessionId: sessionIdSchema, message: z.string().trim().min(1).max(10_000) }).strict();

export function createServer(directory: string, loop?: AgentLoop) {
  const app = express();
  const sessions = loop?.sessions ?? new SessionStore(directory);
  const adapter = crearGeminiDesdeEntorno();
  const agent = loop ?? (adapter === null ? null : new AgentLoop(directory, sessions, adapter, Number(process.env.MAX_AGENT_ITERATIONS ?? 25), Number(process.env.MAX_SESSION_TOKENS ?? 20_000)));
  const active = new Map<string, number>();
  const requests = new Map<string, { count: number; resetAt: number }>();
  const globalRequests = { count: 0, resetAt: 0 };
  app.get("/healthz", (_req, res) => res.json({ ok: true }));
  app.use(express.json({ limit: "16kb" }));
  app.use((req, res, next) => {
    const expected = process.env.APP_ACCESS_TOKEN;
    if (req.path.startsWith("/api/") && expected !== undefined && expected.length > 0 && req.header("x-app-token") !== expected) return res.status(401).json({ error: "Acceso no autorizado" });
    return next();
  });
  if (process.env.NODE_ENV === "production" && adapter !== null && (!process.env.APP_ACCESS_TOKEN || process.env.APP_ACCESS_TOKEN.length === 0)) throw new Error("APP_ACCESS_TOKEN es obligatorio cuando Gemini está habilitado en producción");
  app.set("trust proxy", process.env.TRUST_PROXY === "true" ? 1 : false);
  app.get("/api/health", (_req, res) => res.json({ ok: true, provider: adapter?.provider ?? "unconfigured", model: adapter?.model ?? (process.env.LLM_MODEL ?? "unconfigured") }));
  app.get("/api/casos", async (_req, res) => {
    try {
      const base = join(directory, "fixtures", "reto-03", "solicitudes");
      const entries = await readdir(base, { withFileTypes: true });
      return res.json(entries.filter((entry) => entry.isDirectory() && /^sol-00[1-6]$/.test(entry.name)).map(({ name }) => ({ id: name })));
    } catch { return res.status(500).json({ error: "No fue posible listar los casos" }); }
  });
  app.get("/api/evidencias/:caso/:archivo", async (req, res) => {
    const caso = z.enum(["sol-001", "sol-002", "sol-003", "sol-004", "sol-005", "sol-006"]).safeParse(req.params.caso);
    const archivo = z.enum(["aprobacion.txt", "trazabilidad.json"]).safeParse(req.params.archivo);
    if (!caso.success || !archivo.success) return res.status(404).json({ error: "Documento no disponible" });
    const ruta = join(directory, "out", caso.data, archivo.data);
    try {
      if (!(await stat(ruta)).isFile()) return res.status(404).json({ error: "Documento no disponible" });
      return res.download(ruta, archivo.data);
    } catch { return res.status(404).json({ error: "Documento no disponible" }); }
  });
  app.get("/api/sessions/:id", (req, res) => {
    const parsed = sessionIdSchema.safeParse(req.params.id);
    if (!parsed.success) return res.status(400).json({ error: "sessionId inválido" });
    const view = sessions.publicView(parsed.data);
    if (view === null) return res.status(404).json({ error: "Sesión no encontrada" });
    return res.json(view);
  });
  app.post("/api/chat", async (req, res) => {
    const parsed = chatSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Solicitud inválida" });
    if (agent === null) return res.status(503).json({ error: "Proveedor LLM no configurado" });
    const now = Date.now();
    const limit = Number(process.env.CHAT_RATE_LIMIT ?? 30);
    const globalLimit = Number(process.env.CHAT_GLOBAL_RATE_LIMIT ?? 300);
    const windowMs = 60_000;
    if (globalRequests.resetAt <= now) { globalRequests.count = 0; globalRequests.resetAt = now + windowMs; }
    if (globalRequests.count >= globalLimit) return res.status(429).json({ error: "Límite global de solicitudes excedido" });
    globalRequests.count += 1;
    for (const [key, value] of requests) if (value.resetAt <= now) requests.delete(key);
    const origin = req.ip || "unknown";
    const requestKey = `${origin}:${parsed.data.sessionId}`;
    const usage = requests.get(requestKey);
    if (usage === undefined || usage.resetAt <= now) requests.set(requestKey, { count: 1, resetAt: now + windowMs });
    else if (usage.count >= limit) return res.status(429).json({ error: "Límite de solicitudes excedido" });
    else usage.count += 1;
    const count = active.get(parsed.data.sessionId) ?? 0;
    if (count > 0) return res.status(429).json({ error: "Sesión en procesamiento" });
    active.set(parsed.data.sessionId, count + 1);
    try {
      const turn = await agent.run(parsed.data.sessionId, parsed.data.message);
      sessions.addMessage(parsed.data.sessionId, "assistant", turn.reply);
      return res.json(turn);
    } finally { active.delete(parsed.data.sessionId); }
  });
  const webDist = join(directory, "dist", "web");
  app.use(express.static(webDist));
  app.get("/{*path}", (_req, res) => res.sendFile(join(webDist, "index.html"), (error) => { if (error) res.status(404).json({ error: "Frontend no compilado" }); }));
  return app;
}

if (process.env.NODE_ENV !== "test") {
  const port = Number(process.env.PORT ?? 3000);
  createServer(process.cwd()).listen(port, "0.0.0.0");
}
