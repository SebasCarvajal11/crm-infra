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
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

const __dirname = dirname(fileURLToPath(import.meta.url));

const ENDPOINTS_DIR = resolve(__dirname, "endpoints");
const DEFAULT_OUTPUT = resolve(__dirname, "..", "krakend.json");

const GATEWAY_TRUST_SECRET =
  "cima-local-gateway-trust-secret-do-not-use-production-2026";

const AUTH_HOST = process.env.KRAKEND_AUTH_HOST || "http://host.docker.internal:3000";
const COLLAB_HOST = process.env.KRAKEND_COLLAB_HOST || "http://host.docker.internal:3001";

const AUTH_OPENAPI = resolve(__dirname, "..", "mod-auth", "openapi", "openapi.yaml");
const COLLAB_OPENAPI = resolve(__dirname, "..", "mod-collab", "openapi", "openapi.yaml");
const OPENAPI_OUTPUT = resolve(__dirname, "output", "openapi.yaml");

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

  let backend;
  if (def.static_file) {
    backend = {
      url_pattern: def.backend_url || def.endpoint,
      encoding: "no-op",
      extra_config: {
        "proxy/static-filesystem": {
          dir: "/etc/krakend/static",
        },
      },
    };
  } else {
    backend = buildBackend(AUTH_HOST, def.backend_url || def.endpoint);
  }

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

// ── Loader ─────────────────────────────────────────────────────────────────────

const AUTH_HEADERS_WITH_BODY = ["Content-Type", ...AUTH_HEADERS_BASE];

function loadEndpoints(filename) {
  return JSON.parse(readFileSync(resolve(ENDPOINTS_DIR, filename), "utf-8"));
}

// ── OpenAPI Consolidado ────────────────────────────────────────────────────────

function buildRouteMap(endpointsDef) {
  const map = new Map();
  for (const def of endpointsDef) {
    const publicPath = def.endpoint;
    const backendUrl = def.backend_url || def.endpoint;
    if (publicPath !== backendUrl) {
      map.set(backendUrl, publicPath);
    }
  }
  return map;
}

function remapCollabPaths(collabPaths, routeMap) {
  const remapped = {};
  for (const [internalPath, pathItem] of Object.entries(collabPaths)) {
    const publicPath = routeMap.get(internalPath) || internalPath;
    remapped[publicPath] = pathItem;
  }
  return remapped;
}

function generateOpenAPI() {
  const authSpec = parseYaml(readFileSync(AUTH_OPENAPI, "utf-8"));
  const collabSpec = parseYaml(readFileSync(COLLAB_OPENAPI, "utf-8"));

  const collabDef = loadEndpoints("collab.json");
  const routeMap = buildRouteMap(collabDef.endpoints);

  const authPaths = { ...authSpec.paths };
  const collabPaths = remapCollabPaths(collabSpec.paths, routeMap);

  const mergedPaths = { ...authPaths, ...collabPaths };

  const mergedSchemas = {
    ...(authSpec.components?.schemas || {}),
    ...(collabSpec.components?.schemas || {}),
  };

  const mergedSecuritySchemes = {
    ...(authSpec.components?.securitySchemes || {}),
    ...(collabSpec.components?.securitySchemes || {}),
  };

  const mergedParameters = {
    ...(authSpec.components?.parameters || {}),
    ...(collabSpec.components?.parameters || {}),
  };

  const mergedResponses = {
    ...(authSpec.components?.responses || {}),
    ...(collabSpec.components?.responses || {}),
  };

  const consolidated = {
    openapi: "3.0.3",
    info: {
      title: "CIMA CRM API Gateway",
      description:
        "Especificación consolidada del API Gateway (KrakenD). " +
        "Documenta todas las rutas públicas expuestas al frontend, " +
        "combinando los módulos de autenticación y colaboración.",
      version: "1.0.0",
      license: {
        name: "Proyecto academico CIMA CRM",
      },
    },
    servers: [
      {
        url: "http://localhost:8080",
        description: "KrakenD — entrada unica para el SPA",
      },
    ],
    tags: [
      ...(authSpec.tags || []),
      ...(collabSpec.tags || []),
      { name: "BFF", description: "Backend For Frontend — agregaciones" },
    ],
    security: [{ BearerAuth: [] }],
    paths: mergedPaths,
    components: {
      securitySchemes: mergedSecuritySchemes,
      schemas: mergedSchemas,
      parameters: mergedParameters,
      responses: mergedResponses,
    },
  };

  mkdirSync(dirname(OPENAPI_OUTPUT), { recursive: true });
  writeFileSync(OPENAPI_OUTPUT, stringifyYaml(consolidated, { lineWidth: 120 }) + "\n", "utf-8");

  const pathCount = Object.keys(mergedPaths).length;
  const schemaCount = Object.keys(mergedSchemas).length;
  console.log(`✓ openapi.yaml consolidado: ${OPENAPI_OUTPUT}`);
  console.log(`  Paths: ${pathCount} | Schemas: ${schemaCount}`);
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

  generateOpenAPI();
}

main();
