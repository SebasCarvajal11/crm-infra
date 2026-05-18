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

- `docker-compose.prod.yml` owns the full stack topology
- `deploy/remote/deploy-component.sh` is the only remote entrypoint used by GitHub Actions
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

## Notes

- The root `krakend.json` is the runtime file used by Docker Compose and is generated from `gateway/build-krakend.mjs`.
- Consolidated `openapi.yaml` generation is optional and depends on the presence of the sibling service repos.
