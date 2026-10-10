<#
.SYNOPSIS
    Sincroniza la base de datos de produccion (PostgreSQL en OCI) hacia el entorno local.
.DESCRIPTION
    Realiza un volcado seguro via SSH de los esquemas de negocio de produccion
    (schema_auth, schema_collab, schema_media, schema_marketing) y los restaura en el
    contenedor local de PostgreSQL, preservando los roles y contraseñas de desarrollo.
#>
[CmdletBinding()]
param(
    [string]$SshHost = "155.248.207.47",
    [string]$SshUser = "ubuntu",
    [string]$SshKey = "C:\Users\27seb\.ssh\oracle-deploy.key",
    [switch]$Quiet
)

$ErrorActionPreference = "Stop"

function Test-ProductionConnection {
    if (-not (Test-Path $SshKey)) { return $false }
    try {
        $sshTest = & ssh -i "$SshKey" -o ConnectTimeout=4 -o StrictHostKeyChecking=no "$SshUser@$SshHost" "echo ok" 2>$null
        return ($sshTest -eq "ok")
    } catch {
        return $false
    }
}

function Export-ProductionDump {
    param([string]$DestinationFile)
    $remoteCmd = "docker exec crm-shared-postgres_db-1 pg_dump -U root -d crm_database " +
        "-n schema_auth -n schema_collab -n schema_media -n schema_marketing " +
        "--no-owner --no-privileges"
    
    $proc = Start-Process -FilePath "ssh" -ArgumentList "-i", "$SshKey",
        "-o", "StrictHostKeyChecking=no", "$SshUser@$SshHost", "$remoteCmd" `
        -RedirectStandardOutput $DestinationFile -PassThru -NoNewWindow
    $proc.WaitForExit()
    return ((Test-Path $DestinationFile) -and ((Get-Item $DestinationFile).Length -gt 1000))
}

function Import-LocalDump {
    param([string]$SourceFile)
    $container = "cima_crm_local-postgres_db-1"
    $dropSql = "SET client_min_messages = error; " +
        "DROP SCHEMA IF EXISTS schema_auth CASCADE; " +
        "DROP SCHEMA IF EXISTS schema_collab CASCADE; " +
        "DROP SCHEMA IF EXISTS schema_media CASCADE; " +
        "DROP SCHEMA IF EXISTS schema_marketing CASCADE;"

    $prevEap = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try {
        docker exec $container psql -U root -d crm_database -c "$dropSql" >$null 2>&1
        docker cp $SourceFile "${container}:/tmp/prod_dump.sql" >$null 2>&1
        docker exec $container sed -i '/^\\restrict/d; /^\\unrestrict/d' /tmp/prod_dump.sql >$null 2>&1
        docker exec $container psql -U root -d crm_database -f /tmp/prod_dump.sql >$null 2>&1
        docker exec $container sh /docker-entrypoint-initdb.d/00-init-service-schemas.sh >$null 2>&1
        docker exec $container rm -f /tmp/prod_dump.sql >$null 2>&1
    } finally {
        $ErrorActionPreference = $prevEap
    }
}

try {
    if (-not $Quiet) {
        Write-Host "[SYNC-DB] Verificando conectividad con servidor de produccion..." -ForegroundColor Cyan
    }
    if (-not (Test-ProductionConnection)) {
        Write-Host "  [WARN] Servidor de produccion inaccesible o llave SSH no disponible." -ForegroundColor Yellow
        Write-Host "         Continuando con datos locales existentes." -ForegroundColor Gray
        exit 0
    }

    $tempDump = Join-Path $env:TEMP "cima_prod_sync_$(Get-Random).sql"
    if (-not $Quiet) {
        Write-Host "  [1/2] Extrayendo datos de produccion via tunel SSH..." -ForegroundColor Cyan
    }

    $exportOk = Export-ProductionDump -DestinationFile $tempDump
    if (-not $exportOk) {
        throw "Error al exportar los datos desde el servidor de produccion."
    }

    if (-not $Quiet) {
        $mb = [Math]::Round(((Get-Item $tempDump).Length / 1MB), 2)
        Write-Host "  [2/2] Restaurando dump ($mb MB) en PostgreSQL local y reconciliando permisos..." -ForegroundColor Cyan
    }

    Import-LocalDump -SourceFile $tempDump
    Remove-Item $tempDump -Force -ErrorAction SilentlyContinue

    if (-not $Quiet) {
        Write-Host "  [OK] Base de datos de produccion sincronizada exitosamente en local." -ForegroundColor Green
    }
} catch {
    Write-Host "  [ERROR-SYNC] Fallo al sincronizar BD: $_" -ForegroundColor Red
    exit 1
}
