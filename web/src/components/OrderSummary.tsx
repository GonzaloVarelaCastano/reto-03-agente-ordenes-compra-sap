import { useState } from "react";
import type { SessionView } from "../types/api";
import { api } from "../services/api";

export function OrderSummary({ session }: { session: SessionView | null }) {
  const [error, setError] = useState<string | null>(null);
  const summary = session?.orderSummary;
  const caso = summary?.solicitudId?.replace("SOL-2026-", "sol-").toLowerCase() ?? null;
  const download = async (file: "aprobacion.txt" | "trazabilidad.json") => { setError(null); try { await api.download(caso!, file); } catch (reason) { setError(reason instanceof Error ? reason.message : "No fue posible descargar el documento"); } };
  return <aside className="summary"><h2>Resumen de OC</h2>{summary ? <><dl>{Object.entries({ Solicitud: summary.solicitudId, Proveedor: summary.proveedor, "Código SAP": summary.codigoSap, Moneda: summary.moneda, Importe: summary.importe, "Centro de costo": summary.centroCosto, "Subárea": summary.subarea, Aprobador: summary.aprobador, "Condiciones de pago": summary.condicionesPago, IVA: summary.indicadorIva, "Número OC": summary.numeroOc }).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value === null ? "No disponible" : String(value)}</dd></div>)}</dl><h3>Validación</h3>{summary.bloqueos.length > 0 && <p className="blocking">Bloqueos: {summary.bloqueos.join(", ")}</p>}{summary.confirmaciones.length > 0 && <p className="warning">Confirmaciones: {summary.confirmaciones.join(", ")}</p>}{summary.retroactiva && <p className="warning">Orden retroactiva</p>}{caso && <div className="downloads"><button onClick={() => void download("aprobacion.txt")}>Descargar aprobación TXT</button><button onClick={() => void download("trazabilidad.json")}>Descargar trazabilidad JSON</button></div>}{error && <p className="blocking">{error}</p>}</> : <p>No disponible. Procesa un caso para ver el resumen.</p>}</aside>;
}
