export const PUBLIC_HEADERS_BASE = [
  "Accept",
  "X-Forwarded-For",
  "X-Real-IP",
  "User-Agent",
  "X-Request-Id",
  "X-Trace-Id",
];

export const AUTH_HEADERS_BASE = [
  "Authorization",
  "Accept",
  "X-Forwarded-For",
  "X-Real-IP",
  "User-Agent",
  "X-Request-Id",
  "X-Trace-Id",
];

export const AUTH_HEADERS_WITH_BODY = ["Content-Type", ...AUTH_HEADERS_BASE];
export const BODY_METHODS = new Set(["POST", "PUT", "PATCH"]);

const CB_DEFAULTS = {
  interval: 60,
  timeout: 10,
  max_errors: 3,
  log_status_change: true,
};

export function extraBackendOpts() {
  return {};
}

export function jwtValidator(authHost) {
  return {
    "auth/validator": {
      alg: "RS256",
      jwk_url: `${authHost}/api/v1/.well-known/jwks.json`,
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

export function getCircuitBreakerConfig(serviceName, servicesRegistry = []) {
  const service = servicesRegistry.find((s) => s.name === serviceName);
  if (service?.circuitBreaker) {
    return { ...CB_DEFAULTS, ...service.circuitBreaker };
  }
  return CB_DEFAULTS;
}

export function parseTtl(ttl) {
  const match = ttl.match(/^(\d+)(s|m|h)$/);
  if (!match) return 60;
  const [, num, unit] = match;
  const n = parseInt(num, 10);
  if (unit === "s") return n;
  if (unit === "m") return n * 60;
  if (unit === "h") return n * 3600;
  return 60;
}

export function buildBackend(host, urlPattern, opts = {}) {
  const { def = {}, servicesRegistry = [] } = opts;
  const backend = {
    host: [host],
    url_pattern: urlPattern,
    encoding: "no-op",
    extra_config: extraBackendOpts(),
  };

  if (def.group) backend.group = def.group;

  const cbName = `cb-${urlPattern.replace(/[^a-zA-Z0-9]/g, "-").slice(0, 50)}`;
  const cbConfig = getCircuitBreakerConfig(def.serviceName, servicesRegistry);
  backend.extra_config["qos/circuit-breaker"] = {
    ...cbConfig,
    name: def.cb_name || cbName,
  };

  if (def.cache_ttl) {
    backend.extra_config["qos/http-cache"] = {};
    backend.extra_config["modifier/martian"] = { ...backend.extra_config["modifier/martian"] };
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

export function resolveServiceHost(service, hosts) {
  const name = service || "auth";
  const host = hosts[name];
  if (!host) {
    throw new Error(`Host de endpoint publico no soportado: ${name}`);
  }
  return host;
}

export function buildPublicEndpoint(def, ctx) {
  const headers = [...PUBLIC_HEADERS_BASE];
  if (BODY_METHODS.has(def.method)) headers.unshift("Content-Type");
  if (def.extra_headers) {
    for (const h of def.extra_headers) {
      if (!headers.includes(h)) headers.push(h);
    }
  }

  const host = resolveServiceHost(def.host, ctx.hosts);
  const backend = buildBackend(host, def.backend_url || def.endpoint, {
    def: { serviceName: def.host },
    servicesRegistry: ctx.servicesRegistry,
  });

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

export function buildAuthEndpoint(def, groupHost, ctx) {
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

  const host = resolveServiceHost(serviceName, ctx.hosts);
  const backend = buildBackend(host, def.backend_url || def.endpoint, {
    def: backendDef,
    servicesRegistry: ctx.servicesRegistry,
  });

  const endpoint = {
    endpoint: def.endpoint,
    method: def.method,
    output_encoding: "no-op",
    extra_config: jwtValidator(ctx.authHost),
    input_headers: headers,
    backend: [backend],
  };

  if (def.input_query_strings) {
    endpoint.input_query_strings = def.input_query_strings;
  }

  return endpoint;
}
