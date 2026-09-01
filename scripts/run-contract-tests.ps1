#Requires -Version 5.1
$ErrorActionPreference = "Stop"
# Los chequeos de disponibilidad usan comandos nativos que pueden devolver un
# estado transitorio distinto de cero; se evalúan explícitamente con LASTEXITCODE.
$PSNativeCommandUseErrorActionPreference = $false

$Root = Split-Path -Parent $PSScriptRoot
$WorkspaceRoot = Split-Path -Parent $Root
$ComposeFile = Join-Path $Root "docker-compose.yml"
$env:COMPOSE_PROJECT_NAME = if ($env:CIMA_CONTRACT_COMPOSE_PROJECT) { $env:CIMA_CONTRACT_COMPOSE_PROJECT } else { "cima-crm-contract" }
$env:POSTGRES_HOST_PORT = if ($env:CIMA_CONTRACT_POSTGRES_HOST_PORT) { $env:CIMA_CONTRACT_POSTGRES_HOST_PORT } else { "35432" }
$env:REDIS_HOST_PORT = if ($env:CIMA_CONTRACT_REDIS_HOST_PORT) { $env:CIMA_CONTRACT_REDIS_HOST_PORT } else { "36379" }
$env:CLAMAV_HOST_PORT = if ($env:CIMA_CONTRACT_CLAMAV_HOST_PORT) { $env:CIMA_CONTRACT_CLAMAV_HOST_PORT } else { "33310" }
$env:GATEWAY_HOST_PORT = if ($env:CIMA_CONTRACT_GATEWAY_HOST_PORT) { $env:CIMA_CONTRACT_GATEWAY_HOST_PORT } else { "38080" }
$env:FRONTEND_HOST_PORT = if ($env:CIMA_CONTRACT_FRONTEND_HOST_PORT) { $env:CIMA_CONTRACT_FRONTEND_HOST_PORT } else { "35173" }
$GatewayHealthUrl = "http://localhost:$($env:GATEWAY_HOST_PORT)/api/v1/health"
$env:CONTRACT_BASE_URL = "http://localhost:$($env:GATEWAY_HOST_PORT)"

function Invoke-ContractCompose {
  param(
    [Parameter(Mandatory = $true)][string[]]$ComposeArguments,
    [switch]$AllowFailure
  )

  & docker compose -p $env:COMPOSE_PROJECT_NAME -f $ComposeFile --env-file (Join-Path $Root ".env.docker") @ComposeArguments
  if (-not $AllowFailure -and $LASTEXITCODE -ne 0) {
    throw "docker compose $($ComposeArguments -join ' ') falló con código $LASTEXITCODE"
  }
}

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

function Wait-PostgresReady([int]$Attempts = 30, [int]$DelaySeconds = 2) {
  $lastStartTime = $null
  for ($i = 0; $i -lt $Attempts; $i++) {
    $previousErrorActionPreference = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    $state = Invoke-ContractCompose -AllowFailure -ComposeArguments @("exec", "-T", "postgres_db", "psql", "-U", "root", "-d", "crm_database", "-Atc", "SELECT pg_postmaster_start_time(), count(*) FROM pg_roles WHERE rolname IN ('auth_user', 'collab_user', 'media_user', 'marketing_user');") 2>$null
    $commandExitCode = $LASTEXITCODE
    $ErrorActionPreference = $previousErrorActionPreference
    if ($commandExitCode -eq 0 -and $state -match '^(.+)\|4$') {
      $startTime = $Matches[1]
      if ($lastStartTime -eq $startTime) {
        return
      }
      $lastStartTime = $startTime
    } else {
      $lastStartTime = $null
    }
    if ($i -lt $Attempts - 1) {
      Start-Sleep -Seconds $DelaySeconds
    }
  }
  throw "PostgreSQL no alcanzó un estado estable después de ejecutar sus scripts de inicialización"
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
Invoke-ContractCompose -ComposeArguments @("down", "-v")

# 2. Levantar sólo las dependencias de datos. El esquema y las semillas deben
# existir antes de iniciar servicios que puedan tocar roles o tablas al arrancar.
Write-Host "[2/5] Levantando PostgreSQL y Redis efímeros..." -ForegroundColor Yellow
Invoke-ContractCompose -ComposeArguments @("up", "-d", "postgres_db", "redis")
Wait-PostgresReady

# 3. Aprovisionamiento de base de datos (bootstrap, migrate, seed)
Write-Host "[3/5] Aprovisionando bases de datos y ejecutando semillas..." -ForegroundColor Yellow
$dbScript = Join-Path $Root "setup/db.ps1"
powershell -NoProfile -ExecutionPolicy Bypass -File $dbScript
if ($LASTEXITCODE -ne 0) {
  throw "El aprovisionamiento de la base de datos falló con código $LASTEXITCODE"
}

# 4. Levantar el stack completo sólo después del aprovisionamiento.
Write-Host "[4/5] Levantando infraestructura efímera..." -ForegroundColor Yellow
Invoke-ContractCompose -ComposeArguments @("up", "-d", "--build")

# 5. Esperar a que el API Gateway esté saludable
Write-Host "[5/5] Esperando a que el API Gateway esté saludable en $GatewayHealthUrl..." -ForegroundColor Yellow
Wait-HttpOk $GatewayHealthUrl
Write-Host "  [OK] API Gateway saludable." -ForegroundColor Green

# 6. Ejecutar suites de contrato de cada servicio
Write-Host "[5/5] Ejecutando pruebas de contrato por servicio..." -ForegroundColor Yellow

$authRepo = Resolve-RepoPath -EnvVarName "CIMA_AUTH_PATH" -SiblingName "crm-auth"
$collabRepo = Resolve-RepoPath -EnvVarName "CIMA_COLLAB_PATH" -SiblingName "crm-collab"
$mediaRepo = Resolve-RepoPath -EnvVarName "CIMA_MEDIA_PATH" -SiblingName "crm-media"

$failed = $false
$errors = @()

try {
  Write-Host ""
  Write-Host ">> Ejecutando pruebas de contrato: crm-auth" -ForegroundColor Cyan
  Invoke-InRepo $authRepo "crm-auth" {
    hurl --test --variable "base_url=$env:CONTRACT_BASE_URL" --variable "TEST_SUFFIX=contract_$([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds())" tests/09_auth_gateway.hurl tests/13_email_gateway_flows.hurl
  }
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
  Invoke-InRepo $mediaRepo "crm-media" { hurl --test --variable "base_url=$env:CONTRACT_BASE_URL" --variable "WORKER_EMAIL=ana.martinez@cima.dev" --variable "WORKER_PASSWORD=Demo123!" tests/01_media_gateway.hurl }
  Write-Host "  [PASS] crm-media contratos OK." -ForegroundColor Green
} catch {
  $failed = $true
  $errors += "crm-media: $_"
  Write-Host "  [FAIL] crm-media contratos fallaron." -ForegroundColor Red
}


# 6. Limpieza final. CIMA_CONTRACT_KEEP_ARTIFACTS=1 conserva el entorno sólo
# para diagnóstico explícito de una ejecución fallida.
Write-Host ""
if ($env:CIMA_CONTRACT_KEEP_ARTIFACTS -eq "1") {
  Write-Host "Conservando entorno efímero para diagnóstico explícito." -ForegroundColor Yellow
} else {
  Write-Host "Finalizando y limpiando contenedores efímeros..." -ForegroundColor Yellow
  Invoke-ContractCompose -ComposeArguments @("down", "-v")
}

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
