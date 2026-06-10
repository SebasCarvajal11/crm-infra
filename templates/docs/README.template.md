# {{SERVICE_TITLE}}

> {{SERVICE_TAGLINE}}

## Propósito

{{SERVICE_PURPOSE}}

## Entorno

Copia `.env.example` y rellena los valores requeridos:

```bash
cp .env.example .env
```

Variables clave:

| Variable | Descripción | Requerida |
|----------|-------------|-----------|
| `DATABASE_URL` | Cadena de conexión PostgreSQL | ✅ |
| `REDIS_URL` | Cadena de conexión Redis | ✅ |
| `SERVICE_VERSION` | Versión semver del servicio | ✅ |

Ver [`.env.example`](./.env.example) para la lista completa.

## Local

```bash
pnpm install
pnpm db:bootstrap   # crear schema y rol en Postgres
pnpm db:push        # aplicar migraciones Drizzle
pnpm dev            # servidor con hot-reload (tsx watch)
```

Endpoints útiles en dev:

- API: `http://localhost:{{PORT}}`
- Health: `http://localhost:{{PORT}}/api/v1/health`
- Métricas: `http://localhost:{{PORT}}/api/v1/metrics`
- OpenAPI: `http://localhost:{{PORT}}/openapi.json`

Workers (procesos separados):

```bash
{{WORKER_COMMANDS}}
```

## Deploy

El deploy está centralizado en `crm-infra`:

```bash
# Desde crm-infra/
./deploy/remote/deploy-component.sh {{SERVICE_NAME}}
```

El script sincroniza el repo, aplica migraciones y reinicia el slot inactivo (blue/green).

Ver [crm-infra/ONBOARDING.md](../crm-infra/ONBOARDING.md) para el flujo completo.

## Tests

```bash
pnpm test:unit     # tests unitarios (Vitest)
pnpm test          # tests de contrato Hurl (requiere stack local levantado)
```

Cobertura mínima esperada:
- Validación de esquemas Zod
- Flujos críticos del dominio
- Contrato HTTP (Hurl)

## Contrato público

- OpenAPI: [`openapi/openapi.yaml`](./openapi/openapi.yaml)
- Gateway manifest: [`gateway/gateway.manifest.json`](./gateway/gateway.manifest.json)
