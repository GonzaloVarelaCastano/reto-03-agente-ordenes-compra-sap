# Reto 03 — Agente conversacional de Órdenes de Compra SAP

Aplicación para preparar y crear órdenes de compra con controles deterministas RC1–RC10, confirmación humana y SAP simulado basado en archivos.

## Requisitos

- Node.js 22 o superior.
- npm.
- Gemini es opcional para el chat real; la demo y las pruebas no requieren API key.

## Instalación

```bash
npm ci
copy .env.example .env
```

En sistemas Unix use `cp .env.example .env`. No agregue `.env` al repositorio.

## Variables de entorno

Consulte `.env.example`. Las variables activas son `PORT`, `NODE_ENV`, `LLM_PROVIDER`, `LLM_MODEL`, `GEMINI_API_KEY`, `APP_ACCESS_TOKEN`, `MAX_AGENT_ITERATIONS`, `MAX_SESSION_TOKENS`, `LLM_TIMEOUT_MS` y `CHAT_RATE_LIMIT`.

Sin `GEMINI_API_KEY`, la interfaz y API arrancan, pero `/api/chat` informa que el proveedor no está configurado. Esto es esperado; las pruebas usan adaptadores simulados. El valor predeterminado es `gemini-flash-latest`, alias oficial documentado para function calling; el adaptador envía la clave exclusivamente en el encabezado `x-goog-api-key`, no en la URL ni en logs.

## Ejecución

```bash
npm run dev
```

Inicia Express y Vite. Vite envía `/api` a Express durante desarrollo.

```bash
npm test
npm run typecheck
npm run build
npm start
```

`build` genera `dist/web` y `dist/server.js`; `start` sirve el bundle compilado desde Express.

## Demo sin LLM

```bash
npm run demo
# equivalente: npx tsx demo.ts
```

La demo limpia `out/`, procesa `sol-001` a `sol-006` mediante las herramientas reales y escribe auditoría, evidencias, trazabilidad y SAP mock. No usa Gemini ni HTTP externo.

## API

- `GET /api/health`: estado del servidor, proveedor y modelo sin credenciales.
- `GET /api/casos`: casos permitidos de fixtures.
- `POST /api/chat`: `{ sessionId, message }`.
- `GET /api/sessions/:id`: DTO público de historial, herramientas, confirmación y resumen.
- `GET /api/evidencias/:caso/:archivo`: solo `aprobacion.txt` y `trazabilidad.json` permitidos.

Cuando `APP_ACCESS_TOKEN` está definido, todos los endpoints requieren el encabezado `x-app-token`. La interfaz solicita el token y lo mantiene solo en memoria.

## Casos oficiales

- `sol-001`: crea automáticamente y es idempotente.
- `sol-002`: RC1, no crea.
- `sol-003`: RC2/RC3, no crea.
- `sol-004`: RC5, requiere confirmación.
- `sol-005`: RC8, retroactiva y requiere confirmación.
- `sol-006`: RC6, deriva IVA y pago; requiere confirmación.

Una confirmación corresponde a una sola sesión, solicitud, huella del payload y conjunto de excepciones. Las confirmaciones no eliminan bloqueos.

## Salidas

`out/` es efímero y no se versiona:

- `out/sap/ordenes.jsonl`: órdenes simuladas.
- `out/control.csv`: auditoría de intentos.
- `out/<caso>/aprobacion.txt`: evidencia.
- `out/<caso>/trazabilidad.json`: procedencia por campo.
- `out/log.jsonl`: llamadas de herramienta con argumentos seguros.

## Solución de problemas

| Situación | Acción |
|---|---|
| API key ausente | Configure `GEMINI_API_KEY` solo en el servidor o use demo/pruebas sin LLM. |
| Backend no disponible | Compruebe que `npm run dev` sigue activo y que el puerto 3000 no está ocupado. |
| Puerto ocupado | Defina `PORT` con un puerto libre; ajuste el proxy Vite si Express no usa 3000. |
| Dependencia nativa falla tras cambiar sistema | Elimine `node_modules` y ejecute `npm ci` en el sistema destino; los bindings de Rolldown son opcionales por plataforma. |
| Descarga 401/404 | Revise el token de demo y que el archivo exista en `out/<caso>/`. |
| Salidas desaparecen | `out/` depende del disco local; es efímero en muchos despliegues. |

## Despliegue

`render.yaml` prepara Render Free con Node 22, `npm ci --include=dev && npm run build`, `npm start`, `/healthz` público y secretos inyectados por el hosting. El plan Free puede suspenderse por inactividad. Configure `GEMINI_API_KEY` y, si la demo será pública, `APP_ACCESS_TOKEN` en el panel del proveedor; nunca en Git.

No hay URL pública ni repositorio GitHub publicados todavía: la conexión GitHub/Render no está disponible en este entorno. Antes de desplegar, conecte este repositorio a GitHub, cree el Web Service desde `render.yaml`, configure secretos en Render y verifique la URL resultante con `/api/health`. En Render el disco puede ser efímero: reiniciar el servicio puede perder `out/`, órdenes mock, evidencias, trazabilidad, auditoría y sesiones en memoria. Para la defensa, reinicie el servicio y vuelva a procesar los casos; para producción use almacenamiento persistente y una base de datos.

## Limitaciones

SAP es un mock local; no hay autenticación empresarial, persistencia distribuida ni prueba Gemini real sin una clave configurada.
