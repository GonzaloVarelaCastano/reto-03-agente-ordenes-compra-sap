import type { SessionMessage } from "../types/api";
export function MessageBubble({ message }: { message: SessionMessage }) {
  if (message.role === "tool") return null;
  return <article className={`message ${message.role}`}><span>{message.role === "user" ? "Tú" : "Agente"}</span><p>{message.content}</p></article>;
}
