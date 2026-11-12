import type { CaseItem, ChatResponse, Health, SessionView } from "../types/api";

let accessToken = "";
export function setAccessToken(token: string) { accessToken = token; }
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { ...init, headers: { "content-type": "application/json", ...(accessToken ? { "x-app-token": accessToken } : {}), ...init?.headers } });
  if (!response.ok) {
    const body = await response.json().catch(() => ({ error: `HTTP ${response.status}` })) as { error?: string };
    throw new Error(body.error ?? `HTTP ${response.status}`);
  }
  return response.json() as Promise<T>;
}
export const api = {
  health: () => request<Health>("/api/health"),
  casos: () => request<CaseItem[]>("/api/casos"),
  session: (id: string) => request<SessionView>(`/api/sessions/${encodeURIComponent(id)}`),
  chat: (sessionId: string, message: string) => request<ChatResponse>("/api/chat", { method: "POST", body: JSON.stringify({ sessionId, message }) }),
  download: async (caso: string, archivo: "aprobacion.txt" | "trazabilidad.json") => {
    const response = await fetch(`/api/evidencias/${encodeURIComponent(caso)}/${archivo}`, { headers: accessToken ? { "x-app-token": accessToken } : {} });
    if (!response.ok) { const body = await response.json().catch(() => ({ error: `HTTP ${response.status}` })) as { error?: string }; throw new Error(body.error ?? `HTTP ${response.status}`); }
    const blob = await response.blob(); const url = URL.createObjectURL(blob); const anchor = document.createElement("a"); anchor.href = url; anchor.download = archivo; anchor.click(); URL.revokeObjectURL(url);
  },
};
