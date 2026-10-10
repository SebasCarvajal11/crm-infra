<#
.SYNOPSIS
    Orquestador de levantamiento local de CIMA CRM en Docker.
.DESCRIPTION
    Valida dependencias, inicializa variables de entorno, arranca contenedores,
    monitorea la salud de los servicios y ofrece utilidades de operacion.
#>
[CmdletBinding()]
param(
    [switch]$Down,
    [switch]$Restart,
    [switch]$Status,
    [switch]$OpenBrowser,
    [switch]$NoBuild,
    [switch]$NoWait,
    [string]$Logs,
    [switch]$Interactive
)

$ErrorActionPreference = "Stop"
$infraRoot = $PSScriptRoot
$workspaceRoot = Split-Path -Parent $infraRoot
Set-Location $infraRoot

function Get-DockerEnvVar {
    param([string]$Key, [string]$Fallback)
    $envPath = Join-Path $infraRoot ".env.docker"
    if (Test-Path $envPath) {
        $line = Get-Content $envPath | Where-Object { $_ -match "^$([regex]::Escape($Key))=(.*)$" } | Select-Object -First 1
        if ($line) { return ($line -replace "^$([regex]::Escape($Key))=", "").Trim() }
    }
    $val = [Environment]::GetEnvironmentVariable($Key)
    if ($val) { return $val }
    return $Fallback
}

$frontendPort = Get-DockerEnvVar "FRONTEND_HOST_PORT" "5173"
$gatewayPort = Get-DockerEnvVar "GATEWAY_HOST_PORT" "28080"
$postgresPort = Get-DockerEnvVar "POSTGRES_HOST_PORT" "25432"
$redisPort = Get-DockerEnvVar "REDIS_HOST_PORT" "26379"

function Test-DockerRunning {
    try {
        $null = docker info 2>&1
        if ($LASTEXITCODE -ne 0) { return $false }
        return $true
    } catch {
        return $false
    }
}

function Ensure-DockerActive {
    if (Test-DockerRunning) { return }
    Write-Host "[WARN] Docker Desktop no responde. Intentando iniciar servicio..." -ForegroundColor Yellow
    $dockerExe = "C:\Program Files\Docker\Docker\Docker Desktop.exe"
    if (Test-Path $dockerExe) {
        Start-Process $dockerExe
    }
    $attempts = 0
    while (-not (Test-DockerRunning) -and $attempts -lt 30) {
        Start-Sleep -Seconds 2
        $attempts++
        Write-Host "  Esperando Docker Engine ($attempts/30)..." -ForegroundColor Gray
    }
    if (-not (Test-DockerRunning)) {
        throw "Docker Desktop no esta en ejecucion. Inicia Docker Desktop manualmente y reintenta."
    }
    Write-Host "  [OK] Docker Engine en linea" -ForegroundColor Green
}

function Ensure-Prerequisites {
    $repos = @("crm-auth", "crm-collab", "crm-media", "crm-frontend", "crm-marketing")
    foreach ($r in $repos) {
        $path = Join-Path $workspaceRoot $r
        if (-not (Test-Path $path)) {
            throw "Repositorio hermano requerido no encontrado: $path"
        }
    }

    $dockerEnv = Join-Path $infraRoot ".env.docker"
    if (-not (Test-Path $dockerEnv)) {
        Copy-Item (Join-Path $infraRoot ".env.example") $dockerEnv
        Write-Host "  [OK] Creado .env.docker desde .env.example" -ForegroundColor Green
    }

    $missingEnv = $false
    $requiredEnvs = @("crm-auth/.env", "crm-collab/.env", "crm-media/.env", "crm-marketing/.env")
    foreach ($rel in $requiredEnvs) {
        if (-not (Test-Path (Join-Path $workspaceRoot $rel))) { $missingEnv = $true; break }
    }
    if ($missingEnv) {
        Write-Host "[INFO] Generando archivos de entorno faltantes..." -ForegroundColor Cyan
        & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $infraRoot "setup/env.ps1")
    }
}

function Wait-ForStackReady {
    param([int]$MaxSeconds = 90)
    Write-Host "`n[POLL] Verificando estado y salud del ecosistema CIMA CRM..." -ForegroundColor Cyan
    $deadline = (Get-Date).AddSeconds($MaxSeconds)
    $ready = $false

    while ((Get-Date) -lt $deadline) {
        $gwOk = $false
        $feOk = $false
        try {
            $tcpGw = New-Object System.Net.Sockets.TcpClient
            $tcpGw.Connect("127.0.0.1", [int]$gatewayPort)
            $tcpGw.Close()
            $gwOk = $true
        } catch {}

        try {
            $tcpFe = New-Object System.Net.Sockets.TcpClient
            $tcpFe.Connect("127.0.0.1", [int]$frontendPort)
            $tcpFe.Close()
            $feOk = $true
        } catch {}

        if ($gwOk -and $feOk) {
            $ready = $true
            break
        }
        Start-Sleep -Seconds 3
        Write-Host "  ...Esperando inicializacion de Gateway y Frontend..." -ForegroundColor Gray
    }

    if (-not $ready) {
        Write-Host "  [WARN] Los servicios tardaron mas de $MaxSeconds seg en responder en sus puertos." -ForegroundColor Yellow
        Write-Host "         Revisa los logs con: docker compose --env-file .env.docker ps" -ForegroundColor Yellow
    } else {
        Write-Host "  [OK] Todos los servicios principales responden correctamente." -ForegroundColor Green
    }
}

function Show-Summary {
    Write-Host ""
    Write-Host "==========================================================" -ForegroundColor Green
    Write-Host "          CIMA CRM - ECOSISTEMA LOCAL ACTIVO               " -ForegroundColor Green
    Write-Host "==========================================================" -ForegroundColor Green
    Write-Host "  [UI]      Frontend: http://localhost:$frontendPort" -ForegroundColor White
    Write-Host "  [API]     Gateway:  http://localhost:$gatewayPort" -ForegroundColor White
    Write-Host "  [DATA]    Postgres: localhost:$postgresPort" -ForegroundColor White
    Write-Host "  [CACHE]   Redis:    localhost:$redisPort" -ForegroundColor White
    Write-Host "==========================================================" -ForegroundColor Green
    Write-Host "Comandos de utilidad:" -ForegroundColor Cyan
    Write-Host "  .\start-local.ps1 -Status" -ForegroundColor Gray
    Write-Host "  .\start-local.ps1 -Logs [servicio]" -ForegroundColor Gray
    Write-Host "  .\start-local.ps1 -Down" -ForegroundColor Gray
    Write-Host ""
}

try {
    if ($Down) {
        Write-Host "Deteniendo contenedores de CIMA CRM..." -ForegroundColor Yellow
        docker compose --env-file .env.docker down
        exit 0
    }

    if ($Status) {
        docker compose --env-file .env.docker ps
        exit 0
    }

    if ($Logs) {
        docker compose --env-file .env.docker logs -f $Logs
        exit 0
    }

    Ensure-DockerActive
    Ensure-Prerequisites

    if ($Restart) {
        Write-Host "Reiniciando CIMA CRM..." -ForegroundColor Yellow
        docker compose --env-file .env.docker down
    }

    Write-Host "Iniciando CIMA CRM local con Docker Compose..." -ForegroundColor Cyan
    $composeArgs = @("compose", "--env-file", ".env.docker", "up", "-d")
    if (-not $NoBuild) { $composeArgs += "--build" }
    $composeArgs += "--remove-orphans"

    & docker @composeArgs

    if (-not $NoWait) {
        Wait-ForStackReady
    }

    Show-Summary

    if ($OpenBrowser) {
        Start-Process "http://localhost:$frontendPort"
    }

    if ($Interactive) {
        Write-Host ""
        $openPrompt = Read-Host "Deseas abrir CIMA CRM en tu navegador ahora? (s/n)"
        if ($openPrompt -eq "s" -or $openPrompt -eq "S") {
            Start-Process "http://localhost:$frontendPort"
        }
        Read-Host "`nPresiona Enter para cerrar esta consola..."
    }
} catch {
    Write-Host "`n[ERROR CRITICO] $_" -ForegroundColor Red
    if ($Interactive) {
        Read-Host "`nPresiona Enter para cerrar la consola tras el error..."
    }
    exit 1
}
