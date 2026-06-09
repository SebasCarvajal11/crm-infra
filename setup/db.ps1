#!/usr/bin/env pwsh
#Requires -Version 5.1
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

# -- Wait for Postgres -------------------------------------------------------
Write-Host "[INFO] Waiting for PostgreSQL on localhost:$postgresPort..." -ForegroundColor Cyan
$maxAttempts = 30
for ($i = 0; $i -lt $maxAttempts; $i++) {
    try {
        $tcp = New-Object System.Net.Sockets.TcpClient
        $tcp.Connect("localhost", [int]$postgresPort)
        $tcp.Close()
        Write-Host "  [OK] PostgreSQL available" -ForegroundColor Green
        break
    } catch {
        if ($i -eq $maxAttempts - 1) {
            Write-Host "  [ERROR] PostgreSQL not available after $maxAttempts attempts" -ForegroundColor Red
            exit 1
        }
        Start-Sleep -Seconds 2
    }
}

# -- Run migrations ----------------------------------------------------------
$postgresUser = if ($env:POSTGRES_USER) { $env:POSTGRES_USER } else { "root" }
$postgresPassword = if ($env:POSTGRES_PASSWORD) { $env:POSTGRES_PASSWORD } else { "rootpassword" }
$postgresDb = if ($env:POSTGRES_DB) { $env:POSTGRES_DB } else { "crm_database" }
$env:DB_SUPERUSER_URL = "postgresql://${postgresUser}:${postgresPassword}@localhost:${postgresPort}/${postgresDb}"

$servicesPath = Join-Path (Join-Path $infraRoot "registry") "services.json"
if (-not (Test-Path $servicesPath)) {
    Write-Host "[ERROR] Registry services.json not found at $servicesPath" -ForegroundColor Red
    exit 1
}

$servicesRegistry = Get-Content -Raw $servicesPath | ConvertFrom-Json
$dbServices = $servicesRegistry | Where-Object { $_.schema -ne $null -and $_.dbSetupScripts -ne $null }

foreach ($service in $dbServices) {
    $serviceName = "crm-$($service.name)"
    $serviceDir = Join-Path $workspaceRoot $serviceName
    if (-not (Test-Path $serviceDir)) {
        Write-Host "  [WARN] $serviceName not found, skipping..." -ForegroundColor Yellow
        continue
    }

    foreach ($script in $service.dbSetupScripts) {
        Write-Host "[RUN] ${serviceName}: $script" -ForegroundColor Cyan
        Push-Location $serviceDir
        try {
            pnpm $script
            Write-Host "  [OK] $script completed" -ForegroundColor Green
        } catch {
            Write-Host "  [ERROR] $script failed: $_" -ForegroundColor Red
            Pop-Location
            exit 1
        }
        Pop-Location
    }
}

# -- Seed --------------------------------------------------------------------
Write-Host "[SEED] Seeding initial data..." -ForegroundColor Cyan
$authDir = Join-Path $workspaceRoot "crm-auth"
if (Test-Path $authDir) {
    Push-Location $authDir
    try {
        pnpm db:seed
        Write-Host "  [OK] Seed completed" -ForegroundColor Green
    } catch {
        Write-Host "  [ERROR] Seed failed: $_" -ForegroundColor Red
        Pop-Location
        exit 1
    }
    Pop-Location
} else {
    Write-Host "  [WARN] crm-auth not found, skipping seed" -ForegroundColor Yellow
}

Write-Host "`n[OK] Database setup completed successfully" -ForegroundColor Green
