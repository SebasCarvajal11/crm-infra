# ADR-002: Estrategia de Despliegue Zero-Downtime por Slots Blue/Green y Versionado semver@hash

- **Estado**: Aceptado
- **Fecha**: 2026-05-28
- **Autores**: Equipo de Infraestructura y SRE CIMA

---

## Contexto y Planteamiento del Problema

Desplegar microservicios en un único servidor o clúster realizando reinicios en el lugar (*in-place updates*) provoca:
1. Cortes de servicio temporales durante el reinicio de contenedores (errores 502/504 en los clientes).
2. Riesgo de conmutar tráfico a una versión defectuosa sin verificación previa.
3. Complejidad para revertir cambios rápidamente ante fallos críticos en producción.

---

## Alternativas Evaluadas

### Opción 1: Despliegue en el Lugar (Rolling Updates sobre Compose)
- **Descripción**: Actualizar contenedores individualmente usando `docker compose up -d <service>`.
- **Desventajas**: Ventana de indisponibilidad durante la descarga de imágenes o compilación; si el servicio falla al iniciar, el anterior ya fue detenido.

### Opción 2: Clúster Kubernetes Completo
- **Descripción**: Migrar toda la infraestructura a un clúster Kubernetes administrado.
- **Desventajas**: Sobrecarga operativa y de costos excesiva para el tamaño del equipo y la infraestructura actual de CIMA CRM.

### Opción 3 (Elegida): Despliegue por Slots (Blue/Green) con Registro semver@hash
- **Descripción**: Mantener dos slots idénticos en la máquina virtual (`blue` y `green`). Desplegar la nueva versión en el slot inactivo, verificar la salud de todos los endpoints y conmutar el proxy inverso Nginx instantáneamente.

---

## Decisión

Adoptar la **Opción 3**:
1. Implementar `deploy/remote/deploy-component.sh` para gestionar despliegues independientes por componente (`auth`, `collab`, `media`, etc.).
2. Mantener registros de estado (`.active-versions-blue` y `.active-versions-green`) en formato `semver@commit_sha`.
3. Al desplegar un solo componente, los demás servicios se congelan en las versiones estables activas en el slot de origen.
4. Conmutar el tráfico únicamente cuando el *Health Check Gate* valide que todos los servicios del nuevo slot responden `200 OK`.
5. Proporcionar capacidad de reversión (*rollback*) instantánea ante cualquier fallo.

---

## Consecuencias

### Positivas
- **Cero Tiempo de Inactividad**: Los usuarios finales nunca experimentan caídas ni cortes durante actualizaciones.
- **Seguridad y Confianza**: La versión anterior permanece intacta hasta que la nueva demuestre estar 100% saludable.
- **Simplicidad Operativa**: Automatizable mediante simples comandos Bash en pipelines de GitHub Actions.

### Negativas
- **Doble Consumo Temporal de Recursos**: Durante el despliegue coexisten ambos slots en memoria RAM hasta que el slot anterior es drenado.
