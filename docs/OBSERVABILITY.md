# Observabilidad y Monitoreo: `crm-infra`

Este documento describe el stack centralizado de métricas, dashboards y agregación de logs estructurados en CIMA CRM.

---

## 1. Arquitectura de Observabilidad

```text
┌─────────────────────────────────────────────────────────────┐
│                 Microservicios y Gateway                    │
│   (crm-auth, crm-collab, crm-media, crm-marketing, KrakenD) │
└──────────────┬───────────────────────────────┬──────────────┘
               │                               │
               │ Scrape cada 15s               │ Stdout (JSON Pino)
               ▼ (/api/v1/metrics)             ▼
      ┌──────────────────┐            ┌──────────────────┐
      │    Prometheus    │            │     Promtail     │
      │   (Puerto 9090)  │            │  (Daemon Docker) │
      └────────┬─────────┘            └────────┬─────────┘
               │                               │
               │ Métricas y Alertas            │ Envío de logs
               ▼                               ▼
      ┌──────────────────────────────────────────────────┐
      │                      Grafana                     │
      │  (Visualización en Puerto 23000 / Loki: 3100)    │
      └──────────────────────────────────────────────────┘
```

---

## 2. Métricas y Scraping con Prometheus

El archivo de configuración [`observability/prometheus.yml`](file:///d:/BACKUP%20CELULAR%20OLIMPO/crm-infra/observability/prometheus.yml) define los trabajos de sondeo (*scrape jobs*) a intervalos de 15 segundos:

### Métricas Clave de la Plataforma
- **Rendimiento HTTP**:
  - `http_requests_total`: Total de peticiones clasificadas por servicio, ruta, método y código de estado.
  - `http_request_duration_seconds`: Histogramas de latencia en percentiles ($p50$, $p95$, $p99$).
  - `http_errors_5xx_total`: Tasa de fallos del servidor.
- **Workers y Colas**:
  - `worker_outbox_depth{worker="..."}`: Cantidad de eventos pendientes de publicación en outbox.
  - `bullmq_jobs_waiting_total`: Trabajos en espera en la cola de correos.
- **Recursos del Runtime**:
  - Consumo de memoria heap de Node.js, retraso del bucle de eventos (*event loop lag*) y pausas por Garbage Collection.

---

## 3. Agregación de Logs con Loki y Promtail

1. **Recolección Centralizada**:
   - Promtail monitorea el socket del daemon de Docker y extrae la salida estándar (`stdout` / `stderr`) de todos los contenedores.
   - Enruta los flujos hacia Loki etiquetándolos por contenedor y servicio (`service="crm-collab"`, `service="crm-media"`, etc.).
2. **Formato JSON Estructurado**:
   - Todos los microservicios implementan el logger **Pino** configurado para emitir JSON puro en una sola línea.
   - Campos mínimos obligatorios:
     ```json
     {
       "level": "info",
       "time": 1726867200000,
       "msg": "Petición procesada exitosamente",
       "service": "crm-collab",
       "traceId": "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
       "correlationId": "c1f7a28e-5b12-4c22-901b-9f0e1a2b3c4d",
       "statusCode": 200
     }
     ```
3. **Trazabilidad Distribuida**:
   - Gracias al `traceId` inyectado por KrakenD y propagado entre microservicios, es posible reconstruir la traza completa de una operación en Grafana Explore mediante consultas LogQL:
     ```logql
     {service=~"crm-.*"} |= "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d"
     ```

---

## 4. Dashboards en Grafana

- **Acceso Local**: `http://localhost:23000` (o puerto configurado).
- **Dashboard Consolidado: *CIMA CRM Overview***:
  - Salud operativa general del cluster y estado de circuit breakers en KrakenD.
  - Tráfico por microservicio (RPS y volumen).
  - Tasa de errores 4xx y 5xx con enlaces directos a los logs del incidente en Loki.
  - Monitoreo de memoria y conexiones activas a PostgreSQL y Redis.
