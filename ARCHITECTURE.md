# Arquitectura CIMA CRM — Diagrama C4

## Nivel 1: Contexto del Sistema

```mermaid
C4Context
  title Sistema CIMA CRM — Contexto

  Person(usuario, "Usuario CRM", "Gestiona proyectos, colabora y comparte documentos")

  System_Boundary(cima, "CIMA CRM") {
    System(frontend, "crm-frontend", "SPA React/Vite. Única interfaz de usuario")
    System(gateway, "API Gateway (KrakenD)", "Punto de entrada único. Enruta, autentica y aplica rate-limiting")
    System(auth, "crm-auth", "Identidad y sesiones")
    System(collab, "crm-collab", "Proyectos y colaboración")
    System(media, "crm-media", "Archivos y medios")
  }

  System_Ext(oci, "OCI Object Storage", "Almacenamiento de archivos binarios")
  System_Ext(smtp, "SMTP / Email Provider", "Envío de emails transaccionales")
  System_Ext(clamav, "ClamAV", "Antivirus")

  Rel(usuario, frontend, "Usa", "HTTPS")
  Rel(frontend, gateway, "Todas las peticiones API", "HTTPS /api/v1/*")
  Rel(gateway, auth, "Rutas /auth/*", "HTTP interno")
  Rel(gateway, collab, "Rutas /collab/*", "HTTP interno")
  Rel(gateway, media, "Rutas /media/*", "HTTP interno")
  Rel(auth, smtp, "Emails transaccionales", "SMTP")
  Rel(media, oci, "Subida/descarga de archivos", "HTTPS SDK")
  Rel(media, clamav, "Escaneo antivirus", "TCP 3310")
```

---

## Nivel 2: Contenedores

```mermaid
C4Container
  title CIMA CRM — Contenedores

  Person(usuario, "Usuario CRM")

  Container_Boundary(frontend_bound, "crm-frontend") {
    Container(spa, "SPA", "React 18 + Vite + TanStack Query", "UI de autenticación, colaboración y medios")
    Container(nginx, "Nginx", "Servidor web / proxy", "Sirve el SPA y proxea /api al gateway")
  }

  Container_Boundary(infra, "crm-infra (orquestador)") {
    Container(krakend, "KrakenD", "API Gateway", "Enrutamiento, validación JWT, rate-limiting, circuit-breaker")
    ContainerDb(postgres, "PostgreSQL 16", "RDBMS", "Schemas: schema_auth, schema_collab, schema_media")
    ContainerDb(redis, "Redis 7 (AOF)", "Broker / Cache", "Redis Streams, BullMQ, rate-limiting")
    Container(prometheus, "Prometheus", "Métricas", "Scrape de /api/v1/metrics en todos los servicios")
    Container(loki, "Loki", "Logs", "Agregador de logs de contenedores")
    Container(grafana, "Grafana", "Observabilidad", "Dashboard CIMA CRM Overview")
  }

  Container_Boundary(auth_bound, "crm-auth") {
    Container(auth_api, "Auth API", "Hono + Node.js 22", "Login, refresh, JWKS, invitaciones, auditoría")
    Container(identity_worker, "identity-outbox worker", "Node.js", "Publica eventos de identidad al stream")
    Container(email_worker, "email worker", "Node.js + BullMQ", "Envío de emails transaccionales")
    Container(cleanup_worker, "token-cleanup worker", "Node.js", "Limpieza periódica de tokens expirados")
  }

  Container_Boundary(collab_bound, "crm-collab") {
    Container(collab_api, "Collab API", "Hono + Node.js 22", "Proyectos, tareas, chat, membresías, cambios")
    Container(collab_worker, "collab-outbox worker", "Node.js", "Publica eventos de collab al stream")
  }

  Container_Boundary(media_bound, "crm-media") {
    Container(media_api, "Media API", "Hono + Node.js 22", "Avatares, documentos, URLs pre-firmadas")
    Container(media_worker, "media-command worker", "Node.js", "Procesa comandos de collab via Redis Stream")
    Container(quarantine_worker, "quarantine-scan worker", "Node.js", "Escaneo antivirus de archivos nuevos")
  }

  System_Ext(oci, "OCI Object Storage")
  System_Ext(smtp, "SMTP Provider")

  Rel(usuario, nginx, "HTTPS")
  Rel(nginx, krakend, "/api proxy", "HTTP")
  Rel(nginx, spa, "Sirve SPA")
  Rel(krakend, auth_api, "JWT validation + routing")
  Rel(krakend, collab_api, "routing")
  Rel(krakend, media_api, "routing")
  Rel(auth_api, postgres, "schema_auth")
  Rel(auth_api, redis, "BullMQ email-queue")
  Rel(identity_worker, postgres, "identity_outbox")
  Rel(identity_worker, redis, "stream:auth.identity XADD")
  Rel(email_worker, redis, "BullMQ BRPOP")
  Rel(email_worker, smtp, "SMTP")
  Rel(collab_api, postgres, "schema_collab")
  Rel(collab_api, redis, "stream:collab.media-commands XADD")
  Rel(collab_worker, postgres, "collab_outbox")
  Rel(collab_worker, redis, "stream:collab.events XADD")
  Rel(media_worker, redis, "stream:collab.media-commands XREADGROUP")
  Rel(media_worker, redis, "stream:media.asset-responses XADD")
  Rel(media_api, postgres, "schema_media")
  Rel(media_api, oci, "PUT/GET objects")
  Rel(quarantine_worker, postgres, "quarantine_files")
  Rel(prometheus, auth_api, "GET /api/v1/metrics")
  Rel(prometheus, collab_api, "GET /api/v1/metrics")
  Rel(prometheus, media_api, "GET /api/v1/metrics")
  Rel(loki, auth_api, "logs via promtail")
  Rel(grafana, prometheus, "datasource")
  Rel(grafana, loki, "datasource")
```

---

## Nivel 3: Componentes (crm-auth como ejemplo)

```mermaid
C4Component
  title crm-auth — Componentes internos

  Container_Boundary(auth_api, "Auth API (Hono)") {
    Component(router, "Router / Routes", "Hono routes", "Monta rutas públicas y protegidas")
    Component(auth_mid, "authMiddleware", "Hono middleware", "Verifica JWT via JWKS remoto")
    Component(metrics_mid, "httpMetricsMiddleware", "Hono middleware", "Cuenta requests, mide latencia")
    Component(auth_ctrl, "AuthController", "Controlador delgado", "Parsea request, llama servicio, formatea response")
    Component(auth_svc, "AuthService", "Servicio de dominio", "Login, refresh, logout, invitaciones, recovery")
    Component(users_repo, "UsersRepository", "Repositorio compuesto", "Combina repos read/write/tokens/invitaciones/outbox")
    Component(jwks_pub, "JwksPublisher", "Infra", "Expone /api/v1/.well-known/jwks.json")
    Component(event_pub, "EventPublisher", "Infra", "Publica eventos a Redis stream:auth.identity")
    Component(metrics_ep, "GET /api/v1/metrics", "Endpoint", "Expone métricas prom-client en texto Prometheus")
    Component(health_ep, "GET /api/v1/health", "Endpoint", "Verifica DB y Redis, devuelve estado agregado")
  }

  ContainerDb(postgres, "PostgreSQL", "schema_auth")
  ContainerDb(redis, "Redis", "Streams + BullMQ")

  Rel(router, auth_mid, "protege rutas privadas")
  Rel(router, metrics_mid, "todas las rutas")
  Rel(router, auth_ctrl, "rutas /auth/*")
  Rel(router, jwks_pub, "/api/v1/.well-known/jwks.json")
  Rel(router, metrics_ep, "/api/v1/metrics")
  Rel(router, health_ep, "/api/v1/health")
  Rel(auth_ctrl, auth_svc, "delega lógica")
  Rel(auth_svc, users_repo, "persistencia")
  Rel(auth_svc, event_pub, "publica eventos")
  Rel(users_repo, postgres, "SQL via Drizzle")
  Rel(event_pub, redis, "XADD stream:auth.identity")
```

---

## Flujos de eventos cross-servicio

```mermaid
sequenceDiagram
  participant U as Usuario (SPA)
  participant GW as KrakenD
  participant Auth as crm-auth
  participant IW as identity-outbox worker
  participant R as Redis
  participant Collab as crm-collab

  U->>GW: POST /api/v1/auth/register
  GW->>Auth: POST /auth/register (JWT validado)
  Auth->>Auth: Crea usuario + identity_outbox entry
  Auth-->>GW: 201 Created
  GW-->>U: 201 Created

  IW->>Auth: Poll DB identity_outbox (cada 5s)
  Auth-->>IW: [{id, payload: UserRegistered}]
  IW->>R: XADD stream:auth.identity
  IW->>Auth: markIdentityOutboxPublished(id)

  Collab->>R: XREADGROUP stream:auth.identity
  R-->>Collab: UserRegistered event
  Collab->>Collab: Upsert user_identity_snapshot
  Collab->>R: XACK
```

---

## Decisiones de arquitectura clave (ADRs simplificados)

| # | Decisión | Alternativa rechazada | Motivo |
|---|----------|-----------------------|--------|
| 1 | Un schema de DB por servicio, sin FK cruzadas | Schema único compartido | Desacoplamiento deploy |
| 2 | Validación JWT via JWKS remoto (cacheado) | Trust headers del gateway | No depende de que el gateway valide |
| 3 | Outbox pattern para eventos | RPC síncrono entre servicios | Durabilidad y desacoplamiento temporal |
| 4 | JWT de servicio (RSA por par) para comandos crm-collab → crm-media | HMAC compartido | No requiere secreto compartido |
| 5 | Composición de datos en cliente (TanStack Query) | BFF de composición server-side | Eliminó una capa de acoplamiento |
| 6 | prom-client /api/v1/metrics + Prometheus + Grafana | Métricas ad-hoc en Redis | Estándar de industria, alertas nativas |
| 7 | Redis Streams + consumer groups para eventos | BullMQ para todos los eventos | Retencion de historia, replay posible |
