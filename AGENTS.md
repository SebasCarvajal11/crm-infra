# AGENTS

## Purpose

`crm-infra` is the orchestration repository for the CIMA CRM multi-repo platform. It owns local infrastructure, gateway generation, validation flows, and operational bootstrap for the split services. It is not a business-domain repository and should stay focused on platform wiring.

## System Boundaries

- Owns Docker Compose for local shared infrastructure such as Postgres, Redis, ClamAV, and KrakenD.
- Owns KrakenD configuration generation and the public API entrypoint shape.
- Owns stack bootstrap and verification scripts for the split repositories.
- Does not own authentication, collaboration, media, or frontend business logic.

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
