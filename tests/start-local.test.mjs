import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import test from "node:test";

test("start-local.ps1 existe y cuenta con directivas robustas de ruta y ejecucion", () => {
  const scriptPath = new URL("../start-local.ps1", import.meta.url);
  assert.ok(existsSync(scriptPath), "start-local.ps1 debe existir");

  const content = readFileSync(scriptPath, "utf-8");
  assert.match(content, /\$PSScriptRoot/, "Debe anclarse a $PSScriptRoot para ejecucion independiente del CWD");
  assert.match(content, /docker compose/, "Debe interactuar con docker compose");
  assert.match(content, /docker info|docker version/, "Debe validar que el daemon de Docker este activo");
});

test("start-local.ps1 soporta parametros profesionales de administracion local", () => {
  const scriptPath = new URL("../start-local.ps1", import.meta.url);
  const content = readFileSync(scriptPath, "utf-8");

  assert.match(content, /param\s*\(/i, "Debe declarar bloque param formal");
  assert.match(content, /\$Down/i, "Debe soportar flag -Down para apagar contenedores");
  assert.match(content, /\$Restart/i, "Debe soportar flag -Restart para reiniciar el stack");
  assert.match(content, /\$Status/i, "Debe soportar flag -Status para consultar el estado del stack");
  assert.match(content, /\$OpenBrowser/i, "Debe soportar flag -OpenBrowser para abrir el navegador al estar listo");
  assert.match(content, /\$NoWait/i, "Debe soportar flag -NoWait para modo no bloqueante");
});

test("start-local.ps1 parsea puertos directamente desde .env.docker con fallback", () => {
  const scriptPath = new URL("../start-local.ps1", import.meta.url);
  const content = readFileSync(scriptPath, "utf-8");

  assert.match(content, /Get-DockerEnvVar|Get-EnvValue|\.env\.docker/, "Debe leer variables directamente de .env.docker");
  assert.match(content, /GATEWAY_HOST_PORT/, "Debe contemplar GATEWAY_HOST_PORT");
  assert.match(content, /FRONTEND_HOST_PORT/, "Debe contemplar FRONTEND_HOST_PORT");
});

test("start-local.ps1 implementa espera activa de salud antes de declarar exito", () => {
  const scriptPath = new URL("../start-local.ps1", import.meta.url);
  const content = readFileSync(scriptPath, "utf-8");

  assert.match(content, /Wait-ForHealth|Wait-ForStackReady|health/i, "Debe verificar la salud del stack");
});

test("start-local.ps1 calcula y muestra porcentaje de progreso en consola y titulo de ventana", () => {
  const scriptPath = new URL("../start-local.ps1", import.meta.url);
  const content = readFileSync(scriptPath, "utf-8");

  assert.match(content, /Set-Progress|Update-Progress|Show-Progress/i, "Debe tener funcion dedicada de progreso");
  assert.match(content, /WindowTitle/i, "Debe actualizar el titulo de la ventana con el % de avance");
  assert.match(content, /100%/, "Debe alcanzar el 100% al completar el arranque");
});

test("start-local.ps1 soporta deteccion de IP en red local (LAN) y apertura de tunel", () => {
  const scriptPath = new URL("../start-local.ps1", import.meta.url);
  const content = readFileSync(scriptPath, "utf-8");

  assert.match(content, /\$Tunnel/i, "Debe declarar parametro -Tunnel");
  assert.match(content, /Get-LanIpAddress|Get-NetIPAddress/i, "Debe detectar la IP local de la red LAN");
  assert.match(content, /Start-Tunnel|cloudflared/i, "Debe soportar levantar el tunel con cloudflared");
});

test("Launcher.cs y setup-desktop-launcher.ps1 configuran -Tunnel por defecto para arranque con doble clic", () => {
  const launcherPath = new URL("../Launcher.cs", import.meta.url);
  const setupPath = new URL("../scripts/setup-desktop-launcher.ps1", import.meta.url);
  
  const launcherContent = readFileSync(launcherPath, "utf-8");
  const setupContent = readFileSync(setupPath, "utf-8");

  assert.match(launcherContent, /-Tunnel/, "Launcher.cs debe incluir -Tunnel");
  assert.match(setupContent, /-Tunnel/, "setup-desktop-launcher.ps1 debe incluir -Tunnel");
});



