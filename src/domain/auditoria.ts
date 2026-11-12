import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export type RegistroControl = {
  solicitud_id: string;
  resultado: string;
  numero_oc: string;
  retroactiva: boolean;
  bloqueos: string[];
  confirmaciones: string[];
  ts: string;
};

const encabezado = "solicitud_id,resultado,numero_oc,retroactiva,bloqueos,confirmaciones,ts\n";
const colas = new Map<string, Promise<void>>();

function escaparCsv(valor: string): string {
  return /[",\r\n]/.test(valor) ? `"${valor.replaceAll("\"", "\"\"")}"` : valor;
}

async function serializar<T>(ruta: string, operacion: () => Promise<T>): Promise<T> {
  const anterior = colas.get(ruta) ?? Promise.resolve();
  let liberar: () => void = () => undefined;
  const actual = new Promise<void>((resolve) => { liberar = resolve; });
  colas.set(ruta, actual);
  await anterior;
  try {
    return await operacion();
  } finally {
    liberar();
    if (colas.get(ruta) === actual) colas.delete(ruta);
  }
}

export async function registrarControl(directory: string, registro: RegistroControl): Promise<void> {
  const ruta = join(directory, "out", "control.csv");
  await serializar(ruta, async () => {
    await mkdir(join(directory, "out"), { recursive: true });
    try {
      await readFile(ruta, "utf8");
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
      await writeFile(ruta, encabezado, "utf8");
    }
    const columnas = [
      registro.solicitud_id,
      registro.resultado,
      registro.numero_oc,
      String(registro.retroactiva),
      JSON.stringify(registro.bloqueos),
      JSON.stringify(registro.confirmaciones),
      registro.ts,
    ];
    await appendFile(ruta, `${columnas.map(escaparCsv).join(",")}\n`, "utf8");
  });
}
