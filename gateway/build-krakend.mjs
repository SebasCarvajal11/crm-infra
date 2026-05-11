#!/usr/bin/env node
/**
 * build-krakend.mjs — Genera krakend.json desde templates y listas de endpoints.
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
 *   node gateway/build-krakend.mjs --output gateway/output/krakend.json
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const ENDPOINTS_DIR = resolve(__dirname, "endpoints");
const DEFAULT_OUTPUT = resolve(__dirname, "..", "krakend.json");

const GATEWAY_TRUST_SECRET =
  "cima-local-gateway-trust-secret-do-not-use-production-2026";

const AUTH_HOST = "http://mod-auth:3000";
const COLLAB_HOST = "http://mod-auth:3001";

// ── Templates ──────────────────────────────────────────────────────────────────

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
      jwk_url: "http://mod-auth:3000/.well-known/jwks.json",
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

const PUBLIC_HEADERS_BASE = ["Accept", "X-Forwarded-For", "X-Real-IP", "User-Agent"];
const AUTH_HEADERS_BASE = [
  "Authorization", "Accept", "X-User-Sub", "X-User-Id", "X-User-Role",
  "X-User-Email", "X-Forwarded-For", "X-Real-IP", "User-Agent", "X-Token-Exp",
];
const BODY_METHODS = new Set(["POST", "PUT", "PATCH"]);

// ── Circuit Breaker defaults ───────────────────────────────────────────────────

const CB_DEFAULTS = {
  interval: 60,
  timeout: 10,
  max_errors: 3,
  log_status_change: true,
};

// ── Builders ───────────────────────────────────────────────────────────────────

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

  const endpoint = {
    endpoint: def.endpoint,
    method: def.method,
    output_encoding: "no-op",
    input_headers: headers,
    backend: [buildBackend(AUTH_HOST, def.backend_url || def.endpoint)],
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

    const backend = buildBackend(b.host, b.url_pattern, backendDef);
    if (b.encoding) {
      backend.encoding = b.encoding;
    } else {
      backend.encoding = "json";
    }
    return backend;
  });

  return {
    endpoint: def.endpoint,
    method: def.method || "GET",
    timeout: def.timeout || "3s",
    output_encoding: "json",
    extra_config: jwtValidator(),
    input_headers: headers,
    backend: backends,
  };
}

// ── Loader ─────────────────────────────────────────────────────────────────────

const AUTH_HEADERS_WITH_BODY = ["Content-Type", ...AUTH_HEADERS_BASE];

function loadEndpoints(filename) {
  return JSON.parse(readFileSync(resolve(ENDPOINTS_DIR, filename), "utf-8"));
}

// ── Main ───────────────────────────────────────────────────────────────────────

function main() {
  const outputArg = process.argv.indexOf("--output");
  const outputPath =
    outputArg !== -1 ? resolve(process.argv[outputArg + 1]) : DEFAULT_OUTPUT;

  const publicDef = loadEndpoints("public.json");
  const authDef = loadEndpoints("auth.json");
  const collabDef = loadEndpoints("collab.json");
  const bffDef = loadEndpoints("bff.json");

  const endpoints = [
    ...publicDef.endpoints.map(buildPublicEndpoint),
    ...authDef.endpoints.map((d) => buildAuthEndpoint(d, authDef.host || AUTH_HOST)),
    ...collabDef.endpoints.map((d) => buildAuthEndpoint(d, collabDef.host || COLLAB_HOST)),
    ...bffDef.endpoints.map(buildBffEndpoint),
  ];

  const config = {
    $schema: "https://www.krakend.io/schema/v3.json",
    version: 3,
    name: "CIMA CRM API Gateway",
    port: 8080,
    timeout: "30s",
    extra_config: {
      "security/cors": {
        allow_origins: ["http://localhost:5173", "http://127.0.0.1:5173"],
        allow_methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        allow_headers: [
          "Origin", "Authorization", "Content-Type", "Cookie",
          "Accept", "X-Requested-With",
        ],
        expose_headers: ["Content-Length", "Content-Type", "Set-Cookie"],
        allow_credentials: true,
        max_age: "12h",
      },
    },
    endpoints,
  };

  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, JSON.stringify(config, null, 2) + "\n", "utf-8");

  const publicCount = publicDef.endpoints.length;
  const authCount = authDef.endpoints.length;
  const collabCount = collabDef.endpoints.length;
  const bffCount = bffDef.endpoints.length;
  const total = publicCount + authCount + collabCount + bffCount;

  const withAllow = [...authDef.endpoints, ...collabDef.endpoints].filter((e) => e.allow).length;
  const withCache = [...collabDef.endpoints].filter((e) => e.cache_ttl).length;

  console.log(`✓ krakend.json generado: ${outputPath}`);
  console.log(`  Endpoints: ${total} (public:${publicCount} auth:${authCount} collab:${collabCount} bff:${bffCount})`);
  console.log(`  Response filtering (allow): ${withAllow} endpoints`);
  console.log(`  Edge caching: ${withCache} endpoints`);
  console.log(`  Circuit breaker: ${total} backends (todos)`);
  console.log(`  Rate limiting: ${publicDef.endpoints.filter((e) => e.rate_limit).length} endpoints`);
}

main();
