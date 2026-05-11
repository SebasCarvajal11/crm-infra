# Comandos Útiles - CRM CIMA

## Credenciales de Acceso

### Administradores
| Email | Contraseña | Rol |
|-------|------------|-----|
| admin@cima.dev | Admin123! | Admin (original) |
| director@cima.dev | Demo123! | Admin |
| gerente@cima.dev | Demo123! | Admin |

### Trabajadores (Diseñadores)
| Email | Contraseña |
|-------|------------|
| ana.martinez@cima.dev | Demo123! |
| luis.rodriguez@cima.dev | Demo123! |
| sofia.herrera@cima.dev | Demo123! |
| diego.morales@cima.dev | Demo123! |

### Trabajadores (Desarrolladores)
| Email | Contraseña |
|-------|------------|
| pedro.sanchez@cima.dev | Demo123! |
| laura.gomez@cima.dev | Demo123! |
| miguel.torres@cima.dev | Demo123! |

### Trabajadores (Marketing)
| Email | Contraseña |
|-------|------------|
| carmen.vega@cima.dev | Demo123! |
| andres.luna@cima.dev | Demo123! |
| valentina.rios@cima.dev | Demo123! |

### Clientes
| Email | Empresa | Contraseña |
|-------|---------|------------|
| contacto@restauranteelbuensabor.com | Restaurante El Buen Sabor | Demo123! |
| marketing@tecnologiasavanzadas.co | Tecnologías Avanzadas S.A. | Demo123! |
| info@modabella.com | Moda Bella Boutique | Demo123! |
| ventas@constructorasolida.com | Constructora Sólida | Demo123! |
| contacto@clinicasalud360.com | Clínica Salud 360 | Demo123! |
| admin@gimnasiopower.fit | Gimnasio Power Fitness | Demo123! |
| info@cafeteriaaroma.com | Cafetería Aroma | Demo123! |
| gerencia@automotrizrapido.com | Automotriz Rápido | Demo123! |
| contacto@academiaexito.edu | Academia Éxito | Demo123! |
| ventas@joyeriaplata.com | Joyería Plata & Oro | Demo123! |
| info@hotelparaiso.com | Hotel Paraíso | Demo123! |
| marketing@deportesextreme.co | Deportes Extreme | Demo123! |

## URLs de Acceso

- **Frontend**: http://localhost:5173
- **API Gateway (KrakenD)**: http://localhost:8080
- **mod-auth (directo)**: http://localhost:3000
- **mod-collab (directo)**: http://localhost:3001
- **Swagger mod-collab**: http://localhost:3001/docs

## Comandos Docker

```bash
# Iniciar contenedores
docker-compose up -d

# Ver logs
docker logs crm_krakend_gateway -f
docker logs crm_postgres_db -f
docker logs crm_redis -f

# Detener contenedores
docker-compose down

# Reiniciar
docker-compose restart
```

## Comandos de Desarrollo

### mod-auth
```bash
cd mod-auth
npm run dev          # Iniciar servidor desarrollo
npm run db:push      # Aplicar esquema a BD
npm run db:seed      # Poblar con datos de prueba
npm run db:studio    # Abrir Drizzle Studio
```

### mod-collab
```bash
cd mod-collab
npm run dev          # Iniciar servidor desarrollo
npm run db:push      # Aplicar esquema a BD
npm run db:seed      # Poblar con datos de prueba
npm run db:studio    # Abrir Drizzle Studio
```

### crm-frontend
```bash
cd crm-frontend
npm run dev          # Iniciar servidor desarrollo
npm run build        # Build de producción
```

## Reiniciar Datos de Prueba

```bash
# 1. Limpiar tablas de collab
docker exec crm_postgres_db psql -U root -d crm_database -c "TRUNCATE schema_collab.projects CASCADE;"

# 2. Re-ejecutar seeds
cd mod-auth && npm run db:seed
cd mod-collab && npm run db:seed
```

## Proyectos de Prueba Disponibles

| Proyecto | Cliente | Tipo | Estado |
|----------|---------|------|--------|
| Campaña de Verano 2026 | Restaurante El Buen Sabor | Campaña | En progreso (65%) |
| Merchandising Corporativo Tech | Tecnologías Avanzadas S.A. | Producto | En progreso (45%) |
| Rebranding Moda Bella 2026 | Moda Bella Boutique | Campaña | Completado (100%) |
| Web App Constructora | Constructora Sólida | Campaña | En revisión (85%) |
| Campaña Salud Preventiva | Clínica Salud 360 | Campaña | En progreso (40%) |
| Identidad Visual Gym Power | Gimnasio Power Fitness | Campaña | En progreso (55%) |
| Menú y Packaging Aroma | Cafetería Aroma | Producto | Por hacer (0%) |
| Campaña Lanzamiento SUV 2027 | Automotriz Rápido | Campaña | En progreso (30%) |
| Portal Educativo Online | Academia Éxito | Campaña | En progreso (70%) |
| Catálogo Navidad 2026 | Joyería Plata & Oro | Campaña | En revisión (90%) |
| Señalización Hotel Paraíso | Hotel Paraíso | Producto | En progreso (50%) |
| Tienda Online Deportes | Deportes Extreme | Campaña | Por hacer (0%) |
