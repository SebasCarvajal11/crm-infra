# GATEWAY.md — Guía del API Gateway para Agentes IA

> **Propósito:** Este archivo es la referencia principal para cualquier agente IA (opencode, Cursor, Claude Code, etc.) que necesite modificar, extender o analizar la configuración del API Gateway de CIMA CRM. Lee esto ANTES de tocar cualquier archivo.

---

## Arquitectura Actual (Resumen)

```
Frontend (React :5173)
        │
        ▼
  KrakenD Gateway (:8080)  ← Único punto de entrada
        │
   ┌────┼────┐
   ▼    ▼    ▼
:3000 :3001 :3002
mod-  mod-  bff-
auth collab workspace
```

**Principio clave:** El frontend NO conoce los nombres de los microservicios. Las URLs del gateway están organizadas por dominio de experiencia, no por módulo backend.

| Dominio de URL | Backend real | Ejemplo |
|---|---|---|
| `/auth/*` | mod-auth | Login, refresh, forgot-password (públicos) |
| `/identity/*` | mod-auth | `/identity/me`, `/identity/logout`, `/identity/search` |
| `/account/*` | mod-auth | `/account/password`, `/account/sessions` |
| `/admin/*` | mod-auth | `/admin/users`, `/admin/workers`, `/admin/clients/invite` |
| `/projects/*` | mod-collab | `/projects`, `/projects/{id}/tasks`, `/projects/{id}/chat/external` |
| `/tasks/*` | mod-collab | `/tasks/{taskId}` |
| `/columns/*` | mod-collab | `/columns/{columnId}` |
| `/files/*` | mod-collab | `/files/{fileId}/download`, `/files/{fileId}/approve` |
| `/bff/*` | KrakenD (agregación) + bff-workspace | `/bff/dashboard`, `/bff/workspace/{id}` |

---

## Estructura del Gateway

```
gateway/
├── build-krakend.mjs        ← Script generador (Node.js)
├── endpoints/
│   ├── public.json           ← Endpoints sin JWT (login, refresh, health, etc.)
│   ├── auth.json             ← Endpoints de mod-auth (identity, account, admin)
│   ├── collab.json           ← Endpoints de mod-collab (projects, tasks, files)
│   └── bff.json              ← Endpoints BFF (agregación multi-backend)
└── output/
    └── krakend.json          ← Output generado (NO editar manualmente)
```

**`krakend.json` en la raíz** es una copia del output. Se regenera con:
```bash
node gateway/build-krakend.mjs
```

El script `start-project.ps1` ejecuta esto automáticamente antes de levantar Docker.

---

## Cómo Agregar un Nuevo Endpoint

### Caso 1: Endpoint estándar en un módulo existente

**Ejemplo:** Agregar `GET /projects/{projectId}/stats` que va a mod-collab.

**Paso 1 — Editar `gateway/endpoints/collab.json`:**
```json
{
  "endpoint": "/projects/{projectId}/stats",
  "method": "GET",
  "backend_url": "/collab/projects/{projectId}/stats"
}
```

El campo `endpoint` es la URL pública (sin `/collab/`). El campo `backend_url` es la ruta interna en el microservicio.

**Paso 2 — Regenerar:**
```bash
node gateway/build-krakend.mjs
```

**Paso 3 — Crear la ruta en el microservicio** (mod-collab en este caso).

**Paso 4 — Crear la función API en el frontend:**
```typescript
// crm-frontend/src/collab/collab-api.projects.ts
export async function getProjectStatsRequest(accessToken: string, projectId: string) {
  return api.get(`projects/${projectId}/stats`, { headers: bearer(accessToken) }).json()
}
```

**Paso 5 — Verificar:**
```bash
cd crm-frontend && npx tsc --noEmit
cd mod-collab && npx tsc --noEmit
```

---

### Caso 2: Endpoint con filtrado de respuesta (Response Filtering)

**Ejemplo:** `GET /projects/{projectId}/tasks` solo necesita 10 de 15 campos.

En `gateway/endpoints/collab.json`:
```json
{
  "endpoint": "/projects/{projectId}/tasks",
  "method": "GET",
  "backend_url": "/collab/projects/{projectId}/tasks",
  "allow": ["id", "columnId", "title", "description", "priority", "deadline", "checklistProgress", "isClientVisible", "createdAt", "updatedAt"]
}
```

Usar `allow` (whitelist) O `deny` (blacklist), nunca ambos.

---

### Caso 3: Endpoint con caché de borde (Edge Cache)

En `gateway/endpoints/collab.json`:
```json
{
  "endpoint": "/projects/{projectId}/columns",
  "method": "GET",
  "backend_url": "/collab/projects/{projectId}/columns",
  "cache_ttl": "300s"
}
```

Valores válidos: `"60s"`, `"120s"`, `"300s"`, `"5m"`, `"1h"`.

---

### Caso 4: Endpoint público (sin JWT)

En `gateway/endpoints/public.json`:
```json
{
  "endpoint": "/auth/new-public-endpoint",
  "method": "POST",
  "backend_url": "/auth/new-public-endpoint"
}
```

Para rate limiting:
```json
{
  "endpoint": "/auth/new-public-endpoint",
  "method": "POST",
  "backend_url": "/auth/new-public-endpoint",
  "rate_limit": {
    "client_max_rate": 5,
    "client_capacity": 5,
    "every": "1h",
    "strategy": "ip"
  }
}
```

---

### Caso 5: Endpoint BFF (agregación de múltiples backends)

En `gateway/endpoints/bff.json`:
```json
{
  "endpoint": "/bff/my-endpoint",
  "method": "GET",
  "timeout": "3s",
  "backends": [
    {
      "host": "http://host.docker.internal:3000",
      "url_pattern": "/auth/me",
      "allow": ["id", "email", "role"],
      "group": "identity"
    },
    {
      "host": "http://host.docker.internal:3001",
      "url_pattern": "/collab/projects?page=1&limit=10",
      "group": "projects"
    }
  ]
}
```

KrakenD ejecuta ambos backends en paralelo y merge las respuestas usando `group` como clave.

---

### Caso 6: Nuevo microservicio backend

Si agregas un nuevo microservicio (ej: `mod-inventory` en `:3003`):

1. Crear `gateway/endpoints/inventory.json` con `host: "http://host.docker.internal:3003"`
2. Crear `gateway/endpoints/inventory.json`:
```json
{
  "_comment": "Endpoints de mod-inventory",
  "host": "http://host.docker.internal:3003",
  "endpoints": [
    {
      "endpoint": "/inventory/items",
      "method": "GET",
      "backend_url": "/inventory/items",
      "allow": ["id", "name", "quantity"]
    }
  ]
}
```
3. Actualizar `gateway/build-krakend.mjs` — agregar el loader:
```javascript
const inventoryDef = loadEndpoints("inventory.json");
// agregar al array de endpoints en main()
...inventoryDef.endpoints.map((d) => buildAuthEndpoint(d, inventoryDef.host)),
```
4. Regenerar: `node gateway/build-krakend.mjs`

---

## Lo que NO debes hacer

1. **Editar `krakend.json` directamente** — Se sobrescribe con cada build. Edita los JSONs en `gateway/endpoints/`.
2. **Agregar endpoints sin regenerar** — El gateway no verá los cambios hasta que ejecutes `node gateway/build-krakend.mjs`.
3. **Usar URLs que revelen topología** — No uses `/mod-auth/` o `/mod-collab/` en las URLs públicas. Usa `/identity/`, `/projects/`, `/admin/`, etc.
4. **Olvidar el `allow` list en endpoints de listado** — Si el backend devuelve 15 campos y el frontend usa 6, filtra con `allow` para ahorrar ancho de banda.
5. **Eliminar el circuit breaker** — El script lo agrega automáticamente a cada backend. No lo quites.

---

## Comandos Útiles

```bash
# Regenerar krakend.json
node gateway/build-krakend.mjs

# Verificar TypeScript (mod-auth)
cd mod-auth && npx tsc --noEmit

# Verificar TypeScript (frontend)
cd crm-frontend && npx tsc --noEmit

# Verificar TypeScript (bff-workspace)
cd bff-workspace && npx tsc --noEmit

# Validar krakend.json como JSON
node -e "JSON.parse(require('fs').readFileSync('krakend.json','utf8'))"

# Arrancar todo (Windows)
.\start-project.ps1
```

---

## Endpoint Definition Reference

Cada endpoint en los JSONs de `gateway/endpoints/` soporta estos campos:

| Campo | Requerido | Tipo | Descripción |
|---|---|---|---|
| `endpoint` | Sí | string | URL pública del gateway (sin dominio de microservicio) |
| `method` | Sí | string | GET, POST, PUT, PATCH, DELETE |
| `backend_url` | No | string | Ruta interna en el microservicio (default: igual a `endpoint`) |
| `host` | No | string | Override del host del grupo (default: usa el `host` del grupo) |
| `allow` | No | string[] | Whitelist de campos en la respuesta (payload pruning) |
| `deny` | No | string[] | Blacklist de campos en la respuesta |
| `cache_ttl` | No | string | TTL para edge cache (ej: `"60s"`, `"5m"`, `"1h"`) |
| `rate_limit` | No | object | Configuración de rate limiting (solo endpoints públicos) |
| `extra_headers` | No | string[] | Headers adicionales (ej: `["Cookie"]`) |
| `input_query_strings` | No | string[] | Query params a pasar al backend |

---

## Archivos Relacionados

| Archivo | Propósito |
|---|---|
| `krakend.json` | Config generada (NO editar) |
| `gateway/build-krakend.mjs` | Script generador |
| `gateway/endpoints/*.json` | Definiciones de endpoints (SÍ editar) |
| `docker-compose.yml` | Orquestación (Postgres, Redis, KrakenD) |
| `start-project.ps1` | Arranque local automático |
| `ARQUITECTURA.md` | Documentación de arquitectura general |
| `bff-workspace/src/server.ts` | Microservicio BFF para workspace enriquecido |
