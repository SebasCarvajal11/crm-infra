#!/usr/bin/env pwsh
#Requires -Version 7.0
$ErrorActionPreference = "Stop"

<#
.SYNOPSIS
    Bootstrap .env files for all CIMA CRM services.
.DESCRIPTION
    Creates .env files from .env.example templates, setting database URLs
    and other service-specific variables for local development.
#>

$infraRoot = Split-Path -Parent $PSScriptRoot
$workspaceRoot = Split-Path -Parent $infraRoot

# ── Defaults ────────────────────────────────────────────────────────────────
$postgresPort = if ($env:POSTGRES_HOST_PORT) { $env:POSTGRES_HOST_PORT } else { "15432" }
$redisPort = if ($env:REDIS_HOST_PORT) { $env:REDIS_HOST_PORT } else { "16379" }
$gatewayPort = if ($env:GATEWAY_HOST_PORT) { $env:GATEWAY_HOST_PORT } else { "18080" }
$trustSecret = if ($env:GATEWAY_TRUST_SECRET) { $env:GATEWAY_TRUST_SECRET } else { "cima-local-gateway-trust-secret-do-not-use-production-2026" }

# ── Helpers ─────────────────────────────────────────────────────────────────
function Set-EnvKey($filePath, $key, $value) {
    $content = if (Test-Path $filePath) { Get-Content $filePath -Raw } else { "" }
    if ($content -match "^$([regex]::Escape($key))=") {
        $content = $content -replace "^$([regex]::Escape($key))=.*$", "$key=$value"
    } else {
        $content = $content.TrimEnd() + "`n$key=$value`n"
    }
    Set-Content -Path $filePath -Value $content -NoNewline
}

function Ensure-EnvFile($serviceDir, $serviceName) {
    $envFile = Join-Path $serviceDir ".env"
    $exampleFile = Join-Path $serviceDir ".env.example"

    if (Test-Path $envFile) {
        Write-Host "  ✓ $serviceName .env ya existe" -ForegroundColor Green
        return
    }

    if (Test-Path $exampleFile) {
        Copy-Item $exampleFile $envFile
        Write-Host "  ✓ $serviceName .env creado desde .env.example" -ForegroundColor Green
    } else {
        Write-Host "  ⚠ $serviceName .env.example no encontrado" -ForegroundColor Yellow
        New-Item -ItemType File -Path $envFile -Force | Out-Null
    }
}

# ── crm-auth ────────────────────────────────────────────────────────────────
Write-Host "📝 Configurando crm-auth .env..." -ForegroundColor Cyan
$authDir = Join-Path $workspaceRoot "crm-auth"
if (Test-Path $authDir) {
    Ensure-EnvFile $authDir "crm-auth"
    $authEnv = Join-Path $authDir ".env"
    Set-EnvKey $authEnv "DATABASE_URL" "postgres://auth_user:authpassword@localhost:$postgresPort/crm_database"
    Set-EnvKey $authEnv "DB_SCHEMA" "schema_auth"
    Set-EnvKey $authEnv "PORT" "3000"
    Set-EnvKey $authEnv "REDIS_URL" "redis://localhost:$redisPort"
    Set-EnvKey $authEnv "GATEWAY_TRUST_SECRET" $trustSecret
    Set-EnvKey $authEnv "APP_PUBLIC_URL" "http://localhost:5173"
    Set-EnvKey $authEnv "REFRESH_COOKIE_PATH" "/api/auth/refresh"
} else {
    Write-Host "  ⚠ crm-auth no encontrado" -ForegroundColor Yellow
}

# ── crm-collab ──────────────────────────────────────────────────────────────
Write-Host "📝 Configurando crm-collab .env..." -ForegroundColor Cyan
$collabDir = Join-Path $workspaceRoot "crm-collab"
if (Test-Path $collabDir) {
    Ensure-EnvFile $collabDir "crm-collab"
    $collabEnv = Join-Path $collabDir ".env"
    Set-EnvKey $collabEnv "DATABASE_URL" "postgresql://collab_user:collabpassword@localhost:$postgresPort/crm_database"
    Set-EnvKey $collabEnv "DB_SCHEMA" "schema_collab"
    Set-EnvKey $collabEnv "PORT" "3001"
    Set-EnvKey $collabEnv "REDIS_URL" "redis://localhost:$redisPort"
    Set-EnvKey $collabEnv "GATEWAY_TRUST_SECRET" $trustSecret
    Set-EnvKey $collabEnv "AUTH_EVENTS_STREAM_KEY" "auth:events"
    Set-EnvKey $collabEnv "AUTH_EVENTS_CONSUMER_GROUP" "collab-auth-consumers"
} else {
    Write-Host "  ⚠ crm-collab no encontrado" -ForegroundColor Yellow
}

# ── crm-media ───────────────────────────────────────────────────────────────
Write-Host "📝 Configurando crm-media .env..." -ForegroundColor Cyan
$mediaDir = Join-Path $workspaceRoot "crm-media"
if (Test-Path $mediaDir) {
    Ensure-EnvFile $mediaDir "crm-media"
    $mediaEnv = Join-Path $mediaDir ".env"
    Set-EnvKey $mediaEnv "DATABASE_URL" "postgres://media_user:mediapassword@localhost:$postgresPort/crm_database"
    Set-EnvKey $mediaEnv "DB_SCHEMA" "schema_media"
    Set-EnvKey $mediaEnv "PORT" "3002"
    Set-EnvKey $mediaEnv "REDIS_URL" "redis://localhost:$redisPort"
    Set-EnvKey $mediaEnv "GATEWAY_TRUST_SECRET" $trustSecret
    Set-EnvKey $mediaEnv "CLAMAV_HOST" "localhost"
    Set-EnvKey $mediaEnv "CLAMAV_PORT" "3310"
} else {
    Write-Host "  ⚠ crm-media no encontrado" -ForegroundColor Yellow
}

# ── crm-frontend ────────────────────────────────────────────────────────────
Write-Host "📝 Configurando crm-frontend .env..." -ForegroundColor Cyan
$frontendDir = Join-Path $workspaceRoot "crm-frontend"
if (Test-Path $frontendDir) {
    Ensure-EnvFile $frontendDir "crm-frontend"
    $frontendEnv = Join-Path $frontendDir ".env"
    Set-EnvKey $frontendEnv "VITE_API_BASE_URL" "/api/v1"
    Set-EnvKey $frontendEnv "VITE_API_PROXY_TARGET" "http://localhost:$gatewayPort"
} else {
    Write-Host "  ⚠ crm-frontend no encontrado" -ForegroundColor Yellow
}

Write-Host "`n✅ Archivos .env configurados" -ForegroundColor Green
