export const DEFAULT_LOGGING = {
  driver: "json-file",
  options: {
    "max-size": "10m",
    "max-file": "3",
  },
};

export const DEFAULT_CONTAINER_LIMITS = {
  frontend: "256m",
  apiGateway: "256m",
  nodeService: "512m",
  javaService: "768m",
  nodeWorker: "256m",
  mediaWorker: "384m",
  postgres: "1024m",
  redis: "256m",
  clamav: "1536m",
  edgeProxy: "128m",
};

export function resolveServiceMemoryLimit(service) {
  if (service.memLimit) return service.memLimit;
  if (service.name === "frontend") return DEFAULT_CONTAINER_LIMITS.frontend;
  if (service.name === "marketing") return DEFAULT_CONTAINER_LIMITS.javaService;
  return DEFAULT_CONTAINER_LIMITS.nodeService;
}

export function resolveWorkerMemoryLimit(serviceName, worker = {}) {
  if (worker.memLimit) return worker.memLimit;
  if (serviceName === "media") return DEFAULT_CONTAINER_LIMITS.mediaWorker;
  return DEFAULT_CONTAINER_LIMITS.nodeWorker;
}

export function buildLocalDbPasswordEnv(grants = []) {
  return Object.fromEntries(
    grants.map((grant) => [
      grant.passwordEnvVar,
      `\${${grant.passwordEnvVar}:-${grant.service}password}`,
    ]),
  );
}
