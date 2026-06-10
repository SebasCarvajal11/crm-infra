#!/usr/bin/env node
/**
 * build-krakend.mjs â€” Genera krakend.json desde templates y listas de endpoints.
 *
 * Soporta:
 * - JWT validator inyectado automaticamente en endpoints autenticados
 * - Gateway-trust (Martian) en cada backend
 * - allow/deny lists para filtrado de respuestas (payload pruning)
 * - qos/circuit-breaker en backends
 * - qos/http-cache en backends de lectura
 * - Rate limiting por endpoint
 * - BFF con multiples backends
 *
 * Uso:
 *   node gateway/build-krakend.mjs
 *   node gateway/build-krakend.mjs --output deploy/runtime/krakend.json
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_OUTPUT = resolve(__dirname, "..", "krakend.json");

const servicesRegistryPath = resolve(__dirname, "..", "registry", "services.json");
const servicesRegistry = JSON.parse(readFileSync(servicesRegistryPath, "utf-8"));

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

function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} es requerida para generar krakend.json`);
  }
  return value;
}

function optionalUrlEnv(name, fallback) {
  const value = (process.env[name]?.trim() || fallback).replace(/\/+$/, "");
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol)) {
      throw new Error("protocolo invalido");
    }
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

// â”€â”€ Templates â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function extraBackendOpts() {
  return {};
}

function jwtValidator() {
  return {
    "auth/validator": {
      alg: "RS256",
      jwk_url: `${AUTH_HOST}/api/v1/.well-known/jwks.json`,
      cache: true,
      cache_duration: 900,
      disable_jwk_security: true,
      propagate_claims: [
        ["sub", "X-User-Sub"],
        ["userId", "X-User-Id"],
        ["role", "X-User-Role"],
        ["email", "X-User-Email"],
        ["exp", "X-Token-Exp"],
      ],
    },
  };
}

const PUBLIC_HEADERS_BASE = ["Accept", "X-Forwarded-For", "X-Real-IP", "User-Agent", "X-Request-Id", "X-Trace-Id"];
const AUTH_HEADERS_BASE = [
  "Authorization", "Accept", "X-User-Sub", "X-User-Id", "X-User-Role",
  "X-User-Email", "X-Forwarded-For", "X-Real-IP", "User-Agent", "X-Token-Exp", "X-Request-Id", "X-Trace-Id",
];
const BODY_METHODS = new Set(["POST", "PUT", "PATCH"]);

// â”€â”€ Circuit Breaker defaults â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const CB_DEFAULTS = {
  interval: 60,
  timeout: 10,
  max_errors: 3,
  log_status_change: true,
};

function getCircuitBreakerConfig(serviceName) {
  const s = servicesRegistry.find(x => x.name === serviceName);
  if (s && s.circuitBreaker) {
    return {
      ...CB_DEFAULTS,
      ...s.circuitBreaker,
    };
  }
  return CB_DEFAULTS;
}

// â”€â”€ Builders â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function buildBackend(host, urlPattern, def = {}) {
  const backend = {
    host: [host],
    url_pattern: urlPattern,
    encoding: "no-op",
    extra_config: extraBackendOpts(),
  };

  if (def.group) {
    backend.group = def.group;
  }

  // Circuit breaker
  const cbName = `cb-${urlPattern.replace(/[^a-zA-Z0-9]/g, "-").slice(0, 50)}`;
  const cbConfig = getCircuitBreakerConfig(def.serviceName);
  backend.extra_config["qos/circuit-breaker"] = {
    ...cbConfig,
    name: def.cb_name || cbName,
  };

  // Edge cache
  if (def.cache_ttl) {
    backend.extra_config["qos/http-cache"] = {};
    backend.extra_config["modifier/martian"] = {
      ...backend.extra_config["modifier/martian"],
    };
    // Override Cache-Control on response to enable caching
    backend.extra_config["modifier/response-headers"] = {
      "header.Modifier": {
        scope: ["response"],
        name: "Cache-Control",
        value: `max-age=${parseTtl(def.cache_ttl)}, public`,
      },
    };
  }

  return backend;
}

function resolveServiceHost(service) {
  const name = service || "auth";
  const host = hosts[name];
  if (!host) {
    throw new Error(`Host de endpoint publico no soportado: ${name}`);
  }
  return host;
}

function parseTtl(ttl) {
  const match = ttl.match(/^(\d+)(s|m|h)$/);
  if (!match) return 60;
  const [, num, unit] = match;
  const n = parseInt(num, 10);
  if (unit === "s") return n;
  if (unit === "m") return n * 60;
  if (unit === "h") return n * 3600;
  return 60;
}

function buildPublicEndpoint(def) {
  const headers = [...PUBLIC_HEADERS_BASE];
  if (BODY_METHODS.has(def.method)) headers.unshift("Content-Type");
  if (def.extra_headers) {
    for (const h of def.extra_headers) {
      if (!headers.includes(h)) headers.push(h);
    }
  }

  const backend = buildBackend(resolveServiceHost(def.host), def.backend_url || def.endpoint, { serviceName: def.host });

  const endpoint = {
    endpoint: def.endpoint,
    method: def.method,
    output_encoding: "no-op",
    input_headers: headers,
    backend: [backend],
  };

  if (def.rate_limit) {
    endpoint.extra_config = { "qos/ratelimit/router": def.rate_limit };
  }

  return endpoint;
}

function buildAuthEndpoint(def, groupHost) {
  const headers = BODY_METHODS.has(def.method)
    ? [...AUTH_HEADERS_WITH_BODY]
    : [...AUTH_HEADERS_BASE];

  if (def.extra_headers) {
    for (const h of def.extra_headers) {
      if (!headers.includes(h)) headers.push(h);
    }
  }

  const serviceName = def.host || groupHost;
  const backendDef = { serviceName };
  if (def.cache_ttl) backendDef.cache_ttl = def.cache_ttl;

  const host = resolveServiceHost(serviceName);

  const endpoint = {
    endpoint: def.endpoint,
    method: def.method,
    output_encoding: "no-op",
    extra_config: jwtValidator(),
    input_headers: headers,
    backend: [buildBackend(host, def.backend_url || def.endpoint, backendDef)],
  };

  if (def.input_query_strings) {
    endpoint.input_query_strings = def.input_query_strings;
  }

  return endpoint;
}



// ── Loader ───────────────────────────────────────────────────────────────────

const AUTH_HEADERS_WITH_BODY = ["Content-Type", ...AUTH_HEADERS_BASE];

function serviceEndpointsUrl(serviceName, defaultHost) {
  const envName = `KRAKEND_${serviceName.toUpperCase()}_ENDPOINTS_URL`;
  return (process.env[envName]?.trim() || `${defaultHost}/api/v1/_gateway/gateway.manifest.json`).replace(/\/+$/, "");
}

async function fetchJsonWithTimeout(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ENDPOINTS_HTTP_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      headers: { 
        Accept: "application/json"
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

function loadServiceEndpointsFromFile(service, defaultHost) {
  const hostPath = resolve(__dirname, "..", "..", service.manifestPath);
  const dockerPath = resolve(__dirname, "..", service.manifestPath);

  let rawData;
  try {
    rawData = readFileSync(hostPath, "utf-8");
  } catch {
    try {
      rawData = readFileSync(dockerPath, "utf-8");
    } catch (err) {
      throw new Error(`No se pudo leer gateway.manifest.json para crm-${service.name} en ${hostPath} ni en ${dockerPath}: ${err.message}`);
    }
  }

  const data = JSON.parse(rawData);
  return {
    host: data.service || data.host || defaultHost,
    endpoints: data.endpoints || []
  };
}

async function loadServiceEndpoints(service, defaultHost) {
  if (ENDPOINTS_SOURCE !== "file") {
    const url = serviceEndpointsUrl(service.name, defaultHost);

    try {
      const data = await fetchJsonWithTimeout(url);
      return {
        host: data.service || data.host || defaultHost,
        endpoints: data.endpoints || [],
      };
    } catch (err) {
      if (ENDPOINTS_SOURCE === "http") {
        throw new Error(`No se pudo descargar gateway.manifest.json de crm-${service.name} desde ${url}: ${err.message}`);
      }
      console.warn(`No se pudo descargar gateway.manifest.json de crm-${service.name} desde ${url}. Se usara fallback por archivo: ${err.message}`);
    }
  }

  return loadServiceEndpointsFromFile(service, defaultHost);
}


// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const compareArg = process.argv.indexOf("--compare");
  if (compareArg !== -1) {
    const oldPath = process.argv[compareArg + 1];
    const newPath = process.argv[compareArg + 2];
    if (!oldPath || !newPath) {
      console.error("Uso: node gateway/build-krakend.mjs --compare <oldManifestPath> <newManifestPath>");
      process.exit(1);
    }
    compareManifests(oldPath, newPath);
    return;
  }

  const outputArg = process.argv.indexOf("--output");
  const outputPath =
    outputArg !== -1 ? resolve(process.argv[outputArg + 1]) : DEFAULT_OUTPUT;

  let publicCount = 0;
  let authCount = 0;
  let collabCount = 0;
  let mediaCount = 0;
  let withCache = 0;
  let publicRateLimitCount = 0;

  const endpoints = [];

  for (const s of servicesRegistry) {
    if (!s.manifestPath) continue;
    const sHost = hosts[s.name];
    const sData = await loadServiceEndpoints(s, sHost);

    for (const d of sData.endpoints) {
      if (d.endpoint === "/api/v1/health") {
        continue;
      }
      if (d.public === true) {
        d.host = d.host || s.name;
        endpoints.push(buildPublicEndpoint(d));
        publicCount++;
        if (d.rate_limit) {
          publicRateLimitCount++;
        }
      } else {
        endpoints.push(buildAuthEndpoint(d, sData.host));
        if (s.name === "auth") authCount++;
        if (s.name === "collab") collabCount++;
        if (s.name === "media") mediaCount++;
        if (d.cache_ttl) withCache++;
      }
    }
  }

  // Inject aggregated health check endpoint dynamically
  const healthBackends = servicesRegistry
    .filter(s => s.manifestPath)
    .map(s => ({
      host: [hosts[s.name]],
      url_pattern: "/api/v1/health",
      group: s.name,
      extra_config: {
        ...extraBackendOpts(),
        "qos/circuit-breaker": {
          ...getCircuitBreakerConfig(s.name),
          name: `cb-health-${s.name}`
        }
      }
    }));


  endpoints.push({
    endpoint: "/api/v1/health",
    method: "GET",
    output_encoding: "json",
    input_headers: [...PUBLIC_HEADERS_BASE],
    backend: healthBackends
  });

  const config = {
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
        "collection_time": "60s",
        "listen_address": "0.0.0.0:8090",
        "router_disabled": false
      },
    },
    endpoints,
  };

  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, JSON.stringify(config, null, 2) + "\n", "utf-8");

  const total = publicCount + authCount + collabCount + mediaCount;

  console.log(`✓ krakend.json generado: ${outputPath}`);
  console.log(`  Endpoints: ${total} (public:${publicCount} auth:${authCount} collab:${collabCount} media:${mediaCount})`);
  // Response filtering has been moved to service layer
  console.log(`  Edge caching: ${withCache} endpoints`);
  console.log(`  Circuit breaker: ${total} backends (todos)`);
  console.log(`  Rate limiting: ${publicRateLimitCount} endpoints`);

}

function compareManifests(oldPath, newPath) {
  let oldManifest, newManifest;
  try {
    oldManifest = JSON.parse(readFileSync(oldPath, "utf-8"));
  } catch (err) {
    console.error(`Error al leer el manifiesto antiguo en ${oldPath}: ${err.message}`);
    process.exit(1);
  }

  try {
    newManifest = JSON.parse(readFileSync(newPath, "utf-8"));
  } catch (err) {
    console.error(`Error al leer el nuevo manifiesto en ${newPath}: ${err.message}`);
    process.exit(1);
  }

  const oldEndpoints = oldManifest.endpoints || [];
  const newEndpoints = newManifest.endpoints || [];

  const oldMap = new Map();
  for (const ep of oldEndpoints) {
    oldMap.set(`${ep.method} ${ep.endpoint}`, ep);
  }

  const newMap = new Map();
  for (const ep of newEndpoints) {
    newMap.set(`${ep.method} ${ep.endpoint}`, ep);
  }

  const added = [];
  const removed = [];
  const changed = [];
  const breaking = [];

  for (const [key, ep] of newMap.entries()) {
    if (!oldMap.has(key)) {
      added.push(ep);
    } else {
      const oldEp = oldMap.get(key);
      const changes = getEndpointChanges(oldEp, ep);
      if (changes.length > 0) {
        changed.push({ endpoint: ep, changes });
        const breakingChanges = getBreakingChanges(oldEp, ep, changes);
        if (breakingChanges.length > 0) {
          breaking.push({ endpoint: ep, breakingChanges });
        }
      }
    }
  }

  for (const [key, ep] of oldMap.entries()) {
    if (!newMap.has(key)) {
      removed.push(ep);
      breaking.push({ endpoint: ep, breakingChanges: [`El endpoint '${ep.method} ${ep.endpoint}' fue eliminado.`] });
    }
  }

  console.log(`\n### Reporte de cambios de manifiesto para el servicio "${newManifest.service || oldManifest.service || "unknown"}"`);
  console.log(`Versión antigua: ${oldManifest.version || "N/A"} -> Versión nueva: ${newManifest.version || "N/A"}\n`);

  if (breaking.length > 0) {
    console.error(`⚠️  **CAMBIOS INCOMPATIBLES DETECTADOS (BREAKING CHANGES)**:`);
    for (const b of breaking) {
      console.error(`- **${b.endpoint.method} ${b.endpoint.endpoint}**:`);
      for (const msg of b.breakingChanges) {
        console.error(`  - ❌ ${msg}`);
      }
    }
    console.error("");
  } else {
    console.log(`✅ No se detectaron cambios incompatibles (breaking changes).\n`);
  }

  if (added.length > 0) {
    console.log(`➕ **Endpoints añadidos**:`);
    for (const ep of added) {
      console.log(`- \`${ep.method} ${ep.endpoint}\` (Público: ${ep.public ? "Sí" : "No"})`);
    }
    console.log("");
  }

  if (removed.length > 0) {
    console.log(`➖ **Endpoints eliminados**:`);
    for (const ep of removed) {
      console.log(`- \`${ep.method} ${ep.endpoint}\``);
    }
    console.log("");
  }

  if (changed.length > 0) {
    console.log(`📝 **Endpoints modificados**:`);
    for (const c of changed) {
      const isBreakingOnly = breaking.some(b => b.endpoint === c.endpoint && b.breakingChanges.length === c.changes.length);
      if (!isBreakingOnly) {
        console.log(`- **${c.endpoint.method} ${c.endpoint.endpoint}**:`);
        for (const msg of c.changes) {
          // If this change message is a breaking change, skip it here since it's already shown in breaking section
          const isBreakingMsg = breaking.some(b => b.endpoint === c.endpoint && b.breakingChanges.some(bm => bm.includes(msg.split(" ")[0])));
          if (!isBreakingMsg) {
            console.log(`  - ${msg}`);
          }
        }
      }
    }
    console.log("");
  }

  if (breaking.length > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

function getEndpointChanges(oldEp, newEp) {
  const changes = [];

  if (oldEp.backend_url !== newEp.backend_url) {
    changes.push(`URL backend cambió de '${oldEp.backend_url}' a '${newEp.backend_url}'`);
  }
  if (oldEp.public !== newEp.public) {
    changes.push(`Visibilidad pública cambió de '${oldEp.public}' a '${newEp.public}'`);
  }
  if (JSON.stringify(oldEp.rate_limit) !== JSON.stringify(newEp.rate_limit)) {
    changes.push(`Configuración de rate limiting modificada.`);
  }

  // allow/deny diff ignored at gateway level as filtering is handled at service level

  const oldQueries = oldEp.input_query_strings || [];
  const newQueries = newEp.input_query_strings || [];
  if (JSON.stringify(oldQueries) !== JSON.stringify(newQueries)) {
    changes.push(`Query strings de entrada modificados.`);
  }

  return changes;
}

function getBreakingChanges(oldEp, newEp, changes) {
  const breaking = [];

  if (oldEp.public === true && newEp.public !== true) {
    breaking.push("El endpoint pasó de ser público a requerir autenticación JWT.");
  }

  // allow/deny breaking changes ignored at gateway level as filtering is handled at service level

  return breaking;
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
