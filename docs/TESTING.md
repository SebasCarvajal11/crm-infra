# Estrategia de Pruebas Multi-Repositorio: `crm-infra`

Este documento describe los flujos de validación integral, las suites de pruebas de contrato Hurl, los smoke tests de KrakenD y las herramientas de verificación entre servicios.

---

## 1. Niveles de Pruebas de Plataforma

```text
       ▲
      / \     Nivel 3: Pruebas de Interfaz y Cutover (Playwright: `verify:frontend-ui`)
     /   \
    /─────\   Nivel 2: Pruebas de Contrato E2E vía Gateway (Hurl Runner: `test:hurl`)
   /       \
  /─────────\ Nivel 1: Validación de Registro y Gateway (`registry:validate`, `gateway:build`)
```

---

## 2. Ejecutor de Pruebas de Contrato Hurl: `pnpm test:hurl`

`crm-infra` contiene el orquestador unificado de pruebas Hurl (`tests/hurl-runner.ts`), que ejecuta suites simulando clientes HTTP reales contra el API Gateway KrakenD:

```bash
pnpm test:hurl          # Ejecuta todas las suites
pnpm test:hurl:auth     # Suite de identidad y login
pnpm test:hurl:collab   # Suite de proyectos, tareas y tableros
pnpm test:hurl:media    # Suite de avatares y documentos
pnpm test:hurl:cross    # Flujos cruzados (creación de proyecto con archivo adjunto)
```

### Reglas de Aislamiento de Datos
1. **Dominio Reservado**: Todas las identidades de prueba se crean bajo el dominio `@hurl.test`.
2. **Cero Mutación de Cuentas Reales**: Las pruebas jamás alteran usuarios del entorno de desarrollo o demostración (`gerente@cima.dev`, `ana.martinez@cima.dev`).
3. **Idempotencia**: Cada ejecución inicializa y limpia su contexto de prueba de manera determinista.

---

## 3. Verificación de Plataforma y Smoke Tests

### A. Validación del Registro de Servicios (`pnpm registry:validate`)
Valida que `registry/services.json` cumpla con el esquema JSON Schema estricto (`registry/services.schema.json`) y que los permisos de base de datos en `registry/db/grants.json` concuerden con los esquemas de cada microservicio.

### B. Smoke Tests de Microservicios (`pnpm smoke:multirepo`)
Sondea secuencialmente los endpoints `/api/v1/health` de cada microservicio a través de KrakenD para comprobar:
- Respuesta HTTP `200 OK`.
- Conectividad activa con PostgreSQL, Redis y ClamAV.
- Latencia de respuesta por debajo de los 50 ms.

### C. Verificación de UI y Cambio de Tráfico (`pnpm verify:frontend-ui`)
Ejecuta una suite liviana con **Playwright** que abre el frontend en modo headless:
- Comprueba que la página de login cargue sin errores de consola.
- Simula autenticación con un usuario de prueba.
- Comprueba la carga fluida del dashboard principal antes de confirmar el cambio de tráfico en despliegues productivos.

### D. Optimización del Pipeline de Integración Continua (`reusable-ci.yml`)
El flujo corporativo de CI implementa las siguientes directrices de rendimiento y fiabilidad:
- **Caché Persistente de Binarios**: Binarios pesados como el CLI de Hurl (`7.1.0`) y Chromium de Playwright se almacenan en caché de GitHub Actions, evitando descargas y ejecuciones lentas de `apt-get`/`dpkg` en cada ejecución.
- **Contenedores de Alta Velocidad en RAM**: Servicios efímeros de base de datos se descargan desde mirrors de alta disponibilidad (`public.ecr.aws`) con directivas optimizadas de memoria (`fsync=off`, `synchronous_commit=off` para PostgreSQL y `--save ""` para Redis).
- **Aislamiento Estricto de Servicios**: Cada microservicio consume únicamente los contenedores que requiere (evitando levantar servicios ociosos en repositorios con mocks/Testcontainers).
- **Linting y Calidad Dinámicos**: Detección e invocación automática de `pnpm lint` en microservicios TypeScript.

---

## 4. Catálogo de Comandos de Prueba

| Comando | Propósito | Entorno Requerido |
| :--- | :--- | :--- |
| `pnpm registry:validate` | Valida sintaxis de `services.json` y permisos DB. | Ninguno (autocontenido) |
| `pnpm gateway:build` | Comprueba compilación de `krakend.json`. | Repositorios hermanos |
| `pnpm smoke:multirepo` | Sondea salud de todos los microservicios vía Gateway. | Docker stack activo |
| `pnpm test:hurl` | Ejecuta la suite completa de contratos Hurl. | Docker stack activo |
| `pnpm test:contracts` | Ejecuta suites de contrato de cada microservicio. | Docker stack activo |
| `pnpm verify:frontend-ui` | Valida renderizado y flujos UI con Playwright. | Docker stack activo |
| `pnpm verify:multirepo` | Valida consistencia de estructura en repos hermanos. | Ninguno |
