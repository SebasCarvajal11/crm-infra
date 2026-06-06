#!/usr/bin/env pwsh
#Requires -Version 7.0
$ErrorActionPreference = "Stop"

<#
.SYNOPSIS
    Run database migrations and seed for all CIMA CRM services.
.DESCRIPTION
    Pushes schemas and seeds the database for local development.
    Requires PostgreSQL to be running (docker compose up postgres_db).
#>

$infraRoot = Split-Path -Parent $PSScriptRoot
$workspaceRoot = Split-Path -Parent $infraRoot
$postgresPort = if ($env:POSTGRES_HOST_PORT) { $env:POSTGRES_HOST_PORT } else { "15432" }

# ── Wait for Postgres ───────────────────────────────────────────────────────
Write-Host "⏳ Esperando PostgreSQL en localhost:$postgresPort..." -ForegroundColor Cyan
$maxAttempts = 30
for ($i = 0; $i -lt $maxAttempts; $i++) {
    try {
        $tcp = New-Object System.Net.Sockets.TcpClient
        $tcp.Connect("localhost", [int]$postgresPort)
        $tcp.Close()
        Write-Host "  ✓ PostgreSQL disponible" -ForegroundColor Green
        break
    } catch {
        if ($i -eq $maxAttempts - 1) {
            Write-Host "  ✗ PostgreSQL no disponible después de $maxAttempts intentos" -ForegroundColor Red
            exit 1
        }
        Start-Sleep -Seconds 2
    }
}

# ── Run migrations ──────────────────────────────────────────────────────────
$services = @(
    @{ Name = "crm-auth"; Dir = "crm-auth"; Scripts = @("db:push", "db:partition-audit-migrate") },
    @{ Name = "crm-collab"; Dir = "crm-collab"; Scripts = @("db:push") },
    @{ Name = "crm-media"; Dir = "crm-media"; Scripts = @("db:push") }
)

foreach ($service in $services) {
    $serviceDir = Join-Path $workspaceRoot $service.Dir
    if (-not (Test-Path $serviceDir)) {
        Write-Host "  ⚠ $($service.Name) no encontrado, saltando..." -ForegroundColor Yellow
        continue
    }

    foreach ($script in $service.Scripts) {
        Write-Host "🔧 $($service.Name): $script" -ForegroundColor Cyan
        Push-Location $serviceDir
        try {
            pnpm $script
            Write-Host "  ✓ $script completado" -ForegroundColor Green
        } catch {
            Write-Host "  ✗ $script falló: $_" -ForegroundColor Red
            Pop-Location
            exit 1
        }
        Pop-Location
    }
}

# ── Seed ────────────────────────────────────────────────────────────────────
Write-Host "🌱 Sembrando datos iniciales..." -ForegroundColor Cyan
$authDir = Join-Path $workspaceRoot "crm-auth"
if (Test-Path $authDir) {
    Push-Location $authDir
    try {
        pnpm db:seed
        Write-Host "  ✓ Seed completado" -ForegroundColor Green
    } catch {
        Write-Host "  ✗ Seed falló: $_" -ForegroundColor Red
        Pop-Location
        exit 1
    }
    Pop-Location
} else {
    Write-Host "  ⚠ crm-auth no encontrado, saltando seed" -ForegroundColor Yellow
}

Write-Host "`n✅ Base de datos configurada" -ForegroundColor Green
