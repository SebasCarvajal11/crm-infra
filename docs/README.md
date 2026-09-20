# Documentación Técnica: `crm-infra`

Bienvenido a la documentación oficial del repositorio de orquestación e infraestructura de **CIMA CRM** (`crm-infra`). Este repositorio actúa como la **columna vertebral operativa de la plataforma**, administrando la topología de contenedores, la generación declarativa del API Gateway KrakenD, los despliegues sin tiempo de inactividad (Blue/Green), las políticas de secretos y el stack unificado de observabilidad.

---

## Índice de Documentación

| Documento | Audiencia Principal | Descripción |
| :--- | :--- | :--- |
| [**ARCHITECTURE.md**](./ARCHITECTURE.md) | Arquitectos / DevOps | Topología de contenedores, redes Docker, diagramas C4 y orquestación de servicios. |
| [**GATEWAY.md**](./GATEWAY.md) | Arquitectos / Backend | KrakenD API Gateway, compilación declarativa, rate limiting, circuit breaker y CORS. |
| [**DEPLOYMENT.md**](./DEPLOYMENT.md) | DevOps / SRE | Despliegues Blue/Green por slots, script `deploy-component.sh`, health checks y rollback. |
| [**OBSERVABILITY.md**](./OBSERVABILITY.md) | DevOps / SRE | Métricas Prometheus, dashboards en Grafana, agregación de logs en Loki y Promtail. |
| [**ENVIRONMENT.md**](./ENVIRONMENT.md) | Todo el equipo | Gestión de secretos, `.env` por entorno, script `setup:env` y mapa de puertos. |
| [**TESTING.md**](./TESTING.md) | QA / Desarrolladores | Pruebas de contrato multi-repositorio, suites Hurl y validaciones Playwright. |
| [**ONBOARDING.md**](./ONBOARDING.md) | Desarrolladores | Flujo paso a paso para crear e integrar un nuevo microservicio con CLI. |
| [**DECISIONS/**](./DECISIONS/README.md) | Todo el equipo | Architecture Decision Records (ADRs) que justifican las decisiones de infraestructura. |

---

## Guía Rápida de Navegación para Agentes de IA

Si eres un **agente autónomo**, consulta directamente el archivo correspondiente a tu objetivo:

- **Modificar o regenerar el API Gateway (`krakend.json`)**: Consulta [`GATEWAY.md`](./GATEWAY.md).
- **Entender puertos, contenedores o la red `shared_backplane`**: Consulta [`ARCHITECTURE.md`](./ARCHITECTURE.md) y [`ENVIRONMENT.md`](./ENVIRONMENT.md).
- **Ajustar el pipeline de despliegue remoto o slots Blue/Green**: Consulta [`DEPLOYMENT.md`](./DEPLOYMENT.md).
- **Consultar o configurar métricas, logs o dashboards**: Consulta [`OBSERVABILITY.md`](./OBSERVABILITY.md).
- **Ejecutar pruebas de integración entre microservicios**: Consulta [`TESTING.md`](./TESTING.md).
- **Crear un nuevo microservicio en la plataforma**: Consulta [`ONBOARDING.md`](./ONBOARDING.md).
- **Consultar fundamentos de arquitectura**: Consulta [`DECISIONS/`](./DECISIONS/README.md).

---

## Reglas Inviolables del Repositorio

1. **Gestor Único**: Únicamente `pnpm`. Prohibido usar `npm` o generar archivos `package-lock.json`.
2. **Cero Secretos Reales en Git**: Los archivos `.env` de producción, claves RSA y certificados nunca se versionan en el repositorio.
3. **Fuente Única de Verdad para el Gateway**: `krakend.json` es un artefacto generado; nunca debe editarse manualmente. Su fuente son los `gateway.manifest.json` y `registry/services.json`.
4. **Despliegues No Destructivos**: Todo despliegue a producción debe realizarse mediante slots Blue/Green verificando salud antes del cambio de tráfico (*cutover*).
