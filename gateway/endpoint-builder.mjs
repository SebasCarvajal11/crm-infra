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
  "X-User-Sub",
  "X-User-Id",
  "X-User-Role",
  "X-User-Email",
  "X-Forwarded-For",
  "X-Real-IP",
  "User-Agent",
  "X-Token-Exp",
  "X-Request-Id",
  "X-Trace-Id",
];

export const AUTH_HEADERS_WITH_BODY = ["Content-Type", ...AUTH_HEADERS_BASE];
export const BODY_METHODS = new Set(["POST", "PUT", "PATCH"]);

const CB_DEFAULTS = {
  interval: 30,
  timeout: 10,
  max_errors: 30,
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

export const DEFAULT_AUTH_RATE_LIMIT = {
  client_max_rate: 600,
  client_capacity: 600,
  every: "1m",
  strategy: "ip",
};

export function resolveEndpointRateLimit(rateLimitDef, isAuth = false) {
  if (rateLimitDef === false) return null;
  if (rateLimitDef && typeof rateLimitDef === "object") return rateLimitDef;
  if (isAuth) return DEFAULT_AUTH_RATE_LIMIT;
  return null;
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
  const backendDef = { serviceName: def.host };
  if (def.cache_ttl) backendDef.cache_ttl = def.cache_ttl;
  if (def.cb_name) backendDef.cb_name = def.cb_name;

  const backend = buildBackend(host, def.backend_url || def.endpoint, {
    def: backendDef,
    servicesRegistry: ctx.servicesRegistry,
  });

  const endpoint = {
    endpoint: def.endpoint,
    method: def.method,
    output_encoding: "no-op",
    input_headers: headers,
    backend: [backend],
  };

  const rateLimit = resolveEndpointRateLimit(def.rate_limit, false);
  if (rateLimit) {
    endpoint.extra_config = {
      ...(endpoint.extra_config || {}),
      "qos/ratelimit/router": rateLimit,
    };
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

  const rateLimit = resolveEndpointRateLimit(def.rate_limit, true);
  const extraConfig = {
    ...jwtValidator(ctx.authHost),
  };
  if (rateLimit) {
    extraConfig["qos/ratelimit/router"] = rateLimit;
  }

  const endpoint = {
    endpoint: def.endpoint,
    method: def.method,
    output_encoding: "no-op",
    extra_config: extraConfig,
    input_headers: headers,
    backend: [backend],
  };

  if (def.input_query_strings) {
    endpoint.input_query_strings = def.input_query_strings;
  }

  return endpoint;
}

export const HEALTH_CB_CONFIG = {
  interval: 10,
  timeout: 5,
  max_errors: 3,
  log_status_change: true,
};

export const DEFAULT_HEALTH_TIMEOUT = "3s";

export function buildHealthCheckEndpoint(servicesRegistry = [], hosts = {}) {
  const timeout = process.env.GATEWAY_HEALTH_TIMEOUT?.trim() || DEFAULT_HEALTH_TIMEOUT;
  const healthBackends = servicesRegistry
    .filter((s) => s.manifestPath)
    .map((s) => ({
      host: [hosts[s.name] || `http://${s.name}:3000`],
      url_pattern: s.healthPath || "/api/v1/health",
      group: s.name,
      extra_config: {
        ...extraBackendOpts(),
        "qos/circuit-breaker": {
          ...HEALTH_CB_CONFIG,
          name: `cb-health-${s.name}`,
        },
      },
    }));

  return {
    endpoint: "/api/v1/health",
    method: "GET",
    output_encoding: "json",
    timeout,
    input_headers: [...PUBLIC_HEADERS_BASE],
    backend: healthBackends,
  };
}
