import { ChevronDown, Wrench } from "lucide-react";
import { useState } from "react";
import type { SessionView } from "../types/api";
export function ToolCallCard({ call }: { call: SessionView["toolCalls"][number] }) {
  const [open, setOpen] = useState(false);
  return <article className={`tool-card ${call.ok ? "ok" : "error"}`}><button onClick={() => setOpen(!open)}><Wrench size={15} />{call.name}<ChevronDown size={15} /></button><small>{call.ok ? "Correcta" : "Error"} · {call.summary}</small>{open && <pre>{JSON.stringify(call.args, null, 2)}</pre>}</article>;
}
