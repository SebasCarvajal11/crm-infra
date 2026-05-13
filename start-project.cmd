@echo off
setlocal
cd /d "%~dp0"

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-project.ps1"
if errorlevel 1 (
  echo.
  echo ERROR: El arranque fallo. Revisa los mensajes anteriores.
)

echo.
pause
endlocal
