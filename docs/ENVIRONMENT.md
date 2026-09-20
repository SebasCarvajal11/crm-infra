# Variables de Entorno y Puertos: `crm-infra`

Este documento describe la gestión de configuración, el aprovisionamiento automatizado de archivos `.env` y el mapa de puertos de la plataforma CIMA CRM.

---

## 1. Mapa de Puertos del Ecosistema

Para evitar conflictos tanto en entornos locales de desarrollo como en contenedores Docker, los puertos están formalmente asignados:

| Servicio | Puerto Host (Local) | Puerto Interno Contenedor | Propósito |
| :--- | :--- | :--- | :--- |
| **KrakenD API Gateway** | `28080` | `8080` | Entrada única para todas las peticiones API `/api/v1/*` |
| **crm-frontend** | `5173` (Vite) | `80` (Nginx) | Interfaz de usuario SPA React |
| **PostgreSQL 16** | `25432` | `5432` | Base de datos relacional compartida |
| **Redis 7** | `26379` | `6379` | Broker de Redis Streams y colas BullMQ |
| **ClamAV Daemon** | `23310` | `3310` | Escáner antivirus por socket TCP |
| **crm-auth** | `3000` | `3000` | Microservicio de identidad y sesiones |
| **crm-collab** | `3001` | `3001` | Microservicio de proyectos, tareas y chat |
| **crm-media** | `3002` | `3002` | Microservicio de medios y motor de correo |
| **crm-marketing** | `3003` | `3003` | Microservicio de marketing (Spring Boot) |
| **Prometheus** | `9090` | `9090` | Motor de recolección de métricas |
| **Loki** | `3100` | `3100` | Almacén y motor de búsqueda de logs |
| **Grafana** | `23000` | `3000` | Interfaz web de tableros de observabilidad |

---

## 2. Aprovisionamiento Automatizado: `pnpm setup:env`

Para agilizar el inicio de nuevos desarrolladores y garantizar sincronización entre microservicios, `crm-infra` provee el script de aprovisionamiento:

```powershell
pnpm setup:env
```

### Acciones que Realiza el Script:
1. Inspecciona cada repositorio hermano (`crm-auth`, `crm-collab`, `crm-media`, `crm-frontend`, `crm-infra`).
2. Si no existe `.env`, copia su respectivo `.env.example` y genera automáticamente:
   - Claves criptográficas RSA para desarrollo (pares de llaves privada/pública para JWT).
   - Clave simétrica `EMAIL_ENCRYPTION_KEY` para cifrado AES-256 de correos.
   - Contraseñas locales de conexión para cada usuario de base de datos (`auth_user`, `collab_user`, `media_user`).
3. Sincroniza las URLs de los servicios hermanos para que apunten a los puertos correctos del host o de Docker según corresponda.

---

## 3. Gestión de Secretos en Producción

- **Regla Estricta**: Ningún valor de producción ni credencial real debe registrarse en archivos versionados por Git.
- **Inyección en Servidor**: En la máquina virtual de producción (`155.248.207.47`), las variables se inyectan en archivos `.env.production` protegidos con permisos `chmod 600`.
- **Validación Fail-Fast**: Todos los servicios procesan sus variables de entorno al iniciar mediante esquemas estrictos de Zod. Si falta una variable o contiene valores por defecto inseguros (ej. `change-me` o `secret`), el proceso aborta inmediatamente con código de salida 1.
