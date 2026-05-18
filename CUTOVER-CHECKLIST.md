# Cutover Checklist

Checklist operativo para declarar el stack multi-repo como entorno principal de trabajo.

## 1. Repos

- `crm-infra`, `crm-auth`, `crm-collab`, `crm-media` y `crm-frontend` existen como repos separados.
- Cada repo tiene `origin` apuntando al remoto correcto.
- Cada repo usa `pnpm` y no conserva `package-lock.json`.
- Cada repo tiene `.env.example` portable.

## 2. Arranque local

- Desde `crm-infra`, `start-project.ps1` levanta el entorno aislado sin depender del monorepo.
- Los `.env` faltantes se bootstrapean correctamente.
- La base aislada queda accesible en `localhost:15432`.
- KrakenD responde en `http://localhost:18080/health`.

## 3. Verificacion tecnica

Ejecutar en `crm-infra`:

```powershell
pnpm verify:multirepo
```

La etapa no se cierra si este comando no pasa completo.

Adicional para el flujo UI real:

```powershell
pnpm verify:frontend-ui
```

## 4. Verificacion funcional minima

- Login en frontend via gateway.
- Carga del dashboard.
- Creacion de proyecto.
- Creacion de tarea.
- Subida de archivo.
- Acceso a workspace.

## 5. Secretos y configuracion

- No hay `oci.config`, `.pem`, `.key` ni secretos versionados en repos publicos.
- `GATEWAY_TRUST_SECRET` es coherente entre `crm-infra`, `crm-auth`, `crm-collab` y `crm-media`.
- OCI se consume desde archivos locales fuera del repo.

## 6. Cambio operativo del equipo

- El equipo deja de levantar el stack desde `D:\BACKUP CELULAR OLIMPO\CIMA CRM Proyecto de Grado`.
- La referencia principal para integracion local pasa a ser `D:\BACKUP CELULAR OLIMPO\crm-infra`.
- El monorepo original queda congelado, archivado o en solo lectura.

## 7. Cierre recomendado

- Crear tag de cierre del monorepo.
- Marcar el monorepo como legacy o read-only.
- Abrir las siguientes tareas por separado si se desean:
  - CI/CD por repo
  - estandar comun de workflows
  - meta-repo documental
  - endurecimiento de despliegue productivo
