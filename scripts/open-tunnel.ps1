<#
.SYNOPSIS
    Abre un tunel seguro HTTPS hacia CIMA CRM para acceso desde cualquier dispositivo.
.DESCRIPTION
    Utiliza cloudflared para exponer el puerto del frontend local (5173) y muestra la URL
    publica y de red local (LAN) para acceder desde celulares, tablets u otros equipos.
#>
[CmdletBinding()]
param(
    [int]$Port = 5173
)

$infraDir = Split-Path -Parent $PSScriptRoot
$rootDir = Split-Path -Parent $infraDir
$cfExe = Join-Path $rootDir ".tools\cloudflared.exe"

if (-not (Test-Path $cfExe)) {
    $toolsDir = Split-Path -Parent $cfExe
    if (-not (Test-Path $toolsDir)) { New-Item -ItemType Directory -Path $toolsDir | Out-Null }
    Write-Host "[TUNNEL] Descargando cliente de tunel..." -ForegroundColor Cyan
    Invoke-WebRequest -Uri "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe" -OutFile $cfExe
}

$lanIp = try {
    $route = Get-NetRoute -DestinationPrefix "0.0.0.0/0" -ErrorAction SilentlyContinue | Select-Object -First 1
    (Get-NetIPAddress -InterfaceIndex $route.InterfaceIndex -AddressFamily IPv4 -ErrorAction SilentlyContinue).IPAddress
} catch { "127.0.0.1" }

Write-Host "`nIniciando tunel HTTPS seguro hacia http://localhost:$Port..." -ForegroundColor Cyan

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

Write-Host ""
Write-Host "==========================================================" -ForegroundColor Green
Write-Host "     CIMA CRM - PUNTOS DE ACCESO MULTI-DISPOSITIVO        " -ForegroundColor Green
Write-Host "==========================================================" -ForegroundColor Green
Write-Host "  [MISMO EQUIPO] http://localhost:$Port" -ForegroundColor White
Write-Host "  [RED LOCAL]    http://${lanIp}:${Port} (Misma red Wi-Fi)" -ForegroundColor Yellow
if ($tunnelUrl) {
    Write-Host "  [TUNEL HTTPS]  $tunnelUrl" -ForegroundColor Cyan
    Write-Host "                 (Ideal para celulares / tablets con SSL)" -ForegroundColor Gray
}
Write-Host "==========================================================" -ForegroundColor Green
Write-Host "`nEl tunel estara activo mientras esta ventana permanezca abierta." -ForegroundColor Gray
Read-Host "Presiona Enter para cerrar el tunel..."

if ($proc -and -not $proc.HasExited) {
    Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
}
Write-Host "[TUNNEL] Tunel cerrado exitosamente." -ForegroundColor Green
