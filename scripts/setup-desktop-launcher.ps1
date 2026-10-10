<#
.SYNOPSIS
    Genera el lanzador oficial de CIMA CRM, crea accesos directos y los ubica en el Escritorio.
.DESCRIPTION
    Compila el ejecutable nativo CIMA-CRM.exe con icono de alta resolucion y crea los accesos
    directos en el Escritorio y en el Menu Inicio de Windows.
#>
[CmdletBinding()]
param()

$infraDir = Split-Path -Parent $PSScriptRoot
$rootDir = Split-Path -Parent $infraDir
$icoPath = Join-Path $infraDir "cima-icon.ico"
$pngPath = Join-Path $rootDir "crm-frontend\public\favicon.png"

# 1. Asegurar icono .ico oficial
if (-not (Test-Path $icoPath) -and (Test-Path $pngPath)) {
    Add-Type -AssemblyName System.Drawing
    $bmp = [System.Drawing.Bitmap]::FromFile($pngPath)
    $thumb = [System.Drawing.Bitmap]::new($bmp, [System.Drawing.Size]::new(256, 256))
    $hIcon = $thumb.GetHicon()
    $icon = [System.Drawing.Icon]::FromHandle($hIcon)
    $stream = [System.IO.FileStream]::new($icoPath, [System.IO.FileMode]::Create)
    $icon.Save($stream)
    $stream.Close()
    $icon.Dispose()
    $thumb.Dispose()
    $bmp.Dispose()
    Write-Host "[OK] Icono generado en $icoPath" -ForegroundColor Green
}

# 2. Compilar ejecutable lanzador
$exePath = Join-Path $infraDir "CIMA-CRM.exe"
$csSource = @"
using System;
using System.Diagnostics;
using System.IO;

namespace CimaCrmLauncher
{
    class Program
    {
        static void Main(string[] args)
        {
            string appDir = @"$rootDir";
            string scriptPath = Path.Combine(appDir, "start-local.ps1");
            
            ProcessStartInfo psi = new ProcessStartInfo();
            psi.FileName = "powershell.exe";
            psi.Arguments = "-NoProfile -ExecutionPolicy Bypass -File \"" + scriptPath + "\" -Interactive -Tunnel";
            psi.WorkingDirectory = appDir;
            psi.UseShellExecute = true;

            try
            {
                using (Process p = Process.Start(psi))
                {
                    p.WaitForExit();
                }
            }
            catch (Exception ex)
            {
                Console.WriteLine("Error: " + ex.Message);
            }
        }
    }
}
"@
$csFile = Join-Path $infraDir "Launcher.cs"
Set-Content -Path $csFile -Value $csSource -Encoding UTF8

$csc = "C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe"
if (Test-Path $csc) {
    $null = & $csc /nologo /target:winexe /win32icon:$icoPath /out:$exePath $csFile
    Write-Host "[OK] Lanzador binario compilado en $exePath" -ForegroundColor Green
}

# 3. Crear accesos directos
$desktop = [Environment]::GetFolderPath('Desktop')
$wsh = New-Object -ComObject WScript.Shell

$shortcutPaths = @(
    (Join-Path $desktop "CIMA CRM.lnk"),
    (Join-Path "$env:APPDATA\Microsoft\Windows\Start Menu\Programs" "CIMA CRM.lnk")
)

foreach ($scPath in $shortcutPaths) {
    $shortcut = $wsh.CreateShortcut($scPath)
    $shortcut.TargetPath = $exePath
    $shortcut.WorkingDirectory = $rootDir
    $shortcut.IconLocation = "$icoPath,0"
    $shortcut.Description = "Iniciar ecosistema local CIMA CRM"
    $shortcut.Save()
    Write-Host "[OK] Acceso directo creado: $scPath" -ForegroundColor Green
}
