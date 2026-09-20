# Guía de Onboarding para Nuevos Microservicios: `crm-infra`

Esta guía detalla el flujo simplificado para crear, integrar y desplegar un nuevo microservicio en la plataforma CIMA CRM utilizando la automatización de `crm-infra`.

---

## 1. Creación Automática desde Plantilla

Para inicializar un nuevo microservicio, ejecuta el script oficial desde la raíz de `crm-infra`:

```bash
node scripts/create-microservice.mjs --name=<nombre> --port=<puerto>
```

**Ejemplo**:
```bash
node scripts/create-microservice.mjs --name=billing --port=3005
```

### Tareas que Ejecuta el Script Automáticamente:
1. Copia la plantilla oficial (`templates/microservice`) a `../crm-<nombre>`.
2. Reemplaza variables de entorno y metadatos (`{{SERVICE_NAME}}`, `{{SERVICE_PORT}}`, `{{DB_PASSWORD}}`, `{{SERVICE_TITLE}}`).
3. Registra la nueva entrada en `registry/services.json`.
4. Regenera la configuración de KrakenD (`krakend.json`) y los archivos de Docker Compose.
5. Si la CLI de GitHub (`gh`) está presente, inicializa y publica el repositorio en GitHub.

---

## 2. Configuración e Inicialización Local

Una vez creado el microservicio:

```bash
# 1. Configurar variables de entorno .env locales
pnpm setup:env

# 2. Inicializar el esquema y usuario de base de datos en Postgres
pnpm setup:db

# 3. Regenerar krakend.json para exponer el nuevo servicio
pnpm setup:gateway

# 4. Iniciar el servicio en modo desarrollo
pnpm --dir ../crm-<nombre> dev
```

---

## 3. Registro de Contratos y Manifiesto del Gateway

### A. Registro de Eventos en `cima-contracts`
Si el servicio emite o consume eventos en Redis Streams:
1. Agrega el esquema Zod en `cima-contracts/src/<nombre>-events.ts`.
2. Exporta el contrato en el `package.json` de `cima-contracts`.
3. Ejecuta `pnpm build` en `cima-contracts`.

### B. Manifiesto del Gateway (`gateway.manifest.json`)
En la raíz del nuevo servicio, define `gateway/gateway.manifest.json` listando los endpoints que deben ser enrutados por KrakenD:
```json
{
  "service": "<nombre>",
  "version": "1.0.0",
  "endpoints": [
    {
      "endpoint": "/api/v1/<nombre>/items",
      "method": "GET",
      "backend_url": "/api/v1/<nombre>/items",
      "openapi_ref": "GET /api/v1/<nombre>/items"
    }
  ]
}
```
Regenera la configuración del Gateway ejecutando `pnpm gateway:build` desde `crm-infra`.

---

## 4. Despliegue en Producción y CI/CD

1. Crea el flujo de GitHub Actions en `.github/workflows/deploy.yml` basándote en los demás servicios.
2. Agrega el soporte de despliegue en `deploy/remote/deploy-component.sh`:
   ```bash
   ./deploy/remote/deploy-component.sh <nombre>
   ```
3. Registra los secretos requeridos en GitHub Secrets o en la máquina virtual remota.
