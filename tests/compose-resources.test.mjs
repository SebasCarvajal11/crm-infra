import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import test from "node:test";
import YAML from "yaml";
import {
  DEFAULT_LOGGING,
  resolveServiceMemoryLimit,
  resolveWorkerMemoryLimit,
} from "../scripts/compose-defaults.mjs";

test("resolveServiceMemoryLimit asigna limites correctos por servicio y respeta overrides", () => {
  assert.equal(resolveServiceMemoryLimit({ name: "auth" }), "512m");
  assert.equal(resolveServiceMemoryLimit({ name: "collab" }), "512m");
  assert.equal(resolveServiceMemoryLimit({ name: "marketing" }), "768m");
  assert.equal(resolveServiceMemoryLimit({ name: "frontend" }), "256m");
  assert.equal(resolveServiceMemoryLimit({ name: "custom", memLimit: "1024m" }), "1024m");
});

test("resolveWorkerMemoryLimit asigna limites correctos y otorga margen a media", () => {
  assert.equal(resolveWorkerMemoryLimit("auth", {}), "256m");
  assert.equal(resolveWorkerMemoryLimit("media", {}), "384m");
  assert.equal(resolveWorkerMemoryLimit("auth", { memLimit: "512m" }), "512m");
});

test("docker-compose.slot.prod.yml tiene mem_limit y rotacion de logs en todos los servicios", () => {
  const composePath = new URL("../docker-compose.slot.prod.yml", import.meta.url);
  assert.ok(existsSync(composePath), "docker-compose.slot.prod.yml debe existir");

  const compose = YAML.parse(readFileSync(composePath, "utf-8"));
  const services = Object.entries(compose.services);
  assert.ok(services.length >= 9, "Debe haber al menos 9 servicios en el slot de prod");
  assert.ok(compose.services["auth-worker"], "Debe existir auth-worker");
  assert.ok(compose.services["collab-worker"], "Debe existir collab-worker");
  assert.ok(compose.services["media-worker"], "Debe existir media-worker");

  for (const [name, s] of services) {
    assert.ok(s.mem_limit, `Servicio ${name} debe tener mem_limit configurado`);
    assert.ok(s.logging, `Servicio ${name} debe tener configuracion de logging`);
    assert.equal(s.logging.driver, DEFAULT_LOGGING.driver);
    assert.equal(s.logging.options?.["max-size"], DEFAULT_LOGGING.options["max-size"]);
    assert.equal(s.logging.options?.["max-file"], DEFAULT_LOGGING.options["max-file"]);
  }
});

test("docker-compose.prod.yml define mem_limit y rotacion de logs en servicios compartidos", () => {
  const prodPath = new URL("../docker-compose.prod.yml", import.meta.url);
  assert.ok(existsSync(prodPath), "docker-compose.prod.yml debe existir");

  const compose = YAML.parse(readFileSync(prodPath, "utf-8"));
  const required = ["postgres_db", "redis", "clamav-scanner", "edge-proxy"];

  for (const name of required) {
    const s = compose.services[name];
    assert.ok(s, `Servicio compartido ${name} debe existir`);
    assert.ok(s.mem_limit, `Servicio compartido ${name} debe tener mem_limit`);
    assert.ok(s.logging, `Servicio compartido ${name} debe tener logging`);
    assert.equal(s.logging.options?.["max-size"], "10m");
    assert.equal(s.logging.options?.["max-file"], "3");
  }
});
