$ErrorActionPreference = 'Stop'
$Root = $PSScriptRoot

function Write-Step([string]$Message) {
  Write-Host ""
  Write-Host "==> $Message" -ForegroundColor Cyan
}

function Assert-Command([string]$Name, [string]$ErrorMessage) {
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    Write-Host "" 
    Write-Host "ERROR: $ErrorMessage" -ForegroundColor Red
    exit 1
  }
}

function Start-ProjectProcess([string]$Path, [string]$Command, [string]$Name) {
  if (-not (Test-Path $Path)) {
    Write-Host "Advertencia: carpeta no encontrada -> $Path" -ForegroundColor Yellow
    return
  }

  if (-not (Test-Path (Join-Path $Path 'package.json'))) {
    Write-Host "Advertencia: package.json no encontrado en -> $Path" -ForegroundColor Yellow
    return
  }

  Write-Step "Abriendo $Name ($Command)"

  Start-Process powershell.exe `
    -WorkingDirectory $Path `
    -ArgumentList '-NoExit', '-ExecutionPolicy', 'Bypass', '-Command', $Command
}

function Test-ServiceHealthy([string]$Url) {
  try {
    $res = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 2
    return ($res.StatusCode -ge 200 -and $res.StatusCode -lt 300)
  } catch {
    return $false
  }
}

function Prepare-PnpmProject([string]$Path, [string]$Name) {
  if (-not (Test-Path $Path)) { return }
  if (-not (Test-Path (Join-Path $Path 'package.json'))) { return }

  Write-Step "Preparando dependencias de $Name (pnpm approve-builds --all)"
  Push-Location $Path
  try {
    pnpm approve-builds --all | Out-Null
  } catch {
    Write-Host "Advertencia: no se pudo aprobar builds en $Name. Se intentara arrancar igual." -ForegroundColor Yellow
  } finally {
    Pop-Location
  }
}

function Test-HttpEndpoint([string]$Url, [int]$Attempts = 20, [int]$DelaySeconds = 2) {
  for ($i = 0; $i -lt $Attempts; $i++) {
    try {
      $res = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 3
      if ($res.StatusCode -ge 200 -and $res.StatusCode -lt 500) {
        return $true
      }
    } catch {
      Start-Sleep -Seconds $DelaySeconds
      continue
    }
    Start-Sleep -Seconds $DelaySeconds
  }
  return $false
}

Write-Host ""
Write-Host "CIMA CRM - arranque local (Windows)" -ForegroundColor Green

Write-Step "Validando herramientas instaladas"
Assert-Command 'node' 'Node.js no esta instalado o no esta en PATH.'
Assert-Command 'pnpm' 'pnpm no esta instalado o no esta en PATH.'
Assert-Command 'docker' 'Docker no esta instalado o no esta en PATH.'

Write-Step "Validando Docker Desktop"
docker info > $null 2>&1
if ($LASTEXITCODE -ne 0) {
  Write-Host "ERROR: Docker no responde. Abre Docker Desktop y vuelve a intentar." -ForegroundColor Red
  exit 1
}

$buildScript = Join-Path $Root 'gateway\build-krakend.mjs'
if (Test-Path $buildScript) {
  Write-Step "Generando krakend.json desde templates"
  try {
    node $buildScript
  } catch {
    Write-Host "Advertencia: no se pudo ejecutar build-krakend.mjs. Se usara el krakend.json existente." -ForegroundColor Yellow
  }
}

Write-Step "Levantando contenedores Docker"
$composeFile = Join-Path $Root 'docker-compose.yml'
if (-not (Test-Path $composeFile)) {
  Write-Host "ERROR: No se encontro docker-compose.yml en $Root" -ForegroundColor Red
  exit 1
}

docker compose -f $composeFile up -d
if ($LASTEXITCODE -ne 0) {
  Write-Host "ERROR: Docker Compose fallo." -ForegroundColor Red
  exit 1
}

Write-Step "Reiniciando api-gateway para recargar krakend.json"
docker compose -f $composeFile restart api-gateway | Out-Null

Write-Step "Esperando gateway (http://localhost:8080/health)"
if (-not (Test-HttpEndpoint -Url 'http://localhost:8080/health' -Attempts 30 -DelaySeconds 2)) {
  Write-Host "Advertencia: gateway aun no responde en /health. Continuando con servicios locales." -ForegroundColor Yellow
}

$modAuth = Join-Path $Root 'mod-auth'
$modCollab = Join-Path $Root 'mod-collab'
$frontend = Join-Path $Root 'crm-frontend'

Prepare-PnpmProject -Path $modAuth -Name 'mod-auth'
Prepare-PnpmProject -Path $modCollab -Name 'mod-collab'
Prepare-PnpmProject -Path $frontend -Name 'crm-frontend'

if (Test-ServiceHealthy -Url 'http://localhost:3000/health') {
  Write-Host "mod-auth ya esta activo en :3000. Se omite segunda instancia." -ForegroundColor Yellow
} else {
  Start-ProjectProcess -Path $modAuth -Command 'pnpm dev' -Name 'mod-auth'
  Start-Sleep -Seconds 1
}

if (Test-ServiceHealthy -Url 'http://localhost:3001/health') {
  Write-Host "mod-collab ya esta activo en :3001. Se omite segunda instancia." -ForegroundColor Yellow
} else {
  Start-ProjectProcess -Path $modCollab -Command 'pnpm dev' -Name 'mod-collab'
  Start-Sleep -Seconds 1
}

if (Test-ServiceHealthy -Url 'http://localhost:5173') {
  Write-Host "crm-frontend ya esta activo en :5173. Se omite segunda instancia." -ForegroundColor Yellow
} else {
  Start-ProjectProcess -Path $frontend -Command 'pnpm dev' -Name 'crm-frontend'
}

Write-Host ""
Write-Host "=========================================" -ForegroundColor DarkGray
Write-Host "Listo." -ForegroundColor Green
Write-Host "=========================================" -ForegroundColor DarkGray
Write-Host ""
Write-Host "Gateway:         http://localhost:8080/health" -ForegroundColor Gray
Write-Host "mod-auth:        http://localhost:3000" -ForegroundColor Gray
Write-Host "mod-collab:      http://localhost:3001/health" -ForegroundColor Gray
Write-Host "Frontend:        http://localhost:5173" -ForegroundColor Gray
Write-Host ""
Write-Host "Cierra las ventanas de PowerShell para detener los servicios." -ForegroundColor DarkGray
Write-Host ""
