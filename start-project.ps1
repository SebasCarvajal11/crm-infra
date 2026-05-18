$ErrorActionPreference = "Stop"
$Root = $PSScriptRoot
$WorkspaceRoot = Split-Path -Parent $Root
$ComposeProjectName = if ($env:COMPOSE_PROJECT_NAME) { $env:COMPOSE_PROJECT_NAME } else { "crm_infra_local" }
$GatewayHostPort = if ($env:GATEWAY_HOST_PORT) { $env:GATEWAY_HOST_PORT } else { "18080" }
$PostgresHostPort = if ($env:POSTGRES_HOST_PORT) { $env:POSTGRES_HOST_PORT } else { "15432" }
$RedisHostPort = if ($env:REDIS_HOST_PORT) { $env:REDIS_HOST_PORT } else { "16379" }
$ClamavHostPort = if ($env:CLAMAV_HOST_PORT) { $env:CLAMAV_HOST_PORT } else { "13310" }
$FrontendPort = if ($env:FRONTEND_PORT) { $env:FRONTEND_PORT } else { "5173" }
$GatewayTrustSecret = "cima-local-gateway-trust-secret-do-not-use-production-2026"

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

function Resolve-RepoPath([string]$EnvVarName, [string]$SiblingName) {
  $configured = [Environment]::GetEnvironmentVariable($EnvVarName, "Process")
  if (-not $configured) { $configured = [Environment]::GetEnvironmentVariable($EnvVarName, "User") }
  if (-not $configured) { $configured = [Environment]::GetEnvironmentVariable($EnvVarName, "Machine") }

  $candidates = @()
  if ($configured) {
    $candidates += $configured
  }
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

function Resolve-LegacyModulePath([string]$ModuleFolderName) {
  $direct = Join-Path $WorkspaceRoot $ModuleFolderName
  if (Test-Path (Join-Path $direct "package.json")) {
    return (Resolve-Path $direct).Path
  }

  $workspaceChildren = Get-ChildItem $WorkspaceRoot -Directory -ErrorAction SilentlyContinue
  foreach ($child in $workspaceChildren) {
    $candidate = Join-Path $child.FullName $ModuleFolderName
    if (Test-Path (Join-Path $candidate "package.json")) {
      return (Resolve-Path $candidate).Path
    }
  }

  return $null
}

function Set-EnvKey([string]$EnvFilePath, [string]$Key, [string]$Value) {
  $lines = @()
  if (Test-Path $EnvFilePath) {
    $lines = Get-Content $EnvFilePath
  }

  $pattern = "^\s*" + [regex]::Escape($Key) + "\s*="
  $updated = $false
  for ($i = 0; $i -lt $lines.Count; $i++) {
    if ($lines[$i] -match $pattern) {
      $lines[$i] = "$Key=$Value"
      $updated = $true
      break
    }
  }

  if (-not $updated) {
    $lines += "$Key=$Value"
  }

  Set-Content -LiteralPath $EnvFilePath -Value $lines
}

function Ensure-EnvFile([string]$RepoPath, [string]$LegacyModuleFolderName, [scriptblock]$Normalizer) {
  if (-not $RepoPath) { return }
  if (-not (Test-Path $RepoPath)) { return }

  $envFile = Join-Path $RepoPath ".env"
  if (-not (Test-Path $envFile)) {
    $legacyModulePath = Resolve-LegacyModulePath $LegacyModuleFolderName
    $legacyEnv = if ($legacyModulePath) { Join-Path $legacyModulePath ".env" } else { $null }
    $envExample = Join-Path $RepoPath ".env.example"

    if ($legacyEnv -and (Test-Path $legacyEnv)) {
      Copy-Item -LiteralPath $legacyEnv -Destination $envFile
      Write-Host "Bootstrap .env desde monorepo: $LegacyModuleFolderName" -ForegroundColor Gray
    } elseif (Test-Path $envExample) {
      Copy-Item -LiteralPath $envExample -Destination $envFile
      Write-Host "Bootstrap .env desde .env.example: $RepoPath" -ForegroundColor Yellow
    } else {
      Write-Host "Advertencia: no se pudo generar .env para $RepoPath" -ForegroundColor Yellow
      return
    }
  }

  if ($Normalizer) {
    & $Normalizer $envFile
  }
}

function Start-ProjectProcess([string]$Path, [string]$Command, [string]$Name) {
  if (-not $Path) {
    Write-Host "Advertencia: ruta no configurada para $Name." -ForegroundColor Yellow
    return
  }

  if (-not (Test-Path $Path)) {
    Write-Host "Advertencia: carpeta no encontrada -> $Path" -ForegroundColor Yellow
    return
  }

  if (-not (Test-Path (Join-Path $Path "package.json"))) {
    Write-Host "Advertencia: package.json no encontrado en -> $Path" -ForegroundColor Yellow
    return
  }

  Write-Step "Abriendo $Name ($Command)"

  Start-Process powershell.exe `
    -WindowStyle Hidden `
    -WorkingDirectory $Path `
    -ArgumentList "-NoExit", "-ExecutionPolicy", "Bypass", "-Command", $Command
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
  if (-not $Path) { return }
  if (-not (Test-Path $Path)) { return }
  if (-not (Test-Path (Join-Path $Path "package.json"))) { return }

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

function Invoke-PnpmCommand([string]$Path, [string]$Name, [string]$Command) {
  if (-not $Path) { return }
  if (-not (Test-Path $Path)) { return }
  if (-not (Test-Path (Join-Path $Path "package.json"))) { return }

  Write-Step "$Name -> pnpm $Command"
  Push-Location $Path
  try {
    pnpm $Command
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

function Wait-TcpPort([string]$Host, [int]$Port, [int]$Attempts = 30, [int]$DelaySeconds = 2) {
  for ($i = 0; $i -lt $Attempts; $i++) {
    try {
      $client = New-Object System.Net.Sockets.TcpClient
      $async = $client.BeginConnect($Host, $Port, $null, $null)
      $connected = $async.AsyncWaitHandle.WaitOne(2000, $false)
      if ($connected -and $client.Connected) {
        $client.EndConnect($async)
        $client.Close()
        return $true
      }
      $client.Close()
    } catch {}
    Start-Sleep -Seconds $DelaySeconds
  }
  return $false
}

function Get-EnvValue([string]$EnvFilePath, [string]$Key) {
  if (-not (Test-Path $EnvFilePath)) { return $null }

  $match = Select-String -Path $EnvFilePath -Pattern "^\s*$Key\s*=\s*(.+)\s*$" | Select-Object -First 1
  if (-not $match) { return $null }

  $value = $match.Matches[0].Groups[1].Value.Trim()
  if ($value.StartsWith('"') -and $value.EndsWith('"')) {
    return $value.Trim('"')
  }
  return $value
}

function Test-WorkerRunning([string]$CommandMarker) {
  $procs = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -and $_.CommandLine -like "*$CommandMarker*" }
  return [bool]($procs | Select-Object -First 1)
}

Write-Host ""
Write-Host "CRM Infra - arranque local (Windows)" -ForegroundColor Green

Write-Step "Validando herramientas instaladas"
Assert-Command "node" "Node.js no esta instalado o no esta en PATH."
Assert-Command "pnpm" "pnpm no esta instalado o no esta en PATH."
Assert-Command "docker" "Docker no esta instalado o no esta en PATH."

Write-Step "Resolviendo repos externos"
$modAuth = Resolve-RepoPath -EnvVarName "CIMA_AUTH_PATH" -SiblingName "crm-auth"
$modCollab = Resolve-RepoPath -EnvVarName "CIMA_COLLAB_PATH" -SiblingName "crm-collab"
$modMedia = Resolve-RepoPath -EnvVarName "CIMA_MEDIA_PATH" -SiblingName "crm-media"
$frontend = Resolve-RepoPath -EnvVarName "CIMA_FRONTEND_PATH" -SiblingName "crm-frontend"

$modAuthLabel = if ($modAuth) { $modAuth } else { "[no encontrado]" }
$modCollabLabel = if ($modCollab) { $modCollab } else { "[no encontrado]" }
$modMediaLabel = if ($modMedia) { $modMedia } else { "[no encontrado]" }
$frontendLabel = if ($frontend) { $frontend } else { "[no encontrado]" }

Write-Host "crm-auth:     $modAuthLabel" -ForegroundColor Gray
Write-Host "crm-collab:   $modCollabLabel" -ForegroundColor Gray
Write-Host "crm-media:    $modMediaLabel" -ForegroundColor Gray
Write-Host "crm-frontend: $frontendLabel" -ForegroundColor Gray

Write-Step "Validando Docker Desktop"
docker info > $null 2>&1
if ($LASTEXITCODE -ne 0) {
  Write-Host "ERROR: Docker no responde. Abre Docker Desktop y vuelve a intentar." -ForegroundColor Red
  exit 1
}

$buildScript = Join-Path $Root "gateway\build-krakend.mjs"
if (Test-Path $buildScript) {
  Write-Step "Generando krakend.json (gateway en Docker -> MS en el host)"
  $env:KRAKEND_AUTH_HOST = "http://host.docker.internal:3000"
  $env:KRAKEND_COLLAB_HOST = "http://host.docker.internal:3001"
  $env:KRAKEND_MEDIA_HOST = "http://host.docker.internal:3002"
  try {
    node $buildScript
  } catch {
    Write-Host "Advertencia: no se pudo ejecutar build-krakend.mjs. Se usara el krakend.json existente." -ForegroundColor Yellow
  } finally {
    Remove-Item Env:KRAKEND_AUTH_HOST -ErrorAction SilentlyContinue
    Remove-Item Env:KRAKEND_COLLAB_HOST -ErrorAction SilentlyContinue
    Remove-Item Env:KRAKEND_MEDIA_HOST -ErrorAction SilentlyContinue
  }
}

Write-Step "Levantando contenedores Docker"
$composeFile = Join-Path $Root "docker-compose.yml"
if (-not (Test-Path $composeFile)) {
  Write-Host "ERROR: No se encontro docker-compose.yml en $Root" -ForegroundColor Red
  exit 1
}

$env:COMPOSE_PROJECT_NAME = $ComposeProjectName
$env:GATEWAY_HOST_PORT = $GatewayHostPort
$env:POSTGRES_HOST_PORT = $PostgresHostPort
$env:REDIS_HOST_PORT = $RedisHostPort
$env:CLAMAV_HOST_PORT = $ClamavHostPort

docker compose -f $composeFile up -d
if ($LASTEXITCODE -ne 0) {
  Write-Host "ERROR: Docker Compose fallo." -ForegroundColor Red
  exit 1
}

Write-Step "Reiniciando api-gateway para recargar krakend.json"
docker compose -f $composeFile restart api-gateway | Out-Null

Write-Step "Esperando gateway (http://localhost:$GatewayHostPort/health)"
if (-not (Test-HttpEndpoint -Url "http://localhost:$GatewayHostPort/health" -Attempts 30 -DelaySeconds 2)) {
  Write-Host "Advertencia: gateway aun no responde en /health. Continuando con servicios locales." -ForegroundColor Yellow
}

Write-Step "Bootstrap de .env locales"
Ensure-EnvFile -RepoPath $modAuth -LegacyModuleFolderName "mod-auth" -Normalizer {
  param($envFile)
  Set-EnvKey $envFile "DATABASE_URL" "postgres://root:rootpassword@localhost:$PostgresHostPort/crm_database"
  Set-EnvKey $envFile "REDIS_URL" "redis://127.0.0.1:$RedisHostPort"
  Set-EnvKey $envFile "PORT" "3000"
  Set-EnvKey $envFile "APP_PUBLIC_URL" "http://localhost:$FrontendPort"
  Set-EnvKey $envFile "GATEWAY_TRUST_SECRET" $GatewayTrustSecret
}
Ensure-EnvFile -RepoPath $modCollab -LegacyModuleFolderName "mod-collab" -Normalizer {
  param($envFile)
  Set-EnvKey $envFile "DATABASE_URL" "postgresql://root:rootpassword@localhost:$PostgresHostPort/crm_database"
  Set-EnvKey $envFile "PORT" "3001"
  Set-EnvKey $envFile "CORS_ORIGIN" "http://localhost:$FrontendPort"
  Set-EnvKey $envFile "MOD_AUTH_URL" "http://localhost:3000"
  Set-EnvKey $envFile "MOD_MEDIA_URL" "http://localhost:3002"
  Set-EnvKey $envFile "GATEWAY_TRUST_SECRET" $GatewayTrustSecret
}
Ensure-EnvFile -RepoPath $modMedia -LegacyModuleFolderName "mod-media" -Normalizer {
  param($envFile)
  Set-EnvKey $envFile "DATABASE_URL" "postgres://root:rootpassword@localhost:$PostgresHostPort/crm_database"
  Set-EnvKey $envFile "PORT" "3002"
  Set-EnvKey $envFile "CLAMAV_HOST" "127.0.0.1"
  Set-EnvKey $envFile "CLAMAV_PORT" $ClamavHostPort
  Set-EnvKey $envFile "MOD_COLLAB_URL" "http://localhost:3001"
  Set-EnvKey $envFile "GATEWAY_TRUST_SECRET" $GatewayTrustSecret
}
Ensure-EnvFile -RepoPath $frontend -LegacyModuleFolderName "crm-frontend" -Normalizer {
  param($envFile)
  Set-EnvKey $envFile "VITE_API_BASE_URL" "/api"
  Set-EnvKey $envFile "VITE_API_PROXY_TARGET" "http://localhost:$GatewayHostPort"
}

Prepare-PnpmProject -Path $modAuth -Name "crm-auth"
Prepare-PnpmProject -Path $modCollab -Name "crm-collab"
Prepare-PnpmProject -Path $modMedia -Name "crm-media"
Prepare-PnpmProject -Path $frontend -Name "crm-frontend"

Write-Step "Esperando Postgres local (localhost:$PostgresHostPort)"
if (-not (Wait-TcpPort -Host "127.0.0.1" -Port ([int]$PostgresHostPort) -Attempts 30 -DelaySeconds 2)) {
  Write-Host "ERROR: Postgres no quedo disponible en localhost:$PostgresHostPort" -ForegroundColor Red
  exit 1
}

Write-Step "Preparando esquema y seed del entorno aislado"
Invoke-PnpmCommand -Path $modAuth -Name "crm-auth" -Command "db:push"
Invoke-PnpmCommand -Path $modCollab -Name "crm-collab" -Command "db:push"
Invoke-PnpmCommand -Path $modMedia -Name "crm-media" -Command "db:push"
Invoke-PnpmCommand -Path $modAuth -Name "crm-auth" -Command "db:seed"

if (Test-ServiceHealthy -Url "http://localhost:3000/health") {
  Write-Host "crm-auth ya esta activo en :3000. Se omite segunda instancia." -ForegroundColor Yellow
} else {
  Start-ProjectProcess -Path $modAuth -Command "pnpm dev" -Name "crm-auth"
  Start-Sleep -Seconds 1
}

if ($modAuth) {
  $modAuthEnv = Join-Path $modAuth ".env"
  $redisUrl = Get-EnvValue -EnvFilePath $modAuthEnv -Key "REDIS_URL"
  if ($redisUrl) {
    if (Test-WorkerRunning -CommandMarker "worker:email") {
      Write-Host "worker:email ya esta activo. Se omite segunda instancia." -ForegroundColor Yellow
    } else {
      Start-ProjectProcess -Path $modAuth -Command "pnpm worker:email" -Name "crm-auth worker:email"
      Start-Sleep -Seconds 1
    }
  } else {
    Write-Host "worker:email omitido: REDIS_URL no esta configurado en crm-auth/.env." -ForegroundColor Yellow
  }
}

if (Test-ServiceHealthy -Url "http://localhost:3001/health") {
  Write-Host "crm-collab ya esta activo en :3001. Se omite segunda instancia." -ForegroundColor Yellow
} else {
  Start-ProjectProcess -Path $modCollab -Command "pnpm dev" -Name "crm-collab"
  Start-Sleep -Seconds 1
}

if (Test-ServiceHealthy -Url "http://localhost:3002/health") {
  Write-Host "crm-media ya esta activo en :3002. Se omite segunda instancia." -ForegroundColor Yellow
} else {
  Start-ProjectProcess -Path $modMedia -Command "pnpm dev" -Name "crm-media"
  Start-Sleep -Seconds 1
}

if (Test-ServiceHealthy -Url "http://localhost:$FrontendPort") {
  Write-Host "crm-frontend ya esta activo en :$FrontendPort. Se omite segunda instancia." -ForegroundColor Yellow
} else {
  Start-ProjectProcess -Path $frontend -Command "pnpm dev --host 127.0.0.1 --port $FrontendPort" -Name "crm-frontend"
}

Write-Host ""
Write-Host "=========================================" -ForegroundColor DarkGray
Write-Host "Listo." -ForegroundColor Green
Write-Host "=========================================" -ForegroundColor DarkGray
Write-Host ""
Write-Host "Compose project: $ComposeProjectName" -ForegroundColor Gray
Write-Host "Gateway:         http://localhost:$GatewayHostPort/health" -ForegroundColor Gray
Write-Host "Postgres host:   localhost:$PostgresHostPort" -ForegroundColor Gray
Write-Host "Redis host:      localhost:$RedisHostPort" -ForegroundColor Gray
Write-Host "ClamAV host:     localhost:$ClamavHostPort" -ForegroundColor Gray
Write-Host "crm-auth:        http://localhost:3000" -ForegroundColor Gray
Write-Host "crm-collab:      http://localhost:3001/health" -ForegroundColor Gray
Write-Host "crm-media:       http://localhost:3002/health" -ForegroundColor Gray
Write-Host "Frontend:        http://localhost:$FrontendPort" -ForegroundColor Gray
Write-Host ""
Write-Host "Si algun repo no fue encontrado, configura estas variables o crea repos hermanos:" -ForegroundColor DarkGray
Write-Host "  CIMA_AUTH_PATH, CIMA_COLLAB_PATH, CIMA_MEDIA_PATH, CIMA_FRONTEND_PATH" -ForegroundColor DarkGray
Write-Host "Puertos/compose opcionales:" -ForegroundColor DarkGray
Write-Host "  COMPOSE_PROJECT_NAME, GATEWAY_HOST_PORT, POSTGRES_HOST_PORT, REDIS_HOST_PORT, CLAMAV_HOST_PORT, FRONTEND_PORT" -ForegroundColor DarkGray
Write-Host ""
