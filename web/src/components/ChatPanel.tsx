import { FormEvent, useEffect, useRef, useState } from "react";
import { Send } from "lucide-react";
import type { SessionView } from "../types/api";
import { MessageBubble } from "./MessageBubble";
import { ToolCallCard } from "./ToolCallCard";
export function ChatPanel({ session, loading, onSend, selectedCase }: { session: SessionView | null; loading: boolean; onSend: (message: string) => Promise<unknown>; selectedCase: string | null }) {
  const [text, setText] = useState(""); const end = useRef<HTMLDivElement>(null);
  useEffect(() => { if (typeof end.current?.scrollIntoView === "function") end.current.scrollIntoView({ behavior: "smooth" }); }, [session?.history.length, loading]);
  const submit = async (event: FormEvent) => { event.preventDefault(); let message = text.trim() || (selectedCase ? `Procesa ${selectedCase}` : ""); if (!message) return; if (selectedCase && !/\bsol-00[1-6]\b/i.test(message)) message = `${message} ${selectedCase}`; setText(""); try { await onSend(message); } catch { } };
  return <main className="chat"><div className="messages">{!session?.history.length && <div className="empty"><h2>Gestiona órdenes de compra</h2><p>Selecciona un caso y escribe “Procesa sol-001” o pide una previsualización.</p></div>}{session?.history.map((message, index) => <MessageBubble key={`${message.ts}-${index}`} message={message} />)}{session?.toolCalls.map((call, index) => <ToolCallCard key={`${call.ts}-${index}`} call={call} />)}{loading && <p className="thinking">El agente está procesando…</p>}<div ref={end} /></div><form onSubmit={submit}><textarea aria-label="Mensaje" value={text} onChange={(event) => setText(event.target.value)} placeholder={selectedCase ? `Procesa ${selectedCase}` : "Escribe un mensaje"} disabled={loading} /><button aria-label="Enviar" disabled={loading}><Send size={18} /></button></form></main>;
}
