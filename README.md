# CRM Infra

`crm-infra` is the platform orchestration repository for the CIMA CRM multi-repo stack.

## Scope

- KrakenD config generation
- versioned integration contracts under `contracts/`
- local shared infrastructure with Docker Compose
- multi-repo bootstrap and verification scripts
- platform-level entrypoint for the split environment

This repo expects sibling repositories for `crm-auth`, `crm-collab`, `crm-media`, and `crm-frontend`, or explicit paths through environment variables.

## Requirements

- Node.js 22+
- `pnpm`
- Docker Desktop
- sibling service repositories or configured `CIMA_*_PATH` variables

Supported path overrides:

- `CIMA_AUTH_PATH`
- `CIMA_COLLAB_PATH`
- `CIMA_MEDIA_PATH`
- `CIMA_FRONTEND_PATH`

## Local Bootstrap

### Option 1: Docker (recommended)

Lifts the entire stack (infrastructure + services) with a single command:

```powershell
.\start-local.ps1
```

Equivalent direct Compose command:

```powershell
docker compose --env-file .env.docker up --build
```

The Docker option expects `crm-auth/.env`, `crm-collab/.env`, and `crm-media/.env` to exist with real service-owned secrets. `crm-infra/.env.docker` only defines local ports, development database passwords, and Docker DNS hosts for KrakenD. The `krakend-config` one-shot service generates the gateway config inside Compose before `api-gateway` starts.

### Option 2: Hybrid development (infrastructure in Docker, services on host)

Ideal for iterative development with hot-reload:

```powershell
# 1. Lift infrastructure
docker compose up -d postgres_db redis clamav-scanner

# 2. Configure .env files
pnpm setup:env

# 3. Generate gateway configuration
pnpm setup:gateway

# 4. Run migrations and seed
pnpm setup:db

# 5. Lift all services
pnpm dev:all
```

### Option 3: Individual services

Each service can start independently:

```powershell
# In crm-auth/
pnpm dev

# In crm-collab/
pnpm dev

# In crm-media/
pnpm dev

# In crm-frontend/
pnpm dev
```

### Available scripts

| Script | Description |
|--------|-------------|
| `pnpm setup:env` | Create/update .env files for all services |
| `pnpm setup:gateway` | Generate krakend.json for local development |
| `pnpm setup:db` | Run database migrations and seed |
| `pnpm setup:all` | Run all setup scripts |
| `pnpm dev:all` | Lift the 4 main services in parallel |

### Workers

Background workers run separately from the main services:

```powershell
# In crm-auth/
pnpm worker:email
pnpm worker:cleanup

# In crm-media/
pnpm worker:quarantine-scan
```

## Verification

Useful commands:

- `pnpm contracts:build`
- `GATEWAY_TRUST_SECRET=... KRAKEND_AUTH_HOST=... KRAKEND_COLLAB_HOST=... KRAKEND_MEDIA_HOST=... pnpm gateway:build`
- `docker compose --env-file .env.docker config --quiet`
- `docker compose --env-file .env.docker up --build`
- `pnpm smoke:multirepo`
- `pnpm verify:multirepo`
- `pnpm verify:frontend-ui`

Default ports:

- Gateway: `18080`
- Postgres: `15432`
- Redis: `16379`
- ClamAV: `13310`
- Frontend: `5173`
- Auth: `3000`
- Collab: `3001`
- Media: `3002`

Useful local overrides:

- `COMPOSE_PROJECT_NAME`
- `GATEWAY_HOST_PORT`
- `GATEWAY_TRUST_SECRET`
- `KRAKEND_AUTH_HOST`
- `KRAKEND_COLLAB_HOST`
- `KRAKEND_MEDIA_HOST`
- `POSTGRES_HOST_PORT`
- `REDIS_HOST_PORT`
- `CLAMAV_HOST_PORT`
- `FRONTEND_PORT`

## Production Deployment

Production deployment is centralized here even when the code lives in split repositories.

- `docker-compose.prod.yml` owns the stable shared platform: Postgres, Redis, ClamAV, and the public edge proxy
- Redis runs with AOF persistence because Redis Streams carry operational events and DLQ records
- `docker-compose.slot.prod.yml` defines one application slot (frontend, gateway, auth, collab, media, and workers)
- `crm-shared-backplane` is the explicit Docker network used by both layers so slot services can reach shared dependencies without host-gateway tricks
- `.github/workflows/reusable-deploy.yml` is the shared GitHub Actions deployment entrypoint
- `deploy/remote/bootstrap-server.sh` prepares the target host deterministically
- `deploy/remote/deploy-component.sh` is the only remote deployment command executed on the server
- each service repository deploys through `crm-infra` instead of duplicating server logic

Current production assumptions:

- Ubuntu-like host with Docker Engine + Compose plugin
- external Docker volumes exist for shared persistent state: `crm-infra_postgres_data_prod`, `crm-infra_clamav_data_prod`, and `crm-infra_redis_data_prod`
- Node.js 22+ and `pnpm` installed on the server
- sibling clones at `<base>/crm-infra`, `<base>/crm-auth`, `<base>/crm-collab`, `<base>/crm-media`, and `<base>/crm-frontend`
- untracked `.env.production` files in each repository
- `.env.production.example` is versioned in each repository as the template source
- GitHub Actions secrets:
  - `DEPLOY_SSH_HOST`
  - `DEPLOY_SSH_PORT`
  - `DEPLOY_SSH_USER`
  - `DEPLOY_SSH_PRIVATE_KEY`
  - `DEPLOY_BASE_DIR`

Oracle ARM note:

- `postgres:16-alpine`, `redis:7-alpine`, and `krakend:latest` expose `linux/arm64` images.
- ClamAV production now uses `clamav/clamav-debian:latest` because the Alpine `clamav/clamav:latest` image is not published for `linux/arm64`.

First-time server bootstrap:

```bash
export DEPLOY_BASE_DIR=/opt/cima
export DEPLOY_BRANCH=main
bash deploy/remote/bootstrap-server.sh
```

## CI/CD Model

The platform uses a split but standardized pipeline model:

- each service repository owns its own CI and must prove its own build and service-level verification
- production deployment logic is centralized in `crm-infra`
- service repositories call the shared reusable deployment workflow from `crm-infra` instead of carrying custom SSH logic
- the Oracle host enforces a server-side deployment lock through `flock`, so concurrent deploy triggers cannot mutate the stack at the same time
- the public production entrypoint is a stable edge proxy on port `80`
- deployments use blue/green application slots on loopback host ports (`8081/8082` for frontend, `18081/18082` for gateway)
- the edge proxy only switches to the inactive slot after the new slot passes local health verification
- the gateway is never exposed publicly; `/api` stays behind the frontend/edge chain
- shared dependencies (`postgres_db`, `redis`, `clamav-scanner`) are consumed over a dedicated Docker backplane instead of `host.docker.internal`, which avoids host-routing drift across Docker Engine updates
- CSP allowances for external browser connections are controlled from `crm-infra/.env.production` through `CSP_CONNECT_SRC_EXTRA` and `CSP_IMG_SRC_EXTRA`; when unset, deploy infers the OCI Object Storage origin from `OCI_REGION` in `crm-media`.

This is the baseline expected for future modules: independent CI in the module repo, centralized deployment orchestration in `crm-infra`, and explicit environment/secret management outside source control.

## Notes

- Slot-specific KrakenD runtime files are generated under `deploy/runtime/krakend.<slot>.json`.
- Consolidated `openapi.yaml` generation is optional and depends on the presence of the sibling service repos.

## Integración de Nuevo Servicio

Para agregar un nuevo microservicio al ecosistema CIMA CRM, seguir estos pasos:

### Paso 1: Crear servicio desde template

```bash
cd crm-infra
bash templates/microservice/setup.sh <service-name> <port> [db-password]
```

Esto crea `crm-<service-name>/` con toda la estructura base configurada.

### Paso 2: Agregar esquema y usuario en PostgreSQL

Editar `scripts/00-init-service-schemas.sh` y agregar:

```bash
create_role_if_missing "<service>_user" "${<SERVICE>_DB_PASSWORD:-<password>}"
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
    CREATE SCHEMA IF NOT EXISTS schema_<service>;
    GRANT ALL PRIVILEGES ON SCHEMA schema_<service> TO <service>_user;
    ALTER DEFAULT PRIVILEGES IN SCHEMA schema_<service>
        GRANT ALL ON TABLES TO <service>_user;
    ALTER DEFAULT PRIVILEGES IN SCHEMA schema_<service>
        GRANT ALL ON SEQUENCES TO <service>_user;
    REVOKE ALL ON SCHEMA schema_<service> FROM public;
EOSQL
```

### Paso 3: Agregar al docker-compose

Agregar el servicio a `docker-compose.yml`:

```yaml
crm-<service>:
  build:
    context: ../crm-<service>
    dockerfile: Dockerfile
  container_name: cima-<service>
  restart: unless-stopped
  depends_on:
    postgres_db:
      condition: service_healthy
    redis:
      condition: service_healthy
  environment:
    DATABASE_URL: postgres://<service>_user:<password>@postgres_db:5432/crm_database
    DB_SCHEMA: schema_<service>
    PORT: "<port>"
    REDIS_URL: redis://redis:6379
    GATEWAY_TRUST_SECRET: ${GATEWAY_TRUST_SECRET}
  healthcheck:
    test: ["CMD", "node", "-e", "fetch('http://localhost:<port>/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
    interval: 20s
    timeout: 10s
    retries: 5
    start_period: 40s
  networks:
    - cima-net
```

### Paso 4: Agregar endpoints explicitos al gateway

Agregar rutas concretas en `gateway/endpoints/<service>.json`. KrakenD CE no soporta
un proxy catch-all por prefijo con `**` ni `method: "*"`, así que cada contrato público
debe declararse por método y ruta:

```json
{
  "endpoints": [
    {
      "endpoint": "/api/v1/<service>/resources/{resourceId}",
      "method": "GET",
      "backend_url": "/api/v1/<service>/resources/{resourceId}"
    }
  ]
}
```

### Paso 5: Regenerar gateway

```bash
cd crm-infra
node gateway/build-krakend.mjs
```

### Paso 6: Definir eventos (si aplica)

Si el servicio produce eventos que otros necesitan:

1. Definir tipos de eventos en `src/modules/<domain>/events/`
2. Publicar a Redis Stream con `XADD`
3. Documentar en `AGENTS.md`

Si el servicio consume eventos de otros:

1. Crear consumer group en `src/workers/`
2. Suscribirse con `XREADGROUP`
3. Documentar en `AGENTS.md`

### Paso 7: Agregar al frontend (si aplica)

Si el frontend necesita consumir la API del nuevo servicio:

1. Agregar rutas a `crm-frontend/src/shared/lib/gateway-routes.ts`
2. Crear feature module en `crm-frontend/src/features/<service>/`

### Paso 8: Desplegar

```bash
# Local
docker compose up -d --build

# Producción
# Agregar a docker-compose.slot.prod.yml
# Configurar .env.production
```
