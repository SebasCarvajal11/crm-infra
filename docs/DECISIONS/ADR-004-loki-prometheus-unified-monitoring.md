# ADR-004: Stack Unificado de Observabilidad con Prometheus, Grafana y Loki

- **Estado**: Aceptado
- **Fecha**: 2026-07-05
- **Autores**: Equipo de SRE y Plataforma CIMA

---

## Contexto y Planteamiento del Problema

En un entorno de múltiples microservicios distribuidos, diagnosticar incidentes analizando logs contenedor por contenedor mediante comandos manuales de Docker es inviable y ralentiza la resolución de incidencias (*Mean Time To Resolution - MTTR*).

Se requería un stack de observabilidad que permitiera:
1. Monitoreo en tiempo real de métricas operativas (RPS, latencias $p95$, tasa de errores 5xx).
2. Agregación y búsqueda de logs sin requerir agentes pesados en cada contenedor.
3. Correlación directa entre un pico de latencia o error y sus líneas de log correspondientes.

---

## Alternativas Evaluadas

### Opción 1: Solución SaaS Externa (Datadog, New Relic o Dynatrace)
- **Descripción**: Instalar agentes propietarios de terceros y enviar métricas a la nube.
- **Desventajas**: Costo elevado por volumen de logs y métricas; dependencia externa para entornos de desarrollo y datos sensibles.

### Opción 2: Stack ELK (Elasticsearch, Logstash, Kibana)
- **Descripción**: Indexación completa de logs con Elasticsearch y visualización en Kibana.
- **Desventajas**: Consumo masivo de memoria RAM (Elasticsearch exige varios gigabytes base); complejidad elevada de mantenimiento de índices y JVM.

### Opción 3 (Elegida): Stack Ligero y Nativo (Prometheus, Loki, Promtail, Grafana)
- **Descripción**: Prometheus recolecta métricas mediante scraping periódico (`pull`); Promtail lee los flujos de Docker y los envía a Loki; Grafana unifica la visualización con dashboards preconfigurados.

---

## Decisión

Adoptar la **Opción 3**:
1. Desplegar Prometheus para sondear `/api/v1/metrics` cada 15 segundos en todos los microservicios y el gateway.
2. Desplegar Promtail y Loki para recolectar y almacenar logs en formato JSON estructurado sin indexar el cuerpo completo del mensaje, reduciendo el consumo de disco y memoria.
3. Desplegar Grafana con el dashboard preconfigurado *CIMA CRM Overview*.
4. Usar `traceId` como clave de correlación transversal entre métricas, logs y rastreo distribuido.

---

## Consecuencias

### Positivas
- **Bajo Consumo de Recursos**: El stack completo consume < 500 MB de RAM en estado estacionario.
- **Correlación Directa**: Navegación fluida en Grafana desde una métrica de error 5xx directamente a los logs del evento en Loki.
- **Independencia Total**: Funciona idénticamente en local mediante Docker Compose y en la máquina virtual de producción.

### Negativas
- **Retención Local**: La retención prolongada de métricas y logs requiere vigilar el espacio en disco de los volúmenes montados.
