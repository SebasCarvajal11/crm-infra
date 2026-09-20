# ADR-001: Adopción de KrakenD como API Gateway Declarativo y Stateless

- **Estado**: Aceptado
- **Fecha**: 2026-05-10
- **Autores**: Equipo de Arquitectura e Infraestructura CIMA

---

## Contexto y Planteamiento del Problema

CIMA CRM requería un punto de entrada único (API Gateway) para unificar la exposición de microservicios (`crm-auth`, `crm-collab`, `crm-media`, `crm-marketing`), aplicar validación criptográfica de tokens JWT de usuario, gestionar políticas de Rate Limiting y mitigar caídas mediante Circuit Breakers.

Se evaluaron tres enfoques para la capa de gateway:
1. Un BFF personalizado programado en Node.js/Express.
2. Un gateway dinámico basado en base de datos como Kong.
3. Un gateway ultra-eficiente, sin estado (*stateless*) y declarativo como KrakenD (Go).

---

## Alternativas Evaluadas

### Opción 1: Gateway Personalizado en Node.js (BFF Tradicional)
- **Descripción**: Escribir un servicio Node.js intermedio que reciba y reenvíe peticiones HTTP.
- **Desventajas**: Se convierte en un cuello de botella de rendimiento (I/O intensivo en Node.js), alto consumo de memoria RAM y duplicación de lógica de transporte y enrutamiento.

### Opción 2: Kong API Gateway
- **Descripción**: Gateway maduro basado en Nginx/OpenResty con plugins Lua o Go.
- **Desventajas**: Requiere base de datos propia (PostgreSQL o Cassandra) para almacenar su estado o control plano complejo, aumentando el consumo de recursos y la fragilidad del despliegue.

### Opción 3 (Elegida): KrakenD API Gateway Declarativo
- **Descripción**: Gateway escrito en Go, completamente sin estado (*stateless*), configurado mediante un único archivo JSON (`krakend.json`). Diseñado para rendimiento extremo (> 50.000 RPS con sub-millisecond overhead).

---

## Decisión

Adoptar la **Opción 3**:
1. Utilizar KrakenD como el API Gateway unificado de la plataforma.
2. Compilar la configuración de forma declarativa mediante `gateway/build-krakend.mjs`, leyendo los manifiestos `gateway.manifest.json` de cada microservicio.
3. Delegar en KrakenD la validación asimétrica de tokens JWT (`RS256`), el almacenamiento en caché del JWKS de `crm-auth`, el disyuntor de circuitos (*circuit breaker*) y la inyección de encabezados de usuario confiables (`X-User-Id`, `X-User-Role`).

---

## Consecuencias

### Positivas
- **Rendimiento Excepcional**: Latencia añadida por el gateway menor a 1 ms por salto.
- **Cero Dependencias de Estado**: No requiere base de datos ni sincronización de clúster; arranque instantáneo.
- **Seguridad Centralizada**: Los microservicios internos confían en los encabezados inyectados por KrakenD tras la validación criptográfica.

### Negativas
- **Configuración Estática**: Requiere regenerar y recargar `krakend.json` ante la adición o modificación de rutas de microservicios.
