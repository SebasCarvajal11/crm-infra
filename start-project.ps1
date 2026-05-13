## start-project.ps1
# =========================================================
# CIMA CRM - Arranque local (Windows)
# Levanta:
#   - Docker (Postgres, Redis, KrakenD)
#   - mod-auth
#   - crm-frontend
#
# Uso:
#   .\start-project.ps1
#   o doble clic en start-project.cmd
# =========================================================

$ErrorActionPreference = 'Stop'
$Root = $PSScriptRoot

function Write-Step($msg) {
    Write-Host ""
    Write-Host "==> $msg" -ForegroundColor Cyan
}

function Test-Command($command, $message) {
    if (-not (Get-Command $command -ErrorAction SilentlyContinue)) {
        Write-Host ""
        Write-Host "ERROR: $message" -ForegroundColor Red
        exit 1
    }
}

function Start-NpmProject($path, $command, $name) {

    if (-not (Test-Path $path)) {
        Write-Host "Advertencia: carpeta no encontrada -> $path" -ForegroundColor Yellow
        return
    }

    if (-not (Test-Path (Join-Path $path 'package.json'))) {
        Write-Host "Advertencia: package.json no encontrado en $path" -ForegroundColor Yellow
        return
    }

    Write-Step "Abriendo $name ($command)..."

    Start-Process powershell.exe `
        -WorkingDirectory $path `
        -ArgumentList '-NoExit', '-ExecutionPolicy', 'Bypass', '-Command', $command
}

# =========================================================
# Inicio
# =========================================================

Write-Host ""
Write-Host "CIMA CRM � arranque local (Windows)" -ForegroundColor Green

# =========================================================
# Validaciones
# =========================================================

Write-Step "Validando herramientas instaladas..."

Test-Command "node" "Node.js no est� instalado o no est� en PATH."
Test-Command "npm" "npm no est� instalado o no est� en PATH."
Test-Command "docker" "Docker no est� instalado o no est� en PATH."

# =========================================================
# Generar krakend.json
# =========================================================

$buildScript = Join-Path $Root 'gateway\build-krakend.mjs'

if (Test-Path $buildScript) {

    Write-Step "Generando krakend.json desde templates..."

    try {
        node $buildScript
    }
    catch {
        Write-Host "Advertencia: no se pudo ejecutar build-krakend.mjs." -ForegroundColor Yellow
        Write-Host "Se usar� el krakend.json existente." -ForegroundColor Yellow
    }
}

# =========================================================
# Docker Compose
# =========================================================

Write-Step "Levantando contenedores Docker..."

$composeFile = Join-Path $Root 'docker-compose.yml'

if (-not (Test-Path $composeFile)) {
    Write-Host "ERROR: No se encontr� docker-compose.yml en:" -ForegroundColor Red
    Write-Host $Root -ForegroundColor Yellow
    exit 1
}

try {

    docker compose -f $composeFile up -d

    if ($LASTEXITCODE -ne 0) {
        throw "Docker Compose fall�."
    }

}
catch {
    Write-Host ""
    Write-Host "ERROR al iniciar Docker Compose." -ForegroundColor Red
    Write-Host "Verifica que Docker Desktop est� abierto." -ForegroundColor Yellow
    throw
}

# =========================================================
# Esperar Docker
# =========================================================

Write-Step "Esperando a que Docker responda..."

$dockerReady = $false

for ($i = 0; $i -lt 15; $i++) {

    docker ps > $null 2>&1

    if ($LASTEXITCODE -eq 0) {
        $dockerReady = $true
        break
    }

    Start-Sleep -Seconds 2
}

if (-not $dockerReady) {
    Write-Host "Docker no respondi� a tiempo." -ForegroundColor Yellow
}

# =========================================================
# mod-auth
# =========================================================

$modAuth = Join-Path $Root 'mod-auth'

Start-NpmProject `
    -path $modAuth `
    -command 'npm start' `
    -name 'mod-auth'

Start-Sleep -Seconds 1

# =========================================================
# Frontend
# =========================================================

$frontend = Join-Path $Root 'crm-frontend'

Start-NpmProject `
    -path $frontend `
    -command 'npm run dev' `
    -name 'crm-frontend'

# =========================================================
# Final
# =========================================================

Write-Host ""
Write-Host "=========================================" -ForegroundColor DarkGray
Write-Host "Listo." -ForegroundColor Green
Write-Host "=========================================" -ForegroundColor DarkGray
Write-Host ""
Write-Host "API Gateway:    http://localhost:8080/health" -ForegroundColor Gray
Write-Host "mod-auth:       http://localhost:3000" -ForegroundColor Gray
Write-Host "Frontend:       http://localhost:5173" -ForegroundColor Gray
Write-Host ""
Write-Host "Cierra las ventanas de PowerShell para detener los servicios." -ForegroundColor DarkGray
Write-Host ""
