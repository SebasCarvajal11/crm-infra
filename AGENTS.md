# Guía de Agentes: `crm-infra`

Este archivo es el **enrutador principal para Agentes de Inteligencia Artificial**. La documentación técnica y de plataforma completa y detallada está estructurada en la carpeta [`docs/`](./docs/README.md).

---

## Misión del Repositorio

`crm-infra` es el **orquestador central de plataforma, infraestructura compartida, generación declarativa del API Gateway KrakenD, observabilidad y despliegues Blue/Green** en CIMA CRM. No contiene lógica de negocio; su propósito exclusivo es garantizar el cableado, resiliencia y operación del ecosistema multi-repositorio.

---

## Enrutamiento Documental para Agentes

Antes de proponer o ejecutar cambios, consulta el documento especializado correspondiente a tu objetivo:

| Si tu tarea involucra... | Consulta este documento |
| :--- | :--- |
| Comprender la topología de contenedores, redes Docker y diagramas C4 | [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) |
| Regenerar, modificar o auditar el API Gateway KrakenD (`krakend.json`) | [`docs/GATEWAY.md`](./docs/GATEWAY.md) |
| Administrar despliegues sin downtime Blue/Green o `deploy-component.sh` | [`docs/DEPLOYMENT.md`](./docs/DEPLOYMENT.md) |
| Consultar métricas Prometheus, logs en Loki o tableros en Grafana | [`docs/OBSERVABILITY.md`](./docs/OBSERVABILITY.md) |
| Ajustar puertos, secretos, variables `.env` o el script `setup:env` | [`docs/ENVIRONMENT.md`](./docs/ENVIRONMENT.md) |
| Ejecutar pruebas de contrato Hurl multi-repo o smoke tests del Gateway | [`docs/TESTING.md`](./docs/TESTING.md) |
| Crear o registrar un nuevo microservicio en la plataforma CIMA | [`docs/ONBOARDING.md`](./docs/ONBOARDING.md) |
| Entender decisiones estructurales (KrakenD, Blue/Green, Schemas DB, Loki) | [`docs/DECISIONS/`](./docs/DECISIONS/README.md) |

---

## Reglas Inviolables para Agentes de IA

1. **Gestor Único**: Utiliza **exclusivamente `pnpm`**. Jamás uses `npm` ni generes archivos `package-lock.json`.
2. **Cero Secretos en el Repo**: Nunca commitear credenciales de producción, contraseñas de base de datos ni claves privadas RSA.
3. **Gateway Declarativo**: Nunca edites `krakend.json` manualmente; su fuente de la verdad son los manifiestos `gateway.manifest.json` procesados con `pnpm gateway:build`.
4. **Despliegues Verificados**: Todo despliegue productivo debe pasar por verificación de salud antes del cambio de tráfico (*Health Check Gate*).
5. **Aislamiento de Pruebas**: No mutar cuentas permanentes ni datos de demostración en las pruebas automatizadas.
