// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OrderSummary } from "./OrderSummary";
import { setAccessToken } from "../services/api";

const summary = { solicitudId: "SOL-2026-001", proveedor: "TecnoSuministros S.A.S.", codigoSap: "100234", moneda: "COP", importe: 11400000, centroCosto: "CC-1010", subarea: "Infraestructura", aprobador: "mlopez@periferia-ficticia.com", condicionesPago: "Z030", indicadorIva: "C1", bloqueos: ["RC1"], confirmaciones: ["RC5"], retroactiva: false, numeroOc: "4500000001" };
const session = { id: "secure", history: [], toolCalls: [], processing: false, tokensUsed: 0, confirmation: null, orderSummary: summary };
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("OrderSummary", () => {
  it("muestra datos estructurados, bloqueos y confirmaciones", () => {
    render(<OrderSummary session={session} />);
    expect(screen.getByText("TecnoSuministros S.A.S.")).toBeTruthy();
    expect(screen.getByText("11400000")).toBeTruthy();
    expect(screen.getByText("4500000001")).toBeTruthy();
    expect(screen.getByText(/Bloqueos: RC1/)).toBeTruthy();
    expect(screen.getByText(/Confirmaciones: RC5/)).toBeTruthy();
  });

  it("descarga con token y muestra error HTTP", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(new Response("ok", { status: 200 })).mockResolvedValueOnce(new Response(JSON.stringify({ error: "Documento no disponible" }), { status: 404, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetcher); vi.stubGlobal("URL", { createObjectURL: () => "blob:test", revokeObjectURL: vi.fn() }); vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    setAccessToken("demo-token"); render(<OrderSummary session={session} />);
    fireEvent.click(screen.getByText("Descargar aprobación TXT"));
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalled());
    expect(fetcher.mock.calls[0]?.[1]?.headers).toMatchObject({ "x-app-token": "demo-token" });
    fireEvent.click(screen.getByText("Descargar trazabilidad JSON"));
    expect(await screen.findByText("Documento no disponible")).toBeTruthy();
  });
});
