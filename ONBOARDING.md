# Guía de Onboarding para Nuevos Microservicios - CIMA CRM

Esta guía detalla el flujo simplificado para crear, integrar y desplegar un nuevo microservicio utilizando la automatización basada en el registro de servicios de `crm-infra`.

---

## 1. Creación Automática desde Plantilla

Para inicializar un nuevo microservicio, ejecuta el script de creación desde la raíz de `crm-infra`:

```bash
node scripts/create-microservice.mjs --name=<nombre> --port=<puerto>
```

**Ejemplo**:
```bash
node scripts/create-microservice.mjs --name=billing --port=3005
```

Este comando realiza las siguientes tareas automáticamente:
1. Copia la plantilla oficial de microservicio (`templates/microservice`) a `../crm-<nombre>`.
2. Reemplaza todos los placeholders (`{{SERVICE_NAME}}`, `{{SERVICE_PORT}}`, `{{DB_PASSWORD}}`, `{{SERVICE_TITLE}}`, `{{SERVICE_NAME_UPPER}}`) con los valores correspondientes.
3. Agrega la entrada del microservicio en `registry/services.json`.
4. Regenera automáticamente la configuración del API Gateway (`krakend.json`) y los archivos Docker Compose (`docker-compose.yml` y `docker-compose.slot.prod.yml`).
5. Intenta crear y publicar el repositorio Git en GitHub. Si la CLI de GitHub (`gh`) no está disponible, provee instrucciones claras para su publicación manual.

---

## 2. Inicialización Local

Una vez creado el microservicio:

1. Configura el archivo `.env` local ejecutando desde `crm-infra`:
   ```bash
   pnpm setup:env
   ```
2. Inicializa el esquema de base de datos ejecutando:
   ```bash
   pnpm setup:db
   ```
3. Levanta la infraestructura compartida e inicia el nuevo servicio:
   ```bash
   # Levantar contenedores base (Postgres, Redis, ClamAV, Gateway)
   docker compose up -d
   
   # Iniciar el servicio en modo desarrollo
   pnpm --dir ../crm-<nombre> dev
   ```

---

## 3. Registro de Contratos en `cima-contracts`

Si tu microservicio emite eventos de dominio hacia Redis Streams o consume eventos de otros dominios:

1. Abre el repositorio `cima-contracts` (`D:\BACKUP CELULAR OLIMPO\cima-contracts`).
2. Crea el archivo de esquema `src/<nombre>-events.ts` usando Zod para validar la estructura del payload del evento.
3. Registra el nuevo subpath en el `package.json` de `cima-contracts` en el bloque `"exports"`.
4. Compila el paquete ejecutando `pnpm build` dentro de `cima-contracts`.
5. Ejecuta `pnpm install` en tu servicio para actualizar la dependencia a la nueva versión publicada en GitHub Packages.

---

## 4. Despliegue en Producción

El deployer dinámico (`deploy-component.sh`) está integrado con `registry/services.json`. Para desplegar el nuevo microservicio en producción, simplemente ejecuta:

```bash
./deploy/remote/deploy-component.sh <nombre>
```

El script se encargará de sincronizar el repositorio del microservicio, generar el archivo de entorno, aplicar bootstrap y migraciones de base de datos de manera aislada, e iniciar el contenedor en el slot destino sin afectar al tráfico actual.

---

## 5. Matriz de Degradación (Graceful Degradation)

El sistema está diseñado bajo el principio de aislamiento de fallos: cada servicio debe poder arrancar, detenerse o fallar sin colgar el resto de la plataforma. A continuación se detalla el comportamiento del CRM ante la indisponibilidad de componentes críticos:

| Componente Caído | Impacto en el Usuario / Sistema | Estrategia de Mitigación |
|------------------|---------------------------------|--------------------------|
| **crm-auth** | No es posible iniciar sesión. Las peticiones autenticadas fallan inmediatamente con `401 Unauthorized` limpio. | Los servicios backend validan JWTs localmente (usando JWKS con caché). Si `crm-auth` cae, las sesiones existentes siguen activas hasta que expire el JWT o sea necesario consultar el JWKS refrescado. |
| **crm-collab** | Se deshabilitan las funcionalidades de proyectos, tareas y chat. | `crm-auth` y `crm-media` siguen funcionando. El frontend detecta el fallo del endpoint `/api/v1/health` de `collab` a través del gateway y muestra un banner de advertencia ("Servicio de colaboración no disponible temporalmente"). |
| **crm-media** | No se pueden subir nuevos archivos ni procesar metadatos en tiempo real. | `crm-collab` encola las solicitudes en la base de datos local marcando las operaciones como `pending-media-upload` y activa reintentos con backoff exponencial. Cuando `crm-media` vuelve a estar online, procesa la cola de comandos asíncronos pendientes. |
| **Redis** | Las tareas en background, colas de eventos (outbox) y mensajería en tiempo real quedan inoperativas. | Los servicios degradan a un modo de operación limitado (modo lectura o deshabilitan las escrituras que requieran eventos de sincronización inmediatos) y responden con `503 Service Unavailable` explícito si se intenta una acción crítica dependiente de Redis. |

> [!NOTE]
> Todos los backend implementan una ruta `/api/v1/health` estandarizada que reporta el estado de sus dependencias (base de datos, redis, etc.) en formato JSON. El API Gateway (KrakenD) monitorea esta ruta y activa disyuntores (circuit-breakers) automáticos con parámetros `max_errors`, `interval` y `timeout` configurados en `registry/services.json`.

---

## 6. Stack de Observabilidad (Prometheus + Loki + Grafana)

Los archivos de configuración del stack de observabilidad están en `observability/` pero los servicios **no están incluidos** en el `docker-compose.yml` actual. Para levantarlos, es necesario agregarlos al compose o usar un compose separado.

### URLs de acceso (dev local)

| Herramienta | URL | Notas |
|-------------|-----|-------|
| **Grafana** | http://localhost:13000 | Usuario: `admin` / Contraseña: ver `.env` → `GRAFANA_ADMIN_PASSWORD` |
| **Prometheus** | http://localhost:19090 | UI de consultas y targets |
| **Loki** | http://localhost:13100 | API de logs (consultar desde Grafana) |

### Dashboard principal

Al entrar a Grafana, ir a **Dashboards → CIMA CRM — Overview**. Incluye:

- **HTTP Rate & Latencia** — requests/s, p95/p99 por servicio.
- **Errores 5xx** — rate de errores por servicio.
- **Outbox Depth** — profundidad de la cola pendiente en DB (`identity-outbox`, `collab-outbox`).
- **Stream Consumer PEL** — mensajes pendientes en el consumer group de Redis Streams.
- **Node.js** — heap usado, event loop lag.
- **Logs en tiempo real** — panel Loki con filtro por servicio y texto libre.

### Métricas disponibles (endpoint `/api/v1/metrics`)

Cada servicio backend expone `GET /api/v1/metrics` en formato Prometheus text/plain:

| Métrica | Tipo | Descripción |
|---------|------|-------------|
| `http_requests_total` | Counter | Total de requests por `method`, `route`, `status_code` |
| `http_request_duration_seconds` | Histogram | Duración (p50/p95/p99) por `method`, `route`, `status_code` |
| `http_errors_5xx_total` | Counter | Errores 5xx por `method`, `route` |
| `worker_outbox_depth` | Gauge | Registros pendientes en outbox DB por `worker` |
| `stream_consumer_group_depth` | Gauge | PEL del consumer group Redis Stream por `stream` y `group` |
| `nodejs_heap_size_used_bytes` | Gauge | Heap de Node.js (de `collectDefaultMetrics`) |
| `nodejs_eventloop_lag_seconds` | Gauge | Event loop lag en segundos |

### Añadir logging a un contenedor propio

Para que promtail recoja los logs de un nuevo contenedor, añadir en su `docker-compose.yml`:

```yaml
labels:
  logging: promtail
  LOG_SERVICE_NAME: crm-<nombre>
```

> [!TIP]
> En producción, cambiar `GRAFANA_ADMIN_PASSWORD` en `.env.docker` antes del primer deploy. Grafana persiste datos en el volumen `grafana_data`.

---

## 7. Seguridad Operativa

### 7.1 Escaneo de secretos (gitleaks)

Todos los repos del polirepo usan [gitleaks](https://github.com/gitleaks/gitleaks) en CI a través del workflow reusable de `crm-infra`. El step `Secret scan (gitleaks)` corre automáticamente en cada push y PR.

La configuración de allowlist vive en `crm-infra/security/gitleaks.toml`. Si gitleaks reporta un falso positivo, añadir el path o patrón al allowlist.

### 7.2 Gestión de secretos con sops + age

Los secretos de producción se cifran con [sops](https://github.com/getsops/sops) usando [age](https://github.com/FiloSottile/age) como algoritmo de cifrado.

**Estructura:**
```
crm-infra/
  security/
    sops/
      .sops.yaml          # Reglas de cifrado (committeado)
    rotate-jwt.sh          # Script de rotación de claves JWT
  secrets/
    docker.env.enc         # Secretos cifrados (committeado)
```

**Configuración inicial:**
```bash
# 1. Instalar age y sops
winget install FiloSottile.age
winget install Mozilla.sops

# 2. Generar keypair
age-keygen -o crm-infra/security/sops/keys.txt
# Copiar la clave pública mostrada en consola al campo 'age' de .sops.yaml

# 3. Guardar clave privada como GitHub Secret (SOPS_AGE_KEY)
#    y en ~/.config/sops/age/keys.txt para uso local
```

**Cifrar secretos:**
```bash
sops -e .env.docker > secrets/docker.env.enc
```

**Descifrar en producción:**
```bash
# bootstrap-server.sh lo hace automáticamente si sops está instalado
sops -d secrets/docker.env.enc > .env.docker
```

### 7.3 Rotación de claves JWT

Las claves JWT de `crm-auth` y `crm-collab` deben rotarse cada 90 días (configurable en `services.json` → `secretRotationDays`).

```bash
# Rotar claves de crm-auth
./security/rotate-jwt.sh auth

# Rotar claves de crm-collab
./security/rotate-jwt.sh collab
```

El script genera un nuevo par RSA, archiva las claves viejas y cifra los secretos actualizados con sops. Durante la ventana de overlap (24h), los servicios deben aceptar tanto las claves nuevas como las anteriores.

### 7.4 Actualización de dependencias (Renovate)

Cada repo tiene un `renovate.json` configurado para:
- Correr cada fin de semana
- Auto-merge de actualizaciones `minor` y `patch`
- Agrupar actualizaciones relacionadas (Docker images, GitHub Actions, frontend-core)

Los PRs de Renovate se etiquetan con `dependencies` y se mergean automáticamente si pasan CI.

