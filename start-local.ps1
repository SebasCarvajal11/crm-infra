#!/usr/bin/env pwsh
#Requires -Version 7.0
$ErrorActionPreference = "Stop"

Write-Host "Iniciando CIMA CRM local con Docker Compose..." -ForegroundColor Cyan

$repos = @("crm-auth", "crm-collab", "crm-media", "crm-frontend")
foreach ($repo in $repos) {
    if (-not (Test-Path "../$repo")) {
        throw "Repositorio hermano requerido no encontrado: ../$repo"
    }
}

$requiredEnvFiles = @(
    "../crm-auth/.env",
    "../crm-collab/.env",
    "../crm-media/.env"
)
foreach ($envFile in $requiredEnvFiles) {
    if (-not (Test-Path $envFile)) {
        throw "Archivo de entorno requerido no encontrado: $envFile. Copia el .env.example del servicio y configura sus secretos reales."
    }
}

docker compose --env-file .env.docker up -d --build

Write-Host ""
Write-Host "CIMA CRM iniciado" -ForegroundColor Green
Write-Host "  Frontend: http://localhost:$($env:FRONTEND_HOST_PORT ?? '5173')" -ForegroundColor White
Write-Host "  Gateway:  http://localhost:$($env:GATEWAY_HOST_PORT ?? '18080')" -ForegroundColor White
Write-Host "  Postgres: localhost:$($env:POSTGRES_HOST_PORT ?? '15432')" -ForegroundColor White
Write-Host "  Redis:    localhost:$($env:REDIS_HOST_PORT ?? '16379')" -ForegroundColor White
Write-Host ""
Write-Host "Comandos utiles:" -ForegroundColor Cyan
Write-Host "  docker compose --env-file .env.docker ps"
Write-Host "  docker compose --env-file .env.docker logs -f"
Write-Host "  docker compose --env-file .env.docker down"
