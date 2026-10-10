<#
.SYNOPSIS
    Orquestador de levantamiento local de CIMA CRM con soporte de red local y tunel.
.DESCRIPTION
    Arranca contenedores, muestra porcentaje de avance, detecta IP LAN para conexion
    de dispositivos en la misma red y abre tunel seguro HTTPS bajo demanda.
#>
[CmdletBinding()]
param(
    [switch]$Down,
    [switch]$Restart,
    [switch]$Status,
    [switch]$Tunnel,
    [switch]$SkipDbSync,
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

function Get-LanIpAddress {
    try {
        $route = Get-NetRoute -DestinationPrefix "0.0.0.0/0" -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($route) {
            $ip = (Get-NetIPAddress -InterfaceIndex $route.InterfaceIndex -AddressFamily IPv4 -ErrorAction SilentlyContinue).IPAddress
            if ($ip) { return $ip }
        }
    } catch {}
    $all = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object {
        $_.InterfaceAlias -notmatch "Loopback|vEthernet|WSL|VirtualBox" -and $_.IPAddress -notmatch "^127\.|^169\.254\."
    } | Select-Object -ExpandProperty IPAddress -First 1
    if ($all) { return $all }
    return "127.0.0.1"
}

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

function Start-Tunnel {
    param([int]$Port)
    $cfExe = Join-Path $workspaceRoot ".tools\cloudflared.exe"
    if (-not (Test-Path $cfExe)) {
        $toolsDir = Split-Path -Parent $cfExe
        if (-not (Test-Path $toolsDir)) { New-Item -ItemType Directory -Path $toolsDir | Out-Null }
        Write-Host "`n[TUNNEL] Descargando cliente de tunel seguro..." -ForegroundColor Cyan
        Invoke-WebRequest -Uri "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe" -OutFile $cfExe
    }

    $logFile = Join-Path $env:TEMP "cima_tunnel_$(Get-Random).log"
    $proc = Start-Process -FilePath $cfExe -ArgumentList "tunnel", "--url", "http://localhost:$Port" -RedirectStandardError $logFile -PassThru -NoNewWindow
    $tunnelUrl = $null
    for ($i = 0; $i -lt 15; $i++) {
        Start-Sleep -Seconds 1
        if (Test-Path $logFile) {
            $content = Get-Content $logFile -Raw
            if ($content -match '(https://[a-zA-Z0-9-]+\.trycloudflare\.com)') {
                $tunnelUrl = $matches[1]
                break
            }
        }
    }
    return @{ Url = $tunnelUrl; Process = $proc }
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
    param([string]$TunnelUrl)
    $lanIp = Get-LanIpAddress
    Write-Host ""
    Write-Host "==========================================================" -ForegroundColor Green
    Write-Host "       CIMA CRM - ACCESO LOCAL Y MULTI-DISPOSITIVO        " -ForegroundColor Green
    Write-Host "==========================================================" -ForegroundColor Green
    Write-Host "  [ESTE EQUIPO]  http://localhost:$frontendPort" -ForegroundColor White
    Write-Host "  [RED LOCAL]    http://${lanIp}:${frontendPort} (Misma red Wi-Fi)" -ForegroundColor Yellow
    if ($TunnelUrl) {
        Write-Host "  [TUNEL HTTPS]  $TunnelUrl" -ForegroundColor Cyan
        Write-Host "                 (Acceso desde celulares, tablets o remoto)" -ForegroundColor Gray
    }
    Write-Host "  [GATEWAY API]  http://localhost:$gatewayPort" -ForegroundColor White
    Write-Host "  [POSTGRES]     localhost:$postgresPort" -ForegroundColor White
    Write-Host "  [REDIS]        localhost:$redisPort" -ForegroundColor White
    Write-Host "==========================================================" -ForegroundColor Green
    Write-Host "Para conectar un celular o tablet en tu misma red Wi-Fi:" -ForegroundColor Cyan
    Write-Host "  Abre en su navegador: http://${lanIp}:${frontendPort}" -ForegroundColor Gray
    if ($TunnelUrl) {
        Write-Host "  O utiliza el enlace seguro HTTPS: $TunnelUrl" -ForegroundColor Gray
    }
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

    if (-not $SkipDbSync) {
        Update-Progress 45 "Sincronizando base de datos desde produccion..."
        $syncScript = Join-Path $infraRoot "scripts\sync-prod-db.ps1"
        if (Test-Path $syncScript) {
            & $syncScript -Quiet
        }
    }

    if (-not $NoWait) {
        Wait-ForStackReady
    } else {
        Update-Progress 100 "Contenedores despachados en segundo plano"
    }

    $activeTunnel = $null
    if ($Tunnel -or $Interactive) {
        $shouldTunnel = $Tunnel
        if (-not $shouldTunnel -and $Interactive) {
            Write-Host ""
            $ans = Read-Host "Deseas abrir un tunel para acceder desde celulares y otros dispositivos? (s/n)"
            if ($ans -eq "s" -or $ans -eq "S") { $shouldTunnel = $true }
        }
        if ($shouldTunnel) {
            Write-Host "`n[TUNNEL] Creando tunel HTTPS seguro..." -ForegroundColor Cyan
            $activeTunnel = Start-Tunnel ([int]$frontendPort)
        }
    }

    Show-Summary -TunnelUrl $activeTunnel.Url

    if ($OpenBrowser) {
        Start-Process "http://localhost:$frontendPort"
    }

    if ($Interactive) {
        Write-Host ""
        $openPrompt = Read-Host "Deseas abrir CIMA CRM en este equipo ahora? (s/n)"
        if ($openPrompt -eq "s" -or $openPrompt -eq "S") {
            Start-Process "http://localhost:$frontendPort"
        }
        Read-Host "`nPresiona Enter para cerrar esta consola..."
        if ($activeTunnel.Process) {
            Stop-Process -Id $activeTunnel.Process.Id -Force -ErrorAction SilentlyContinue
        }
    }
} catch {
    Write-Host "`n[ERROR CRITICO] $_" -ForegroundColor Red
    if ($Interactive) {
        Read-Host "`nPresiona Enter para cerrar la consola tras el error..."
    }
    exit 1
}
