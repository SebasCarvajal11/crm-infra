# Documentación de Arquitectura Técnica: CRM de Alta Calidad y Ligereza

Este documento detalla el stack tecnológico y la arquitectura de microservicios diseñada para el proyecto de CRM, priorizando la mantenibilidad, el rendimiento y la escalabilidad bajo la metodología de Atomic Design.

## 1. Filosofía del Proyecto

El objetivo principal es construir una plataforma robusta pero extremadamente rápida. Se ha evitado el uso de frameworks pesados o "cajas negras" comerciales, optando por herramientas modernas que ofrecen control total sobre el código y el rendimiento.

## 2. Stack Tecnológico del Frontend

El frontend se comporta como una Single Page Application (SPA) optimizada para entornos de trabajo internos.

| Categoría | Herramienta Elegida | Razón Técnica |
| --- | --- | --- |
| Core | React 18+ & Vite | Velocidad de desarrollo y bundle ligero. |
| Lenguaje | TypeScript | Tipado estricto para evitar errores en microservicios. |
| Estilos/UI | Tailwind CSS + shadcn/ui | Control total de átomos y moléculas (Atomic Design). |
| Estado Servidor | TanStack Query (React Query) | Gestión de caché y sincronización asíncrona. |
| Estado Cliente | Zustand | Alternativa minimalista y rápida a Redux. |
| Routing | TanStack Router | Enrutamiento 100% tipado y seguro. |

## 3. Perímetro de Seguridad y API Gateway

### KrakenD (API Gateway / perímetro)

KrakenD es el **único puerto que debe conocer el frontend** en desarrollo (`http://localhost:8080`). El frontend NO conoce la topología interna de microservicios; las URLs están organizadas por dominio de experiencia (`/identity/`, `/account/`, `/admin/`, `/projects/`), no por módulo backend.

### OpenAPI 3 (contrato documentado)

| Recurso | URL vía gateway | Descripción |
| --- | --- | --- |
| Especificación YAML | `http://localhost:8080/openapi.yaml` | Fuente versionada en `mod-auth/openapi/openapi.yaml`. |
| Swagger UI | `http://localhost:8080/docs` | Prueba interactiva (también `http://localhost:3000/docs` contra mod-auth directo). |

El SPA debe usar rutas **sin** prefijo `/api`: por ejemplo `POST /auth/login`, no `/api/auth/login`.

| Función | Implementación actual |
| --- | --- |
| **Topology Hiding** | El frontend NO conoce los nombres de los microservicios. URLs como `/identity/me`, `/projects`, `/admin/users` ocultan que detrás hay `mod-auth` y `mod-collab`. |
| **Proxy** | Reenvía cada ruta al backend correspondiente (`mod-auth` en `:3000`, `mod-collab` en `:3001`). |
| **Cabeceras al backend** | En **todos** los endpoints, `input_headers` incluye además de las del contrato (`Authorization`, `Cookie`, etc.) las cabeceras **`X-Forwarded-For`**, **`X-Real-IP`** y **`User-Agent`**. Si faltan, KrakenD las filtra y los backends ven IP `"unknown"`, rompiendo la auditoría. |
| **Rate Limiting** | Endpoints públicos sensibles (`/auth/login`, `/auth/forgot-password`, `/auth/reset-password`, `/auth/accept-invite`, `/auth/verify-email`) protegidos con `qos/ratelimit/router` por IP. Lockout por cuenta (8 intentos → 30min) implementado en `mod-auth`. |
| **Circuit Breaker** | Cada backend tiene `qos/circuit-breaker` (3 errores en 60s → circuito abierto 10s). Si un microservicio cae, el gateway devuelve error inmediato sin esperar timeout. |
| **Response Filtering** | Endpoints de listado usan `allow` lists para enviar solo los campos que el frontend necesita. Ej: `GET /projects` devuelve 7 campos de 15 posibles. |
| **Edge Caching** | Endpoints de lectura con datos casi estáticos (`/projects/{id}/columns`, `/projects/{id}/brief`, `GET /projects`) tienen `qos/http-cache` con Cache-Control override. |
| **BFF (Backend For Frontend)** | `/bff/dashboard` agrega identidad + proyectos en una sola respuesta. `/bff/admin-overview` agrega usuarios + proyectos. `/bff/workspace/{id}` enriquece el workspace de mod-collab con perfiles de mod-auth (enriquecimiento interno). |
| **Validación JWT** | Rutas públicas (login, refresh, recuperación de contraseña, invitación, etc.) **no** validan en el gateway. Rutas que en los backends exigen `Authorization: Bearer` llevan `auth/validator` con JWKS (`RS256`, `kid`) desde `/.well-known/jwks.json`. |
| **Claims → cabeceras** | Tras validar, el gateway propaga `sub`, `userId`, `role`, `email` y `exp` como `X-User-*` y `X-Token-Exp`. Cada backend incluye Martian con **`X-Gateway-Trust`** (secreto compartido con `mod-auth`). |
| **Doble JWT (opcional)** | Por defecto `mod-auth` **vuelve a verificar** el Bearer con RS256. Para evitar esa segunda verificación criptográfica, activar en `mod-auth` `TRUST_GATEWAY_JWT_HEADERS=true` y el mismo **`GATEWAY_TRUST_SECRET`** que el valor Martian en `krakend.json` (regenerar JSON con `node scripts/patch-krakend-gateway-trust.mjs` si cambias el secreto). Sin ese modo, el coste doble es aceptable como defensa en profundidad. |
| **CORS** | Configurado para el origen del SPA Vite (`localhost:5173`), métodos incluyendo `PATCH`, cabeceras `Authorization` y `Cookie`, y `credentials` para cookies de refresh. |

**Apagado de `mod-auth`:** el proceso cierra el **servidor HTTP** (`server.close`) y el **pool de PostgreSQL** ante `SIGINT`/`SIGTERM`, para que reinicios de Docker no corten conexiones sin esperar el cierre ordenado.

**Arranque local**

1. Postgres y Redis: `docker compose up -d postgres_db redis`
2. `mod-auth`: en la carpeta del modulo, `npm start` (puerto **3000**).
3. Gateway: `docker compose up -d api-gateway` (puerto **8080**).

El script `start-project.ps1` ejecuta estos pasos automaticamente (incluye `node gateway/build-krakend.mjs` para regenerar la config del gateway).

Validar configuracion: `docker run --rm -v "${PWD}/krakend.json:/etc/krakend/krakend.json:ro" krakend:latest check -c /etc/krakend/krakend.json`

**Cuando `mod-auth` defina `JWT_ISS`** en producción, puede ser necesario añadir la misma cadena como `issuer` dentro de cada bloque `auth/validator` en `krakend.json` para que la validación del gateway coincida con el token.

**Cuando `mod-auth` viva en Docker** en la misma red (`mod-auth:3000`), sustituye `host.docker.internal:3000` en `krakend.json` por ese hostname. El script `gateway/build-krakend.mjs` genera `krakend.json` desde templates para evitar duplicacion; ejecutar `node gateway/build-krakend.mjs` tras modificar los endpoints en `gateway/endpoints/`.

### Microservicio de Autenticación Propio mod-auth (Gestión de Identidad)

Para mantener la independencia tecnológica y el control total de los datos, la gestión de usuarios, el registro y el login (mediante Email/Contraseña) se manejarán a través de un microservicio dedicado. Este módulo será el único responsable de:

Hashear contraseñas de forma segura (utilizando algoritmos estándar como bcrypt).
Generar y firmar los tokens JWT que consumirá el frontend y validará KrakenD.
Gestionar la rotación de claves y recuperación de accesos.

## 4. Backend y Persistencia

La arquitectura permite que cada microservicio sea independiente ("Caja Negra").

Framework: Hono (con Node.js) por su extrema ligereza y soporte para SSE.
ORM: Drizzle ORM para un tipado de extremo a extremo sin penalización de rendimiento.
Base de Datos: PostgreSQL corriendo en un solo motor pero dividido en esquemas lógicos (ej. `schema_auth` para el microservicio de autenticación, `schema_colaboracion`,etc).

## 5. Infraestructura y Despliegue (CI/CD)

El despliegue se centraliza en Oracle Cloud (Instancia ARM Ampere) utilizando Docker para garantizar que cada módulo funcione independientemente del lenguaje en que fue escrito. Aunque en principio se hará todo en local con Docker.

| Fase | Herramienta | Descripción |
| --- | --- | --- |
| Integración Continua | GitHub Actions | Construye la imagen Docker al hacer *push*. |
| Registro | GHCR / Docker Hub | Almacena las versiones de los microservicios. |
| Despliegue Continuo | Watchtower | Actualiza los contenedores en el servidor automáticamente. |

Este diseño asegura que el grupo de estudiantes pueda trabajar en paralelo, cada uno en su propio repositorio, comunicándose únicamente a través de contratos de API definidos en Swagger.