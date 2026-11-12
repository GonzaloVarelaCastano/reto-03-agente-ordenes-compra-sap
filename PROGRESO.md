# Progreso técnico — Reto 03

## Estado

- Etapa completada: Fase 6 parcial — configuración producción, repositorio local y auditoría de dependencias.
- Fuente de verdad: PRD v2.0 y exportación Markdown de `reto-03 1 2.zip` entregada por el usuario.
- Pendiente externo: GitHub, Render, Linux real y Gemini real requieren credenciales/integraciones no disponibles.
- Bloqueos abiertos: no existe URL pública verificable ni clave Gemini configurada.

## Fixtures reconstruidos

- Ruta: `fixtures/reto-03/`.
- Total: 29 archivos.
- Maestros: 4 archivos.
- Solicitudes: 25 archivos en `sol-001` a `sol-006`.
- JSON: 22 archivos; todos parsean correctamente.
- TXT: 7 archivos; seis cotizaciones y una factura en `sol-005`.
- Integridad: 29 de 29 SHA-256 coinciden con la exportación oficial.
- Política: fixtures de solo lectura; no modificar durante la implementación.

### Inventario

- `maestros/`: `centros-costo.json`, `condiciones-pago.json`, `indicadores-iva.json`, `proveedores.json`.
- `sol-001` a `sol-004` y `sol-006`: `aprobacion.json`, `correo.json`, `cotizacion.txt`, `solicitud.json`.
- `sol-005`: los cuatro anteriores más `factura.txt`.

## Inspección de casos

| Caso | Resultado esperado por datos reales |
|---|---|
| sol-001 | Apta; proveedor activo; aprobación autorizada dentro de tope; cotización coincide; crea OC e idempotencia. |
| sol-002 | Bloqueo RC1: NIT `901999000` y proveedor no existen en maestro. |
| sol-003 | Bloqueos RC2 y RC3: Felipe Vargas no es aprobador de `CC-2020`; no existe tope válido para esa aprobación. |
| sol-004 | Confirmación RC5: solicitud COP 25.000.000 frente a cotización COP 26.500.000; diferencia 6 %. |
| sol-005 | Confirmación RC8; factura `2026-08-10` anterior a solicitud `2026-08-27`; `retroactiva=true`. |
| sol-006 | RC1 resuelve proveedor por nombre normalizado; RC6 deriva IVA `C1` y exige confirmación; RC7 deriva pago `Z030` e informa. |

Todos los casos cumplen RC4 y RC10. Las aprobaciones son posteriores o iguales a la fecha de solicitud, por lo que RC9 no se activa en los seis fixtures.

## Decisiones arquitectónicas

1. Monolito modular hexagonal: React/Vite, Express, dominio TypeScript puro, herramientas Zod, adaptadores LLM y SAP. Es la opción mínima que cumple mantenibilidad, capacidad de prueba y reemplazabilidad sin complejidad distribuida.
2. Reglas RC1–RC10 deterministas en dominio; el LLM solo orquesta y redacta. El backend vuelve a leer fuentes confiables antes de crear.
3. Confirmación humana como autorización de servidor ligada a `sessionId + solicitud_id + huella del caso/payload`; no es texto libre reutilizable. Nunca elimina bloqueos y una negativa cancela la creación.
4. Idempotencia SAP por `solicitud_id` con sección crítica por instancia y búsqueda previa. El mock persiste en JSONL y secuencia desde `4500000001`.
5. Fixtures son inmutables y solo lectura; toda salida va a `out/`.
6. Evidencia P0 en TXT: hash SHA-256 del contenido canónico con encabezados y cuerpo; el hash se integra al payload antes de crear.
7. Unidad SAP determinista: descripción normalizada que contenga la palabra completa `hora` o `horas` produce `H`; los demás casos usan `UN` como supuesto explícito. No se permite inferencia del LLM. `MES` queda reservado hasta que exista una regla o dato inequívoco autorizado.
8. Los precios de cotización ya incluyen IVA: se comparan y transportan sin recalcular ni sumar IVA.

Diagrama: `arquitectura-reto-03-c4.drawio`.

## RC1–RC10 confirmadas

- RC1: NIT normalizado primero; si falta NIT, nombre normalizado; proveedor inexistente o inactivo bloquea.
- RC2: aprobación presente, afirmativa y remitente autorizado para el centro; bloquea si falla.
- RC3: solo usa el tope del aprobador autorizado en ese centro; sin autorización no hay tope válido y bloquea.
- RC4: pertenencia exacta de subárea al centro tras normalización controlada; bloquea.
- RC5: diferencia absoluta sobre valor de solicitud; mayor a 2 % o sin cotización exige confirmación.
- RC6: IVA ausente se deriva del proveedor, se valida contra maestro y exige confirmación.
- RC7: pago ausente se deriva del proveedor, se valida contra maestro y se informa.
- RC8: fecha de factura anterior a solicitud marca retroactividad y exige confirmación.
- RC9: aprobación anterior a solicitud exige confirmación.
- RC10: `cantidad × valor_unitario` frente a total con tolerancia absoluta de 1; bloquea.

## Escenarios de calidad

- Adecuación funcional: los seis fixtures producen exactamente los resultados de aceptación en demo automatizada.
- Fiabilidad: dos creaciones simultáneas de una solicitud producen una sola OC y el mismo número.
- Seguridad/integridad: ninguna solicitud con bloqueo o confirmación pendiente crea OC; autorización no cruza solicitudes.
- Mantenibilidad: reglas de dominio sin Express, React ni SDK LLM; pruebas unitarias directas RC1–RC10.
- Portabilidad: `npm run dev` y `bun run demo.ts`; demo sin clave LLM.
- Eficiencia/costo: iteraciones, tokens y timeout configurables; fallos del proveedor no interrumpen la sesión.

## Riesgos y pendientes

- La unidad por texto es una heurística de alcance del reto; en producción debe provenir de catálogo/material/servicio SAP o campo explícito.
- La escritura JSONL requiere exclusión mutua dentro de la instancia; múltiples réplicas necesitarían almacén compartido o clave idempotente en SAP.
- El reconocimiento de aprobación debe buscar una afirmación inequívoca, evitando falsos positivos como negaciones.
- Proveedor/modelo LLM y plataforma de despliegue se decidirán después de P0 y según conexiones autorizadas.
- GitHub y despliegue no están confirmados como destinos autorizados; no publicar sin aprobación explícita.

## Fase 1 implementada

- `package.json`, `package-lock.json`, `tsconfig.json`: dependencias mínimas, Node 22, TypeScript estricto y comandos de pruebas.
- `src/schemas/solicitud.ts`: contratos Zod de maestros, solicitud y paquete normalizado.
- `src/schemas/orden-compra.ts`: contrato Zod de OrdenCompra y límites de posición.
- `src/domain/normalizacion.ts`: nombres, NIT/DV, montos, fechas y total de cotización.
- `src/domain/leer-fixture.ts`: carga y validación de maestros, casos, JSON, cotizaciones y facturas.
- `src/domain/validar-orden.ts`: RC1–RC10, bloqueos, confirmaciones, derivados y retroactividad.
- `tests/normalizacion.test.ts`, `tests/schemas.test.ts`, `tests/validar-orden.test.ts`: seis fixtures y casos sintéticos.

### Verificaciones ejecutadas

- `npm run typecheck`: aprobado.
- `npm test`: 3 archivos y 34 pruebas aprobadas.
- Comprobación SHA-256: 29 fixtures, sin diferencias.
- `npx --yes npm@11 ci --dry-run`: aprobado; no ejecuta una instalación limpia real.
- Node `v22.21.1`; Bun no está instalado y no se ejecutó la demo Bun.
- Instalación inicial con npm 10.9.4 falló con `edgesOut`; npm 11 instaló dependencias. La primera prueba falló por binding nativo omitido; se instaló y fijó la versión Windows correspondiente.
- Graphify: primer intento semántico falló por dependencia AWS ausente; segundo intento sin backend externo generó `graphify-out/graph.json` solo con código, sin indexación semántica de documentos.

### Correcciones finales de Fase 1

- Adjuntos opcionales: `leerPaqueteConFaltantes` devuelve `{ paquete, faltantes }`; solo `ENOENT` convierte cotización/aprobación en `null`. JSON corrupto y otros errores se propagan.
- Aprobaciones: reconocimiento determinista de afirmación, negación y revocación; no interviene el LLM.
- Catálogos: IVA explícito/derivado inválido bloquea como integridad RC6; pago explícito/derivado inválido bloquea como integridad RC7. No se agregaron códigos de regla nuevos.
- Precisión: RC10 compara diferencia real contra tolerancia 1 y aplica únicamente margen mínimo IEEE-754.
- Portabilidad: eliminado binding Windows directo. El lockfile lo conserva correctamente como dependencia opcional transitiva de Rolldown, condicionada a `win32/x64`.
- Pruebas: 4 archivos, 45 pruebas aprobadas; incluyen adjuntos ausentes, JSON corrupto, catálogos inválidos, revocación y diferencias 0.99/1/1.1/1.5.
- `npm run typecheck`: aprobado. `npm test`: 45/45 aprobado.
- Fixtures: 29 archivos; 29/29 hashes originales coinciden.
- Linux: se intentó `npm ci`, typecheck y pruebas en `node:22-bookworm-slim`, pero Docker Desktop no tenía activo el motor Linux (`dockerDesktopLinuxEngine` inexistente). La instalación limpia Linux queda pendiente.

## Fase 2 implementada

- `src/sap/adapter.ts`: interfaz SAP exacta del PRD.
- `src/sap/mock.ts`: JSONL en `out/sap/ordenes.jsonl`, numeración desde `4500000001`, validación Zod, consulta de proveedor, idempotencia persistente y exclusión mutua por instancia. Límite documentado: múltiples réplicas requieren un lock o almacenamiento compartido.
- `src/domain/evidencia.ts`: TXT canónico de la aprobación y SHA-256 UTF-8; rechaza aprobación ausente, corrupta, negada o revocada.
- `src/domain/construir-payload.ts`: payload SAP validado, proveedor maestro, precio de solicitud, descripción SAP de 40 caracteres, unidad determinista y `trazabilidad.json`.
- `src/domain/crear-orden.ts`: recarga fuentes, revalida RC1–RC10, exige autorización interna con huella de payload y solicitud, controla excepciones y registra resultados.
- `src/domain/auditoria.ts`: `control.csv` con columnas exactas, escape CSV y serialización de escrituras en una instancia.
- `.gitignore`: excluye `node_modules/`, `out/`, `.env`, temporales, compilados y ZIP redundante.
- Paso 0 corregido: revocación posterior en otra oración invalida aprobación; factura adjunta ausente se devuelve como `null` y aparece en `faltantes`.

### Verificaciones Fase 2

- `npm run typecheck`: aprobado.
- `npm test`: 6 archivos, 61 pruebas aprobadas.
- Fixtures: 29 archivos; comprobación de hashes sin diferencias.
- Cobertura: evidencia reproducible, trazabilidad, payload, creación `4500000001`, idempotencia tras reinstanciar, concurrencia, bloqueos, confirmaciones, autorización de huella, CSV y catálogos inválidos.
- Las pruebas usan directorios temporales; no se dejó `out/` de ejecución en el proyecto.

### Correcciones de auditoría Fase 2

- Idempotencia con confirmaciones: tras revalidar y reconstruir el payload, se consulta la OC existente antes de solicitar otra confirmación. Una repetición de `sol-004` creada devuelve `idempotente` y registra el intento.
- Conflicto de datos: el mock expone una consulta ampliada interna para comparar la huella de negocio del payload existente; datos fuente modificados devuelven `conflicto_existente`, sin actualizar la OC ni crear otra.
- Trazabilidad: cada campo de `OrdenCompra`, cada atributo de posición y cada atributo de excepción tiene fuente/ruta. La confirmación consumida cambia la trazabilidad de `confirmado_por` a `autorizacion_servidor` con sesión y actor, sin guardar el token.
- Concurrencia: `SapMockAdapter` usa una cola estática por ruta JSONL; cubre múltiples instancias dentro del mismo proceso Node.js, no procesos/contenedores/réplicas distintos.
- Autorización futura: `AutorizacionesInternas.autorizar` acepta solo `ConfirmacionBackend` con `sessionId`, `origen: backend_confirmation`, actor verificado por el backend y preparación vigente. Al consumir comprueba sesión, solicitud, huella y lista de confirmaciones; consume una sola vez. Un LLM no recibe esta capacidad.
- Verificaciones: `npm run typecheck` aprobado; `npm test` 6 archivos y 65 pruebas aprobadas; 29/29 hashes de fixtures coinciden.

### Validación final de Fase 2

- Reintentos idempotentes: payload y trazabilidad se construyen en memoria; evidencia TXT y `trazabilidad.json` solo se persisten cuando la creación atómica produce una OC. Tres reintentos de `sol-004` no alteran la autorización histórica.
- Conflictos: la representación canónica compara referencia, proveedor, moneda, pago, aprobador completo, posiciones y excepciones; excluye solo `confirmado_por`. Cambios de solicitud, fecha de aprobación, aprobador autorizado, evidencia o detalle de excepción devuelven `conflicto_existente`.
- Concurrencia: el mock devuelve el payload persistido dentro de la misma sección crítica por JSONL; una creación confirmada concurrente no puede sobrescribir evidencia o trazabilidad de la OC ganadora.
- Trazabilidad: JSON Pointers de maestros incluyen el índice real del arreglo. Valores explícitos conservan origen en solicitud y agregan una entrada independiente de validación en catálogo.
- Pruebas: `npm run typecheck` aprobado; `npm test` 6 archivos, 69 pruebas aprobadas. El comando de prueba excluye respaldos automáticos bajo `.perxia/`.
- Integridad: 29 fixtures y 29/29 SHA-256 coincidentes.

## Fase 3 implementada

- `src/tools/oc.ts`: cinco herramientas con contratos Zod, serialización `{ ok, data/error }`, recarga de fuentes confiables y registro por sesión/archivo. `confirmado` nunca autoriza por sí solo.
- `src/agent/sessions.ts`: estado aislado por sesión, historial, tokens, llamadas visibles, pendiente de confirmación y autorización de un solo uso ligada a sesión/solicitud/huella/motivos.
- `src/llm/adapter.ts` y `src/llm/gemini.ts`: interfaz de proveedor y Gemini configurable por variables de entorno, timeout y sin logs de API key.
- `src/agent/loop.ts`: límite de iteraciones/tokens, manejo de error de proveedor, ejecución de herramientas y reconocimiento backend de confirmación explícita/rechazo.
- `agent/prompt.md` y `src/knowledge/ordenes-compra.md`: comportamiento y conocimiento separados de ejecución.
- `src/server.ts`: Express con `POST /api/chat`, `GET /api/sessions/:id`, `GET /api/health`, Zod, límite de cuerpo, concurrencia por sesión, rate limit y token opcional `APP_ACCESS_TOKEN`.
- `npm run build`: bundle esbuild de `src/server.ts` en `dist/server.js`.
- Preparación sin persistencia: `prepararOrden()` y borradores no reemplazan evidencia/trazabilidad histórica de OC ya creada.

### Verificaciones Fase 3

- `npm run typecheck`: aprobado.
- `npm test`: 7 archivos, 77 pruebas aprobadas (mocks LLM; sin consumo real).
- `npm run build`: aprobado.
- Fixtures: 29 archivos; 29/29 SHA-256 coincidentes.
- Gemini: adaptador implementado, no probado con proveedor real por ausencia de `GEMINI_API_KEY`; el health reporta configuración sin revelar claves.

### Correcciones de auditoría Fase 3

- Gemini: el adaptador conserva partes `functionCall` del modelo y el loop devuelve resultados como `functionResponse` ordenados por id/nombre; pruebas de `fetch` simulado inspeccionan ambas partes.
- Confirmación: «confirmo» registra decisión humana, consume la autorización de la sesión y ejecuta `oc_crear` en el mismo turno; una negativa queda en historial y cancela el pendiente.
- Intención: el backend concede creación solo ante intención explícita; consultas, previsualizaciones, negativas y contradicciones impiden que `oc_crear` cree una OC.
- Artefactos: herramientas escriben TXT/JSON reales en solicitudes nuevas y preservan evidencia/trazabilidad históricas cuando existe una OC.
- Historial: el servidor ya no duplica el mensaje de usuario; el loop es la fuente de verdad. El DTO público de sesión excluye autorización interna.
- Robustez: herramienta desconocida devuelve error estructurado, argumentos no objeto se redactan para logs, y un fallo de log no rompe el contrato.
- API: token opcional `APP_ACCESS_TOKEN`, límite por sesión y concurrencia por sesión. Para demo pública el token debe habilitarse por entorno, nunca en repositorio.
- Verificaciones: `npm run typecheck`, `npm test` (8 archivos, 79 pruebas) y `npm run build` aprobados; 29/29 hashes de fixtures coinciden.

### Validación conversacional Fase 3

- Previsualización: `oc_construir_payload` registra preparación pendiente desde backend cuando hay confirmaciones; el siguiente «confirmo» autoriza, revalida y crea en el mismo turno.
- Intención: «Procesa» permite crear solicitudes aptas; previsualizar, consultar, validar, negativas y contradicciones bloquean la creación desde backend.
- Historial: se separó historial público de `providerHistory`; este conserva `functionCall`/`functionResponse` y firmas devueltas por Gemini sin convertir herramientas en texto de usuario.
- Herramientas desconocidas: se registran como error en toolCalls, historial de logs y `out/log.jsonl`.
- Respuesta final: el servidor es el único responsable de persistir la respuesta asistente; confirmación/rechazo solo persisten el mensaje humano dentro del loop.
- Artefactos: herramientas generan evidencia/trazabilidad para borradores nuevos y preservan los artefactos definitivos de OC existente.
- Sesión/API: DTO público sin autorización interna; token demo opcional, límites por sesión y concurrencia local. Para demo pública se requiere `APP_ACCESS_TOKEN` por entorno.
- Verificaciones: `npm run typecheck`, `npm test` (9 archivos, 83 pruebas) y `npm run build` aprobados; 29/29 hashes de fixtures coinciden. Gemini real no se probó: falta `GEMINI_API_KEY`.

### Continuidad y seguridad final Fase 3

- La política de creación queda vinculada a un único caso solicitado en el turno. El backend rechaza que el modelo cree un caso diferente o que el usuario mencione varios casos de forma ambigua.
- Una confirmación con caso explícito solo coincide con el pendiente del mismo caso; mensajes intermedios invalidan el pendiente y una confirmación posterior exige una nueva revisión.
- Consultas con prohibición explícita no crean ni dejan estado pendiente; previsualizaciones permitidas sí preparan confirmación posterior.
- `providerHistory` conserva mensajes finales y partes estructuradas de Gemini, separado del historial público; tool results no se reintegran como texto de usuario.
- Verificaciones de continuidad: `npm run typecheck`, `npm test` (9 archivos, 86 pruebas) y `npm run build` aprobados; fixtures 29/29 SHA-256 intactos.

## Fase 4 implementada

- `web/`: Vite + React TypeScript con cliente API, sesión criptográfica del navegador, chat, selector de casos, resumen, tarjetas expandibles de herramientas, confirmación y descargas restringidas.
- Estilo: panel administrativo responsive con layout de tres columnas en escritorio y una columna en móvil.
- `src/server.ts`: `GET /api/casos`, descarga explícita de `aprobacion.txt`/`trazabilidad.json`, y servicio del bundle Vite compilado en producción.
- Backend: confirmación y resultado de creación quedan en `providerHistory`; logs de herramientas retienen solo `caso`/`confirmado` seguros.
- Scripts: `npm run dev`, `npm run build`, `npm start`; Vite proxifica `/api` durante desarrollo.

### Verificaciones Fase 4

- `npm run typecheck`: aprobado.
- `npm test`: 9 archivos, 86 pruebas aprobadas.
- `npm run build`: Vite compiló `dist/web` y esbuild compiló backend.
- Navegador integrado: UI montada en `http://127.0.0.1:56830/`; encabezado, casos, chat, resumen y estado de error de backend se visualizaron. La solicitud real mostró «Proveedor LLM no configurado», que es el comportamiento esperado sin clave.
- Fixtures: 29/29 SHA-256 coincidentes.
- Dependencias: npm reporta vulnerabilidades transitivas después de instalar Vite/React; no se aplicó `npm audit fix --force`.

### Auditoría React Fase 4

- Resumen: el DTO público de sesión ahora expone `orderSummary` estructurado desde backend; React no hace `JSON.parse` de logs truncados. Conserva datos al refrescar mientras vive la sesión.
- Descargas: React usa `fetch` autenticado con `x-app-token`, Blob y URL temporal; errores 401/404 se muestran en el resumen. El backend mantiene allowlist de casos/archivos.
- Casos/acceso: el chat agrega el caso seleccionado solo cuando el texto no contiene otro caso; una nueva sesión limpia resultado/error y descarta respuestas tardías por generación. El estado muestra backend conectado con proveedor `unconfigured`, no LLM operativo.
- Pruebas React: `OrderSummary.test.tsx` cubre datos estructurados, bloques/confirmaciones, token de descarga y 404; `ChatPanel.test.tsx` cubre selección y caso explícito.
- Visual: navegador integrado validó escritorio y móvil, selector, chat, resumen vacío y error real por proveedor Gemini sin configurar. No se validaron respuestas exitosas reales de Gemini.
- Verificaciones: typecheck, build y 90/90 pruebas aprobadas; 29/29 SHA-256 de fixtures coinciden. `npm audit` falló por error del endpoint de npm, por lo que no se pudo reclasificar vulnerabilidades; no se ejecutó fix forzado.

## Fase 5 implementada

- `demo.ts`: ejecuta las seis solicitudes por herramientas reales, limpia `out/`, usa autorización de sesión para RC5 y verifica idempotencia de `sol-001`; no invoca Gemini.
- `tests/demo.test.ts`: demo sobre directorio temporal, seis resultados, control CSV, JSONL, evidencias/trazabilidad y determinismo funcional.
- `README.md`, `SOLUCION.md` y `.env.example`: entregables P0 documentados; SOLUCION contiene las 12 secciones del PRD.
- Ajustes frontend: cerrar token invalida acceso y sesión local; validación/previsualización actualizan `orderSummary` público sin usar logs truncados.

### Verificaciones Fase 5

- `npx npm@11 ci --dry-run`: aprobado; instalación limpia no se ejecutó para no reemplazar el entorno en uso.
- `npm run typecheck`: aprobado.
- `npm test`: 12 archivos, 92 pruebas aprobadas.
- `npm run build`: frontend Vite y backend esbuild aprobados.
- `npm run demo`: aprobado sin `GEMINI_API_KEY`; salida real en `out/` con OCs `4500000001` y `4500000002`.
- Fixtures: 29/29 SHA-256 coincidentes.
- `npm audit`: falló al consultar el endpoint npm; npm había reportado previamente 1 vulnerabilidad alta y 2 críticas sin clasificación disponible. No se ejecutó `audit fix --force`.

## Fase 6 parcial implementada

- Gemini: modelo retirado eliminado; se usa `gemini-flash-latest`, alias oficial documentado para function calling. La clave viaja por `x-goog-api-key`, nunca en URL. `.env` se carga con `node --env-file-if-exists=.env`; una variable de hosting preexistente tiene prioridad. Sin clave no se pudo consultar la lista de modelos ni ejecutar chat real.
- Despliegue: `render.yaml` listo con Node, build/start, health y secretos no sincronizados. README documenta configuración y persistencia efímera de Render.
- Seguridad de dependencias: `npm audit --json` identificó `concurrently@9.2.1`/`shell-quote` crítico y Vite 7.1.7 alto. Se actualizaron puntualmente a `concurrently@10.0.7` y `vite@8.3.8` con plugin React 6.3.0; auditoría posterior reporta 0 vulnerabilidades (74 prod, 220 dev).
- Repositorio: Git local inicializado; `.gitignore` excluye node_modules, out, .env, dist, .perxia, graphify-out y ZIP. Los fixtures descomprimidos y entregables permanecen listados para versionar. No se creó commit ni se publicó remoto.
- Linux: Docker Linux no está activo y WSL no tiene Node; instalación Linux real queda pendiente. `npm ci --dry-run` local aprobado, pero no equivale a instalación Linux real.
- Externos: no hay integración GitHub/Render ni `GEMINI_API_KEY`, por lo que no existe URL/repo público ni prueba de chat Gemini real.
- Cierre técnico: política conservadora de no crear, TTL/capacidad de sesiones, 404 de sesión inexistente, límite global y por origen/sesión, y token obligatorio en producción con Gemini. Verificaciones finales: 99 pruebas, build externo, demo y smoke de producción (`/healthz=200`, API sin token=401, API con token=200, `/`=200).

### Límites y pendientes de integración

- Fase 1 no crea órdenes, no autoriza confirmaciones, no implementa SAP, evidencia, API ni frontend; deben verificarse en fases posteriores.
- RC9 compara el día calendario local de la aprobación con la fecha de solicitud. DV explícito incorrecto rechaza proveedor; los NIT ficticios pueden contener DV inconsistentes y no se usan para invalidar la cotización.
- Los códigos IVA/pago derivados solo se incluyen si existen en sus maestros; falta definir el tratamiento de errores de catálogo en las herramientas de fase 3.
- RC5 compara importes nominales; la política para monedas distintas no está definida en el PRD y queda pendiente de decisión antes de aceptar paquetes de moneda mixta.
- La regla `H`/`UN` está documentada pero la construcción del payload corresponde a una fase posterior.

## Herramientas verificadas

- Archivos y terminal local: disponibles.
- PERXIA: proyecto local y `perxia/model-router` visibles.
- Navegador PERXIA: disponible.
- MCP draw.io: disponible y usado para validar el C4.
- Azure DevOps, Microsoft 365, AWS, Context7 y DeepWiki: conectores disponibles; no necesarios para Fase 0.
- Repositorio Git/GitHub y destino de despliegue: no confirmados.
