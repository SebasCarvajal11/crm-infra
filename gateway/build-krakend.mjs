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

const GATEWAY_TRUST_SECRET = requiredEnv("GATEWAY_TRUST_SECRET");
const AUTH_HOST = requiredUrlEnv("KRAKEND_AUTH_HOST");
const COLLAB_HOST = requiredUrlEnv("KRAKEND_COLLAB_HOST");
const MEDIA_HOST = requiredUrlEnv("KRAKEND_MEDIA_HOST");
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

function requiredUrlEnv(name) {
  const value = requiredEnv(name).replace(/\/+$/, "");
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

function gatewayTrustExtra() {
  return {
    "modifier/martian": {
      "header.Modifier": {
        scope: ["request"],
        name: "X-Gateway-Trust",
        value: GATEWAY_TRUST_SECRET,
      },
    },
  };
}

function jwtValidator() {
  return {
    "auth/validator": {
      alg: "RS256",
      jwk_url: `${AUTH_HOST}/.well-known/jwks.json`,
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

// â”€â”€ Builders â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function buildBackend(host, urlPattern, def = {}) {
  const backend = {
    host: [host],
    url_pattern: urlPattern,
    encoding: "no-op",
    extra_config: gatewayTrustExtra(),
  };

  if (def.allow) {
    backend.allow = def.allow;
  }
  if (def.deny) {
    backend.deny = def.deny;
  }
  if (def.group) {
    backend.group = def.group;
  }

  // Circuit breaker
  const cbName = `cb-${urlPattern.replace(/[^a-zA-Z0-9]/g, "-").slice(0, 50)}`;
  backend.extra_config["qos/circuit-breaker"] = {
    ...CB_DEFAULTS,
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
  switch (service) {
    case undefined:
    case "auth":
      return AUTH_HOST;
    case "collab":
      return COLLAB_HOST;
    case "media":
      return MEDIA_HOST;
    default:
      throw new Error(`Host de endpoint publico no soportado: ${service}`);
  }
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

  const backend = buildBackend(resolveServiceHost(def.host), def.backend_url || def.endpoint);

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

  const backendDef = {};
  if (def.allow) backendDef.allow = def.allow;
  if (def.deny) backendDef.deny = def.deny;
  if (def.cache_ttl) backendDef.cache_ttl = def.cache_ttl;

  const host = def.host || groupHost;

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

function buildBffEndpoint(def) {
  const headers = BODY_METHODS.has(def.method)
    ? [...AUTH_HEADERS_WITH_BODY]
    : [...AUTH_HEADERS_BASE];

  const backends = def.backends.map((b) => {
    const backendDef = { group: b.group };
    if (b.allow) backendDef.allow = b.allow;
    if (b.deny) backendDef.deny = b.deny;
    if (b.cache_ttl) backendDef.cache_ttl = b.cache_ttl;
    backendDef.cb_name = `cb-bff-${b.url_pattern.replace(/[^a-zA-Z0-9]/g, "-").slice(0, 40)}`;

    const host = b.host || (b.url_pattern.startsWith("/collab/") ? COLLAB_HOST : AUTH_HOST);
    const backend = buildBackend(host, b.url_pattern, backendDef);
    if (b.encoding) {
      backend.encoding = b.encoding;
    } else {
      backend.encoding = "json";
    }
    return backend;
  });

  const endpoint = {
    endpoint: def.endpoint,
    method: def.method || "GET",
    timeout: def.timeout || "3s",
    output_encoding: "json",
    extra_config: jwtValidator(),
    input_headers: headers,
    backend: backends,
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
  return (process.env[envName]?.trim() || `${defaultHost}/_gateway/endpoints.json`).replace(/\/+$/, "");
}

async function fetchJsonWithTimeout(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ENDPOINTS_HTTP_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      headers: { Accept: "application/json" },
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

function loadServiceEndpointsFromFile(serviceName, defaultHost) {
  const hostPath = resolve(__dirname, "..", "..", `crm-${serviceName}`, "gateway", "endpoints.json");
  const dockerPath = resolve(__dirname, "..", `crm-${serviceName}`, "gateway", "endpoints.json");

  let rawData;
  try {
    rawData = readFileSync(hostPath, "utf-8");
  } catch {
    try {
      rawData = readFileSync(dockerPath, "utf-8");
    } catch (err) {
      throw new Error(`No se pudo leer endpoints.json para crm-${serviceName} en ${hostPath} ni en ${dockerPath}: ${err.message}`);
    }
  }

  const data = JSON.parse(rawData);
  return {
    host: data.host || defaultHost,
    endpoints: data.endpoints || []
  };
}

async function loadServiceEndpoints(serviceName, defaultHost) {
  if (ENDPOINTS_SOURCE !== "file") {
    const url = serviceEndpointsUrl(serviceName, defaultHost);

    try {
      const data = await fetchJsonWithTimeout(url);
      return {
        host: data.host || defaultHost,
        endpoints: data.endpoints || [],
      };
    } catch (err) {
      if (ENDPOINTS_SOURCE === "http") {
        throw new Error(`No se pudo descargar endpoints.json de crm-${serviceName} desde ${url}: ${err.message}`);
      }
      console.warn(`No se pudo descargar endpoints.json de crm-${serviceName} desde ${url}. Se usara fallback por archivo: ${err.message}`);
    }
  }

  return loadServiceEndpointsFromFile(serviceName, defaultHost);
}

function loadBffEndpoints() {
  const bffPath = resolve(__dirname, "bff.json");
  try {
    const data = JSON.parse(readFileSync(bffPath, "utf-8"));
    return data.endpoints || [];
  } catch (err) {
    throw new Error(`Error al cargar endpoints BFF: ${err.message}`);
  }
}


// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const outputArg = process.argv.indexOf("--output");
  const outputPath =
    outputArg !== -1 ? resolve(process.argv[outputArg + 1]) : DEFAULT_OUTPUT;

  const authData = await loadServiceEndpoints("auth", AUTH_HOST);
  const collabData = await loadServiceEndpoints("collab", COLLAB_HOST);
  const mediaData = await loadServiceEndpoints("media", MEDIA_HOST);
  const bffEndpoints = loadBffEndpoints();

  let publicCount = 0;
  let authCount = 0;
  let collabCount = 0;
  let mediaCount = 0;
  let bffCount = 0;
  let withAllow = 0;
  let withCache = 0;
  let publicRateLimitCount = 0;

  const endpoints = [];

  function processEndpoints(list, serviceHost, serviceName) {
    for (const d of list) {
      if (d.backends) {
        endpoints.push(buildBffEndpoint(d));
        bffCount++;
      } else if (d.public === true) {
        d.host = d.host || serviceName;
        endpoints.push(buildPublicEndpoint(d));
        publicCount++;
        if (d.rate_limit) {
          publicRateLimitCount++;
        }
      } else {
        endpoints.push(buildAuthEndpoint(d, serviceHost));
        if (serviceName === "auth") authCount++;
        if (serviceName === "collab") collabCount++;
        if (serviceName === "media") mediaCount++;
        if (d.allow) withAllow++;
        if (d.cache_ttl) withCache++;
      }
    }
  }

  processEndpoints(authData.endpoints, authData.host, "auth");
  processEndpoints(collabData.endpoints, collabData.host, "collab");
  processEndpoints(mediaData.endpoints, mediaData.host, "media");
  processEndpoints(bffEndpoints, undefined, "bff");

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
    },
    endpoints,
  };

  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, JSON.stringify(config, null, 2) + "\n", "utf-8");

  const total = publicCount + authCount + collabCount + mediaCount + bffCount;

  console.log(`✓ krakend.json generado: ${outputPath}`);
  console.log(`  Endpoints: ${total} (public:${publicCount} auth:${authCount} collab:${collabCount} media:${mediaCount} bff:${bffCount})`);
  console.log(`  Response filtering (allow): ${withAllow} endpoints`);
  console.log(`  Edge caching: ${withCache} endpoints`);
  console.log(`  Circuit breaker: ${total} backends (todos)`);
  console.log(`  Rate limiting: ${publicRateLimitCount} endpoints`);

}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
