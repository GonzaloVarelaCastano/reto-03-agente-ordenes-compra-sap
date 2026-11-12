import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../services/api";
import type { ChatResponse, SessionView } from "../types/api";

function newSessionId() { return crypto.randomUUID(); }
export function useChat() {
  const [sessionId, setSessionId] = useState(newSessionId);
  const [session, setSession] = useState<SessionView | null>(null);
  const [lastResponse, setLastResponse] = useState<ChatResponse | null>(null);
  const [loading, setLoading] = useState(false); const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);
  const refresh = async () => { const current = generation.current; const data = await api.session(sessionId); if (current === generation.current) setSession(data); return data; };
  useEffect(() => { void refresh().catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "No fue posible cargar la sesión")); }, [sessionId]);
  const send = async (message: string) => {
    setLoading(true); setError(null); const current = generation.current;
    try { const response = await api.chat(sessionId, message); if (current !== generation.current) return response; setLastResponse(response); await refresh(); return response; }
    catch (reason) { const text = reason instanceof Error ? reason.message : "Error de red"; if (current === generation.current) setError(text); return null; }
    finally { if (current === generation.current) setLoading(false); }
  };
  const newSession = () => { generation.current += 1; setSessionId(newSessionId()); setSession(null); setLastResponse(null); setError(null); setLoading(false); };
  return useMemo(() => ({ sessionId, session, lastResponse, loading, error, send, newSession, refresh }), [sessionId, session, lastResponse, loading, error]);
}
