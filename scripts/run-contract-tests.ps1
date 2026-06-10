#Requires -Version 5.1
$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $PSScriptRoot
$WorkspaceRoot = Split-Path -Parent $Root
$ComposeFile = Join-Path $Root "docker-compose.yml"
$env:GATEWAY_HOST_PORT = if ($env:GATEWAY_HOST_PORT) { $env:GATEWAY_HOST_PORT } else { "28080" }
$GatewayHealthUrl = "http://localhost:$($env:GATEWAY_HOST_PORT)/api/v1/health"

function Resolve-RepoPath([string]$EnvVarName, [string]$SiblingName) {
  $configured = [Environment]::GetEnvironmentVariable($EnvVarName, "Process")
  if (-not $configured) { $configured = [Environment]::GetEnvironmentVariable($EnvVarName, "User") }
  if (-not $configured) { $configured = [Environment]::GetEnvironmentVariable($EnvVarName, "Machine") }

  $candidates = @()
  if ($configured) { $candidates += $configured }
  $candidates += (Join-Path $WorkspaceRoot $SiblingName)

  foreach ($candidate in $candidates) {
    if (-not $candidate) { continue }
    if (-not (Test-Path $candidate)) { continue }
    $resolved = (Resolve-Path $candidate).Path
    if (Test-Path (Join-Path $resolved "package.json")) {
      return $resolved
    }
  }
  return $null
}

function Wait-HttpOk([string]$Url, [int]$Attempts = 30, [int]$DelaySeconds = 2) {
  for ($i = 0; $i -lt $Attempts; $i++) {
    try {
      $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 5
      if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 300) {
        return
      }
    } catch {}
    Start-Sleep -Seconds $DelaySeconds
  }
  throw "No hubo respuesta satisfactoria desde $Url"
}

function Invoke-InRepo([string]$RepoPath, [string]$Label, [scriptblock]$Action) {
  if (-not $RepoPath) {
    throw "No se resolvió la ruta para $Label"
  }

  Push-Location $RepoPath
  try {
    & $Action
    if ($LASTEXITCODE -ne 0) {
      throw "$Label falló con código $LASTEXITCODE"
    }
  } finally {
    Pop-Location
  }
}

Write-Host ""
Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "Iniciando Suite de Pruebas de Contrato (CIMA CRM)" -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan

# 1. Limpieza y apagado previo
Write-Host "[1/5] Deteniendo contenedores y limpiando volúmenes previos..." -ForegroundColor Yellow
docker compose -f $ComposeFile --env-file (Join-Path $Root ".env.docker") down -v

# 2. Levantar stack limpio
Write-Host "[2/5] Levantando infraestructura efímera..." -ForegroundColor Yellow
docker compose -f $ComposeFile --env-file (Join-Path $Root ".env.docker") up -d --build

# 3. Esperar a que el API Gateway esté saludable
Write-Host "[3/5] Esperando a que el API Gateway esté saludable en $GatewayHealthUrl..." -ForegroundColor Yellow
Wait-HttpOk $GatewayHealthUrl
Write-Host "  [OK] API Gateway saludable." -ForegroundColor Green

# 4. Aprovisionamiento de base de datos (bootstrap, migrate, seed)
Write-Host "[4/5] Aprovisionando bases de datos y ejecutando semillas..." -ForegroundColor Yellow
$dbScript = Join-Path $Root "setup/db.ps1"
$env:POSTGRES_HOST_PORT = "25432" # Alineado con .env.docker
powershell -NoProfile -ExecutionPolicy Bypass -File $dbScript

# 5. Ejecutar suites de contrato de cada servicio
Write-Host "[5/5] Ejecutando pruebas de contrato por servicio..." -ForegroundColor Yellow

$authRepo = Resolve-RepoPath -EnvVarName "CIMA_AUTH_PATH" -SiblingName "crm-auth"
$collabRepo = Resolve-RepoPath -EnvVarName "CIMA_COLLAB_PATH" -SiblingName "crm-collab"
$mediaRepo = Resolve-RepoPath -EnvVarName "CIMA_MEDIA_PATH" -SiblingName "crm-media"

$failed = $false
$errors = @()

try {
  Write-Host ""
  Write-Host ">> Ejecutando pruebas de contrato: crm-auth" -ForegroundColor Cyan
  Invoke-InRepo $authRepo "crm-auth" { pnpm test:contract }
  Write-Host "  [PASS] crm-auth contratos OK." -ForegroundColor Green
} catch {
  $failed = $true
  $errors += "crm-auth: $_"
  Write-Host "  [FAIL] crm-auth contratos fallaron." -ForegroundColor Red
}

try {
  Write-Host ""
  Write-Host ">> Ejecutando pruebas de contrato: crm-collab" -ForegroundColor Cyan
  Invoke-InRepo $collabRepo "crm-collab" { pnpm test:contract }
  Write-Host "  [PASS] crm-collab contratos OK." -ForegroundColor Green
} catch {
  $failed = $true
  $errors += "crm-collab: $_"
  Write-Host "  [FAIL] crm-collab contratos fallaron." -ForegroundColor Red
}

try {
  Write-Host ""
  Write-Host ">> Ejecutando pruebas de contrato: crm-media" -ForegroundColor Cyan
  Invoke-InRepo $mediaRepo "crm-media" { pnpm test:contract }
  Write-Host "  [PASS] crm-media contratos OK." -ForegroundColor Green
} catch {
  $failed = $true
  $errors += "crm-media: $_"
  Write-Host "  [FAIL] crm-media contratos fallaron." -ForegroundColor Red
}


# 6. Limpieza final
Write-Host ""
Write-Host "Finalizando y limpiando contenedores efímeros..." -ForegroundColor Yellow
docker compose -f $ComposeFile --env-file (Join-Path $Root ".env.docker") down -v

Write-Host ""
if ($failed) {
  Write-Host "==========================================================" -ForegroundColor Red
  Write-Host "FALLO: Algunas suites de contrato fallaron:" -ForegroundColor Red
  foreach ($err in $errors) {
    Write-Host "  - $err" -ForegroundColor Red
  }
  Write-Host "==========================================================" -ForegroundColor Red
  exit 1
} else {
  Write-Host "==========================================================" -ForegroundColor Green
  Write-Host "ÉXITO: Todas las pruebas de contrato pasaron exitosamente." -ForegroundColor Green
  Write-Host "==========================================================" -ForegroundColor Green
  exit 0
}
