# ADR-003: Segregación Lógica de PostgreSQL por Schemas y Redis Centralizado

- **Estado**: Aceptado
- **Fecha**: 2026-06-18
- **Autores**: Equipo de Infraestructura y Base de Datos CIMA

---

## Contexto y Planteamiento del Problema

En una arquitectura de microservicios, el principio de autonomía sugiere que cada microservicio debe poseer su propio almacén de datos. Sin embargo, desplegar 4 o 5 instancias de bases de datos PostgreSQL independientes en contenedores separados provocaría:
1. Desperdicio masivo de memoria RAM en cachés de búfer duplicadas y procesos de fondo de Postgres.
2. Dificultad para coordinar respaldos (*backups*), réplicas y políticas de retención.
3. Sobrecarga innecesaria de recursos en entornos de desarrollo y en la máquina virtual de producción.

---

## Alternativas Evaluadas

### Opción 1: Un Contenedor de PostgreSQL por Cada Microservicio
- **Descripción**: Levantar `postgres_auth`, `postgres_collab`, `postgres_media`, etc.
- **Desventajas**: Cada instancia consume un mínimo de 150-250 MB de RAM base; 5 instancias consumirían más de 1 GB únicamente en procesos de motor inactivo.

### Opción 2: Base de Datos Única sin Segregación (Esquema `public` Compartido)
- **Descripción**: Todas las tablas de todos los microservicios conviven en el esquema por defecto.
- **Desventajas**: Rompe por completo el aislamiento de microservicios; riesgo de colisión de nombres y dependencias ocultas no controladas.

### Opción 3 (Elegida): Clúster PostgreSQL Único con Segregación Lógica por Schemas
- **Descripción**: Utilizar una única instancia de PostgreSQL 16 con esquemas independientes (`schema_auth`, `schema_collab`, `schema_media`, `schema_marketing`). Cada microservicio se conecta con un usuario de base de datos restringido exclusivamente a su esquema mediante privilegios `GRANT`.

---

## Decisión

Adoptar la **Opción 3**:
1. Proveer un único contenedor `postgres_db` en la infraestructura compartida.
2. Definir permisos estrictos en `registry/db/grants.json`:
   - `auth_user` solo tiene acceso a `schema_auth`.
   - `collab_user` solo tiene acceso a `schema_collab`.
   - `media_user` solo tiene acceso a `schema_media`.
3. Centralizar Redis 7 para coordinar tanto Redis Streams como colas BullMQ bajo un único motor con persistencia AOF (`appendonly yes`).

---

## Consecuencias

### Positivas
- **Máxima Eficiencia de Recursos**: Optimización drástica de CPU y memoria RAM.
- **Respaldos Unificados**: Un único script de respaldo (`pg_dumpall` o WAL archiving) protege toda la plataforma.
- **Aislamiento Fuerte**: Los usuarios de base de datos no tienen permisos para consultar tablas de otros microservicios, previniendo *JOINs* indebidos.

### Negativas
- **Punto Único de Fallo en Almacenamiento**: Si la instancia compartida de PostgreSQL se detiene, todos los servicios dependientes se ven afectados.
