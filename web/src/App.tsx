import { useEffect, useState } from "react";
import { Bot, CircleAlert, LogOut, Plus } from "lucide-react";
import { CaseSelector } from "./components/CaseSelector";
import { ChatPanel } from "./components/ChatPanel";
import { ConfirmationPanel } from "./components/ConfirmationPanel";
import { OrderSummary } from "./components/OrderSummary";
import { useChat } from "./hooks/useChat";
import { api, setAccessToken } from "./services/api";
import type { CaseItem, Health } from "./types/api";

export default function App() {
  const chat = useChat();
  const [cases, setCases] = useState<CaseItem[]>([]); const [selected, setSelected] = useState<string | null>(null);
  const [health, setHealth] = useState<Health | null>(null); const [token, setToken] = useState(""); const [access, setAccess] = useState(false);
  useEffect(() => { Promise.all([api.health(), api.casos()]).then(([service, available]) => { setHealth(service); setCases(available); setAccess(true); }).catch(() => setHealth({ ok: false, provider: "desconectado", model: "No disponible" })); }, []);
  const unlock = async () => { setAccessToken(token); try { const [service, available] = await Promise.all([api.health(), api.casos()]); setHealth(service); setCases(available); setAccess(true); } catch { setAccess(false); } };
  if (!access) return <div className="access"><Bot size={32}/><h1>Agente OC SAP</h1><p>{health?.ok === false ? "El backend no está disponible o requiere token de acceso." : "Ingresa el token de acceso de la demo si está habilitado."}</p><input type="password" value={token} onChange={(event) => setToken(event.target.value)} placeholder="Token de demo"/><button onClick={unlock}>Conectar</button></div>;
  return <div className="app"><header><div><Bot size={22}/><strong>Agente OC SAP</strong><span>Órdenes de compra</span></div><div className={health?.ok ? "status online" : "status offline"}>{health?.ok ? `Conectado · ${health.provider}` : "Desconectado"}</div><button className="icon" title="Nueva sesión" onClick={chat.newSession}><Plus size={18}/></button><button className="icon" title="Cerrar token" onClick={() => { setAccessToken(""); chat.newSession(); setSelected(null); setAccess(false); }}><LogOut size={18}/></button></header><div className="workspace"><CaseSelector cases={cases} selected={selected} onSelect={setSelected}/><section className="center"><ChatPanel session={chat.session} loading={chat.loading} selectedCase={selected} onSend={chat.send}/>{chat.error && <div className="error"><CircleAlert size={16}/>{chat.error}</div>}{chat.lastResponse?.needsConfirmation && chat.session?.confirmation && <ConfirmationPanel motivos={chat.session.confirmation.motivos} disabled={chat.loading} onConfirm={() => { void chat.send(`confirmo ${chat.session?.confirmation?.solicitudId.replace("SOL-2026-", "sol-").toLowerCase()}`); }} onReject={() => { void chat.send("rechazo"); }} />}</section><OrderSummary session={chat.session}/></div></div>;
}
