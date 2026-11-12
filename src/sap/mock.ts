import { mkdir, readFile, appendFile } from "node:fs/promises";
import { join } from "node:path";
import { ordenCompraSchema, type OrdenCompra } from "../schemas/orden-compra.js";
import type { SapAdapter } from "./adapter.js";
import { leerMaestros } from "../domain/leer-fixture.js";
import { normalizarNit } from "../domain/normalizacion.js";

type OrdenPersistida = {
  numero_oc: string;
  fecha: string;
  orden: OrdenCompra;
};

const colasPorDirectorio = new Map<string, Promise<void>>();

export type ResultadoCreacionMock = {
  numero_oc: string;
  fecha: string;
  idempotente: boolean;
  orden: OrdenCompra;
};

export class SapMockAdapter implements SapAdapter {
  public constructor(private readonly directory: string) {}

  public async consultarProveedor(nit: string): Promise<{ codigo_sap: string; activo: boolean } | null> {
    const maestros = await leerMaestros(this.directory);
    const proveedor = maestros.proveedores.find((actual) => normalizarNit(actual.nit) === normalizarNit(nit));
    return proveedor === undefined ? null : { codigo_sap: proveedor.codigo_sap, activo: proveedor.activo };
  }

  public async buscarOrdenPorReferencia(solicitudId: string): Promise<{ numero_oc: string } | null> {
    const orden = (await this.leerOrdenes()).find(({ orden }) => orden.referencia.solicitud_id === solicitudId);
    return orden === undefined ? null : { numero_oc: orden.numero_oc };
  }

  public async obtenerOrdenPorReferencia(solicitudId: string): Promise<OrdenCompra | null> {
    const orden = (await this.leerOrdenes()).find(({ orden }) => orden.referencia.solicitud_id === solicitudId);
    return orden?.orden ?? null;
  }

  public async crearOrden(orden: OrdenCompra): Promise<{ numero_oc: string; fecha: string }> {
    const resultado = await this.crearOrdenAtomica(orden);
    return { numero_oc: resultado.numero_oc, fecha: resultado.fecha };
  }

  public async crearOrdenAtomica(orden: OrdenCompra): Promise<ResultadoCreacionMock> {
    const validada = ordenCompraSchema.parse(orden);
    return this.enSeccionCritica(async () => {
      const existentes = await this.leerOrdenes();
      const previa = existentes.find(({ orden: actual }) => actual.referencia.solicitud_id === validada.referencia.solicitud_id);
      if (previa !== undefined) return { numero_oc: previa.numero_oc, fecha: previa.fecha, idempotente: true, orden: previa.orden };
      const maximo = existentes.reduce((actual, item) => Math.max(actual, Number(item.numero_oc)), 4_500_000_000);
      const creada: OrdenPersistida = {
        numero_oc: String(maximo + 1),
        fecha: new Date().toISOString(),
        orden: validada,
      };
      await mkdir(this.rutaSap(), { recursive: true });
      await appendFile(this.rutaOrdenes(), `${JSON.stringify(creada)}\n`, "utf8");
      return { numero_oc: creada.numero_oc, fecha: creada.fecha, idempotente: false, orden: creada.orden };
    });
  }

  private async enSeccionCritica<T>(operacion: () => Promise<T>): Promise<T> {
    const clave = this.rutaOrdenes();
    const anterior = colasPorDirectorio.get(clave) ?? Promise.resolve();
    let liberar: () => void = () => undefined;
    const actual = new Promise<void>((resolve) => { liberar = resolve; });
    colasPorDirectorio.set(clave, actual);
    await anterior;
    try {
      return await operacion();
    } finally {
      liberar();
      if (colasPorDirectorio.get(clave) === actual) colasPorDirectorio.delete(clave);
    }
  }

  private rutaSap(): string {
    return join(this.directory, "out", "sap");
  }

  private rutaOrdenes(): string {
    return join(this.rutaSap(), "ordenes.jsonl");
  }

  private async leerOrdenes(): Promise<OrdenPersistida[]> {
    try {
      const texto = await readFile(this.rutaOrdenes(), "utf8");
      return texto.split(/\r?\n/).filter(Boolean).map((linea) => {
        const valor: unknown = JSON.parse(linea);
        if (typeof valor !== "object" || valor === null) throw new Error("Registro SAP inválido");
        const registro = valor as { numero_oc?: unknown; fecha?: unknown; orden?: unknown };
        if (typeof registro.numero_oc !== "string" || typeof registro.fecha !== "string") throw new Error("Registro SAP inválido");
        return { numero_oc: registro.numero_oc, fecha: registro.fecha, orden: ordenCompraSchema.parse(registro.orden) };
      });
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return [];
      throw error;
    }
  }
}

