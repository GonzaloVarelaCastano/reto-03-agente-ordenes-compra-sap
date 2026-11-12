import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { aprobacionAfirmativa, aprobacionFixtureSchema, parsearJson } from "./leer-fixture.js";

export type EvidenciaAprobacion = {
  ruta: string;
  sha256: string;
  contenido: string;
  aprobacion: {
    de: string;
    para: string;
    fecha: string;
    asunto: string;
    cuerpo: string;
  };
};

export async function prepararEvidenciaAprobacion(directory: string, caso: string): Promise<EvidenciaAprobacion> {
  const origen = join(directory, "fixtures", "reto-03", "solicitudes", caso, "aprobacion.json");
  const aprobacion = parsearJson(await readFile(origen, "utf8"), aprobacionFixtureSchema, origen);
  if (!aprobacionAfirmativa(aprobacion.cuerpo)) throw new Error("La aprobación no es afirmativa o fue revocada");
  const contenido = [
    `De: ${aprobacion.de}`,
    `Para: ${aprobacion.para}`,
    `Fecha: ${aprobacion.fecha}`,
    `Asunto: ${aprobacion.asunto}`,
    "",
    aprobacion.cuerpo,
    "",
  ].join("\n");
  return {
    ruta: join(directory, "out", caso, "aprobacion.txt"),
    sha256: createHash("sha256").update(contenido, "utf8").digest("hex"),
    contenido,
    aprobacion: {
      de: aprobacion.de,
      para: aprobacion.para,
      fecha: aprobacion.fecha,
      asunto: aprobacion.asunto,
      cuerpo: aprobacion.cuerpo,
    },
  };
}

export async function escribirEvidenciaAprobacion(evidencia: EvidenciaAprobacion): Promise<void> {
  await mkdir(dirname(evidencia.ruta), { recursive: true });
  await writeFile(evidencia.ruta, evidencia.contenido, "utf8");
}

export async function generarEvidenciaAprobacion(directory: string, caso: string): Promise<EvidenciaAprobacion> {
  const evidencia = await prepararEvidenciaAprobacion(directory, caso);
  await escribirEvidenciaAprobacion(evidencia);
  return evidencia;
}
