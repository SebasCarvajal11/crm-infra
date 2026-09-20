# CRM Infra

> Orquestador de plataforma, API Gateway KrakenD, infraestructura local y despliegues Blue/Green para CIMA CRM.

[![Status](https://img.shields.io/badge/status-active-success.svg)]()
[![Platform](https://img.shields.io/badge/platform-CIMA%20CRM-blue.svg)]()
[![Node](https://img.shields.io/badge/node-%3E%3D22.0.0-green.svg)]()
[![License](https://img.shields.io/badge/license-MIT-blue.svg)]()

---

## Propósito

`crm-infra` es el repositorio central de operaciones y orquestación para el ecosistema multi-repositorio de CIMA CRM. Administra la infraestructura compartida en Docker (PostgreSQL 16, Redis 7, ClamAV), la compilación declarativa del API Gateway KrakenD, el stack de observabilidad (Prometheus, Grafana, Loki) y los despliegues sin tiempo de inactividad por slots Blue/Green.

---

## Documentación Detallada (`docs/`)

Para consultar las especificaciones técnicas completas y guías de plataforma, visita la suite documental:

- [**Arquitectura de Plataforma (`docs/ARCHITECTURE.md`)**](./docs/ARCHITECTURE.md): Topología de red, contenedores compartidos y diagramas C4.
- [**API Gateway KrakenD (`docs/GATEWAY.md`)**](./docs/GATEWAY.md): Compilación declarativa, rate limiting, circuit breaker y CORS.
- [**Despliegues y Operaciones (`docs/DEPLOYMENT.md`)**](./docs/DEPLOYMENT.md): Flujo Blue/Green sin downtime, `deploy-component.sh` y rollback.
- [**Observabilidad y Monitoreo (`docs/OBSERVABILITY.md`)**](./docs/OBSERVABILITY.md): Métricas Prometheus, Loki, Promtail y Grafana.
- [**Variables de Entorno y Puertos (`docs/ENVIRONMENT.md`)**](./docs/ENVIRONMENT.md): Gestión de secretos, `.env` y mapa de puertos.
- [**Estrategia de Pruebas Multi-Repo (`docs/TESTING.md`)**](./docs/TESTING.md): Suites Hurl de contrato, smoke tests y Playwright.
- [**Guía de Onboarding (`docs/ONBOARDING.md`)**](./docs/ONBOARDING.md): Flujo paso a paso para crear e integrar un nuevo microservicio.
- [**Decisiones Arquitectónicas (`docs/DECISIONS/`)**](./docs/DECISIONS/README.md): Registros formales de decisiones (ADRs).

---

## Inicio Rápido Local

### 1. Opción Recomendada: Stack Completo Automatizado
```powershell
.\start-local.ps1
```

### 2. Opción Híbrida: Infraestructura en Docker + Servicios en Host
```powershell
# 1. Levantar contenedores base (Postgres, Redis, ClamAV, Gateway)
docker compose up -d postgres_db redis clamav-scanner api-gateway

# 2. Aprovisionar archivos de entorno locales
pnpm setup:env

# 3. Compilar configuración de KrakenD
pnpm setup:gateway

# 4. Inicializar esquemas y datos iniciales de base de datos
pnpm setup:db

# 5. Iniciar todos los microservicios en paralelo con hot-reload
pnpm dev:all
```

---

## Pruebas y Validación de Calidad

```bash
pnpm registry:validate        # valida el registro de servicios y permisos DB
pnpm gateway:build            # compila y verifica krakend.json
pnpm smoke:multirepo          # sondea salud de todos los microservicios vía Gateway
pnpm test:hurl                # ejecuta todas las suites de contrato Hurl
pnpm verify:frontend-ui       # verifica renderizado y navegación UI con Playwright
```

---

## Despliegue en Producción

El despliegue está automatizado mediante GitHub Actions y orquestado por el script canónico de slots Blue/Green:

```bash
# Desplegar un componente específico (ej. auth, collab, media, frontend, marketing)
./deploy/remote/deploy-component.sh <component>

# Desplegar la plataforma completa
./deploy/remote/deploy-component.sh full
```
