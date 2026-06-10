# AGENTS — {{SERVICE_TITLE}}

## Propósito

{{SERVICE_PURPOSE}}

## Fronteras

**Qué hace este servicio:**
- {{DOES_1}}

**Qué NO hace (fuera de su responsabilidad):**
- {{DOES_NOT_1}}

**Upstream** (depende de): {{UPSTREAM}}
**Downstream** (lo consumen): {{DOWNSTREAM}}
**Recursos compartidos**: {{SHARED_RESOURCES}}

## Reglas de Arquitectura

- Separación estricta: controladores delgados → servicios → repositorios → infraestructura.
- Fail-fast en validación de inputs en la frontera del servicio.
- Sin lógica de negocio en workers ni en middlewares.
- Sin foreign keys cruzando schemas de DB.

## Organización del código

```
src/
  modules/     # Lógica de dominio (controladores, servicios, repositorios)
  workers/     # Procesos background
  shared/      # Middlewares, helpers, redis, health
  config/      # Variables de entorno (env.ts), JWT
  db/          # Schema Drizzle, migraciones, seed
openapi/       # openapi.yaml (fuente de verdad del contrato HTTP)
gateway/       # gateway.manifest.json (rutas expuestas por KrakenD)
tests/         # Hurl contract tests
```

## Workers y procesos background

{{WORKERS_SECTION}}

## Configuración

- Fuente de verdad: [`.env.example`](./.env.example)
- Validación fail-fast al inicio en `src/config/env.ts`
- Sin secretos reales en el repositorio

## Reglas de desarrollo

- `pnpm` exclusivamente. Nunca `npm`.
- Un PR por cambio de contrato público (openapi.yaml o gateway.manifest.json).
- Migrations: solo cambios backward-compatible (expand & contract).
- Antes de mergear: pasar `pnpm test` y `pnpm gateway:validate`.

## Niveles de testing

| Nivel | Comando | Descripción |
|-------|---------|-------------|
| Unitario | `pnpm test:unit` | Funciones puras, validadores, lógica sin I/O |
| Contrato local | `pnpm test` | Tests Hurl contra el servicio con DB/Redis locales |
| Cross-stack | orquestado por `crm-infra` | E2E con stack completo |

## Observabilidad

- Health: `GET /api/v1/health` — estado de DB, Redis y dependencias opcionales
- Métricas: `GET /api/v1/metrics` — Prometheus text/plain (prom-client)
- Logs: pino (JSON en producción, pretty en dev) → Loki via promtail
- Dashboard: Grafana http://localhost:13000 → "CIMA CRM — Overview"
