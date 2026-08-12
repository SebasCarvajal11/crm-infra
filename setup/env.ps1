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
$dockerEnvPath = Join-Path $infraRoot ".env.docker"

function Get-InfraEnvValue($key, $fallback) {
    $processValue = [Environment]::GetEnvironmentVariable($key)
    if ($processValue) { return $processValue }

    if (Test-Path $dockerEnvPath) {
        $match = Get-Content $dockerEnvPath | Where-Object { $_ -match "^$([regex]::Escape($key))=" } | Select-Object -First 1
        if ($match) { return ($match -replace "^$([regex]::Escape($key))=", "").Trim() }
    }

    return $fallback
}

$postgresPort = Get-InfraEnvValue "POSTGRES_HOST_PORT" "15432"
$redisPort = Get-InfraEnvValue "REDIS_HOST_PORT" "16379"
$gatewayPort = Get-InfraEnvValue "GATEWAY_HOST_PORT" "18080"


# ── Helpers ─────────────────────────────────────────────────────────────────
function Set-EnvKey($filePath, $key, $value) {
    $pattern = "^$([regex]::Escape($key))="
    $updated = $false
    $lines = if (Test-Path $filePath) { Get-Content $filePath } else { @() }
    $normalizedLines = foreach ($line in $lines) {
        if ($line -match $pattern) {
            if (-not $updated) {
                $updated = $true
                "$key=$value"
            }
            continue
        }
        $line
    }

    if (-not $updated) {
        $normalizedLines += "$key=$value"
    }

    Set-Content -Path $filePath -Value $normalizedLines
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
