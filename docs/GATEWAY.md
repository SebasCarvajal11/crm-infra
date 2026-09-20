# API Gateway KrakenD: `crm-infra`

Este documento detalla el diseño, la compilación automatizada, las políticas de seguridad y las reglas de enrutamiento del API Gateway KrakenD.

---

## 1. Misión y Responsabilidades del Gateway

KrakenD actúa como el **único punto de entrada HTTP** para todas las peticiones externas hacia la plataforma CIMA CRM (`/api/v1/*`).

```text
[ Cliente Web / Móvil ]
           │
           │ HTTPS /api/v1/projects
           ▼
┌────────────────────────────────────────────────────────────────────────┐
│                        KrakenD API Gateway                             │
│ 1. Aplica políticas CORS y Rate Limiting.                              │
│ 2. Valida Access Token JWT (RS256) contra el JWKS de crm-auth.         │
│ 3. Extrae claims y añade headers: X-User-Id, X-User-Role, X-Trace-Id. │
│ 4. Aplica Circuit Breaker y enruta al microservicio de destino.        │
└──────────────────────────────────┬─────────────────────────────────────┘
                                   │ HTTP Interno (Header confiable)
                                   ▼
                            [ crm-collab:3001 ]
```

---

## 2. Generación Declarativa: `gateway/build-krakend.mjs`

El archivo de configuración principal `krakend.json` **nunca se edita a mano**. Es compilado de forma determinista mediante el script `gateway/build-krakend.mjs`:

```bash
pnpm gateway:build
```

### Proceso de Compilación:
1. **Lectura del Registro**: Lee `registry/services.json` para obtener la lista de servicios activos, puertos y parámetros de Circuit Breaker.
2. **Descarga / Lectura de Manifiestos**: Lee el archivo `gateway.manifest.json` de cada microservicio registrado (`crm-auth`, `crm-collab`, `crm-media`, `crm-marketing`).
3. **Inyección de Validador JWT**: A todo endpoint no marcado como `"public": true`, se le inyecta automáticamente el middleware `auth/validator` apuntando al JWKS de `crm-auth`.
4. **Propagación de Encabezados de Confianza**: Inyecta transformaciones para reenviar los identificadores de usuario y traza (`X-User-Id`, `X-User-Role`, `X-Trace-Id`).
5. **Configuración de Resiliencia**: Genera disyuntores (*circuit breakers*) y límites de tasa (*rate limiters*) por endpoint.

---

## 3. Políticas de Seguridad y Enrutamiento

### A. Validación Asimétrica de JWT y Caché de JWKS
- **Algoritmo**: `RS256`.
- **Caché de Claves**: KrakenD descarga el conjunto de claves públicas JWKS desde `http://crm-auth:3000/api/v1/.well-known/jwks.json` y lo mantiene en memoria con un TTL de 15 minutos, evitando llamadas síncronas para validar tokens.

### B. Circuit Breaker (Disyuntor de Red)
- Configurado en todos los backends con los umbrales de `registry/services.json`:
  - `max_errors`: 3 errores consecutivos.
  - `interval`: Ventana de evaluación de 60 segundos.
  - `timeout`: Tiempo límite de respuesta de 10 segundos.
- Si un microservicio se degrada o cae, KrakenD abre el circuito de inmediato y responde con `503 Service Unavailable`, protegiendo la red y liberando conexiones de forma instantánea.

### C. Rate Limiting por Endpoint
- Aplica límites de peticiones por segundo en endpoints sensibles (ej. `POST /api/v1/auth/login`, `POST /api/v1/auth/register`) para prevenir ataques de fuerza bruta o denegación de servicio (DoS).

### D. CORS (Cross-Origin Resource Sharing)
- Permite orígenes legítimos (`http://localhost:5173`, dominios de producción).
- Expone cabeceras necesarias para la aplicación (`X-Trace-Id`, `Content-Disposition`).
