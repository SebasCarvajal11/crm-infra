# CRM Infra

`crm-infra` is the platform orchestration repository for the CIMA CRM multi-repo stack.

## Scope

- KrakenD config generation
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

```powershell
pnpm install
powershell -NoProfile -ExecutionPolicy Bypass -File .\start-project.ps1
```

The bootstrap script provisions missing local `.env` files, starts the isolated infrastructure, generates the gateway config, and prepares the shared database for the split services.

## Verification

Useful commands:

- `pnpm gateway:build`
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
- `POSTGRES_HOST_PORT`
- `REDIS_HOST_PORT`
- `CLAMAV_HOST_PORT`
- `FRONTEND_PORT`

## Production Deployment

Production deployment is centralized here even when the code lives in split repositories.

- `docker-compose.prod.yml` owns the stable shared platform: Postgres, Redis, ClamAV, and the public edge proxy
- `docker-compose.slot.prod.yml` defines one application slot (frontend, gateway, auth, collab, media, and workers)
- `crm-shared-backplane` is the explicit Docker network used by both layers so slot services can reach shared dependencies without host-gateway tricks
- `.github/workflows/reusable-deploy.yml` is the shared GitHub Actions deployment entrypoint
- `deploy/remote/bootstrap-server.sh` prepares the target host deterministically
- `deploy/remote/deploy-component.sh` is the only remote deployment command executed on the server
- each service repository deploys through `crm-infra` instead of duplicating server logic

Current production assumptions:

- Ubuntu-like host with Docker Engine + Compose plugin
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
- CSP allowances for external browser connections are controlled from `crm-infra/.env.production` through `CSP_CONNECT_SRC_EXTRA` and `CSP_IMG_SRC_EXTRA`; when unset, deploy infers the OCI Object Storage origin from `OCI_REGION` in `crm-media` or `crm-collab`

This is the baseline expected for future modules: independent CI in the module repo, centralized deployment orchestration in `crm-infra`, and explicit environment/secret management outside source control.

## Notes

- Slot-specific KrakenD runtime files are generated under `deploy/runtime/krakend.<slot>.json`.
- Consolidated `openapi.yaml` generation is optional and depends on the presence of the sibling service repos.
