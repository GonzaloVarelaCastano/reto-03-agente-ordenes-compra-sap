import type { Maestros, Paquete, Proveedor } from "../schemas/solicitud.js";
import {
  analizarNit,
  compararFechasCalendarioIso,
  compararFechasIso,
  excedeToleranciaMonetaria,
  normalizarCorreo,
  normalizarNit,
  normalizarNombre,
} from "./normalizacion.js";

export type CodigoRegla = "RC1" | "RC2" | "RC3" | "RC4" | "RC5" | "RC6" | "RC7" | "RC8" | "RC9" | "RC10";

export type Hallazgo = {
  codigo: CodigoRegla;
  detalle: string;
};

export type DerivadosValidacion = {
  proveedor?: {
    codigo_sap: string;
    nit: string;
    nombre: string;
    origen: "nit" | "nombre";
  };
  indicador_iva?: string;
  condiciones_pago?: string;
};

export type ResultadoValidacion = {
  apta: boolean;
  bloqueos: Hallazgo[];
  confirmaciones: Hallazgo[];
  derivados: DerivadosValidacion;
  retroactiva: boolean;
};

function buscarProveedor(paquete: Paquete, maestros: Maestros): { proveedor: Proveedor | null; origen: "nit" | "nombre" | null } {
  const nit = paquete.solicitud.proveedor_nit;
  if (nit !== undefined) {
    const analizado = analizarNit(nit);
    if (analizado.digitoVerificacionValido === false) {
      return { proveedor: null, origen: "nit" };
    }
    return {
      proveedor: maestros.proveedores.find((actual) => normalizarNit(actual.nit) === analizado.numero) ?? null,
      origen: "nit",
    };
  }
  const nombre = normalizarNombre(paquete.solicitud.proveedor_nombre);
  const coincidencias = maestros.proveedores.filter((actual) => normalizarNombre(actual.nombre) === nombre);
  return {
    proveedor: coincidencias.length === 1 ? coincidencias[0]! : null,
    origen: coincidencias.length === 1 ? "nombre" : null,
  };
}

export function validarOrden(paquete: Paquete, maestros: Maestros): ResultadoValidacion {
  const bloqueos: Hallazgo[] = [];
  const confirmaciones: Hallazgo[] = [];
  const derivados: DerivadosValidacion = {};
  const { proveedor, origen } = buscarProveedor(paquete, maestros);

  if (proveedor === null) {
    bloqueos.push({ codigo: "RC1", detalle: "El proveedor no existe de forma única en el maestro." });
  } else if (!proveedor.activo) {
    bloqueos.push({ codigo: "RC1", detalle: "El proveedor existe, pero está inactivo." });
  } else if (origen !== null) {
    derivados.proveedor = {
      codigo_sap: proveedor.codigo_sap,
      nit: proveedor.nit,
      nombre: proveedor.nombre,
      origen,
    };
  }

  const centro = maestros.centrosCosto.find(
    (actual) => normalizarNombre(actual.centro_costo) === normalizarNombre(paquete.solicitud.centro_costo),
  );
  const aprobacion = paquete.aprobacion;
  const aprobador = centro?.aprobadores.find(
    (actual) => aprobacion !== null && normalizarCorreo(actual.email) === normalizarCorreo(aprobacion.de),
  );
  const aprobacionValida = aprobacion !== null && aprobacion.aprobado && aprobador !== undefined;
  if (!aprobacionValida) {
    bloqueos.push({
      codigo: "RC2",
      detalle: aprobacion === null
        ? "No existe aprobación."
        : !aprobacion.aprobado
          ? "La aprobación no es afirmativa."
          : "El remitente no está autorizado para el centro de costo.",
    });
  }
  if (aprobador === undefined) {
    bloqueos.push({ codigo: "RC3", detalle: "No existe un tope válido para esa aprobación en el centro de costo." });
  } else if (paquete.solicitud.valor_total > aprobador.tope) {
    bloqueos.push({
      codigo: "RC3",
      detalle: `El monto ${paquete.solicitud.valor_total} supera el tope autorizado ${aprobador.tope}.`,
    });
  }

  const subareaValida = centro?.subareas.some(
    (actual) => normalizarNombre(actual) === normalizarNombre(paquete.solicitud.subarea),
  ) ?? false;
  if (!subareaValida) {
    bloqueos.push({ codigo: "RC4", detalle: "La subárea no pertenece al centro de costo." });
  }

  if (paquete.cotizacion === null) {
    confirmaciones.push({ codigo: "RC5", detalle: "No se adjuntó cotización." });
  } else {
    const diferencia = Math.abs(paquete.cotizacion.total - paquete.solicitud.valor_total) / paquete.solicitud.valor_total;
    if (diferencia > 0.02) {
      confirmaciones.push({
        codigo: "RC5",
        detalle: `Solicitud ${paquete.solicitud.valor_total}; cotización ${paquete.cotizacion.total}; diferencia ${(diferencia * 100).toFixed(2)} %.`,
      });
    }
  }

  const indicadorIva = paquete.solicitud.indicador_iva;
  if (indicadorIva !== undefined) {
    if (!maestros.indicadoresIva.some((actual) => actual.codigo === indicadorIva)) {
      bloqueos.push({ codigo: "RC6", detalle: `El indicador de IVA ${indicadorIva} no existe en el maestro.` });
    }
  } else if (proveedor?.activo === true) {
    const derivado = proveedor.indicador_iva_default;
    if (!maestros.indicadoresIva.some((actual) => actual.codigo === derivado)) {
      bloqueos.push({ codigo: "RC6", detalle: `El indicador de IVA derivado ${derivado} no existe en el maestro.` });
    } else {
      derivados.indicador_iva = derivado;
      confirmaciones.push({ codigo: "RC6", detalle: `Se derivó el indicador de IVA ${derivado} desde el proveedor.` });
    }
  }

  const condicionesPago = paquete.solicitud.condiciones_pago;
  if (condicionesPago !== undefined) {
    if (!maestros.condicionesPago.some((actual) => actual.codigo === condicionesPago)) {
      bloqueos.push({ codigo: "RC7", detalle: `La condición de pago ${condicionesPago} no existe en el maestro.` });
    }
  } else if (proveedor?.activo === true) {
    const derivado = proveedor.condiciones_pago_default;
    if (!maestros.condicionesPago.some((actual) => actual.codigo === derivado)) {
      bloqueos.push({ codigo: "RC7", detalle: `La condición de pago derivada ${derivado} no existe en el maestro.` });
    } else {
      derivados.condiciones_pago = derivado;
    }
  }

  const retroactiva = paquete.factura !== null
    && compararFechasIso(paquete.factura.fecha, paquete.solicitud.fecha_solicitud) < 0;
  if (retroactiva) {
    confirmaciones.push({ codigo: "RC8", detalle: "La factura es anterior a la solicitud; la OC es retroactiva." });
  }

  if (aprobacion !== null && compararFechasCalendarioIso(aprobacion.fecha, paquete.solicitud.fecha_solicitud) < 0) {
    confirmaciones.push({ codigo: "RC9", detalle: "La aprobación es anterior a la solicitud." });
  }

  const calculado = paquete.solicitud.cantidad * paquete.solicitud.valor_unitario;
  if (excedeToleranciaMonetaria(calculado, paquete.solicitud.valor_total, 1)) {
    bloqueos.push({
      codigo: "RC10",
      detalle: `Cantidad por precio unitario da ${calculado}, diferente del total ${paquete.solicitud.valor_total}.`,
    });
  }

  return {
    apta: bloqueos.length === 0,
    bloqueos,
    confirmaciones,
    derivados,
    retroactiva,
  };
}
