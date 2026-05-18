# crm-infra

Repositorio de infraestructura y operacion local de CIMA CRM en modo multi-repo.

## Que contiene

- KrakenD y su generacion de config
- Docker Compose para Postgres, Redis, ClamAV y gateway
- scripts de arranque y verificacion multi-repo
- documentacion operativa del stack separado

## Requisitos

- Node.js 22+
- `pnpm`
- Docker Desktop
- repos hermanos en `D:\BACKUP CELULAR OLIMPO\`:
  - `crm-auth`
  - `crm-collab`
  - `crm-media`
  - `crm-frontend`

Tambien puedes usar rutas personalizadas con:

- `CIMA_AUTH_PATH`
- `CIMA_COLLAB_PATH`
- `CIMA_MEDIA_PATH`
- `CIMA_FRONTEND_PATH`

## Arranque local

```powershell
pnpm install
powershell -NoProfile -ExecutionPolicy Bypass -File .\start-project.ps1
```

El arranque hace bootstrap de `.env` locales si faltan, levanta la infraestructura aislada y prepara la base del entorno separado.

## Verificacion

Smoke rapido:

```powershell
pnpm smoke:multirepo
```

Verificacion completa:

```powershell
pnpm verify:multirepo
```

Verificacion UI del cutover:

```powershell
pnpm verify:frontend-ui
```

La verificacion completa cubre:

- health checks del stack separado
- login por gateway
- proxy `/api` desde el frontend
- OCI real en `crm-media`
- smoke RBAC de `crm-collab`
- rate limit de `crm-auth` via KrakenD

La verificacion UI cubre:

- login real en el frontend
- dashboard
- creacion de proyecto
- creacion de tarea
- subida de archivo adjunto desde la UI

## Puertos por defecto

- Gateway: `18080`
- Postgres: `15432`
- Redis: `16379`
- ClamAV: `13310`
- Frontend: `5173`
- Auth: `3000`
- Collab: `3001`
- Media: `3002`

## Variables locales utiles

- `COMPOSE_PROJECT_NAME`
- `GATEWAY_HOST_PORT`
- `POSTGRES_HOST_PORT`
- `REDIS_HOST_PORT`
- `CLAMAV_HOST_PORT`
- `FRONTEND_PORT`

## Siguiente nivel operativo

Antes de declarar el corte final del monorepo, sigue `CUTOVER-CHECKLIST.md`.
