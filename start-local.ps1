<#
.SYNOPSIS
    Orquestador de levantamiento local de CIMA CRM en Docker con indicador de avance %.
.DESCRIPTION
    Valida dependencias, inicializa variables de entorno, arranca contenedores,
    monitorea la salud de los servicios con porcentaje en tiempo real y ofrece utilidades.
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

function Update-Progress {
    param([int]$Percent, [string]$Message)
    $clamped = [Math]::Min(100, [Math]::Max(0, $Percent))
    $barWidth = 24
    $filled = [int](($clamped / 100) * $barWidth)
    $empty = $barWidth - $filled
    $bar = ("#" * $filled) + ("-" * $empty)
    
    try { $Host.UI.RawUI.WindowTitle = "CIMA CRM [$clamped%] - $Message" } catch {}
    try {
        if ($clamped -ge 100) {
            Write-Progress -Activity "Levantando CIMA CRM" -Completed
        } else {
            Write-Progress -Activity "Levantando CIMA CRM" -Status $Message -PercentComplete $clamped
        }
    } catch {}

    Write-Host ("`r[{0}] {1,3}% | {2}" -f $bar, $clamped, $Message) -ForegroundColor Cyan
}

function Get-DockerEnvVar {
    param([string]$Key, [string]$Fallback)
    $envPath = Join-Path $infraRoot ".env.docker"
    if (Test-Path $envPath) {
        $pattern = "^$([regex]::Escape($Key))=(.*)$"
        $line = Get-Content $envPath | Where-Object { $_ -match $pattern } | Select-Object -First 1
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
        return ($LASTEXITCODE -eq 0)
    } catch {
        return $false
    }
}

function Ensure-DockerActive {
    Update-Progress 5 "Verificando motor Docker..."
    if (Test-DockerRunning) {
        Update-Progress 15 "Motor Docker verificado y activo"
        return
    }
    Write-Host "`n[WARN] Docker Desktop apagado. Intentando arrancar..." -ForegroundColor Yellow
    $dockerExe = "C:\Program Files\Docker\Docker\Docker Desktop.exe"
    if (Test-Path $dockerExe) { Start-Process $dockerExe }
    $attempts = 0
    while (-not (Test-DockerRunning) -and $attempts -lt 30) {
        Start-Sleep -Seconds 2
        $attempts++
        $p = 5 + [int](($attempts / 30) * 10)
        Update-Progress $p "Esperando Docker Engine ($attempts/30)..."
    }
    if (-not (Test-DockerRunning)) {
        throw "Docker Desktop no responde. Inicia Docker manualmente y reintenta."
    }
    Update-Progress 15 "Motor Docker listo"
}

function Ensure-Prerequisites {
    Update-Progress 18 "Validando repositorios del ecosistema..."
    $repos = @("crm-auth", "crm-collab", "crm-media", "crm-frontend", "crm-marketing")
    foreach ($r in $repos) {
        $path = Join-Path $workspaceRoot $r
        if (-not (Test-Path $path)) { throw "Repositorio hermano faltante: $path" }
    }

    $dockerEnv = Join-Path $infraRoot ".env.docker"
    if (-not (Test-Path $dockerEnv)) {
        Copy-Item (Join-Path $infraRoot ".env.example") $dockerEnv
    }

    Update-Progress 22 "Validando archivos de configuracion .env..."
    $missingEnv = $false
    $requiredEnvs = @("crm-auth/.env", "crm-collab/.env", "crm-media/.env", "crm-marketing/.env")
    foreach ($rel in $requiredEnvs) {
        if (-not (Test-Path (Join-Path $workspaceRoot $rel))) { $missingEnv = $true; break }
    }
    if ($missingEnv) {
        Update-Progress 25 "Generando .env desde plantillas..."
        & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $infraRoot "setup/env.ps1")
    }
    Update-Progress 30 "Entorno de desarrollo preparado"
}

function Test-TcpPort {
    param([int]$Port)
    try {
        $tcp = New-Object System.Net.Sockets.TcpClient
        $tcp.Connect("127.0.0.1", $Port)
        $tcp.Close()
        return $true
    } catch {
        return $false
    }
}

function Wait-ForStackReady {
    param([int]$MaxSeconds = 90)
    $deadline = (Get-Date).AddSeconds($MaxSeconds)
    $coreServices = @("postgres_db", "redis", "crm-auth", "crm-collab", "crm-media", "crm-marketing", "api-gateway", "crm-frontend")
    $totalServices = $coreServices.Count

    while ((Get-Date) -lt $deadline) {
        $healthyCount = 0
        try {
            $rawJson = docker compose --env-file .env.docker ps --format json 2>$null
            if ($rawJson) {
                $lines = $rawJson -split "`n" | Where-Object { $_.Trim().Length -gt 0 }
                foreach ($line in $lines) {
                    $c = $line | ConvertFrom-Json
                    if ($coreServices -contains $c.Service) {
                        if ($c.Health -eq "healthy" -or ($c.Service -eq "api-gateway" -and $c.State -eq "running") -or ($c.Service -eq "crm-frontend" -and $c.State -eq "running")) {
                            $healthyCount++
                        }
                    }
                }
            }
        } catch {}

        $gwOk = Test-TcpPort ([int]$gatewayPort)
        $feOk = Test-TcpPort ([int]$frontendPort)
        if ($gwOk) { $healthyCount = [Math]::Max($healthyCount, 7) }
        if ($gwOk -and $feOk) { $healthyCount = 8 }

        $progressCalc = 50 + [int](($healthyCount / $totalServices) * 45)
        Update-Progress $progressCalc "Salud de microservicios: $healthyCount/$totalServices listos..."

        if ($gwOk -and $feOk) {
            Update-Progress 100 "Ecosistema CIMA CRM listo al 100%"
            return
        }
        Start-Sleep -Seconds 2
    }
    Write-Host "`n[WARN] Tiempo limite de espera agotado. Revisa con: .\start-local.ps1 -Status" -ForegroundColor Yellow
}

function Show-Summary {
    Write-Host ""
    Write-Host "==========================================================" -ForegroundColor Green
    Write-Host "     CIMA CRM - ECOSISTEMA LOCAL ACTIVO [100%]           " -ForegroundColor Green
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
        Update-Progress 35 "Reiniciando contenedores..."
        docker compose --env-file .env.docker down
    }

    Update-Progress 40 "Lanzando contenedores con Docker Compose..."
    $composeArgs = @("compose", "--env-file", ".env.docker", "up", "-d")
    if (-not $NoBuild) { $composeArgs += "--build" }
    $composeArgs += "--remove-orphans"
    & docker @composeArgs

    if (-not $NoWait) {
        Wait-ForStackReady
    } else {
        Update-Progress 100 "Contenedores despachados en segundo plano"
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
