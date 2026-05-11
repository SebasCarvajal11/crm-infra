# ETAPA 1: Construcción (Builder)
# Usamos una imagen ligera de Node
FROM node:20-alpine AS builder
WORKDIR /app

# Copiamos archivos de configuración
COPY package*.json tsconfig.json ./

# Instalamos TODAS las dependencias (incluyendo TypeScript para poder compilar)
RUN npm ci

# Copiamos el código fuente
COPY src ./src

# Compilamos TypeScript de /src hacia /dist
RUN npm run build


# ETAPA 2: Producción (Runner)
# Empezamos desde una imagen limpia (esto hace que el contenedor pese muy poco)
FROM node:20-alpine
WORKDIR /app

# Copiamos solo el package.json
COPY package*.json ./

# Instalamos SOLO dependencias de producción (ignoramos TypeScript, tsx, etc.)
RUN npm ci --omit=dev

# Copiamos la carpeta /dist ya compilada desde la Etapa 1
COPY --from=builder /app/dist ./dist

# Exponemos el puerto del BFF
EXPOSE 3002

# Comando para iniciar la aplicación compilada
CMD ["npx", "tsx", "dist/server.js"]