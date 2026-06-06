#!/usr/bin/env pwsh
#Requires -Version 7.0
$ErrorActionPreference = "Stop"

<#
.SYNOPSIS
    Generate KrakenD gateway configuration for local development.
.DESCRIPTION
    Builds krakend.json from endpoint definitions using localhost URLs
    for backend services (hybrid mode: infra in Docker, services on host).
#>

$infraRoot = Split-Path -Parent $PSScriptRoot
$trustSecret = if ($env:GATEWAY_TRUST_SECRET) { $env:GATEWAY_TRUST_SECRET } else { "cima-local-gateway-trust-secret-do-not-use-production-2026" }

Write-Host "⚙️  Generando krakend.json..." -ForegroundColor Cyan

$env:KRAKEND_AUTH_HOST = "http://127.0.0.1:3000"
$env:KRAKEND_COLLAB_HOST = "http://127.0.0.1:3001"
$env:KRAKEND_MEDIA_HOST = "http://127.0.0.1:3002"
$env:GATEWAY_TRUST_SECRET = $trustSecret

Push-Location $infraRoot
try {
    node gateway/build-krakend.mjs
    Write-Host "  ✓ krakend.json generado" -ForegroundColor Green
} catch {
    Write-Host "  ✗ Error generando krakend.json: $_" -ForegroundColor Red
    Pop-Location
    exit 1
}
Pop-Location

Write-Host "`n✅ Gateway configurado" -ForegroundColor Green
