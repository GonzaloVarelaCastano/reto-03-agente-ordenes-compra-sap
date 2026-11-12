// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ChatPanel } from "./ChatPanel";
afterEach(() => cleanup());

describe("ChatPanel", () => {
  it("incorpora el caso seleccionado si el mensaje no lo menciona", async () => {
    const send = vi.fn().mockResolvedValue(null);
    render(<ChatPanel session={null} loading={false} selectedCase="sol-004" onSend={send} />);
    fireEvent.change(screen.getByLabelText("Mensaje"), { target: { value: "Previsualiza" } });
    fireEvent.submit(screen.getByLabelText("Mensaje").closest("form")!);
    await vi.waitFor(() => expect(send).toHaveBeenCalledWith("Previsualiza sol-004"));
  });

  it("preserva el caso escrito expresamente", async () => {
    const send = vi.fn().mockResolvedValue(null);
    render(<ChatPanel session={null} loading={false} selectedCase="sol-004" onSend={send} />);
    fireEvent.change(screen.getByLabelText("Mensaje"), { target: { value: "Consulta sol-001" } });
    fireEvent.submit(screen.getByLabelText("Mensaje").closest("form")!);
    await vi.waitFor(() => expect(send).toHaveBeenCalledWith("Consulta sol-001"));
  });
});
