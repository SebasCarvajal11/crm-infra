$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $PSScriptRoot
$WorkspaceRoot = Split-Path -Parent $Root
$ComposeFile = Join-Path $Root "docker-compose.yml"
$GatewayHostPort = if ($env:GATEWAY_HOST_PORT) { $env:GATEWAY_HOST_PORT } else { "18080" }
$GatewayHealthUrl = "http://localhost:$GatewayHostPort/health"

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
    throw "No se resolvio la ruta para $Label"
  }

  Push-Location $RepoPath
  try {
    & $Action
    if ($LASTEXITCODE -ne 0) {
      throw "$Label fallo con codigo $LASTEXITCODE"
    }
  } finally {
    Pop-Location
  }
}

function Restart-Gateway() {
  Write-Host ""
  Write-Host "==> Reiniciando gateway para limpiar rate limits" -ForegroundColor Cyan
  docker compose -f $ComposeFile restart api-gateway | Out-Null
  Wait-HttpOk $GatewayHealthUrl
}

$authRepo = Resolve-RepoPath -EnvVarName "CIMA_AUTH_PATH" -SiblingName "crm-auth"
$collabRepo = Resolve-RepoPath -EnvVarName "CIMA_COLLAB_PATH" -SiblingName "crm-collab"
$mediaRepo = Resolve-RepoPath -EnvVarName "CIMA_MEDIA_PATH" -SiblingName "crm-media"

Write-Host ""
Write-Host "Verificacion multi-repo" -ForegroundColor Green

Invoke-InRepo $Root "crm-infra" { pnpm smoke:multirepo }
Invoke-InRepo $mediaRepo "crm-media" { pnpm oci:verify }

Restart-Gateway

Invoke-InRepo $collabRepo "crm-collab" { pnpm test:smoke:gateway }

Restart-Gateway

Invoke-InRepo $authRepo "crm-auth" { pnpm test:rate-limit }

Write-Host ""
Write-Host "OK: verificacion multi-repo completa." -ForegroundColor Green
