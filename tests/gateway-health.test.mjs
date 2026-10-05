import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import test from "node:test";
import {
  buildHealthCheckEndpoint,
  HEALTH_CB_CONFIG,
  DEFAULT_HEALTH_TIMEOUT,
} from "../gateway/endpoint-builder.mjs";

test("buildHealthCheckEndpoint genera endpoint ágil con timeout y circuit breaker rápido", () => {
  const registry = [
    { name: "auth", manifestPath: "auth/manifest.json", healthPath: "/api/v1/health" },
    { name: "collab", manifestPath: "collab/manifest.json", healthPath: "/api/v1/health" },
  ];
  const hosts = {
    auth: "http://crm-auth:3000",
    collab: "http://crm-collab:3001",
  };

  const ep = buildHealthCheckEndpoint(registry, hosts);
  assert.equal(ep.endpoint, "/api/v1/health");
  assert.equal(ep.method, "GET");
  assert.equal(ep.timeout, DEFAULT_HEALTH_TIMEOUT);
  assert.equal(ep.backend.length, 2);

  for (const b of ep.backend) {
    const cb = b.extra_config?.["qos/circuit-breaker"];
    assert.ok(cb, `Backend ${b.group} debe tener circuit breaker`);
    assert.equal(cb.interval, HEALTH_CB_CONFIG.interval);
    assert.equal(cb.timeout, HEALTH_CB_CONFIG.timeout);
    assert.equal(cb.max_errors, HEALTH_CB_CONFIG.max_errors);
    assert.equal(cb.name, `cb-health-${b.group}`);
  }
});

test("krakend.json generado incluye timeout de 3s y circuit breaker ágil en /api/v1/health", () => {
  const krakendPath = new URL("../krakend.json", import.meta.url);
  assert.ok(existsSync(krakendPath), "krakend.json debe existir");

  const config = JSON.parse(readFileSync(krakendPath, "utf-8"));
  const healthEp = config.endpoints.find((e) => e.endpoint === "/api/v1/health");
  assert.ok(healthEp, "Debe existir endpoint /api/v1/health");
  assert.equal(healthEp.timeout, "3s");
  assert.ok(healthEp.backend.length >= 4, "Debe multiplexar al menos 4 microservicios");

  for (const b of healthEp.backend) {
    const cb = b.extra_config?.["qos/circuit-breaker"];
    assert.ok(cb, `Backend ${b.group} debe tener circuit breaker`);
    assert.equal(cb.interval, 10);
    assert.equal(cb.timeout, 5);
    assert.equal(cb.max_errors, 3);
  }
});
