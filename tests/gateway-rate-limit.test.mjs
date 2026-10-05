import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import test from "node:test";
import {
  buildAuthEndpoint,
  buildPublicEndpoint,
  DEFAULT_AUTH_RATE_LIMIT,
  resolveEndpointRateLimit,
} from "../gateway/endpoint-builder.mjs";

test("resolveEndpointRateLimit devuelve configuraciones esperadas", () => {
  assert.equal(resolveEndpointRateLimit(false, true), null);
  assert.equal(resolveEndpointRateLimit(false, false), null);

  const customLimit = { client_max_rate: 50, every: "1m" };
  assert.deepEqual(resolveEndpointRateLimit(customLimit, true), customLimit);
  assert.deepEqual(resolveEndpointRateLimit(customLimit, false), customLimit);

  assert.deepEqual(resolveEndpointRateLimit(undefined, true), DEFAULT_AUTH_RATE_LIMIT);
  assert.equal(resolveEndpointRateLimit(undefined, false), null);
});

test("buildAuthEndpoint inyecta JWT validator y rate limiting por defecto", () => {
  const ctx = {
    hosts: { collab: "http://crm-collab:3001" },
    servicesRegistry: [{ name: "collab" }],
    authHost: "http://crm-auth:3000",
  };
  const def = {
    endpoint: "/api/v1/collab/tasks",
    method: "GET",
    host: "collab",
  };

  const ep = buildAuthEndpoint(def, "collab", ctx);
  assert.ok(ep.extra_config["auth/validator"], "Debe incluir auth/validator");
  assert.deepEqual(
    ep.extra_config["qos/ratelimit/router"],
    DEFAULT_AUTH_RATE_LIMIT,
    "Debe incluir DEFAULT_AUTH_RATE_LIMIT",
  );
});

test("buildAuthEndpoint respeta rate_limit especifico y rate_limit=false", () => {
  const ctx = {
    hosts: { collab: "http://crm-collab:3001" },
    servicesRegistry: [{ name: "collab" }],
    authHost: "http://crm-auth:3000",
  };

  const customDef = {
    endpoint: "/api/v1/collab/burst",
    method: "POST",
    host: "collab",
    rate_limit: { client_max_rate: 30, client_capacity: 30, every: "1m", strategy: "ip" },
  };
  const epCustom = buildAuthEndpoint(customDef, "collab", ctx);
  assert.equal(epCustom.extra_config["qos/ratelimit/router"].client_max_rate, 30);

  const disabledDef = {
    endpoint: "/api/v1/collab/stream",
    method: "GET",
    host: "collab",
    rate_limit: false,
  };
  const epDisabled = buildAuthEndpoint(disabledDef, "collab", ctx);
  assert.equal(epDisabled.extra_config["qos/ratelimit/router"], undefined);
});

test("buildPublicEndpoint aplica deep merge y no sobrescribe extra_config", () => {
  const ctx = {
    hosts: { auth: "http://crm-auth:3000" },
    servicesRegistry: [{ name: "auth" }],
    authHost: "http://crm-auth:3000",
  };
  const def = {
    endpoint: "/api/v1/auth/login",
    method: "POST",
    host: "auth",
    rate_limit: { client_max_rate: 15, client_capacity: 15, every: "15m", strategy: "ip" },
  };

  const ep = buildPublicEndpoint(def, ctx);
  assert.deepEqual(ep.extra_config["qos/ratelimit/router"], def.rate_limit);
});

test("krakend.json generado contiene rate limiting en endpoints autenticados y publicos criticos", () => {
  const krakendPath = new URL("../krakend.json", import.meta.url);
  assert.ok(existsSync(krakendPath), "krakend.json debe existir");

  const config = JSON.parse(readFileSync(krakendPath, "utf-8"));
  assert.ok(Array.isArray(config.endpoints), "debe tener array de endpoints");

  let rateLimitedCount = 0;
  for (const ep of config.endpoints) {
    if (ep.extra_config?.["qos/ratelimit/router"]) {
      rateLimitedCount++;
    }
  }

  assert.ok(
    rateLimitedCount >= 150,
    `Se esperaban al menos 150 endpoints con rate limit, encontrados: ${rateLimitedCount}`,
  );
});
