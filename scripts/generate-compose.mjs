import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";
import {
  DEFAULT_LOGGING,
  DEFAULT_CONTAINER_LIMITS,
  resolveServiceMemoryLimit,
  resolveWorkerMemoryLimit,
  buildLocalDbPasswordEnv,
} from "./compose-defaults.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));

const servicesPath = resolve(__dirname, "../registry/services.json");
const services = JSON.parse(readFileSync(servicesPath, "utf-8"));
const grantsPath = resolve(__dirname, "../registry/db/grants.json");
const grants = JSON.parse(readFileSync(grantsPath, "utf-8"));

// 1. Generate docker-compose.yml (Local Development)
function generateLocalCompose() {
  const include = services.map((s) => ({ path: s.composeFile }));

  // Construct krakend-config environment and depends_on dynamically
  const krakendEnv = {};
  const krakendDependsOn = {};
  const krakendManifestVolumes = [];

  for (const s of services) {
    if (s.manifestPath) {
      krakendEnv[`KRAKEND_${s.name.toUpperCase()}_HOST`] = `\${KRAKEND_${s.name.toUpperCase()}_HOST:-http://crm-${s.name}:${s.port}}`;
      krakendDependsOn[`crm-${s.name}`] = {
        condition: "service_healthy"
      };
      const manifestDirectory = dirname(s.manifestPath).replaceAll("\\", "/");
      krakendManifestVolumes.push(`../${manifestDirectory}:/workspace/${manifestDirectory}:ro`);
    }
  }
  // En local se prefieren manifiestos en vivo, pero un servicio auxiliar caído no
  // debe impedir que el gateway regenere las rutas de los demás servicios.
  krakendEnv["KRAKEND_ENDPOINTS_SOURCE"] = "auto";

  const composeObj = {
    include,
    services: {
      postgres_db: {
        build: {
          context: ".",
          dockerfile: "./scripts/Postgres.dockerfile"
        },
        restart: "unless-stopped",
        logging: DEFAULT_LOGGING,
        command: "postgres -c max_connections=150 -c shared_buffers=256MB -c work_mem=8MB",
        environment: {
          POSTGRES_USER: "root",
          POSTGRES_PASSWORD: "rootpassword",
          POSTGRES_DB: "crm_database",
          ...buildLocalDbPasswordEnv(grants)
        },
        ports: [
          "${POSTGRES_HOST_PORT:-25432}:5432"
        ],
        volumes: [
          "postgres_data:/var/lib/postgresql/data",
          "./scripts/00-init-service-schemas.sh:/docker-entrypoint-initdb.d/00-init-service-schemas.sh:ro",
          "./registry:/registry:ro"
        ],
        healthcheck: {
          test: ["CMD-SHELL", "pg_isready -U root -d crm_database"],
          interval: "10s",
          timeout: "5s",
          retries: 10,
          start_period: "20s"
        },
        networks: ["shared_backplane"]
      },
      redis: {
        image: "redis:7-alpine",
        restart: "unless-stopped",
        logging: DEFAULT_LOGGING,
        command: "redis-server --appendonly yes --appendfsync everysec",
        ports: [
          "${REDIS_HOST_PORT:-26379}:6379"
        ],
        volumes: [
          "redis_data:/data"
        ],
        healthcheck: {
          test: ["CMD", "redis-cli", "ping"],
          interval: "5s",
          timeout: "3s",
          retries: 5
        },
        networks: ["shared_backplane"]
      },
      "clamav-scanner": {
        image: "${CLAMAV_IMAGE:-clamav/clamav-debian:1.4}",
        restart: "unless-stopped",
        logging: DEFAULT_LOGGING,
        ports: [
          "${CLAMAV_HOST_PORT:-23310}:3310"
        ],
        healthcheck: {
          test: ["CMD-SHELL", "echo PING | nc localhost 3310 | grep -q PONG"],
          interval: "30s",
          timeout: "10s",
          retries: 5,
          start_period: "120s"
        },
        networks: ["shared_backplane"]
      },
      "krakend-config": {
        image: "${NODE_IMAGE:-node:22-alpine}",
        init: true,
        logging: DEFAULT_LOGGING,
        working_dir: "/workspace",
        environment: krakendEnv,
        volumes: [
          "./gateway:/workspace/gateway:ro",
          "./registry:/workspace/registry:ro",
          ...krakendManifestVolumes,
          "krakend_config:/output"
        ],
        command: ["node", "gateway/build-krakend.mjs", "--output", "/output/krakend.json"],
        depends_on: krakendDependsOn,
        networks: ["shared_backplane"]
      },
      "api-gateway": {
        image: "${KRAKEND_IMAGE:-devopsfaith/krakend:2.9}",
        restart: "unless-stopped",
        logging: DEFAULT_LOGGING,
        ports: [
          "${GATEWAY_HOST_PORT:-28080}:8080"
        ],
        volumes: [
          "krakend_config:/etc/krakend:ro"
        ],
        command: ["run", "-c", "/etc/krakend/krakend.json"],
        depends_on: {
          "krakend-config": {
            condition: "service_completed_successfully"
          }
        },
        networks: ["shared_backplane"]
      }
    },
    volumes: {
      postgres_data: null,
      redis_data: null,
      krakend_config: null
    },
    networks: {
      shared_backplane: {
        name: "${COMPOSE_PROJECT_NAME:-cima-crm-local}-backplane",
        driver: "bridge"
      }
    }
  };

  const yamlStr = YAML.stringify(composeObj, { keepBlobsInJSON: true, simpleKeys: true, lineWidth: 0 });
  writeFileSync(resolve(__dirname, "../docker-compose.yml"), "# Generated dynamically from registry/services.json. DO NOT EDIT.\n" + yamlStr, "utf-8");
  console.log("✓ Generated docker-compose.yml");
}

// 2. Generate docker-compose.slot.prod.yml (Production Slot Services)
function generateSlotProdCompose() {
  const servicesObj = {};

  const nodeBuildArgs = {
    NODE_IMAGE: "${NODE_IMAGE:-node:22-alpine}",
    PNPM_VERSION: "${PNPM_VERSION:-11.1.1}"
  };

  for (const s of services) {
    if (s.name === "frontend") {
      servicesObj["frontend"] = {
        build: {
          context: "../crm-frontend",
          args: {
            ...nodeBuildArgs,
            NGINX_IMAGE: "${NGINX_IMAGE:-nginx:1.27-alpine}"
          }
        },
        restart: "always",
        mem_limit: resolveServiceMemoryLimit(s),
        logging: DEFAULT_LOGGING,
        ports: [
          "127.0.0.1:${FRONTEND_SLOT_HOST_PORT:?FRONTEND_SLOT_HOST_PORT is required}:80"
        ],
        depends_on: {
          "api-gateway": {
            condition: "service_started"
          }
        },
        networks: ["default"]
      };
      continue;
    }

    // Backend services
    const serviceDef = {
      build: {
        context: `../crm-${s.name}`,
        args: nodeBuildArgs
      },
      init: true,
      restart: "always",
      mem_limit: resolveServiceMemoryLimit(s),
      logging: DEFAULT_LOGGING,
      env_file: [
        `../crm-${s.name}/.env.production`,
        `./deploy/runtime/${s.name}.\${APP_SLOT:?APP_SLOT is required}.env`
      ],
      environment: {
        CONTAINER_MODE: "server",
        DB_POOL_MAX: "10"
      },
      networks: {
        default: { aliases: [`crm-${s.name}`] },
        shared_backplane: { aliases: [`crm-${s.name}`] }
      }
    };

    if (s.requiredSecrets && s.requiredSecrets.length > 0) {
      serviceDef.volumes = ["/opt/cima/secrets:/opt/cima/secrets:ro"];
    }

    servicesObj[s.composeService] = serviceDef;

    // Workers for this backend service
    for (const w of s.workers || []) {
      const workerDef = {
        build: {
          context: `../crm-${s.name}`,
          args: nodeBuildArgs
        },
        init: true,
        restart: "always",
        mem_limit: resolveWorkerMemoryLimit(s.name, w),
        logging: DEFAULT_LOGGING,
        command: w.command,
        env_file: [
          `../crm-${s.name}/.env.production`,
          `./deploy/runtime/${s.name}.\${APP_SLOT:?APP_SLOT is required}.env`
        ],
        environment: {
          CONTAINER_MODE: "worker",
          DB_POOL_MAX: "2"
        },
        networks: ["default", "shared_backplane"],
        depends_on: {
          [s.composeService]: {
            condition: "service_healthy"
          }
        }
      };

      if (s.requiredSecrets && s.requiredSecrets.length > 0) {
        workerDef.volumes = ["/opt/cima/secrets:/opt/cima/secrets:ro"];
      }

      servicesObj[w.name] = workerDef;
    }
  }

  // Add api-gateway service
  servicesObj["api-gateway"] = {
    image: "${KRAKEND_IMAGE:-devopsfaith/krakend:2.9}",
    restart: "always",
    mem_limit: DEFAULT_CONTAINER_LIMITS.apiGateway,
    logging: DEFAULT_LOGGING,
    ports: [
      "127.0.0.1:${GATEWAY_SLOT_HOST_PORT:?GATEWAY_SLOT_HOST_PORT is required}:8080"
    ],
    volumes: [
      "./deploy/runtime/krakend.${APP_SLOT:?APP_SLOT is required}.json:/etc/krakend/krakend.json:ro"
    ],
    networks: ["default"]
  };

  const composeObj = {
    services: servicesObj,
    networks: {
      shared_backplane: {
        external: true,
        name: "crm-shared-backplane"
      }
    }
  };

  const yamlStr = YAML.stringify(composeObj, { keepBlobsInJSON: true, simpleKeys: true, lineWidth: 0 });
  writeFileSync(resolve(__dirname, "../docker-compose.slot.prod.yml"), "# Generated dynamically from registry/services.json. DO NOT EDIT.\n" + yamlStr, "utf-8");
  console.log("✓ Generated docker-compose.slot.prod.yml");
}

generateLocalCompose();
generateSlotProdCompose();
