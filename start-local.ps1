$ErrorActionPreference = "Stop"

Write-Host "Iniciando CIMA CRM local con Docker Compose..." -ForegroundColor Cyan

$repos = @("crm-auth", "crm-collab", "crm-media", "crm-frontend", "crm-marketing")
foreach ($repo in $repos) {
    if (-not (Test-Path "../$repo")) {
        throw "Repositorio hermano requerido no encontrado: ../$repo"
    }
}

$requiredEnvFiles = @(
    "../crm-auth/.env",
    "../crm-collab/.env",
    "../crm-media/.env",
    "../crm-marketing/.env"
)
foreach ($envFile in $requiredEnvFiles) {
    if (-not (Test-Path $envFile)) {
        throw "Archivo de entorno requerido no encontrado: $envFile. Copia el .env.example del servicio y configura sus secretos reales."
    }
}

docker compose --env-file .env.docker up -d --build --remove-orphans

$frontendPort = if ($env:FRONTEND_HOST_PORT) { $env:FRONTEND_HOST_PORT } else { "5173" }
$gatewayPort = if ($env:GATEWAY_HOST_PORT) { $env:GATEWAY_HOST_PORT } else { "28080" }
$postgresPort = if ($env:POSTGRES_HOST_PORT) { $env:POSTGRES_HOST_PORT } else { "25432" }
$redisPort = if ($env:REDIS_HOST_PORT) { $env:REDIS_HOST_PORT } else { "26379" }

Write-Host ""
Write-Host "CIMA CRM iniciado" -ForegroundColor Green
Write-Host "  Frontend: http://localhost:$frontendPort" -ForegroundColor White
Write-Host "  Gateway:  http://localhost:$gatewayPort" -ForegroundColor White
Write-Host "  Postgres: localhost:$postgresPort" -ForegroundColor White
Write-Host "  Redis:    localhost:$redisPort" -ForegroundColor White
Write-Host ""
Write-Host "Comandos utiles:" -ForegroundColor Cyan
Write-Host "  docker compose --env-file .env.docker ps"
Write-Host "  docker compose --env-file .env.docker logs -f"
Write-Host "  docker compose --env-file .env.docker down"
