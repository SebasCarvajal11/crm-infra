#!/usr/bin/env pwsh
#Requires -Version 5.1
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
        Write-Host "  [OK] $serviceName .env already exists" -ForegroundColor Green
        return
    }

    if (Test-Path $exampleFile) {
        Copy-Item $exampleFile $envFile
        Write-Host "  [OK] $serviceName .env created from .env.example" -ForegroundColor Green
    } else {
        Write-Host "  [WARN] $serviceName .env.example not found" -ForegroundColor Yellow
        New-Item -ItemType File -Path $envFile -Force | Out-Null
    }
}

function Get-PackageVersion($serviceDir) {
    $packageJsonPath = Join-Path $serviceDir "package.json"
    if (Test-Path $packageJsonPath) {
        $pkg = Get-Content $packageJsonPath -Raw | ConvertFrom-Json
        if ($pkg.version) { return $pkg.version }
    }
    return "1.0.0"
}

# -- Load Services Registry --------------------------------------------------
$servicesPath = Join-Path (Join-Path $infraRoot "registry") "services.json"
if (-not (Test-Path $servicesPath)) {
    Write-Host "[ERROR] Registry services.json not found at $servicesPath" -ForegroundColor Red
    exit 1
}

$servicesRegistry = Get-Content -Raw $servicesPath | ConvertFrom-Json

foreach ($s in $servicesRegistry) {
    $sName = "crm-$($s.name)"
    $sDir = Join-Path $workspaceRoot $sName
    Write-Host "[INFO] Configurando $($sName) .env..." -ForegroundColor Cyan
    
    if (-not (Test-Path $sDir)) {
        Write-Host "  [WARN] $($sName) not found in $sDir, skipping..." -ForegroundColor Yellow
        continue
    }

    Ensure-EnvFile $sDir $sName
    $envFile = Join-Path $sDir ".env"

    if ($s.name -eq "frontend") {
        Set-EnvKey $envFile "VITE_API_BASE_URL" "/api/v1"
        Set-EnvKey $envFile "VITE_API_PROXY_TARGET" "http://localhost:$gatewayPort"
    } else {
        # Backend microservices
        Set-EnvKey $envFile "PORT" "$($s.port)"
        Set-EnvKey $envFile "REDIS_URL" "redis://localhost:$redisPort"
        Set-EnvKey $envFile "TRUST_GATEWAY_JWT_HEADERS" "false"
        Set-EnvKey $envFile "SERVICE_VERSION" (Get-PackageVersion $sDir)

        if ($s.schema) {
            Set-EnvKey $envFile "DATABASE_URL" "postgresql://$($s.name)_user:$($s.name)password@localhost:$postgresPort/crm_database"
            Set-EnvKey $envFile "DB_SCHEMA" "$($s.schema)"
        }
    }
}

Write-Host "`n[OK] Environment files configured successfully" -ForegroundColor Green
