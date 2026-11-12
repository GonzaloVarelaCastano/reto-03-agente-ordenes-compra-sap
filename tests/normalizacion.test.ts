import { describe, expect, it } from "vitest";
import {
  analizarMontoColombiano,
  analizarNit,
  compararFechasIso,
  diferenciaMonetaria,
  excedeToleranciaMonetaria,
  extraerTotalCotizacion,
  normalizarCorreo,
  normalizarNombre,
  normalizarNit,
} from "../src/domain/normalizacion.js";

describe("normalización", () => {
  it("normaliza NIT y valida el dígito de verificación", () => {
    expect(normalizarNit("900.555.111-2")).toBe("900555111");
    expect(analizarNit("900.373.913-4").digitoVerificacionValido).toBe(true);
    expect(analizarNit("900.373.913-9").digitoVerificacionValido).toBe(false);
  });

  it("normaliza nombres y correos sin depender de mayúsculas ni acentos", () => {
    expect(normalizarNombre("  Papelería Central Ltda. ")).toBe("papeleria central ltda");
    expect(normalizarCorreo(" MLOPEZ@Periferia-Ficticia.com ")).toBe("mlopez@periferia-ficticia.com");
  });

  it.each([
    ["COP 11.400.000", 11_400_000],
    ["$ 1.234,50", 1234.5],
    ["1,234.50", 1234.5],
    [95000, 95000],
  ])("analiza monto %s", (entrada, esperado) => {
    expect(analizarMontoColombiano(entrada)).toBe(esperado);
  });

  it("rechaza montos no numéricos", () => {
    expect(() => analizarMontoColombiano("doce millones")).toThrow("Formato de monto inválido");
    expect(() => analizarMontoColombiano("1.2.3")).toThrow("Formato de monto inválido");
    expect(() => analizarMontoColombiano(Number.NaN)).toThrow("Monto no numérico");
  });

  it("extrae únicamente el total IVA incluido sin volver a sumar IVA", () => {
    const texto = "Base: COP 100\nIVA 19%: COP 19\nTOTAL (IVA incluido): COP 119\n";
    expect(extraerTotalCotizacion(texto)).toBe(119);
  });

  it("compara fechas cronológicamente", () => {
    expect(compararFechasIso("2026-08-10", "2026-08-27")).toBe(-1);
    expect(compararFechasIso("2026-08-27T10:00:00-05:00", "2026-08-27")).toBe(1);
  });

  it("conserva la diferencia monetaria real y controla el error flotante", () => {
    expect(diferenciaMonetaria(100, 100.99)).toBeCloseTo(0.99);
    expect(excedeToleranciaMonetaria(100, 100.99, 1)).toBe(false);
    expect(excedeToleranciaMonetaria(100, 101, 1)).toBe(false);
    expect(excedeToleranciaMonetaria(100, 101.1, 1)).toBe(true);
    expect(excedeToleranciaMonetaria(100, 101.5, 1)).toBe(true);
  });
});
