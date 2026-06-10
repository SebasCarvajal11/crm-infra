#!/usr/bin/env node
/**
 * validate-manifest.mjs — Validates gateway.manifest.json against the schema from cima-contracts.
 *
 * Usage:
 *   node scripts/validate-manifest.mjs [--openapi path/to/openapi.yaml]
 *
 * If --openapi is provided, cross-validates that every openapi_ref in the manifest
 * points to an existing method+path in the OpenAPI spec.
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { GatewayManifestSchema } from "@sebascarvajal11/cima-contracts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

// Parse optional --openapi flag
const args = process.argv.slice(2);
let openapiPath = null;
const openapiIdx = args.indexOf("--openapi");
if (openapiIdx !== -1 && args[openapiIdx + 1]) {
  openapiPath = resolve(ROOT, args[openapiIdx + 1]);
}

const manifestPath = resolve(ROOT, "gateway", "gateway.manifest.json");

if (!existsSync(manifestPath)) {
  console.error(`Error: Manifest file not found at ${manifestPath}`);
  process.exit(1);
}

try {
  const manifestRaw = readFileSync(manifestPath, "utf-8");
  const manifest = JSON.parse(manifestRaw);

  // Validate manifest against Zod schema from cima-contracts
  const parsed = GatewayManifestSchema.safeParse(manifest);
  if (!parsed.success) {
    console.error("Error: Manifest does not match GatewayManifestSchema:");
    console.error(JSON.stringify(parsed.error.format(), null, 2));
    process.exit(1);
  }

  let hasErrors = false;

  // If --openapi is provided, cross-validate openapi_ref
  if (openapiPath) {
    if (!existsSync(openapiPath)) {
      console.error(`Error: OpenAPI file not found at ${openapiPath}`);
      process.exit(1);
    }

    const YAML = await import("yaml");
    const openapiRaw = readFileSync(openapiPath, "utf-8");
    const openapi = YAML.parse(openapiRaw);

    for (const ep of manifest.endpoints) {
      const { endpoint, method, openapi_ref } = ep;
      if (!openapi_ref) {
        console.error(`Error: Endpoint "${method} ${endpoint}" is missing "openapi_ref"`);
        hasErrors = true;
        continue;
      }

      const parts = openapi_ref.split(" ");
      if (parts.length !== 2) {
        console.error(`Error: Invalid openapi_ref format "${openapi_ref}" for endpoint "${method} ${endpoint}". Expected format: "METHOD PATH"`);
        hasErrors = true;
        continue;
      }

      const [refMethod, refPath] = parts;
      let pathObj = openapi.paths?.[refPath];
      if (!pathObj) {
        pathObj = openapi.paths?.[refPath.endsWith("/") ? refPath.slice(0, -1) : refPath + "/"];
      }

      if (!pathObj) {
        console.error(`Error: Path "${refPath}" referenced by "${method} ${endpoint}" was not found in openapi.yaml`);
        hasErrors = true;
        continue;
      }

      const methodObj = pathObj[refMethod.toLowerCase()];
      if (!methodObj) {
        console.error(`Error: Method "${refMethod}" under path "${refPath}" referenced by "${method} ${endpoint}" was not found in openapi.yaml`);
        hasErrors = true;
        continue;
      }
    }
  }

  if (hasErrors) {
    console.error("Validation failed with errors.");
    process.exit(1);
  }

  const publicCount = manifest.endpoints.filter((e) => e.public).length;
  const authCount = manifest.endpoints.filter((e) => !e.public).length;

  console.log(`✓ Manifest validation successful for service "${manifest.service}"`);
  console.log(`  version   : ${manifest.version}`);
  console.log(`  endpoints : ${manifest.endpoints.length} (${publicCount} public, ${authCount} authenticated)`);
  if (openapiPath) {
    console.log(`  openapi   : cross-validated against ${openapiPath}`);
  }
  process.exit(0);
} catch (err) {
  console.error("An unexpected error occurred during validation:", err);
  process.exit(1);
}
