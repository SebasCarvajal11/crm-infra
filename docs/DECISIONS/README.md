# Architecture Decision Records (ADRs): `crm-infra`

Este directorio contiene los registros de decisiones arquitectónicas que fundamentan el diseño de plataforma, orquestación, gateway y observabilidad en `crm-infra`.

---

## Índice de Decisiones

| ADR | Título | Estado | Fecha |
| :--- | :--- | :--- | :--- |
| [**ADR-001**](./ADR-001-krakend-declarative-gateway.md) | Adopción de KrakenD como API Gateway Declarativo y Stateless | Aceptado | 2026-05-10 |
| [**ADR-002**](./ADR-002-blue-green-slot-deployments.md) | Estrategia de Despliegue Zero-Downtime por Slots Blue/Green y Versionado semver@hash | Aceptado | 2026-05-28 |
| [**ADR-003**](./ADR-003-centralized-shared-data-stores.md) | Segregación Lógica de PostgreSQL por Schemas y Redis Centralizado | Aceptado | 2026-06-18 |
| [**ADR-004**](./ADR-004-loki-prometheus-unified-monitoring.md) | Stack Unificado de Observabilidad con Prometheus, Grafana y Loki | Aceptado | 2026-07-05 |
