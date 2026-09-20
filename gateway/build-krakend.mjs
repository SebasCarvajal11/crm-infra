#!/usr/bin/env node
/**
 * build-krakend.mjs — Genera krakend.json desde templates y listas de endpoints.
 *
 * Soporta:
 * - JWT validator inyectado automaticamente en endpoints autenticados
 * - allow/deny lists para filtrado de respuestas (payload pruning)
 * - qos/circuit-breaker en backends
 * - qos/http-cache en backends de lectura
 * - Rate limiting por endpoint
 * - BFF con multiples backends
 *
 * Uso:
 *   node gateway/build-krakend.mjs
 *   node gateway/build-krakend.mjs --output deploy/runtime/krakend.json
 *   node gateway/build-krakend.mjs --compare <oldManifest> <newManifest>
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { compareManifests } from "./manifest-comparator.mjs";
import {
  buildPublicEndpoint,
  buildAuthEndpoint,
  PUBLIC_HEADERS_BASE,
  extraBackendOpts,
  getCircuitBreakerConfig,
} from "./endpoint-builder.mjs";
import { loadServiceEndpoints } from "./manifest-loader.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_OUTPUT = resolve(__dirname, "..", "krakend.json");

const servicesRegistryPath = resolve(__dirname, "..", "registry", "services.json");
const allServicesRegistry = JSON.parse(readFileSync(servicesRegistryPath, "utf-8"));

function parseGatewayServices() {
  const raw = process.env.CRM_GATEWAY_SERVICES?.trim();
  if (!raw) return null;

  const selected = raw
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  if (selected.length === 0) return null;

  const knownServices = new Set(allServicesRegistry.map((s) => s.name));
  const unknownServices = selected.filter((s) => !knownServices.has(s));
  if (unknownServices.length > 0) {
    throw new Error(`CRM_GATEWAY_SERVICES contiene servicios no registrados: ${unknownServices.join(", ")}`);
  }

  return new Set(selected);
}

const selectedServices = parseGatewayServices();
const servicesRegistry = selectedServices
  ? allServicesRegistry.filter((s) => selectedServices.has(s.name))
  : allServicesRegistry;

const hosts = {};
for (const s of servicesRegistry) {
  const envName = `KRAKEND_${s.name.toUpperCase()}_HOST`;
  const defaultUrl = `http://crm-${s.name}:${s.port}`;
  hosts[s.name] = optionalUrlEnv(envName, defaultUrl);
}

const AUTH_HOST = hosts["auth"] || "http://crm-auth:3000";
const GATEWAY_PORT = optionalPortEnv("KRAKEND_PORT", 8080);
const ENDPOINTS_SOURCE = optionalEnumEnv("KRAKEND_ENDPOINTS_SOURCE", ["auto", "http", "file"], "auto");
const ENDPOINTS_HTTP_TIMEOUT_MS = optionalPositiveIntegerEnv("KRAKEND_ENDPOINTS_HTTP_TIMEOUT_MS", 5000);

function optionalUrlEnv(name, fallback) {
  const value = (process.env[name]?.trim() || fallback).replace(/\/+$/, "");
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol)) throw new Error("protocolo invalido");
    return value;
  } catch {
    throw new Error(`${name} debe ser una URL http(s) valida`);
  }
}

function optionalPortEnv(name, fallback) {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > 65535) {
    throw new Error(`${name} debe ser un puerto TCP valido`);
  }
  return value;
}

function optionalPositiveIntegerEnv(name, fallback) {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${name} debe ser un entero positivo`);
  }
  return value;
}

function optionalEnumEnv(name, allowed, fallback) {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  if (!allowed.includes(raw)) {
    throw new Error(`${name} debe ser uno de: ${allowed.join(", ")}`);
  }
  return raw;
}

function buildHealthCheckEndpoint() {
  const healthBackends = servicesRegistry
    .filter((s) => s.manifestPath)
    .map((s) => ({
      host: [hosts[s.name]],
      url_pattern: s.healthPath || "/api/v1/health",
      group: s.name,
      extra_config: {
        ...extraBackendOpts(),
        "qos/circuit-breaker": {
          ...getCircuitBreakerConfig(s.name, servicesRegistry),
          name: `cb-health-${s.name}`,
        },
      },
    }));

  return {
    endpoint: "/api/v1/health",
    method: "GET",
    output_encoding: "json",
    input_headers: [...PUBLIC_HEADERS_BASE],
    backend: healthBackends,
  };
}

function buildKrakendConfig(endpoints) {
  return {
    $schema: "https://www.krakend.io/schema/v3.json",
    version: 3,
    name: "CIMA CRM API Gateway",
    port: GATEWAY_PORT,
    timeout: "30s",
    extra_config: {
      "security/cors": {
        allow_origins: ["http://localhost:5173", "http://127.0.0.1:5173"],
        allow_methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        allow_headers: [
          "Origin", "Authorization", "Content-Type", "Cookie",
          "Accept", "X-Requested-With",
        ],
        expose_headers: ["Content-Length", "Content-Type", "Set-Cookie", "X-Trace-Id", "X-Request-Id"],
        allow_credentials: true,
        max_age: "12h",
      },
      "telemetry/metrics": {
        collection_time: "60s",
        listen_address: "0.0.0.0:8090",
        router_disabled: false,
      },
    },
    endpoints,
  };
}

async function collectEndpoints() {
  const endpoints = [];
  const counts = { public: 0, auth: 0, collab: 0, media: 0, cache: 0, rateLimit: 0 };
  const ctx = { hosts, servicesRegistry, authHost: AUTH_HOST };
  const loaderOpts = {
    source: ENDPOINTS_SOURCE,
    timeoutMs: ENDPOINTS_HTTP_TIMEOUT_MS,
    baseDir: __dirname,
  };

  for (const s of servicesRegistry) {
    if (!s.manifestPath) continue;
    const sData = await loadServiceEndpoints(s, hosts[s.name], loaderOpts);

    for (const d of sData.endpoints) {
      if (d.endpoint === "/api/v1/health") continue;

      if (d.public === true) {
        d.host = d.host || s.name;
        endpoints.push(buildPublicEndpoint(d, ctx));
        counts.public++;
        if (d.rate_limit) counts.rateLimit++;
      } else {
        endpoints.push(buildAuthEndpoint(d, sData.host, ctx));
        if (s.name === "auth") counts.auth++;
        if (s.name === "collab") counts.collab++;
        if (s.name === "media") counts.media++;
        if (d.cache_ttl) counts.cache++;
      }
    }
  }

  endpoints.push(buildHealthCheckEndpoint());
  return { endpoints, counts };
}

async function main() {
  const compareIdx = process.argv.indexOf("--compare");
  if (compareIdx !== -1) {
    const oldPath = process.argv[compareIdx + 1];
    const newPath = process.argv[compareIdx + 2];
    if (!oldPath || !newPath) {
      console.error("Uso: node gateway/build-krakend.mjs --compare <oldManifestPath> <newManifestPath>");
      process.exit(1);
    }
    compareManifests(oldPath, newPath);
    return;
  }

  const outIdx = process.argv.indexOf("--output");
  const outputPath = outIdx !== -1 ? resolve(process.argv[outIdx + 1]) : DEFAULT_OUTPUT;

  const { endpoints, counts } = await collectEndpoints();
  const config = buildKrakendConfig(endpoints);

  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, JSON.stringify(config, null, 2) + "\n", "utf-8");

  const total = counts.public + counts.auth + counts.collab + counts.media;
  console.log(`✓ krakend.json generado: ${outputPath}`);
  console.log(`  Endpoints: ${total} (public:${counts.public} auth:${counts.auth} collab:${counts.collab} media:${counts.media})`);
  console.log(`  Edge caching: ${counts.cache} endpoints`);
  console.log(`  Circuit breaker: ${total} backends (todos)`);
  console.log(`  Rate limiting: ${counts.rateLimit} endpoints`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
