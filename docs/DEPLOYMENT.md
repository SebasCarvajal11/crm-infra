# Despliegues y Operaciones: `crm-infra`

Este documento describe la arquitectura de despliegue sin tiempo de inactividad basada en slots Blue/Green, la orquestación remota y los procedimientos de reversión (*rollback*).

---

## 1. Arquitectura de Despliegue por Slots (Blue / Green)

Para garantizar cero tiempo de inactividad (*Zero-Downtime Deployment*), la infraestructura de producción mantiene dos entornos idénticos aislados lógicamente:

```text
               ┌────────────────────────┐
               │  Nginx Ingress / Proxy │
               └───────────┬────────────┘
                           │ Tráfico Activo (Slot Blue)
                           ▼
┌────────────────────────────────────────────────────────┐
│                      SLOT BLUE                         │
│  [KrakenD] [Auth: 1.0.0] [Collab: 1.0.0] [Media: 1.0.0]│
└────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────┐
│                      SLOT GREEN                        │
│  (Inactivo / Desplegando nueva versión y validando)    │
│  [KrakenD] [Auth: 1.0.0] [Collab: 1.1.0] [Media: 1.0.0]│
└────────────────────────────────────────────────────────┘
```

---

## 2. Script Canónico de Despliegue: `deploy-component.sh`

Ubicado en `deploy/remote/deploy-component.sh`, es el script maestro invocado por los pipelines de CI/CD de GitHub Actions o por administradores de sistemas:

```bash
./deploy/remote/deploy-component.sh <component>
```

### Componentes Soportados
`auth`, `collab`, `media`, `frontend`, `marketing`, `infra`, `full`.

### Flujo de Ejecución de un Despliegue
1. **Identificación de Slot Inactivo**: Lee el puntero `.active-slot` (si Blue está activo, el objetivo es Green).
2. **Resolución de Versiones**:
   - Para el componente a desplegar, sincroniza el repositorio con la última versión de la rama `main` o el tag especificado.
   - Para los demás componentes, lee `.active-versions-blue` y congela los servicios en sus versiones estables actuales (`semver@hash`).
3. **Construcción e Inicio del Slot Inactivo**:
   - Ejecuta `docker compose -f docker-compose.slot.prod.yml up -d --build`.
4. **Verificación Estricta de Salud (*Health Check Gate*)**:
   - Envía solicitudes periódicas a `/api/v1/health` de cada servicio en el nuevo slot.
   - Si algún servicio falla tras agotar los intentos, el despliegue se aborta inmediatamente y el tráfico nunca se conmuta.
5. **Conmutación de Tráfico (*Cutover*)**:
   - Actualiza la configuración del proxy inverso (Nginx) para apuntar los upstreams al nuevo slot y recarga la configuración (`nginx -s reload`).
6. **Actualización de Registro y Drenado**:
   - Escribe el nuevo estado en `.active-versions-green`.
   - Detiene de forma ordenada (*graceful drain*) los contenedores del slot previo.

---

## 3. Procedimiento de Reversión (*Rollback*)

Ante cualquier anomalía detectada en producción tras un despliegue:

1. **Reversión Inmediata de Slot**:
   - Si los contenedores previos siguen en espera, se puede volver a conmutar el proxy Nginx al slot anterior en menos de 1 segundo.
2. **Reversión por Versión Específica**:
   - Se puede desplegar explícitamente un commit o versión anterior definiendo la variable de entorno correspondiente:
   ```bash
   DEPLOY_VERSION_collab="1.0.0@8bc4ce4" ./deploy/remote/deploy-component.sh collab
   ```
   El script orquestará el despliegue de esa versión segura en el slot inactivo y realizará el cambio de tráfico verificado.

---

## 4. Pipeline de CI/CD en GitHub Actions

Cada repositorio (`crm-auth`, `crm-collab`, `crm-media`, etc.) cuenta con su flujo de trabajo en `.github/workflows/deploy.yml`:

1. **Validaciones Previas (CI)**: `pnpm test:unit`, `pnpm openapi:check`, `pnpm typecheck`, `pnpm lint`.
2. **Conexión SSH Segura**: Al aprobar la fase CI en la rama `main`, el runner de GitHub se conecta a la máquina virtual de producción (`155.248.207.47`).
3. **Invocación del Despliegue**: Ejecuta `deploy-component.sh <component>`.
4. **Notificación**: Publica el resultado y la versión desplegada en los logs de la ejecución.
