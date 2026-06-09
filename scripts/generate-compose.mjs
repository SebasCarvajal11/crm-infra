import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";

const __dirname = dirname(fileURLToPath(import.meta.url));

const servicesPath = resolve(__dirname, "../registry/services.json");
const services = JSON.parse(readFileSync(servicesPath, "utf-8"));

// 1. Generate docker-compose.yml (Local Development)
function generateLocalCompose() {
  const include = services.map(s => ({
    path: s.composeFile
  }));

  // Construct krakend-config environment and depends_on dynamically
  const krakendEnv = {};
  const krakendDependsOn = {};

  for (const s of services) {
    if (s.manifestPath) {
      krakendEnv[`KRAKEND_${s.name.toUpperCase()}_HOST`] = `\${KRAKEND_${s.name.toUpperCase()}_HOST:-http://crm-${s.name}:${s.port}}`;
      krakendDependsOn[`crm-${s.name}`] = {
        condition: "service_healthy"
      };
    }
  }
  krakendEnv["KRAKEND_ENDPOINTS_SOURCE"] = "http";

  const composeObj = {
    include,
    services: {
      postgres_db: {
        image: "postgres:15-alpine",
        restart: "unless-stopped",
        environment: {
          POSTGRES_USER: "root",
          POSTGRES_PASSWORD: "rootpassword",
          POSTGRES_DB: "crm_database",
          AUTH_DB_PASSWORD: "${AUTH_DB_PASSWORD:-authpassword}",
          COLLAB_DB_PASSWORD: "${COLLAB_DB_PASSWORD:-collabpassword}",
          MEDIA_DB_PASSWORD: "${MEDIA_DB_PASSWORD:-mediapassword}"
        },
        ports: [
          "${POSTGRES_HOST_PORT:-15432}:5432"
        ],
        volumes: [
          "postgres_data:/var/lib/postgresql/data",
          "./scripts/00-init-service-schemas.sh:/docker-entrypoint-initdb.d/00-init-service-schemas.sh:ro"
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
        command: "redis-server --appendonly yes --appendfsync everysec",
        ports: [
          "${REDIS_HOST_PORT:-16379}:6379"
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
        image: "clamav/clamav-debian:latest",
        restart: "unless-stopped",
        ports: [
          "${CLAMAV_HOST_PORT:-13310}:3310"
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
        image: "node:22-alpine",
        working_dir: "/workspace",
        environment: krakendEnv,
        volumes: [
          "./gateway:/workspace/gateway:ro",
          "krakend_config:/output"
        ],
        command: ["node", "gateway/build-krakend.mjs", "--output", "/output/krakend.json"],
        depends_on: krakendDependsOn,
        networks: ["shared_backplane"]
      },
      "api-gateway": {
        image: "krakend:latest",
        restart: "unless-stopped",
        ports: [
          "${GATEWAY_HOST_PORT:-18080}:8080"
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
        name: "cima-crm-local-backplane",
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

  for (const s of services) {
    if (s.name === "frontend") {
      servicesObj["frontend"] = {
        build: {
          context: "../crm-frontend"
        },
        restart: "always",
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
        context: `../crm-${s.name}`
      },
      restart: "always",
      env_file: [
        `../crm-${s.name}/.env.production`,
        `./deploy/runtime/${s.name}.\${APP_SLOT:?APP_SLOT is required}.env`
      ],
      environment: {
        CONTAINER_MODE: "server"
      },
      networks: ["default", "shared_backplane"]
    };

    if (s.requiredSecrets && s.requiredSecrets.length > 0) {
      serviceDef.volumes = [
        "/opt/cima/secrets:/opt/cima/secrets:ro"
      ];
    }

    servicesObj[s.composeService] = serviceDef;

    // Workers for this backend service
    for (const w of s.workers || []) {
      const workerDef = {
        build: {
          context: `../crm-${s.name}`
        },
        restart: "always",
        command: w.command,
        env_file: [
          `../crm-${s.name}/.env.production`,
          `./deploy/runtime/${s.name}.\${APP_SLOT:?APP_SLOT is required}.env`
        ],
        environment: {
          CONTAINER_MODE: "worker"
        },
        networks: ["default", "shared_backplane"],
        depends_on: {
          [s.composeService]: {
            condition: "service_healthy"
          }
        }
      };

      if (s.requiredSecrets && s.requiredSecrets.length > 0) {
        workerDef.volumes = [
          "/opt/cima/secrets:/opt/cima/secrets:ro"
        ];
      }

      servicesObj[w.name] = workerDef;
    }
  }

  // Add api-gateway service
  servicesObj["api-gateway"] = {
    image: "krakend:latest",
    restart: "always",
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
