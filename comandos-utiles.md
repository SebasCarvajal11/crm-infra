# Comandos Utiles - CRM CIMA

## Credenciales de Acceso

### Administradores
| Email | Contrasena | Rol |
|-------|------------|-----|
| admin@cima.dev | Admin123! | Admin (original) |
| director@cima.dev | Demo123! | Admin |
| gerente@cima.dev | Demo123! | Admin |

### Trabajadores (Disenadores)
| Email | Contrasena |
|-------|------------|
| ana.martinez@cima.dev | Demo123! |
| luis.rodriguez@cima.dev | Demo123! |
| sofia.herrera@cima.dev | Demo123! |
| diego.morales@cima.dev | Demo123! |

### Trabajadores (Desarrolladores)
| Email | Contrasena |
|-------|------------|
| pedro.sanchez@cima.dev | Demo123! |
| laura.gomez@cima.dev | Demo123! |
| miguel.torres@cima.dev | Demo123! |

### Trabajadores (Marketing)
| Email | Contrasena |
|-------|------------|
| carmen.vega@cima.dev | Demo123! |
| andres.luna@cima.dev | Demo123! |
| valentina.rios@cima.dev | Demo123! |

### Clientes
| Email | Empresa | Contrasena |
|-------|---------|------------|
| contacto@restauranteelbuensabor.com | Restaurante El Buen Sabor | Demo123! |
| marketing@tecnologiasavanzadas.co | Tecnologias Avanzadas S.A. | Demo123! |
| info@modabella.com | Moda Bella Boutique | Demo123! |
| ventas@constructorasolida.com | Constructora Solida | Demo123! |
| contacto@clinicasalud360.com | Clinica Salud 360 | Demo123! |
| admin@gimnasiopower.fit | Gimnasio Power Fitness | Demo123! |
| info@cafeteriaaroma.com | Cafeteria Aroma | Demo123! |
| gerencia@automotrizrapido.com | Automotriz Rapido | Demo123! |
| contacto@academiaexito.edu | Academia Exito | Demo123! |
| ventas@joyeriaplata.com | Joyeria Plata & Oro | Demo123! |
| info@hotelparaiso.com | Hotel Paraiso | Demo123! |
| marketing@deportesextreme.co | Deportes Extreme | Demo123! |

## URLs de Acceso

- Frontend: http://localhost:5173
- API Gateway (KrakenD): http://localhost:8080
- mod-auth (directo): http://localhost:3000
- mod-collab (directo): http://localhost:3001
- Swagger mod-collab: http://localhost:3001/docs

## Comandos Docker

```bash
# Iniciar contenedores
docker compose up -d

# Ver logs
docker logs crm_krakend_gateway -f
docker logs crm_postgres_db -f
docker logs crm_redis -f

# Detener contenedores
docker compose down

# Reiniciar
docker compose restart
```

## Comandos de Desarrollo

### mod-auth
```bash
cd mod-auth
pnpm dev            # Iniciar servidor desarrollo
pnpm worker:email   # Procesar cola de correos
pnpm db:push        # Aplicar esquema a BD
pnpm db:seed        # Poblar con datos de prueba
pnpm db:studio      # Abrir Drizzle Studio
```

### mod-collab
```bash
cd mod-collab
pnpm dev            # Iniciar servidor desarrollo
pnpm db:push        # Aplicar esquema a BD
pnpm db:seed        # Poblar con datos de prueba
pnpm db:studio      # Abrir Drizzle Studio
```

### crm-frontend
```bash
cd crm-frontend
pnpm dev            # Iniciar servidor desarrollo
pnpm build          # Build de produccion
```

## Reiniciar Datos de Prueba

```bash
# 1. Limpiar tablas de collab
docker exec crm_postgres_db psql -U root -d crm_database -c "TRUNCATE schema_collab.projects CASCADE;"

# 2. Re-ejecutar seeds
cd mod-auth && pnpm db:seed
cd mod-collab && pnpm db:seed
```
