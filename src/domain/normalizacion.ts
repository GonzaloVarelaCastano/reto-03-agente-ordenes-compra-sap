const factoresNit = [71, 67, 59, 53, 47, 43, 41, 37, 29, 23, 19, 17, 13, 7, 3] as const;

export type NitAnalizado = {
  numero: string;
  digitoVerificacionInformado: string | null;
  digitoVerificacionCalculado: string;
  digitoVerificacionValido: boolean | null;
};

export function normalizarTexto(valor: string): string {
  return valor
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase("es-CO")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function normalizarNombre(valor: string): string {
  return normalizarTexto(valor);
}

export function normalizarCorreo(valor: string): string {
  return valor.trim().toLocaleLowerCase("en-US");
}

export function calcularDigitoVerificacionNit(numero: string): string {
  const digitos = numero.replace(/\D/g, "");
  if (digitos.length === 0 || digitos.length > factoresNit.length) {
    throw new Error("NIT inválido");
  }
  const inicio = factoresNit.length - digitos.length;
  const suma = [...digitos].reduce(
    (total, digito, indice) => total + Number(digito) * factoresNit[inicio + indice]!,
    0,
  );
  const residuo = suma % 11;
  return String(residuo > 1 ? 11 - residuo : residuo);
}

export function analizarNit(valor: string): NitAnalizado {
  const limpio = valor.trim();
  const coincidencia = limpio.match(/^(.*?)-\s*(\d)$/);
  const numero = (coincidencia?.[1] ?? limpio).replace(/\D/g, "");
  if (numero.length === 0) {
    throw new Error("NIT inválido");
  }
  const informado = coincidencia?.[2] ?? null;
  const calculado = calcularDigitoVerificacionNit(numero);
  return {
    numero,
    digitoVerificacionInformado: informado,
    digitoVerificacionCalculado: calculado,
    digitoVerificacionValido: informado === null ? null : informado === calculado,
  };
}

export function normalizarNit(valor: string): string {
  return analizarNit(valor).numero;
}

export function analizarMontoColombiano(valor: string | number): number {
  if (typeof valor === "number") {
    if (!Number.isFinite(valor)) {
      throw new Error("Monto no numérico");
    }
    return valor;
  }
  const limpio = valor
    .trim()
    .replace(/^(COP|USD)\s*/i, "")
    .replace(/^\$\s*/, "")
    .replace(/\s/g, "");
  if (!/^-?\d[\d.,]*$/.test(limpio)) {
    throw new Error("Formato de monto inválido");
  }
  const signo = limpio.startsWith("-") ? -1 : 1;
  const absoluto = limpio.replace(/^-/, "");
  const puntos = (absoluto.match(/\./g) ?? []).length;
  const comas = (absoluto.match(/,/g) ?? []).length;
  let canonico: string;
  if (puntos > 0 && comas > 0) {
    const decimal = absoluto.lastIndexOf(".") > absoluto.lastIndexOf(",") ? "." : ",";
    const miles = decimal === "." ? "," : ".";
    const patron = decimal === "."
      ? /^\d{1,3}(?:,\d{3})*\.\d+$|^\d+\.\d+$/
      : /^\d{1,3}(?:\.\d{3})*,\d+$|^\d+,\d+$/;
    if (!patron.test(absoluto)) {
      throw new Error("Formato de monto inválido");
    }
    canonico = absoluto.replaceAll(miles, "").replace(decimal, ".");
  } else if (puntos > 0 || comas > 0) {
    const separador = puntos > 0 ? "." : ",";
    const partes = absoluto.split(separador);
    const agrupadoMiles = partes.length > 1 && partes.slice(1).every((parte) => parte.length === 3);
    const decimalSimple = partes.length === 2 && partes[0]!.length > 0 && partes[1]!.length > 0;
    if (!agrupadoMiles && !decimalSimple) {
      throw new Error("Formato de monto inválido");
    }
    canonico = agrupadoMiles ? partes.join("") : `${partes[0]}.${partes[1]}`;
  } else {
    canonico = absoluto;
  }
  const monto = Number(canonico) * signo;
  if (!Number.isFinite(monto)) {
    throw new Error("Monto no numérico");
  }
  return monto;
}

export function extraerTotalCotizacion(texto: string): number {
  const coincidencias = [...texto.matchAll(/^TOTAL \(IVA incluido\):\s*(?:COP|USD)\s+([^\r\n]+)$/gim)];
  if (coincidencias.length !== 1 || coincidencias[0]?.[1] === undefined) {
    throw new Error("No se encontró un total único de cotización");
  }
  return analizarMontoColombiano(coincidencias[0][1]);
}

export function parsearFechaIso(valor: string): Date {
  const esFecha = /^\d{4}-\d{2}-\d{2}$/.test(valor);
  const fecha = new Date(esFecha ? `${valor}T00:00:00.000Z` : valor);
  if (Number.isNaN(fecha.getTime())) {
    throw new Error("Fecha ISO inválida");
  }
  if (esFecha && fecha.toISOString().slice(0, 10) !== valor) {
    throw new Error("Fecha ISO inválida");
  }
  return fecha;
}

export function compararFechasIso(izquierda: string, derecha: string): number {
  return Math.sign(parsearFechaIso(izquierda).getTime() - parsearFechaIso(derecha).getTime());
}

export function compararFechasCalendarioIso(izquierda: string, derecha: string): number {
  const fechaIzquierda = izquierda.slice(0, 10);
  const fechaDerecha = derecha.slice(0, 10);
  parsearFechaIso(fechaIzquierda);
  parsearFechaIso(fechaDerecha);
  return fechaIzquierda.localeCompare(fechaDerecha);
}

export function diferenciaMonetaria(izquierda: number, derecha: number): number {
  return Math.abs(izquierda - derecha);
}

export function excedeToleranciaMonetaria(izquierda: number, derecha: number, tolerancia: number): boolean {
  const diferencia = diferenciaMonetaria(izquierda, derecha);
  const margen = Number.EPSILON * Math.max(1, Math.abs(izquierda), Math.abs(derecha)) * 2;
  return diferencia > tolerancia && diferencia - tolerancia > margen;
}
