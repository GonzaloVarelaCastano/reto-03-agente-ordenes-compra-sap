# Solución — Reto 03

## 1. Problema y usuario afectado

La analista administrativa transcribe datos de solicitudes a SAP y valida controles dispersos; el sistema prepara la OC, detecta excepciones y conserva evidencia para reducir digitación y errores.

## 2. Arquitectura

React/Vite consume Express. Express mantiene sesiones y ejecuta el agente; el agente llama herramientas Zod; las herramientas consultan fixtures/maestros y el dominio; SAP mock y auditoría escriben en `out/`. El diagrama versionado es `arquitectura-reto-03-c4.drawio`.

## 3. Ciclo del agente

El adaptador LLM recibe declaraciones de función y conserva `functionCall`/`functionResponse`. El ciclo limita iteraciones y tokens, maneja timeout/error, registra herramientas y exige confirmación backend ligada a sesión, solicitud, huella y motivos. La confirmación se consume una vez; bloqueos nunca se omiten.

## 4. Elección del modelo

Gemini se usa mediante un adaptador intercambiable y `GEMINI_API_KEY` de servidor. El valor predeterminado es `gemini-flash-latest`, alias oficial documentado para function calling, y la clave viaja en `x-goog-api-key`. El adaptador permite reemplazar proveedor sin cambiar dominio o loop. **Costo provisional (2026-11-12):** sin una consulta autenticada de lista de modelos/precios no se validó tarifa vigente; para planeación se estima 8.000 tokens de entrada y 2.000 de salida por caso. El costo debe calcularse con la tarifa oficial vigente de la cuenta antes de producción; no se presenta como precio real. Fuente a verificar: documentación oficial Gemini API de precios y modelos. La demo no requiere modelo.

## 5. Matriz RC1–RC10

| Regla | Decisión | Implementación | Prueba |
|---|---|---|---|
| RC1 | Bloqueo | proveedor por NIT/nombre | inexistente, inactivo, ambiguo |
| RC2 | Bloqueo | aprobación afirmativa/autorizada | negación, revocación, remitente |
| RC3 | Bloqueo | tope por centro | excede y otro centro |
| RC4 | Bloqueo | subárea del centro | subárea inválida |
| RC5 | Confirmación | diferencia >2 %/ausente | 2 %, >2 %, ausente |
| RC6 | Confirmación | IVA derivado/catálogo | C1 y códigos inválidos |
| RC7 | Derivado | pago proveedor/catálogo | Z030 y códigos inválidos |
| RC8 | Confirmación | factura anterior | `sol-005` |
| RC9 | Confirmación | fecha calendario aprobación | fecha anterior |
| RC10 | Bloqueo | tolerancia ±1 | 0.99, 1, 1.1, 1.5 |

La regla más delicada fue RC1: combina NIT con formato colombiano, dígito de verificación, búsqueda por nombre solo en ausencia de NIT y rechazo de coincidencias ambiguas. La solución separa normalización, análisis de DV y búsqueda determinista; nunca permite que el modelo escoja un proveedor.
## 6. Diseño del adaptador SAP real

Se recomienda OData `API_PURCHASEORDER_PROCESS_SRV` si está habilitada: reduce acoplamiento GUI y permite HTTPS, contratos y claves técnicas en una bóveda. `OrdenCompra` se mapea a cabecera, proveedor, organización, posiciones, imputación de centro y adjunto de evidencia. Un BAPI/RFC (`BAPI_PO_CREATE1`) es alternativa cuando OData no esté disponible; SAP Integration Suite sirve como capa de traducción/observabilidad. Credenciales viven en secret manager, nunca en prompt/frontend. La referencia de solicitud debe ser una clave idempotente; ante error parcial se consulta por referencia antes de reintentar. Sin conectividad SAP, el sistema entrega payload, evidencia y archivo de carga para digitación asistida. Este proyecto no integra SAP real.

## 7. Órdenes retroactivas

Una OC retroactiva aparece cuando la factura ya fue emitida antes de que exista la solicitud formal. No es un dato que deba corregirse silenciosamente: suele responder a urgencias operativas, compra directa al proveedor, recepción de factura antes de completar cotización/aprobación o desconocimiento del flujo. El efecto es pérdida de poder de negociación, debilidad en segregación de funciones, correcciones contables y menor capacidad de auditar el gasto. RC8 no rechaza por sí sola; marca `retroactiva=true` y exige confirmación, de forma que dirección pueda medir y decidir su política.

El cambio recomendado es un control preventivo: solicitud y aprobación antes del compromiso con proveedor, catálogo de compras rápidas con topes, bloqueo de recepción de factura sin referencia de OC y tablero mensual de retroactividad por centro, proveedor y causa. Las excepciones deben tener responsable, fecha de regularización y revisión periódica. El agente aporta la señal y la evidencia; no sustituye la política financiera.

## 8. Decisiones y trade-offs

1. Monolito modular frente a microservicios: menor tiempo y complejidad; se sacrifica escalamiento independiente.
2. Archivos JSONL frente a base de datos: facilita demo reproducible; se sacrifica concurrencia multiproceso y consultas robustas.
3. Confirmación backend frente a prompt: privilegia integridad; implica estado de sesión adicional.
4. Gemini adaptable frente a SDK embebido en dominio: portabilidad; requiere traducir protocolo de function calling.

Dependencias principales: `zod` valida contratos, `express` expone API, `react`/`vite` entregan la UI, `lucide-react` aporta iconografía sin sistema visual pesado y `vitest` cubre dominio e interfaz. Se evitó una dependencia de SDK Gemini para conservar el adaptador HTTP pequeño y verificable.

## 9. Supuestos

Maestros entregados son completos. Cotizaciones ya incluyen IVA. Unidad es `H` cuando la descripción contiene hora(s), `UN` para el resto. La aprobación por correo es evidencia suficiente para el reto. Los fixtures son solo lectura.

## 10. Cobertura

| Historia | Estado | Nota |
|---|---|---|
| HU-1 leer paquete | Hecho | Adjuntos opcionales y faltantes |
| HU-2 validar | Hecho | RC1–RC10 deterministas |
| HU-3 payload | Hecho | Zod y trazabilidad |
| HU-4 evidencia TXT | Hecho | PDF P1 no hecho |
| HU-5 SAP simulado | Hecho | JSONL e idempotencia local |
| HU-6 errores | Hecho | Errores serializados/API |
| Front chat | Hecho | Gemini real depende de clave |
| SAP productivo | No hecho | Solo diseño |

## 11. Uso de IA

PERXIA se utilizó para implementación, archivos, pruebas y navegador integrado. ChatGPT se utilizó para análisis del PRD, propuestas de implementación y auditorías de corrección según el proceso solicitado. Las decisiones finales se revisaron contra los fixtures, TypeScript y pruebas; se ajustaron propuestas que rompían contratos, seguridad de confirmación o historial.

## 12. Riesgos productivos

Sesiones en memoria y archivos locales no sirven para alta disponibilidad. Locks actuales no coordinan procesos/réplicas. Las credenciales Gemini requieren bóveda y rotación. El costo/latencia del modelo debe limitarse y monitorearse. El acceso a sesiones requiere autenticación real para producción. El proveedor LLM puede no estar disponible. SAP mock no representa autenticación, transacciones ni errores de SAP real. Un despliegue con disco efímero perdería `out/`; se requiere almacenamiento persistente y auditoría centralizada.
