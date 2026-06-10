# AGENTS

## Purpose

`crm-infra` is the orchestration repository for the CIMA CRM multi-repo platform. It owns local infrastructure, gateway generation, validation flows, and operational bootstrap for the split services. It is not a business-domain repository and should stay focused on platform wiring.

## System Boundaries

- Owns Docker Compose for local shared infrastructure such as Postgres, Redis, ClamAV, and KrakenD.
- Owns KrakenD configuration generation and the public API entrypoint shape.
- Owns stack bootstrap and verification scripts for the split repositories.
- Does not own authentication, collaboration, media, or frontend business logic.

## Fronteras con otros servicios

- **Upstream**: Todos los repositorios individuales de microservicios (`crm-auth`, `crm-collab`, `crm-media`, `crm-frontend`, y `cima-contracts`).
- **Downstream**: Ninguno (es el orquestador global de la plataforma).
- **Pares**: N/A.
- **Recursos Compartidos**: Docker Daemon, red interna compartida (`shared_backplane`), variables de entorno comunes para base de datos y Redis.
- **Fuera de mi responsabilidad**: Lógica interna de cada servicio y esquemas específicos de bases de datos.

## Architecture Rules

- Keep this repo as the platform entrypoint, not as a dumping ground for service-specific behavior.
- Infrastructure definitions, gateway generation, and operational verification must remain explicit and deterministic.
- Avoid hardcoded assumptions about monorepo paths. Prefer configurable sibling-repo resolution through environment variables or well-defined conventions.
- Generated artifacts must have a single source of truth. Do not maintain duplicated gateway configs or parallel documentation that can drift.
- Verification scripts should test contracts between repos, not hide missing dependencies or silently skip critical failures.

## Code Organization

- `gateway/`: gateway templates, endpoint definitions, and config generation.
- `scripts/`: operational verification and UI smoke checks only.
- root scripts: platform bootstrap and compose orchestration.
- root compose files: local and production-oriented infrastructure definitions.

## Operational Rules

- `start-local.ps1` is the canonical local bootstrap for Windows. Keep it predictable, fail-fast, and safe to rerun.
- The root `krakend.json` is the runtime file used by Docker Compose. Treat it as generated from `gateway/build-krakend.mjs`.
- CI should validate what the repo can guarantee in isolation. Optional cross-repo artifacts must not be asserted as mandatory unless CI provisions the required sibling repos.
- Secrets, certificates, cookies, local state, and generated outputs outside the committed runtime contract must stay out of git.

## Development Rules

- Use `pnpm` only. Never add `npm` commands, lockfiles, or docs.
- Keep documentation minimal: only `README.md` and this file.
- Prefer concise operational guidance in `README.md` over long manuals.
- If future services in other languages join the platform, integrate them through clear contracts and repo discovery rules rather than special-case script sprawl.

## Workers Orchestration Guidelines

Background worker processes are managed as independent services at the orchestration layer:

- **Deployment & Scaling**: Workers are defined as distinct containers in Docker Compose (e.g. `crm-auth-email-worker`, `crm-media-command-worker`). They must scale independently (using replicas) without coordinating or coupling with main web/API server entrypoints.
- **Dependency Isolation**: Each worker has restricted network and DB access corresponding to its own service boundaries (e.g. using specific schema roles: `auth_user`, `collab_user`, `media_user`).
- **Health Monitoring**: Docker Compose services for workers define health checks calling `docker-healthcheck.sh`. This script checks the age and status reported in `/tmp/worker-healthy` updated by the worker process.
- **Graceful Draining**: During deployments or scale-down events, standard orchestration signals (`SIGTERM`) must be propagated to workers, giving them time (up to 10s default) to complete processing active tasks or messages before exit.

## Independent Deployments & Rollbacks

Operational deployments use a slot-based (Blue/Green) model with version tracking at the repository level:

- **Component Deployments**: Pipelines can trigger deployments of individual components (e.g. `auth`, `collab`, `media`, `frontend`) using `deploy-component.sh <component>`.
- **Active Version Registry**: The orchestrator maintains active version files per slot (`.active-versions-blue` and `.active-versions-green`) tracking both the semantic version (obtained from `package.json`) and the git commit SHA of each deployed component in the format `semver@hash`.
- **Service Isolation**: When deploying a single component, only that component is synced to the target/latest version. Other components are checked out to their currently active versions resolved from the active slot's registry.
- **Rollbacks**: Reverting a component to a previous version is done by executing the deployment script for that component specifying the desired target version (via environment variable `DEPLOY_VERSION` or `DEPLOY_VERSION_<component>`). This deploys the older version to the inactive slot alongside the current versions of all other services, verifying health before cutover.
- **Semantic Versioning**: All services strictly adopt semantic versioning. The version is declared in each service's `package.json` and passed via `SERVICE_VERSION` env var, which is propagated to logs, metrics, and healthcheck routes.


## Contract Testing Guidelines

Contract tests verify key endpoints and routing structure between the frontend and microservices:

- **Frontend Route Validation**: The script `pnpm audit:routes` in `crm-frontend` validates that every route defined in the central `gateway-routes.ts` file maps to an endpoint declared in the gateway manifests (`gateway.manifest.json`) of the backend services.
- **Service Contract Verification**: The script `pnpm test:contracts` in `crm-infra` runs contract validation on the whole stack. It runs against an ephemeral, clean environment: it pulls down existing compose environments, recreates all containers and volumes from scratch, runs database migrations/seeds, and executes the `test:contract` script in each repository (`crm-auth`, `crm-collab`, `crm-media`).
- **Pre-merge Verification**: Before merging any changes that alter the public API contract (e.g. changes in `openapi.yaml` or `gateway.manifest.json`), the developer must run the contract test suite unifier (`pnpm test:contracts`) to ensure compatibility.


## Gateway Manifest Lifecycle & Versioning Policy

To ensure backward compatibility and prevent breaking client (e.g., frontend) integration, the gateway configuration/manifests adhere to a strict versioning and lifecycle policy:

- **Manifest Schema Versioning**: The structure/schema of the `gateway.manifest.json` files is versioned under `manifestSchemaVersion` (defaulting to `1.0.0`). Any backward-incompatible schema changes (e.g., removing a supported property, altering its type) require a major schema version bump.
- **Endpoint Lifecycle States**:
  - **Published**: The endpoint is active, fully supported, and documented in the service's `openapi.yaml`.
  - **Supported**: The endpoint is stable. Services must maintain backward compatibility for all supported endpoints.
  - **Deprecated**: A service may mark an endpoint as deprecated by documenting it in the release notes or the API schema. The endpoint remains functional, but clients should migrate to a newer version. Deprecated endpoints must be kept functional for a minimum window of 30 days or until the next major release.
  - **Retired**: The endpoint is completely removed from the manifest and openapi spec, and is no longer routed by the API Gateway.
- **Enforcement & Validation**:
  - Services validate their manifests against the Zod schema (`GatewayManifestSchema`) imported from `@sebascarvajal11/cima-contracts` during their CI/CD pipeline using the `pnpm gateway:validate` command.
  - Developers can run comparison checks using the orchestrator's generator: `node gateway/build-krakend.mjs --compare <oldManifestPath> <newManifestPath>` to automatically detect and report breaking changes (e.g., removed endpoints, visibility changes, or field exclusions).


## Platform Invariants & Recovery Procedures

This section documents the orchestrator invariants, startup order, dependencies, and recovery steps for platform components.

### Startup Order & Topology
To prevent initialization failures and ensure components can discover each other, the platform services must be started in the following order:
1. **Infrastructure Tier**: PostgreSQL database (`crm_database`) and Redis stream/queue broker (`crm_redis`).
2. **Identity & Tier**: `crm-auth` service. This is a critical dependency since all other services require its JWKS endpoint to retrieve signing keys and validate JWT signatures.
3. **Domain Microservices**: `crm-collab` and `crm-media` (and their background workers).
4. **Gateway Tier**: the edge gateway (KrakenD).
5. **Client Tier**: `crm-frontend` SPA.

### Hard Dependencies
- **PostgreSQL**: Hard dependency for `crm-auth`, `crm-collab`, and `crm-media` data persistence. If Postgres is unavailable, services will fail their startup health checks and exit.
- **Redis**: Hard dependency for event pub/sub streams, worker queues (BullMQ), and rate limiting. If Redis is unavailable, the background workers and outbox processors will halt.
- **JWKS Endpoint (`crm-auth`)**: Hard dependency for `crm-collab` and `crm-media`. These services cache JWKS keys but require connection to `crm-auth` on startup/first signature check to retrieve them.

### Health Check Protocols
- **Gateway Health**: The API Gateway exposes `/api/v1/health` which aggregates the health checks of all microservices (`auth`, `collab`, `media`) by performing a native parallel fan-out check.
- **Service Health**: Each service exposes a `/api/v1/health` endpoint returning detailed dependency status (Postgres, Redis, ClamAV, OCI).
- **Background Worker Health**: Workers write their status reports to `/tmp/worker-healthy` periodically. The container's `docker-healthcheck.sh` reads and validates this report.

### Recovery Procedures
- **Database Outage Recovery**:
  1. Restore the PostgreSQL service instance.
  2. The microservices (`auth`, `collab`, `media`) will automatically reconnect using standard pool retry loops.
  3. Verify schema synchronization by checking the version in the `schema_version` table. If drift is detected, rerun the `bootstrap.ts` script for the affected service.
- **Redis Broker Outage Recovery**:
  1. Restart the Redis instance.
  2. Workers and event bus subscribers will automatically reconnect.
  3. In case of lost event stream offsets:
     - Clear the consumer group stream pointer to reprocess from `0-0` or the last known ID.
     - For `crm-collab`, if user snapshots are lost or corrupted, delete the snapshots and restart the consumer to trigger a synthetic `identity.replay-requested` event. `crm-auth` will listen to this request and replay historical identity events.
- **Service Outage Recovery**:
  1. If `crm-auth` goes down, downstream services will serve requests using cached public keys but new token validations will fail. Restore `crm-auth` first.
  2. If a worker fails, restart the specific worker container. Check `/tmp/worker-healthy` for diagnostic logs.


## Legacy Patterns Retirement & Deprecation Policy

To maintain a clean and decoupled architecture, the platform enforces a strict policy for retiring legacy patterns and configurations:

- **Policy Statement**: No deprecated pattern, file, or configuration remains in the codebase beyond its agreed retirement date.
- **Retired Patterns**:
  - **HTTP-based Identity Hydration (Retired: 2026-05-01)**: The REST endpoint `/bootstrap-identities` in `crm-auth` and HTTP-based hydration scripts are completely removed. Restoring identity snapshots must be done via the event replay-request stream (`stream:auth.identity-replay-requests`).
  - **Static Gateway BFF Configuration (Retired: 2026-05-15)**: The legacy `bff.json` configuration in the gateway is completely retired and removed. All composition logic is handled dynamically by the frontend composition layer.
  - **Legacy Endpoints Config (Retired: 2026-06-01)**: The unvalidated `endpoints.json` files are completely replaced by validated `gateway.manifest.json` manifests.


