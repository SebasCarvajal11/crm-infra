$ErrorActionPreference = "Stop"

$GatewayHostPort = if ($env:GATEWAY_HOST_PORT) { $env:GATEWAY_HOST_PORT } else { "18080" }
$FrontendPort = if ($env:FRONTEND_PORT) { $env:FRONTEND_PORT } else { "5173" }
$GatewayBaseUrl = "http://localhost:$GatewayHostPort"
$FrontendBaseUrl = "http://127.0.0.1:$FrontendPort"
$loginIp = "198.51.100.$(Get-Random -Minimum 10 -Maximum 240)"

function Wait-HttpOk([string]$Url, [int]$Attempts = 30, [int]$DelaySeconds = 2) {
  for ($i = 0; $i -lt $Attempts; $i++) {
    try {
      $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 5
      if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 300) {
        return $response
      }
    } catch {
      Start-Sleep -Seconds $DelaySeconds
    }
  }

  throw "No hubo respuesta satisfactoria desde $Url"
}

function Assert-JsonField([object]$Value, [string]$Message) {
  if (-not $Value) {
    throw $Message
  }
}

Write-Host ""
Write-Host "Smoke multi-repo" -ForegroundColor Green

Wait-HttpOk "$GatewayBaseUrl/health" | Out-Null
Wait-HttpOk "http://localhost:3000/health" | Out-Null
Wait-HttpOk "http://localhost:3001/health" | Out-Null
Wait-HttpOk "http://localhost:3002/health" | Out-Null

$frontendShell = Wait-HttpOk $FrontendBaseUrl
if ($frontendShell.Content -notmatch '<div id="root">') {
  throw "El frontend no entrego el shell esperado en $FrontendBaseUrl"
}

Wait-HttpOk "$FrontendBaseUrl/api/health" | Out-Null

$loginBody = @{
  email = "admin@cima.dev"
  password = "Admin123!"
} | ConvertTo-Json

$login = Invoke-RestMethod `
  -Method Post `
  -Uri "$GatewayBaseUrl/auth/login" `
  -Headers @{
    "X-Forwarded-For" = $loginIp
    "X-Real-IP" = $loginIp
  } `
  -ContentType "application/json" `
  -Body $loginBody

$token = $login.data.access_token
Assert-JsonField $token "No se obtuvo access_token desde /auth/login a traves del gateway"

$headers = @{ Authorization = "Bearer $token" }

$me = Invoke-RestMethod -Method Get -Uri "$GatewayBaseUrl/identity/me" -Headers $headers
Assert-JsonField $me.data.email "La respuesta de /identity/me no incluyo el usuario autenticado"

$projects = Invoke-RestMethod -Method Get -Uri "$GatewayBaseUrl/projects" -Headers $headers
if ($null -eq $projects.data) {
  throw "La respuesta de /projects no incluyo data"
}

Write-Host "OK: gateway, auth, collab, media, frontend y proxy /api respondieron." -ForegroundColor Green
