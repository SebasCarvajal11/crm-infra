FROM node:20-alpine
WORKDIR /app

# Copiamos archivos de configuración
COPY package*.json tsconfig.json ./

# Instalamos SOLO dependencias de producción (incluirá tsx que movimos a dependencies)
RUN npm ci --omit=dev

# Copiamos el código fuente
COPY src ./src

# Exponemos el puerto del BFF
EXPOSE 3002

# Comando para iniciar la aplicación con tsx
CMD ["npx", "tsx", "src/server.ts"]